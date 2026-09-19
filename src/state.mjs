import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.mjs';

const file = () => path.join(dataDir(), 'state.json');

/**
 * Anything you add on top of what the schools' systems know: your own tick,
 * a note, a planned day. Keyed by the normalised task id, so it survives a
 * re-scrape and works across every provider.
 */
function load() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; }
}
function save(state) {
  fs.writeFileSync(file(), JSON.stringify(state, null, 2));
}

export const all = () => load();

export function get(taskId) {
  return load()[taskId] || null;
}

export function set(taskId, patch) {
  const state = load();
  const next = { ...(state[taskId] || {}), ...patch, updatedAt: new Date().toISOString() };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  state[taskId] = next;
  save(state);
  return next;
}

export function remove(taskId) {
  const state = load();
  const existed = taskId in state;
  delete state[taskId];
  save(state);
  return existed;
}

/** Folds local state into a list of tasks. */
export function decorate(tasks) {
  const state = load();
  return tasks.map((t) => ({ ...t, local: state[t.id] || null, done: state[t.id]?.done ?? t.completed }));
}
