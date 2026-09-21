import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvValue } from '../src/config.mjs';

test('env value parsing', async (t) => {
  await t.test('a quoted value keeps only what is inside the quotes', () => {
    assert.equal(parseEnvValue('"6736"'), '6736');
    assert.equal(parseEnvValue("'6736'"), '6736');
  });

  await t.test('a trailing # comment after a quoted value is dropped, not part of the value', () => {
    // This is exactly the shape the README's own .env examples use, e.g.
    // TTRS_PASS="6736"                # the four-digit PIN
    assert.equal(parseEnvValue('"6736"                # the four-digit PIN'), '6736');
  });

  await t.test('an unquoted value keeps a literal # that is not preceded by whitespace', () => {
    assert.equal(parseEnvValue('abc#123'), 'abc#123');
  });

  await t.test('an unquoted value drops a trailing # comment', () => {
    assert.equal(parseEnvValue('parent      # parent | student | staff'), 'parent');
  });

  await t.test('a bare value with no comment is unchanged', () => {
    assert.equal(parseEnvValue('4375'), '4375');
  });
});
