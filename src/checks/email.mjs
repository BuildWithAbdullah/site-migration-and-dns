// SPF, DKIM and DMARC. A zone rebuilt at a new host loses all three without
// any visible symptom on the website, which is why they belong in a migration
// check rather than in a separate piece of work nobody schedules.
//
// The parsers are separate from the checks so the parsing can be tested on its
// own. Every parser is total: it returns errors in the result rather than
// throwing, because a malformed record in the wild is the normal case.

import { raise } from '../catalog.mjs';

const LOOKUP_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists']);
const QUALIFIERS = new Set(['+', '-', '~', '?']);

// ------------------------------------------------------------------ SPF

export function parseSpf(record) {
  const result = { version: null, terms: [], modifiers: {}, errors: [] };
  const text = String(record ?? '').trim();
  if (text === '') {
    result.errors.push('empty record');
    return result;
  }

  const parts = text.split(/\s+/);
  if (!/^v=spf1$/i.test(parts[0])) {
    result.errors.push(`first term is ${parts[0]}, expected v=spf1`);
  } else {
    result.version = 'spf1';
  }

  for (const part of parts.slice(1)) {
    const modifier = part.match(/^([a-z][a-z0-9_.-]*)=(.*)$/i);
    if (modifier && !/^(v)$/i.test(modifier[1])) {
      const name = modifier[1].toLowerCase();
      if (name in result.modifiers) {
        result.errors.push(`duplicate modifier ${name}`);
      }
      result.modifiers[name] = modifier[2];
      continue;
    }

    let qualifier = '+';
    let body = part;
    if (QUALIFIERS.has(part[0])) {
      qualifier = part[0];
      body = part.slice(1);
    }

    const colon = body.indexOf(':');
    const mechanism = (colon === -1 ? body : body.slice(0, colon)).toLowerCase();
    const value = colon === -1 ? null : body.slice(colon + 1);

    if (mechanism === '') {
      result.errors.push(`unparsable term ${part}`);
      continue;
    }
    result.terms.push({ qualifier, mechanism, value, raw: part });
  }

  return result;
}

/**
 * The ten lookup limit counts mechanisms that cause a DNS query, plus the
 * lookups inside each include. Third party include costs cannot be known from
 * the record alone, so they are supplied and default to one.
 */
export function countSpfLookups(parsed, includeCosts = {}) {
  let total = 0;
  const breakdown = [];
  for (const term of parsed.terms) {
    if (!LOOKUP_MECHANISMS.has(term.mechanism)) continue;
    const key = term.value ? term.value.toLowerCase() : term.mechanism;
    const cost = term.mechanism === 'include' ? (includeCosts[key] ?? 1) : 1;
    total += cost;
    breakdown.push({ term: term.raw, cost });
  }
  if (parsed.modifiers.redirect) {
    const key = parsed.modifiers.redirect.toLowerCase();
    const cost = includeCosts[key] ?? 1;
    total += cost;
    breakdown.push({ term: `redirect=${parsed.modifiers.redirect}`, cost });
  }
  return { total, breakdown };
}

function spfAuthorises(parsed, host) {
  const needle = String(host ?? '').trim().toLowerCase();
  if (needle === '') return false;
  return parsed.terms.some((t) => (t.value ?? '').toLowerCase() === needle);
}

// ------------------------------------------------------------------ tag lists

// DKIM and DMARC both use semicolon separated tag=value pairs. Tags are
// case sensitive in DMARC and conventionally lower case in DKIM, so the tag is
// kept verbatim and looked up case insensitively where that is correct.
export function parseTagList(record) {
  const result = { tags: {}, order: [], duplicates: [], errors: [] };
  const text = String(record ?? '').trim();
  if (text === '') {
    result.errors.push('empty record');
    return result;
  }
  for (const chunk of text.split(';')) {
    const piece = chunk.trim();
    if (piece === '') continue;
    const eq = piece.indexOf('=');
    if (eq === -1) {
      result.errors.push(`term without a value: ${piece}`);
      continue;
    }
    const tag = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (tag in result.tags) {
      result.duplicates.push(tag);
      continue;
    }
    result.tags[tag] = value;
    result.order.push(tag);
  }
  return result;
}

// ------------------------------------------------------------------ DKIM

function base64Bytes(value) {
  const clean = String(value ?? '').replace(/\s+/g, '');
  if (clean === '') return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    return Buffer.from(clean, 'base64');
  } catch {
    return null;
  }
}

function readDerLength(buf, offset) {
  const first = buf[offset];
  if (first === undefined) return null;
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count === 0 || count > 4 || offset + 1 + count > buf.length) return null;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = length * 256 + buf[offset + 1 + i];
  return { length, next: offset + 1 + count };
}

/**
 * Bit length of the RSA modulus, by walking the DER rather than guessing from
 * the base64 length. Returns null when the key is not a structure this
 * understands, because reporting nothing is better than reporting a number
 * that came from a length heuristic.
 */
export function rsaKeyBits(publicKeyBase64) {
  const buf = base64Bytes(publicKeyBase64);
  if (!buf || buf.length < 8) return null;

  const readSeq = (offset) => {
    if (buf[offset] !== 0x30) return null;
    const len = readDerLength(buf, offset + 1);
    return len === null ? null : { start: len.next, end: len.next + len.length };
  };

  const outer = readSeq(0);
  if (!outer) return null;

  // SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING }
  let modulusSeq = null;
  const algorithm = readSeq(outer.start);
  if (algorithm && buf[algorithm.end] === 0x03) {
    const bitLen = readDerLength(buf, algorithm.end + 1);
    if (bitLen === null) return null;
    // Skip the unused bits octet, then the inner RSAPublicKey SEQUENCE.
    modulusSeq = readSeq(bitLen.next + 1);
  } else {
    // Bare RSAPublicKey: SEQUENCE { INTEGER n, INTEGER e }
    modulusSeq = outer;
  }
  if (!modulusSeq) return null;

  if (buf[modulusSeq.start] !== 0x02) return null;
  const intLen = readDerLength(buf, modulusSeq.start + 1);
  if (intLen === null) return null;

  let start = intLen.next;
  let end = intLen.next + intLen.length;
  if (end > buf.length) return null;
  // DER integers are signed, so a leading zero is padding, not magnitude.
  while (start < end && buf[start] === 0x00) start += 1;
  if (start >= end) return null;

  const leading = buf[start];
  let bits = (end - start - 1) * 8;
  for (let bit = 7; bit >= 0; bit -= 1) {
    if (leading & (1 << bit)) {
      bits += bit + 1;
      break;
    }
  }
  return bits;
}

export function parseDkim(record) {
  const parsed = parseTagList(record);
  const tags = parsed.tags;
  return {
    ...parsed,
    version: tags.v ?? null,
    keyType: tags.k ?? 'rsa',
    publicKey: tags.p ?? null,
    flags: (tags.t ?? '')
      .split(':')
      .map((f) => f.trim())
      .filter(Boolean),
    keyBits: tags.k && tags.k.toLowerCase() !== 'rsa' ? null : rsaKeyBits(tags.p)
  };
}

// ------------------------------------------------------------------ DMARC

export function parseDmarc(record) {
  const parsed = parseTagList(record);
  const tags = parsed.tags;
  const pct = tags.pct === undefined ? 100 : Number.parseInt(tags.pct, 10);
  return {
    ...parsed,
    version: tags.v ?? null,
    policy: (tags.p ?? '').toLowerCase() || null,
    subdomainPolicy: tags.sp === undefined ? null : tags.sp.toLowerCase(),
    pct: Number.isNaN(pct) ? null : pct,
    rua: tags.rua ? tags.rua.split(',').map((a) => a.trim()).filter(Boolean) : [],
    adkim: (tags.adkim ?? 'r').toLowerCase(),
    aspf: (tags.aspf ?? 'r').toLowerCase()
  };
}

// ------------------------------------------------------------------ checks

function txtAt(zone, name) {
  const node = zone?.[name];
  if (!node) return [];
  const txt = node.TXT;
  if (!txt) return [];
  return (Array.isArray(txt) ? txt : [txt]).map((t) => (typeof t === 'string' ? t : t.value));
}

export function checkEmail(zone, profile) {
  const findings = [];
  const domain = profile.domain;
  const mail = profile.mail ?? {};

  // --- SPF
  const apexTxt = txtAt(zone, 'apex');
  const spfRecords = apexTxt.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()));

  if (spfRecords.length === 0) {
    findings.push(raise('SPF001', { where: domain, detail: 'no TXT record starting v=spf1' }));
  } else {
    if (spfRecords.length > 1) {
      findings.push(
        raise('SPF002', { where: domain, detail: `${spfRecords.length} SPF records published at the apex` })
      );
    }

    const parsed = parseSpf(spfRecords[0]);
    const lookups = countSpfLookups(parsed, mail.includeLookupCosts ?? {});
    if (lookups.total > 10) {
      findings.push(
        raise('SPF003', {
          where: domain,
          detail: `${lookups.total} DNS lookups: ${lookups.breakdown.map((b) => `${b.term} (${b.cost})`).join(', ')}`
        })
      );
    }

    const allTerm = parsed.terms.find((t) => t.mechanism === 'all');
    if (!allTerm && !parsed.modifiers.redirect) {
      findings.push(raise('SPF004', { where: domain, detail: 'record has no all mechanism and no redirect' }));
    } else if (allTerm && allTerm.qualifier === '+') {
      findings.push(raise('SPF005', { where: domain, detail: `record ends in ${allTerm.raw}` }));
    }

    const ptr = parsed.terms.find((t) => t.mechanism === 'ptr');
    if (ptr) {
      findings.push(raise('SPF006', { where: domain, detail: `record contains ${ptr.raw}` }));
    }

    for (const host of mail.oldSendingHosts ?? []) {
      if (spfAuthorises(parsed, host)) {
        findings.push(raise('SPF007', { where: domain, detail: `still authorises ${host}` }));
      }
    }
    for (const host of mail.newSendingHosts ?? []) {
      if (!spfAuthorises(parsed, host)) {
        findings.push(raise('SPF008', { where: domain, detail: `does not authorise ${host}` }));
      }
    }
  }

  if ((zone?.apex?.SPF ?? []).length > 0) {
    findings.push(raise('SPF009', { where: domain, detail: 'policy published under the withdrawn SPF record type' }));
  }

  // --- DKIM
  for (const selector of mail.dkimSelectors ?? []) {
    const name = `${selector}._domainkey`;
    const records = txtAt(zone, name).filter((t) => /(^|;)\s*v=DKIM1/i.test(t) || /(^|;)\s*p=/i.test(t));
    if (records.length === 0) {
      findings.push(raise('DKIM001', { where: `${name}.${domain}`, detail: 'selector has no TXT record' }));
      continue;
    }
    const dkim = parseDkim(records[0]);
    if (dkim.publicKey !== null && dkim.publicKey.trim() === '') {
      findings.push(raise('DKIM004', { where: `${name}.${domain}`, detail: 'p= is empty, so the key is revoked' }));
    } else if (dkim.keyBits !== null && dkim.keyBits < 1024) {
      findings.push(
        raise('DKIM002', { where: `${name}.${domain}`, detail: `RSA modulus is ${dkim.keyBits} bits` })
      );
    }
    if (dkim.flags.includes('y')) {
      findings.push(raise('DKIM003', { where: `${name}.${domain}`, detail: 'record carries t=y' }));
    }
  }

  // --- DMARC
  const dmarcTxt = txtAt(zone, '_dmarc').filter((t) => /^v=DMARC1/i.test(t.trim()));
  if (dmarcTxt.length === 0) {
    findings.push(raise('DMARC001', { where: `_dmarc.${domain}`, detail: 'no TXT record starting v=DMARC1' }));
  } else {
    if (dmarcTxt.length > 1) {
      findings.push(
        raise('DMARC006', { where: `_dmarc.${domain}`, detail: `${dmarcTxt.length} DMARC records published` })
      );
    }
    const dmarc = parseDmarc(dmarcTxt[0]);

    if (dmarc.policy === 'none') {
      findings.push(raise('DMARC002', { where: `_dmarc.${domain}`, detail: 'p=none' }));
    }
    if (dmarc.rua.length === 0) {
      findings.push(raise('DMARC003', { where: `_dmarc.${domain}`, detail: 'no rua tag' }));
    }
    if (dmarc.pct !== null && dmarc.pct < 100) {
      findings.push(raise('DMARC004', { where: `_dmarc.${domain}`, detail: `pct=${dmarc.pct}` }));
    }
    if (
      (dmarc.adkim === 's' || dmarc.aspf === 's') &&
      mail.alignedAuthentication !== true &&
      dmarc.policy !== null &&
      dmarc.policy !== 'none'
    ) {
      findings.push(
        raise('DMARC005', {
          where: `_dmarc.${domain}`,
          detail: `adkim=${dmarc.adkim} aspf=${dmarc.aspf} with p=${dmarc.policy} and no aligned sender declared`
        })
      );
    }
    if (dmarc.subdomainPolicy === 'none' && (dmarc.policy === 'reject' || dmarc.policy === 'quarantine')) {
      findings.push(
        raise('DMARC007', { where: `_dmarc.${domain}`, detail: `p=${dmarc.policy} but sp=none` })
      );
    }
  }

  return findings;
}
