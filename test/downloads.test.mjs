import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempDataDir, freshImport } from './helpers.mjs';

const attachment = (over = {}) => ({
  id: 171564499,
  filename: 'Boys__School_Song_-_Piano_.MP3',
  contentType: 'audio/mpeg',
  bytes: 11,
  url: 'https://cdn.test/song.mp3',
  ...over,
});

/** A fetch that hands back fixed bytes, and counts how often it was called. */
function fakeFetcher(body = 'hello world', status = 200) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      body: null,
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    };
  };
  fn.calls = calls;
  return fn;
}

test('safeSegment keeps filenames on disk and inside the directory', async (t) => {
  tempDataDir(t);
  const { safeSegment } = await freshImport('../src/downloads.mjs');

  await t.test('ordinary names pass through', () => {
    assert.equal(safeSegment('Song_-_Piano_.MP3'), 'Song_-_Piano_.MP3');
    assert.equal(safeSegment('Notes (final).pdf'), 'Notes (final).pdf');
  });

  await t.test('path separators cannot escape', () => {
    assert.equal(safeSegment('../../etc/passwd'), 'etc-passwd');
    assert.equal(safeSegment('..\\..\\windows'), 'windows');
    assert.ok(!safeSegment('a/b/c').includes('/'));
  });

  await t.test('leading dots cannot create a hidden file', () => {
    assert.equal(safeSegment('.bashrc'), 'bashrc');
    assert.equal(safeSegment('...'), 'file');
  });

  await t.test('empty and nonsense values fall back', () => {
    assert.equal(safeSegment(''), 'file');
    assert.equal(safeSegment(null), 'file');
    assert.equal(safeSegment('   ', 'other'), 'other');
  });

  await t.test('very long names are truncated', () => {
    assert.ok(safeSegment('x'.repeat(400)).length <= 120);
  });

  await t.test('non-latin filenames survive', () => {
    assert.equal(safeSegment('Café_notes.pdf'), 'Café_notes.pdf');
  });
});

test('download writes the file once and reuses it after', async (t) => {
  tempDataDir(t);
  const dl = await freshImport('../src/downloads.mjs');

  await t.test('saves the bytes under source and task', async () => {
    const fetcher = fakeFetcher();
    const out = await dl.download('satchelone', 'satchelone:91030487', attachment(), { fetcher });
    assert.equal(out.cached, false);
    assert.equal(out.bytes, 11);
    assert.equal(fs.readFileSync(out.path, 'utf8'), 'hello world');
    assert.match(out.path, /satchelone[/\\]satchelone:91030487[/\\]171564499-Boys/);
  });

  await t.test('the id prefixes the name, so two files can share one filename', async () => {
    const fetcher = fakeFetcher();
    const a = await dl.download('satchelone', 'task:1', attachment({ id: 1, filename: 'notes.pdf' }), { fetcher });
    const b = await dl.download('satchelone', 'task:1', attachment({ id: 2, filename: 'notes.pdf' }), { fetcher });
    assert.notEqual(a.path, b.path);
    assert.ok(fs.existsSync(a.path) && fs.existsSync(b.path));
  });

  await t.test('a second download is a no-op', async () => {
    const fetcher = fakeFetcher();
    await dl.download('satchelone', 'task:2', attachment({ id: 3 }), { fetcher });
    const again = await dl.download('satchelone', 'task:2', attachment({ id: 3 }), { fetcher });
    assert.equal(again.cached, true);
    assert.equal(fetcher.calls.length, 1, 'the network was not hit twice');
  });

  await t.test('force re-downloads anyway', async () => {
    const fetcher = fakeFetcher();
    await dl.download('satchelone', 'task:3', attachment({ id: 4 }), { fetcher });
    const forced = await dl.download('satchelone', 'task:3', attachment({ id: 4 }), { fetcher, force: true });
    assert.equal(forced.cached, false);
    assert.equal(fetcher.calls.length, 2);
  });

  await t.test('a file of the wrong size is fetched again, not trusted', async () => {
    const fetcher = fakeFetcher();
    const out = await dl.download('satchelone', 'task:4', attachment({ id: 5 }), { fetcher });
    fs.writeFileSync(out.path, 'truncated');
    const again = await dl.download('satchelone', 'task:4', attachment({ id: 5 }), { fetcher });
    assert.equal(again.cached, false, 'a short file must not pass as complete');
  });

  await t.test('a failed request leaves nothing behind', async () => {
    const fetcher = fakeFetcher('', 404);
    await assert.rejects(
      () => dl.download('satchelone', 'task:5', attachment({ id: 6 }), { fetcher }),
      (err) => err.status === 502 && /HTTP 404/.test(err.message)
    );
    const dir = dl.attachmentDir('satchelone', 'task:5');
    assert.deepEqual(fs.readdirSync(dir), [], 'no partial file left');
  });

  await t.test('an attachment with no url is rejected before any io', async () => {
    await assert.rejects(
      () => dl.download('satchelone', 'task:6', attachment({ url: null }), { fetcher: fakeFetcher() }),
      (err) => err.status === 422
    );
  });

  await t.test('an oversized file is refused with 413', async () => {
    await assert.rejects(
      () => dl.download('satchelone', 'task:7', attachment({ id: 7, bytes: 999 * 1024 * 1024 }), { fetcher: fakeFetcher() }),
      (err) => err.status === 413
    );
  });
});

test('publicPath is a url the browser can actually request', async (t) => {
  tempDataDir(t);
  const dl = await freshImport('../src/downloads.mjs');

  await t.test('encodes the colon in a namespaced task id', () => {
    const url = dl.publicPath('satchelone', 'satchelone:91030487', attachment());
    assert.ok(url.startsWith('/files/satchelone/'));
    assert.ok(url.includes('%3A'), 'the colon must be encoded');
    assert.doesNotThrow(() => decodeURIComponent(url));
  });

  await t.test('matches where the file was actually written', async () => {
    const out = await dl.download('satchelone', 'task:8', attachment({ id: 8 }), { fetcher: fakeFetcher() });
    const fromUrl = decodeURIComponent(out.url).replace('/files/', '');
    assert.ok(out.path.endsWith(fromUrl), `${out.path} should end with ${fromUrl}`);
  });
});

test('downloadAll reports per file rather than failing as one', async (t) => {
  tempDataDir(t);
  const dl = await freshImport('../src/downloads.mjs');

  const task = {
    id: 'satchelone:91030487',
    source: 'satchelone',
    title: 'Learn a school song competition!',
    attachments: [attachment({ id: 11 }), attachment({ id: 12, url: null }), attachment({ id: 13 })],
  };

  await t.test('good files save, the bad one is reported', async () => {
    const out = await dl.downloadAll(task, { fetcher: fakeFetcher() });
    assert.equal(out.total, 3);
    assert.equal(out.saved, 2);
    assert.equal(out.failed, 1);
    assert.match(out.files.find((f) => f.id === 12).error, /no url/);
  });

  await t.test('the successful files are genuinely on disk', async () => {
    const out = await dl.downloadAll(task, { fetcher: fakeFetcher() });
    for (const file of out.files.filter((f) => !f.error)) {
      assert.ok(fs.existsSync(file.path), `${file.filename} missing`);
    }
  });

  await t.test('a task with no attachments is not an error', async () => {
    const out = await dl.downloadAll({ id: 'x:1', source: 'x', title: 'None', attachments: [] });
    assert.equal(out.total, 0);
    assert.equal(out.saved, 0);
    assert.equal(out.failed, 0);
  });
});

test('isDownloaded and listDownloads reflect what is on disk', async (t) => {
  tempDataDir(t);
  const dl = await freshImport('../src/downloads.mjs');

  await t.test('false before, true after', async () => {
    assert.equal(dl.isDownloaded('satchelone', 'task:9', attachment({ id: 21 })), false);
    await dl.download('satchelone', 'task:9', attachment({ id: 21 }), { fetcher: fakeFetcher() });
    assert.equal(dl.isDownloaded('satchelone', 'task:9', attachment({ id: 21 })), true);
  });

  await t.test('listing names source, task and a servable url', async () => {
    const files = dl.listDownloads();
    assert.equal(files.length, 1);
    assert.equal(files[0].source, 'satchelone');
    assert.equal(files[0].taskId, 'task:9');
    assert.equal(files[0].filename, attachment().filename, 'the id prefix is hidden from the listing');
    assert.ok(files[0].url.startsWith('/files/'));
    assert.ok(files[0].savedAt);
  });

  await t.test('half-finished .part files are never listed', async () => {
    const dir = dl.attachmentDir('satchelone', 'task:9');
    fs.writeFileSync(path.join(dir, '999-interrupted.pdf.part'), 'x');
    assert.equal(dl.listDownloads().some((f) => f.filename.includes('interrupted')), false);
  });

  await t.test('an empty store lists nothing rather than throwing', async () => {
    tempDataDir(t);
    const fresh = await freshImport('../src/downloads.mjs');
    assert.deepEqual(fresh.listDownloads(), []);
  });
});
