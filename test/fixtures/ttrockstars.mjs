/** Day rows exactly as nest.ttrockstars.com returns them. */

/** A completed day: the school's own date is sent, and utcDate is an hour behind it. */
export const dayPlayed = {
  id: 1789686000,
  utcDate: '2026-09-17 23:00:00',
  orgTzDate: '2026-09-18 00:00:00',
  numGames: 3,
  numCorrect: 95,
  numIncorrect: 8,
  secondsPlayed: 420,
  totalSecondsPlayed: 420,
  average: 2884.39,
  numCoins: 671,
};

export const dayQuiet = {
  id: 1789513200,
  utcDate: '2026-09-15 23:00:00',
  orgTzDate: '2026-09-16 00:00:00',
  numGames: 0,
  numCorrect: 0,
  numIncorrect: 0,
  secondsPlayed: 0,
  totalSecondsPlayed: 0,
  average: 0,
  numCoins: 0,
};

export const dayMinute = {
  id: 1789599600,
  utcDate: '2026-09-16 23:00:00',
  orgTzDate: '2026-09-17 00:00:00',
  numGames: 1,
  numCorrect: 25,
  numIncorrect: 0,
  secondsPlayed: 60,
  totalSecondsPlayed: 60,
  average: 2360.68,
  numCoins: 250,
};

/** Today's row arrives without orgTzDate — the date has to come from the epoch. */
export const dayToday = {
  id: 1789772400, // 2026-09-19 00:00 in Europe/London
  utcDate: '2026-09-18 23:00:00',
  numGames: 0,
  numCorrect: 0,
  numIncorrect: 0,
  secondsPlayed: 0,
  totalSecondsPlayed: 0,
  average: 0,
  numCoins: 0,
};

export const week = [dayQuiet, dayMinute, dayPlayed, dayToday];

/** A JWT with the claims the provider reads. Unsigned — nothing verifies it. */
export function jwt({ sub = 20553110, exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ sub, rid: 3, oid: 4375, exp })}.signature`;
}

export const user = {
  id: 20553110,
  firstName: 'Alex',
  lastName: 'Paton',
  username: 'alepat',
  ttrs: { rockname: 'Phil Shaddix', coins: 146, totalCoins: 5646 },
};
