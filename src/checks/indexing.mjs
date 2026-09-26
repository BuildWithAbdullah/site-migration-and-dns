// robots.txt, meta robots, canonical, sitemap and hreflang. These are the
// checks that catch a staging configuration arriving in production, which is
// the most expensive migration mistake per character of config.

import { raise } from '../catalog.mjs';
import { __internals as redirectInternals } from './redirects.mjs';

// The sitemap lists absolute URLs and a redirect map is usually written as
// paths, so the two are compared on a normalised path and query rather than on
// the text as written. Without this the check quietly never fires.
const { keyOf } = redirectInternals;

export function parseRobots(text) {
  const result = { groups: [], sitemaps: [], errors: [] };
  let current = null;
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') return;
    const colon = line.indexOf(':');
    if (colon === -1) {
      result.errors.push({ line: i + 1, detail: `no field separator: ${line}` });
      return;
    }
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        result.groups.push(current);
      }
      current.agents.push(value);
      return;
    }
    if (field === 'sitemap') {
      result.sitemaps.push(value);
      return;
    }
    if (field === 'allow' || field === 'disallow') {
      if (!current) {
        current = { agents: ['*'], rules: [] };
        result.groups.push(current);
      }
      current.rules.push({ type: field, path: value, line: i + 1 });
    }
  });
  return result;
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkIndexing(input, profile) {
  const findings = [];
  const domain = String(profile.domain ?? '').toLowerCase();
  const oldDomain = profile.oldDomain ? String(profile.oldDomain).toLowerCase() : null;
  const stagingHosts = (profile.stagingHosts ?? []).map((h) => h.toLowerCase());
  const isOwnHost = (host) => host === domain || host === `www.${domain}`;

  // --- robots.txt
  if (typeof input.robots === 'string') {
    const robots = parseRobots(input.robots);
    for (const group of robots.groups) {
      const blanket = group.rules.find((r) => r.type === 'disallow' && r.path === '/');
      const allowsSomething = group.rules.some((r) => r.type === 'allow' && r.path !== '');
      if (blanket && !allowsSomething) {
        findings.push(
          raise('IDX001', {
            where: 'robots.txt',
            line: blanket.line,
            detail: `Disallow: / for user-agent ${group.agents.join(', ')}`
          })
        );
      }
    }
    if (robots.sitemaps.length === 0) {
      findings.push(raise('IDX009', { where: 'robots.txt', detail: 'no Sitemap line' }));
    }
    for (const sitemap of robots.sitemaps) {
      const host = hostOf(sitemap);
      if (host && oldDomain && (host === oldDomain || host === `www.${oldDomain}`)) {
        findings.push(raise('IDX002', { where: 'robots.txt', detail: `Sitemap: ${sitemap}` }));
      }
    }
  }

  // --- page level
  for (const page of input.pages ?? []) {
    const html = String(page.html ?? '');
    const where = page.url ?? page.path ?? 'page';

    const metaRobots = /<meta\s+[^>]*name\s*=\s*["']robots["'][^>]*>/gi;
    let meta;
    while ((meta = metaRobots.exec(html)) !== null) {
      if (/noindex/i.test(meta[0])) {
        findings.push(
          raise('IDX003', {
            where,
            line: html.slice(0, meta.index).split('\n').length,
            detail: meta[0].slice(0, 90)
          })
        );
        break;
      }
    }

    const canonical = /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
    if (canonical) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(canonical[0]);
      const host = href ? hostOf(href[1]) : null;
      const line = html.slice(0, canonical.index).split('\n').length;
      if (host && stagingHosts.includes(host)) {
        findings.push(raise('IDX006', { where, line, detail: `canonical points at ${href[1]}` }));
      } else if (host && oldDomain && (host === oldDomain || host === `www.${oldDomain}`)) {
        findings.push(raise('IDX005', { where, line, detail: `canonical points at ${href[1]}` }));
      }
    }

    const alternates = /<link\s+[^>]*hreflang\s*=\s*["'][^"']+["'][^>]*>/gi;
    let alt;
    while ((alt = alternates.exec(html)) !== null) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(alt[0]);
      const host = href ? hostOf(href[1]) : null;
      if (host && oldDomain && (host === oldDomain || host === `www.${oldDomain}`)) {
        findings.push(
          raise('IDX010', {
            where,
            line: html.slice(0, alt.index).split('\n').length,
            detail: `hreflang alternate ${href[1]}`
          })
        );
        break;
      }
    }

    const headers = page.headers ?? {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'x-robots-tag' && /noindex/i.test(String(value))) {
        findings.push(raise('IDX004', { where, detail: `X-Robots-Tag: ${value}` }));
      }
    }
  }

  // --- sitemap
  if (typeof input.sitemap === 'string') {
    const locs = Array.from(input.sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]);
    const redirected = new Set((input.map ?? []).map((r) => keyOf(r.from)));
    let reportedOld = false;
    for (const loc of locs) {
      const host = hostOf(loc);
      if (!reportedOld && host && oldDomain && (host === oldDomain || host === `www.${oldDomain}`)) {
        findings.push(raise('IDX007', { where: 'sitemap.xml', detail: `${loc} and possibly others` }));
        reportedOld = true;
      }
      if (redirected.has(keyOf(loc)) && host && isOwnHost(host)) {
        findings.push(raise('IDX008', { where: 'sitemap.xml', detail: `${loc} is a redirect source` }));
      }
    }
  }

  return findings;
}
