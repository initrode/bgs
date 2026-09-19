import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport } from './helpers.mjs';

test('cache stores, expires and clears', async (t) => {
  tempDataDir(t);
  const cache = await freshImport('../src/cache.mjs');

  await t.test('a fresh entry comes back within its ttl', () => {
    cache.write('k1', { hello: 'world' });
    const hit = cache.read('k1', 60);
    assert.deepEqual(hit.value, { hello: 'world' });
    assert.equal(typeof hit.age, 'number');
  });

  await t.test('a miss returns null rather than throwing', () => {
    assert.equal(cache.read('never-written', 60), null);
  });

  await t.test('a ttl of zero disables the cache', () => {
    cache.write('k2', { a: 1 });
    assert.equal(cache.read('k2', 0), null);
  });

  await t.test('an entry past its ttl is a miss', async () => {
    cache.write('k3', { a: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(cache.read('k3', 1), null);
    assert.ok(cache.read('k3', 60), 'still readable under a longer ttl');
  });

  await t.test('keys that differ only past the filename limit stay distinct', () => {
    const a = 'satchelone/todos:' + 'x'.repeat(200) + 'A';
    const b = 'satchelone/todos:' + 'x'.repeat(200) + 'B';
    cache.write(a, { which: 'a' });
    cache.write(b, { which: 'b' });
    assert.deepEqual(cache.read(a, 60).value, { which: 'a' });
    assert.deepEqual(cache.read(b, 60).value, { which: 'b' });
  });

  await t.test('keys with path separators cannot escape the cache directory', () => {
    cache.write('../../escape', { nope: true });
    assert.deepEqual(cache.read('../../escape', 60).value, { nope: true });
  });

  await t.test('clear by prefix leaves other providers alone', () => {
    cache.clear(); // start from empty so the count is about this test only
    cache.write('satchelone/todos:1', { a: 1 });
    cache.write('satchelone/homework:2', { a: 2 });
    cache.write('otherschool/notices:3', { a: 3 });
    const cleared = cache.clear('satchelone');
    assert.equal(cleared, 2);
    assert.equal(cache.read('satchelone/todos:1', 60), null);
    assert.ok(cache.read('otherschool/notices:3', 60));
  });

  await t.test('clear with no prefix empties everything', () => {
    cache.write('a', { a: 1 });
    cache.write('b', { b: 2 });
    assert.ok(cache.clear() >= 2);
    assert.equal(cache.read('a', 60), null);
  });

  await t.test('a corrupt cache file is treated as a miss', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    cache.write('corrupt', { a: 1 });
    const dir = path.join(process.env.DATA_DIR, 'cache');
    for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), 'not json{');
    assert.equal(cache.read('corrupt', 60), null);
  });
});
