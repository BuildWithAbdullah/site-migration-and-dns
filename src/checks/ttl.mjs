// TTL staging. The arithmetic lives in planTtl so that it can be unit tested
// away from any zone data, because this is the part of a migration that is got
// wrong quietly: the record change looks instant to the person making it and
// takes the length of the previous TTL for everyone else.

import { raise } from '../catalog.mjs';

export const DEFAULTS = {
  // A TTL at or below this is treated as staged for a cutover.
  stagedTtl: 300,
  // Above this, a cutover has a rollback window measured in hours.
  longTtl: 3600,
  // How long to leave the lowered TTL in place after cutover before raising it.
  soakSeconds: 24 * 60 * 60,
  // A negative caching TTL above this keeps a missing name missing.
  longNegativeTtl: 3600
};

function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function iso(ms) {
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * The whole schedule, derived rather than asserted.
 *
 * ttlBeforeLowering is the TTL resolvers may still be holding. It is the
 * number that sets every deadline here, and it is not the TTL currently in
 * the zone once the TTL has been lowered.
 */
export function planTtl({
  cutoverAt,
  ttlBeforeLowering,
  loweredTtl,
  ttlLoweredAt = null,
  soakSeconds = DEFAULTS.soakSeconds
}) {
  const cutover = toMs(cutoverAt);
  if (cutover === null) throw new Error('planTtl needs a parsable cutoverAt');
  if (!Number.isFinite(ttlBeforeLowering) || ttlBeforeLowering < 0) {
    throw new Error('planTtl needs a non negative ttlBeforeLowering in seconds');
  }
  if (!Number.isFinite(loweredTtl) || loweredTtl < 0) {
    throw new Error('planTtl needs a non negative loweredTtl in seconds');
  }

  const lowered = toMs(ttlLoweredAt);
  const lowerNoLaterThan = cutover - ttlBeforeLowering * 1000;
  const earliestSafeCutover = lowered === null ? null : lowered + ttlBeforeLowering * 1000;
  const worstCaseStaleUntil = cutover + loweredTtl * 1000;
  const raiseNotBefore = worstCaseStaleUntil + soakSeconds * 1000;

  return {
    cutoverAt: iso(cutover),
    ttlBeforeLowering,
    loweredTtl,
    ttlLoweredAt: iso(lowered),
    // Lower the TTL by this moment, or the change is not staged at all.
    lowerNoLaterThan: iso(lowerNoLaterThan),
    // The cutover cannot usefully happen before this, because until then some
    // resolvers are still holding the longer TTL.
    earliestSafeCutover: iso(earliestSafeCutover),
    // After the change, the worst case moment by which every resolver has
    // dropped the old answer.
    worstCaseStaleUntil: iso(worstCaseStaleUntil),
    // Raising the TTL again before this shortens nothing and risks pinning a
    // bad answer for the new, longer time.
    raiseNotBefore: iso(raiseNotBefore),
    // How long a rollback takes to reach everyone, which is the number worth
    // telling the client before the cutover rather than during it.
    rollbackWindowSeconds: loweredTtl,
    staged: lowered !== null && lowered <= lowerNoLaterThan
  };
}

function apexTtls(zone) {
  const node = zone?.apex ?? {};
  const out = [];
  for (const type of ['A', 'AAAA', 'ALIAS', 'ANAME', 'CNAME']) {
    const records = node[type];
    if (!records) continue;
    for (const r of Array.isArray(records) ? records : [records]) {
      if (typeof r?.ttl === 'number') out.push({ type, ttl: r.ttl });
    }
  }
  return out;
}

export function checkTtl(zone, profile, options = {}) {
  const findings = [];
  const where = profile.domain;
  const opts = { ...DEFAULTS, ...options };
  const now = toMs(options.now ?? new Date());
  const cutover = toMs(profile.cutoverAt);
  const phase = profile.phase === 'post' ? 'post' : 'pre';

  const ttls = apexTtls(zone);
  const highest = ttls.reduce((max, r) => (r.ttl > max ? r.ttl : max), 0);

  if (phase === 'pre' && cutover !== null && ttls.length > 0) {
    const secondsToCutover = (cutover - now) / 1000;
    if (highest > opts.longTtl && secondsToCutover < highest) {
      findings.push(
        raise('TTL001', {
          where,
          detail: `apex TTL is ${highest}s with ${Math.max(0, Math.round(secondsToCutover))}s until cutover`
        })
      );
    }

    const loweredAt = toMs(profile.ttlLoweredAt);
    const ttlBefore = profile.ttlBeforeLowering ?? null;
    if (loweredAt !== null && Number.isFinite(ttlBefore)) {
      const plan = planTtl({
        cutoverAt: profile.cutoverAt,
        ttlBeforeLowering: ttlBefore,
        loweredTtl: highest || opts.stagedTtl,
        ttlLoweredAt: profile.ttlLoweredAt,
        soakSeconds: opts.soakSeconds
      });
      if (!plan.staged) {
        findings.push(
          raise('TTL002', {
            where,
            detail: `TTL lowered at ${plan.ttlLoweredAt}, which is later than ${plan.lowerNoLaterThan}. Earliest cutover that is actually staged is ${plan.earliestSafeCutover}.`
          })
        );
      }
    }
  }

  if (phase === 'post' && cutover !== null && ttls.length > 0) {
    const settledAt = cutover + (highest + opts.soakSeconds) * 1000;
    if (highest <= opts.stagedTtl && now > settledAt) {
      findings.push(
        raise('TTL003', {
          where,
          detail: `apex TTL still ${highest}s, more than ${Math.round(opts.soakSeconds / 3600)}h past the settle window`
        })
      );
    }
  }

  const soa = zone?.apex?.SOA;
  const negative = soa?.minimum ?? soa?.ttl ?? null;
  if (phase === 'pre' && Number.isFinite(negative) && negative > opts.longNegativeTtl) {
    findings.push(
      raise('TTL004', { where, detail: `SOA minimum is ${negative}s, so a missing name stays missing for that long` })
    );
  }

  return findings;
}
