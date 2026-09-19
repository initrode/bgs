import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, daysUntil, shiftDays, todayISO, localISO } from '../src/dates.mjs';

test('isoDate keeps the date the school wrote, across BST', async (t) => {
  await t.test('midnight BST does not slip to the previous day', () => {
    // Regression: toISOString() turned this into 2026-09-21T23:00:00Z,
    // so every due date in British Summer Time was a day early.
    assert.equal(isoDate('2026-09-22T00:00:00+01:00'), '2026-09-22');
    assert.equal(isoDate('2026-09-21T00:00:00+01:00'), '2026-09-21');
    assert.equal(isoDate('2026-09-09T00:00:00+01:00'), '2026-09-09');
  });

  await t.test('handles GMT, UTC and bare dates alike', () => {
    assert.equal(isoDate('2026-11-03T00:00:00+00:00'), '2026-11-03');
    assert.equal(isoDate('2026-11-03T00:00:00Z'), '2026-11-03');
    assert.equal(isoDate('2026-11-03'), '2026-11-03');
  });

  await t.test('a late-evening timestamp keeps its own date', () => {
    assert.equal(isoDate('2026-09-22T23:30:00+01:00'), '2026-09-22');
  });

  await t.test('returns null rather than guessing', () => {
    assert.equal(isoDate(null), null);
    assert.equal(isoDate(''), null);
    assert.equal(isoDate(undefined), null);
    assert.equal(isoDate('not a date'), null);
  });
});

test('daysUntil counts calendar days, not elapsed hours', async (t) => {
  const now = new Date(2026, 8, 19, 23, 30); // 19 Sept, late evening

  await t.test('future, today and past', () => {
    assert.equal(daysUntil('2026-09-22', now), 3);
    assert.equal(daysUntil('2026-09-20', now), 1);
    assert.equal(daysUntil('2026-09-19', now), 0);
    assert.equal(daysUntil('2026-09-18', now), -1);
    assert.equal(daysUntil('2026-09-09', now), -10);
  });

  await t.test('late at night still reads as today, not tomorrow', () => {
    // A naive (due - now) / 86400000 would round 30 minutes up to 1.
    assert.equal(daysUntil('2026-09-19', new Date(2026, 8, 19, 23, 59)), 0);
    assert.equal(daysUntil('2026-09-19', new Date(2026, 8, 19, 0, 1)), 0);
  });

  await t.test('spans a month and a year boundary', () => {
    assert.equal(daysUntil('2026-10-01', new Date(2026, 8, 30)), 1);
    assert.equal(daysUntil('2027-01-01', new Date(2026, 11, 31)), 1);
  });

  await t.test('survives the clocks going back', () => {
    // BST ends 25 Oct 2026; a UTC-based diff would report 4 or 6 here.
    assert.equal(daysUntil('2026-10-28', new Date(2026, 9, 23)), 5);
  });

  await t.test('undated tasks give null, not zero', () => {
    assert.equal(daysUntil(null, now), null);
    assert.equal(daysUntil('rubbish', now), null);
  });
});

test('shiftDays and todayISO stay on the local calendar', async (t) => {
  await t.test('window edges', () => {
    const now = new Date(2026, 8, 19);
    assert.equal(shiftDays(0, now), '2026-09-19');
    assert.equal(shiftDays(-30, now), '2026-08-20');
    assert.equal(shiftDays(120, now), '2027-01-17');
  });

  await t.test('pads months and days to two digits', () => {
    assert.equal(localISO(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(todayISO(new Date(2026, 11, 31)), '2026-12-31');
  });
});
