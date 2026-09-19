import path from 'node:path';
import express from 'express';
import { ROOT, HEADLESS, env } from './config.mjs';
import { loadProviders, providers, apiRouter, collectTasks, collectTimetable, collectStats } from './registry.mjs';
import { readToken } from './tokens.mjs';
import { hasEnv } from './config.mjs';
import * as cache from './cache.mjs';
import * as state from './state.mjs';
import { todayISO } from './dates.mjs';
import * as downloads from './downloads.mjs';
import { dataDir } from './config.mjs';

export async function buildApp({ providers: list = null } = {}) {
  const app = express();
  app.use(express.json());
  if (env.QUIET !== '1') {
    app.use((req, _res, next) => { console.log(`  ${req.method} ${req.originalUrl}`); next(); });
  }

  await loadProviders(list);

  const api = express.Router();

  /** Merged, normalised feed — this is what the web UI renders. */
  api.get('/tasks', async (req, res, next) => {
    try {
      const refresh = req.query.refresh === '1';
      const only = req.query.source ? String(req.query.source).split(',') : null;
      const key = `aggregate:tasks:${only ? only.join(',') : 'all'}`;
      const hit = !refresh && cache.read(key, Number(env.TASKS_TTL || 600));
      const result = hit ? hit.value : await collectTasks({ refresh, only });
      if (!hit) cache.write(key, result);
      let tasks = state.decorate(result.tasks).map((t) => ({
        ...t,
        attachments: (t.attachments || []).map((file) => ({
          ...file,
          downloaded: downloads.isDownloaded(t.source, t.id, file),
          localUrl: downloads.publicPath(t.source, t.id, file),
        })),
      }));

      if (req.query.due === 'upcoming') tasks = tasks.filter((t) => !t.done && (!t.dueOn || t.dueOn >= todayISO()));
      if (req.query.due === 'overdue') tasks = tasks.filter((t) => !t.done && t.dueOn && t.dueOn < todayISO());
      if (req.query.done === 'false') tasks = tasks.filter((t) => !t.done);

      res.json({ ...result, cached: !!hit, ageSeconds: hit ? hit.age : 0, count: tasks.length, tasks });
    } catch (err) { next(err); }
  });

  /** Merged timetable — the board's second tab. */
  api.get('/timetable', async (req, res, next) => {
    try {
      const refresh = req.query.refresh === '1';
      const week = req.query.week || null;
      const only = req.query.source ? String(req.query.source).split(',') : null;
      const key = `aggregate:timetable:${week || 'current'}:${only ? only.join(',') : 'all'}`;
      const hit = !refresh && cache.read(key, Number(env.TIMETABLE_TTL || 3600));
      const result = hit ? hit.value : await collectTimetable({ week, only, refresh });
      if (!hit) cache.write(key, result);
      res.json({ ...result, cached: !!hit, ageSeconds: hit ? hit.age : 0 });
    } catch (err) { next(err); }
  });

  /** Practice targets — what has been done this week against what was asked. */
  api.get('/stats', async (req, res, next) => {
    try {
      const refresh = req.query.refresh === '1';
      const week = req.query.week || null;
      const only = req.query.source ? String(req.query.source).split(',') : null;
      const key = `aggregate:stats:${week || 'current'}:${only ? only.join(',') : 'all'}`;
      const hit = !refresh && cache.read(key, Number(env.STATS_TTL || 900));
      const result = hit ? hit.value : await collectStats({ refresh, only, week });
      if (!hit) cache.write(key, result);
      res.json({ ...result, cached: !!hit, ageSeconds: hit ? hit.age : 0, count: result.metrics.length });
    } catch (err) { next(err); }
  });

  api.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      headless: HEADLESS,
      providers: [...providers.values()].map((p) => {
        const token = readToken(p.id);
        return {
          id: p.id,
          label: p.label || p.id,
          configured: !p.credentials.length || hasEnv(p.credentials),
          missing: p.credentials.filter((c) => !env[c]),
          session: token ? { valid: true, expiresAt: new Date(token.expiresAt).toISOString(), userType: token.userType || null } : { valid: false },
          routes: p.routes.length,
        };
      }),
    });
  });

  /** Local additions: your own tick, a note, a planned day. */
  api.get('/state', (_req, res) => res.json(state.all()));
  api.put('/state/:taskId', (req, res) => res.json(state.set(req.params.taskId, req.body || {})));
  api.delete('/state/:taskId', (req, res) => res.json({ removed: state.remove(req.params.taskId) }));

  /**
   * Attachments. The server resolves a task id against the feed and uses the
   * urls the school gave us, so the browser never dictates what gets fetched.
   */
  async function findTask(taskId) {
    const { tasks } = await collectTasks({});
    const task = tasks.find((x) => x.id === taskId);
    if (!task) throw Object.assign(new Error(`No task with id "${taskId}"`), { status: 404 });
    return task;
  }

  api.get('/attachments', (_req, res) => res.json({ files: downloads.listDownloads() }));

  api.post('/attachments/download', async (req, res, next) => {
    try {
      const { taskId, attachmentId, force = false } = req.body || {};
      if (!taskId) throw Object.assign(new Error('taskId is required'), { status: 400 });

      const task = await findTask(taskId);
      const wanted = attachmentId
        ? (task.attachments || []).filter((a) => String(a.id) === String(attachmentId))
        : task.attachments || [];

      if (!wanted.length) {
        throw Object.assign(new Error(`"${task.title}" has no attachment${attachmentId ? ` with id ${attachmentId}` : 's'}`), { status: 404 });
      }
      res.json(await downloads.downloadAll({ ...task, attachments: wanted }, { force }));
    } catch (err) { next(err); }
  });

  api.post('/cache/clear', (req, res) => res.json({ cleared: cache.clear(req.query.prefix || null) }));

  app.use('/api', api);
  app.use('/api', apiRouter());

  /**
   * Each view has its own url, so a refresh, a bookmark or a shared link lands
   * on the right page. One document serves both; the client picks the view
   * from the path.
   */
  const page = (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html'));
  app.get('/timetable', page);
  app.get('/termdates', page);
  app.get('/homework', (_req, res) => res.redirect(302, '/'));

  app.use(express.static(path.join(ROOT, 'public')));
  // Downloaded attachments, served read-only from the data directory.
  app.use('/files', express.static(dataDir('attachments'), { index: false, dotfiles: 'deny' }));

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500 && env.QUIET !== '1') console.error('  !!', err.message);
    res.status(status).json({ error: err.message, code: err.code || null, status });
  });

  return app;
}
