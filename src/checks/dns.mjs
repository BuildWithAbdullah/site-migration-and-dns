// Zone shape checks. Pure: it is handed a zone snapshot and a migration
// profile, and returns findings. Nothing here touches the network, which is
// why every branch below is reachable from a test.

import { raise } from '../catalog.mjs';

const ADDRESS_TYPES = ['A', 'AAAA', 'ALIAS', 'ANAME'];

function recordsOf(zone, name, type) {
  const node = zone?.[name];
  if (!node) return [];
  const value = node[type];
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function addressValues(zone, name) {
  const out = [];
  for (const type of ADDRESS_TYPES) {
    for (const r of recordsOf(zone, name, type)) {
      out.push({ type, value: typeof r === 'string' ? r : r.value, ttl: r?.ttl ?? null });
    }
  }
  return out;
}

function normaliseHost(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
}

export function checkDns(zone, profile) {
  const findings = [];
  const where = profile.domain;
  const phase = profile.phase === 'post' ? 'post' : 'pre';

  const apexAddresses = addressValues(zone, 'apex');
  const apexCnames = recordsOf(zone, 'apex', 'CNAME');

  // DNS001: an apex CNAME is legal to type into most control panels and still
  // wrong, because the apex also has to answer SOA and MX at the same name.
  if (apexCnames.length > 0) {
    findings.push(
      raise('DNS001', {
        where,
        detail: `apex CNAME to ${normaliseHost(apexCnames[0].value ?? apexCnames[0])}`
      })
    );
  } else if (apexAddresses.length === 0) {
    findings.push(raise('DNS002', { where, detail: 'no A, AAAA or ALIAS record at the apex' }));
  }

  if (addressValues(zone, 'www').length === 0 && recordsOf(zone, 'www', 'CNAME').length === 0) {
    findings.push(raise('DNS003', { where: `www.${profile.domain}`, detail: 'no address or CNAME record' }));
  }

  // DNS004: only meaningful once the cutover is supposed to have happened.
  const oldAddresses = (profile.oldHost?.addresses ?? []).map(normaliseHost);
  if (phase === 'post' && oldAddresses.length > 0) {
    for (const name of ['apex', 'www']) {
      for (const record of addressValues(zone, name)) {
        if (oldAddresses.includes(normaliseHost(record.value))) {
          findings.push(
            raise('DNS004', {
              where: name === 'apex' ? profile.domain : `${name}.${profile.domain}`,
              detail: `${record.type} ${record.value} is the old host address`
            })
          );
        }
      }
    }
  }

  // DNS005: the delegation, not the zone contents. Editing a zone nobody is
  // asking is the failure this catches.
  const intended = (profile.intendedNameservers ?? []).map(normaliseHost).sort();
  if (intended.length > 0) {
    const actual = recordsOf(zone, 'apex', 'NS')
      .map((r) => normaliseHost(typeof r === 'string' ? r : r.value))
      .sort();
    if (actual.length > 0 && (actual.length !== intended.length || actual.some((ns, i) => ns !== intended[i]))) {
      findings.push(
        raise('DNS005', {
          where,
          detail: `delegated to ${actual.join(', ')}, profile expects ${intended.join(', ')}`
        })
      );
    }
  }

  // Mail records. A zone rebuilt at a new host is the usual way these vanish.
  const mx = recordsOf(zone, 'apex', 'MX').map((r) => ({
    host: normaliseHost(typeof r === 'string' ? r : r.value),
    priority: r?.priority ?? null
  }));

  if (mx.length === 0) {
    findings.push(raise('DNS006', { where, detail: 'zone has no MX record' }));
  } else {
    const newAddresses = (profile.newHost?.addresses ?? []).map(normaliseHost);
    const newHostNames = [normaliseHost(profile.newHost?.name), ...newAddresses].filter(Boolean);
    const oldMailHosts = (profile.mail?.oldMailHosts ?? []).map(normaliseHost);

    for (const entry of mx) {
      if (newHostNames.includes(entry.host)) {
        findings.push(raise('DNS007', { where, detail: `MX ${entry.host} is the web host` }));
      }
      if (oldMailHosts.includes(entry.host) && profile.mail?.movesWithSite === true) {
        findings.push(raise('DNS008', { where, detail: `MX ${entry.host} is the old mail host` }));
      }
    }
  }

  // DNS009: CAA is only a problem when it exists and excludes the new issuer.
  const caa = recordsOf(zone, 'apex', 'CAA').map((r) => ({
    tag: (r.tag ?? '').toLowerCase(),
    value: normaliseHost(r.value)
  }));
  const issuer = normaliseHost(profile.certificateIssuer);
  if (caa.length > 0 && issuer) {
    const issueTags = caa.filter((r) => r.tag === 'issue' || r.tag === 'issuewild');
    if (issueTags.length > 0 && !issueTags.some((r) => r.value === issuer || r.value === '')) {
      findings.push(
        raise('DNS009', {
          where,
          detail: `CAA authorises ${issueTags.map((r) => r.value).join(', ')}, new host uses ${issuer}`
        })
      );
    }
  }

  // DNS010: two live addresses at different hosts is the split brain that
  // produces a bug report nobody else can reproduce.
  if (apexAddresses.length > 1) {
    const newAddresses = (profile.newHost?.addresses ?? []).map(normaliseHost);
    const values = apexAddresses.map((r) => normaliseHost(r.value));
    const unique = Array.from(new Set(values));
    const mixesKnownHosts =
      unique.some((v) => oldAddresses.includes(v)) && unique.some((v) => newAddresses.includes(v));
    if (unique.length > 1 && mixesKnownHosts) {
      findings.push(raise('DNS010', { where, detail: `apex answers ${unique.join(' and ')}` }));
    }
  }

  return findings;
}

export const __internals = { addressValues, recordsOf, normaliseHost };
