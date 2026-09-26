import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSpf, countSpfLookups, checkEmail } from '../src/checks/email.mjs';

test('a plain record parses into qualifiers, mechanisms and values', () => {
  const parsed = parseSpf('v=spf1 ip4:198.51.100.0/24 include:_spf.provider.example -all');
  assert.equal(parsed.version, 'spf1');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.terms.map((t) => [t.qualifier, t.mechanism, t.value]),
    [
      ['+', 'ip4', '198.51.100.0/24'],
      ['+', 'include', '_spf.provider.example'],
      ['-', 'all', null]
    ]
  );
});

test('modifiers are kept apart from mechanisms', () => {
  const parsed = parseSpf('v=spf1 redirect=_spf.provider.example exp=why.example.org');
  assert.equal(parsed.modifiers.redirect, '_spf.provider.example');
  assert.equal(parsed.modifiers.exp, 'why.example.org');
  assert.equal(parsed.terms.length, 0);
});

test('a record that does not start with v=spf1 is reported rather than guessed at', () => {
  const parsed = parseSpf('spf1 include:_spf.provider.example -all');
  assert.equal(parsed.version, null);
  assert.match(parsed.errors[0], /expected v=spf1/);
});

test('an empty record is an error, not an empty success', () => {
  assert.match(parseSpf('').errors[0], /empty/);
  assert.match(parseSpf(null).errors[0], /empty/);
});

test('a duplicate modifier is reported', () => {
  assert.ok(parseSpf('v=spf1 redirect=a.example redirect=b.example').errors.some((e) => /duplicate/.test(e)));
});

test('only the mechanisms that cost a DNS lookup are counted', () => {
  const parsed = parseSpf('v=spf1 ip4:198.51.100.1 ip6:2001:db8::1 a mx ptr exists:%{i}.example -all');
  assert.equal(countSpfLookups(parsed).total, 4, 'a, mx, ptr and exists cost one each; ip4, ip6 and all cost none');
});

test('the lookups inside an include are counted when they are known', () => {
  const parsed = parseSpf('v=spf1 include:big.example include:small.example -all');
  assert.equal(countSpfLookups(parsed, { 'big.example': 7 }).total, 8);
});

test('a redirect modifier costs a lookup too', () => {
  const parsed = parseSpf('v=spf1 redirect=_spf.provider.example');
  assert.equal(countSpfLookups(parsed, { '_spf.provider.example': 5 }).total, 5);
});

const zoneWith = (txt) => ({ apex: { TXT: txt }, _dmarc: { TXT: ['v=DMARC1; p=reject; rua=mailto:d@example.org'] } });
const base = { domain: 'example.org', mail: {} };
const ids = (f) => f.map((x) => x.id);

test('no SPF record at all', () => {
  assert.ok(ids(checkEmail(zoneWith([]), base)).includes('SPF001'));
});

test('two SPF records is a blocker even when both are individually correct', () => {
  const found = checkEmail(
    zoneWith(['v=spf1 include:a.example -all', 'v=spf1 include:b.example -all']),
    base
  ).find((f) => f.id === 'SPF002');
  assert.ok(found);
  assert.equal(found.severity, 'blocker');
});

test('a TXT record that is not SPF is not counted as one', () => {
  const found = ids(checkEmail(zoneWith(['google-site-verification=abc', 'v=spf1 -all']), base));
  assert.ok(!found.includes('SPF002'));
  assert.ok(!found.includes('SPF001'));
});

test('over ten lookups reports the breakdown, not just the total', () => {
  const profile = {
    domain: 'example.org',
    mail: { includeLookupCosts: { 'a.example': 5, 'b.example': 5 } }
  };
  const found = checkEmail(zoneWith(['v=spf1 include:a.example include:b.example a -all']), profile).find(
    (f) => f.id === 'SPF003'
  );
  assert.ok(found);
  assert.match(found.detail, /11 DNS lookups/);
  assert.match(found.detail, /include:a\.example \(5\)/);
});

test('a missing all is a finding, but a redirect instead of one is not', () => {
  assert.ok(ids(checkEmail(zoneWith(['v=spf1 include:a.example']), base)).includes('SPF004'));
  assert.ok(!ids(checkEmail(zoneWith(['v=spf1 redirect=a.example']), base)).includes('SPF004'));
});

test('+all is a blocker and ~all is not a finding', () => {
  const found = checkEmail(zoneWith(['v=spf1 +all']), base).find((f) => f.id === 'SPF005');
  assert.equal(found.severity, 'blocker');
  assert.ok(!ids(checkEmail(zoneWith(['v=spf1 ~all']), base)).includes('SPF005'));
});

test('ptr is reported', () => {
  assert.ok(ids(checkEmail(zoneWith(['v=spf1 ptr -all']), base)).includes('SPF006'));
});

test('the old sending host is low severity and the new one missing is high', () => {
  const profile = {
    domain: 'example.org',
    mail: { oldSendingHosts: ['_spf.oldhost.example'], newSendingHosts: ['_spf.newhost.example'] }
  };
  const found = checkEmail(zoneWith(['v=spf1 include:_spf.oldhost.example -all']), profile);
  assert.equal(found.find((f) => f.id === 'SPF007').severity, 'low');
  assert.equal(found.find((f) => f.id === 'SPF008').severity, 'high');
});

test('the withdrawn SPF record type is reported separately', () => {
  const zone = zoneWith(['v=spf1 -all']);
  zone.apex.SPF = ['v=spf1 -all'];
  assert.ok(ids(checkEmail(zone, base)).includes('SPF009'));
});
