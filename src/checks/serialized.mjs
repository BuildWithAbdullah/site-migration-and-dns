// PHP serialized data. This is the check that exists because a plain text
// search and replace over a database dump is the single most common way a
// WordPress migration breaks, and because it breaks silently: the length
// prefix stops matching the string, the value no longer unserializes, and the
// application behaves as though the option were never set.
//
// Everything here works on a byte oriented view of the text. A serialized
// length prefix counts bytes, not characters, so a naive implementation that
// uses JavaScript string indices gets every multibyte value wrong. The text is
// converted to a latin1 string, where one character is exactly one byte, and
// converted back at the end.

import { raise } from '../catalog.mjs';

const toBytes = (text) => Buffer.from(String(text), 'utf8').toString('latin1');
const fromBytes = (bytes) => Buffer.from(bytes, 'latin1').toString('utf8');

class SerializeError extends Error {
  constructor(message, offset) {
    super(`${message} at byte ${offset}`);
    this.offset = offset;
  }
}

// ------------------------------------------------------------------ parsing

function parseValue(s, i) {
  const type = s[i];
  if (type === undefined) throw new SerializeError('unexpected end of input', i);

  if (type === 'N') {
    if (s[i + 1] !== ';') throw new SerializeError('expected ; after N', i + 1);
    return { value: { t: 'N' }, next: i + 2 };
  }

  if (type === 'b' || type === 'i' || type === 'd') {
    if (s[i + 1] !== ':') throw new SerializeError(`expected : after ${type}`, i + 1);
    const end = s.indexOf(';', i + 2);
    if (end === -1) throw new SerializeError(`unterminated ${type}`, i);
    const raw = s.slice(i + 2, end);
    let value;
    if (type === 'b') {
      if (raw !== '0' && raw !== '1') throw new SerializeError(`bad boolean ${raw}`, i + 2);
      value = { t: 'b', v: raw === '1' };
    } else if (type === 'i') {
      if (!/^-?\d+$/.test(raw)) throw new SerializeError(`bad integer ${raw}`, i + 2);
      value = { t: 'i', v: Number.parseInt(raw, 10) };
    } else {
      value = { t: 'd', v: raw };
    }
    return { value, next: end + 1 };
  }

  if (type === 's') {
    const header = /^s:(\d+):"/.exec(s.slice(i, i + 24));
    if (!header) throw new SerializeError('malformed string header', i);
    const declared = Number.parseInt(header[1], 10);
    const start = i + header[0].length;
    const end = start + declared;
    if (s.slice(end, end + 2) !== '";') {
      throw new SerializeError(`string length prefix ${declared} does not match the string`, i);
    }
    // Nodes carry decoded text, not bytes. The byte view exists only inside
    // this file, so a node built by hand and a node from the parser behave the
    // same way when they are written back out.
    return { value: { t: 's', v: fromBytes(s.slice(start, end)) }, next: end + 2 };
  }

  if (type === 'a' || type === 'O') {
    let cursor = i;
    let cls = null;
    let count;
    if (type === 'a') {
      const header = /^a:(\d+):\{/.exec(s.slice(i, i + 24));
      if (!header) throw new SerializeError('malformed array header', i);
      count = Number.parseInt(header[1], 10);
      cursor = i + header[0].length;
    } else {
      const header = /^O:(\d+):"/.exec(s.slice(i, i + 24));
      if (!header) throw new SerializeError('malformed object header', i);
      const nameLen = Number.parseInt(header[1], 10);
      const nameStart = i + header[0].length;
      cls = fromBytes(s.slice(nameStart, nameStart + nameLen));
      const after = s.slice(nameStart + nameLen);
      const tail = /^":(\d+):\{/.exec(after);
      if (!tail) throw new SerializeError('malformed object header', nameStart + nameLen);
      count = Number.parseInt(tail[1], 10);
      cursor = nameStart + nameLen + tail[0].length;
    }

    const entries = [];
    for (let n = 0; n < count; n += 1) {
      const key = parseValue(s, cursor);
      const val = parseValue(s, key.next);
      entries.push([key.value, val.value]);
      cursor = val.next;
    }
    if (s[cursor] !== '}') throw new SerializeError('expected } to close structure', cursor);
    return { value: type === 'a' ? { t: 'a', entries } : { t: 'O', cls, entries }, next: cursor + 1 };
  }

  throw new SerializeError(`unknown type marker ${JSON.stringify(type)}`, i);
}

/** Parse serialized text. Throws SerializeError with a byte offset on bad input. */
export function parsePhp(text) {
  const s = toBytes(text);
  const { value, next } = parseValue(s, 0);
  if (next !== s.length) throw new SerializeError('trailing bytes after value', next);
  return value;
}

export function isSerialized(text) {
  try {
    parsePhp(text);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ writing

function writeValue(value) {
  switch (value.t) {
    case 'N':
      return 'N;';
    case 'b':
      return `b:${value.v ? 1 : 0};`;
    case 'i':
      return `i:${value.v};`;
    case 'd':
      return `d:${value.v};`;
    case 's':
      // The length is recomputed, in bytes. Those two words are the whole
      // difference between a migration that works and one that does not.
      return `s:${Buffer.byteLength(value.v, 'utf8')}:"${value.v}";`;
    case 'a':
      return `a:${value.entries.length}:{${value.entries.map(([k, v]) => writeValue(k) + writeValue(v)).join('')}}`;
    case 'O':
      return `O:${Buffer.byteLength(value.cls, 'utf8')}:"${value.cls}":${value.entries.length}:{${value.entries
        .map(([k, v]) => writeValue(k) + writeValue(v))
        .join('')}}`;
    default:
      throw new Error(`cannot serialize node type ${value.t}`);
  }
}

export function serializePhp(value) {
  return writeValue(value);
}

// ------------------------------------------------------------------ replacing

function replaceNode(node, search, replace, stats) {
  if (node.t === 's') {
    // A string can itself hold serialized data. Rewriting it as flat text
    // fixes the outer prefix and leaves the inner one wrong, so the inner
    // payload is parsed, rewritten and reserialized.
    if (node.v.includes(search) && isSerialized(node.v)) {
      stats.nested += 1;
      return { t: 's', v: serializePhp(replaceNode(parsePhp(node.v), search, replace, stats)) };
    }
    if (node.v.includes(search)) {
      stats.strings += 1;
      stats.occurrences += node.v.split(search).length - 1;
      return { t: 's', v: node.v.split(search).join(replace) };
    }
    return node;
  }
  if (node.t === 'a' || node.t === 'O') {
    return {
      ...node,
      entries: node.entries.map(([k, v]) => [
        replaceNode(k, search, replace, stats),
        replaceNode(v, search, replace, stats)
      ])
    };
  }
  return node;
}

/**
 * Serialization aware search and replace. Returns the rewritten text and what
 * it touched. Throws if the input does not parse, because rewriting data that
 * is already broken hides the original damage.
 */
export function replaceInSerialized(text, search, replace) {
  const stats = { strings: 0, occurrences: 0, nested: 0 };
  const parsed = parsePhp(text);
  const rewritten = replaceNode(parsed, String(search), String(replace), stats);
  return { text: serializePhp(rewritten), ...stats };
}

/** The same replacement done the wrong way, kept so the tests can prove it is wrong. */
export function naiveReplace(text, search, replace) {
  return String(text).split(search).join(replace);
}

// ------------------------------------------------------------------ scanning

/**
 * Find every string whose declared length does not match its contents, without
 * parsing the whole value. A broken dump usually cannot be parsed, so the
 * scanner has to work on damaged input by design.
 */
export function findLengthMismatches(text) {
  const s = toBytes(text);
  const out = [];
  const header = /s:(\d+):"/g;
  let match;
  while ((match = header.exec(s)) !== null) {
    const declared = Number.parseInt(match[1], 10);
    const start = match.index + match[0].length;
    const closing = s.slice(start + declared, start + declared + 2);
    if (closing === '";') continue;

    // Recover the string that was probably meant, by looking for the nearest
    // plausible terminator, so the report can say what the length should be.
    let actual = null;
    for (let probe = start; probe < s.length - 1; probe += 1) {
      if (s[probe] === '"' && (s[probe + 1] === ';' || s[probe + 1] === '}')) {
        actual = probe - start;
        break;
      }
    }
    out.push({
      byteOffset: match.index,
      declaredLength: declared,
      actualLength: actual,
      preview: fromBytes(s.slice(start, start + Math.min(declared, 60)))
    });
  }
  return out;
}

// ------------------------------------------------------------------ checks

const ENCODED_HINT = /[A-Za-z0-9+\/]{24,}={0,2}/g;

/**
 * The base64 forms of a string, one per byte alignment.
 *
 * base64 encodes three bytes into four characters, so the encoding of a
 * substring only appears verbatim in the encoding of the whole when the
 * substring happens to start on a three byte boundary. Checking one alignment
 * therefore misses two cases in three. For the two offset alignments the
 * leading group depends on the bytes in front, and the trailing group may be
 * partial, so both ends are trimmed and what is left is still long enough to be
 * distinctive.
 */
export function base64Variants(value) {
  const out = [];
  for (let pad = 0; pad < 3; pad += 1) {
    const encoded = Buffer.from('\u0000'.repeat(pad) + value, 'utf8').toString('base64');
    const head = pad === 0 ? 0 : 4;
    const needle = encoded.slice(head, Math.max(head, encoded.length - 4));
    if (needle.length >= 8) out.push(needle);
  }
  return out;
}

export function checkSerialized(files, profile) {
  const findings = [];
  const oldDomain = profile.oldDomain ?? null;
  const newDomain = profile.domain ?? null;
  const delta = oldDomain && newDomain ? newDomain.length - oldDomain.length : null;

  for (const file of files) {
    const text = String(file.text ?? '');
    const where = file.path;

    for (const mismatch of findLengthMismatches(text)) {
      const line = text.slice(0, mismatch.byteOffset).split('\n').length;
      const looksLikeNaiveReplace =
        delta !== null &&
        delta !== 0 &&
        mismatch.actualLength !== null &&
        mismatch.actualLength - mismatch.declaredLength === delta &&
        mismatch.preview.includes(newDomain);

      findings.push(
        raise(looksLikeNaiveReplace ? 'SER002' : 'SER001', {
          where,
          line,
          detail: looksLikeNaiveReplace
            ? `declared ${mismatch.declaredLength} matches the old domain length, string holds the new domain (${mismatch.actualLength} bytes)`
            : `declared ${mismatch.declaredLength}, string is ${mismatch.actualLength ?? 'unterminated'}`
        })
      );
    }

    if (oldDomain && text.includes(oldDomain)) {
      const idx = text.indexOf(oldDomain);
      findings.push(
        raise('SER003', {
          where,
          line: text.slice(0, idx).split('\n').length,
          detail: `${text.split(oldDomain).length - 1} occurrence(s) of ${oldDomain}`
        })
      );
    }

    // Nested serialized payloads. Nesting on its own is legitimate, so this is
    // only raised where replacement work is still outstanding in the same file:
    // that is the case where a single pass fixes the outer length prefix and
    // leaves the inner one wrong.
    if (oldDomain && text.includes(oldDomain)) {
      const nested = /s:\d+:"(?=(a:\d+:\{|O:\d+:"))/g;
      let hit;
      while ((hit = nested.exec(toBytes(text))) !== null) {
        findings.push(
          raise('SER004', {
            where,
            line: text.slice(0, hit.index).split('\n').length,
            detail:
              'a serialized structure is stored inside a serialized string, in a file that still holds the old domain'
          })
        );
        break;
      }
    }

    if (oldDomain) {
      const needles = base64Variants(oldDomain);
      for (const candidate of text.match(ENCODED_HINT) ?? []) {
        if (needles.some((needle) => candidate.includes(needle))) {
          findings.push(
            raise('SER005', {
              where,
              line: text.slice(0, text.indexOf(candidate)).split('\n').length,
              detail: `an encoded value contains the base64 form of ${oldDomain}`
            })
          );
          break;
        }
      }
    }
  }

  return findings;
}

export { SerializeError };
