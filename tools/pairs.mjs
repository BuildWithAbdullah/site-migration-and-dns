// The pair manifest: for each example, the complete set of findings its failing
// side raises, as id to severity.
//
// Declaring the severity rather than only the id is what lets the exit code of
// every example be derived rather than written down. migrate-check exits 1 when
// anything at or above the threshold was found, so the expected exit code of a
// side is a function of this manifest and the severity order, and
// tools/exit-codes.mjs computes it instead of carrying a table that could agree
// with a broken binary.
//
// The same set is also written in prose in each example's own README, because
// that is what a reader sees. The suite asserts the three agree: what the checks
// produce, what this manifest declares, and what the README claims. Any one of
// them drifting fails.

import { SEVERITIES } from '../src/catalog.mjs';

export const PAIRS = [
  { name: '01-apex-cname', findings: { DNS001: 'blocker', DNS003: 'high' } },
  { name: '02-ttl-staging', findings: { TTL001: 'high', TTL002: 'high', TTL004: 'medium' } },
  { name: '03-spf-lookup-limit', findings: { SPF003: 'high', SPF004: 'medium', SPF006: 'medium' } },
  { name: '04-dkim-and-dmarc', findings: { DKIM002: 'medium', DKIM003: 'medium', DMARC001: 'medium' } },
  {
    name: '05-certificate-coverage',
    findings: { SSL001: 'blocker', SSL003: 'high', SSL007: 'medium', SSL008: 'low' }
  },
  {
    name: '06-serialized-search-and-replace',
    findings: { SER001: 'blocker', SER002: 'blocker', SER003: 'high', SER004: 'high' }
  },
  {
    name: '07-redirect-map-coverage',
    findings: {
      RED001: 'high',
      RED002: 'medium',
      RED003: 'blocker',
      RED004: 'high',
      RED005: 'medium',
      RED006: 'medium',
      RED007: 'medium',
      RED008: 'high'
    }
  },
  {
    name: '08-mixed-content',
    findings: {
      MIX001: 'high',
      MIX002: 'low',
      MIX003: 'high',
      MIX004: 'high',
      MIX005: 'high',
      MIX006: 'medium',
      MIX007: 'blocker'
    }
  },
  {
    name: '09-staging-config-in-production',
    findings: {
      IDX001: 'blocker',
      IDX003: 'blocker',
      IDX005: 'blocker',
      IDX006: 'blocker',
      IDX007: 'high',
      IDX008: 'medium',
      IDX009: 'low',
      IDX010: 'high',
      MIX003: 'high'
    }
  },
  {
    name: '10-mail-does-not-survive-the-move',
    findings: { DKIM001: 'high', DNS006: 'blocker', SPF001: 'high' }
  },
  { name: '11-hsts-that-enforces-nothing', findings: { SSL011: 'high' } },
  { name: '12-development-urls-in-production', findings: { MIX008: 'high' } },
  { name: '13-dmarc-that-enforces-nothing', findings: { DMARC008: 'high' } }
];

export function pairNames() {
  return PAIRS.map((p) => p.name);
}

export function pairFor(name) {
  const pair = PAIRS.find((p) => p.name === name);
  if (!pair) throw new Error(`no manifest entry for example ${name}. Add it to tools/pairs.mjs.`);
  return pair;
}

/** The ids one side of one pair is expected to raise. The corrected side raises none. */
export function expectedIds(name, side) {
  return side === 'pass' ? [] : Object.keys(pairFor(name).findings).sort();
}

/**
 * The exit code migrate-check must return for one side of one pair at one
 * threshold, derived from the manifest rather than recorded. Exit 1 means
 * something at or above the threshold was found.
 */
export function expectedExitCode(name, side, threshold = 'high') {
  if (side === 'pass') return 0;
  const limit = SEVERITIES.indexOf(threshold);
  if (limit === -1) throw new Error(`${threshold} is not a severity`);
  const severities = Object.values(pairFor(name).findings);
  return severities.some((s) => SEVERITIES.indexOf(s) <= limit) ? 1 : 0;
}

/** Every finding the pairs between them reach, which is deliberately not all of them. */
export function reachedByPairs() {
  const out = new Set();
  for (const pair of PAIRS) for (const id of Object.keys(pair.findings)) out.add(id);
  return Array.from(out).sort();
}
