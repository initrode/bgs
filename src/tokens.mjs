import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.mjs';

const file = (providerId) => path.join(dataDir('auth'), `${providerId}.token.json`);

/** Saved API tokens, so a provider only drives a browser when one expires. */
export function readToken(providerId, { skewSeconds = 300 } = {}) {
  const f = file(providerId);
  if (!fs.existsSync(f)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (t.expiresAt && Date.now() > t.expiresAt - skewSeconds * 1000) return null;
    return t;
  } catch {
    return null;
  }
}

export function writeToken(providerId, token) {
  const f = file(providerId);
  fs.writeFileSync(f, JSON.stringify(token, null, 2));
  fs.chmodSync(f, 0o600);
  return token;
}

export function forgetToken(providerId) {
  const f = file(providerId);
  if (fs.existsSync(f)) { fs.unlinkSync(f); return true; }
  return false;
}
