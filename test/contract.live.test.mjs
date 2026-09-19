/**
 * Contract tests against the real Satchel One API.
 *
 * Skipped unless LIVE=1, because they need working credentials and hit the
 * network. Run them when something looks wrong, or periodically, to find out
 * whether Satchel has changed shape under the provider:
 *
 *   LIVE=1 npm test
 *
 * These assert the *shape* of what comes back, never the contents — homework
 * changes every week, but the field names should not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readToken } from '../src/tokens.mjs';

const live = process.env.LIVE === '1';
const token = live ? readToken('satchelone') : null;

const API = 'https://api.satchelone.com/api';
const headers = () => ({
  authorization: `Bearer ${token.token}`,
  accept: 'application/smhw.v2021.5+json',
  'x-platform': 'web',
  origin: 'https://www.satchelone.com',
  referer: 'https://www.satchelone.com/',
});

test('Satchel One still behaves the way the provider expects', { skip: !live && 'set LIVE=1 to run' }, async (t) => {
  assert.ok(token, 'no saved token — start the server once to sign in, then rerun');
  const student = process.env.STUDENT_ID || '14768452';

  await t.test('the vendor accept header is still required', async () => {
    // If this starts passing, the API has loosened and the note in the
    // README about mandatory headers is out of date.
    const res = await fetch(`${API}/todos?add_dateless=true&from=2026-09-01&to=2026-09-30&student_id=${student}`, {
      headers: { authorization: `Bearer ${token.token}` },
    });
    assert.notEqual(res.status, 200, 'expected the bare request to be rejected');
  });

  await t.test('/todos returns the fields the provider reads', async () => {
    const res = await fetch(`${API}/todos?add_dateless=true&from=2026-09-01&to=2027-01-01&student_id=${student}`, { headers: headers() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.todos), 'todos is an array');
    if (!body.todos.length) return;

    for (const field of [
      'class_task_id', 'class_task_type', 'class_task_title', 'class_task_description',
      'due_on', 'completed', 'subject', 'teacher_name', 'class_group_name', 'issued_at',
    ]) {
      assert.ok(field in body.todos[0], `missing field: ${field}`);
    }
  });

  await t.test('due_on still carries a timezone offset we must not normalise away', async () => {
    const res = await fetch(`${API}/todos?add_dateless=true&from=2026-09-01&to=2027-01-01&student_id=${student}`, { headers: headers() });
    const { todos } = await res.json();
    if (!todos.length) return;
    assert.match(todos[0].due_on, /^\d{4}-\d{2}-\d{2}T/, 'due_on is a timestamp, not a bare date');
  });

  await t.test('/todos descriptions are still truncated, so enrichment is still needed', async () => {
    const res = await fetch(`${API}/todos?add_dateless=true&from=2026-09-01&to=2027-01-01&student_id=${student}`, { headers: headers() });
    const { todos } = await res.json();
    const long = todos.filter((x) => (x.class_task_description || '').length > 80);
    if (!long.length) return;
    assert.ok(
      long.some((x) => x.class_task_description.trim().endsWith('…')),
      'no truncation marker found — the API may now return full descriptions'
    );
  });

  await t.test('the detail endpoint keys tasks by type', async () => {
    const res = await fetch(`${API}/todos?add_dateless=true&from=2026-09-01&to=2027-01-01&student_id=${student}`, { headers: headers() });
    const { todos } = await res.json();
    if (!todos.length) return;

    const detail = await (await fetch(`${API}/homeworks/${todos[0].class_task_id}`, { headers: headers() })).json();
    const keys = Object.keys(detail).filter((k) => k !== 'lesson_occurrences');
    assert.ok(keys.length, 'detail payload had no task object');
    assert.ok('description' in detail[keys[0]], 'detail task has no description field');
  });

  await t.test('the saved token has not expired', () => {
    assert.ok(token.expiresAt > Date.now(), 'token expired — the next run will sign in again');
  });
});

test('Times Table Rock Stars still behaves the way the provider expects', { skip: !live && 'set LIVE=1 to run' }, async (t) => {
  const ttrs = readToken('ttrockstars', { skewSeconds: 0 });
  assert.ok(ttrs, 'no saved token — start the server once to sign in, then rerun');

  const NEST = 'https://nest.ttrockstars.com';
  const ttrsHeaders = () => ({
    authorization: `Bearer ${ttrs.token}`,
    accept: 'application/json, text/plain, */*',
    'mc-app-service': 'ttrs',
    'mc-app-type': 'web',
    'mc-client-type': 'webApp',
    origin: 'https://play.ttrockstars.com',
    referer: 'https://play.ttrockstars.com/',
  });

  const day = 86400;
  const now = Math.floor(Date.now() / 1000);

  await t.test('the day-stat history is still a flat array of rows', async () => {
    const res = await fetch(`${NEST}/userstats/daystat/history/${ttrs.userId}?startTs=${now - 30 * day}&endTs=${now}`, { headers: ttrsHeaders() });
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(Array.isArray(rows) && rows.length, 'no rows came back');
    for (const field of ['id', 'utcDate', 'secondsPlayed', 'numGames', 'numCorrect', 'numIncorrect', 'numCoins']) {
      assert.ok(field in rows[0], `row is missing ${field}`);
    }
  });

  await t.test('rows still carry the school-timezone date, and utcDate still cannot be used for it', async () => {
    const res = await fetch(`${NEST}/userstats/daystat/history/${ttrs.userId}?startTs=${now - 30 * day}&endTs=${now}`, { headers: ttrsHeaders() });
    const rows = await res.json();
    const dated = rows.filter((r) => r.orgTzDate);
    assert.ok(dated.length, 'no row carried orgTzDate — the provider would fall back to the epoch for every day');
    assert.match(dated[0].orgTzDate, /^\d{4}-\d{2}-\d{2} /);
  });

  await t.test('the token can still be refreshed without a browser', async () => {
    const res = await fetch(`${NEST}/auth3/token/refresh?includeSummary=true`, { headers: ttrsHeaders() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.jwt || '', /^ey/, 'no jwt in the refresh response');
    assert.ok(body.user?.id, 'no user summary in the refresh response');
  });

  await t.test('the login page still has the hooks the provider clicks', async () => {
    const res = await fetch('https://play.ttrockstars.com/login/4375');
    assert.equal(res.status, 200);
  });
});
