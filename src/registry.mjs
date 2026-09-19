import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import * as cache from './cache.mjs';
import { hasEnv, env } from './config.mjs';
import { withSession, forgetSession } from './browser.mjs';

const PROVIDER_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'providers');

export const providers = new Map();

/** Validates a provider and adds it to the registry. */
export function register(provider, file = '(inline)') {
  if (!provider?.id) throw new Error(`${file}: provider must export a default object with an "id"`);
  if (providers.has(provider.id)) throw new Error(`${file}: duplicate provider id "${provider.id}"`);
  provider.routes ||= [];
  provider.credentials ||= [];
  provider.file = provider.file || file;
  providers.set(provider.id, provider);
  return provider;
}

/**
 * Loads every provider in src/providers. Files beginning with "_" are
 * templates and never load. Pass an array to register those instead of
 * scanning disk — that is how the tests supply fakes.
 */
export async function loadProviders(list = null) {
  providers.clear();
  if (list) {
    for (const p of list) register(p);
    return providers;
  }
  const files = fs.readdirSync(PROVIDER_DIR).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(PROVIDER_DIR, file)).href + `?t=${Date.now()}`);
    register(mod.default, file);
  }
  return providers;
}

function buildContext(provider, params, { refresh }) {
  return {
    params,
    refresh,
    env,
    provider,
    withSession: (fn) => withSession(provider.id, fn),
    log: (...args) => console.log(`  [${provider.id}]`, ...args),
  };
}

function checkParams(route, params) {
  const spec = route.params || {};
  const resolved = {};
  for (const [name, def] of Object.entries(spec)) {
    const value = params[name] ?? def.default ?? env[def.env] ?? undefined;
    if (def.required && (value === undefined || value === '')) {
      const err = new Error(`Missing required parameter "${name}" — ${def.description || ''}`.trim());
      err.status = 400;
      throw err;
    }
    if (value !== undefined) resolved[name] = value;
  }
  return resolved;
}

/**
 * Runs one provider route, going through the cache unless the caller asked
 * for fresh data. Returns the envelope the HTTP layer sends verbatim.
 */
export async function runRoute(provider, route, rawParams, { refresh = false } = {}) {
  const params = checkParams(route, rawParams);
  const key = `${provider.id}${route.path}:${JSON.stringify(params)}`;
  const ttl = route.ttl ?? 0;

  if (!refresh) {
    const hit = cache.read(key, ttl);
    if (hit) {
      return { source: provider.id, route: route.path, params, cached: true, ageSeconds: hit.age, fetchedAt: new Date(hit.storedAt).toISOString(), data: hit.value };
    }
  }

  if (provider.credentials.length && !hasEnv(provider.credentials)) {
    const err = new Error(`Provider "${provider.id}" needs credentials: ${provider.credentials.join(', ')}`);
    err.status = 503;
    err.code = 'MISSING_CREDENTIALS';
    throw err;
  }

  const started = Date.now();
  const data = await route.handler(buildContext(provider, params, { refresh }));
  if (ttl) cache.write(key, data);

  return { source: provider.id, route: route.path, params, cached: false, tookMs: Date.now() - started, fetchedAt: new Date().toISOString(), data };
}

/** Mounts every provider's routes under /api/<provider-id>/<route-path>. */
export function apiRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      providers: [...providers.values()].map((p) => ({
        id: p.id,
        label: p.label || p.id,
        file: p.file,
        configured: !p.credentials.length || hasEnv(p.credentials),
        credentials: p.credentials,
        contributesTasks: typeof p.tasks === 'function',
        contributesStats: typeof p.stats === 'function',
        routes: p.routes.map((r) => ({
          method: 'GET',
          url: `/api/${p.id}${r.path}`,
          summary: r.summary || '',
          params: r.params || {},
          ttlSeconds: r.ttl ?? 0,
        })),
      })),
      aggregate: [
        { method: 'GET', url: '/api/tasks', summary: 'Normalised tasks merged across every provider' },
        { method: 'GET', url: '/api/timetable', summary: 'One week of lessons merged across every provider' },
        { method: 'GET', url: '/api/stats', summary: 'Practice targets merged across every provider' },
        { method: 'GET', url: '/api/health', summary: 'Provider configuration and session status' },
      ],
    });
  });

  for (const provider of providers.values()) {
    for (const route of provider.routes) {
      router.get(`/${provider.id}${route.path}`, async (req, res, next) => {
        try {
          const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
          res.json(await runRoute(provider, route, { ...req.params, ...req.query }, { refresh }));
        } catch (err) {
          next(err);
        }
      });
    }

    router.post(`/${provider.id}/session/reset`, (req, res) => {
      res.json({ provider: provider.id, cleared: forgetSession(provider.id) });
    });
  }

  return router;
}

/**
 * Fans out to every provider that publishes a timetable, merging their days
 * into one week. Lessons carry their source, so a second school slots in
 * beside the first without the board changing.
 */
export async function collectTimetable({ week = null, only = null, refresh = false } = {}) {
  const chosen = [...providers.values()].filter(
    (p) => typeof p.timetable === 'function' && (!only || only.includes(p.id))
  );
  const settled = await Promise.allSettled(
    chosen.map(async (p) => {
      if (p.credentials.length && !hasEnv(p.credentials)) return { skipped: 'missing credentials' };
      const ctx = buildContext(p, { week }, { refresh });
      return p.timetable(ctx);
    })
  );

  const byDate = new Map();
  const sources = [];
  let student = null;
  let bounds = null;

  settled.forEach((r, i) => {
    const p = chosen[i];
    if (r.status !== 'fulfilled') {
      sources.push({ id: p.id, label: p.label || p.id, ok: false, error: r.reason?.message || String(r.reason) });
      return;
    }
    const value = r.value || {};
    sources.push({ id: p.id, label: p.label || p.id, ok: true, skipped: value.skipped || null, count: value.lessonCount || 0 });
    if (value.skipped) return;

    student ||= value.student || null;
    bounds ||= value.week || null;
    for (const day of value.days || []) {
      if (!byDate.has(day.date)) byDate.set(day.date, { ...day, lessons: [] });
      byDate.get(day.date).lessons.push(...day.lessons.map((l) => ({ ...l, source: p.id, sourceLabel: p.label || p.id })));
    }
  });

  const days = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({ ...day, lessons: day.lessons.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))) }));

  return {
    fetchedAt: new Date().toISOString(),
    sources,
    student,
    week: bounds,
    days,
    lessonCount: days.reduce((n, d) => n + d.lessons.length, 0),
  };
}

/** Fans out to every provider that exposes a tasks() feed. */
export async function collectTasks({ refresh = false, only = null } = {}) {
  const chosen = [...providers.values()].filter(
    (p) => typeof p.tasks === 'function' && (!only || only.includes(p.id))
  );
  const settled = await Promise.allSettled(
    chosen.map(async (p) => {
      if (p.credentials.length && !hasEnv(p.credentials)) {
        return { provider: p, skipped: 'missing credentials', tasks: [] };
      }
      return { provider: p, tasks: await p.tasks(buildContext(p, {}, { refresh })) };
    })
  );

  const tasks = [];
  const sources = [];
  settled.forEach((r, i) => {
    const p = chosen[i];
    if (r.status === 'fulfilled') {
      sources.push({ id: p.id, label: p.label || p.id, ok: true, skipped: r.value.skipped || null, count: r.value.tasks.length });
      tasks.push(...r.value.tasks);
    } else {
      sources.push({ id: p.id, label: p.label || p.id, ok: false, error: r.reason?.message || String(r.reason), count: 0 });
    }
  });

  tasks.sort((a, b) => String(a.dueOn || '9999').localeCompare(String(b.dueOn || '9999')));
  return { fetchedAt: new Date().toISOString(), sources, tasks };
}

/**
 * Fans out to every provider that measures something against a target —
 * minutes of maths practice, books read, laps run. Metrics carry their source,
 * so the board shows them all without knowing where any of them came from.
 */
export async function collectStats({ refresh = false, only = null, week = null } = {}) {
  const chosen = [...providers.values()].filter(
    (p) => typeof p.stats === 'function' && (!only || only.includes(p.id))
  );
  const settled = await Promise.allSettled(
    chosen.map(async (p) => {
      if (p.credentials.length && !hasEnv(p.credentials)) return { skipped: 'missing credentials', metrics: [] };
      return { metrics: (await p.stats(buildContext(p, { week }, { refresh }))) || [] };
    })
  );

  const metrics = [];
  const sources = [];
  settled.forEach((r, i) => {
    const p = chosen[i];
    if (r.status !== 'fulfilled') {
      sources.push({ id: p.id, label: p.label || p.id, ok: false, error: r.reason?.message || String(r.reason), count: 0 });
      return;
    }
    sources.push({ id: p.id, label: p.label || p.id, ok: true, skipped: r.value.skipped || null, count: r.value.metrics.length });
    metrics.push(...r.value.metrics.map((m) => ({ ...m, source: p.id, sourceLabel: p.label || p.id })));
  });

  return { fetchedAt: new Date().toISOString(), sources, metrics };
}
