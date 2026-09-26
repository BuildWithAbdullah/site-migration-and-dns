// Redirect map coverage. The map is data, so this is arithmetic over two
// inventories rather than a crawl, and it can therefore run before the new site
// is reachable at all, which is when the answer is still cheap to act on.

import { raise } from '../catalog.mjs';

function normalise(url) {
  return String(url ?? '').trim();
}

function pathOf(url) {
  try {
    return new URL(url, 'https://placeholder.invalid').pathname;
  } catch {
    return url;
  }
}

function queryOf(url) {
  try {
    return new URL(url, 'https://placeholder.invalid').search;
  } catch {
    return '';
  }
}

function keyOf(url) {
  const u = normalise(url);
  try {
    const parsed = new URL(u, 'https://placeholder.invalid');
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return u;
  }
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Follow the map from one URL, stopping on a loop. Exported so the test can assert the loop case directly. */
export function followChain(map, start, limit = 10) {
  const byKey = new Map(map.map((r) => [keyOf(r.from), r]));
  const visited = [];
  let current = normalise(start);
  for (let i = 0; i < limit; i += 1) {
    if (visited.includes(keyOf(current))) return { hops: visited.length, destination: current, loop: true, visited };
    visited.push(keyOf(current));
    const rule = byKey.get(keyOf(current));
    if (!rule) return { hops: visited.length - 1, destination: current, loop: false, visited };
    const next = normalise(rule.to);
    // A target written as a full URL hands the request to whatever answers that
    // host. The map stops there, and following it by path as though it were
    // another entry invents loops that do not exist.
    if (ABSOLUTE.test(next) && !ABSOLUTE.test(current)) {
      return { hops: visited.length, destination: next, loop: false, visited };
    }
    current = next;
  }
  return { hops: limit, destination: current, loop: true, visited };
}

function patternShadows(broad, specific) {
  if (!broad.includes('*')) return false;
  const escaped = broad.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(specific);
}

export function checkRedirects(input, profile) {
  const findings = [];
  const map = input.map ?? [];
  const oldInventory = input.oldInventory ?? [];
  const newInventory = new Set((input.newInventory ?? []).map(keyOf));
  const mapped = new Set(map.map((r) => keyOf(r.from)));

  for (const url of oldInventory) {
    const key = keyOf(url);
    if (!mapped.has(key) && !newInventory.has(key)) {
      findings.push(raise('RED001', { where: url, detail: 'not in the redirect map and not in the new inventory' }));
    }
  }

  for (const rule of map) {
    // These two are properties of the rule as written, so they are raised
    // before the chain is followed. Raising them afterwards meant a rule in a
    // loop never reported the simpler defect sitting on its own line.
    if (queryOf(rule.from) !== '' && queryOf(rule.to) === '') {
      findings.push(
        raise('RED005', { where: rule.from, detail: `query ${queryOf(rule.from)} is not carried to ${rule.to}` })
      );
    }
    if (String(rule.to ?? '').startsWith('http://')) {
      findings.push(raise('RED007', { where: rule.from, detail: `target is ${rule.to}` }));
    }

    const chain = followChain(map, rule.from);
    if (chain.loop) {
      findings.push(raise('RED003', { where: rule.from, detail: `loops through ${chain.visited.join(' -> ')}` }));
      continue;
    }
    if (chain.hops > 1) {
      findings.push(
        raise('RED002', { where: rule.from, detail: `${chain.hops} hops, ending at ${chain.destination}` })
      );
    }
    if (newInventory.size > 0 && !newInventory.has(keyOf(chain.destination))) {
      findings.push(
        raise('RED004', { where: rule.from, detail: `target ${chain.destination} is not in the new inventory` })
      );
    }
  }

  // Trailing slash: only a finding when the map itself disagrees with itself,
  // because either convention is fine as long as it is one convention.
  const withSlash = map.filter((r) => pathOf(r.to).length > 1 && pathOf(r.to).endsWith('/')).length;
  const withoutSlash = map.filter((r) => pathOf(r.to).length > 1 && !pathOf(r.to).endsWith('/')).length;
  if (withSlash > 0 && withoutSlash > 0) {
    findings.push(
      raise('RED006', {
        where: profile.domain,
        detail: `${withSlash} targets end in a slash, ${withoutSlash} do not`
      })
    );
  }

  for (let i = 0; i < map.length; i += 1) {
    for (let j = i + 1; j < map.length; j += 1) {
      if (patternShadows(String(map[i].from), String(map[j].from))) {
        findings.push(
          raise('RED008', { where: map[j].from, detail: `shadowed by the earlier rule ${map[i].from}` })
        );
      }
    }
  }

  return findings;
}

export const __internals = { keyOf, patternShadows };
