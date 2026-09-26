// The runner. It reads a migration directory, calls the checks that have data
// to work with, and returns findings. A check with no input is skipped and said
// to be skipped, rather than passing quietly, because a check that silently did
// not run is the worst possible outcome for a tool like this.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

import { SEVERITIES, AREAS } from './catalog.mjs';
import { checkDns } from './checks/dns.mjs';
import { checkTtl } from './checks/ttl.mjs';
import { checkEmail } from './checks/email.mjs';
import { checkSsl } from './checks/ssl.mjs';
import { checkSerialized } from './checks/serialized.mjs';
import { checkRedirects } from './checks/redirects.mjs';
import { checkMixed } from './checks/mixed.mjs';
import { checkIndexing } from './checks/indexing.mjs';

// Written by hand rather than with readdirSync recursive, which arrived in
// Node 18.17 and would make the tool fail on an older runtime for no reason.
export function walk(dir, depth = 6) {
  if (depth < 0 || !existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, depth - 1));
    else if (stat.isFile()) out.push(full);
  }
  return out.sort();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function readTextFiles(dir, root, extensions) {
  if (!existsSync(dir)) return [];
  return walk(dir)
    .filter((f) => extensions.includes(extname(f).toLowerCase()))
    .map((f) => ({ path: relative(root, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));
}

export const CHECKS = [
  { area: 'dns', needs: 'zone.json' },
  { area: 'ttl', needs: 'zone.json' },
  { area: 'email', needs: 'zone.json' },
  { area: 'ssl', needs: 'observed.json' },
  { area: 'serialized', needs: 'db/' },
  { area: 'redirects', needs: 'redirects.json' },
  { area: 'mixed', needs: 'pages/ or assets/' },
  { area: 'indexing', needs: 'robots.txt, sitemap.xml or pages/' }
];

export function loadMigration(dir) {
  const profilePath = join(dir, 'profile.json');
  if (!existsSync(profilePath)) {
    throw new Error(`no profile.json in ${dir}. See docs/profile.md for the fields it needs.`);
  }
  const profile = readJson(profilePath);
  if (!profile.domain) throw new Error('profile.json needs a domain');

  const zonePath = join(dir, 'zone.json');
  const observedPath = join(dir, 'observed.json');
  const redirectsPath = join(dir, 'redirects.json');
  const robotsPath = join(dir, 'robots.txt');
  const sitemapPath = join(dir, 'sitemap.xml');

  const pages = readTextFiles(join(dir, 'pages'), dir, ['.html', '.htm']);
  const assets = readTextFiles(join(dir, 'assets'), dir, ['.css', '.html', '.htm']);
  const dbFiles = readTextFiles(join(dir, 'db'), dir, ['.sql', '.txt']);

  return {
    profile,
    zone: existsSync(zonePath) ? readJson(zonePath) : null,
    observed: existsSync(observedPath) ? readJson(observedPath) : null,
    redirects: existsSync(redirectsPath) ? readJson(redirectsPath) : null,
    robots: existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : null,
    sitemap: existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : null,
    pages,
    assets,
    dbFiles
  };
}

export function runChecks(input, options = {}) {
  const { profile } = input;
  const findings = [];
  const ran = [];
  const skipped = [];

  const attempt = (area, hasInput, fn) => {
    if (!hasInput) {
      skipped.push({ area, reason: `no input (${CHECKS.find((c) => c.area === area).needs})` });
      return;
    }
    findings.push(...fn());
    ran.push(area);
  };

  attempt('dns', Boolean(input.zone), () => checkDns(input.zone, profile));
  attempt('ttl', Boolean(input.zone), () => checkTtl(input.zone, profile, { now: options.now }));
  attempt('email', Boolean(input.zone), () => checkEmail(input.zone, profile));
  attempt('ssl', Boolean(input.observed), () =>
    checkSsl({ ...input.observed, now: options.now ?? input.observed.now }, profile)
  );
  attempt('serialized', input.dbFiles.length > 0, () => checkSerialized(input.dbFiles, profile));
  attempt('redirects', Boolean(input.redirects), () => checkRedirects(input.redirects, profile));
  attempt('mixed', input.pages.length + input.assets.length > 0, () =>
    checkMixed(
      [
        ...input.pages.map((p) => ({ ...p, kind: 'html' })),
        ...input.assets.map((a) => ({ ...a, kind: extname(a.path).toLowerCase() === '.css' ? 'css' : 'html' }))
      ],
      profile
    )
  );
  attempt(
    'indexing',
    input.robots !== null || input.sitemap !== null || input.pages.length > 0,
    () =>
      checkIndexing(
        {
          robots: input.robots ?? undefined,
          sitemap: input.sitemap ?? undefined,
          map: input.redirects?.map ?? [],
          pages: input.pages.map((p) => ({ url: p.path, html: p.text, headers: {} }))
        },
        profile
      )
  );

  findings.sort((a, b) => {
    const bySeverity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return a.id.localeCompare(b.id);
  });

  return { profile, findings, ran, skipped, summary: summarise(findings) };
}

export function summarise(findings) {
  const bySeverity = {};
  for (const s of SEVERITIES) bySeverity[s] = 0;
  const byArea = {};
  for (const a of AREAS) byArea[a] = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    byArea[f.area] += 1;
  }
  return { total: findings.length, bySeverity, byArea };
}

/**
 * Exit code, derived from the worst severity seen. 0 means the checks that ran
 * found nothing at or above the threshold, which is not the same as the
 * migration being safe. The skipped list is part of the answer.
 */
export function exitCodeFor(result, threshold = 'high') {
  const limit = SEVERITIES.indexOf(threshold);
  const worst = result.findings.reduce((acc, f) => Math.min(acc, SEVERITIES.indexOf(f.severity)), SEVERITIES.length);
  return worst <= limit ? 1 : 0;
}
