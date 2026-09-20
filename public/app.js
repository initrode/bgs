/* Homework board — renders the merged /api/tasks feed. */
import {
  daysUntil, fmtDate, relative, urgency, subjectColour,
  esc, matchesFilter, summarise, groupTasks, fileSize, fileKind,
  todayISO, weekLabel, isNow, lessonWhere, focusDayIndex, dockWeight,
  dockOpacity, attachHomework, schoolWeekOf, viewForPath, pathForView,
  progressPct, targetLabel, remainingLabel, periodLabel, toneHue,
  markClosures, closureDates, closureWhen, nextClosure, breakBefore, schoolDaysUntil, markPeKit,
  markSwimKit,
} from './task-utils.js';

const $ = (sel) => document.querySelector(sel);
const board = $('#board');

let tasks = [];
let sources = [];
let filter = 'todo';
let tab = viewForPath(location.pathname);   // the url decides which view is on screen
let week = null;      // Monday of the week on screen; null means this week
let timetable = null;
let restingDay = -1;  // the day the week settles back to when the pointer leaves
let homeworkByLesson = new Map();
let metrics = [];
let closures = [];      // static term dates, from /closures.json
let termDates = null;
let statSources = [];

const wideEnoughToDock = () => window.matchMedia('(min-width: 900px)').matches;

const visible = () => tasks.filter((t) => matchesFilter(t, filter));

function renderStats() {
  const s = summarise(tasks);
  $('#n-overdue').textContent = s.overdue;
  $('#n-soon').textContent = s.soon;
  $('#n-open').textContent = s.open;
  $('#n-done').textContent = s.done;
  $('#n-overdue').parentElement.classList.toggle('is-urgent', s.overdue > 0);
  $('#n-soon').parentElement.classList.toggle('is-warn', s.soon > 0);
  $('#stats').hidden = false;
  $('#filters').hidden = false;
}

/**
 * Practice measured against a target — Rock Stars minutes, and anything else a
 * provider chooses to publish. Cumulative for the week, not a task to tick.
 */
function renderPractice() {
  const host = $('#practice');
  if (!metrics.length) { host.hidden = true; host.innerHTML = ''; return; }

  host.innerHTML = metrics.map((m) => {
    const pct = progressPct(m.value, m.target);
    return `
      <article class="practice-card${m.met ? ' is-met' : ''}" style="--tone:${toneHue(m.value, m.target)}">
        <div class="practice-head">
          <div>
            <h3>${esc(m.shortLabel || m.label)}</h3>
            <p class="practice-when">${esc(m.period?.label || 'This week')} · ${esc(periodLabel(m.period))}</p>
          </div>
          <p class="practice-figure"><b>${esc(targetLabel(m))}</b><span>${esc(remainingLabel(m))}</span></p>
        </div>
        <div class="track" role="img" aria-label="${pct}% of the weekly target">
          <span class="track-fill" style="width:${pct}%"></span>
        </div>
        <p class="practice-detail">
          ${(m.detail || []).map((d) => `<span><b>${esc(d.value)}</b> ${esc(d.label.toLowerCase())}</span>`).join('')}
          ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">Show original</a>` : ''}
        </p>
      </article>`;
  }).join('');
  host.hidden = false;
}

/**
 * Term dates are static: the school publishes them once a year as a flat
 * image, so they live in public/closures.json and are read straight from
 * there. No provider, no API, no cache to go stale.
 */
async function loadClosures() {
  if (termDates) return;
  try {
    const res = await fetch('/closures.json');
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    termDates = await res.json();
    closures = termDates.closures || [];
  } catch {
    termDates = null;
    closures = [];
  }
}

function renderClosures() {
  const host = document.getElementById('closures');
  if (!closures.length) { host.hidden = true; host.innerHTML = ''; return; }

  const today = todayISO();
  const next = nextClosure(closures);
  const rows = closures.map((c) => {
    const when = closureWhen(c);
    const isNext = next && c.start === next.start;
    return `
      <li class="closure${c.end < today ? ' is-past' : ''}${isNext ? ' is-next' : ''}" data-kind="${esc(c.kind)}">
        <span class="closure-when">${esc(when)}</span>
        <span class="closure-dates">${esc(closureDates(c))}</span>
        <span class="closure-what">
          ${esc(c.label)}
          ${c.note ? `<span class="closure-note">${esc(c.note)}</span>` : ''}
        </span>
      </li>`;
  }).join('');

  host.innerHTML = `
    <div class="closure-card">
      <div class="closure-head">
        <h3>School closures</h3>
        <p class="closure-sub">${esc(termDates.school)} · ${esc(termDates.year)}</p>
      </div>
      <ol class="closure-list">${rows}</ol>
      <p class="closure-foot">
        <span>Typed from the school's term dates sheet on ${esc(fmtDate(termDates.source.transcribedOn))} — edit <code>public/closures.json</code> when a new one is issued.</span>
        <a href="${esc(termDates.source.page)}" target="_blank" rel="noopener">Show original</a>
      </p>
    </div>`;
  host.hidden = false;
}

async function loadStats({ refresh = false } = {}) {
  try {
    const res = await fetch(`/api/stats${refresh ? '?refresh=1' : ''}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
    metrics = payload.metrics || [];
    // The footer counts what each source contributed; these are targets, not tasks.
    statSources = (payload.sources || []).map((s) => ({ ...s, unit: 'target' }));
  } catch (err) {
    metrics = [];
    statSources = [{ label: 'Practice', ok: false, error: err.message, unit: 'target' }];
  }
  renderPractice();
}

function taskCard(t) {
  const n = daysUntil(t.dueOn);
  const clip = (t.description || '').length > 190 && !t.expanded;
  const needsFetch = t.truncated && t.detailUrl;

  const meta = [t.subject, t.group, t.teacher].filter(Boolean);
  const subline = meta.length
    ? `${esc(meta[0])}${meta.slice(1).map((m) => `<span class="sep">/</span><span class="plain">${esc(m)}</span>`).join('')}`
    : '<span class="plain">No subject</span>';

  return `
    <article class="task${t.done ? ' is-done' : ''}" style="--subject:${subjectColour(t.subject)}" data-id="${esc(t.id)}">
      <div class="rail"></div>
      <div class="body">
        <div class="task-top">
          <input class="tick" type="checkbox" id="tick-${esc(t.id)}" ${t.done ? 'checked' : ''}
                 aria-label="Mark ${esc(t.title)} as done">
          <div class="task-heading">
            <h3 class="task-title">${esc(t.title)}</h3>
            <p class="task-sub">${subline}</p>
          </div>
          <span class="due ${urgency(t)}"><b>${esc(fmtDate(t.dueOn))}</b>${n !== null ? ` ${esc(relative(n))}` : ''}</span>
        </div>
        ${breakNote(t)}
        ${t.description ? `<p class="task-desc${clip ? ' is-clipped' : ''}">${esc(t.description)}</p>` : ''}
        ${needsFetch ? '<button class="more" type="button" data-fetch="1">Show full brief</button>'
          : clip ? '<button class="more" type="button">Show more</button>'
          : t.expanded ? '<button class="more" type="button">Show less</button>' : ''}
        ${attachmentBlock(t)}
        ${t.url ? `<div class="task-foot"><a href="${esc(t.url)}" target="_blank" rel="noopener">Show original</a></div>` : ''}
      </div>
    </article>`;
}

/**
 * A holiday between now and the due date is what catches people out: a fortnight
 * of calendar time can be two days of school. Said only when the time left is
 * genuinely short — a staff day three weeks ahead of a deadline is not a
 * warning, it is noise.
 */
const SQUEEZED = 5;

function breakNote(t) {
  if (t.done || !t.dueOn) return '';
  const gap = breakBefore(t.dueOn, closures);
  if (!gap) return '';
  const left = schoolDaysUntil(t.dueOn, closures);
  if (left > SQUEEZED) return '';
  return `<p class="task-warn"><b>${esc(gap.label)}</b> first — ${left === 0 ? 'no school days' : `only ${left} school day${left === 1 ? '' : 's'}`} left to do it</p>`;
}

/** Files the teacher attached — playable or openable once saved locally. */
function attachmentBlock(t) {
  const files = t.attachments || [];
  if (!files.length) return '';
  const pending = files.filter((f) => !f.downloaded).length;

  const rows = files.map((f) => `
    <li class="file">
      <span class="file-kind">${esc(fileKind(f.contentType, f.filename))}</span>
      <span class="file-name">${f.downloaded
        ? `<a href="${esc(f.localUrl)}" target="_blank" rel="noopener">${esc(f.filename)}</a>`
        : esc(f.filename)}</span>
      <span class="file-size">${esc(fileSize(f.bytes))}</span>
    </li>`).join('');

  return `
    <div class="files">
      <ul class="file-list">${rows}</ul>
      ${pending
        ? `<button class="more file-get" type="button" data-download="${esc(t.id)}">Save ${pending} file${pending === 1 ? '' : 's'} to this machine</button>`
        : '<p class="file-done">Saved on this machine</p>'}
    </div>`;
}

function render() {
  const list = visible();
  renderStats();

  if (!list.length) {
    board.innerHTML = `<p class="empty">Nothing here. ${filter === 'todo' ? 'Everything is ticked off.' : 'Try a different filter.'}</p>`;
    return;
  }

  board.innerHTML = groupTasks(list)
    .map((g) => `
      <section class="group${g.key === 'overdue' ? ' is-overdue' : ''}">
        <div class="group-head">
          <h2>${esc(g.label)}</h2>
          <span class="count">${g.items.length}</span>
          <span class="rule"></span>
        </div>
        <div class="group-list">${g.items.map(taskCard).join('')}</div>
      </section>`)
    .join('');
}

function renderFoot(payload) {
  const when = new Date(payload.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const lines = [...sources, ...statSources].map((s) =>
    s.ok
      ? `${s.label}: ${s.count} ${s.unit || 'task'}${s.count === 1 ? '' : 's'}${s.skipped ? ` (skipped — ${s.skipped})` : ''}`
      : `<span class="bad">${esc(s.label)}: ${esc(s.error)}</span>`
  );
  $('#foot').innerHTML = `${lines.join('<br>')}<br>Updated ${when} · <a href="/api">API index</a>`;
}

async function load({ refresh = false } = {}) {
  const btn = $('#refresh');
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.classList.remove('is-error');
  $('#refresh-label').textContent = refresh ? 'Scraping…' : 'Loading…';

  try {
    const res = await fetch(`/api/tasks${refresh ? '?refresh=1' : ''}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);

    tasks = payload.tasks || [];
    sources = payload.sources || [];


    updateHeading();
    render();
    renderFoot(payload);
    if (tab === 'timetable' && timetable) renderTimetable();
    // Practice is a separate feed: a school system being down must not take
    // the homework board with it.
    loadStats({ refresh }).then(() => renderFoot(payload));
  } catch (err) {
    btn.classList.add('is-error');
    board.innerHTML = `<div class="error"><strong>Could not load tasks.</strong><br>
      <code>${esc(err.message)}</code><br><br>
      Check the server console. If this is a credentials problem, add them to <code>~/.satchel.env</code> and refresh.</div>`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    $('#refresh-label').textContent = 'Refresh';
  }
}

/* ---- timetable ---- */

/** Sizes each day column by its distance from the one in focus. */
function dockTo(index) {
  const columns = [...document.querySelectorAll('.day')];
  const docking = wideEnoughToDock();

  columns.forEach((column, i) => {
    if (docking) {
      column.style.flexGrow = String(dockWeight(i - index));
      column.style.opacity = String(dockOpacity(i - index));
    } else {
      // Stacked on a narrow screen, where growing would stretch heights.
      column.style.removeProperty('flex-grow');
      column.style.removeProperty('opacity');
    }
    column.classList.toggle('is-focus', docking && i === index);
  });
}

function renderTimetable() {
  const host = document.getElementById('timetable');
  if (!timetable) return;

  document.getElementById('week-label').textContent = weekLabel(timetable.week?.startDate);
  document.getElementById('week-prev').disabled = !timetable.week?.previousWeek;
  document.getElementById('week-next').disabled = !timetable.week?.nextWeek;

  if (!timetable.days.length) {
    host.innerHTML = '<p class="empty">No lessons timetabled this week.</p>';
    return;
  }

  const today = todayISO();
  restingDay = focusDayIndex(timetable.days);
  const days = markSwimKit(markPeKit(markClosures(attachHomework(timetable.days, tasks), closures)));

  host.innerHTML = days.map((day, index) => `
    <section class="day${day.date === today ? ' is-today' : ''}${day.closure ? ' is-closed' : ''}${day.peKit ? ' is-pe' : ''}${day.swimKit ? ' is-swim' : ''}" data-index="${index}" tabindex="0">
      <div class="day-head">
        <span class="day-name">${esc(day.weekday)}</span>
        ${day.peKit ? '<span class="pe-badge" title="A PE, games or fixture lesson today">🎽 PE Kit Required</span>' : ''}
        ${day.swimKit ? '<span class="swim-badge" title="A swimming lesson today">🏊 Swimming Kit Required</span>' : ''}
        <span class="day-date">${day.date === today ? '<span class="today-dot"></span>' : ''}${esc(fmtDate(day.date).replace(/^\w+ /, ''))}</span>
      </div>
      ${day.closure ? `<p class="day-closed">Closed<span>${esc(day.closure.label)}</span></p>` : ''}
      <ul class="lessons">
        ${day.lessons.map((lesson) => `
          <li class="lesson${isNow(lesson, new Date(), day.date) ? ' is-now' : ''}" style="--subject:${subjectColour(lesson.subject)}">
            <div class="lesson-time">${esc(lesson.startsAt)}–${esc(lesson.endsAt)}</div>
            <div class="lesson-subject">${esc(lesson.subject)}</div>
            ${lessonWhere(lesson) ? `<div class="lesson-where">${esc(lessonWhere(lesson))}</div>` : ''}
            ${lesson.homework?.length
              ? `<button class="hw-badge" type="button" data-day="${esc(day.date)}" data-lesson="${esc(lesson.id)}"
                         aria-label="${lesson.homework.length} homework due in this lesson">H</button>`
              : ''}
          </li>`).join('')}
      </ul>
      ${day.unplacedHomework?.length
        ? `<p class="day-extra"><button class="hw-badge" type="button" data-day="${esc(day.date)}" data-lesson="none"
             aria-label="${day.unplacedHomework.length} homework due today">H</button>
           <span>${day.unplacedHomework.length} due today, no matching lesson</span></p>`
        : ''}
    </section>`).join('');

  homeworkByLesson = new Map();
  for (const day of days) {
    for (const lesson of day.lessons) {
      if (lesson.homework?.length) homeworkByLesson.set(`${day.date}|${lesson.id}`, lesson.homework);
    }
    if (day.unplacedHomework?.length) homeworkByLesson.set(`${day.date}|none`, day.unplacedHomework);
  }

  dockTo(restingDay);
}

async function loadTimetable({ refresh = false } = {}) {
  const host = document.getElementById('timetable');
  const params = new URLSearchParams();
  if (week) params.set('week', week);
  if (refresh) params.set('refresh', '1');

  try {
    const res = await fetch(`/api/timetable?${params}`);
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
    timetable = payload;
    week = payload.week?.startDate || week;
    renderTimetable();
  } catch (err) {
    host.innerHTML = `<div class="error"><strong>Could not load the timetable.</strong><br>
      <code>${esc(err.message)}</code></div>`;
  }
}

/** Shows one view. `push` is false when the url already says so — boot and Back. */
function setTab(next, { push = true } = {}) {
  tab = next;
  for (const link of document.querySelectorAll('.tab')) {
    const on = link.dataset.tab === next;
    link.classList.toggle('is-on', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.getElementById('panel-homework').hidden = next !== 'homework';
  document.getElementById('panel-timetable').hidden = next !== 'timetable';
  document.getElementById('panel-termdates').hidden = next !== 'termdates';
  if (push && location.pathname !== pathForView(next)) {
    history.pushState({ view: next }, '', pathForView(next));
  }
  updateHeading();
  if (next === 'timetable' && !timetable) loadTimetable();
  if (next === 'termdates') renderClosures();
}

function updateHeading() {
  const names = [...new Set(tasks.map((t) => t.student?.name).filter(Boolean))];
  const first = names.length === 1 ? names[0].split(' ')[0] : null;

  if (tab === 'timetable') {
    document.getElementById('heading').textContent = first ? `${first}'s timetable` : 'Timetable';
    document.title = first ? `${first}'s timetable` : 'Timetable';
    const count = timetable?.lessonCount;
    document.getElementById('lede').textContent = count
      ? `${count} lessons this week across ${timetable.days.length} days.`
      : 'Lessons for the week, straight from the school timetable.';
    return;
  }

  if (tab === 'termdates') {
    document.getElementById('heading').textContent = 'Term dates';
    document.title = 'Term dates';
    document.getElementById('lede').textContent = termDates?.school || 'School term dates and closures.';
    return;
  }

  document.getElementById('heading').textContent = first ? `${first}'s homework` : 'Homework';
  document.title = first ? `${first}'s homework` : 'Homework board';
  const open = tasks.filter((t) => !t.done).length;
  document.getElementById('lede').textContent = open
    ? `${open} task${open === 1 ? '' : 's'} to do.`
    : 'Everything is ticked off.';
}

/* ---- the [H] panel ---- */

const hwPanel = document.getElementById('hw-panel');
let hwBadge = null;     // the badge the panel is currently describing
let hwPinned = false;   // clicked open, so it stays until dismissed
let hwTimer = null;

function hwContent(items) {
  return items.map((task) => `
    <article class="hw-item" style="--subject:${subjectColour(task.subject)}">
      <h4>${esc(task.title)}</h4>
      <p class="hw-meta">${esc([task.subject, task.teacher].filter(Boolean).join(' · '))}</p>
      ${task.description ? `<p class="hw-desc">${esc(task.description)}</p>` : ''}
      <p class="hw-foot">
        ${task.estimateMinutes ? `<span>~${task.estimateMinutes} min</span>` : ''}
        ${task.attachments?.length ? `<span>${task.attachments.length} file${task.attachments.length === 1 ? '' : 's'}</span>` : ''}
        ${task.url ? `<a href="${esc(task.url)}" target="_blank" rel="noopener">Show original</a>` : ''}
      </p>
    </article>`).join('');
}

function positionPanel(badge) {
  const rect = badge.getBoundingClientRect();
  const panel = hwPanel.getBoundingClientRect();
  const margin = 10;

  let left = rect.left + rect.width / 2 - panel.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - panel.width - margin));

  // Below the badge by default, above it when that would run off screen.
  let top = rect.bottom + 8;
  if (top + panel.height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - panel.height - 8);
  }

  hwPanel.style.left = `${Math.round(left)}px`;
  hwPanel.style.top = `${Math.round(top)}px`;
}

function openPanel(badge) {
  const items = homeworkByLesson.get(`${badge.dataset.day}|${badge.dataset.lesson}`);
  if (!items?.length) return;

  hwBadge = badge;
  badge.classList.add('is-open');
  hwPanel.innerHTML = `
    <p class="hw-title">Due in this lesson</p>
    ${hwContent(items)}`;
  hwPanel.hidden = false;
  positionPanel(badge);
}

function closePanel() {
  clearTimeout(hwTimer);
  hwPinned = false;
  hwPanel.hidden = true;
  if (hwBadge) hwBadge.classList.remove('is-open');
  hwBadge = null;
}

const scheduleClose = () => {
  clearTimeout(hwTimer);
  hwTimer = setTimeout(() => { if (!hwPinned) closePanel(); }, 160);
};

hwPanel.addEventListener('pointerenter', () => clearTimeout(hwTimer));
hwPanel.addEventListener('pointerleave', scheduleClose);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !hwPanel.hidden) {
    const badge = hwBadge;
    closePanel();
    badge?.focus();
  }
});

document.addEventListener('click', (e) => {
  if (hwPanel.hidden) return;
  if (hwPanel.contains(e.target) || e.target.closest('.hw-badge')) return;
  closePanel();
});

window.addEventListener('scroll', () => { if (!hwPanel.hidden) closePanel(); }, true);

const timetableHost = document.getElementById('timetable');

timetableHost.addEventListener('pointerover', (e) => {
  const badge = e.target.closest('.hw-badge');
  if (badge) {
    clearTimeout(hwTimer);
    if (badge !== hwBadge) { closePanel(); openPanel(badge); }
  }
});

timetableHost.addEventListener('pointerout', (e) => {
  if (e.target.closest('.hw-badge')) scheduleClose();
});

timetableHost.addEventListener('click', (e) => {
  const badge = e.target.closest('.hw-badge');
  if (!badge) return;
  e.stopPropagation();
  if (hwBadge === badge && hwPinned) { closePanel(); return; }
  if (hwBadge !== badge) { closePanel(); openPanel(badge); }
  hwPinned = true;
});

timetableHost.addEventListener('pointerover', (e) => {
  const day = e.target.closest('.day');
  if (day) dockTo(Number(day.dataset.index));
});
timetableHost.addEventListener('pointerleave', () => dockTo(restingDay));
timetableHost.addEventListener('focusin', (e) => {
  const day = e.target.closest('.day');
  if (day) dockTo(Number(day.dataset.index));
});
timetableHost.addEventListener('focusout', (e) => {
  if (!timetableHost.contains(e.relatedTarget)) dockTo(restingDay);
});

window.addEventListener('resize', () => {
  if (timetable) dockTo(restingDay);
  if (!hwPanel.hidden) closePanel();
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const link = e.target.closest('.tab');
  if (!link) return;
  // Let the browser do its own thing for new tabs and middle clicks.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  setTab(link.dataset.tab);
});

window.addEventListener('popstate', () => setTab(viewForPath(location.pathname), { push: false }));

document.getElementById('week-prev').addEventListener('click', () => {
  week = timetable?.week?.previousWeek || week;
  loadTimetable();
});
document.getElementById('week-next').addEventListener('click', () => {
  week = timetable?.week?.nextWeek || week;
  loadTimetable();
});
document.getElementById('week-this').addEventListener('click', () => {
  week = schoolWeekOf(todayISO());
  loadTimetable();
});

board.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('tick')) return;
  const card = e.target.closest('.task');
  const id = card.dataset.id;
  const done = e.target.checked;

  const task = tasks.find((t) => t.id === id);
  if (task) task.done = done;
  card.classList.toggle('is-done', done);
  renderStats();

  try {
    await fetch(`/api/state/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done }),
    });
  } catch {
    if (task) task.done = !done;
    render();
  }
  if (filter !== 'all') setTimeout(render, 220);
});

board.addEventListener('click', async (e) => {
  const get = e.target.closest('.file-get');
  if (get) {
    const id = get.dataset.download;
    const task = tasks.find((x) => x.id === id);
    get.disabled = true;
    get.textContent = 'Saving…';
    try {
      const res = await fetch('/api/attachments/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
      for (const file of payload.files) {
        const match = task?.attachments.find((a) => String(a.id) === String(file.id));
        if (match && !file.error) { match.downloaded = true; match.localUrl = file.url; }
      }
      if (payload.failed) {
        get.disabled = false;
        get.textContent = `${payload.failed} of ${payload.total} could not be saved — try again`;
        return;
      }
      render();
    } catch {
      get.disabled = false;
      get.textContent = 'Could not save the files — try again';
    }
    return;
  }

  const btn = e.target.closest('.more');
  if (!btn) return;
  const card = btn.closest('.task');
  const task = tasks.find((t) => t.id === card.dataset.id);

  if (btn.dataset.fetch === '1' && task) {
    btn.textContent = 'Loading…';
    btn.disabled = true;
    try {
      const res = await fetch(task.detailUrl);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
      task.description = payload.data.description || task.description;
      if (payload.data.links?.length) task.links = payload.data.links;
      task.truncated = false;
      task.expanded = true;
      render();
    } catch {
      btn.textContent = 'Could not load the full brief';
      btn.disabled = false;
    }
    return;
  }

  const desc = card.querySelector('.task-desc');
  const clipped = desc.classList.toggle('is-clipped');
  if (task) task.expanded = !clipped;
  btn.textContent = clipped ? 'Show more' : 'Show less';
});

$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === chip));
  filter = chip.dataset.filter;
  render();
});

$('#refresh').addEventListener('click', async () => {
  if (tab === 'timetable') {
    const btn = $('#refresh');
    btn.disabled = true;
    btn.classList.add('is-busy');
    $('#refresh-label').textContent = 'Loading…';
    await loadTimetable({ refresh: true });
    updateHeading();
    btn.disabled = false;
    btn.classList.remove('is-busy');
    $('#refresh-label').textContent = 'Refresh';
    return;
  }
  load({ refresh: true });
});

// The dates shape both views, so they are read before anything is drawn.
await loadClosures();
setTab(tab, { push: false });
load();
