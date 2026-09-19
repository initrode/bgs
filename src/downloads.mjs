import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dataDir } from './config.mjs';

/**
 * Saving attachments to disk. Provider-agnostic: anything that can describe an
 * attachment as { id, filename, url } can be downloaded and served locally.
 */

const MAX_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES || 100 * 1024 * 1024);

/** One path segment, safe on disk and free of traversal. */
export function safeSegment(value, fallback = 'file') {
  const cleaned = String(value ?? '')
    .replace(/[/\\]/g, '-')            // no directory separators
    .replace(/[^\x20-\x7e -￿]/g, '') // no control characters
    .replace(/\.{2,}/g, '.')           // no parent-directory segments
    .replace(/^[.\-\s]+/, '')          // no hidden or leading-dash names
    .trim();
  return cleaned.slice(0, 120) || fallback;
}

export const attachmentDir = (source, taskId) =>
  dataDir('attachments', safeSegment(source, 'unknown'), safeSegment(taskId, 'task'));

export function attachmentPath(source, taskId, attachment) {
  const name = safeSegment(attachment.filename, `attachment-${attachment.id}`);
  return path.join(attachmentDir(source, taskId), `${attachment.id}-${name}`);
}

/** Where the browser can fetch a saved file from. */
export const publicPath = (source, taskId, attachment) =>
  '/files/' + [safeSegment(source, 'unknown'), safeSegment(taskId, 'task'), path.basename(attachmentPath(source, taskId, attachment))]
    .map(encodeURIComponent).join('/');

export function isDownloaded(source, taskId, attachment) {
  const file = attachmentPath(source, taskId, attachment);
  if (!fs.existsSync(file)) return false;
  // A size we were told up front lets us spot a half-finished file.
  if (attachment.bytes && fs.statSync(file).size !== attachment.bytes) return false;
  return true;
}

/**
 * Downloads one attachment unless it is already on disk. Writes to a .part
 * file first, so an interrupted download never leaves a plausible-looking
 * truncated file behind.
 */
export async function download(source, taskId, attachment, { fetcher = fetch, force = false } = {}) {
  if (!attachment?.url) {
    throw Object.assign(new Error(`Attachment ${attachment?.id ?? '?'} has no url`), { status: 422 });
  }

  const file = attachmentPath(source, taskId, attachment);
  const result = {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType || null,
    path: file,
    url: publicPath(source, taskId, attachment),
  };

  if (!force && isDownloaded(source, taskId, attachment)) {
    return { ...result, bytes: fs.statSync(file).size, cached: true };
  }

  if (attachment.bytes && attachment.bytes > MAX_BYTES) {
    throw Object.assign(new Error(`${attachment.filename} is ${attachment.bytes} bytes, over the ${MAX_BYTES} limit`), { status: 413 });
  }

  const res = await fetcher(attachment.url);
  if (!res.ok) {
    throw Object.assign(new Error(`Could not download ${attachment.filename}: HTTP ${res.status}`), { status: 502 });
  }

  const partial = `${file}.part`;
  try {
    if (res.body && typeof Readable.fromWeb === 'function' && typeof res.body.getReader === 'function') {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(partial));
    } else {
      fs.writeFileSync(partial, Buffer.from(await res.arrayBuffer()));
    }
    fs.renameSync(partial, file);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }

  return { ...result, bytes: fs.statSync(file).size, cached: false };
}

/** Downloads every attachment on a task, reporting per-file rather than failing as one. */
export async function downloadAll(task, { fetcher = fetch, force = false } = {}) {
  const attachments = task.attachments || [];
  const files = [];
  for (const attachment of attachments) {
    try {
      files.push(await download(task.source, task.id, attachment, { fetcher, force }));
    } catch (err) {
      files.push({ id: attachment.id, filename: attachment.filename, error: err.message, ok: false });
    }
  }
  return {
    taskId: task.id,
    title: task.title,
    total: attachments.length,
    saved: files.filter((f) => !f.error).length,
    failed: files.filter((f) => f.error).length,
    files,
  };
}

/** Everything downloaded so far, newest first. */
export function listDownloads() {
  const root = dataDir('attachments');
  const out = [];
  for (const source of fs.readdirSync(root)) {
    const sourceDir = path.join(root, source);
    if (!fs.statSync(sourceDir).isDirectory()) continue;
    for (const taskId of fs.readdirSync(sourceDir)) {
      const taskDir = path.join(sourceDir, taskId);
      if (!fs.statSync(taskDir).isDirectory()) continue;
      for (const name of fs.readdirSync(taskDir)) {
        if (name.endsWith('.part')) continue;
        const stat = fs.statSync(path.join(taskDir, name));
        out.push({
          source,
          taskId,
          filename: name.replace(/^\d+-/, ''),
          bytes: stat.size,
          savedAt: stat.mtime.toISOString(),
          path: path.join(taskDir, name),
          url: '/files/' + [source, taskId, name].map(encodeURIComponent).join('/'),
        });
      }
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
