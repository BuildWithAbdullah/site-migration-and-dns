import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planTtl, checkTtl, DEFAULTS } from '../src/checks/ttl.mjs';

test('the deadline to lower a TTL is one old TTL before cutover', () => {
  const plan = planTtl({
    cutoverAt: '2026-10-15T02:00:00Z',
    ttlBeforeLowering: 86400,
    loweredTtl: 300
  });
  assert.equal(plan.lowerNoLaterThan, '2026-10-14T02:00:00.000Z');
});

test('lowering the TTL late moves the earliest useful cutover, and says when to', () => {
  const plan = planTtl({
    cutoverAt: '2026-10-15T02:00:00Z',
    ttlBeforeLowering: 86400,
    loweredTtl: 300,
    ttlLoweredAt: '2026-10-15T01:00:00Z'
  });
  assert.equal(plan.staged, false);
  assert.equal(plan.earliestSafeCutover, '2026-10-16T01:00:00.000Z');
});

test('lowering it in good time is staged', () => {
  const plan = planTtl({
    cutoverAt: '2026-10-15T02:00:00Z',
    ttlBeforeLowering: 86400,
    loweredTtl: 300,
    ttlLoweredAt: '2026-10-13T02:00:00Z'
  });
  assert.equal(plan.staged, true);
});

test('lowering exactly on the deadline counts as staged', () => {
  const plan = planTtl({
    cutoverAt: '2026-10-15T02:00:00Z',
    ttlBeforeLowering: 3600,
    loweredTtl: 300,
    ttlLoweredAt: '2026-10-15T01:00:00Z'
  });
  assert.equal(plan.staged, true);
});

test('the rollback window is the lowered TTL, not the original one', () => {
  const plan = planTtl({ cutoverAt: '2026-10-15T02:00:00Z', ttlBeforeLowering: 86400, loweredTtl: 300 });
  assert.equal(plan.rollbackWindowSeconds, 300);
  assert.equal(plan.worstCaseStaleUntil, '2026-10-15T02:05:00.000Z');
});

test('the TTL may be raised again one soak period after the stale window closes', () => {
  const plan = planTtl({
    cutoverAt: '2026-10-15T02:00:00Z',
    ttlBeforeLowering: 86400,
    loweredTtl: 300,
    soakSeconds: 3600
  });
  assert.equal(plan.raiseNotBefore, '2026-10-15T03:05:00.000Z');
});

test('planTtl refuses input it cannot compute from', () => {
  assert.throws(() => planTtl({ cutoverAt: 'not a date', ttlBeforeLowering: 1, loweredTtl: 1 }), /cutoverAt/);
  assert.throws(() => planTtl({ cutoverAt: '2026-10-15T02:00:00Z', ttlBeforeLowering: -1, loweredTtl: 1 }), /ttlBeforeLowering/);
  assert.throws(() => planTtl({ cutoverAt: '2026-10-15T02:00:00Z', ttlBeforeLowering: 1, loweredTtl: NaN }), /loweredTtl/);
});

const zone = (ttl, minimum = 300) => ({
  apex: { A: [{ value: '198.51.100.20', ttl }], SOA: { minimum } }
});

test('a long TTL is only flagged once the cutover is inside it', () => {
  const profile = { domain: 'example.org', phase: 'pre', cutoverAt: '2026-10-01T06:00:00Z' };
  const close = checkTtl(zone(86400), profile, { now: '2026-10-01T00:00:00Z' });
  assert.ok(close.some((f) => f.id === 'TTL001'));

  const faraway = checkTtl(zone(86400), profile, { now: '2026-09-01T00:00:00Z' });
  assert.ok(!faraway.some((f) => f.id === 'TTL001'), 'a month out there is still time to stage it');
});

test('a TTL lowered too late is reported with the date it should have been', () => {
  const profile = {
    domain: 'example.org',
    phase: 'pre',
    cutoverAt: '2026-10-01T06:00:00Z',
    ttlBeforeLowering: 86400,
    ttlLoweredAt: '2026-09-30T23:00:00Z'
  };
  const found = checkTtl(zone(300), profile, { now: '2026-10-01T00:00:00Z' }).find((f) => f.id === 'TTL002');
  assert.ok(found);
  assert.match(found.detail, /2026-09-30T06:00:00\.000Z/);
});

test('a TTL left low is housekeeping, and only after the settle window', () => {
  const profile = { domain: 'example.org', phase: 'post', cutoverAt: '2026-10-01T00:00:00Z' };
  const soon = checkTtl(zone(300), profile, { now: '2026-10-01T06:00:00Z' });
  assert.ok(!soon.some((f) => f.id === 'TTL003'), 'six hours after cutover it is still doing its job');

  const later = checkTtl(zone(300), profile, { now: '2026-10-05T00:00:00Z' });
  const found = later.find((f) => f.id === 'TTL003');
  assert.ok(found);
  assert.equal(found.severity, 'low');
});

test('a long SOA negative TTL is flagged before cutover', () => {
  const profile = { domain: 'example.org', phase: 'pre', cutoverAt: '2026-10-15T00:00:00Z' };
  assert.ok(
    checkTtl(zone(300, 86400), profile, { now: '2026-10-01T00:00:00Z' }).some((f) => f.id === 'TTL004')
  );
  assert.ok(
    !checkTtl(zone(300, DEFAULTS.longNegativeTtl), profile, { now: '2026-10-01T00:00:00Z' }).some(
      (f) => f.id === 'TTL004'
    ),
    'exactly at the threshold is not over it'
  );
});
