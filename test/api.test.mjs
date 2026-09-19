import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport, fakeProvider, serve, getJSON } from './helpers.mjs';

process.env.QUIET = '1';

const TASKS = [
  { id: 'demo:1', source: 'demo', title: 'Overdue thing', dueOn: '2020-01-01', completed: false, description: 'x' },
  { id: 'demo:2', source: 'demo', title: 'Future thing', dueOn: '2099-01-01', completed: false, description: 'y' },
  { id: 'demo:3', source: 'demo', title: 'Finished thing', dueOn: '2099-01-02', completed: true, description: 'z' },
];

async function app(t, providers) {
  tempDataDir(t);
  const { buildApp } = await freshImport('../src/app.mjs');
  return serve(t, await buildApp({ providers }));
}

const demo = () => fakeProvider({ id: 'demo', label: 'Demo School', tasks: async () => TASKS.map((x) => ({ ...x })) });

test('GET /api documents what the server can do', async (t) => {
  const base = await app(t, [demo()]);
  const { status, body } = await getJSON(base, '/api');

  await t.test('lists each provider and whether it is usable', () => {
    assert.equal(status, 200);
    const p = body.providers.find((x) => x.id === 'demo');
    assert.equal(p.label, 'Demo School');
    assert.equal(p.configured, true);
    assert.equal(p.contributesTasks, true);
  });

  await t.test('names each route with its full url and parameters', () => {
    const route = body.providers[0].routes[0];
    assert.equal(route.url, '/api/demo/things');
    assert.equal(route.method, 'GET');
    assert.ok('who' in route.params);
  });

  await t.test('advertises the aggregate endpoints', () => {
    assert.ok(body.aggregate.some((r) => r.url === '/api/tasks'));
    assert.ok(body.aggregate.some((r) => r.url === '/api/health'));
  });
});

test('GET /api/health reports configuration and sessions', async (t) => {
  const base = await app(t, [demo(), fakeProvider({ id: 'locked', credentials: ['NEVER_SET_ANYWHERE'] })]);
  const { body } = await getJSON(base, '/api/health');

  await t.test('ok, with one entry per provider', () => {
    assert.equal(body.ok, true);
    assert.equal(body.providers.length, 2);
  });

  await t.test('names exactly which credentials are missing', () => {
    const locked = body.providers.find((p) => p.id === 'locked');
    assert.equal(locked.configured, false);
    assert.deepEqual(locked.missing, ['NEVER_SET_ANYWHERE']);
  });

  await t.test('reports no session before any login', () => {
    assert.equal(body.providers.find((p) => p.id === 'demo').session.valid, false);
  });
});

test('GET /api/tasks merges, filters and caches', async (t) => {
  const base = await app(t, [demo()]);

  await t.test('returns every task with its source', async () => {
    const { body } = await getJSON(base, '/api/tasks');
    assert.equal(body.count, 3);
    assert.equal(body.sources[0].id, 'demo');
    assert.equal(body.sources[0].count, 3);
  });

  await t.test('is served from cache on the second call', async () => {
    const { body } = await getJSON(base, '/api/tasks');
    assert.equal(body.cached, true);
  });

  await t.test('refresh bypasses the cache', async () => {
    const { body } = await getJSON(base, '/api/tasks?refresh=1');
    assert.equal(body.cached, false);
  });

  await t.test('done=false hides finished tasks', async () => {
    const { body } = await getJSON(base, '/api/tasks?done=false');
    assert.equal(body.count, 2);
    assert.ok(body.tasks.every((x) => !x.done));
  });

  await t.test('due=overdue selects only what is genuinely late', async () => {
    const { body } = await getJSON(base, '/api/tasks?due=overdue');
    assert.deepEqual(body.tasks.map((x) => x.title), ['Overdue thing']);
  });

  await t.test('due=upcoming excludes the overdue ones', async () => {
    const { body } = await getJSON(base, '/api/tasks?due=upcoming');
    assert.deepEqual(body.tasks.map((x) => x.title), ['Future thing']);
  });

  await t.test('an unknown source yields nothing rather than everything', async () => {
    const { body } = await getJSON(base, '/api/tasks?source=nosuchschool');
    assert.equal(body.count, 0);
  });

  await t.test('every task carries a done flag the UI can trust', async () => {
    const { body } = await getJSON(base, '/api/tasks');
    assert.ok(body.tasks.every((x) => typeof x.done === 'boolean'));
  });
});

test('provider routes mount under their own namespace', async (t) => {
  const base = await app(t, [demo()]);

  await t.test('the route responds with the standard envelope', async () => {
    const { status, body } = await getJSON(base, '/api/demo/things?who=alex');
    assert.equal(status, 200);
    assert.equal(body.source, 'demo');
    assert.equal(body.route, '/things');
    assert.equal(body.data.who, 'alex');
  });

  await t.test('an unknown route is a clean 404', async () => {
    const res = await fetch(`${base}/api/demo/nosuchroute`);
    assert.equal(res.status, 404);
  });

  await t.test('an unknown provider does not resolve', async () => {
    const res = await fetch(`${base}/api/nosuchschool/things`);
    assert.equal(res.status, 404);
  });
});

test('errors come back as JSON with a useful status', async (t) => {
  const exploding = fakeProvider({
    id: 'boom',
    routes: [
      { path: '/kaboom', ttl: 0, params: {}, handler: async () => { throw new Error('upstream exploded'); } },
      { path: '/needs', ttl: 0, params: { id: { required: true, description: 'an id' } }, handler: async () => ({}) },
    ],
  });
  const base = await app(t, [exploding]);

  await t.test('a thrown handler becomes a 500, not a hang', async () => {
    const { status, body } = await getJSON(base, '/api/boom/kaboom');
    assert.equal(status, 500);
    assert.match(body.error, /upstream exploded/);
  });

  await t.test('a missing parameter becomes a 400 that says which', async () => {
    const { status, body } = await getJSON(base, '/api/boom/needs');
    assert.equal(status, 400);
    assert.match(body.error, /Missing required parameter "id"/);
  });

  await t.test('a missing-credentials error carries a machine-readable code', async () => {
    const gated = fakeProvider({ id: 'gated', credentials: ['NEVER_SET_ANYWHERE'] });
    const gatedBase = await app(t, [gated]);
    const { status, body } = await getJSON(gatedBase, '/api/gated/things');
    assert.equal(status, 503);
    assert.equal(body.code, 'MISSING_CREDENTIALS');
  });
});

test('local state round-trips over HTTP', async (t) => {
  const base = await app(t, [demo()]);

  await t.test('a tick is stored and reflected in the feed', async () => {
    const res = await fetch(`${base}/api/state/demo:1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    });
    assert.equal(res.status, 200);
    const { body } = await getJSON(base, '/api/tasks?refresh=1');
    const task = body.tasks.find((x) => x.id === 'demo:1');
    assert.equal(task.done, true);
    assert.equal(task.completed, false, 'the school record is untouched');
  });

  await t.test('the tick shows up in GET /api/state', async () => {
    const { body } = await getJSON(base, '/api/state');
    assert.equal(body['demo:1'].done, true);
  });

  await t.test('deleting it restores what the school says', async () => {
    const res = await fetch(`${base}/api/state/demo:1`, { method: 'DELETE' });
    assert.deepEqual(await res.json(), { removed: true });
    const { body } = await getJSON(base, '/api/tasks?refresh=1');
    assert.equal(body.tasks.find((x) => x.id === 'demo:1').done, false);
  });

  await t.test('ids containing a colon survive url encoding', async () => {
    await fetch(`${base}/api/state/${encodeURIComponent('demo:2')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'ask the teacher' }),
    });
    const { body } = await getJSON(base, '/api/state');
    assert.equal(body['demo:2'].note, 'ask the teacher');
  });
});

test('attachment endpoints resolve tasks server-side', async (t) => {
  const withFiles = fakeProvider({
    id: 'demo',
    label: 'Demo School',
    tasks: async () => [{
      id: 'demo:9', source: 'demo', title: 'Song', dueOn: '2099-01-01', completed: false,
      attachments: [{ id: 1, filename: 'song.mp3', contentType: 'audio/mpeg', bytes: 11, url: 'https://cdn.test/song.mp3' }],
    }],
  });
  const base = await app(t, [withFiles]);

  await t.test('the feed says whether each file is already local', async () => {
    const { body } = await getJSON(base, '/api/tasks');
    const file = body.tasks[0].attachments[0];
    assert.equal(file.downloaded, false);
    assert.ok(file.localUrl.startsWith('/files/'));
  });

  await t.test('a download needs a taskId', async () => {
    const res = await fetch(`${base}/api/attachments/download`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  await t.test('an unknown task is a 404, not a silent no-op', async () => {
    const res = await fetch(`${base}/api/attachments/download`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'demo:nope' }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('a task with no attachments says so', async () => {
    const bare = await app(t, [demo()]);
    const res = await fetch(`${bare}/api/attachments/download`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: 'demo:1' }),
    });
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /no attachments/);
  });

  await t.test('the listing endpoint answers before anything is downloaded', async () => {
    const { status, body } = await getJSON(base, '/api/attachments');
    assert.equal(status, 200);
    assert.deepEqual(body.files, []);
  });
});

test('the board itself is served', async (t) => {
  const base = await app(t, [demo()]);

  await t.test('index.html loads and boots the module', async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /<script type="module" src="\/app\.js">/);
  });

  await t.test('the frontend modules are reachable at the paths the page uses', async () => {
    for (const path of ['/app.js', '/task-utils.js', '/styles.css']) {
      assert.equal((await fetch(`${base}${path}`)).status, 200, `${path} must be served`);
    }
  });

  await t.test('/timetable is a page of its own, not a 404', async () => {
    const res = await fetch(`${base}/timetable`);
    const html = await res.text();
    assert.equal(res.status, 200, 'a bookmark or a refresh on /timetable must land');
    assert.match(html, /<script type="module" src="\/app\.js">/);
  });

  await t.test('the two views are linked as real urls', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /href="\/timetable"/);
    assert.match(html, /href="\/"/);
  });

  await t.test('/homework is an alias for the board root', async () => {
    const res = await fetch(`${base}/homework`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  });

  await t.test('an unknown page is still a 404', async () => {
    assert.equal((await fetch(`${base}/not-a-view`)).status, 404);
  });
});

test('GET /api/stats serves practice targets', async (t) => {
  const practice = fakeProvider({
    id: 'practice',
    label: 'Practice Portal',
    stats: async (ctx) => [{
      id: 'practice:minutes', label: 'Practice Portal', value: 8, target: 30, unit: 'min',
      period: { start: ctx.params.week || '2026-09-14', end: '2026-09-20' },
    }],
  });
  const base = await app(t, [demo(), practice]);

  await t.test('the metric comes back tagged with its source', async () => {
    const { status, body } = await getJSON(base, '/api/stats');
    assert.equal(status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.metrics[0].source, 'practice');
    assert.equal(body.metrics[0].value, 8);
  });

  await t.test('a week can be asked for', async () => {
    const { body } = await getJSON(base, '/api/stats?week=2026-09-07');
    assert.equal(body.metrics[0].period.start, '2026-09-07');
  });

  await t.test('the answer is cached, and ?refresh=1 goes past the cache', async () => {
    // Earlier subtests have already filled the cache; start from empty.
    await fetch(`${base}/api/cache/clear?prefix=aggregate:stats`, { method: 'POST' });
    const first = await getJSON(base, '/api/stats');
    const second = await getJSON(base, '/api/stats');
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, true);
    assert.equal((await getJSON(base, '/api/stats?refresh=1')).body.cached, false);
  });

  await t.test('a provider with no stats feed contributes nothing and breaks nothing', async () => {
    const { body } = await getJSON(base, '/api/stats');
    assert.equal(body.sources.some((s) => s.id === 'demo'), false);
  });

  await t.test('the index advertises it', async () => {
    const { body } = await getJSON(base, '/api');
    assert.ok(body.aggregate.some((a) => a.url === '/api/stats'));
    assert.equal(body.providers.find((p) => p.id === 'practice').contributesStats, true);
    assert.equal(body.providers.find((p) => p.id === 'demo').contributesStats, false);
  });
});
