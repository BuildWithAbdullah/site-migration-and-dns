import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkDns } from '../src/checks/dns.mjs';

const profile = {
  domain: 'example.org',
  phase: 'pre',
  oldHost: { addresses: ['203.0.113.10'] },
  newHost: { addresses: ['198.51.100.20'], name: 'web.newhost.example' },
  intendedNameservers: ['ns1.dnsprovider.example', 'ns2.dnsprovider.example'],
  certificateIssuer: 'letsencrypt.org',
  mail: { movesWithSite: true, oldMailHosts: ['mail.oldhost.example'] }
};

const clean = () => ({
  apex: {
    A: [{ value: '198.51.100.20', ttl: 300 }],
    NS: [{ value: 'ns1.dnsprovider.example' }, { value: 'ns2.dnsprovider.example' }],
    MX: [{ value: 'mail.mailprovider.example', priority: 10 }],
    CAA: [{ tag: 'issue', value: 'letsencrypt.org' }]
  },
  www: { CNAME: [{ value: 'example.org', ttl: 300 }] }
});

const ids = (findings) => findings.map((f) => f.id).sort();

test('a correct zone raises nothing', () => {
  assert.deepEqual(ids(checkDns(clean(), profile)), []);
});

test('an apex CNAME is reported instead of a missing address record, not as well as', () => {
  const zone = clean();
  delete zone.apex.A;
  zone.apex.CNAME = [{ value: 'web.newhost.example' }];
  const found = ids(checkDns(zone, profile));
  assert.ok(found.includes('DNS001'));
  assert.ok(!found.includes('DNS002'), 'DNS002 would be a second complaint about one fact');
});

test('an ALIAS record at the apex is an address record', () => {
  const zone = clean();
  delete zone.apex.A;
  zone.apex.ALIAS = [{ value: 'web.newhost.example', ttl: 300 }];
  assert.deepEqual(ids(checkDns(zone, profile)), []);
});

test('www with address records rather than a CNAME is fine', () => {
  const zone = clean();
  zone.www = { A: [{ value: '198.51.100.20', ttl: 300 }] };
  assert.deepEqual(ids(checkDns(zone, profile)), []);
});

test('the old host address is only a finding after cutover', () => {
  const zone = clean();
  zone.apex.A = [{ value: '203.0.113.10', ttl: 300 }];
  assert.ok(!ids(checkDns(zone, profile)).includes('DNS004'), 'before cutover both answers are correct');
  assert.ok(ids(checkDns(zone, { ...profile, phase: 'post' })).includes('DNS004'));
});

test('nameserver comparison ignores order and a trailing dot', () => {
  const zone = clean();
  zone.apex.NS = [{ value: 'NS2.dnsprovider.example.' }, { value: 'ns1.dnsprovider.example' }];
  assert.deepEqual(ids(checkDns(zone, profile)), []);
});

test('a delegation to somewhere else is a blocker', () => {
  const zone = clean();
  zone.apex.NS = [{ value: 'ns1.otherprovider.example' }];
  const found = checkDns(zone, profile).find((f) => f.id === 'DNS005');
  assert.ok(found);
  assert.equal(found.severity, 'blocker');
  assert.match(found.detail, /ns1\.otherprovider\.example/);
});

test('MX pointing at the web host is caught by address as well as by name', () => {
  const byName = clean();
  byName.apex.MX = [{ value: 'web.newhost.example', priority: 10 }];
  assert.ok(ids(checkDns(byName, profile)).includes('DNS007'));

  const byAddress = clean();
  byAddress.apex.MX = [{ value: '198.51.100.20', priority: 10 }];
  assert.ok(ids(checkDns(byAddress, profile)).includes('DNS007'));
});

test('the old mail host is only a finding when mail was supposed to move', () => {
  const zone = clean();
  zone.apex.MX = [{ value: 'mail.oldhost.example', priority: 10 }];
  assert.ok(ids(checkDns(zone, profile)).includes('DNS008'));
  const staying = { ...profile, mail: { ...profile.mail, movesWithSite: false } };
  assert.ok(!ids(checkDns(zone, staying)).includes('DNS008'), 'leaving mail put is a normal choice');
});

test('CAA is only a finding when it excludes the new issuer', () => {
  const excludes = clean();
  excludes.apex.CAA = [{ tag: 'issue', value: 'someotherca.example' }];
  assert.ok(ids(checkDns(excludes, profile)).includes('DNS009'));

  const absent = clean();
  delete absent.apex.CAA;
  assert.ok(!ids(checkDns(absent, profile)).includes('DNS009'), 'no CAA authorises everyone');

  const wildcard = clean();
  wildcard.apex.CAA = [{ tag: 'issuewild', value: 'letsencrypt.org' }];
  assert.ok(!ids(checkDns(wildcard, profile)).includes('DNS009'));
});

test('two addresses are only a finding when they mix the old and new hosts', () => {
  const split = clean();
  split.apex.A = [{ value: '198.51.100.20' }, { value: '203.0.113.10' }];
  assert.ok(ids(checkDns(split, { ...profile, phase: 'pre' })).includes('DNS010'));

  const roundRobin = clean();
  roundRobin.apex.A = [{ value: '198.51.100.20' }, { value: '198.51.100.21' }];
  assert.ok(!ids(checkDns(roundRobin, profile)).includes('DNS010'), 'round robin is not a defect');
});

test('a zone with no MX at all is a blocker', () => {
  const zone = clean();
  delete zone.apex.MX;
  const found = checkDns(zone, profile).find((f) => f.id === 'DNS006');
  assert.ok(found);
  assert.equal(found.severity, 'blocker');
});
