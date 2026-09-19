import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport, fakeProvider, serve, getJSON } from './helpers.mjs';
import { mondayOf, weekdayOf } from '../src/dates.mjs';
import {
  weekLabel, isNow, lessonWhere, mondayOf as clientMonday, focusDayIndex, dockWeight,
  dockOpacity, attachHomework, subjectKey, schoolWeekOf as clientSchoolWeek,
} from '../public/task-utils.js';
import { schoolWeekOf } from '../src/dates.mjs';

process.env.QUIET = '1';

test('mondayOf finds the start of the school week', async (t) => {
  await t.test('every day of one week maps to the same Monday', () => {
    for (const day of ['2026-09-14', '2026-09-15', '2026-09-18', '2026-09-19', '2026-09-20']) {
      assert.equal(mondayOf(day), '2026-09-14', `${day} belongs to the week of 14 Sept`);
    }
  });

  await t.test('Sunday ends a week rather than starting one', () => {
    // Sunday 20 Sept belongs to the week starting Monday 14th, not the 21st.
    assert.equal(mondayOf('2026-09-20'), '2026-09-14');
    assert.equal(mondayOf('2026-09-21'), '2026-09-21');
  });

  await t.test('works across a month and year boundary', () => {
    assert.equal(mondayOf('2026-10-01'), '2026-09-28');
    assert.equal(mondayOf('2027-01-01'), '2026-12-28');
  });

  await t.test('accepts a Date as well as a string', () => {
    assert.equal(mondayOf(new Date(2026, 8, 19)), '2026-09-14');
  });

  await t.test('the browser and the server agree', () => {
    for (const day of ['2026-09-14', '2026-09-19', '2026-10-01', '2027-01-01']) {
      assert.equal(clientMonday(day), mondayOf(day), `disagreement on ${day}`);
    }
  });

  await t.test('rubbish in gives null, not a wrong Monday', () => {
    assert.equal(mondayOf('not-a-date'), null);
  });
});

test('weekdayOf names the day without a timezone round-trip', async (t) => {
  await t.test('names each weekday correctly', () => {
    assert.equal(weekdayOf('2026-09-14'), 'Monday');
    assert.equal(weekdayOf('2026-09-18'), 'Friday');
    // 22 September 2026 is a Tuesday — the same date the due-date bug got wrong.
    assert.equal(weekdayOf('2026-09-22'), 'Tuesday');
  });

  await t.test('an unparseable date gives an empty string', () => {
    assert.equal(weekdayOf('rubbish'), '');
  });
});

test('clockTime reads the school clock, not UTC', async (t) => {
  tempDataDir(t);
  const { __internals: { clockTime, normaliseLesson } } = await freshImport('../src/providers/satchelone.mjs');

  await t.test('British Summer Time keeps its wall-clock time', () => {
    // 08:45 +01:00 is 07:45 UTC. A lesson must not move an hour.
    assert.equal(clockTime('2026-09-14T08:45:00+01:00'), '08:45');
    assert.equal(clockTime('2026-09-14T14:55:00+01:00'), '14:55');
  });

  await t.test('winter times are unchanged too', () => {
    assert.equal(clockTime('2026-11-10T08:45:00+00:00'), '08:45');
  });

  await t.test('missing times give null rather than NaN', () => {
    assert.equal(clockTime(null), null);
    assert.equal(clockTime('2026-09-14'), null);
  });

  await t.test('a lesson is flattened into what the board needs', () => {
    const lesson = normaliseLesson({
      id: 221587181,
      classGroup: { subject: 'PD-History', name: 'PD6R/Hi', id: 1 },
      period: { startDateTime: '2026-09-15T12:05:00+01:00', endDateTime: '2026-09-15T12:55:00+01:00', session: 'pm' },
      room: 'PD10',
      teacher: { name: 'Mr D. Larkins' },
      dueClassTasks: [{ id: 91051974, title: 'Independent Research' }],
    });
    assert.deepEqual(lesson, {
      id: 221587181,
      subject: 'PD-History',
      group: 'PD6R/Hi',
      room: 'PD10',
      teacher: 'Mr D. Larkins',
      startsAt: '12:05',
      endsAt: '12:55',
      session: 'pm',
      dueTasks: [{ id: 91051974, title: 'Independent Research', url: 'https://www.satchelone.com/homeworks/91051974' }],
    });
  });

  await t.test('a lesson with missing detail still renders', () => {
    const lesson = normaliseLesson({ id: 1, period: {}, classGroup: {} });
    assert.equal(lesson.subject, 'Lesson');
    assert.equal(lesson.room, null);
    assert.deepEqual(lesson.dueTasks, []);
  });
});

test('collectTimetable merges providers into one week', async (t) => {
  tempDataDir(t);
  const reg = await freshImport('../src/registry.mjs');

  const school = fakeProvider({
    id: 'school', label: 'Main School',
    timetable: async (ctx) => ({
      student: { id: 1, name: 'Alex Paton' },
      week: { startDate: ctx.params.week || '2026-09-14', previousWeek: '2026-09-07', nextWeek: '2026-09-21' },
      lessonCount: 2,
      days: [{ date: '2026-09-14', weekday: 'Monday', lessons: [
        { id: 2, subject: 'Maths', startsAt: '10:00', endsAt: '10:50' },
        { id: 1, subject: 'Form Period', startsAt: '08:45', endsAt: '09:00' },
      ] }],
    }),
  });

  const music = fakeProvider({
    id: 'music', label: 'Music School',
    timetable: async () => ({
      student: { id: 1, name: 'Alex Paton' },
      week: { startDate: '2026-09-14' },
      lessonCount: 1,
      days: [{ date: '2026-09-14', weekday: 'Monday', lessons: [{ id: 3, subject: 'Violin', startsAt: '09:05', endsAt: '09:35' }] }],
    }),
  });

  await t.test('lessons from both schools share a day, sorted by time', async () => {
    await reg.loadProviders([school, music]);
    const out = await reg.collectTimetable({});
    assert.equal(out.days.length, 1);
    assert.deepEqual(out.days[0].lessons.map((l) => l.startsAt), ['08:45', '09:05', '10:00']);
    assert.equal(out.lessonCount, 3);
  });

  await t.test('each lesson knows which school it came from', async () => {
    await reg.loadProviders([school, music]);
    const out = await reg.collectTimetable({});
    assert.deepEqual(out.days[0].lessons.map((l) => l.source), ['school', 'music', 'school']);
  });

  await t.test('the requested week is passed through to the provider', async () => {
    await reg.loadProviders([school]);
    const out = await reg.collectTimetable({ week: '2026-09-21' });
    assert.equal(out.week.startDate, '2026-09-21');
  });

  await t.test('a provider that throws is reported, not fatal', async () => {
    const broken = fakeProvider({ id: 'broken', label: 'Broken', timetable: async () => { throw new Error('timetable down'); } });
    await reg.loadProviders([school, broken]);
    const out = await reg.collectTimetable({});
    assert.equal(out.lessonCount, 2, 'the working school still shows');
    assert.match(out.sources.find((s) => s.id === 'broken').error, /timetable down/);
  });

  await t.test('providers without a timetable are left out', async () => {
    await reg.loadProviders([school, fakeProvider({ id: 'homework-only' })]);
    const out = await reg.collectTimetable({});
    assert.deepEqual(out.sources.map((s) => s.id), ['school']);
  });

  await t.test('an unconfigured provider is skipped with a reason', async () => {
    const locked = fakeProvider({ id: 'locked', credentials: ['NEVER_SET_ANYWHERE'], timetable: async () => ({ days: [] }) });
    await reg.loadProviders([locked]);
    const out = await reg.collectTimetable({});
    assert.equal(out.sources[0].skipped, 'missing credentials');
    assert.equal(out.lessonCount, 0);
  });

  await t.test('days come back in date order', async () => {
    const jumbled = fakeProvider({
      id: 'jumbled',
      timetable: async () => ({
        week: { startDate: '2026-09-14' },
        days: [
          { date: '2026-09-16', weekday: 'Wednesday', lessons: [{ id: 1, subject: 'A', startsAt: '09:00' }] },
          { date: '2026-09-14', weekday: 'Monday', lessons: [{ id: 2, subject: 'B', startsAt: '09:00' }] },
        ],
      }),
    });
    await reg.loadProviders([jumbled]);
    const out = await reg.collectTimetable({});
    assert.deepEqual(out.days.map((d) => d.date), ['2026-09-14', '2026-09-16']);
  });
});

test('GET /api/timetable serves the week', async (t) => {
  tempDataDir(t);
  const { buildApp } = await freshImport('../src/app.mjs');
  const provider = fakeProvider({
    id: 'school', label: 'Main School',
    timetable: async (ctx) => ({
      student: { id: 1, name: 'Alex Paton' },
      week: { startDate: ctx.params.week || '2026-09-14', previousWeek: '2026-09-07', nextWeek: '2026-09-21' },
      lessonCount: 1,
      days: [{ date: '2026-09-14', weekday: 'Monday', lessons: [{ id: 1, subject: 'Maths', startsAt: '10:00', endsAt: '10:50' }] }],
    }),
  });
  const base = await serve(t, await buildApp({ providers: [provider] }));

  await t.test('returns days, lessons and week bounds', async () => {
    const { status, body } = await getJSON(base, '/api/timetable');
    assert.equal(status, 200);
    assert.equal(body.lessonCount, 1);
    assert.equal(body.week.startDate, '2026-09-14');
    assert.equal(body.week.nextWeek, '2026-09-21');
    assert.equal(body.student.name, 'Alex Paton');
  });

  await t.test('a week parameter selects a different week', async () => {
    const { body } = await getJSON(base, '/api/timetable?week=2026-09-21');
    assert.equal(body.week.startDate, '2026-09-21');
  });

  await t.test('the second call is cached, and refresh bypasses it', async () => {
    assert.equal((await getJSON(base, '/api/timetable')).body.cached, true);
    assert.equal((await getJSON(base, '/api/timetable?refresh=1')).body.cached, false);
  });

  await t.test('each week is cached separately', async () => {
    await getJSON(base, '/api/timetable?week=2026-10-05');
    assert.equal((await getJSON(base, '/api/timetable?week=2026-10-05')).body.cached, true);
    assert.equal((await getJSON(base, '/api/timetable?week=2026-11-02')).body.cached, false);
  });

  await t.test('it is advertised in the api index', async () => {
    const { body } = await getJSON(base, '/api');
    assert.ok(body.aggregate.some((r) => r.url === '/api/timetable'));
  });
});

test('the timetable view formats what it is given', async (t) => {
  await t.test('the week heading names the Monday', () => {
    assert.match(weekLabel('2026-09-14'), /^Week of Mon 14 Sep/);
    assert.equal(weekLabel(null), '');
  });

  await t.test('a lesson in progress is highlighted, on the right day only', () => {
    const lesson = { startsAt: '10:00', endsAt: '10:50' };
    const during = new Date(2026, 8, 14, 10, 30);
    assert.equal(isNow(lesson, during, '2026-09-14'), true);
    assert.equal(isNow(lesson, during, '2026-09-15'), false, 'same time, different day');
  });

  await t.test('the boundaries are inclusive at the start, exclusive at the end', () => {
    const lesson = { startsAt: '10:00', endsAt: '10:50' };
    assert.equal(isNow(lesson, new Date(2026, 8, 14, 10, 0), '2026-09-14'), true);
    assert.equal(isNow(lesson, new Date(2026, 8, 14, 10, 50), '2026-09-14'), false);
    assert.equal(isNow(lesson, new Date(2026, 8, 14, 9, 59), '2026-09-14'), false);
  });

  await t.test('a lesson without times is never in progress', () => {
    assert.equal(isNow({ startsAt: null, endsAt: null }, new Date()), false);
  });

  await t.test('room and teacher read as one line, with either missing', () => {
    assert.equal(lessonWhere({ room: 'PD10', teacher: 'Mr D. Larkins' }), 'PD10 · Mr D. Larkins');
    assert.equal(lessonWhere({ room: null, teacher: 'Mr M. Maguire' }), 'Mr M. Maguire');
    assert.equal(lessonWhere({ room: 'Swimming Pool', teacher: null }), 'Swimming Pool');
    assert.equal(lessonWhere({}), '');
  });
});

test('the week opens on the day that matters', async (t) => {
  const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
    .map((date) => ({ date }));

  await t.test('a weekday in view focuses itself', () => {
    assert.equal(focusDayIndex(week, new Date(2026, 8, 14)), 0, 'Monday');
    assert.equal(focusDayIndex(week, new Date(2026, 8, 16)), 2, 'Wednesday');
    assert.equal(focusDayIndex(week, new Date(2026, 8, 18)), 4, 'Friday');
  });

  await t.test('a weekend falls back to the nearest school day', () => {
    // Saturday and Sunday are not in the week's columns, so the view settles
    // on Friday rather than on nothing.
    assert.equal(focusDayIndex(week, new Date(2026, 8, 19)), 4, 'Saturday');
    assert.equal(focusDayIndex(week, new Date(2026, 8, 20)), 4, 'Sunday');
  });

  await t.test('looking at a future week opens on its Monday', () => {
    assert.equal(focusDayIndex(week, new Date(2026, 8, 7)), 0);
  });

  await t.test('looking at a past week opens on its last day', () => {
    assert.equal(focusDayIndex(week, new Date(2026, 9, 5)), 4);
  });

  await t.test('a day missing from the middle still resolves', () => {
    const gapped = [{ date: '2026-09-14' }, { date: '2026-09-18' }];
    assert.equal(focusDayIndex(gapped, new Date(2026, 8, 16)), 1, 'the next day ahead');
  });

  await t.test('an empty week focuses nothing rather than index 0', () => {
    assert.equal(focusDayIndex([], new Date()), -1);
    assert.equal(focusDayIndex(undefined, new Date()), -1);
  });
});

test('dock magnification tapers away from the day in focus', async (t) => {
  await t.test('the focused day is widest', () => {
    assert.ok(dockWeight(0) > dockWeight(1));
    assert.ok(dockWeight(1) > dockWeight(2));
    assert.ok(dockWeight(2) > dockWeight(3));
  });

  await t.test('it falls off the same either side', () => {
    assert.equal(dockWeight(-1), dockWeight(1));
    assert.equal(dockWeight(-3), dockWeight(3));
  });

  await t.test('distant days keep a usable width rather than collapsing', () => {
    assert.ok(dockWeight(4) > 0.5, 'a far column must stay readable');
  });

  await t.test('the focused day is clearly bigger, without swamping the week', () => {
    const ratio = dockWeight(0) / dockWeight(4);
    assert.ok(ratio > 1.5 && ratio < 3, `ratio was ${ratio}`);
  });
});

test('"this week" rolls forward once Friday has gone', async (t) => {
  await t.test('a school day stays in its own week', () => {
    assert.equal(schoolWeekOf('2026-09-14'), '2026-09-14', 'Monday');
    assert.equal(schoolWeekOf('2026-09-16'), '2026-09-14', 'Wednesday');
    assert.equal(schoolWeekOf('2026-09-18'), '2026-09-14', 'Friday still shows its own week');
  });

  await t.test('the weekend points at the week ahead', () => {
    assert.equal(schoolWeekOf('2026-09-19'), '2026-09-21', 'Saturday');
    assert.equal(schoolWeekOf('2026-09-20'), '2026-09-21', 'Sunday');
  });

  await t.test('it rolls across a month boundary', () => {
    assert.equal(schoolWeekOf('2026-10-31'), '2026-11-02', 'Saturday 31 October');
  });

  await t.test('the browser and the server agree', () => {
    for (const day of ['2026-09-14', '2026-09-18', '2026-09-19', '2026-09-20', '2026-10-31']) {
      assert.equal(clientSchoolWeek(day), schoolWeekOf(day), `disagreement on ${day}`);
    }
  });

  await t.test('this differs from mondayOf only at the weekend', () => {
    assert.equal(schoolWeekOf('2026-09-16'), mondayOf('2026-09-16'));
    assert.notEqual(schoolWeekOf('2026-09-19'), mondayOf('2026-09-19'));
  });
});

test('days away from the focus fade back', async (t) => {
  await t.test('the focused day is fully opaque', () => {
    assert.equal(dockOpacity(0), 1);
  });

  await t.test('opacity drops with distance, symmetrically', () => {
    assert.ok(dockOpacity(1) < dockOpacity(0));
    assert.ok(dockOpacity(2) < dockOpacity(1));
    assert.equal(dockOpacity(-2), dockOpacity(2));
  });

  await t.test('faded days stay legible rather than disappearing', () => {
    assert.ok(dockOpacity(4) >= 0.35, 'a distant day must still be readable');
  });
});

test('homework is cross-referenced onto the lessons it is due in', async (t) => {
  const days = [
    { date: '2026-09-21', weekday: 'Monday', lessons: [
      { id: 1, subject: 'PD-Maths', startsAt: '09:05' },
      { id: 2, subject: 'PD-English', startsAt: '11:10' },
    ] },
    { date: '2026-09-22', weekday: 'Tuesday', lessons: [
      { id: 3, subject: 'PD-History', startsAt: '11:10' },
      { id: 4, subject: 'PD-History', startsAt: '14:00' },
    ] },
  ];

  const english = { id: 'satchelone:1', subject: 'PD-English', dueOn: '2026-09-21', done: false, title: 'Grammar' };
  const history = { id: 'satchelone:2', subject: 'PD-History', dueOn: '2026-09-22', done: false, title: 'WWI letter' };

  await t.test('a task lands on its subject, on its due date', () => {
    const out = attachHomework(days, [english, history]);
    assert.deepEqual(out[0].lessons[0].homework, [], 'Maths is untouched');
    assert.deepEqual(out[0].lessons[1].homework.map((h) => h.title), ['Grammar']);
    assert.deepEqual(out[1].lessons[0].homework.map((h) => h.title), ['WWI letter']);
  });

  await t.test('a subject taught twice in a day marks only the first lesson', () => {
    const out = attachHomework(days, [history]);
    assert.equal(out[1].lessons[0].homework.length, 1);
    assert.deepEqual(out[1].lessons[1].homework, [], 'the later lesson is not double-marked');
  });

  await t.test('school prefixes do not stop a match', () => {
    const bare = { id: 'x:1', subject: 'English', dueOn: '2026-09-21', done: false, title: 'Bare subject' };
    const out = attachHomework(days, [bare]);
    assert.deepEqual(out[0].lessons[1].homework.map((h) => h.title), ['Bare subject']);
  });

  await t.test('finished homework is not marked', () => {
    const out = attachHomework(days, [{ ...english, done: true }]);
    assert.deepEqual(out[0].lessons[1].homework, []);
  });

  await t.test('homework due on a day with no matching lesson is still reported', () => {
    const orphan = { id: 'x:2', subject: 'PD-Swimming', dueOn: '2026-09-21', done: false, title: 'Swim kit' };
    const out = attachHomework(days, [orphan]);
    assert.deepEqual(out[0].unplacedHomework.map((h) => h.title), ['Swim kit']);
  });

  await t.test('a task due outside the week marks nothing', () => {
    const out = attachHomework(days, [{ ...english, dueOn: '2026-10-05' }]);
    assert.ok(out.every((d) => d.lessons.every((l) => !l.homework.length)));
    assert.ok(out.every((d) => !d.unplacedHomework.length));
  });

  await t.test('an undated task is ignored rather than matching everything', () => {
    const out = attachHomework(days, [{ ...english, dueOn: null }]);
    assert.ok(out.every((d) => d.lessons.every((l) => !l.homework.length)));
  });

  await t.test('no homework leaves every lesson with an empty list, never undefined', () => {
    const out = attachHomework(days, []);
    assert.ok(out.every((d) => d.lessons.every((l) => Array.isArray(l.homework))));
  });

  await t.test('the original days are not mutated', () => {
    attachHomework(days, [english, history]);
    assert.equal(days[0].lessons[1].homework, undefined);
  });

  await t.test('subjectKey is what makes the two tabs agree', () => {
    assert.equal(subjectKey('PD-English'), subjectKey('English'));
    assert.equal(subjectKey('KS2-Maths'), 'maths');
    assert.equal(subjectKey(null), '');
  });
});
