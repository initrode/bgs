import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closureOn, markClosures, isSchoolDay, schoolDaysUntil, breakBefore,
  nextClosure, closureDates, closureWhen,
} from '../public/task-utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'public', 'closures.json'), 'utf8'));
const CLOSURES = data.closures;

const SATURDAY = new Date(2026, 8, 19);   // Saturday 19 September 2026

test('the term dates file is coherent', async (t) => {
  await t.test('every closure is a pair of ISO dates the right way round', () => {
    for (const c of CLOSURES) {
      assert.match(c.start, /^\d{4}-\d{2}-\d{2}$/, `bad start: ${c.label}`);
      assert.match(c.end, /^\d{4}-\d{2}-\d{2}$/, `bad end: ${c.label}`);
      assert.ok(c.end >= c.start, `${c.label} ends before it starts`);
      assert.ok(c.label, 'every closure needs a label');
      assert.ok(['holiday', 'staff-day', 'bank-holiday'].includes(c.kind), `unknown kind: ${c.kind}`);
    }
  });

  await t.test('closures are in date order and never overlap', () => {
    for (let i = 1; i < CLOSURES.length; i += 1) {
      assert.ok(CLOSURES[i].start > CLOSURES[i - 1].end,
        `${CLOSURES[i].label} overlaps or precedes ${CLOSURES[i - 1].label}`);
    }
  });

  await t.test('terms run in order and the closures sit inside the year', () => {
    const terms = data.terms;
    for (const term of terms) assert.ok(term.end > term.start, `${term.name} ends before it starts`);
    for (let i = 1; i < terms.length; i += 1) {
      assert.ok(terms[i].start > terms[i - 1].end, `${terms[i].name} starts before ${terms[i - 1].name} ends`);
    }
    assert.ok(CLOSURES[0].start >= '2026-09-01' && CLOSURES.at(-1).end <= '2027-08-31');
  });

  await t.test('it says where it came from, so it can be checked', () => {
    assert.match(data.source.page, /^https:\/\/www\.burygrammar\.com\//);
    assert.match(data.source.transcribedOn, /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('the dates match the published sheet', () => {
    // Spot checks against the term dates PDF, so a careless edit is caught.
    const byLabel = Object.fromEntries(CLOSURES.map((c) => [c.label, c]));
    assert.equal(byLabel['October half term'].start, '2026-10-19');
    assert.equal(byLabel['October half term'].end, '2026-10-30');
    assert.equal(byLabel['Teaching staff and pupils not in school'].start, '2026-09-25');
    assert.equal(byLabel['Entrance exam day'].start, '2027-01-21');
    assert.equal(byLabel['Bank holiday'].start, '2027-05-03');
    assert.deepEqual(data.terms.map((x) => x.start), ['2026-09-04', '2027-01-04', '2027-04-12']);
  });
});

test('a date is either a school day or it is not', async (t) => {
  await t.test('an ordinary weekday in term is', () => {
    assert.equal(isSchoolDay('2026-09-24', CLOSURES), true);
  });

  await t.test('a weekend never is', () => {
    assert.equal(isSchoolDay('2026-09-19', CLOSURES), false);
    assert.equal(isSchoolDay('2026-09-20', CLOSURES), false);
  });

  await t.test('a closure day is not, whatever the weekday', () => {
    assert.equal(isSchoolDay('2026-09-25', CLOSURES), false, 'the staff day is a Friday');
    assert.equal(isSchoolDay('2026-10-20', CLOSURES), false, 'half term');
    assert.equal(isSchoolDay('2027-05-03', CLOSURES), false, 'bank holiday');
  });

  await t.test('the day either side of a closure is', () => {
    assert.equal(isSchoolDay('2026-10-16', CLOSURES), true, 'the last day before half term');
    assert.equal(isSchoolDay('2026-11-02', CLOSURES), true, 'the first day back');
  });

  await t.test('closureOn names the closure covering a date', () => {
    assert.equal(closureOn('2026-10-21', CLOSURES).label, 'October half term');
    assert.equal(closureOn('2026-10-16', CLOSURES), null);
  });
});

test('timetable days are tagged with the closure that shuts them', async (t) => {
  const week = [
    { date: '2026-09-21', weekday: 'Monday', lessons: [] },
    { date: '2026-09-25', weekday: 'Friday', lessons: [] },
  ];

  await t.test('an open day carries no closure', () => {
    assert.equal(markClosures(week, CLOSURES)[0].closure, null);
  });

  await t.test('a shut day carries the one that shut it', () => {
    assert.equal(markClosures(week, CLOSURES)[1].closure.label, 'Teaching staff and pupils not in school');
  });

  await t.test('the original days are not mutated', () => {
    markClosures(week, CLOSURES);
    assert.equal('closure' in week[0], false);
  });

  await t.test('with no closures loaded nothing is marked, rather than everything', () => {
    assert.deepEqual(markClosures(week, []).map((d) => d.closure), [null, null]);
  });
});

test('school days left is what a deadline actually gives you', async (t) => {
  await t.test('weekends do not count', () => {
    // Saturday 19th to Wednesday 23rd: Monday and Tuesday only.
    assert.equal(schoolDaysUntil('2026-09-23', CLOSURES, SATURDAY), 2);
  });

  await t.test('a closure in the way removes its days', () => {
    const withBreak = schoolDaysUntil('2026-11-03', CLOSURES, new Date(2026, 9, 16));
    assert.equal(withBreak, 2, 'a fortnight of half term leaves two days');
  });

  await t.test('the due date itself is not counted — it cannot be worked on', () => {
    assert.equal(schoolDaysUntil('2026-09-21', CLOSURES, SATURDAY), 0);
  });

  await t.test('a date already gone is nought, not negative', () => {
    assert.equal(schoolDaysUntil('2026-09-01', CLOSURES, SATURDAY), 0);
  });

  await t.test('an undated task has no answer rather than a wrong one', () => {
    assert.equal(schoolDaysUntil(null, CLOSURES, SATURDAY), null);
  });
});

test('the break between now and a deadline is named', async (t) => {
  await t.test('a holiday in the way is found', () => {
    assert.equal(breakBefore('2026-11-03', CLOSURES, new Date(2026, 9, 16)).label, 'October half term');
  });

  await t.test('a closure after the deadline is not', () => {
    assert.equal(breakBefore('2026-10-15', CLOSURES, new Date(2026, 9, 12)), null);
  });

  await t.test('a closure already finished is not', () => {
    assert.equal(breakBefore('2026-09-30', CLOSURES, new Date(2026, 8, 28)), null,
      'the staff day on the 25th has gone by the 28th');
  });

  await t.test('work already due has nothing ahead of it', () => {
    assert.equal(breakBefore('2026-09-18', CLOSURES, SATURDAY), null);
  });
});

test('closures read the way a parent would say them', async (t) => {
  await t.test('the next one is the next one not yet finished', () => {
    assert.equal(nextClosure(CLOSURES, SATURDAY).start, '2026-09-25');
  });

  await t.test('a closure running today is still the next one', () => {
    assert.equal(nextClosure(CLOSURES, new Date(2026, 9, 21)).label, 'October half term');
  });

  await t.test('one day reads as a date, several as a span', () => {
    assert.equal(closureDates({ start: '2026-09-25', end: '2026-09-25' }), 'Fri 25 Sept');
    assert.equal(closureDates({ start: '2026-10-19', end: '2026-10-30' }), 'Mon 19 Oct – Fri 30 Oct');
  });

  await t.test('how far off it is, in words', () => {
    assert.equal(closureWhen({ start: '2026-09-25', end: '2026-09-25' }, SATURDAY), 'In 6 days');
    assert.equal(closureWhen({ start: '2026-09-20', end: '2026-09-20' }, SATURDAY), 'Tomorrow');
    assert.equal(closureWhen({ start: '2026-09-19', end: '2026-09-19' }, SATURDAY), 'On now');
    assert.equal(closureWhen({ start: '2026-09-01', end: '2026-09-03' }, SATURDAY), '',
      'a closure already gone says nothing — the dimming carries it');
    assert.equal(closureWhen({ start: '2026-10-19', end: '2026-10-30' }, SATURDAY), 'In 4 weeks');
  });
});
