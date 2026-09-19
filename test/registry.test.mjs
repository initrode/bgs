import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport, fakeProvider } from './helpers.mjs';

test('loadProviders discovers and validates providers', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  await t.test('scanning disk finds the real provider', async () => {
    await reg.loadProviders();
    assert.ok(reg.providers.has('satchelone'));
    assert.equal(reg.providers.get('satchelone').file, 'satchelone.mjs');
  });

  await t.test('template files prefixed with _ are never loaded', async () => {
    await reg.loadProviders();
    assert.equal(reg.providers.has('myschool'), false, '_template.mjs must stay inert');
  });

  await t.test('an injected list replaces the disk scan', async () => {
    await reg.loadProviders([fakeProvider()]);
    assert.deepEqual([...reg.providers.keys()], ['fake']);
  });

  await t.test('a provider without an id is rejected', async () => {
    await reg.loadProviders([]);
    assert.throws(() => reg.register({ label: 'nameless' }), /must export a default object with an "id"/);
  });

  await t.test('two providers cannot claim the same id', async () => {
    await reg.loadProviders([fakeProvider()]);
    assert.throws(() => reg.register(fakeProvider()), /duplicate provider id "fake"/);
  });

  await t.test('routes and credentials default to empty', async () => {
    await reg.loadProviders([{ id: 'bare' }]);
    const p = reg.providers.get('bare');
    assert.deepEqual(p.routes, []);
    assert.deepEqual(p.credentials, []);
  });
});

test('runRoute validates parameters before doing any work', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  const provider = fakeProvider({
    routes: [{
      path: '/thing',
      ttl: 0,
      params: {
        id: { required: true, description: 'the id' },
        student: { required: false, env: 'TEST_STUDENT_ENV' },
        mode: { required: false, default: 'normal' },
      },
      handler: async (ctx) => ({ got: ctx.params }),
    }],
  });
  await reg.loadProviders([provider]);
  const route = provider.routes[0];

  await t.test('a missing required parameter is a 400, and the handler never runs', async () => {
    let ran = false;
    const spy = { ...route, handler: async () => { ran = true; } };
    await assert.rejects(() => reg.runRoute(provider, spy, {}), (err) => err.status === 400 && /Missing required parameter "id"/.test(err.message));
    assert.equal(ran, false);
  });

  await t.test('an empty string counts as missing', async () => {
    await assert.rejects(() => reg.runRoute(provider, route, { id: '' }), (err) => err.status === 400);
  });

  await t.test('defaults are applied when absent', async () => {
    const out = await reg.runRoute(provider, route, { id: '7' });
    assert.equal(out.data.got.mode, 'normal');
  });

  await t.test('an env fallback fills a parameter in', async () => {
    process.env.TEST_STUDENT_ENV = '999';
    try {
      const out = await reg.runRoute(provider, route, { id: '7' }, { refresh: true });
      assert.equal(out.data.got.student, '999');
    } finally {
      delete process.env.TEST_STUDENT_ENV;
    }
  });

  await t.test('unknown parameters are dropped, not passed through', async () => {
    const out = await reg.runRoute(provider, route, { id: '7', sneaky: 'x' });
    assert.equal(out.data.got.sneaky, undefined);
  });

  await t.test('a provider missing credentials refuses with 503', async () => {
    const gated = fakeProvider({ id: 'gated', credentials: ['DEFINITELY_NOT_SET_ANYWHERE'] });
    await reg.loadProviders([gated]);
    await assert.rejects(
      () => reg.runRoute(gated, gated.routes[0], {}),
      (err) => err.status === 503 && err.code === 'MISSING_CREDENTIALS'
    );
  });
});

test('runRoute caches by provider, route and parameters', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  let calls = 0;
  const provider = fakeProvider({
    routes: [{
      path: '/counted',
      ttl: 60,
      params: { who: { required: false, default: 'a' } },
      handler: async (ctx) => { calls++; return { who: ctx.params.who, calls }; },
    }],
  });
  await reg.loadProviders([provider]);
  const route = provider.routes[0];

  await t.test('the first call runs the handler and reports it fresh', async () => {
    const out = await reg.runRoute(provider, route, {});
    assert.equal(out.cached, false);
    assert.equal(typeof out.tookMs, 'number');
    assert.ok(out.fetchedAt);
    assert.equal(calls, 1);
  });

  await t.test('the second call is served from cache', async () => {
    const out = await reg.runRoute(provider, route, {});
    assert.equal(out.cached, true);
    assert.equal(typeof out.ageSeconds, 'number');
    assert.equal(calls, 1, 'handler not run again');
  });

  await t.test('different parameters are cached separately', async () => {
    await reg.runRoute(provider, route, { who: 'b' });
    assert.equal(calls, 2);
  });

  await t.test('refresh bypasses the cache', async () => {
    await reg.runRoute(provider, route, {}, { refresh: true });
    assert.equal(calls, 3);
  });

  await t.test('the envelope names its source and route', async () => {
    const out = await reg.runRoute(provider, route, {});
    assert.equal(out.source, 'fake');
    assert.equal(out.route, '/counted');
    assert.deepEqual(out.params, { who: 'a' });
  });
});

test('collectTasks merges providers and survives a broken one', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  const good = fakeProvider({
    id: 'good',
    label: 'Good School',
    tasks: async () => [
      { id: 'good:2', dueOn: '2026-10-01', title: 'Later' },
      { id: 'good:1', dueOn: '2026-09-20', title: 'Sooner' },
    ],
  });
  const broken = fakeProvider({ id: 'broken', label: 'Broken School', tasks: async () => { throw new Error('portal down'); } });
  const unconfigured = fakeProvider({ id: 'locked', label: 'Locked', credentials: ['NOT_SET_ANYWHERE_AT_ALL'], tasks: async () => [{ id: 'locked:1' }] });
  const noFeed = fakeProvider({ id: 'nofeed' });

  await reg.loadProviders([good, broken, unconfigured, noFeed]);

  await t.test('tasks come back sorted by due date', async () => {
    const out = await reg.collectTasks();
    assert.deepEqual(out.tasks.map((x) => x.title), ['Sooner', 'Later']);
  });

  await t.test('a provider that throws is reported, not fatal', async () => {
    const out = await reg.collectTasks();
    const bad = out.sources.find((s) => s.id === 'broken');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /portal down/);
    assert.equal(out.tasks.length, 2, 'the working provider still contributes');
  });

  await t.test('an unconfigured provider is skipped with a reason', async () => {
    const out = await reg.collectTasks();
    const locked = out.sources.find((s) => s.id === 'locked');
    assert.equal(locked.ok, true);
    assert.equal(locked.skipped, 'missing credentials');
    assert.equal(locked.count, 0);
  });

  await t.test('providers without a tasks() feed are left out entirely', async () => {
    const out = await reg.collectTasks();
    assert.equal(out.sources.find((s) => s.id === 'nofeed'), undefined);
  });

  await t.test('source filtering narrows the fan-out', async () => {
    const out = await reg.collectTasks({ only: ['good'] });
    assert.deepEqual(out.sources.map((s) => s.id), ['good']);
    assert.equal(out.tasks.length, 2);
  });

  await t.test('undated tasks sort last rather than first', async () => {
    await reg.loadProviders([fakeProvider({
      id: 'mixed',
      tasks: async () => [{ id: 'm:1', dueOn: null, title: 'Undated' }, { id: 'm:2', dueOn: '2026-09-20', title: 'Dated' }],
    })]);
    const out = await reg.collectTasks();
    assert.deepEqual(out.tasks.map((x) => x.title), ['Dated', 'Undated']);
  });
});

test('collectStats merges practice targets the way it merges tasks', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  const maths = fakeProvider({
    id: 'maths',
    label: 'Maths Practice',
    stats: async (ctx) => [{ id: 'maths:minutes', label: 'Maths', value: 8, target: 30, week: ctx.params.week }],
  });
  const reading = fakeProvider({ id: 'reading', label: 'Reading Log', stats: async () => [{ id: 'reading:books', value: 2, target: 3 }] });
  const broken = fakeProvider({ id: 'broken', label: 'Broken', stats: async () => { throw new Error('site down'); } });
  const locked = fakeProvider({ id: 'locked', label: 'Locked', credentials: ['NOT_SET_ANYWHERE_AT_ALL'], stats: async () => [{ id: 'locked:1' }] });
  const noFeed = fakeProvider({ id: 'nofeed' });

  await reg.loadProviders([maths, reading, broken, locked, noFeed]);

  await t.test('every provider that measures something contributes', async () => {
    const out = await reg.collectStats();
    assert.deepEqual(out.metrics.map((m) => m.id), ['maths:minutes', 'reading:books']);
  });

  await t.test('each metric carries where it came from, so the board need not know', async () => {
    const [metric] = (await reg.collectStats()).metrics;
    assert.equal(metric.source, 'maths');
    assert.equal(metric.sourceLabel, 'Maths Practice');
  });

  await t.test('one broken source does not lose the others', async () => {
    const out = await reg.collectStats();
    const bad = out.sources.find((s) => s.id === 'broken');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /site down/);
    assert.equal(out.metrics.length, 2);
  });

  await t.test('an unconfigured source is skipped with a reason', async () => {
    const locked = (await reg.collectStats()).sources.find((s) => s.id === 'locked');
    assert.equal(locked.skipped, 'missing credentials');
    assert.equal(locked.count, 0);
  });

  await t.test('providers with no stats() feed are left out entirely', async () => {
    assert.equal((await reg.collectStats()).sources.find((s) => s.id === 'nofeed'), undefined);
  });

  await t.test('the week asked for reaches the provider', async () => {
    const out = await reg.collectStats({ week: '2026-09-14' });
    assert.equal(out.metrics[0].week, '2026-09-14');
  });

  await t.test('source filtering narrows the fan-out', async () => {
    const out = await reg.collectStats({ only: ['reading'] });
    assert.deepEqual(out.sources.map((s) => s.id), ['reading']);
    assert.equal(out.metrics.length, 1);
  });
});
