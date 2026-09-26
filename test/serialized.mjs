import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePhp,
  serializePhp,
  isSerialized,
  replaceInSerialized,
  naiveReplace,
  findLengthMismatches,
  base64Variants,
  checkSerialized
} from '../src/checks/serialized.mjs';

const s = (v) => ({ t: 's', v });

test('every scalar type round trips', () => {
  for (const text of ['N;', 'b:1;', 'b:0;', 'i:42;', 'i:-7;', 'd:1.5;', 's:0:"";', 's:3:"abc";']) {
    assert.equal(serializePhp(parsePhp(text)), text, text);
  }
});

test('arrays and objects round trip, including nesting', () => {
  const text = 'a:2:{s:1:"a";a:1:{i:0;s:1:"x";}s:1:"b";O:7:"MyClass":1:{s:1:"u";s:1:"y";}}';
  assert.equal(serializePhp(parsePhp(text)), text);
});

test('a length prefix counts bytes, not characters', () => {
  const text = serializePhp(s('café'));
  assert.equal(text, 's:5:"café";', 'four characters, five bytes');
  assert.equal(parsePhp(text).v, 'café');
});

test('a multibyte string is not reported as a mismatch', () => {
  const text = serializePhp({ t: 'a', entries: [[s('name'), s('café über')]] });
  assert.deepEqual(findLengthMismatches(text), []);
});

test('a string containing a quote and a semicolon still round trips', () => {
  const tricky = 'he said "hi"; then left';
  assert.equal(parsePhp(serializePhp(s(tricky))).v, tricky);
});

test('a wrong length prefix is refused rather than read past', () => {
  assert.throws(() => parsePhp('s:4:"abc";'), /length prefix 4 does not match/);
  assert.equal(isSerialized('s:4:"abc";'), false);
});

test('trailing bytes after a complete value are refused', () => {
  assert.throws(() => parsePhp('i:1;i:2;'), /trailing bytes/);
});

test('a truncated structure is refused with the offset', () => {
  try {
    parsePhp('a:2:{s:1:"a";i:1;}');
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(typeof error.offset, 'number');
  }
});

test('an unknown type marker is refused', () => {
  assert.throws(() => parsePhp('z:1;'), /unknown type marker/);
});

test('a serialization aware replacement recomputes the prefix', () => {
  const before = serializePhp(s('https://old-site.example/page'));
  const after = replaceInSerialized(before, 'old-site.example', 'example.org');
  assert.equal(after.text, 's:24:"https://example.org/page";');
  assert.equal(isSerialized(after.text), true);
  assert.equal(after.occurrences, 1);
});

test('the same replacement done as plain text breaks the value, which is the point', () => {
  const before = serializePhp(s('https://old-site.example/page'));
  const broken = naiveReplace(before, 'old-site.example', 'example.org');
  assert.equal(isSerialized(broken), false);
  assert.equal(findLengthMismatches(broken).length, 1);
});

test('replacement reaches array keys as well as values', () => {
  const before = serializePhp({ t: 'a', entries: [[s('old-site.example'), s('old-site.example')]] });
  const after = replaceInSerialized(before, 'old-site.example', 'example.org');
  const parsed = parsePhp(after.text);
  assert.equal(parsed.entries[0][0].v, 'example.org');
  assert.equal(parsed.entries[0][1].v, 'example.org');
});

test('a serialized payload nested in a string is rewritten at both levels', () => {
  const inner = serializePhp({ t: 'a', entries: [[s('home'), s('https://old-site.example/')]] });
  const outer = serializePhp({ t: 'a', entries: [[s('panel'), s(inner)]] });
  const after = replaceInSerialized(outer, 'old-site.example', 'example.org');

  assert.equal(after.nested, 1);
  assert.equal(isSerialized(after.text), true);
  const rewrittenInner = parsePhp(after.text).entries[0][1].v;
  assert.equal(isSerialized(rewrittenInner), true, 'the inner payload has to parse on its own too');
  assert.equal(parsePhp(rewrittenInner).entries[0][1].v, 'https://example.org/');
});

test('a single pass over the same nested value leaves the inner prefix wrong', () => {
  const inner = serializePhp({ t: 'a', entries: [[s('home'), s('https://old-site.example/')]] });
  const outer = serializePhp({ t: 'a', entries: [[s('panel'), s(inner)]] });
  const broken = naiveReplace(outer, 'old-site.example', 'example.org');
  assert.ok(findLengthMismatches(broken).length >= 2, 'the outer and the inner prefix are both wrong');
});

test('replacing in data that is already broken is refused rather than layered on top', () => {
  assert.throws(() => replaceInSerialized('s:9:"abc";', 'abc', 'xyz'), /length prefix/);
});

test('a longer replacement is handled as well as a shorter one', () => {
  const before = serializePhp(s('a.example'));
  const after = replaceInSerialized(before, 'a.example', 'a-much-longer.example');
  assert.equal(isSerialized(after.text), true);
  assert.equal(parsePhp(after.text).v, 'a-much-longer.example');
});

test('the scanner works on a damaged dump, which cannot be parsed at all', () => {
  const dump = `INSERT INTO t VALUES ('${naiveReplace(serializePhp(s('https://old-site.example/x')), 'old-site.example', 'example.org')}');`;
  const mismatches = findLengthMismatches(dump);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].declaredLength, 26);
  assert.equal(mismatches[0].actualLength, 21);
});

const profile = { domain: 'example.org', oldDomain: 'old-site.example' };
const ids = (f) => f.map((x) => x.id);

test('the naive replace signature is told apart from ordinary damage', () => {
  const naive = naiveReplace(serializePhp(s('https://old-site.example/x')), 'old-site.example', 'example.org');
  const found = checkSerialized([{ path: 'db/a.sql', text: naive }], profile);
  assert.ok(ids(found).includes('SER002'), 'the length delta matches the domain length delta');
  assert.ok(!ids(found).includes('SER001'));

  const unrelated = checkSerialized([{ path: 'db/b.sql', text: 's:99:"short";' }], profile);
  assert.ok(ids(unrelated).includes('SER001'));
  assert.ok(!ids(unrelated).includes('SER002'));
});

test('a remaining old domain reference is reported with a count and a line', () => {
  const text = `line one\nINSERT ('${serializePhp(s('https://old-site.example/a'))}');\n`;
  const found = checkSerialized([{ path: 'db/c.sql', text }], profile).find((f) => f.id === 'SER003');
  assert.ok(found);
  assert.equal(found.line, 2);
  assert.match(found.detail, /1 occurrence/);
});

test('nesting is only reported where replacement work is still outstanding', () => {
  const inner = serializePhp({ t: 'a', entries: [[s('home'), s('https://old-site.example/')]] });
  const outstanding = serializePhp({ t: 'a', entries: [[s('panel'), s(inner)]] });
  assert.ok(ids(checkSerialized([{ path: 'db/d.sql', text: outstanding }], profile)).includes('SER004'));

  const done = replaceInSerialized(outstanding, 'old-site.example', 'example.org').text;
  assert.ok(
    !ids(checkSerialized([{ path: 'db/d.sql', text: done }], profile)).includes('SER004'),
    'nesting on its own is legitimate and must not be reported'
  );
});

test('the encoded form of a string is found at every byte alignment, not just one', () => {
  const needles = base64Variants('old-site.example');
  assert.equal(needles.length, 3, 'base64 packs three bytes into four characters, so there are three alignments');
  for (const prefix of ['', 'a', 'ab', 'https://', 'https://x', 'https://xx']) {
    const encoded = Buffer.from(`${prefix}old-site.example/asset`, 'utf8').toString('base64');
    assert.ok(
      needles.some((needle) => encoded.includes(needle)),
      `alignment missed for prefix of length ${prefix.length}`
    );
  }
});

test('an encoded old domain is reported as something to change through the application', () => {
  const encoded = Buffer.from('https://old-site.example/asset', 'utf8').toString('base64');
  const found = checkSerialized([{ path: 'db/e.sql', text: `('cache','${encoded}')` }], profile).find(
    (f) => f.id === 'SER005'
  );
  assert.ok(found);
  assert.equal(found.severity, 'medium');
});

test('a clean file raises nothing', () => {
  const clean = serializePhp({ t: 'a', entries: [[s('home'), s('https://example.org/')]] });
  assert.deepEqual(checkSerialized([{ path: 'db/f.sql', text: `('home','${clean}')` }], profile), []);
});
