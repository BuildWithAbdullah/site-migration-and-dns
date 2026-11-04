// One fixture per reason in the catalogue.
//
// The example pairs are the readable evidence, but they only reach the findings
// that a plausible whole site reaches, which is a little over half of them. The
// rest used to be covered by a handful of scenarios that threw a great deal of
// broken input at one check and asserted only that the union of their output
// touched every id. That is a reachability proof, not a correctness proof: a
// scenario raising one finding too many looked exactly like a scenario raising
// the right ones, so a false positive could sit inside it indefinitely.
//
// Every fixture here instead declares the complete set of findings its input
// produces, as id to severity, and the suite compares that set with deepEqual
// in both directions. An extra finding fails. A missing one fails. The declared
// severity is also what the severity table is checked against, so a finding
// whose catalogued severity nothing has ever produced fails too.
//
// Each fixture starts from the clean baseline and makes the smallest change that
// produces its reason, so the fixture reads as the difference rather than as a
// wall of broken input. Where a reason genuinely cannot occur alone, the fixture
// says so and declares both findings.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

import { checkDns } from '../src/checks/dns.mjs';
import { checkTtl } from '../src/checks/ttl.mjs';
import { checkEmail } from '../src/checks/email.mjs';
import { checkSsl } from '../src/checks/ssl.mjs';
import { checkSerialized, serializePhp, naiveReplace } from '../src/checks/serialized.mjs';
import { checkRedirects } from '../src/checks/redirects.mjs';
import { scanText } from '../src/checks/mixed.mjs';
import { checkIndexing } from '../src/checks/indexing.mjs';

const BASELINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'baseline');
const read = (name) => JSON.parse(readFileSync(join(BASELINE, name), 'utf8'));

const PROFILE = read('profile.json');
const ZONE = read('zone.json');
const OBSERVED = read('observed.json');

const clone = (value) => JSON.parse(JSON.stringify(value));
export const NOW = '2026-10-01T00:00:00Z';

// A 512 bit modulus, generated rather than pasted, so the short key fixture
// cannot drift out of step with what rsaKeyBits actually measures.
const SHORT_KEY = generateKeyPairSync('rsa', {
  modulusLength: 512,
  publicKeyEncoding: { type: 'spki', format: 'der' }
}).publicKey.toString('base64');

const SPF_OK = 'v=spf1 include:_spf.mailprovider.example -all';
const DMARC_OK = 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.org';
const SER_PROFILE = { domain: 'example.org', oldDomain: 'old-site.example' };

const dns = (mutateZone, mutateProfile) => () => {
  const zone = clone(ZONE);
  const profile = clone(PROFILE);
  mutateZone?.(zone);
  mutateProfile?.(profile);
  return checkDns(zone, profile);
};

const ttl = (mutateZone, mutateProfile, now = NOW) => () => {
  const zone = clone(ZONE);
  const profile = clone(PROFILE);
  mutateZone?.(zone);
  mutateProfile?.(profile);
  return checkTtl(zone, profile, { now });
};

const email = (mutateZone, mutateProfile) => () => {
  const zone = clone(ZONE);
  const profile = clone(PROFILE);
  mutateZone?.(zone);
  mutateProfile?.(profile);
  return checkEmail(zone, profile);
};

const ssl = (mutateObserved, mutateProfile) => () => {
  const observed = clone(OBSERVED);
  const profile = clone(PROFILE);
  mutateObserved?.(observed);
  mutateProfile?.(profile);
  return checkSsl(observed, profile);
};

const serialized = (text) => () => checkSerialized([{ path: 'db/options.sql', text }], SER_PROFILE);
const redirects = (input) => () => checkRedirects(input, SER_PROFILE);
const mixed = (text, kind = 'html') => () =>
  scanText(text, { path: kind === 'css' ? 'assets/theme.css' : 'pages/home.html', oldDomain: 'old-site.example', kind });
const indexing = (input, mutateProfile) => () => {
  const profile = clone(PROFILE);
  mutateProfile?.(profile);
  return checkIndexing(input, profile);
};

// A nested serialized payload is only reported in a file that also still holds
// the old domain, because nesting on its own is ordinary WordPress data and
// only becomes a problem when a rewrite has to reach inside it. So this one
// input is the only shape that can produce SER004, and it produces SER003 with
// it by construction.
const NESTED_WITH_OLD_DOMAIN = (() => {
  const s = (v) => ({ t: 's', v });
  const inner = serializePhp({ t: 'a', entries: [[s('home'), s('https://old-site.example/')]] });
  return `('panel','${serializePhp({ t: 'a', entries: [[s('panel'), s(inner)]] })}')`;
})();

const NAIVELY_REPLACED = `('home','${naiveReplace(
  serializePhp({ t: 's', v: 'https://old-site.example/x' }),
  'old-site.example',
  'example.org'
)}')`;

export const FIXTURES = [
  // ------------------------------------------------------------------ dns
  {
    reason: 'DNS001',
    why: 'an apex CNAME, with the address record still present beside it',
    expect: { DNS001: 'blocker' },
    run: dns((z) => {
      z.apex.CNAME = [{ value: 'web.newhost.example', ttl: 300 }];
    })
  },
  {
    reason: 'DNS002',
    why: 'no address record of any type at the apex',
    expect: { DNS002: 'blocker' },
    run: dns((z) => {
      delete z.apex.A;
    })
  },
  {
    reason: 'DNS003',
    why: 'the www label has neither an address record nor a CNAME',
    expect: { DNS003: 'high' },
    run: dns((z) => {
      delete z.www;
    })
  },
  {
    reason: 'DNS004',
    why: 'after the cutover the apex still answers the old host address',
    expect: { DNS004: 'blocker' },
    run: dns(
      (z) => {
        z.apex.A = [{ value: '203.0.113.10', ttl: 300 }];
      },
      (p) => {
        p.phase = 'post';
      }
    )
  },
  {
    reason: 'DNS005',
    why: 'the delegation points at nameservers the profile does not expect',
    expect: { DNS005: 'blocker' },
    run: dns((z) => {
      z.apex.NS = [{ value: 'ns1.otherprovider.example', ttl: 86400 }];
    })
  },
  {
    reason: 'DNS006',
    why: 'the rebuilt zone has no MX record at all',
    expect: { DNS006: 'blocker' },
    run: dns((z) => {
      delete z.apex.MX;
    })
  },
  {
    reason: 'DNS007',
    why: 'the MX points at the web host, which is the default a control panel offers',
    expect: { DNS007: 'high' },
    run: dns((z) => {
      z.apex.MX = [{ value: 'web.newhost.example', priority: 10, ttl: 3600 }];
    })
  },
  {
    reason: 'DNS008',
    why: 'mail is supposed to move with the site and the MX still names the old mail host',
    expect: { DNS008: 'high' },
    run: dns(
      (z) => {
        z.apex.MX = [{ value: 'mail.oldhost.example', priority: 10, ttl: 3600 }];
      },
      (p) => {
        p.mail.movesWithSite = true;
      }
    )
  },
  {
    reason: 'DNS009',
    why: 'CAA authorises an issuer that is not the one the new certificate comes from',
    expect: { DNS009: 'high' },
    run: dns((z) => {
      z.apex.CAA = [{ flags: 0, tag: 'issue', value: 'otherca.example' }];
    })
  },
  {
    reason: 'DNS010',
    why: 'the apex answers one old address and one new one, so half the visitors reach each',
    expect: { DNS010: 'medium' },
    run: dns((z) => {
      z.apex.A = [
        { value: '198.51.100.20', ttl: 300 },
        { value: '203.0.113.10', ttl: 300 }
      ];
    })
  },

  // ------------------------------------------------------------------ ttl
  {
    reason: 'TTL001',
    why: 'a day long TTL with the cutover six hours away and no lowering recorded',
    expect: { TTL001: 'high' },
    run: ttl(
      (z) => {
        z.apex.A = [{ value: '198.51.100.20', ttl: 86400 }];
      },
      (p) => {
        p.cutoverAt = '2026-10-01T06:00:00Z';
        delete p.ttlLoweredAt;
      }
    )
  },
  {
    reason: 'TTL002',
    why: 'the TTL was lowered an hour before a cutover that the previous TTL of a day still covers',
    expect: { TTL002: 'high' },
    run: ttl(
      (z) => {
        z.apex.A = [{ value: '198.51.100.20', ttl: 300 }];
      },
      (p) => {
        p.cutoverAt = '2026-10-01T06:00:00Z';
        p.ttlLoweredAt = '2026-10-01T05:00:00Z';
        p.ttlBeforeLowering = 86400;
      }
    )
  },
  {
    reason: 'TTL003',
    why: 'the migration settled a month ago and the TTL is still at its cutover value',
    expect: { TTL003: 'low' },
    run: ttl(null, (p) => {
      p.phase = 'post';
      p.cutoverAt = '2026-09-01T00:00:00Z';
    })
  },
  {
    reason: 'TTL004',
    why: 'the SOA negative caching TTL is a day, so a name that does not exist yet stays absent for a day',
    expect: { TTL004: 'medium' },
    run: ttl((z) => {
      z.apex.SOA = { serial: 2026101301, minimum: 86400 };
    })
  },

  // ------------------------------------------------------------------ email, spf
  {
    reason: 'SPF001',
    why: 'the rebuilt zone has no TXT record starting v=spf1',
    expect: { SPF001: 'high' },
    run: email((z) => {
      z.apex.TXT = [];
    })
  },
  {
    reason: 'SPF002',
    why: 'two SPF records, which is a permanent error, so nothing is judged from either',
    expect: { SPF002: 'blocker' },
    run: email((z) => {
      z.apex.TXT = [SPF_OK, 'v=spf1 include:_spf.oldmail.example +all'];
    })
  },
  {
    reason: 'SPF003',
    why: 'three includes whose own lookups add up to fifteen, past the limit of ten',
    expect: { SPF003: 'high' },
    run: email(
      (z) => {
        z.apex.TXT = ['v=spf1 include:a.example include:b.example include:_spf.mailprovider.example -all'];
      },
      (p) => {
        p.mail.includeLookupCosts = { 'a.example': 6, 'b.example': 6, '_spf.mailprovider.example': 3 };
      }
    )
  },
  {
    reason: 'SPF004',
    why: 'a record with no all mechanism and no redirect, so it says nothing about unlisted senders',
    expect: { SPF004: 'medium' },
    run: email((z) => {
      z.apex.TXT = ['v=spf1 include:_spf.mailprovider.example'];
    })
  },
  {
    reason: 'SPF005',
    why: 'the record ends in +all, which authorises the whole internet',
    expect: { SPF005: 'blocker' },
    run: email((z) => {
      z.apex.TXT = ['v=spf1 include:_spf.mailprovider.example +all'];
    })
  },
  {
    reason: 'SPF006',
    why: 'the record uses ptr, which receivers are told to stop evaluating',
    expect: { SPF006: 'medium' },
    run: email((z) => {
      z.apex.TXT = ['v=spf1 ptr include:_spf.mailprovider.example -all'];
    })
  },
  {
    reason: 'SPF007',
    why: 'the old sending host is still authorised after the move',
    expect: { SPF007: 'low' },
    run: email(
      (z) => {
        z.apex.TXT = ['v=spf1 include:_spf.oldmail.example include:_spf.mailprovider.example -all'];
      },
      (p) => {
        p.mail.oldSendingHosts = ['_spf.oldmail.example'];
      }
    )
  },
  {
    reason: 'SPF008',
    why: 'the new sending host is not authorised, so its mail fails SPF from the first send',
    expect: { SPF008: 'high' },
    run: email((z) => {
      z.apex.TXT = ['v=spf1 -all'];
    })
  },
  {
    reason: 'SPF009',
    why: 'the policy is published under the withdrawn SPF record type as well as TXT',
    expect: { SPF009: 'low' },
    run: email((z) => {
      z.apex.SPF = [SPF_OK];
    })
  },

  // ------------------------------------------------------------------ email, dkim
  {
    reason: 'DKIM001',
    why: 'the selector the profile names has no record in the rebuilt zone',
    expect: { DKIM001: 'high' },
    run: email((z) => {
      delete z['sel1._domainkey'];
    })
  },
  {
    reason: 'DKIM002',
    why: 'a 512 bit RSA modulus, measured out of the DER rather than guessed from the base64 length',
    expect: { DKIM002: 'medium' },
    run: email((z) => {
      z['sel1._domainkey'].TXT = [`v=DKIM1; k=rsa; p=${SHORT_KEY}`];
    })
  },
  {
    reason: 'DKIM003',
    why: 'the record carries t=y, so receivers treat every signature as a test',
    expect: { DKIM003: 'medium' },
    run: email((z) => {
      z['sel1._domainkey'].TXT = [z['sel1._domainkey'].TXT[0].replace('k=rsa;', 'k=rsa; t=y;')];
    })
  },
  {
    reason: 'DKIM004',
    why: 'a record published with no p= tag at all, which signs exactly as much as a revoked key',
    expect: { DKIM004: 'high' },
    run: email((z) => {
      z['sel1._domainkey'].TXT = ['v=DKIM1; k=rsa'];
    })
  },

  // ------------------------------------------------------------------ email, dmarc
  {
    reason: 'DMARC001',
    why: 'no record at _dmarc, so nothing acts on a failed check',
    expect: { DMARC001: 'medium' },
    run: email((z) => {
      delete z._dmarc;
    })
  },
  {
    reason: 'DMARC002',
    why: 'p=none, which reports and enforces nothing',
    expect: { DMARC002: 'low' },
    run: email((z) => {
      z._dmarc.TXT = ['v=DMARC1; p=none; rua=mailto:dmarc@example.org'];
    })
  },
  {
    reason: 'DMARC003',
    why: 'a policy with no rua, so the reports that would show what it breaks go nowhere',
    expect: { DMARC003: 'medium' },
    run: email((z) => {
      z._dmarc.TXT = ['v=DMARC1; p=quarantine'];
    })
  },
  {
    reason: 'DMARC004',
    why: 'pct=50, so the policy is applied to half the mail and the other half looks fine',
    expect: { DMARC004: 'low' },
    run: email((z) => {
      z._dmarc.TXT = [`${DMARC_OK}; pct=50`];
    })
  },
  {
    reason: 'DMARC005',
    why: 'strict alignment with an enforcing policy and no aligned sender declared',
    expect: { DMARC005: 'high' },
    run: email(
      (z) => {
        z._dmarc.TXT = ['v=DMARC1; p=reject; rua=mailto:dmarc@example.org; adkim=s'];
      },
      (p) => {
        p.mail.alignedAuthentication = false;
      }
    )
  },
  {
    reason: 'DMARC006',
    why: 'two DMARC records, so the domain has no applicable policy and neither is judged',
    expect: { DMARC006: 'high' },
    run: email((z) => {
      z._dmarc.TXT = [DMARC_OK, 'v=DMARC1; p=none'];
    })
  },
  {
    reason: 'DMARC007',
    why: 'an enforcing policy at the domain with sp=none under it',
    expect: { DMARC007: 'medium' },
    run: email((z) => {
      z._dmarc.TXT = [`${DMARC_OK.replace('quarantine', 'reject')}; sp=none`];
    })
  },
  {
    reason: 'DMARC008',
    why: 'p=reject with pct=0, which enforces as much as p=none while printing as strict',
    expect: { DMARC008: 'high' },
    run: email((z) => {
      z._dmarc.TXT = [`${DMARC_OK.replace('quarantine', 'reject')}; pct=0`];
    })
  },

  // ------------------------------------------------------------------ ssl
  {
    reason: 'SSL001',
    why: 'the certificate covers the apex and not www',
    expect: { SSL001: 'blocker' },
    run: ssl((o) => {
      o.certificate.subjectAltNames = ['example.org'];
    })
  },
  {
    reason: 'SSL002',
    why: 'the certificate covers www and not the apex, which a www only issuance does',
    expect: { SSL002: 'blocker' },
    run: ssl((o) => {
      o.certificate.subjectAltNames = ['www.example.org'];
    })
  },
  {
    reason: 'SSL003',
    why: 'the certificate expires five days after the cutover',
    expect: { SSL003: 'high' },
    run: ssl((o) => {
      o.certificate.notAfter = '2026-10-20T00:00:00Z';
    })
  },
  {
    reason: 'SSL004',
    why: 'the certificate expired a fortnight before the moment being evaluated',
    expect: { SSL004: 'blocker' },
    run: ssl((o) => {
      o.certificate.notAfter = '2026-09-15T00:00:00Z';
    })
  },
  {
    reason: 'SSL005',
    why: 'the certificate is not valid until after the moment being evaluated',
    expect: { SSL005: 'blocker' },
    run: ssl((o) => {
      o.certificate.notBefore = '2026-10-20T00:00:00Z';
    })
  },
  {
    reason: 'SSL006',
    why: 'http answers and sends nobody to https',
    expect: { SSL006: 'high' },
    run: ssl((o) => {
      o.redirectChain = [];
    })
  },
  {
    reason: 'SSL007',
    why: 'the chain to the canonical host takes a plain http hop on the way',
    expect: { SSL007: 'medium' },
    run: ssl((o) => {
      o.redirectChain = [
        { from: 'http://example.org/', to: 'http://www.example.org/', status: 301 },
        { from: 'http://www.example.org/', to: 'https://www.example.org/', status: 301 }
      ];
    })
  },
  {
    reason: 'SSL008',
    why: 'https works and no Strict-Transport-Security header is sent at all',
    expect: { SSL008: 'low' },
    run: ssl((o) => {
      o.headers = {};
    })
  },
  {
    reason: 'SSL009',
    why: 'preload is requested with a max-age far below the year the preload list requires',
    expect: { SSL009: 'high' },
    run: ssl((o) => {
      o.headers['strict-transport-security'] = 'max-age=600; preload';
    })
  },
  {
    reason: 'SSL010',
    why: 'includeSubDomains is set while a declared subdomain is not on https',
    expect: { SSL010: 'high' },
    run: ssl(
      (o) => {
        o.headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
      },
      (p) => {
        p.subdomains = ['www', 'shop'];
        p.httpsSubdomains = ['www'];
      }
    )
  },
  {
    reason: 'SSL011',
    why: 'a header with directives but no max-age, which browsers discard whole',
    expect: { SSL011: 'high' },
    run: ssl((o) => {
      o.headers['strict-transport-security'] = 'includeSubDomains; preload';
    })
  },
  {
    reason: 'SSL012',
    why: 'max-age=0, the documented instruction to forget the policy',
    expect: { SSL012: 'high' },
    run: ssl((o) => {
      o.headers['strict-transport-security'] = 'max-age=0; includeSubDomains';
    })
  },

  // ------------------------------------------------------------------ serialized
  {
    reason: 'SER001',
    why: 'a string whose declared length is not the length of the string',
    expect: { SER001: 'blocker' },
    run: serialized(`('a','s:99:"short";')`)
  },
  {
    reason: 'SER002',
    why: 'a payload whose lengths are exactly wrong by the difference between the two domain names',
    expect: { SER002: 'blocker' },
    run: serialized(NAIVELY_REPLACED)
  },
  {
    reason: 'SER003',
    why: 'the old domain still inside serialized data after the rewrite',
    expect: { SER003: 'high' },
    run: serialized(`('home','https://old-site.example/x')`)
  },
  {
    reason: 'SER004',
    why: 'a serialized array stored inside a serialized string, in a file that still holds the old domain, so SER003 comes with it by construction',
    expect: { SER003: 'high', SER004: 'high' },
    run: serialized(NESTED_WITH_OLD_DOMAIN)
  },
  {
    reason: 'SER005',
    why: 'the old domain inside a base64 value, where a search and replace cannot reach it',
    expect: { SER005: 'medium' },
    run: serialized(`('a','${Buffer.from('https://old-site.example/asset', 'utf8').toString('base64')}')`)
  },

  // ------------------------------------------------------------------ redirects
  {
    reason: 'RED001',
    why: 'an old URL with no rule and nothing equivalent on the new site',
    expect: { RED001: 'high' },
    run: redirects({ oldInventory: ['/gone'], newInventory: ['/b'], map: [] })
  },
  {
    reason: 'RED002',
    why: 'a rule that reaches its destination through a second rule',
    expect: { RED002: 'medium' },
    run: redirects({ oldInventory: [], newInventory: ['/c'], map: [{ from: '/a', to: '/b' }, { from: '/b', to: '/c' }] })
  },
  {
    reason: 'RED003',
    why: 'two rules pointing at each other, reported once for the cycle rather than once per member',
    expect: { RED003: 'blocker' },
    run: redirects({ oldInventory: [], newInventory: [], map: [{ from: '/l1', to: '/l2' }, { from: '/l2', to: '/l1' }] })
  },
  {
    reason: 'RED004',
    why: 'a rule whose target is not in the new inventory',
    expect: { RED004: 'high' },
    run: redirects({ oldInventory: [], newInventory: ['/b'], map: [{ from: '/a', to: '/nowhere' }] })
  },
  {
    reason: 'RED005',
    why: 'a rule matching a URL with a query string and dropping it',
    expect: { RED005: 'medium' },
    run: redirects({ oldInventory: [], newInventory: ['/b'], map: [{ from: '/a?utm_source=x', to: '/b' }] })
  },
  {
    reason: 'RED006',
    why: 'the map uses both trailing slash conventions, so one of them collects an extra hop',
    expect: { RED006: 'medium' },
    run: redirects({
      oldInventory: [],
      newInventory: ['/b/', '/c'],
      map: [{ from: '/a', to: '/b/' }, { from: '/d', to: '/c' }]
    })
  },
  {
    reason: 'RED007',
    why: 'a rule whose target is an http URL, so the redirect undoes https for that request',
    expect: { RED007: 'medium' },
    run: redirects({ oldInventory: [], newInventory: [], map: [{ from: '/a', to: 'http://example.org/b' }] })
  },
  {
    reason: 'RED008',
    why: 'a wildcard rule above a specific rule it already matches, so the specific one never runs',
    expect: { RED008: 'high' },
    run: redirects({
      oldInventory: [],
      newInventory: ['/b'],
      map: [{ from: '/x/*', to: '/b' }, { from: '/x/one', to: '/b' }]
    })
  },

  // ------------------------------------------------------------------ mixed
  {
    reason: 'MIX001',
    why: 'a script element loaded over http',
    expect: { MIX001: 'high' },
    run: mixed('<script src="http://cdn.example/a.js"></script>')
  },
  {
    reason: 'MIX002',
    why: 'a protocol relative subresource, which follows whichever scheme the page was served over',
    expect: { MIX002: 'low' },
    run: mixed('<script src="//cdn.example/b.js"></script>')
  },
  {
    reason: 'MIX003',
    why: 'an anchor to the old domain, which is a link rather than a blocked subresource',
    expect: { MIX003: 'high' },
    run: mixed('<a href="https://old-site.example/page">the old page</a>')
  },
  {
    reason: 'MIX004',
    why: 'a stylesheet url() over http',
    expect: { MIX004: 'high' },
    run: mixed('.hero { background: url(http://cdn.example/c.png); }', 'css')
  },
  {
    reason: 'MIX005',
    why: 'a srcset candidate over http, which no mixed content scan of the rendered page reports unless that candidate was chosen',
    expect: { MIX005: 'high' },
    run: mixed('<img src="https://example.org/d.jpg" srcset="http://cdn.example/d.jpg 2x" alt="d">')
  },
  {
    reason: 'MIX006',
    why: 'an inline style attribute referencing http',
    expect: { MIX006: 'medium' },
    run: mixed(`<div style="background-image:url('http://cdn.example/e.png')"></div>`)
  },
  {
    reason: 'MIX007',
    why: 'a form posting over http, which sends whatever was typed in clear',
    expect: { MIX007: 'blocker' },
    run: mixed('<form action="http://example.org/subscribe"></form>')
  },
  {
    reason: 'MIX008',
    why: 'a loopback URL, which browsers treat as trustworthy so no mixed content audit reports it',
    expect: { MIX008: 'high' },
    run: mixed('<script src="http://localhost:3000/bundle.js"></script>')
  },

  // ------------------------------------------------------------------ indexing
  {
    reason: 'IDX001',
    why: 'robots.txt disallowing everything, which is what a staging build ships with',
    expect: { IDX001: 'blocker' },
    run: indexing({ robots: 'User-agent: *\nDisallow: /\nSitemap: https://example.org/sitemap.xml\n' })
  },
  {
    reason: 'IDX002',
    why: 'robots.txt pointing its Sitemap line at the old domain',
    expect: { IDX002: 'medium' },
    run: indexing({ robots: 'User-agent: *\nSitemap: https://old-site.example/sitemap.xml\n' })
  },
  {
    reason: 'IDX003',
    why: 'a noindex meta tag left on a page',
    expect: { IDX003: 'blocker' },
    run: indexing({
      pages: [{ url: '/', html: '<html><head><meta name="robots" content="noindex"></head></html>', headers: {} }]
    })
  },
  {
    reason: 'IDX004',
    why: 'an X-Robots-Tag header saying noindex, which is invisible in the page source',
    expect: { IDX004: 'blocker' },
    run: indexing({
      pages: [{ url: '/', html: '<html><head></head></html>', headers: { 'X-Robots-Tag': 'noindex' } }]
    })
  },
  {
    reason: 'IDX005',
    why: 'a canonical pointing at the old domain, so every page names the retired site as the real one',
    expect: { IDX005: 'blocker' },
    run: indexing({
      pages: [
        {
          url: '/',
          html: '<html><head><link rel="canonical" href="https://old-site.example/"></head></html>',
          headers: {}
        }
      ]
    })
  },
  {
    reason: 'IDX006',
    why: 'a canonical pointing at a staging host, which usually means the site URL setting was never changed',
    expect: { IDX006: 'blocker' },
    run: indexing({
      pages: [
        {
          url: '/',
          html: '<html><head><link rel="canonical" href="https://staging.example.org/"></head></html>',
          headers: {}
        }
      ]
    })
  },
  {
    reason: 'IDX007',
    why: 'a sitemap listing URLs on the old domain',
    expect: { IDX007: 'high' },
    run: indexing({ sitemap: '<urlset><url><loc>https://old-site.example/a</loc></url></urlset>' })
  },
  {
    reason: 'IDX008',
    why: 'a sitemap entry that redirects, so the file contradicts itself about which URL is canonical',
    expect: { IDX008: 'medium' },
    run: indexing({
      sitemap: '<urlset><url><loc>https://example.org/old</loc></url></urlset>',
      map: [{ from: '/old', to: '/new' }]
    })
  },
  {
    reason: 'IDX009',
    why: 'robots.txt with no Sitemap line',
    expect: { IDX009: 'low' },
    run: indexing({ robots: 'User-agent: *\nDisallow: /wp-admin/\n' })
  },
  {
    reason: 'IDX010',
    why: 'an hreflang alternate pointing at the old domain, which invalidates the cluster it belongs to',
    expect: { IDX010: 'high' },
    run: indexing({
      pages: [
        {
          url: '/',
          html: '<html><head><link rel="alternate" hreflang="fr" href="https://old-site.example/fr/"></head></html>',
          headers: {}
        }
      ]
    })
  }
];

/** The id to severity map a fixture actually produced. */
export function observedOf(fixture) {
  const out = {};
  for (const finding of fixture.run()) out[finding.id] = finding.severity;
  return out;
}
