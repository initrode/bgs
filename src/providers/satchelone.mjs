/**
 * Satchel One (satchelone.com) — homework and to-dos.
 *
 * The web app is a SPA over a JSON API at api.satchelone.com. Playwright is
 * only used to sign in and lift the API token out of the session; everything
 * after that is a plain HTTP call, and the token is good for ~30 days.
 */
import { readToken, writeToken } from '../tokens.mjs';
import { withSession, dismissCookieBanner } from '../browser.mjs';
import { htmlToText, extractLinks } from '../html.mjs';
import { env } from '../config.mjs';
import { isoDate, shiftDays, mondayOf, weekdayOf, schoolWeekOf } from '../dates.mjs';

const ID = 'satchelone';
const WEB = 'https://www.satchelone.com';
const API = 'https://api.satchelone.com/api';

const apiHeaders = (token) => ({
  authorization: `Bearer ${token}`,
  accept: 'application/smhw.v2021.5+json',
  'x-platform': 'web',
  origin: WEB,
  referer: `${WEB}/`,
});


/** Signs in with Playwright and lifts the API token out of localStorage. */
async function loginForToken(ctx) {
  const { SCHOOL, SATCHEL_USER, SATCHEL_PASS } = ctx.env;
  const userType = (ctx.env.SATCHEL_USER_TYPE || 'parent').toLowerCase();
  ctx.log('no valid token — signing in with a browser');

  return withSession(ID, async ({ page, saveSession }) => {
    await page.goto(`${WEB}/v7/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await dismissCookieBanner(page);

    const search = page.locator('#search-filter').first();
    if (await search.count()) {
      await search.click();
      await search.fill(SCHOOL);
      await page.waitForTimeout(2500);
      const needle = SCHOOL.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hit = page.locator('li, [role="option"], [class*="result" i]')
        .filter({ hasText: new RegExp(needle, 'i') }).first();
      if (!(await hit.count())) {
        throw Object.assign(new Error(`No school matched "${SCHOOL}" on the Satchel One login page`), { status: 502 });
      }
      await hit.click();
      await page.waitForTimeout(3000);
    }

    const tab = page.locator('a', { hasText: new RegExp(`^${userType}$`, 'i') }).first();
    if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(1200); }

    await page.locator('#session_username, input[name="session[username]"]').first().fill(SATCHEL_USER);
    await page.locator('#session_password, input[name="session[password]"]').first().fill(SATCHEL_PASS);
    await page.locator('input[type="submit"][value="Login"], button[type="submit"]').first().click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3500);

    if (/\/v7\/login/.test(page.url())) {
      const msg = await page.locator('[class*="error" i], [role="alert"]').first().innerText().catch(() => '');
      throw Object.assign(
        new Error(`Satchel One login failed${msg ? `: ${msg.trim()}` : ' — check credentials or SATCHEL_USER_TYPE'}`),
        { status: 401 }
      );
    }
    await saveSession();

    // Runs inside the page, not this Node process — localStorage is the browser's.
    const raw = await page.evaluate(() => localStorage.getItem('ember_simple_auth-session')); // eslint-disable-line no-undef
    const auth = JSON.parse(raw || '{}').authenticated;
    if (!auth?.smhw_token) throw Object.assign(new Error('Signed in but no API token found in the session'), { status: 502 });

    ctx.log(`signed in as ${auth.user_type} (user ${auth.user_id})`);
    return writeToken(ID, {
      token: auth.smhw_token,
      expiresAt: (auth.created_at + auth.expires_in) * 1000,
      userId: auth.user_id,
      userType: auth.user_type,
      schoolId: auth.school_id,
      obtainedAt: new Date().toISOString(),
    });
  });
}

/** A refresh re-fetches data, not the token — the token is replaced only when it expires. */
async function getToken(ctx) {
  return readToken(ID) || (await loginForToken(ctx));
}

/** One API call, retrying once through a fresh login if the token was rejected. */
async function api(ctx, path, { retry = true } = {}) {
  let auth = await getToken(ctx);
  let res = await fetch(`${API}${path}`, { headers: apiHeaders(auth.token) });

  if ((res.status === 401 || res.status === 403) && retry) {
    ctx.log('token rejected — re-authenticating');
    auth = await loginForToken(ctx);
    res = await fetch(`${API}${path}`, { headers: apiHeaders(auth.token) });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Satchel One API ${res.status} on ${path}${body ? ` — ${body.slice(0, 200)}` : ''}`), { status: 502 });
  }
  return res.json();
}

/** Detail responses key the task by its type, so take whichever one came back. */
function pickTask(payload) {
  const key = Object.keys(payload || {}).find((k) => k !== 'lesson_occurrences' && payload[k] && typeof payload[k] === 'object');
  const task = key ? payload[key] : null;
  if (!task) throw Object.assign(new Error('Unrecognised task payload from Satchel One'), { status: 502 });
  return task;
}

const estimate = (task) => {
  if (!task.duration) return null;
  const units = String(task.duration_units || 'minutes').toLowerCase();
  return units.startsWith('hour') ? task.duration * 60 : task.duration;
};

/** "2026-09-14T08:45:00+01:00" -> "08:45", read as written rather than via UTC. */
const clockTime = (value) => {
  const m = String(value ?? '').match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
};

/** Flattens one timetabled lesson into the shape the board renders. */
function normaliseLesson(lesson) {
  const period = lesson.period || {};
  return {
    id: lesson.id,
    subject: lesson.classGroup?.subject || 'Lesson',
    group: lesson.classGroup?.name || null,
    room: lesson.room || null,
    teacher: lesson.teacher?.name || null,
    startsAt: clockTime(period.startDateTime),
    endsAt: clockTime(period.endDateTime),
    session: period.session || null,
    dueTasks: (lesson.dueClassTasks || []).map((task) => ({
      id: task.id ?? null,
      title: task.title || task.class_task_title || null,
      url: task.id ? `${WEB}/homeworks/${task.id}` : null,
    })),
  };
}

const studentIds = () =>
  String(env.STUDENT_IDS || env.STUDENT_ID || '14768452').split(',').map((s) => s.trim()).filter(Boolean);

async function studentName(ctx, id) {
  try {
    const { student } = await api(ctx, `/students/${id}`);
    return { id: Number(id), name: [student.forename, student.surname].filter(Boolean).join(' '), year: student.year };
  } catch {
    return { id: Number(id), name: `Student ${id}`, year: null };
  }
}

/** Maps a Satchel to-do onto the shared task shape every provider returns. */
function normalise(todo, student) {
  const html = todo.class_task_description || '';
  const description = htmlToText(html);
  // The to-do list carries only a preview, cut at a fixed length and marked
  // with an ellipsis. Test the raw HTML: the cut often lands mid-tag, and
  // stripping that dangling tag takes the ellipsis with it.
  const truncated = /\u2026\s*$/.test(html.trim()) || /\u2026$/.test(description.trim());
  return {
    id: `${ID}:${todo.class_task_id}`,
    source: ID,
    sourceLabel: 'Satchel One',
    sourceId: todo.class_task_id,
    type: todo.class_task_type || 'Homework',
    title: todo.class_task_title || '(untitled)',
    subject: todo.subject || null,
    group: todo.class_group_name || null,
    teacher: todo.teacher_name || null,
    issuedOn: todo.issued_at ? isoDate(todo.issued_at) : null,
    dueOn: todo.due_on ? isoDate(todo.due_on) : null,
    completed: !!todo.completed,
    submissionType: todo.submission_type || null,
    submissionStatus: todo.submission_status || null,
    grade: todo.submission_grade || null,
    hasAttachments: !!todo.has_attachments,
    attachments: [],
    estimateMinutes: null,
    description,
    descriptionHtml: html,
    truncated,
    detailUrl: `/api/${ID}/homework?id=${todo.class_task_id}`,
    links: extractLinks(html),
    student,
    url: `${WEB}/homeworks/${todo.class_task_id}`,
  };
}

/**
 * Detail payloads carry attachment ids, not attachments. One batch call turns
 * a whole task's ids into filenames and CDN urls.
 */
async function resolveAttachments(ctx, ids) {
  if (!ids?.length) return [];
  const qs = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
  const { attachments = [] } = await api(ctx, `/attachments?${qs}`);
  return attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.content_type || null,
    bytes: a.file_size ?? null,
    url: a.file_url,
    previewUrl: a.preview_url || null,
  }));
}

/** Resolves promises `limit` at a time, so enrichment doesn't open 12 sockets at once. */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

/**
 * The to-do list only carries the first ~100 characters of each brief, so the
 * board would show every task cut off mid-sentence. Fill them in from the
 * detail endpoint, keeping the preview for anything that fails.
 */
async function enrich(ctx, tasks) {
  return pool(tasks, 5, async (task) => {
    if (!task.truncated) return task;
    try {
      const detail = pickTask(await api(ctx, `/homeworks/${task.sourceId}`));
      const links = [
        ...extractLinks(detail.description),
        ...(detail.web_links || []).map((l) => ({ url: l.url || l, label: l.title || l.url || 'Link' })),
      ].filter((l, i, a) => a.findIndex((x) => x.url === l.url) === i);
      let attachments = [];
      try {
        attachments = await resolveAttachments(ctx, detail.attachment_ids);
      } catch (err) {
        ctx.log(`could not resolve attachments for ${task.sourceId}: ${err.message}`);
      }

      return {
        ...task,
        description: htmlToText(detail.description),
        descriptionHtml: detail.description,
        truncated: false,
        estimateMinutes: estimate(detail),
        links: links.length ? links : task.links,
        attachments,
      };
    } catch (err) {
      ctx.log(`could not expand ${task.sourceId}: ${err.message}`);
      return task;
    }
  });
}

/** One week of lessons, normalised. Shared by the route and the merged feed. */
async function fetchTimetable(ctx, { student, week }) {
  const auth = await getToken(ctx);
  const schoolId = auth.schoolId || ctx.env.SCHOOL_ID;
  if (!schoolId) throw Object.assign(new Error('No school id on the saved session'), { status: 502 });

  // With no week asked for, show the week a parent would mean today.
  const requestDate = week ? mondayOf(week) : schoolWeekOf(new Date());
  const payload = await api(ctx, `/timetable/school/${schoolId}/student/${student}?requestDate=${requestDate}`);
  const found = payload.weeks?.[0];
  const person = await studentName(ctx, student);
  if (!found) return { student: person, week: null, days: [], lessonCount: 0 };

  const days = (found.days || [])
    .map((day) => ({
      date: day.date,
      weekday: weekdayOf(day.date),
      registrationGroup: day.registration_group || null,
      lessons: (day.lessons || []).map(normaliseLesson)
        .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
    }))
    // Weekends come back empty; keep only days that actually teach.
    .filter((day) => day.lessons.length);

  return {
    student: person,
    week: {
      startDate: found.startDate,
      previousWeek: found.prevWeekStartDate || null,
      nextWeek: found.nextWeekStartDate || null,
    },
    range: { earliest: payload.earliestRequestDate, latest: payload.latestRequestDate },
    lastUpdated: payload.lastUpdated || null,
    days,
    lessonCount: days.reduce((n, d) => n + d.lessons.length, 0),
  };
}

async function fetchTodos(ctx, { student, from, to }) {
  const qs = new URLSearchParams({ add_dateless: 'true', from, to, student_id: String(student) });
  const { todos = [] } = await api(ctx, `/todos?${qs}`);
  return todos;
}

/** Exposed for tests; not part of the provider contract. */
export const __internals = { normalise, pickTask, estimate, enrich, pool, apiHeaders, resolveAttachments, normaliseLesson, clockTime };

export default {
  id: ID,
  label: 'Satchel One',
  credentials: ['SCHOOL', 'SATCHEL_USER', 'SATCHEL_PASS'],

  routes: [
    {
      path: '/todos',
      summary: 'To-do list for one student over a date window',
      ttl: 600,
      params: {
        student: { required: true, env: 'STUDENT_ID', description: 'Satchel student id' },
        from: { default: null, description: 'ISO date, defaults to 30 days ago' },
        to: { default: null, description: 'ISO date, defaults to 120 days ahead' },
      },
      handler: async (ctx) => {
        const from = ctx.params.from || shiftDays(-30);
        const to = ctx.params.to || shiftDays(120);
        const student = await studentName(ctx, ctx.params.student);
        const todos = await fetchTodos(ctx, { student: ctx.params.student, from, to });
        return { student, window: { from, to }, count: todos.length, tasks: todos.map((t) => normalise(t, student)) };
      },
    },
    {
      path: '/homework',
      summary: 'Full detail for one piece of homework',
      ttl: 3600,
      params: { id: { required: true, description: 'Homework id, e.g. 91051927' } },
      handler: async (ctx) => {
        const detail = pickTask(await api(ctx, `/homeworks/${ctx.params.id}`));
        return {
          id: detail.id,
          title: detail.title,
          subject: detail.subject,
          teacher: detail.teacher_name,
          group: detail.class_group_name,
          year: detail.class_year,
          school: detail.school_name,
          issuedOn: detail.issued_at ? isoDate(detail.issued_at) : null,
          dueOn: detail.due_on || null,
          estimateMinutes: estimate(detail),
          submissionType: detail.submission_type || null,
          description: htmlToText(detail.description),
          descriptionHtml: detail.description,
          links: extractLinks(detail.description),
          attachments: await resolveAttachments(ctx, detail.attachment_ids),
          url: `${WEB}/homeworks/${detail.id}`,
        };
      },
    },
    {
      path: '/timetable',
      summary: 'One week of timetabled lessons for a student',
      ttl: 3600,
      params: {
        student: { required: true, env: 'STUDENT_ID', description: 'Satchel student id' },
        week: { default: null, description: 'Any ISO date in the week; defaults to this week' },
      },
      handler: (ctx) => fetchTimetable(ctx, { student: ctx.params.student, week: ctx.params.week }),
    },
    {
      path: '/students',
      summary: 'Students configured for this account',
      ttl: 86400,
      params: {},
      handler: async (ctx) => ({ students: await Promise.all(studentIds().map((id) => studentName(ctx, id))) }),
    },
  ],

  /** Contributes to the merged /api/timetable feed. */
  async timetable(ctx) {
    const [first] = studentIds();
    return fetchTimetable(ctx, { student: ctx.params?.student || first, week: ctx.params?.week });
  },

  /** Contributes to the merged /api/tasks feed. */
  async tasks(ctx) {
    const from = shiftDays(-30);
    const to = shiftDays(120);
    const full = ctx.env.SATCHEL_ENRICH !== '0';
    const out = [];
    for (const id of studentIds()) {
      const student = await studentName(ctx, id);
      const todos = await fetchTodos(ctx, { student: id, from, to });
      const tasks = todos.map((t) => normalise(t, student));
      out.push(...(full ? await enrich(ctx, tasks) : tasks));
    }
    return out;
  },
};
