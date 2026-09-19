import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './config.mjs';

const dir = () => dataDir('cache');

/** Readable prefix for eyeballing the directory, plus a hash so keys stay unique. */
const keyToFile = (key) =>
  path.join(dir(), `${key.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80)}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 8)}.json`);

export function read(key, ttlSeconds) {
  if (!ttlSeconds) return null;
  const file = keyToFile(key);
  if (!fs.existsSync(file)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = (Date.now() - entry.storedAt) / 1000;
    if (age > ttlSeconds) return null;
    return { ...entry, age: Math.round(age) };
  } catch {
    return null;
  }
}

export function write(key, value) {
  const entry = { storedAt: Date.now(), value };
  fs.writeFileSync(keyToFile(key), JSON.stringify(entry));
  return entry;
}

export function clear(prefix) {
  let n = 0;
  const DIR = dir();
  for (const f of fs.readdirSync(DIR)) {
    if (!prefix || f.startsWith(prefix.replace(/[^a-z0-9._-]/gi, '_'))) {
      fs.unlinkSync(path.join(DIR, f));
      n++;
    }
  }
  return n;
}
