import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkSsl, certificateCovers, __internals } from '../src/checks/ssl.mjs';

test('a wildcard covers one label and never the name it wildcards', () => {
  const cert = { subjectAltNames: ['*.example.org'] };
  assert.equal(certificateCovers(cert, 'www.example.org'), true);
  assert.equal(certificateCovers(cert, 'example.org'), false, 'this is the trap');
  assert.equal(certificateCovers(cert, 'a.b.example.org'), false, 'a wildcard is one label deep');
});

test('name matching ignores case and a trailing dot', () => {
  assert.equal(certificateCovers({ subjectAltNames: ['WWW.Example.ORG.'] }, 'www.example.org'), true);
});

test('the transport security header is parsed rather than pattern matched', () => {
  const parsed = __internals.parseHsts('max-age="31536000"; includeSubDomains; preload');
  assert.deepEqual(parsed, { maxAge: 31536000, includeSubDomains: true, preload: true });
  assert.deepEqual(__internals.parseHsts('max-age=0'), { maxAge: 0, includeSubDomains: false, preload: false });
  assert.equal(__internals.parseHsts(''), null);
});

const profile = {
  domain: 'example.org',
  cutoverAt: '2026-10-15T00:00:00Z',
  subdomains: ['www', 'staging'],
  httpsSubdomains: ['www']
};

const observed = (overrides = {}) => ({
  now: '2026-10-01T00:00:00Z',
  httpReachable: true,
  httpsReachable: true,
  certificate: {
    subjectAltNames: ['example.org', 'www.example.org'],
    notBefore: '2026-09-01T00:00:00Z',
    notAfter: '2027-06-01T00:00:00Z'
  },
  redirectChain: [{ from: 'http://example.org/', to: 'https://www.example.org/', status: 301 }],
  headers: { 'strict-transport-security': 'max-age=31536000' },
  ...overrides
});

const ids = (f) => f.map((x) => x.id);

test('a correct certificate and header set raises nothing', () => {
  assert.deepEqual(ids(checkSsl(observed(), profile)), []);
});

test('a missing name is a blocker, because the redirect happens after the handshake', () => {
  const found = checkSsl(observed({ certificate: { ...observed().certificate, subjectAltNames: ['example.org'] } }), profile);
  assert.equal(found.find((f) => f.id === 'SSL001').severity, 'blocker');
});

test('an expired certificate is reported instead of an imminent expiry, not as well as', () => {
  const found = ids(
    checkSsl(observed({ certificate: { ...observed().certificate, notAfter: '2026-09-15T00:00:00Z' } }), profile)
  );
  assert.ok(found.includes('SSL004'));
  assert.ok(!found.includes('SSL003'));
});

test('an expiry inside the migration window is flagged, one outside it is not', () => {
  const inside = observed({ certificate: { ...observed().certificate, notAfter: '2026-10-20T00:00:00Z' } });
  assert.ok(ids(checkSsl(inside, profile)).includes('SSL003'));

  const outside = observed({ certificate: { ...observed().certificate, notAfter: '2026-12-01T00:00:00Z' } });
  assert.ok(!ids(checkSsl(outside, profile)).includes('SSL003'));
});

test('a certificate that is not yet valid points at a clock', () => {
  const found = checkSsl(
    observed({ certificate: { ...observed().certificate, notBefore: '2026-10-10T00:00:00Z' } }),
    profile
  ).find((f) => f.id === 'SSL005');
  assert.ok(found);
  assert.match(found.doesNotProve, /certificate is wrong/);
});

test('http answering without a redirect is a finding', () => {
  assert.ok(ids(checkSsl(observed({ redirectChain: [] }), profile)).includes('SSL006'));
});

test('a chain that takes an extra hop in clear text is reported', () => {
  const chain = [
    { from: 'http://example.org/', to: 'http://www.example.org/', status: 301 },
    { from: 'http://www.example.org/', to: 'https://www.example.org/', status: 301 }
  ];
  const found = checkSsl(observed({ redirectChain: chain }), profile).find((f) => f.id === 'SSL007');
  assert.ok(found);
  assert.match(found.detail, /http:\/\/www\.example\.org\//);
});

test('a single hop straight to https is not a chain finding', () => {
  assert.ok(!ids(checkSsl(observed(), profile)).includes('SSL007'));
});

test('a missing transport security header is low severity', () => {
  const found = checkSsl(observed({ headers: {} }), profile).find((f) => f.id === 'SSL008');
  assert.equal(found.severity, 'low');
});

test('preload with a short max-age is high, because preload is hard to reverse', () => {
  const found = checkSsl(
    observed({ headers: { 'strict-transport-security': 'max-age=600; preload' } }),
    profile
  ).find((f) => f.id === 'SSL009');
  assert.equal(found.severity, 'high');
  assert.match(found.doesNotProve, /preload list/);
});

test('includeSubDomains names the subdomains that are not on https', () => {
  const found = checkSsl(
    observed({ headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } }),
    profile
  ).find((f) => f.id === 'SSL010');
  assert.ok(found);
  assert.match(found.detail, /staging/);
});

test('includeSubDomains with every subdomain on https is fine', () => {
  const allHttps = { ...profile, httpsSubdomains: ['www', 'staging'] };
  assert.ok(
    !ids(
      checkSsl(observed({ headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } }), allHttps)
    ).includes('SSL010')
  );
});

test('a header name in any case is found', () => {
  assert.ok(
    !ids(checkSsl(observed({ headers: { 'Strict-Transport-Security': 'max-age=31536000' } }), profile)).includes(
      'SSL008'
    )
  );
});
