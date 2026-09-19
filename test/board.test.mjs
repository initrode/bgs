import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntil, fmtDate, relative, urgency, subjectColour,
  esc, matchesFilter, summarise, groupTasks, todayISO,
  viewForPath, pathForView, VIEWS,
} from '../public/task-utils.js';

const NOW = new Date(2026, 8, 19); // Saturday 19 September 2026
const task = (over = {}) => ({ id: 't', dueOn: '2026-09-22', done: false, ...over });

test('the board reads dates the same way the server writes them', async (t) => {
  await t.test('days until a due date', () => {
    assert.equal(daysUntil('2026-09-22', NOW), 3);
    assert.equal(daysUntil('2026-09-19', NOW), 0);
    assert.equal(daysUntil('2026-09-15', NOW), -4);
  });

  await t.test('formatting names the right weekday', () => {
    // 22 September 2026 is a Tuesday — the bug you spotted showed Monday.
    assert.match(fmtDate('2026-09-22'), /^Tue 22 Sep/);
    assert.match(fmtDate('2026-09-21'), /^Mon 21 Sep/);
  });

  await t.test('an undated task is labelled, not blank', () => {
    assert.equal(fmtDate(null), 'No date');
    assert.equal(fmtDate('nonsense'), 'No date');
  });

  await t.test('todayISO agrees with the server format', () => {
    assert.equal(todayISO(NOW), '2026-09-19');
  });
});

test('relative wording covers each case exactly once', async (t) => {
  await t.test('future, today, tomorrow, overdue', () => {
    assert.equal(relative(3), 'in 3 days');
    assert.equal(relative(1), 'tomorrow');
    assert.equal(relative(0), 'due today');
    assert.equal(relative(-1), '1 day overdue');
    assert.equal(relative(-4), '4 days overdue');
  });

  await t.test('undated says nothing rather than "in null days"', () => {
    assert.equal(relative(null), '');
    assert.equal(relative(undefined), '');
  });
});

test('urgency drives the colour of the due chip', async (t) => {
  await t.test('due today or tomorrow is urgent', () => {
    assert.equal(urgency(task({ dueOn: '2026-09-19' }), NOW), 'is-urgent');
    assert.equal(urgency(task({ dueOn: '2026-09-20' }), NOW), 'is-urgent');
  });

  await t.test('overdue is urgent', () => {
    assert.equal(urgency(task({ dueOn: '2026-09-10' }), NOW), 'is-urgent');
  });

  await t.test('within three days is a warning', () => {
    assert.equal(urgency(task({ dueOn: '2026-09-22' }), NOW), 'is-warn');
  });

  await t.test('further out is neutral', () => {
    assert.equal(urgency(task({ dueOn: '2026-10-30' }), NOW), '');
  });

  await t.test('a finished task is never urgent, however late', () => {
    assert.equal(urgency(task({ dueOn: '2020-01-01', done: true }), NOW), '');
  });
});

test('tasks group under the heading a parent would expect', async (t) => {
  const bucket = (dueOn) => groupTasks([task({ dueOn })], NOW)[0];

  await t.test('each date lands in the right group', () => {
    assert.equal(bucket('2026-09-10').label, 'Overdue');
    assert.equal(bucket('2026-09-19').label, 'Due today');
    assert.equal(bucket('2026-09-20').label, 'Due tomorrow');
    assert.equal(bucket('2026-09-24').label, 'This week');
    assert.equal(bucket('2026-10-01').label, 'Next week');
    assert.equal(bucket('2026-11-01').label, 'Later');
    assert.equal(bucket(null).label, 'No due date');
  });

  await t.test('groups come back most urgent first', () => {
    const groups = groupTasks([
      task({ id: 'a', dueOn: '2026-11-01' }),
      task({ id: 'b', dueOn: '2026-09-10' }),
      task({ id: 'c', dueOn: null }),
      task({ id: 'd', dueOn: '2026-09-19' }),
    ], NOW);
    assert.deepEqual(groups.map((g) => g.label), ['Overdue', 'Due today', 'Later', 'No due date']);
  });

  await t.test('tasks sharing a bucket stay together', () => {
    const groups = groupTasks([task({ id: 'a', dueOn: '2026-09-22' }), task({ id: 'b', dueOn: '2026-09-24' })], NOW);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 2);
  });

  await t.test('an empty list produces no groups', () => {
    assert.deepEqual(groupTasks([], NOW), []);
  });
});

test('filter chips select what they claim to', async (t) => {
  const tasks = [
    task({ id: 'open', dueOn: '2026-09-25' }),
    task({ id: 'late', dueOn: '2026-09-10' }),
    task({ id: 'finished', dueOn: '2026-09-10', done: true }),
  ];
  const ids = (filter) => tasks.filter((x) => matchesFilter(x, filter, NOW)).map((x) => x.id);

  await t.test('to do hides finished work', () => {
    assert.deepEqual(ids('todo'), ['open', 'late']);
  });

  await t.test('overdue means late and unfinished', () => {
    assert.deepEqual(ids('overdue'), ['late'], 'a finished late task is not overdue');
  });

  await t.test('done shows only finished work', () => {
    assert.deepEqual(ids('done'), ['finished']);
  });

  await t.test('all shows everything', () => {
    assert.deepEqual(ids('all'), ['open', 'late', 'finished']);
  });
});

test('the header counts match the list', async (t) => {
  const s = summarise([
    task({ id: '1', dueOn: '2026-09-10' }),
    task({ id: '2', dueOn: '2026-09-21' }),
    task({ id: '3', dueOn: '2026-12-01' }),
    task({ id: '4', dueOn: '2026-09-10', done: true }),
  ], NOW);

  await t.test('open, done and total', () => {
    assert.equal(s.total, 4);
    assert.equal(s.open, 3);
    assert.equal(s.done, 1);
  });

  await t.test('overdue counts only unfinished late work', () => {
    assert.equal(s.overdue, 1);
  });

  await t.test('due soon is the next three days, not including overdue', () => {
    assert.equal(s.soon, 1, 'only the 21st falls inside three days');
  });

  await t.test('an empty board reports zeroes, not NaN', () => {
    assert.deepEqual(summarise([], NOW), { total: 0, open: 0, done: 0, overdue: 0, soon: 0 });
  });
});

test('subject colours are stable and meaningful', async (t) => {
  await t.test('the same subject always gets the same hue', () => {
    assert.equal(subjectColour('PD-History'), subjectColour('PD-History'));
  });

  await t.test('school prefixes do not split one subject in two', () => {
    assert.equal(subjectColour('PD-English'), subjectColour('English'));
    assert.equal(subjectColour('KS2-Maths'), subjectColour('Maths'));
  });

  await t.test('different subjects get different hues', () => {
    assert.notEqual(subjectColour('History'), subjectColour('Maths'));
  });

  await t.test('a missing subject still yields a valid colour', () => {
    assert.match(subjectColour(null), /^hsl\(\d+ var\(--subject-s\) var\(--subject-l\)\)$/);
  });

  await t.test('the hue is always in range', () => {
    for (const s of ['Art', 'PD-Music', 'Design & Technology', 'x'.repeat(200), '🎨']) {
      const h = Number(subjectColour(s).match(/^hsl\((\d+)/)[1]);
      assert.ok(h >= 0 && h < 360, `${s} gave hue ${h}`);
    }
  });
});

test('esc neutralises anything a teacher can type', async (t) => {
  await t.test('escapes the characters that break out of markup', () => {
    assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(esc('a "quoted" & \'single\''), 'a &quot;quoted&quot; &amp; &#39;single&#39;');
  });

  await t.test('an attribute cannot be broken out of', () => {
    assert.ok(!esc('" onerror="alert(1)').includes('"'));
  });

  await t.test('empty values render as an empty string', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
  });
});


test('the url decides which view is on screen', async (t) => {
  await t.test('each view has one path, and it round-trips', () => {
    for (const [path, view] of Object.entries(VIEWS)) {
      assert.equal(viewForPath(path), view);
      assert.equal(pathForView(view), path);
    }
  });

  await t.test('/timetable is its own page', () => {
    assert.equal(viewForPath('/timetable'), 'timetable');
    assert.equal(pathForView('timetable'), '/timetable');
  });

  await t.test('a trailing slash, a query or a hash still resolves', () => {
    assert.equal(viewForPath('/timetable/'), 'timetable');
    assert.equal(viewForPath('/timetable?week=2026-09-21'), 'timetable');
    assert.equal(viewForPath('/timetable#top'), 'timetable');
  });

  await t.test('the root is the homework board', () => {
    assert.equal(viewForPath('/'), 'homework');
    assert.equal(viewForPath(''), 'homework');
  });

  await t.test('an unknown path falls back rather than showing nothing', () => {
    assert.equal(viewForPath('/nonsense'), 'homework');
    assert.equal(pathForView('nonsense'), '/');
  });
});

test('a practice target reads as two numbers and a bar', async (t) => {
  const { progressPct, targetLabel, remainingLabel, periodLabel } = await import('../public/task-utils.js');

  await t.test('progress is a percentage of the target', () => {
    assert.equal(progressPct(8, 30), 27);
    assert.equal(progressPct(0, 30), 0);
    assert.equal(progressPct(30, 30), 100);
  });

  await t.test('an overshoot fills the bar rather than running off it', () => {
    assert.equal(progressPct(45, 30), 100);
  });

  await t.test('a target of nothing does not divide by zero', () => {
    assert.equal(progressPct(5, 0), 100);
    assert.equal(progressPct(0, 0), 0);
  });

  await t.test('the figures name both numbers', () => {
    assert.equal(targetLabel({ value: 8, target: 30, unit: 'min' }), '8 of 30 min');
    assert.equal(targetLabel({}), '0 of 0');
  });

  await t.test('what is left, or that there is nothing left', () => {
    assert.equal(remainingLabel({ value: 8, target: 30, unit: 'min' }), '22 min to go');
    assert.equal(remainingLabel({ value: 30, target: 30, unit: 'min' }), 'Target met');
    assert.equal(remainingLabel({ value: 45, target: 30, unit: 'min' }), 'Target met');
  });

  await t.test('the period reads as a span of dates', () => {
    assert.equal(periodLabel({ start: '2026-09-14', end: '2026-09-20' }), 'Mon 14 Sept – Sun 20 Sept');
    assert.equal(periodLabel({ start: '2026-09-14', end: '2026-09-14' }), 'Mon 14 Sept');
    assert.equal(periodLabel({}), '');
  });
});

test('the practice card is tinted by how the week is going', async (t) => {
  const { toneHue } = await import('../public/task-utils.js');
  const red = (h) => h >= 0 && h <= 26;
  const amber = (h) => h >= 27 && h <= 50;
  const green = (h) => h >= 120 && h <= 160;

  await t.test('nothing done is red', () => {
    assert.ok(red(toneHue(0, 30)), `0 min gave hue ${toneHue(0, 30)}`);
    assert.ok(red(toneHue(10, 30)), `10 min gave hue ${toneHue(10, 30)}`);
  });

  await t.test('on the way is amber', () => {
    assert.ok(amber(toneHue(11, 30)), `11 min gave hue ${toneHue(11, 30)}`);
    assert.ok(amber(toneHue(20, 30)), `20 min gave hue ${toneHue(20, 30)}`);
    assert.ok(amber(toneHue(29, 30)), `29 min gave hue ${toneHue(29, 30)}`);
  });

  await t.test('the target met is green, and staying past it stays green', () => {
    assert.ok(green(toneHue(30, 30)), `30 min gave hue ${toneHue(30, 30)}`);
    assert.ok(green(toneHue(45, 30)), `45 min gave hue ${toneHue(45, 30)}`);
  });

  await t.test('within a band the colour moves rather than stepping', () => {
    const climb = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map((m) => toneHue(m, 30));
    for (let i = 1; i < climb.length; i += 1) {
      assert.ok(climb[i] >= climb[i - 1], `hue went backwards at ${i}: ${climb.join(' ')}`);
    }
    assert.ok(new Set(climb).size > 5, 'the spectrum should be continuous, not three flat blocks');
  });

  await t.test('the bands are fractions of the target, so another target means the same thing', () => {
    // An hour a week: half way through the first third is the same red as
    // five minutes into a thirty minute target.
    assert.equal(toneHue(10, 60), toneHue(5, 30));
    assert.ok(green(toneHue(60, 60)));
    assert.ok(red(toneHue(0, 60)));
  });

  await t.test('a missing or nonsense target does not produce a broken hue', () => {
    assert.ok(Number.isFinite(toneHue(0, 0)));
    assert.ok(red(toneHue(0, 0)), 'nothing done and nothing asked for is not a success');
    assert.ok(green(toneHue(5, 0)), 'practice with no target set still counts as done');
    assert.ok(red(toneHue(-5, 30)), 'a negative value floors at the bottom of the scale');
    assert.ok(Number.isFinite(toneHue(undefined, undefined)));
  });
});
