/**
 * Provider template — copy this file to add another school system.
 *
 *   cp src/providers/_template.mjs src/providers/myschool.mjs
 *
 * Files starting with "_" are ignored by the loader, so this one never runs.
 * Restart the server and the new provider's routes mount automatically at
 * /api/<id>/<route path>, and appear in the /api index.
 */
import { withSession, dismissCookieBanner } from '../browser.mjs';
import { htmlToText } from '../html.mjs';

export default {
  /** Used in the URL: /api/myschool/... — lowercase, no spaces. */
  id: 'myschool',
  label: 'My School Portal',

  /**
   * Env keys this provider needs, read from ~/.satchel.env (or .env here).
   * The route refuses with 503 rather than half-working when any are absent,
   * and /api/health reports it as unconfigured.
   */
  credentials: ['MYSCHOOL_USER', 'MYSCHOOL_PASS'],

  routes: [
    {
      path: '/notices',
      summary: 'What this route returns, shown in the /api index',
      ttl: 600, // seconds; 0 disables caching. ?refresh=1 always bypasses it.
      params: {
        // `env` names a fallback env var; `required` rejects with 400 when absent.
        student: { required: false, env: 'STUDENT_ID', description: 'Student id' },
        since: { default: null, description: 'ISO date' },
      },

      /**
       * ctx gives you: params, refresh, env, log, and withSession.
       * Return plain JSON — the server wraps it with cache and timing metadata.
       */
      async handler(ctx) {
        // --- Option A: the site has a JSON API (preferred — fast, stable) ---
        // const res = await fetch('https://api.myschool.test/notices', {
        //   headers: { authorization: `Bearer ${await getToken(ctx)}` },
        // });
        // return res.json();

        // --- Option B: scrape it with a real browser session ---
        return ctx.withSession(async ({ page, saveSession, hasSession }) => {
          await page.goto('https://myschool.test/notices', { waitUntil: 'domcontentloaded' });
          await dismissCookieBanner(page);

          if (page.url().includes('/login')) {
            ctx.log('session expired, signing in');
            await page.fill('#username', ctx.env.MYSCHOOL_USER);
            await page.fill('#password', ctx.env.MYSCHOOL_PASS);
            await page.click('button[type="submit"]');
            await page.waitForLoadState('networkidle');
            await saveSession(); // cookies persist to data/auth/myschool.json
          }

          const items = await page.$$eval('.notice', (els) =>
            els.map((el) => ({
              title: el.querySelector('h3')?.textContent?.trim() || '',
              html: el.querySelector('.body')?.innerHTML || '',
              date: el.querySelector('time')?.getAttribute('datetime') || null,
            }))
          );
          return { notices: items.map((n) => ({ ...n, text: htmlToText(n.html) })) };
        });
      },
    },
  ],

  /**
   * Optional. Implement this and your items join the merged /api/tasks feed
   * that the web UI renders — no UI changes needed for a new provider.
   * Return objects in the shared shape:
   *
   *   id          `${provider}:${nativeId}` — stable across re-scrapes
   *   source      provider id
   *   title       short name
   *   subject     optional
   *   teacher     optional
   *   dueOn       'YYYY-MM-DD' or null
   *   issuedOn    'YYYY-MM-DD' or null
   *   completed   boolean, as the source system sees it
   *   description plain text
   *   links       [{ url, label }]
   *   url         link back to the source
   *   student     { id, name }
   */
  // async tasks(ctx) {
  //   const { notices } = await this.routes[0].handler(ctx);
  //   return notices.map((n) => ({ ... }));
  // },

  /**
   * Optional. For anything measured against a target rather than ticked off —
   * minutes practised, books read, laps run. Each metric becomes a card at the
   * top of the homework page. See src/providers/ttrockstars.mjs for a real one.
   *
   *   id          `${provider}:${what}`
   *   label       full name; shortLabel heads the card
   *   subject     drives the colour, like a task's subject
   *   value       what has been done, in `unit`
   *   target      what was asked for
   *   period      { start, end, label } — the span the value covers
   *   days        [{ date, weekday, minutes }] — served by the api, not drawn
   *   detail      [{ label, value }] shown as a footnote line
   *   url         link back to the source
   */
  // async stats(ctx) {
  //   return [{ id: 'myschool:weekly-minutes', label: 'My School', value: 8, target: 30, unit: 'min' }];
  // },
};
