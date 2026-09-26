import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { rsaKeyBits, parseDkim, parseDmarc, parseTagList, checkEmail } from '../src/checks/email.mjs';

const key = (bits, type = 'spki') =>
  generateKeyPairSync('rsa', { modulusLength: bits, publicKeyEncoding: { type, format: 'der' } })
    .publicKey.toString('base64');

test('the modulus size is read out of the DER rather than guessed from the base64 length', () => {
  for (const bits of [512, 1024, 2048]) {
    assert.equal(rsaKeyBits(key(bits, 'spki')), bits, `spki ${bits}`);
    assert.equal(rsaKeyBits(key(bits, 'pkcs1')), bits, `pkcs1 ${bits}`);
  }
});

test('a key that is not a structure we understand returns null rather than a number', () => {
  assert.equal(rsaKeyBits('not base64 at all !!'), null);
  assert.equal(rsaKeyBits(''), null);
  assert.equal(rsaKeyBits(null), null);
  assert.equal(rsaKeyBits('YWJj'), null);
});

test('whitespace inside a published key is tolerated, because zone files wrap it', () => {
  const wrapped = key(2048).replace(/(.{40})/g, '$1\n  ');
  assert.equal(rsaKeyBits(wrapped), 2048);
});

test('a tag list keeps order, records duplicates and does not throw on rubbish', () => {
  const parsed = parseTagList('v=DKIM1; k=rsa; k=ed25519; oops; p=abc');
  assert.deepEqual(parsed.order, ['v', 'k', 'p']);
  assert.deepEqual(parsed.duplicates, ['k']);
  assert.equal(parsed.tags.k, 'rsa', 'the first value wins, as a receiver would take it');
  assert.match(parsed.errors[0], /without a value/);
});

test('a DKIM record exposes its flags and key size', () => {
  const dkim = parseDkim(`v=DKIM1; k=rsa; t=y:s; p=${key(1024)}`);
  assert.deepEqual(dkim.flags, ['y', 's']);
  assert.equal(dkim.keyBits, 1024);
});

test('a non RSA key type reports no bit length rather than a wrong one', () => {
  assert.equal(parseDkim('v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=').keyBits, null);
});

test('DMARC defaults are the defaults the specification gives, not absent values', () => {
  const dmarc = parseDmarc('v=DMARC1; p=none');
  assert.equal(dmarc.pct, 100);
  assert.equal(dmarc.adkim, 'r');
  assert.equal(dmarc.aspf, 'r');
  assert.equal(dmarc.subdomainPolicy, null);
  assert.deepEqual(dmarc.rua, []);
});

const zone = (overrides) => ({
  apex: { TXT: ['v=spf1 -all'] },
  'sel1._domainkey': { TXT: [`v=DKIM1; k=rsa; p=${key(2048)}`] },
  _dmarc: { TXT: ['v=DMARC1; p=reject; rua=mailto:d@example.org'] },
  ...overrides
});
const profile = { domain: 'example.org', mail: { dkimSelectors: ['sel1'] } };
const ids = (f) => f.map((x) => x.id);

test('a missing selector record is reported against the selector name', () => {
  const z = zone({});
  delete z['sel1._domainkey'];
  const found = checkEmail(z, profile).find((f) => f.id === 'DKIM001');
  assert.ok(found);
  assert.equal(found.where, 'sel1._domainkey.example.org');
});

test('a short key and a revoked key are different findings, and not both at once', () => {
  const short = checkEmail(zone({ 'sel1._domainkey': { TXT: [`v=DKIM1; p=${key(512)}`] } }), profile);
  assert.ok(ids(short).includes('DKIM002'));

  const revoked = checkEmail(zone({ 'sel1._domainkey': { TXT: ['v=DKIM1; k=rsa; p='] } }), profile);
  assert.ok(ids(revoked).includes('DKIM004'));
  assert.ok(!ids(revoked).includes('DKIM002'), 'an empty key has no size to complain about');
});

test('testing mode is reported on its own', () => {
  const found = checkEmail(zone({ 'sel1._domainkey': { TXT: [`v=DKIM1; t=y; p=${key(2048)}`] } }), profile);
  assert.ok(ids(found).includes('DKIM003'));
  assert.ok(!ids(found).includes('DKIM002'));
});

test('no DMARC record, and two of them, are separate findings', () => {
  const none = zone({});
  delete none._dmarc;
  assert.ok(ids(checkEmail(none, profile)).includes('DMARC001'));

  const two = zone({ _dmarc: { TXT: ['v=DMARC1; p=none; rua=mailto:a@b.example', 'v=DMARC1; p=reject; rua=mailto:a@b.example'] } });
  assert.ok(ids(checkEmail(two, profile)).includes('DMARC006'));
});

test('p=none is low, a missing rua is medium, and a partial pct is low', () => {
  const found = checkEmail(zone({ _dmarc: { TXT: ['v=DMARC1; p=none; pct=20'] } }), profile);
  assert.equal(found.find((f) => f.id === 'DMARC002').severity, 'low');
  assert.equal(found.find((f) => f.id === 'DMARC003').severity, 'medium');
  assert.equal(found.find((f) => f.id === 'DMARC004').severity, 'low');
});

test('strict alignment is only a finding when a policy is being enforced', () => {
  const enforced = zone({ _dmarc: { TXT: ['v=DMARC1; p=reject; adkim=s; rua=mailto:d@example.org'] } });
  assert.ok(ids(checkEmail(enforced, profile)).includes('DMARC005'));

  const reporting = zone({ _dmarc: { TXT: ['v=DMARC1; p=none; adkim=s; rua=mailto:d@example.org'] } });
  assert.ok(!ids(checkEmail(reporting, profile)).includes('DMARC005'), 'under p=none it only affects the reports');

  const aligned = { domain: 'example.org', mail: { dkimSelectors: ['sel1'], alignedAuthentication: true } };
  assert.ok(!ids(checkEmail(enforced, aligned)).includes('DMARC005'));
});

test('a weaker subdomain policy is only a finding under an enforcing domain policy', () => {
  const strict = zone({ _dmarc: { TXT: ['v=DMARC1; p=reject; sp=none; rua=mailto:d@example.org'] } });
  assert.ok(ids(checkEmail(strict, profile)).includes('DMARC007'));

  const relaxed = zone({ _dmarc: { TXT: ['v=DMARC1; p=none; sp=none; rua=mailto:d@example.org'] } });
  assert.ok(!ids(checkEmail(relaxed, profile)).includes('DMARC007'));
});
