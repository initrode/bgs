import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Resolved on each call rather than captured at import, so the location can be
 * pointed elsewhere (the tests give every run a throwaway directory).
 */
export function dataDir(...segments) {
  const base = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
  const dir = path.join(base, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Credentials live outside source control, in dotenv-style files.
 * Later files win, so a project-local file overrides the one in $HOME.
 */
const ENV_FILES = [
  path.join(os.homedir(), '.satchel.env'),
  path.join(ROOT, '.satchel.env'),
  path.join(ROOT, '.env'),
];

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

const fileEnv = ENV_FILES.reduce((acc, f) => Object.assign(acc, parseEnvFile(f)), {});

/**
 * Credentials, read live rather than snapshotted: process.env wins over the
 * files, so you can override any value for a single run on the command line.
 */
export const env = new Proxy({}, {
  get: (_t, key) => (typeof key === 'string' ? process.env[key] ?? fileEnv[key] : undefined),
  has: (_t, key) => key in process.env || key in fileEnv,
  ownKeys: () => [...new Set([...Object.keys(fileEnv), ...Object.keys(process.env)])],
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});

export function requireEnv(keys, providerId) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    const err = new Error(
      `Provider "${providerId}" is missing credentials: ${missing.join(', ')}. ` +
      `Add them to ${ENV_FILES[0]}`
    );
    err.status = 503;
    err.code = 'MISSING_CREDENTIALS';
    err.missing = missing;
    throw err;
  }
  return Object.fromEntries(keys.map((k) => [k, env[k]]));
}

export function hasEnv(keys) {
  return keys.every((k) => !!env[k]);
}

export const PORT = Number(env.PORT || 4000);
export const HEADLESS = env.HEADFUL !== '1';
