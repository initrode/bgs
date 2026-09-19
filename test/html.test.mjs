import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, decodeEntities, extractLinks } from '../src/html.mjs';

test('htmlToText renders a teacher description as plain text', async (t) => {
  await t.test('block elements become line breaks', () => {
    assert.equal(htmlToText('<p>One</p><p>Two</p>'), 'One\nTwo');
    assert.equal(htmlToText('A<br>B<br/>C'), 'A\nB\nC');
    assert.equal(htmlToText('<h2>Title</h2><div>Body</div>'), 'Title\nBody');
  });

  await t.test('list items become bullets', () => {
    assert.equal(htmlToText('<ul><li>First</li><li>Second</li></ul>'), '• First\n• Second');
  });

  await t.test('strips Word markup without eating the words', () => {
    const word = '<p class="isSelectedEnd">Please complete <span style="font-size:11pt;">pages 10 and 11</span>.</p>';
    assert.equal(htmlToText(word), 'Please complete pages 10 and 11.');
  });

  await t.test('removes an unterminated tag left by a truncated preview', () => {
    // Regression: previews are cut at a fixed length, often mid-tag. A
    // `<[^>]+>` rule needs a closing '>' and left this visible on the card.
    assert.equal(htmlToText('<p>Van Gogh!</p><p class="…'), 'Van Gogh!');
    assert.equal(htmlToText('Text <div class="x'), 'Text');
  });

  await t.test('handles double-escaped markup pasted from Word', () => {
    // Regression: stripping tags once exposed a second layer as literal text.
    assert.equal(htmlToText('<p>&lt;p&gt;Nested&lt;/p&gt;</p>'), 'Nested');
  });

  await t.test('drops script and style content entirely', () => {
    assert.equal(htmlToText('<p>Safe</p><script>alert(1)</script>'), 'Safe');
    assert.equal(htmlToText('<style>.x{color:red}</style><p>Safe</p>'), 'Safe');
  });

  await t.test('collapses runs of whitespace and blank lines', () => {
    assert.equal(htmlToText('<p>A</p><p></p><p></p><p>B</p>'), 'A\n\nB');
    assert.equal(htmlToText('<p>too    many     spaces</p>'), 'too many spaces');
    assert.equal(htmlToText('<p>&nbsp;&nbsp;padded&nbsp;</p>'), 'padded');
  });

  await t.test('empty input gives an empty string, never undefined', () => {
    assert.equal(htmlToText(''), '');
    assert.equal(htmlToText(null), '');
    assert.equal(htmlToText(undefined), '');
  });

  await t.test('keeps emoji and accented characters intact', () => {
    assert.equal(htmlToText('<p>🎨 Caf&eacute; &amp; cr&egrave;me</p>'), '🎨 Café & crème');
  });
});

test('decodeEntities covers the entities schools actually send', async (t) => {
  await t.test('named, numeric and hex', () => {
    assert.equal(decodeEntities('&amp;&lt;&gt;&quot;'), '&<>"');
    assert.equal(decodeEntities('&#8212;'), '—');
    assert.equal(decodeEntities('&#x2014;'), '—');
    assert.equal(decodeEntities('&pound;5'), '£5');
    assert.equal(decodeEntities('&rsquo;'), '’');
  });

  await t.test('leaves unknown entities alone rather than mangling them', () => {
    assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  });
});

test('extractLinks surfaces worksheets teachers attach', async (t) => {
  const html = '<a href="https://example.test/a.pdf">Synonyms</a> and ' +
               '<a href=\'https://example.test/b.pdf\'>Antonyms</a>';

  await t.test('pulls url and label for each link', () => {
    assert.deepEqual(extractLinks(html), [
      { url: 'https://example.test/a.pdf', label: 'Synonyms' },
      { url: 'https://example.test/b.pdf', label: 'Antonyms' },
    ]);
  });

  await t.test('de-duplicates the same target', () => {
    const dupes = '<a href="https://x.test/1">One</a><a href="https://x.test/1">Again</a>';
    assert.equal(extractLinks(dupes).length, 1);
  });

  await t.test('falls back to the url when the label is markup only', () => {
    const [link] = extractLinks('<a href="https://x.test/1"><img src="i.png"></a>');
    assert.equal(link.label, 'https://x.test/1');
  });

  await t.test('no links gives an empty array', () => {
    assert.deepEqual(extractLinks('<p>No links here</p>'), []);
    assert.deepEqual(extractLinks(null), []);
  });
});
