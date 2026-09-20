/**
 * Pure helpers shared by the board. No DOM, no fetch — everything here takes
 * its inputs explicitly (including "now") so it can be tested directly.
 */

export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Whole days from today to an ISO date; negative is overdue, null if undated. */
export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

export function fmtDate(iso, locale = 'en-GB') {
  if (!iso) return 'No date';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 'No date';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function relative(n) {
  if (n === null || n === undefined) return '';
  if (n < -1) return `${Math.abs(n)} days overdue`;
  if (n === -1) return '1 day overdue';
  if (n === 0) return 'due today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

/** Which heading a task sits under, and how the headings sort. */
export function bucketOf(task, now = new Date()) {
  const n = daysUntil(task.dueOn, now);
  if (n === null) return { key: 'none', label: 'No due date', order: 5 };
  if (n < 0) return { key: 'overdue', label: 'Overdue', order: 0 };
  if (n <= 1) return { key: 'now', label: n === 0 ? 'Due today' : 'Due tomorrow', order: 1 };
  if (n <= 7) return { key: 'week', label: 'This week', order: 2 };
  if (n <= 14) return { key: 'next', label: 'Next week', order: 3 };
  return { key: 'later', label: 'Later', order: 4 };
}

/** How urgent the due chip looks. */
export function urgency(task, now = new Date()) {
  if (task.done) return '';
  const n = daysUntil(task.dueOn, now);
  if (n === null) return '';
  if (n <= 1) return 'is-urgent';
  if (n <= 3) return 'is-warn';
  return '';
}

/**
 * Subjects get a stable hue from their name, so a new subject — or a whole new
 * provider — colours itself. School prefixes are stripped first, so
 * "PD-English" and "English" are the same subject.
 */
export function subjectColour(subject) {
  const s = String(subject || 'general').toLowerCase().replace(/^(pd|ks\d|y\d+)[-\s]+/, '').trim();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} var(--subject-s) var(--subject-l))`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The filter chips, as a predicate. */
export function matchesFilter(task, filter, now = new Date()) {
  if (filter === 'todo') return !task.done;
  if (filter === 'done') return !!task.done;
  if (filter === 'overdue') return !task.done && !!task.dueOn && task.dueOn < todayISO(now);
  return true;
}

/** The numbers in the header strip. */
export function summarise(tasks, now = new Date()) {
  const open = tasks.filter((t) => !t.done);
  return {
    total: tasks.length,
    open: open.length,
    done: tasks.length - open.length,
    overdue: open.filter((t) => t.dueOn && t.dueOn < todayISO(now)).length,
    soon: open.filter((t) => { const n = daysUntil(t.dueOn, now); return n !== null && n >= 0 && n <= 3; }).length,
  };
}

/** Tasks grouped under their headings, in display order. */
export function groupTasks(tasks, now = new Date()) {
  const groups = new Map();
  for (const t of tasks) {
    const b = bucketOf(t, now);
    if (!groups.has(b.key)) groups.set(b.key, { ...b, items: [] });
    groups.get(b.key).items.push(t);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/** Human file size for an attachment row. */
export function fileSize(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A short, readable label for a mime type. */
export function fileKind(contentType = '', filename = '') {
  const type = String(contentType).toLowerCase();
  if (type.startsWith('audio/')) return 'Audio';
  if (type.startsWith('video/')) return 'Video';
  if (type.startsWith('image/')) return 'Image';
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('presentation')) return 'Slides';
  if (type.includes('spreadsheet') || type.includes('excel')) return 'Sheet';
  if (type.includes('word') || type.includes('document')) return 'Doc';
  const ext = String(filename).split('.').pop();
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'File';
}

/** The Monday of the week containing an ISO date. */
export function mondayOf(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Sunday ends the week
  return todayISO(d);
}

/**
 * The week "this week" should show. After Friday the useful week is the next
 * one, so a weekend rolls forward rather than showing days already gone.
 */
export function schoolWeekOf(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay();
  if (day === 0 || day === 6) {
    d.setDate(d.getDate() + (day === 6 ? 2 : 1));
    return todayISO(d);
  }
  return mondayOf(iso);
}

/** "Week of Mon 14 Sep" — the heading above the timetable. */
export function weekLabel(startDate, locale = 'en-GB') {
  if (!startDate) return '';
  return `Week of ${fmtDate(startDate, locale)}`;
}

/** Is this lesson happening right now? */
export function isNow(lesson, now = new Date(), date = null) {
  if (!lesson.startsAt || !lesson.endsAt) return false;
  if (date && date !== todayISO(now)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  return minutes >= toMinutes(lesson.startsAt) && minutes < toMinutes(lesson.endsAt);
}

/** Where a lesson happens, as one readable line. */
export function lessonWhere(lesson) {
  return [lesson.room, lesson.teacher].filter(Boolean).join(' · ');
}

/**
 * Which day the week should open on: today if it is in view, otherwise the
 * next day ahead, and failing that the last day — so a weekend lands on the
 * school day either side rather than on nothing.
 */
export function focusDayIndex(days, now = new Date()) {
  if (!days?.length) return -1;
  const today = todayISO(now);
  const exact = days.findIndex((d) => d.date === today);
  if (exact !== -1) return exact;
  const ahead = days.findIndex((d) => d.date > today);
  if (ahead !== -1) return ahead;
  return days.length - 1;
}

/**
 * Dock-style falloff: the day under the pointer takes the most room and its
 * neighbours taper off, so the week swells around wherever you are looking.
 */
export function dockWeight(distance) {
  const d = Math.abs(distance);
  if (d === 0) return 1.95;
  if (d === 1) return 1.2;
  if (d === 2) return 0.98;
  return 0.9;
}

/** Days away from the focus fade back, so the one in view reads first. */
export function dockOpacity(distance) {
  const d = Math.abs(distance);
  if (d === 0) return 1;
  if (d === 1) return 0.68;
  if (d === 2) return 0.5;
  return 0.42;
}

/** "PD-English" and "English" are the same subject on both tabs. */
export function subjectKey(subject) {
  return String(subject || '').toLowerCase().replace(/^(pd|ks\d|y\d+)[-\s]+/, '').trim();
}

/** PE, games and inter-school fixtures — anything that means kit, not books. */
const PE_SUBJECT = /\b(pe|physical education|games|sports?|fixtures?)\b/;

export function isPeSubject(subject) {
  return PE_SUBJECT.test(String(subject || '').toLowerCase().replace(/\./g, ''));
}

/** A day needs kit if any lesson on it is PE, games or a sports fixture. */
export const needsPeKit = (day) => (day.lessons || []).some((l) => isPeSubject(l.subject));

export const markPeKit = (days = []) => days.map((day) => ({ ...day, peKit: needsPeKit(day) }));

/** Swimming gets its own kit call-out — a towel and trunks, not a PE kit. */
const SWIM_SUBJECT = /\bswim(?:ming)?\b/;

export function isSwimSubject(subject) {
  return SWIM_SUBJECT.test(String(subject || '').toLowerCase().replace(/\./g, ''));
}

export const needsSwimKit = (day) => (day.lessons || []).some((l) => isSwimSubject(l.subject));

export const markSwimKit = (days = []) => days.map((day) => ({ ...day, swimKit: needsSwimKit(day) }));

/**
 * Marks the lessons a piece of homework is due in, matching on due date and
 * subject. Where a subject is taught twice in a day the first lesson takes it,
 * which is the one a pupil needs the work with them for.
 */
export function attachHomework(days, tasks = []) {
  const pending = tasks.filter((t) => !t.done && t.dueOn);

  return days.map((day) => {
    const dueToday = pending.filter((t) => t.dueOn === day.date);
    const claimed = new Set();

    const lessons = day.lessons.map((lesson) => {
      const key = subjectKey(lesson.subject);
      const homework = dueToday.filter((t) => subjectKey(t.subject) === key && !claimed.has(t.id));
      homework.forEach((t) => claimed.add(t.id));
      return homework.length ? { ...lesson, homework } : { ...lesson, homework: [] };
    });

    // Anything with no lesson to sit in is still due that day.
    const unplaced = dueToday.filter((t) => !claimed.has(t.id));
    return { ...day, lessons, unplacedHomework: unplaced };
  });
}

/* ---- routing ---- */

/**
 * Each view has its own url. The path is the single source of truth for which
 * one is on screen, so a refresh or a shared link opens the same page.
 */
export const VIEWS = { '/': 'homework', '/timetable': 'timetable', '/termdates': 'termdates' };

export function viewForPath(pathname = '/') {
  const clean = String(pathname).split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return VIEWS[clean] || 'homework';
}

export const pathForView = (view) =>
  Object.keys(VIEWS).find((p) => VIEWS[p] === view) || '/';

/* ---- practice targets ---- */

/**
 * Progress towards a target, as a percentage the bar can be drawn at.
 * Overshooting is capped at 100 so the bar never runs off its track, but the
 * number beside it still reports what was actually done.
 */
export function progressPct(value, target) {
  const done = Number(value) || 0;
  const goal = Number(target) || 0;
  if (goal <= 0) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / goal) * 100)));
}

/** "8 of 30 min" — the two numbers a parent actually wants. */
export const targetLabel = (m) => `${Number(m.value) || 0} of ${Number(m.target) || 0} ${m.unit || ''}`.trim();

/** What is left, or that there is nothing left. */
export function remainingLabel(m) {
  const left = Math.max(0, (Number(m.target) || 0) - (Number(m.value) || 0));
  if (!left) return 'Target met';
  return `${left} ${m.unit || ''} to go`.trim();
}

/** A week as one line: "Mon 14 – Sun 20 Sept". */
export function periodLabel(period = {}) {
  if (!period.start) return '';
  const from = fmtDate(period.start);
  const to = fmtDate(period.end || period.start);
  if (!period.end || period.end === period.start) return from;
  return `${from} – ${to}`;
}

/**
 * Where a practice figure sits on the red–amber–green spectrum, as a hue.
 * The bands are fractions of the target rather than fixed minutes, so a
 * different target keeps the same meaning: the first third is behind (red),
 * the rest is on the way (amber), and meeting it is green.
 */
export function toneHue(value, target) {
  const done = Math.max(0, Number(value) || 0);
  const goal = Number(target) || 0;
  const lerp = (from, to, t) => Math.round(from + (to - from) * Math.min(1, Math.max(0, t)));

  if (goal <= 0) return done > 0 ? 146 : 6;
  if (done >= goal) return 146;

  const share = done / goal;
  const behind = 1 / 3;
  return share <= behind
    ? lerp(4, 24, share / behind)                    // nothing done → red, warming
    : lerp(30, 46, (share - behind) / (1 - behind)); // on the way → amber, brightening
}

/* ---- closures ---- */

/** The closure covering a date, or null. Dates are compared as strings. */
export const closureOn = (date, closures = []) =>
  closures.find((c) => c.start <= date && c.end >= date) || null;

/** Tags each timetable day with the closure that shuts it, if any. */
export const markClosures = (days = [], closures = []) =>
  days.map((day) => ({ ...day, closure: closureOn(day.date, closures) }));

/** Whether a date is a day school actually happens: not a weekend, not a closure. */
export function isSchoolDay(iso, closures = []) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  if (day === 0 || day === 6) return false;
  return !closureOn(iso, closures);
}

/**
 * School days left to do a piece of work — weekends and closures removed.
 * Counts the days it can be worked on at school, so the due date itself is
 * excluded: work due Monday cannot be done in Monday's lesson.
 */
export function schoolDaysUntil(dueOn, closures = [], now = new Date()) {
  if (!dueOn) return null;
  const today = todayISO(now);
  if (dueOn <= today) return 0;
  let count = 0;
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 0; i < 400; i += 1) {
    const date = new Date(y, m - 1, d + i);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (iso >= dueOn) break;
    if (isSchoolDay(iso, closures)) count += 1;
  }
  return count;
}

/**
 * The closure sitting between today and a due date. This is the one that
 * catches people out: a week of homework and a half term in the middle of it.
 */
export function breakBefore(dueOn, closures = [], now = new Date()) {
  if (!dueOn) return null;
  const today = todayISO(now);
  if (dueOn <= today) return null;
  return closures.find((c) => c.end >= today && c.start < dueOn) || null;
}

/** The next closure that has not finished, decorated for display. */
export function nextClosure(closures = [], now = new Date()) {
  const today = todayISO(now);
  return closures.find((c) => c.end >= today) || null;
}

/** "Fri 25 Sept" for one day, "Mon 19 – Fri 30 Oct" for a span. */
export function closureDates(closure) {
  if (!closure) return '';
  if (closure.start === closure.end) return fmtDate(closure.start);
  return `${fmtDate(closure.start)} – ${fmtDate(closure.end)}`;
}

/**
 * How far off a closure is. One already gone says nothing — the dimming
 * carries that, and "passed" is a word on screen doing no work.
 */
export function closureWhen(closure, now = new Date()) {
  if (!closure) return '';
  const today = todayISO(now);
  if (closure.end < today) return '';
  if (closure.start <= today) return 'On now';
  const days = daysUntil(closure.start, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}
