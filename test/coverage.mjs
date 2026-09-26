import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { findingIds } from '../src/catalog.mjs';
import { checkDns } from '../src/checks/dns.mjs';
import { checkTtl } from '../src/checks/ttl.mjs';
import { checkEmail } from '../src/checks/email.mjs';
import { checkSsl } from '../src/checks/ssl.mjs';
import { checkSerialized, serializePhp, naiveReplace } from '../src/checks/serialized.mjs';
import { checkRedirects } from '../src/checks/redirects.mjs';
import { scanText } from '../src/checks/mixed.mjs';
import { checkIndexing } from '../src/checks/indexing.mjs';

// A catalogued finding that no input can produce is documentation pretending to
// be a check. This walks a set of deliberately broken inputs and asserts that
// between them they reach every id in the catalogue.

const shortKey = generateKeyPairSync('rsa', {
  modulusLength: 512,
  publicKeyEncoding: { type: 'spki', format: 'der' }
}).publicKey.toString('base64');

const scenarios = [];
const add = (label, findings) => scenarios.push({ label, ids: findings.map((f) => f.id) });

// --- dns
add(
  'apex CNAME, no www, old address after cutover, wrong delegation',
  checkDns(
    {
      apex: {
        CNAME: [{ value: 'web.newhost.example' }],
        A: [{ value: '203.0.113.10' }, { value: '198.51.100.20' }],
        NS: [{ value: 'ns1.wrong.example' }],
        MX: [{ value: 'web.newhost.example', priority: 10 }, { value: 'mail.oldhost.example', priority: 20 }],
        CAA: [{ tag: 'issue', value: 'otherca.example' }]
      }
    },
    {
      domain: 'example.org',
      phase: 'post',
      oldHost: { addresses: ['203.0.113.10'] },
      newHost: { addresses: ['198.51.100.20'], name: 'web.newhost.example' },
      intendedNameservers: ['ns1.right.example'],
      certificateIssuer: 'letsencrypt.org',
      mail: { movesWithSite: true, oldMailHosts: ['mail.oldhost.example'] }
    }
  )
);
add(
  'apex with no address record and a zone with no mail records',
  checkDns({ apex: {}, www: { CNAME: [{ value: 'example.org' }] } }, { domain: 'example.org', phase: 'pre' })
);

// --- ttl
add(
  'long TTL, lowered too late, long negative cache',
  checkTtl(
    { apex: { A: [{ value: '198.51.100.20', ttl: 86400 }], SOA: { minimum: 86400 } } },
    {
      domain: 'example.org',
      phase: 'pre',
      cutoverAt: '2026-10-01T06:00:00Z',
      ttlBeforeLowering: 86400,
      ttlLoweredAt: '2026-09-30T23:00:00Z'
    },
    { now: '2026-10-01T00:00:00Z' }
  )
);
add(
  'TTL still low long after the migration settled',
  checkTtl(
    { apex: { A: [{ value: '198.51.100.20', ttl: 300 }], SOA: { minimum: 300 } } },
    { domain: 'example.org', phase: 'post', cutoverAt: '2026-10-01T00:00:00Z' },
    { now: '2026-10-10T00:00:00Z' }
  )
);

// --- email
add(
  'two SPF records, +all, ptr, old host listed, new host missing, obsolete type',
  checkEmail(
    {
      apex: {
        TXT: [
          'v=spf1 include:_spf.oldhost.example ptr +all',
          'v=spf1 include:_spf.oldhost.example -all'
        ],
        SPF: ['v=spf1 -all']
      },
      'sel1._domainkey': { TXT: ['v=DKIM1; k=rsa; p='] },
      _dmarc: { TXT: ['v=DMARC1; p=reject; sp=none; pct=40; adkim=s; aspf=s'] }
    },
    {
      domain: 'example.org',
      mail: {
        dkimSelectors: ['sel1'],
        oldSendingHosts: ['_spf.oldhost.example'],
        newSendingHosts: ['_spf.newhost.example']
      }
    }
  )
);
add(
  'no SPF, no DMARC, missing selector',
  checkEmail({ apex: { TXT: [] } }, { domain: 'example.org', mail: { dkimSelectors: ['sel1'] } })
);
add(
  'SPF with no all and too many lookups, short DKIM key in testing mode, p=none with no rua, two DMARC records',
  checkEmail(
    {
      apex: { TXT: ['v=spf1 include:a.example include:b.example a mx'] },
      'sel1._domainkey': { TXT: [`v=DKIM1; k=rsa; t=y; p=${shortKey}`] },
      _dmarc: { TXT: ['v=DMARC1; p=none', 'v=DMARC1; p=none'] }
    },
    {
      domain: 'example.org',
      mail: { dkimSelectors: ['sel1'], includeLookupCosts: { 'a.example': 6, 'b.example': 6 } }
    }
  )
);

// --- ssl
add(
  'certificate covers neither name, expired, http open, preload and subdomains overreaching',
  checkSsl(
    {
      now: '2026-10-01T00:00:00Z',
      httpReachable: true,
      httpsReachable: true,
      certificate: {
        subjectAltNames: ['other.example'],
        notBefore: '2026-01-01T00:00:00Z',
        notAfter: '2026-09-01T00:00:00Z'
      },
      redirectChain: [],
      headers: { 'strict-transport-security': 'max-age=600; includeSubDomains; preload' }
    },
    { domain: 'example.org', cutoverAt: '2026-10-15T00:00:00Z', subdomains: ['www', 'staging'], httpsSubdomains: [] }
  )
);
add(
  'certificate not yet valid, expiring inside the window, chain through http, no header',
  checkSsl(
    {
      now: '2026-10-01T00:00:00Z',
      httpReachable: true,
      httpsReachable: true,
      certificate: {
        subjectAltNames: ['example.org', 'www.example.org'],
        notBefore: '2026-10-05T00:00:00Z',
        notAfter: '2026-10-20T00:00:00Z'
      },
      redirectChain: [
        { from: 'http://example.org/', to: 'http://www.example.org/', status: 301 },
        { from: 'http://www.example.org/', to: 'https://www.example.org/', status: 301 }
      ],
      headers: {}
    },
    { domain: 'example.org', cutoverAt: '2026-10-15T00:00:00Z' }
  )
);

// --- serialized
{
  const s = (v) => ({ t: 's', v });
  const inner = serializePhp({ t: 'a', entries: [[s('home'), s('https://old-site.example/')]] });
  const outer = serializePhp({ t: 'a', entries: [[s('panel'), s(inner)]] });
  const naive = naiveReplace(serializePhp(s('https://old-site.example/x')), 'old-site.example', 'example.org');
  const encoded = Buffer.from('https://old-site.example/asset', 'utf8').toString('base64');
  add(
    'a dump with every kind of serialization damage in it',
    checkSerialized(
      [{ path: 'db/all.sql', text: `('a','${naive}'),('b','s:99:"short";'),('c','${outer}'),('d','${encoded}')` }],
      { domain: 'example.org', oldDomain: 'old-site.example' }
    )
  );
}

// --- redirects
add(
  'a map with every redirect defect',
  checkRedirects(
    {
      oldInventory: ['/unmapped'],
      newInventory: ['/b', '/exists'],
      map: [
        { from: '/wild/*', to: '/b/' },
        { from: '/wild/specific', to: '/b/' },
        { from: '/a', to: '/hop' },
        { from: '/hop', to: '/b' },
        { from: '/loop1', to: '/loop2' },
        { from: '/loop2', to: '/loop1' },
        { from: '/missing', to: '/nowhere' },
        { from: '/q?utm_source=x', to: '/exists' },
        { from: '/insecure', to: 'http://example.org/exists' }
      ]
    },
    { domain: 'example.org' }
  )
);

// --- mixed
add(
  'markup with every mixed content defect',
  scanText(
    [
      '<script src="http://cdn.example/a.js"></script>',
      '<script src="//cdn.example/b.js"></script>',
      '<a href="https://old-site.example/page">old</a>',
      '<style>.a{background:url(http://cdn.example/c.png)}</style>',
      '<img srcset="http://cdn.example/d.jpg 2x" alt="d">',
      '<div style="background-image:url(\'http://cdn.example/e.png\')"></div>',
      '<form action="http://example.org/f"></form>'
    ].join('\n'),
    { path: 'pages/all.html', oldDomain: 'old-site.example', kind: 'html' }
  )
);

// --- indexing
add(
  'every indexing defect at once',
  checkIndexing(
    {
      robots: 'User-agent: *\nDisallow: /\nSitemap: https://old-site.example/sitemap.xml\n',
      sitemap:
        '<urlset><url><loc>https://old-site.example/a</loc></url><url><loc>https://example.org/old-about</loc></url></urlset>',
      map: [{ from: '/old-about', to: '/about' }],
      pages: [
        {
          url: '/',
          html:
            '<html><head><meta name="robots" content="noindex">' +
            '<link rel="canonical" href="https://staging.example.org/">' +
            '<link rel="alternate" hreflang="fr" href="https://old-site.example/fr/">' +
            '</head></html>',
          headers: { 'X-Robots-Tag': 'noindex' }
        },
        {
          url: '/about',
          html: '<html><head><link rel="canonical" href="https://old-site.example/about"></head></html>',
          headers: {}
        }
      ]
    },
    { domain: 'example.org', oldDomain: 'old-site.example', stagingHosts: ['staging.example.org'] }
  )
);
add(
  'robots.txt with no sitemap line',
  checkIndexing({ robots: 'User-agent: *\nDisallow: /wp-admin/\n' }, { domain: 'example.org' })
);

test('every catalogued finding can actually be raised', () => {
  const reached = new Set();
  for (const scenario of scenarios) for (const id of scenario.ids) reached.add(id);
  const unreachable = findingIds().filter((id) => !reached.has(id));
  assert.deepEqual(unreachable, [], `these findings are catalogued but nothing can raise them: ${unreachable.join(', ')}`);
});

test('every scenario raises something, so none of them is dead weight', () => {
  for (const scenario of scenarios) {
    assert.ok(scenario.ids.length > 0, `scenario "${scenario.label}" raised nothing`);
  }
});
