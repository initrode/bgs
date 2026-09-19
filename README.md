# Homework board

A local web app that pulls homework out of the school systems we use and shows
it on one board. Satchel One (homework and timetable) and Times Table Rock
Stars (maths practice) are wired up; everything else is a file you drop in
`src/providers/`.

```bash
npm install
node server.mjs
# board →  http://localhost:4000
# api   →  http://localhost:4000/api
```

## Credentials

Nothing is committed. Put them in `~/.satchel.env` (or `.env` here, which wins):

```bash
SCHOOL="Your School Name"
SATCHEL_USER="parent@example.com"
SATCHEL_PASS="your-password"
SATCHEL_USER_TYPE="parent"      # parent | student | staff
STUDENT_ID="1234567"            # or STUDENT_IDS="123,456" for several children

TTRS_SCHOOL="1234"              # the number in play.ttrockstars.com/login/<id>
TTRS_USER="username"
TTRS_PASS="1234"                # the four-digit PIN
TTRS_WEEKLY_MINUTES=30          # what the school expects a week (default 30)
TTRS_TIMEZONE="Europe/London"   # the school's own timezone (default Europe/London)
PORT=4000
```

Real environment variables override the file, so `PORT=5000 node server.mjs` works.

## How a provider works

A provider is one file exporting one object. Drop it in `src/providers/`,
restart, and its routes mount themselves — no wiring anywhere else.

```js
export default {
  id: 'myschool',                       // → /api/myschool/...
  label: 'My School Portal',
  credentials: ['MYSCHOOL_USER', 'MYSCHOOL_PASS'],
  routes: [{
    path: '/notices',                   // → GET /api/myschool/notices
    summary: 'Shown in the /api index',
    ttl: 600,                           // cache seconds; ?refresh=1 bypasses
    params: { student: { required: true, env: 'STUDENT_ID' } },
    handler: async (ctx) => ({ … }),
  }],
  async tasks(ctx) { … },               // optional: join the merged feed
};
```

`src/providers/_template.mjs` is a commented skeleton — copy it. Files starting
with `_` are never loaded.

**`ctx` gives you:**

| | |
|---|---|
| `ctx.params` | validated route params, with env fallbacks applied |
| `ctx.env` | merged credentials |
| `ctx.refresh` | true when the caller asked to bypass the cache |
| `ctx.withSession(fn)` | a Playwright page with this provider's saved cookies |
| `ctx.log(...)` | prefixed server logging |

There are three optional feeds. Implement `tasks()` and your items appear on the
homework page; implement `timetable(ctx)` and your lessons merge into the
timetable page beside everyone else's, keyed by date and sorted by start time:

```js
async timetable(ctx) {
  return {
    student: { id, name },
    week: { startDate: '2026-09-14', previousWeek: '2026-09-07', nextWeek: '2026-09-21' },
    days: [{ date: '2026-09-14', weekday: 'Monday', lessons: [
      { id, subject, group, room, teacher, startsAt: '10:00', endsAt: '10:50', dueTasks: [] },
    ] }],
    lessonCount: 1,
  };
}
```

`ctx.params.week` is the Monday the user is looking at. Times are strings, not
timestamps — see the note on dates below.

Both views share one page shell — the same column width, so the header, tabs
and footer sit in the same place and nothing shifts when you switch between
them. Only the week's grid breaks out of that column, symmetrically about the
centre, to give five days room.

The timetable columns magnify like the macOS Dock: the day in focus takes the
most room and the rest taper off and fade back, and the swell follows the
pointer or keyboard focus across the week. Below 900px the week stacks and the
magnification switches off.

"This week" means the week a parent means. Once Friday has gone, Saturday and
Sunday roll forward to the week ahead (`schoolWeekOf`), so a weekend opens on
next Monday rather than on days already spent.

Homework is cross-referenced onto the lessons it is due in. A task due on a
date is matched to that day's first lesson in the same subject and marked with
an **[H]**, which opens a panel with the brief, time estimate, attachment count
and a link. Subjects are matched on a normalised key, so `PD-English` on the
timetable and `English` on a task are the same subject. Anything with no
matching lesson is still listed at the foot of the day rather than dropped.

Implement `tasks()` and your items appear on the board automatically — the UI
renders the shared shape, not anything Satchel-specific. Return objects with
`id` (`provider:nativeId`), `title`, `dueOn`, `completed`, `description`,
`links`, `url`, `student`, and optionally `subject`, `teacher`, `estimateMinutes`.
Subject colours are derived from the subject name, so new subjects colour
themselves.

The third feed is `stats(ctx)`, for anything measured against a target rather
than ticked off — minutes practised, books read, laps run. Return an array;
each metric becomes a card at the top of the homework page:

```js
async stats(ctx) {
  return [{
    id: 'myschool:weekly-minutes',
    label: 'My School Practice',
    shortLabel: 'Practice',           // what the card is headed
    subject: 'Maths',                 // drives the colour, like a task's subject
    value: 8, target: 30, unit: 'min',
    met: false, remaining: 22,
    period: { start: '2026-09-14', end: '2026-09-20', label: 'This week' },
    days: [{ date: '2026-09-14', weekday: 'Mon', minutes: 0 }, …],  // carried by the api
    detail: [{ label: 'Days played', value: '2 of 7' }],            // the footnote line
    url: 'https://…',                 // "Show original"
  }];
}
```

The card is tinted by how the week is going, on one continuous spectrum: red
while barely anything has been done, warming through amber, green once the
target is met (`toneHue` in `public/task-utils.js`). The bands are fractions of
the target, not fixed minutes, so a different target keeps the same meaning.
The hue is passed to the CSS as a single number, and each theme derives its own
readable tint from it.

`days` is not drawn on the card — the card is the two numbers, the bar and the
footnote line — but it rides along in `/api/stats` for anything that wants the
week day by day. A source that fails takes only its own card down: practice is
fetched separately from the homework, so Rock Stars being offline never empties
the board.

## Routes

Each view is a url of its own, so a refresh, a bookmark or a shared link opens
the page you meant. One document serves both; the client reads the path
(`viewForPath` in `public/task-utils.js`) and shows that view, and the tabs are
ordinary links that update history rather than swapping a panel behind the
url's back.

| Page | What |
|---|---|
| `GET /` | the homework board |
| `GET /timetable` | the week's lessons |
| `GET /termdates` | the year's term dates and closures |
| `GET /homework` | redirects to `/` |

| Route | What |
|---|---|
| `GET /api` | index of every provider, route, and parameter |
| `GET /api/health` | which providers are configured, session expiry |
| `GET /api/tasks` | merged normalised feed — `?source=`, `?due=overdue\|upcoming`, `?done=false`, `?refresh=1` |
| `GET /api/timetable` | one week of lessons merged across providers — `?week=YYYY-MM-DD`, `?source=`, `?refresh=1` |
| `GET /api/stats` | practice targets merged across providers — `?week=YYYY-MM-DD`, `?source=`, `?refresh=1` |
| `GET /api/satchelone/todos` | `?student=&from=&to=` |
| `GET /api/satchelone/homework` | `?id=` — full brief, attachments, duration |
| `GET /api/satchelone/timetable` | `?student=&week=` — a week of lessons |
| `GET /api/satchelone/students` | configured students |
| `GET /api/ttrockstars/stats` | `?week=` — minutes this week against the target |
| `GET /api/ttrockstars/history` | `?from=&to=` — one row per day: minutes, games, questions, coins |
| `GET /api/ttrockstars/student` | who the account belongs to, and coins earned |
| `PUT /api/state/:taskId` | your own tick or note, e.g. `{"done":true}` |
| `GET /api/attachments` | every file downloaded so far |
| `POST /api/attachments/download` | save a task's files — `{"taskId":"satchelone:12345678"}`, optionally `attachmentId` or `force` |
| `GET /files/...` | the saved files, served read-only |
| `POST /api/cache/clear` | drop cached responses (`?prefix=satchelone`) |
| `POST /api/satchelone/session/reset` | forget cookies, force a fresh login |

Every data route answers with the same envelope:

```json
{ "source": "satchelone", "route": "/todos", "params": {…},
  "cached": true, "ageSeconds": 42, "fetchedAt": "…", "data": {…} }
```

## Attachments

Tasks carry the files the teacher attached. The feed lists them with filename,
type and size, and says whether each one is already on this machine:

```json
"attachments": [
  { "id": 123456789, "filename": "example_file.mp3", "contentType": "audio/mpeg",
    "bytes": 3333224, "url": "https://…", "downloaded": true,
    "localUrl": "/files/satchelone/satchelone%3A12345678/123456789-example_file.mp3" }
]
```

Click **Save files to this machine** on a card, or:

```bash
curl -X POST localhost:4000/api/attachments/download \
  -H 'content-type: application/json' \
  -d '{"taskId":"satchelone:12345678"}'
```

Files land in `data/attachments/<source>/<task id>/<attachment id>-<filename>`
and are served at `/files/...`, so an MP3 plays and a PDF opens straight from
the board. Downloads are idempotent — an existing file of the right size is
left alone unless you pass `force`. Writes go to a `.part` file and are renamed
on completion, so an interrupted download never looks like a finished one.
`MAX_ATTACHMENT_BYTES` caps the size (100 MB by default).

The browser never says what to fetch: it sends a task id, and the server looks
up the urls the school gave us. To add downloads to another provider, just put
`attachments: [{ id, filename, contentType, bytes, url }]` on the tasks it
returns — the download layer, the API and the UI are provider-agnostic.

## Typography

The board is set in Neue Haas Grotesk where it is installed, falling back to
Helvetica Neue — its direct descendant, and on every Mac — and then to Inter
from Google Fonts for machines with neither. One grotesk carries headings and
body alike; what separates them is weight and tracking, not family.

There is no monospace anywhere on the board. Numbers (dates, times, counts, the
stat tiles) are set in the same grotesk with `font-variant-numeric: tabular-nums`,
which keeps columns of figures aligned — Helvetica's own figures are already
fixed-width. Labels are told apart from values by weight, tracking and size:
micro-caps carry 500 and .1em of tracking, values carry 500 at a larger size
and slightly negative tracking. The two stacks are `--display` and `--sans` in
`public/styles.css`.

Only three weights are used — 400, 500 and 700 — because those are the ones
Helvetica Neue actually has. Asking for 600 silently renders as Bold on a Mac
but as a real semibold in the Inter fallback, so the same page would have had
two different hierarchies depending on the machine.

Form controls are the usual way a stray Arial gets in: a browser sets buttons,
inputs and selects in its own font unless told otherwise, so
`button, input, select, textarea` inherit explicitly.

## Term dates and closures

The school publishes its term dates as a flattened image PDF — no text layer,
no calendar feed, nothing to parse — so they are typed out by hand into
`public/closures.json` and read straight from there by the browser. No
provider, no API, no cache: static data for something that changes once a
year. Edit that one file when the school issues a new sheet; the source URL
and the date it was transcribed are recorded in it.

What the board does with them:

- **The timetable greys out days school is shut**, with the reason under the
  day's heading. The lessons stay on screen, faded — a timetable is a
  repeating pattern and it is useful to see what would have happened.
- **The "Term dates" tab** lists the whole year, with the next closure called
  out in red and the ones gone by dimmed.
- **Homework gets a warning when a break sits between now and its due date**,
  but only when the time left is genuinely short (5 school days or fewer).
  Work set on 16 October and due on 3 November looks like eighteen days and is
  two. A staff day three weeks ahead of a deadline is not a warning, it is
  noise, so it stays quiet.

`test/closures.test.mjs` checks the file itself as well as the logic: every
closure a valid pair of ISO dates the right way round, none overlapping, terms
in order, and spot checks of the dates against the published sheet so a
careless edit is caught.

## Dates and times

Everything date-shaped is handled as a string and never round-tripped through
UTC. School systems report local school time, and `new Date(x).toISOString()`
turns midnight BST into 23:00 the previous day — which silently moved every due
date a day earlier for half the year, and would move an 08:45 lesson to 07:45.
`src/dates.mjs` holds the helpers; use them rather than raw `Date` arithmetic,
and note that `shiftDays` counts calendar days, because adding
`n * 86400000` milliseconds loses an hour — and sometimes a whole day — across
a clock change.

## How the Satchel provider works

The site is a SPA over a JSON API at `api.satchelone.com`. Playwright is used
**only** to sign in and lift the API token (`smhw_token`) out of the session;
after that every call is a plain `fetch`. Tokens last ~30 days and live in
`data/auth/`, so a browser normally starts once a month.

Two quirks worth knowing if you extend it:

- The API needs `accept: application/smhw.v2021.5+json` and `x-platform: web`,
  and rejects requests without a satchelone.com `origin`. Without these it
  returns 500, not a useful error.
- The timetable lives at `/timetable/school/<school id>/student/<student id>?requestDate=<Monday>`.
  The school id comes from the saved session, and `requestDate` must be a Monday.
- Task detail carries `attachment_ids`, not attachments. `/attachments?ids[]=…`
  resolves a whole task's ids in one call. The `file_url` it returns points at
  a public CDN and needs no authentication.
- `/todos` truncates each description to ~100 characters, mid-tag. The provider
  refetches the full brief per task from the detail endpoint (5 at a time) —
  set `SATCHEL_ENRICH=0` to skip that and take the previews.

## How the Rock Stars provider works

Times Table Rock Stars is an Angular app over a JSON API. As with Satchel, the
browser is used only to sign in — username, then the four-digit PIN on the
on-screen keypad — after which the JWT it issues drives plain `fetch` calls.

The token lasts an hour, so the provider spends one before reaching for a
browser: a saved token that is still good is used as it is, one close to expiry
is swapped at `/auth3/token/refresh`, and only an unusable one costs a login
(about three seconds).

Quirks worth knowing:

- **The app will not start while `navigator.webdriver` is set.** It sits on its
  loading spinner for ever, with no error anywhere — the login form never
  paints. The provider clears the flag before the page loads.
- The login screen lives at `/auth/school/student/<id>`, which contains
  `/school/student/` — waiting for that substring matches the page you are
  trying to leave. Wait for a path that *starts* `/school/student/`.
- The PIN keypad is not a text field. The keys are `div.key-pin[aria-label="7"]`,
  and typing on the keyboard does nothing.
- Day rows carry `utcDate` and `orgTzDate`. `utcDate` is 23:00 the day before
  through British Summer Time, so it files a session under the wrong day; use
  `orgTzDate`. Today's row is sent without one, and has to be derived from the
  row's `id`, which is the school-timezone midnight as an epoch.
- The week asked for is the week containing today, not the homework board's
  "school week" — a Saturday still counts towards the 30 minutes, and rolling
  the weekend forward would report a fresh nought with a day left to play.

## Tests

```bash
npm test              # everything, no network, ~1s
npm run test:watch    # rerun on change
LIVE=1 npm test       # also check Satchel's API still matches the provider
```

Node's built-in runner — no test framework to install. Every run uses a
throwaway data directory, so tests never touch real cookies, tokens, cached
responses or your ticks, and `fetch` is stubbed, so nothing leaves the machine.

| File | Covers |
|---|---|
| `test/dates.test.mjs` | timezone handling — the BST day-shift class of bug |
| `test/html.test.mjs` | turning teachers' pasted markup into readable text |
| `test/cache.test.mjs` | ttl expiry, key collisions, prefix clearing, corrupt files |
| `test/state.test.mjs` | your ticks, and how they override what the school reports |
| `test/satchelone.test.mjs` | normalising, truncation detection, enrichment, concurrency |
| `test/registry.test.mjs` | provider loading, parameter validation, cache envelope, fan-out |
| `test/api.test.mjs` | the HTTP surface end to end, against a fake provider, including the page routes |
| `test/downloads.test.mjs` | saving attachments — path safety, resume, size checks, listing |
| `test/ttrockstars.test.mjs` | day dates across BST, minute rounding, week filling, the session ladder, the metric shape |
| `test/closures.test.mjs` | the term dates file, school-day counting, and breaks before a deadline |
| `test/timetable.test.mjs` | week arithmetic, lesson times, merging, the endpoint, day focus, homework matching |
| `test/board.test.mjs` | the board's own logic — grouping, filters, counts, escaping, url routing |
| `test/contract.live.test.mjs` | the real API's shape (skipped unless `LIVE=1`) |

Each bug found so far has a named regression test, so it cannot come back
quietly:

- due dates shifting a day earlier during British Summer Time
- `shiftDays` losing a day across the end of BST
- truncated previews leaving an unterminated `<p class="` visible on the card
- the ellipsis marker being stripped before truncation was detected, so full
  briefs were never fetched
- `FlexibleTask` detail payloads using a different key to `Homework`

The board and the server share their date logic through matching helpers, and a
test asserts the two agree — a browser that disagreed with the server about
which Monday a day belongs to would show the wrong week.

### Testing a provider you have added

Give it a fixture of a real response, then assert on the normalised output:

```js
import { freshImport, stubFetch, tempDataDir } from './helpers.mjs';

test('my provider normalises a notice', async (t) => {
  tempDataDir(t);
  stubFetch(t, { '/notices': { body: myFixture } });
  const provider = await freshImport('../src/providers/myschool.mjs');
  const [task] = await provider.default.tasks({ log() {}, env: {} });
  assert.equal(task.dueOn, '2026-09-22');
});
```

`test/helpers.mjs` gives you `tempDataDir` (disposable data directory),
`stubFetch` (a routing table plus a record of what was called), `serve`
(an app on an ephemeral port) and `fakeProvider`.

## CI

Every push and pull request runs `.github/workflows/ci.yml`:

| Stage | What | Command |
|---|---|---|
| Install | exact tree from the shrinkwrap file — fails if `package.json` and the lockfile have drifted | `npm ci` |
| Lockfile integrity | every resolved package comes from `registry.npmjs.org` over https | `npm run lockfile:check` |
| Lint | `eslint.config.js` — Node globals for `src/`/`server.mjs`/`test/`, browser globals for `public/` | `npm run lint` |
| Test | the full suite, no network | `npm test` |
| Dependency audit | fails on any high/critical advisory | `npm run audit` |
| Registry signatures | every installed package has a verified npm signature | `npm audit signatures` |
| Secret scan | `gitleaks` over the full history on each run | — |

These are the same commands you can run locally before pushing. `npm run audit`
and the secret scan are the two checks not fully pinned to this repo's content —
a new CVE disclosure or a leaked-looking string can flip a previously green
commit, which is the point of running them on every push rather than once.

### Dependencies are shrinkwrapped

`npm-shrinkwrap.json` (not `package-lock.json` — `npm shrinkwrap` replaces it,
and npm ignores the latter when both exist) pins the exact resolved version of
every dependency, direct and transitive. `package.json` itself also pins exact
versions (no `^`/`~`), so a `git diff` on it always tells you the real change.
Regenerate after adding or upgrading a package:

```bash
npm install <pkg>@<version>
npm shrinkwrap
```

## Data

`data/` is gitignored and holds everything stateful:

```
data/auth/<provider>.json        cookies (chmod 600)
data/auth/<provider>.token.json  API token + expiry (chmod 600)
data/cache/                      cached responses
data/state.json                  your ticks and notes
data/attachments/                downloaded files, served at /files
```

`HEADFUL=1 node server.mjs` runs the browser visibly — useful when a login
starts failing and you need to see why.
