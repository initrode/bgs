const ENTITIES = {
  // Markup and punctuation schools' rich-text editors emit
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', bull: '\u2022',
  middot: '\u00b7', deg: '\u00b0', pound: '\u00a3', euro: '\u20ac',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', times: '\u00d7',
  frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
  // Accented characters, which turn up in names and modern-language homework
  aacute: 'á', agrave: 'à', acirc: 'â', auml: 'ä', aring: 'å', atilde: 'ã', aelig: 'æ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', otilde: 'õ', oslash: 'ø',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ccedil: 'ç', ntilde: 'ñ', szlig: 'ß', yuml: 'ÿ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Auml: 'Ä', Aring: 'Å', Atilde: 'Ã', AElig: 'Æ',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë',
  Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï',
  Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Ouml: 'Ö', Otilde: 'Õ', Oslash: 'Ø',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü',
  Ccedil: 'Ç', Ntilde: 'Ñ',
};

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
}

/** Flattens a teacher's rich-text description into readable plain paragraphs. */
export function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  // Two passes: pasted-from-Word descriptions often arrive double-escaped,
  // so stripping tags once can expose a second layer of markup as text.
  for (let pass = 0; pass < 2; pass++) {
    s = s
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '\u2022 ')
      .replace(/<[^>]+>/g, '')
      // Previews are cut to a fixed length, often mid-tag, leaving no closing '>'.
      .replace(/<[^>]*$/, '');
    s = decodeEntities(s);
  }
  return s
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

/** Teachers often link worksheets; surface them rather than losing them in markup. */
export function extractLinks(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const label = htmlToText(m[2]) || m[1];
    if (!out.some((l) => l.url === m[1])) out.push({ url: decodeEntities(m[1]), label });
  }
  return out;
}
