import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDataDir, freshImport, stubFetch } from './helpers.mjs';
import * as fx from './fixtures/ttrockstars.mjs';

const load = () => freshImport('../src/providers/ttrockstars.mjs');

/** Puts a valid session on disk so nothing reaches for a browser. */
function giveToken(dir, over = {}) {
  const file = path.join(dir, 'auth', 'ttrockstars.token.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    token: fx.jwt(),
    userId: '20553110',
    student: { id: '20553110', name: 'Alex Paton', rockname: 'Phil Shaddix' },
    expiresAt: Date.now() + 50 * 60 * 1000,
    ...over,
  }));
  return file;
}

const ctxWith = (env = {}) => ({
  params: {},
  env: { TTRS_SCHOOL: '4375', TTRS_USER: 'alepat', TTRS_PASS: '6736', ...env },
  log: () => {},
  withSession: () => { throw new Error('a browser must not be launched when a token is on disk'); },
});

test('a day row is filed under the date the school means', async (t) => {
  tempDataDir(t);
  const { __internals: { rowDate, normaliseDay } } = await load();

  await t.test('the school timezone date is used when it is sent', () => {
    assert.equal(rowDate(fx.dayPlayed), '2026-09-18');
  });

  await t.test('utcDate is never trusted — it is 23:00 the day before through BST', () => {
    assert.equal(fx.dayPlayed.utcDate.slice(0, 10), '2026-09-17', 'fixture must carry the trap');
    assert.notEqual(rowDate(fx.dayPlayed), '2026-09-17');
  });

  await t.test("today's row has no school date, so the epoch supplies it", () => {
    assert.equal(fx.dayToday.orgTzDate, undefined);
    assert.equal(rowDate(fx.dayToday), '2026-09-19');
  });

  await t.test('another timezone files the same epoch under its own date', () => {
    assert.equal(rowDate(fx.dayToday, 'Pacific/Auckland'), '2026-09-19');
    assert.equal(rowDate({ id: 1789772400 - 3600 }, 'Europe/London'), '2026-09-18');
  });

  await t.test('a row with neither date is dropped rather than guessed at', () => {
    assert.equal(rowDate({}), null);
    assert.equal(rowDate(null), null);
  });

  await t.test('normalise carries the numbers the board shows', () => {
    const day = normaliseDay(fx.dayPlayed);
    assert.equal(day.date, '2026-09-18');
    assert.equal(day.weekday, 'Fri');
    assert.equal(day.seconds, 420);
    assert.equal(day.minutes, 7);
    assert.equal(day.games, 3);
    assert.equal(day.correct, 95);
    assert.equal(day.incorrect, 8);
    assert.equal(day.coins, 671);
  });

  await t.test('the per-question average is thousandths of a second', () => {
    assert.equal(normaliseDay(fx.dayPlayed).secondsPerQuestion, 2.88);
    assert.equal(normaliseDay(fx.dayQuiet).secondsPerQuestion, null);
  });

  await t.test('missing numbers read as zero, never NaN', () => {
    const day = normaliseDay({ orgTzDate: '2026-09-18 00:00:00' });
    for (const key of ['seconds', 'minutes', 'games', 'correct', 'incorrect', 'coins']) {
      assert.equal(day[key], 0, `${key} should be 0`);
    }
  });
});

test('minutes are what a parent counts', async (t) => {
  tempDataDir(t);
  const { __internals: { minutesOf, summarise } } = await load();

  await t.test('seconds round to the nearest minute', () => {
    assert.equal(minutesOf(0), 0);
    assert.equal(minutesOf(29), 0);
    assert.equal(minutesOf(31), 1);
    assert.equal(minutesOf(1800), 30);
  });

  await t.test('a week is rounded once at the end, not day by day', () => {
    const days = [{ seconds: 50 }, { seconds: 50 }, { seconds: 50 }].map((d) => ({ ...d, games: 0, correct: 0, incorrect: 0, coins: 0 }));
    // Three 50-second sessions are 2.5 minutes, not three noughts.
    assert.equal(summarise(days).minutes, 3);
  });

  await t.test('totals, days played and accuracy', () => {
    const days = [fx.dayQuiet, fx.dayMinute, fx.dayPlayed].map((r) => ({
      seconds: r.secondsPlayed, games: r.numGames, correct: r.numCorrect, incorrect: r.numIncorrect, coins: r.numCoins,
    }));
    const total = summarise(days);
    assert.equal(total.seconds, 480);
    assert.equal(total.minutes, 8);
    assert.equal(total.games, 4);
    assert.equal(total.correct, 120);
    assert.equal(total.coins, 921);
    assert.equal(total.daysPlayed, 2);
    assert.equal(total.accuracy, 94);
  });

  await t.test('a week with no questions has no accuracy rather than 0%', () => {
    assert.equal(summarise([{ seconds: 0, games: 0, correct: 0, incorrect: 0, coins: 0 }]).accuracy, null);
  });
});

test('the week is seven real dates', async (t) => {
  tempDataDir(t);
  const { __internals: { weekDates, weekOf } } = await load();

  await t.test('Monday to Sunday', () => {
    assert.deepEqual(weekDates('2026-09-14'), [
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ]);
  });

  await t.test('the end of British Summer Time does not swallow a day', () => {
    const week = weekDates('2026-10-26'); // the clocks go back on the 25th
    assert.equal(week.length, 7);
    assert.equal(week.at(-1), '2026-11-01');
    assert.equal(new Set(week).size, 7);
  });

  await t.test('days the school sent nothing for still appear, at zero', () => {
    const days = weekOf('2026-09-14', [{ date: '2026-09-18', weekday: 'Fri', seconds: 420, minutes: 7, games: 3, correct: 95, incorrect: 8, coins: 671 }]);
    assert.equal(days.length, 7);
    assert.equal(days[4].minutes, 7);
    assert.equal(days[0].minutes, 0);
    assert.deepEqual(days.map((d) => d.weekday), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

test('the practice week is the one being practised', async (t) => {
  tempDataDir(t);
  const { __internals: { practiceWeek } } = await load();
  const { schoolWeekOf, mondayOf, todayISO } = await freshImport('../src/dates.mjs');

  await t.test('with no week asked for, it is the week containing today', () => {
    assert.equal(practiceWeek(null), mondayOf(todayISO()));
  });

  await t.test('a weekend does not roll forward the way the homework board does', () => {
    // The board rolls Saturday on to next Monday; practice must not, or a
    // Saturday would report a fresh nought with a day of the week still to run.
    assert.equal(schoolWeekOf('2026-09-19'), '2026-09-21', 'the board rolls forward');
    assert.equal(practiceWeek('2026-09-19'), '2026-09-14', 'practice stays in the week being played');
  });

  await t.test('an explicit week is taken as given, snapped to its Monday', () => {
    assert.equal(practiceWeek('2026-09-16'), '2026-09-14');
    assert.equal(practiceWeek('2026-09-14'), '2026-09-14');
    assert.equal(practiceWeek('2026-09-20'), '2026-09-14', 'Sunday closes the week, it does not open one');
  });
});

test('history asks for a week and gets exactly that week back', async (t) => {
  const dir = tempDataDir(t);
  giveToken(dir);
  const mod = await load();
  const { history } = mod.__internals;

  const calls = stubFetch(t, {
    'daystat/history': { status: 200, body: [fx.dayQuiet, fx.dayMinute, fx.dayPlayed, fx.dayToday] },
  });

  const days = await history(fx.jwt(), '20553110', '2026-09-17', '2026-09-18');

  await t.test('rows outside the range are dropped', () => {
    assert.deepEqual(days.map((d) => d.date), ['2026-09-17', '2026-09-18']);
  });

  await t.test('the window is widened by a day at each end, so no timezone maths is needed', () => {
    const url = new URL(calls[0].url);
    const start = Number(url.searchParams.get('startTs'));
    const end = Number(url.searchParams.get('endTs'));
    assert.ok(start < Date.parse('2026-09-17T00:00:00Z') / 1000, 'start must reach behind the first day');
    assert.ok(end > Date.parse('2026-09-18T23:59:59Z') / 1000, 'end must reach past the last day');
  });

  await t.test('the token travels as a bearer, with the headers the API insists on', () => {
    const headers = calls[0].options.headers;
    assert.match(headers.authorization, /^Bearer /);
    assert.equal(headers['mc-app-service'], 'ttrs');
    assert.equal(headers['mc-client-type'], 'webApp');
    assert.equal(headers.origin, 'https://play.ttrockstars.com');
  });

  await t.test('days come back in date order', async () => {
    stubFetch(t, { 'daystat/history': { status: 200, body: [fx.dayPlayed, fx.dayQuiet, fx.dayMinute] } });
    const out = await history(fx.jwt(), '1', '2026-09-16', '2026-09-18');
    assert.deepEqual(out.map((d) => d.date), ['2026-09-16', '2026-09-17', '2026-09-18']);
  });

  await t.test('a refusal is reported as a bad gateway, not as an empty week', async () => {
    stubFetch(t, { 'daystat/history': { status: 401, body: {} } });
    await assert.rejects(() => history('stale', '1', '2026-09-14', '2026-09-20'), (err) => err.status === 502);
  });
});

test('the saved session is reused, refreshed, and only then re-earned', async (t) => {
  const dir = tempDataDir(t);
  const { __internals: { claims, store, studentOf } } = await load();

  await t.test('expiry comes from the token itself', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const saved = store(fx.jwt({ exp }), fx.user, null);
    assert.equal(saved.expiresAt, exp * 1000);
    assert.equal(saved.userId, '20553110');
    assert.equal(saved.student.name, 'Alex Paton');
  });

  await t.test('an unreadable token still gets an expiry, so it cannot be used for ever', () => {
    assert.deepEqual(claims('not-a-jwt'), {});
    const saved = store('not-a-jwt', null, { userId: '7', student: { name: 'Alex Paton' } });
    assert.ok(saved.expiresAt > Date.now());
    assert.equal(saved.userId, '7', 'what we already knew is kept');
  });

  await t.test('the student summary carries the rock name and coins', () => {
    assert.deepEqual(studentOf(fx.user), {
      id: '20553110', name: 'Alex Paton', rockname: 'Phil Shaddix', coins: 146, totalCoins: 5646,
    });
  });

  await t.test('a token close to expiry is swapped without a browser', async () => {
    giveToken(dir, { expiresAt: Date.now() + 60 * 1000 });
    const fresh = fx.jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const calls = stubFetch(t, {
      'auth3/token/refresh': { status: 200, body: { jwt: fresh, user: fx.user } },
      'daystat/history': { status: 200, body: fx.week },
    });
    const provider = (await load()).default;
    const [metric] = await provider.stats(ctxWith());
    assert.ok(calls.some((c) => c.url.includes('auth3/token/refresh')), 'the refresh endpoint was used');
    assert.ok(metric, 'and the data still arrived');
  });
});

test('the weekly metric is the board-facing shape', async (t) => {
  const dir = tempDataDir(t);
  giveToken(dir);
  stubFetch(t, { 'daystat/history': { status: 200, body: fx.week } });
  const provider = (await load()).default;

  const [metric] = await provider.stats({ ...ctxWith(), params: { week: '2026-09-14' } });

  await t.test('minutes done against minutes expected', () => {
    assert.equal(metric.value, 8);
    assert.equal(metric.target, 30);
    assert.equal(metric.remaining, 22);
    assert.equal(metric.met, false);
    assert.equal(metric.unit, 'min');
  });

  await t.test('it names its week', () => {
    assert.equal(metric.period.start, '2026-09-14');
    assert.equal(metric.period.end, '2026-09-20');
  });

  await t.test('every day of the week is present for the chart', () => {
    assert.equal(metric.days.length, 7);
    assert.equal(metric.days.filter((d) => d.minutes > 0).length, 2);
  });

  await t.test('the detail lines read as numbers a parent can use', () => {
    const detail = Object.fromEntries(metric.detail.map((d) => [d.label, d.value]));
    assert.equal(detail['Days played'], '2 of 7');
    assert.equal(detail.Games, '4');
    assert.match(detail['Questions right'], /^120 \(94%\)$/);
  });

  await t.test('it links back to where the numbers came from', () => {
    assert.match(metric.url, /^https:\/\/play\.ttrockstars\.com\//);
    assert.equal(metric.source ?? 'ttrockstars', 'ttrockstars');
  });

  await t.test('the target is the school\'s expectation, and it is configurable', async () => {
    stubFetch(t, { 'daystat/history': { status: 200, body: fx.week } });
    const [tighter] = await provider.stats({ ...ctxWith({ TTRS_WEEKLY_MINUTES: '5' }), params: { week: '2026-09-14' } });
    assert.equal(tighter.target, 5);
    assert.equal(tighter.met, true, '8 minutes clears a 5 minute target');
    assert.equal(tighter.remaining, 0, 'a met target has nothing left to do');
  });
});
