/**
 * A drop-in replacement for `fetch` that logs every outbound request and its
 * outcome to stdout — method, url, status and timing (or the error, if it
 * never got a response) — so what this app actually sent and got back is
 * visible without attaching a debugger.
 */
export function makeLoggedFetch(log = console.log) {
  return async function loggedFetch(url, options = {}) {
    const method = options.method || 'GET';
    const started = Date.now();
    log(`→ ${method} ${url}`);
    try {
      const res = await fetch(url, options);
      log(`← ${res.status} ${method} ${url} (${Date.now() - started}ms)`);
      return res;
    } catch (err) {
      log(`✗ ${method} ${url} — ${err.message} (${Date.now() - started}ms)`);
      throw err;
    }
  };
}

export const loggedFetch = makeLoggedFetch();
