/**
 * Times Table Rock Stars — how much maths practice has actually been done.
 *
 * The browser is used once, to log in. Everything after that is the same JSON
 * API the site's own SPA calls, so a week of stats is two HTTP requests.
 *
 *   login (browser, ~15s)  -> jwt, valid one hour
 *   /auth3/token/refresh   -> a new hour, no browser
 *   /userstats/daystat/history/<userId>?startTs&endTs -> one row per day
 */
import { readToken, writeToken } from '../tokens.mjs';
import { mondayOf, todayISO, weekdayOf, localISO } from '../dates.mjs';

const ID = 'ttrockstars';
const PLAY = 'https://play.ttrockstars.com';
const NEST = 'https://nest.ttrockstars.com';
const STATS_URL = `${PLAY}/school/student/account/details?t=stats`;

/** Sent as mc-app-version. The API accepts any recent build string. */
const APP_VERSION = '4.26.0918.1235';

/** Minutes of practice a week the school expects. */
const DEFAULT_TARGET = 30;

const apiHeaders = (token) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-GB',
  'mc-app-service': 'ttrs',
  'mc-app-type': 'web',
  'mc-app-version': APP_VERSION,
  'mc-client-type': 'webApp',
  origin: PLAY,
  referer: `${PLAY}/`,
});

/** The middle segment of a JWT, without verifying it — we only want its claims. */
function claims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * The date a day row belongs to, as the school's own timezone sees it.
 * Today's row arrives without orgTzDate, so fall back to its start-of-day
 * epoch — never to utcDate, which is 23:00 the day before through British
 * Summer Time and would file every summer session under the wrong day.
 */
function rowDate(row, timeZone = 'Europe/London') {
  if (typeof row?.orgTzDate === 'string') return row.orgTzDate.slice(0, 10);
  if (!row?.id) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(row.id * 1000));
}

/** Seconds of play, rounded the way a parent counts them. */
const minutesOf = (seconds) => Math.round((Number(seconds) || 0) / 60);

/** One day of practice, in the shape the board renders. */
function normaliseDay(row, timeZone) {
  const date = rowDate(row, timeZone);
  const seconds = Number(row.secondsPlayed) || 0;
  return {
    date,
    weekday: date ? weekdayOf(date, 'en-GB', 'short') : null,
    seconds,
    minutes: minutesOf(seconds),
    games: Number(row.numGames) || 0,
    correct: Number(row.numCorrect) || 0,
    incorrect: Number(row.numIncorrect) || 0,
    coins: Number(row.numCoins) || 0,
    // The API reports thousandths of a second per question.
    secondsPerQuestion: row.average ? Number((row.average / 1000).toFixed(2)) : null,
  };
}

/** Monday to Sunday as ISO dates, by calendar arithmetic rather than by adding milliseconds. */
function weekDates(monday) {
  const [y, m, d] = String(monday).split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => localISO(new Date(y, m - 1, d + i)));
}

/** Every day of the week, whether or not the school sent a row for each. */
function weekOf(monday, days) {
  const byDate = new Map(days.filter((d) => d.date).map((d) => [d.date, d]));
  return weekDates(monday).map((date) => byDate.get(date) || {
    date,
    weekday: weekdayOf(date, 'en-GB', 'short'),
    seconds: 0, minutes: 0, games: 0, correct: 0, incorrect: 0, coins: 0,
    secondsPerQuestion: null,
  });
}

/** Totals for a run of days. Minutes are rounded once, at the end. */
function summarise(days) {
  const seconds = days.reduce((n, d) => n + d.seconds, 0);
  const correct = days.reduce((n, d) => n + d.correct, 0);
  const incorrect = days.reduce((n, d) => n + d.incorrect, 0);
  return {
    seconds,
    minutes: minutesOf(seconds),
    games: days.reduce((n, d) => n + d.games, 0),
    correct,
    incorrect,
    coins: days.reduce((n, d) => n + d.coins, 0),
    daysPlayed: days.filter((d) => d.seconds > 0).length,
    accuracy: correct + incorrect ? Math.round((correct / (correct + incorrect)) * 100) : null,
  };
}

/* ---- session ---- */

/**
 * Logs in the way a child does: username, then the PIN keypad. The app is an
 * Angular SPA that never boots while navigator.webdriver is set, so the flag
 * is cleared before the page loads — otherwise the login screen never paints.
 */
async function login(ctx) {
  const school = ctx.env.TTRS_SCHOOL;
  const pin = String(ctx.env.TTRS_PASS);
  if (!/^\d{4}$/.test(pin)) {
    throw Object.assign(new Error('TTRS_PASS must be the four-digit PIN'), { status: 503 });
  }

  return ctx.withSession(async ({ page, context, saveSession }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.goto(`${PLAY}/login/${school}`, { waitUntil: 'domcontentloaded' });

    // A saved browser session may still be signed in, in which case the app
    // goes straight to the game and there is no form to fill. Wait for
    // whichever arrives first. The login screen is itself under
    // /auth/school/student/..., so only a path starting /school/student
    // means we are through.
    const never = () => new Promise(() => {});
    const landed = await Promise.race([
      page.waitForSelector('input[data-qa="username-input"]', { timeout: 45000 }).then(() => 'form', never),
      page.waitForURL((url) => /^\/school\/student\//.test(url.pathname), { timeout: 45000 }).then(() => 'home', never),
    ]);

    if (landed === 'form') {
      await page.fill('input[data-qa="username-input"]', ctx.env.TTRS_USER);
      await page.click('button[aria-label="Select pin password type"]');
      await page.waitForSelector('.key-pin[aria-label="1"]', { timeout: 20000 });
      for (const digit of pin) {
        await page.click(`.key-pin[aria-label="${digit}"]`);
        await page.waitForTimeout(120);
      }
      await page.click('.key-pin[aria-label="Enter"]');
      await page
        .waitForURL((url) => /^\/school\/student\//.test(url.pathname), { timeout: 45000 })
        .catch(() => {});
    }

    const jwt = (await context.cookies()).find((c) => c.name === 'jwt')?.value;
    if (!jwt) {
      throw Object.assign(new Error('Signed in but Times Table Rock Stars issued no token — check the username and PIN'), { status: 502 });
    }
    await saveSession();
    return jwt;
  });
}

/** Swaps a still-valid token for a fresh hour, and picks up the user summary. */
async function refresh(token, fetcher = fetch) {
  const res = await fetcher(`${NEST}/auth3/token/refresh?includeSummary=true`, { headers: apiHeaders(token) });
  if (!res.ok) throw Object.assign(new Error(`Could not refresh the Rock Stars session (HTTP ${res.status})`), { status: 502 });
  return res.json();
}

const studentOf = (user = {}) => ({
  id: user.id ? String(user.id) : null,
  name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
  rockname: user.ttrs?.rockname || null,
  coins: user.ttrs?.coins ?? null,
  totalCoins: user.ttrs?.totalCoins ?? null,
});

/**
 * A usable token, at the smallest cost available: the saved one if it has
 * time left, a refresh of it if it is about to run out, a browser login only
 * when there is nothing left to refresh.
 */
async function session(ctx, { fetcher = fetch } = {}) {
  const valid = readToken(ID, { skewSeconds: 300 });
  if (valid?.token) return valid;

  const stale = readToken(ID, { skewSeconds: 0 });
  if (stale?.token) {
    try {
      const payload = await refresh(stale.token, fetcher);
      return writeToken(ID, store(payload.jwt, payload.user, stale));
    } catch {
      ctx.log?.('token refresh failed, signing in again');
    }
  }

  const jwt = await login(ctx);
  const payload = await refresh(jwt, fetcher).catch(() => ({ jwt }));
  return writeToken(ID, store(payload.jwt || jwt, payload.user, null));
}

function store(jwt, user, previous) {
  const { sub, exp } = claims(jwt);
  return {
    token: jwt,
    userId: sub ? String(sub) : previous?.userId || null,
    student: user ? studentOf(user) : previous?.student || null,
    expiresAt: exp ? exp * 1000 : Date.now() + 55 * 60 * 1000,
  };
}

/* ---- data ---- */

const epoch = (iso, endOfDay = false) =>
  Math.floor(Date.parse(`${iso}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) / 1000);

/**
 * Daily rows between two dates. The window is widened by a day at each end
 * and the rows filtered by their own date, so no timezone arithmetic is
 * needed to ask for "this week" and get exactly this week back.
 */
async function history(token, userId, from, to, { fetcher = fetch, timeZone } = {}) {
  const url = `${NEST}/userstats/daystat/history/${userId}?startTs=${epoch(from) - 86400}&endTs=${epoch(to, true) + 86400}`;
  const res = await fetcher(url, { headers: apiHeaders(token) });
  if (!res.ok) throw Object.assign(new Error(`Times Table Rock Stars refused the stats request (HTTP ${res.status})`), { status: 502 });
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normaliseDay(row, timeZone))
    .filter((d) => d.date && d.date >= from && d.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The week being practised, which is the one containing today — not the
 * homework board's "school week". A Saturday still counts towards the 30
 * minutes; rolling forward would report a fresh zero with a day left to play.
 */
const practiceWeek = (week) => (week ? mondayOf(week) : mondayOf(todayISO()));

async function weekStats(ctx, { fetcher = fetch } = {}) {
  const timeZone = ctx.env.TTRS_TIMEZONE || 'Europe/London';
  const target = Number(ctx.env.TTRS_WEEKLY_MINUTES || DEFAULT_TARGET);
  const { token, userId, student } = await session(ctx, { fetcher });

  const monday = practiceWeek(ctx.params?.week);
  const sunday = weekDates(monday).at(-1);
  const days = weekOf(monday, await history(token, userId, monday, sunday, { fetcher, timeZone }));
  const totals = summarise(days);

  return {
    student,
    week: { startDate: monday, endDate: sunday },
    target,
    ...totals,
    remaining: Math.max(0, target - totals.minutes),
    met: totals.minutes >= target,
    days,
    url: STATS_URL,
  };
}

export const __internals = { rowDate, normaliseDay, weekOf, weekDates, summarise, minutesOf, claims, apiHeaders, history, practiceWeek, store, studentOf };

export default {
  id: ID,
  label: 'Times Table Rock Stars',
  credentials: ['TTRS_SCHOOL', 'TTRS_USER', 'TTRS_PASS'],

  routes: [
    {
      path: '/stats',
      summary: 'Minutes practised this week against the weekly target',
      ttl: 900,
      params: {
        week: { required: false, description: 'Monday of the week, YYYY-MM-DD' },
      },
      handler: (ctx) => weekStats(ctx),
    },
    {
      path: '/history',
      summary: 'One row per day: minutes, games, questions, coins',
      ttl: 900,
      params: {
        from: { required: false, description: 'First date, YYYY-MM-DD' },
        to: { required: false, description: 'Last date, YYYY-MM-DD' },
      },
      async handler(ctx) {
        const timeZone = ctx.env.TTRS_TIMEZONE || 'Europe/London';
        const { token, userId } = await session(ctx);
        const to = ctx.params.to || todayISO();
        const from = ctx.params.from || mondayOf(to);
        const days = await history(token, userId, from, to, { timeZone });
        return { from, to, days, ...summarise(days) };
      },
    },
    {
      path: '/student',
      summary: 'Who the account belongs to, plus coins earned',
      ttl: 3600,
      async handler(ctx) {
        const { student, userId, expiresAt } = await session(ctx);
        return { ...student, userId, sessionExpiresAt: new Date(expiresAt).toISOString() };
      },
    },
  ],

  /**
   * Practice is not a task with a due date, so it joins the board as a
   * measured target rather than a card: minutes done against minutes expected.
   */
  async stats(ctx) {
    const week = await weekStats(ctx);
    return [{
      id: `${ID}:weekly-minutes`,
      label: 'Times Table Rock Stars',
      shortLabel: 'TT Rock Stars',
      subject: 'Maths',
      value: week.minutes,
      target: week.target,
      unit: 'min',
      met: week.met,
      remaining: week.remaining,
      period: { start: week.week.startDate, end: week.week.endDate, label: 'This week' },
      days: week.days,
      detail: [
        { label: 'Days played', value: `${week.daysPlayed} of 7` },
        { label: 'Games', value: String(week.games) },
        { label: 'Questions right', value: week.accuracy === null ? '—' : `${week.correct} (${week.accuracy}%)` },
        { label: 'Coins earned', value: week.coins.toLocaleString('en-GB') },
      ],
      student: week.student,
      url: STATS_URL,
    }];
  },
};
