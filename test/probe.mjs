import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseProbeArgs, keepRealErrors, assembleObserved, dkimNames, PROBE_USAGE } from '../src/probe-plan.mjs';

// The collector's decisions. None of these needs the network, which is the
// point: the reason the collector was untested was that it talks to nameservers,
// and the parts that do not talk to anything went untested with it.

test('a bare domain gets the current directory and no selectors', () => {
  const parsed = parseProbeArgs(['example.org']);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.options, { domain: 'example.org', outDir: '.', selectors: [], help: false });
});

test('a domain and a directory are read as positional arguments', () => {
  const parsed = parseProbeArgs(['example.org', './collected']);
  assert.equal(parsed.options.domain, 'example.org');
  assert.equal(parsed.options.outDir, './collected');
});

test('the selector flag works in the spelling the usage documents', () => {
  // This is the defect this module exists for. The usage line has always said
  // --selectors a,b, the parser only ever accepted --selectors=a,b, and
  // following the documentation collected no DKIM records at all while writing
  // the output into a directory named after the flag.
  assert.ok(PROBE_USAGE.includes('--selectors a,b'));
  const parsed = parseProbeArgs(['example.org', '--selectors', 'sel1,sel2']);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.options.selectors, ['sel1', 'sel2']);
  assert.equal(parsed.options.outDir, '.', 'the flag must not become the output directory');
});

test('the selector flag also works in the equals spelling', () => {
  const parsed = parseProbeArgs(['example.org', '--selectors=sel1,sel2']);
  assert.deepEqual(parsed.options.selectors, ['sel1', 'sel2']);
  assert.equal(parsed.options.outDir, '.');
});

test('both spellings produce the same options', () => {
  const equals = parseProbeArgs(['example.org', './out', '--selectors=a,b']);
  const spaced = parseProbeArgs(['example.org', './out', '--selectors', 'a,b']);
  assert.deepEqual(equals.options, spaced.options);
});

test('a flag before the domain does not consume the domain', () => {
  const parsed = parseProbeArgs(['--selectors', 'sel1', 'example.org']);
  assert.ok(parsed.ok);
  assert.equal(parsed.options.domain, 'example.org');
  assert.deepEqual(parsed.options.selectors, ['sel1']);
});

test('a selector list is trimmed and empty entries dropped', () => {
  const parsed = parseProbeArgs(['example.org', '--selectors', ' a , , b ']);
  assert.deepEqual(parsed.options.selectors, ['a', 'b']);
});

test('the selector flag with nothing after it is refused rather than silently empty', () => {
  const parsed = parseProbeArgs(['example.org', '--selectors']);
  assert.equal(parsed.ok, false);
  assert.match(parsed.message, /comma separated/);
});

test('a missing domain, an unknown option and a third positional are each refused', () => {
  assert.match(parseProbeArgs([]).message, /domain is required/);
  assert.match(parseProbeArgs(['--nope']).message, /unknown option/);
  assert.match(parseProbeArgs(['a', 'b', 'c']).message, /at most a domain/);
});

test('help is accepted on its own, with no domain', () => {
  const parsed = parseProbeArgs(['--help']);
  assert.ok(parsed.ok);
  assert.equal(parsed.options.help, true);
  assert.equal(parsed.options.domain, null);
});

test('dkim names are the selector with the domainkey label', () => {
  assert.deepEqual(dkimNames(['sel1', 'sel2']), ['sel1._domainkey', 'sel2._domainkey']);
  assert.deepEqual(dkimNames([]), []);
});

test('a record type that does not exist is not kept as an error', () => {
  const kept = keepRealErrors([
    'example.org CNAME: ENODATA',
    'example.org CAA: ENOTFOUND',
    'example.org NS: ESERVFAIL',
    'example.org TXT: queryTxt ETIMEOUT'
  ]);
  assert.deepEqual(kept, ['example.org NS: ESERVFAIL', 'example.org TXT: queryTxt ETIMEOUT']);
});

test('a complete collection is assembled as reachable with its headers and chain', () => {
  const observed = assembleObserved({
    now: '2026-10-01T00:00:00Z',
    certificate: { ok: true, value: { subjectAltNames: ['example.org'] } },
    httpChain: { ok: true, value: { chain: [{ from: 'http://example.org/', to: 'https://example.org/', status: 301 }] } },
    httpsHead: { ok: true, value: { headers: { 'strict-transport-security': 'max-age=31536000' } } }
  });
  assert.equal(observed.httpReachable, true);
  assert.equal(observed.httpsReachable, true);
  assert.equal(observed.redirectChain.length, 1);
  assert.deepEqual(observed.collectionErrors, []);
  assert.equal(observed.redirectChainTruncated, undefined);
});

test('a failed collection records the error and leaves the field empty rather than guessing', () => {
  const observed = assembleObserved({
    now: '2026-10-01T00:00:00Z',
    certificate: { ok: false, error: 'certificate: timed out' },
    httpChain: { ok: false, error: 'http redirect chain: ECONNREFUSED' },
    httpsHead: { ok: true, value: { headers: {} } }
  });
  assert.equal(observed.certificate, null);
  assert.equal(observed.httpReachable, false);
  assert.deepEqual(observed.redirectChain, []);
  assert.deepEqual(observed.collectionErrors, ['certificate: timed out', 'http redirect chain: ECONNREFUSED']);
});

test('a chain that hit the hop limit says so instead of looking complete', () => {
  // Six hops collected from a chain we gave up on look exactly like a complete
  // chain ending in plain http, and that is what the ssl checks were handed. A
  // long redirect loop was therefore reported as a site that never reaches
  // https, which is a specific and wrong finding rather than an admission that
  // the chain was not followed to the end.
  const chain = Array.from({ length: 6 }, (_, i) => ({
    from: `http://example.org/${i}`,
    to: `http://example.org/${i + 1}`,
    status: 301
  }));
  const observed = assembleObserved({
    now: '2026-10-01T00:00:00Z',
    certificate: { ok: true, value: {} },
    httpChain: { ok: true, value: { chain, truncated: true } },
    httpsHead: { ok: true, value: { headers: {} } }
  });
  assert.equal(observed.redirectChainTruncated, true);
  assert.match(observed.collectionErrors.join(' '), /gave up after 6 hops/);
});

test('a chain that was followed to the end carries no truncation marker', () => {
  const observed = assembleObserved({
    now: '2026-10-01T00:00:00Z',
    certificate: { ok: true, value: {} },
    httpChain: { ok: true, value: { chain: [], truncated: false } },
    httpsHead: { ok: true, value: { headers: {} } }
  });
  assert.ok(!('redirectChainTruncated' in observed));
  assert.deepEqual(observed.collectionErrors, []);
});
