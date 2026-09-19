import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Every test runs against a throwaway data directory, so nothing here can
 * touch real cookies, tokens, cached responses or your ticks.
 */
export function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homework-board-test-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  });
  return dir;
}

/** Imports a module fresh, so module-level state doesn't leak between tests. */
export const freshImport = (spec) => import(`${spec}?t=${Math.random()}`);

/** Replaces global fetch with a routing table, and records what was called. */
export function stubFetch(t, routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    for (const [pattern, reply] of Object.entries(routes)) {
      if (href.includes(pattern)) {
        const r = typeof reply === 'function' ? await reply(href, options) : reply;
        const { status = 200, body = {} } = r ?? {};
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
    }
    throw new Error(`Unstubbed request in test: ${href}`);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

/** Starts an app on an ephemeral port and returns its base URL. */
export async function serve(t, app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

export async function getJSON(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

/** A provider with no network and no credentials, for exercising the registry. */
export function fakeProvider(overrides = {}) {
  return {
    id: 'fake',
    label: 'Fake School',
    credentials: [],
    routes: [{
      path: '/things',
      summary: 'Test route',
      ttl: 0,
      params: { who: { required: false, default: 'nobody' } },
      handler: async (ctx) => ({ who: ctx.params.who, at: Date.now() }),
    }],
    ...overrides,
  };
}
