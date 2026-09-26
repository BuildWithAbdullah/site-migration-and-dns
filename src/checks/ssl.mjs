// Certificate coverage and transport headers. The certificate is supplied as a
// description rather than fetched, so the logic below is testable and the
// network part stays in probe/ where it belongs.

import { raise } from '../catalog.mjs';

function nameMatches(pattern, host) {
  const p = String(pattern).trim().toLowerCase().replace(/\.$/, '');
  const h = String(host).trim().toLowerCase().replace(/\.$/, '');
  if (p === h) return true;
  if (!p.startsWith('*.')) return false;
  // A wildcard covers exactly one label, and never the name it wildcards.
  const suffix = p.slice(2);
  if (h === suffix) return false;
  if (!h.endsWith(`.${suffix}`)) return false;
  return !h.slice(0, h.length - suffix.length - 1).includes('.');
}

export function certificateCovers(certificate, host) {
  const names = certificate?.subjectAltNames ?? [];
  return names.some((n) => nameMatches(n, host));
}

function parseHsts(value) {
  if (!value) return null;
  const out = { maxAge: null, includeSubDomains: false, preload: false };
  for (const part of String(value).split(';')) {
    const piece = part.trim();
    const age = /^max-age\s*=\s*"?(\d+)"?$/i.exec(piece);
    if (age) out.maxAge = Number.parseInt(age[1], 10);
    if (/^includesubdomains$/i.test(piece)) out.includeSubDomains = true;
    if (/^preload$/i.test(piece)) out.preload = true;
  }
  return out;
}

export function checkSsl(observed, profile) {
  const findings = [];
  const domain = profile.domain;
  const www = `www.${domain}`;
  const cert = observed.certificate ?? null;
  const now = Date.parse(observed.now ?? new Date().toISOString());

  if (cert) {
    if (!certificateCovers(cert, www)) {
      findings.push(
        raise('SSL001', { where: www, detail: `certificate covers ${(cert.subjectAltNames ?? []).join(', ')}` })
      );
    }
    if (!certificateCovers(cert, domain)) {
      findings.push(
        raise('SSL002', { where: domain, detail: `certificate covers ${(cert.subjectAltNames ?? []).join(', ')}` })
      );
    }

    const notAfter = Date.parse(cert.notAfter ?? '');
    const notBefore = Date.parse(cert.notBefore ?? '');
    if (!Number.isNaN(notAfter) && notAfter < now) {
      findings.push(raise('SSL004', { where: domain, detail: `expired ${cert.notAfter}` }));
    } else if (!Number.isNaN(notAfter)) {
      const cutover = Date.parse(profile.cutoverAt ?? '');
      const windowEnd = Number.isNaN(cutover) ? now + 14 * 86400000 : cutover + 14 * 86400000;
      if (notAfter <= windowEnd) {
        findings.push(
          raise('SSL003', { where: domain, detail: `expires ${cert.notAfter}, inside the migration window` })
        );
      }
    }
    if (!Number.isNaN(notBefore) && notBefore > now) {
      findings.push(raise('SSL005', { where: domain, detail: `not valid until ${cert.notBefore}` }));
    }
  }

  // Redirect chain: each hop is { from, to, status }.
  const chain = observed.redirectChain ?? [];
  const startsHttp = chain.length > 0 && String(chain[0].from ?? '').startsWith('http://');
  if (observed.httpReachable === true && chain.length === 0) {
    findings.push(raise('SSL006', { where: domain, detail: 'http responds without redirecting to https' }));
  }
  if (startsHttp) {
    const intermediate = chain.slice(1).filter((hop) => String(hop.from ?? '').startsWith('http://'));
    if (intermediate.length > 0) {
      findings.push(
        raise('SSL007', {
          where: domain,
          detail: `chain passes through ${intermediate.map((h) => h.from).join(' then ')}`
        })
      );
    }
  }

  const headers = observed.headers ?? {};
  const hstsRaw = headers['strict-transport-security'] ?? headers['Strict-Transport-Security'] ?? null;
  const hsts = parseHsts(hstsRaw);

  if (!hsts && observed.httpsReachable !== false) {
    findings.push(raise('SSL008', { where: domain, detail: 'no Strict-Transport-Security header' }));
  }
  if (hsts) {
    if (hsts.preload && (hsts.maxAge ?? 0) < 31536000) {
      findings.push(
        raise('SSL009', { where: domain, detail: `preload requested with max-age=${hsts.maxAge ?? 'absent'}` })
      );
    }
    if (hsts.includeSubDomains) {
      const httpsSubdomains = new Set(profile.httpsSubdomains ?? []);
      const missing = (profile.subdomains ?? []).filter((s) => !httpsSubdomains.has(s));
      if (missing.length > 0) {
        findings.push(
          raise('SSL010', { where: domain, detail: `includeSubDomains set, but ${missing.join(', ')} not listed as https` })
        );
      }
    }
  }

  return findings;
}

export const __internals = { nameMatches, parseHsts };
