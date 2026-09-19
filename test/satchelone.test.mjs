import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport, stubFetch } from './helpers.mjs';
import * as fx from './fixtures/satchelone.mjs';

const load = () => freshImport('../src/providers/satchelone.mjs');

test('normalise maps a Satchel to-do onto the shared task shape', async (t) => {
  tempDataDir(t);
  const { __internals: { normalise } } = await load();
  const student = { id: 14768452, name: 'Alex Paton', year: 'Year 6' };
  const task = normalise(fx.todoTruncatedMidTag, student);

  await t.test('identity is namespaced so ids never collide across schools', () => {
    assert.equal(task.id, 'satchelone:91051974');
    assert.equal(task.source, 'satchelone');
    assert.equal(task.sourceId, 91051974);
  });

  await t.test('due date survives British Summer Time', () => {
    assert.equal(task.dueOn, '2026-09-22');
    assert.equal(task.issuedOn, '2026-09-18');
  });

  await t.test('carries the fields the board renders', () => {
    assert.equal(task.title, 'Friday 18th September -Independent Research');
    assert.equal(task.subject, 'PD-History');
    assert.equal(task.teacher, 'Mr D. Larkins');
    assert.equal(task.group, 'PD6R');
    assert.equal(task.completed, false);
    assert.equal(task.url, 'https://www.satchelone.com/homeworks/91051974');
    assert.equal(task.student.name, 'Alex Paton');
  });

  await t.test('description is plain text with no markup left behind', () => {
    assert.ok(!task.description.includes('<'), `markup leaked: ${task.description}`);
    assert.ok(task.description.startsWith('Imagine you are a soldier'));
  });

  await t.test('points at the detail route for the full brief', () => {
    assert.equal(task.detailUrl, '/api/satchelone/homework?id=91051974');
  });
});

test('truncation detection survives the stripper', async (t) => {
  tempDataDir(t);
  const { __internals: { normalise } } = await load();
  const student = { id: 1, name: 'Test Student' };

  await t.test('a preview cut mid-tag is still recognised as truncated', () => {
    // Regression: stripping the dangling '<p class="' also removed the '…'
    // marker, so the task looked complete and never fetched its full brief.
    assert.equal(normalise(fx.todoTruncatedMidTag, student).truncated, true);
  });

  await t.test('a cleanly cut preview is recognised too', () => {
    assert.equal(normalise(fx.todoTruncatedClean, student).truncated, true);
  });

  await t.test('a short, complete description is not flagged', () => {
    assert.equal(normalise(fx.todoComplete, student).truncated, false);
  });
});

test('pickTask copes with every task type Satchel returns', async (t) => {
  tempDataDir(t);
  const { __internals: { pickTask } } = await load();

  await t.test('finds a homework payload', () => {
    assert.equal(pickTask(fx.homeworkDetail).id, 91051974);
  });

  await t.test('finds a flexible task, which uses a different key', () => {
    // Regression: reading payload.homework returned undefined for these,
    // so two tasks silently kept their truncated previews.
    assert.equal(pickTask(fx.flexibleTaskDetail).id, 90952409);
  });

  await t.test('ignores the lesson_occurrences envelope field', () => {
    assert.equal(pickTask({ lesson_occurrences: [], quiz: { id: 7 } }).id, 7);
  });

  await t.test('throws a 502 rather than returning undefined', () => {
    assert.throws(() => pickTask({ lesson_occurrences: [] }), (err) => err.status === 502);
    assert.throws(() => pickTask({}), /Unrecognised task payload/);
  });
});

test('estimate normalises the duration units', async (t) => {
  tempDataDir(t);
  const { __internals: { estimate } } = await load();

  await t.test('minutes pass through, hours convert', () => {
    assert.equal(estimate({ duration: 30, duration_units: 'minutes' }), 30);
    assert.equal(estimate({ duration: 1, duration_units: 'hours' }), 60);
    assert.equal(estimate({ duration: 2, duration_units: 'hour' }), 120);
  });

  await t.test('assumes minutes when units are absent', () => {
    assert.equal(estimate({ duration: 45 }), 45);
  });

  await t.test('no duration gives null, not zero', () => {
    assert.equal(estimate({}), null);
    assert.equal(estimate({ duration: 0 }), null);
  });
});

test('enrich fills in truncated briefs from the detail endpoint', async (t) => {
  tempDataDir(t);
  const { __internals: { normalise, enrich } } = await load();
  const tokens = await freshImport('../src/tokens.mjs');
  tokens.writeToken('satchelone', { token: 'test-token', expiresAt: Date.now() + 86400000 });

  const ctx = { log: () => {}, env: {}, refresh: false };
  const student = { id: 1, name: 'Test Student' };

  await t.test('replaces the preview with the full text', async () => {
    stubFetch(t, { '/homeworks/91051974': { body: fx.homeworkDetail } });
    const [out] = await enrich(ctx, [normalise(fx.todoTruncatedMidTag, student)]);
    assert.equal(out.truncated, false);
    assert.ok(out.description.includes('Write your letter on tea-stained paper'));
    assert.equal(out.estimateMinutes, 30);
  });

  await t.test('collects links from the body and from web_links', async () => {
    stubFetch(t, { '/homeworks/': { body: fx.flexibleTaskDetail } });
    const [out] = await enrich(ctx, [normalise({ ...fx.todoTruncatedMidTag, class_task_id: 90952409 }, student)]);
    assert.equal(out.estimateMinutes, 60, 'hours converted to minutes');
    assert.deepEqual(out.links, [{ url: 'https://example.test/vangogh', label: 'Gallery' }]);
  });

  await t.test('leaves complete tasks alone and makes no request for them', async () => {
    const calls = stubFetch(t, { '/homeworks/': { body: fx.homeworkDetail } });
    const [out] = await enrich(ctx, [normalise(fx.todoComplete, student)]);
    assert.equal(calls.length, 0, 'no needless detail fetch');
    assert.equal(out.description, 'Please complete the sheet handed out in class.');
  });

  await t.test('a failed detail fetch keeps the preview instead of losing the task', async () => {
    stubFetch(t, { '/homeworks/': { status: 500, body: { error: 'boom' } } });
    const logged = [];
    const [out] = await enrich({ ...ctx, log: (m) => logged.push(m) }, [normalise(fx.todoTruncatedMidTag, student)]);
    assert.ok(out, 'task survives');
    assert.equal(out.truncated, true, 'still marked so the UI can offer a retry');
    assert.ok(out.description.startsWith('Imagine you are a soldier'));
    assert.equal(logged.length, 1, 'the failure is logged, not swallowed silently');
  });

  await t.test('one failure does not take down the others', async () => {
    stubFetch(t, {
      '/homeworks/91051974': { body: fx.homeworkDetail },
      '/homeworks/90952409': { status: 404, body: { error: 'gone' } },
    });
    const tasks = [
      normalise(fx.todoTruncatedMidTag, student),
      normalise({ ...fx.todoTruncatedMidTag, class_task_id: 90952409 }, student),
    ];
    const out = await enrich(ctx, tasks);
    assert.equal(out.length, 2);
    assert.equal(out[0].truncated, false);
    assert.equal(out[1].truncated, true);
  });
});

test('attachments are resolved from ids into usable files', async (t) => {
  tempDataDir(t);
  const { __internals: { resolveAttachments, normalise, enrich } } = await load();
  const tokens = await freshImport('../src/tokens.mjs');
  tokens.writeToken('satchelone', { token: 'test-token', expiresAt: Date.now() + 86400000 });
  const ctx = { log: () => {}, env: {}, refresh: false };

  const batch = {
    attachments: [
      { id: 171564499, filename: 'Song.MP3', content_type: 'audio/mpeg', file_size: 3333224, file_url: 'https://cdn.test/song.mp3', preview_url: null },
      { id: 171564500, filename: 'Words.pptx', content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', file_size: 46168, file_url: 'https://cdn.test/words.pptx', preview_url: null },
    ],
  };

  await t.test('ids become filenames, sizes and urls in one batch call', async () => {
    const calls = stubFetch(t, { '/attachments?': { body: batch } });
    const out = await resolveAttachments(ctx, [171564499, 171564500]);
    assert.equal(calls.length, 1, 'one request for the whole set');
    assert.match(calls[0].url, /ids\[\]=171564499&ids\[\]=171564500/);
    assert.deepEqual(out[0], {
      id: 171564499, filename: 'Song.MP3', contentType: 'audio/mpeg',
      bytes: 3333224, url: 'https://cdn.test/song.mp3', previewUrl: null,
    });
  });

  await t.test('no ids means no request at all', async () => {
    const calls = stubFetch(t, { '/attachments?': { body: batch } });
    assert.deepEqual(await resolveAttachments(ctx, []), []);
    assert.deepEqual(await resolveAttachments(ctx, undefined), []);
    assert.equal(calls.length, 0);
  });

  await t.test('enrichment attaches them to the task', async () => {
    stubFetch(t, {
      '/homeworks/': { body: { lesson_occurrences: [], flexible_task: { id: 1, description: '<p>Sing</p>', attachment_ids: [171564499] } } },
      '/attachments?': { body: batch },
    });
    const [out] = await enrich(ctx, [normalise(fx.todoTruncatedMidTag, { id: 1, name: 'Test Student' })]);
    assert.equal(out.attachments.length, 2);
    assert.equal(out.attachments[0].filename, 'Song.MP3');
  });

  await t.test('a failed attachment lookup does not lose the task', async () => {
    stubFetch(t, {
      '/homeworks/': { body: { lesson_occurrences: [], homework: { id: 1, description: '<p>Sing</p>', attachment_ids: [1] } } },
      '/attachments?': { status: 500, body: { error: 'boom' } },
    });
    const logged = [];
    const [out] = await enrich({ ...ctx, log: (m) => logged.push(m) }, [normalise(fx.todoTruncatedMidTag, { id: 1, name: 'Test Student' })]);
    assert.equal(out.truncated, false, 'the brief still came through');
    assert.deepEqual(out.attachments, []);
    assert.equal(logged.length, 1);
  });

  await t.test('tasks without attachments get an empty array, never undefined', () => {
    assert.deepEqual(normalise(fx.todoComplete, { id: 1, name: 'Test Student' }).attachments, []);
  });
});

test('pool bounds concurrency and preserves order', async (t) => {
  tempDataDir(t);
  const { __internals: { pool } } = await load();

  await t.test('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    const out = await pool(items, 5, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 2;
    });
    assert.ok(peak <= 5, `ran ${peak} at once`);
    assert.deepEqual(out, items.map((n) => n * 2), 'results stay in input order');
  });

  await t.test('handles an empty list without hanging', async () => {
    assert.deepEqual(await pool([], 5, async () => 1), []);
  });
});

test('apiHeaders sends what the API actually requires', async (t) => {
  tempDataDir(t);
  const { __internals: { apiHeaders } } = await load();
  const h = apiHeaders('abc123');

  await t.test('the vendor accept header, without which the API 500s', () => {
    assert.equal(h.accept, 'application/smhw.v2021.5+json');
  });

  await t.test('platform and origin, also required', () => {
    assert.equal(h['x-platform'], 'web');
    assert.equal(h.origin, 'https://www.satchelone.com');
    assert.equal(h.referer, 'https://www.satchelone.com/');
  });

  await t.test('bearer token', () => {
    assert.equal(h.authorization, 'Bearer abc123');
  });
});
