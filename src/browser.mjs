import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { dataDir, HEADLESS } from './config.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const authFile = (providerId) => path.join(dataDir('auth'), `${providerId}.json`);

/**
 * Runs `fn` against a Playwright page that reuses this provider's saved
 * cookies, so the scrape only pays for a login when the session has expired.
 *
 *   await withSession('satchelone', async ({ page, saveSession, hasSession }) => {
 *     await page.goto(url);
 *     if (isLoginPage(page)) { await doLogin(page); await saveSession(); }
 *     return scrape(page);
 *   });
 */
export async function withSession(providerId, fn) {
  const file = authFile(providerId);
  const browser = await chromium.launch({ headless: HEADLESS });
  try {
    const context = await browser.newContext({
      storageState: fs.existsSync(file) ? file : undefined,
      viewport: { width: 1400, height: 1200 },
      userAgent: UA,
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    const page = await context.newPage();
    const saveSession = async () => {
      await context.storageState({ path: file });
      fs.chmodSync(file, 0o600);
    };
    return await fn({ page, context, saveSession, hasSession: fs.existsSync(file) });
  } finally {
    await browser.close();
  }
}

export function forgetSession(providerId) {
  const file = authFile(providerId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}

/** Best-effort dismissal of the cookie banners these sites all share. */
export async function dismissCookieBanner(page) {
  for (const sel of ['#cookiescript_accept', 'button:has-text("Accept all")', 'button:has-text("Accept All")', 'button:has-text("Accept")']) {
    const el = page.locator(sel).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}
