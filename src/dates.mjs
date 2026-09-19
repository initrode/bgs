/**
 * Date handling is deliberately string-first. School systems report local
 * school time, and round-tripping that through UTC shifts every date backwards
 * for half the year (midnight BST is 23:00 the previous day in UTC).
 */

/** The date as the school wrote it, never re-interpreted through a timezone. */
export function isoDate(value) {
  if (!value) return null;
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return localISO(d);
}

/** Calendar date in the machine's own timezone. */
export function localISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const todayISO = (now = new Date()) => localISO(now);

/**
 * Calendar arithmetic, not elapsed milliseconds: adding 120 * 86400000 across
 * the end of BST lands an hour short and silently loses a day.
 */
export function shiftDays(days, now = new Date()) {
  return localISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

/** Whole days from today to an ISO date; negative is overdue. */
export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / 86400000);
}

/** The Monday of the week containing `date` (ISO in, ISO out). */
export function mondayOf(value = new Date()) {
  const iso = typeof value === 'string' ? value : localISO(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const shift = (d.getDay() + 6) % 7; // Sunday counts as the end of the week
  d.setDate(d.getDate() - shift);
  return localISO(d);
}

/** Weekday name for an ISO date, without timezone round-tripping. */
export function weekdayOf(iso, locale = 'en-GB', format = 'long') {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(locale, { weekday: format });
}

/**
 * The week a parent means by "this week". Once Friday has gone, the useful
 * week is the one ahead, so Saturday and Sunday roll forward to Monday.
 */
export function schoolWeekOf(value = new Date()) {
  const iso = typeof value === 'string' ? value : localISO(value);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = d.getDay();
  if (day === 0 || day === 6) {
    d.setDate(d.getDate() + (day === 6 ? 2 : 1));
    return localISO(d);
  }
  return mondayOf(iso);
}
