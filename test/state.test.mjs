import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDataDir, freshImport } from './helpers.mjs';

test('local state records your own ticks', async (t) => {
  tempDataDir(t);
  const state = await freshImport('../src/state.mjs');

  await t.test('reads empty before anything is written', () => {
    assert.deepEqual(state.all(), {});
    assert.equal(state.get('satchelone:1'), null);
  });

  await t.test('set stores the patch and a timestamp', () => {
    const saved = state.set('satchelone:1', { done: true });
    assert.equal(saved.done, true);
    assert.ok(saved.updatedAt, 'records when it changed');
    assert.equal(state.get('satchelone:1').done, true);
  });

  await t.test('set merges rather than replacing', () => {
    state.set('satchelone:1', { note: 'ask about page 11' });
    const after = state.get('satchelone:1');
    assert.equal(after.done, true, 'earlier field survives');
    assert.equal(after.note, 'ask about page 11');
  });

  await t.test('a null value removes just that field', () => {
    state.set('satchelone:1', { note: null });
    assert.equal(state.get('satchelone:1').note, undefined);
    assert.equal(state.get('satchelone:1').done, true);
  });

  await t.test('remove reports whether anything was there', () => {
    assert.equal(state.remove('satchelone:1'), true);
    assert.equal(state.remove('satchelone:1'), false);
    assert.equal(state.get('satchelone:1'), null);
  });

  await t.test('state persists across a module reload', async () => {
    state.set('satchelone:persist', { done: true });
    const reloaded = await freshImport('../src/state.mjs');
    assert.equal(reloaded.get('satchelone:persist').done, true);
  });
});

test('decorate merges local ticks over what the school reports', async (t) => {
  tempDataDir(t);
  const state = await freshImport('../src/state.mjs');

  const tasks = [
    { id: 'satchelone:1', completed: false },
    { id: 'satchelone:2', completed: true },
    { id: 'satchelone:3', completed: false },
  ];

  await t.test('without local state, done follows the school', () => {
    const out = state.decorate(tasks);
    assert.deepEqual(out.map((x) => x.done), [false, true, false]);
    assert.deepEqual(out.map((x) => x.local), [null, null, null]);
  });

  await t.test('a local tick wins over an incomplete school record', () => {
    state.set('satchelone:1', { done: true });
    const out = state.decorate(tasks);
    assert.equal(out[0].done, true);
    assert.equal(out[0].completed, false, 'the source record is left untouched');
    assert.equal(out[0].local.done, true);
  });

  await t.test('a local untick wins over a completed school record', () => {
    state.set('satchelone:2', { done: false });
    assert.equal(state.decorate(tasks)[1].done, false);
  });

  await t.test('a note alone does not change done', () => {
    state.set('satchelone:3', { note: 'started it' });
    const out = state.decorate(tasks)[2];
    assert.equal(out.done, false);
    assert.equal(out.local.note, 'started it');
  });

  await t.test('decorate does not mutate the tasks it was given', () => {
    const original = [{ id: 'satchelone:1', completed: false }];
    state.decorate(original);
    assert.equal(original[0].done, undefined);
  });
});
