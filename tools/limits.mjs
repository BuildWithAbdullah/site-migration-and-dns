// The declared limits, as assertions rather than as prose.
//
// docs/limits.md is the part of this repository most likely to be believed and
// least likely to be true, because nothing used to hold it to anything: the
// verifier checked that the file was longer than two thousand characters. A
// limit stated in a document and nowhere else drifts the first time a check
// gets better, and then the repository is understating itself, which is the
// same kind of wrong as overstating itself.
//
// So every heading in that document appears here with two inputs behind it. The
// blind side is an input the limit says this tool cannot judge, and the finding
// it would need to raise must be absent. The covered side is the nearest input
// the tool does judge, and the finding must be present. Both directions are
// required: without the covered side a limit could be satisfied by a check that
// does nothing at all.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDns } from '../src/checks/dns.mjs';
import { checkTtl } from '../src/checks/ttl.mjs';
import { checkEmail } from '../src/checks/email.mjs';
import { checkSerialized } from '../src/checks/serialized.mjs';
import { checkRedirects } from '../src/checks/redirects.mjs';
import { scanText } from '../src/checks/mixed.mjs';
import { loadMigration, runChecks, CHECKS } from '../src/run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'examples', 'baseline');
const read = (name) => JSON.parse(readFileSync(join(BASELINE, name), 'utf8'));

const PROFILE = read('profile.json');
const ZONE = read('zone.json');
const clone = (value) => JSON.parse(JSON.stringify(value));
const NOW = '2026-10-01T00:00:00Z';

const zoneWith = (mutateZone, mutateProfile) => {
  const zone = clone(ZONE);
  const profile = clone(PROFILE);
  mutateZone?.(zone);
  mutateProfile?.(profile);
  return { zone, profile };
};

const markup = (text) => scanText(text, { path: 'pages/home.html', oldDomain: 'old-site.example', kind: 'html' });
const SER_PROFILE = { domain: 'example.org', oldDomain: 'old-site.example' };

export const LIMITS = [
  {
    heading: 'It checks what was collected, not what exists',
    absent: 'any finding at all',
    blind: () => {
      // A directory holding only a profile. Every check is skipped, nothing is
      // found, and the exit code is zero, which is indistinguishable from a
      // migration with nothing wrong with it unless the skipped list is read.
      const result = runChecks({ profile: clone(PROFILE), zone: null, observed: null, redirects: null, robots: null, sitemap: null, pages: [], assets: [], dbFiles: [] }, { now: NOW });
      return { findings: result.findings, note: result.skipped };
    },
    expectAbsent: () => [],
    covered: () => runChecks(loadMigration(BASELINE), { now: NOW }).skipped,
    expectCovered: 'the baseline supplies every input, so nothing is skipped'
  },
  {
    heading: 'It cannot see resolver caches',
    absent: 'DNS004',
    blind: () => {
      // A zone that was updated correctly, after the cutover. Resolvers holding
      // the previous answer are still sending visitors to the old host, and
      // there is nothing in a zone snapshot that could say so.
      const { zone, profile } = zoneWith(null, (p) => {
        p.phase = 'post';
      });
      return { findings: checkDns(zone, profile) };
    },
    covered: () => {
      // What is offered instead is a judgement about the TTL, before the fact.
      const { zone, profile } = zoneWith(
        (z) => {
          z.apex.A = [{ value: '198.51.100.20', ttl: 86400 }];
        },
        (p) => {
          p.cutoverAt = '2026-10-01T06:00:00Z';
          delete p.ttlLoweredAt;
        }
      );
      return checkTtl(zone, profile, { now: NOW });
    },
    present: 'TTL001'
  },
  {
    heading: 'It reads the source, not the rendered page',
    absent: 'MIX001',
    blind: () => ({
      // A URL the page assembles at run time is not an attribute, so the
      // scanner cannot see it. The same bluntness cuts the other way: a
      // reference inside an HTML comment is reported even though the browser
      // never fetches it, which is asserted below rather than apologised for.
      findings: markup('<script>var s = "http:" + "//cdn.example/x.js"; load(s);</script>')
    }),
    covered: () => markup('<script src="http://cdn.example/a.js"></script>'),
    present: 'MIX001',
    alsoAssert: () => ({
      what: 'a reference inside a comment is reported, because the scan is textual',
      findings: markup('<!-- <script src="http://cdn.example/a.js"></script> -->'),
      present: 'MIX001'
    })
  },
  {
    heading: 'It does not prove the serialized data is fine',
    absent: 'SER001',
    blind: () => ({
      // Correct length prefixes and no trace of the old domain. The payload
      // could still be semantically wrong in a way no parser can see.
      findings: checkSerialized(
        [{ path: 'db/options.sql', text: `('a','a:1:{s:4:"home";s:21:"https://example.org/x";}')` }],
        SER_PROFILE
      )
    }),
    covered: () =>
      checkSerialized([{ path: 'db/options.sql', text: `('a','s:99:"short";')` }], SER_PROFILE),
    present: 'SER001'
  },
  {
    heading: 'Redirect coverage is only as good as the inventories',
    absent: 'RED001',
    blind: () => ({
      // With no inventory of the old URLs there is nothing to compare the map
      // against, so an empty map looks complete.
      findings: checkRedirects({ oldInventory: [], newInventory: ['/b'], map: [] }, SER_PROFILE)
    }),
    covered: () => checkRedirects({ oldInventory: ['/gone'], newInventory: ['/b'], map: [] }, SER_PROFILE),
    present: 'RED001'
  },
  {
    heading: 'Email authentication is checked as published, not as delivered',
    absent: 'SPF003',
    blind: () => {
      // Three includes, each of which really costs five lookups. The record is
      // over the limit and nothing in it says so, because what an include costs
      // is a fact about somebody else's zone.
      const { zone, profile } = zoneWith(
        (z) => {
          z.apex.TXT = ['v=spf1 include:a.example include:b.example include:_spf.mailprovider.example -all'];
        },
        (p) => {
          p.mail.includeLookupCosts = {};
        }
      );
      return { findings: checkEmail(zone, profile) };
    },
    covered: () => {
      const { zone, profile } = zoneWith(
        (z) => {
          z.apex.TXT = ['v=spf1 include:a.example include:b.example include:_spf.mailprovider.example -all'];
        },
        (p) => {
          p.mail.includeLookupCosts = { 'a.example': 6, 'b.example': 6, '_spf.mailprovider.example': 3 };
        }
      );
      return checkEmail(zone, profile);
    },
    present: 'SPF003'
  },
  {
    heading: 'The checks that can only be done after the switch',
    absent: 'DNS004',
    blind: () => {
      // The old address is in the zone, and before the cutover that is correct
      // rather than a defect, so it is not reported.
      const { zone, profile } = zoneWith((z) => {
        z.apex.A = [{ value: '203.0.113.10', ttl: 300 }];
      });
      return { findings: checkDns(zone, profile) };
    },
    covered: () => {
      const { zone, profile } = zoneWith(
        (z) => {
          z.apex.A = [{ value: '203.0.113.10', ttl: 300 }];
        },
        (p) => {
          p.phase = 'post';
        }
      );
      return checkDns(zone, profile);
    },
    present: 'DNS004'
  },
  {
    heading: 'The window where both hosts are live',
    absent: 'DNS010',
    blind: () => {
      // An address the profile does not name is not treated as a second host,
      // because a zone whose profile lists only the v4 address of a dual stack
      // host would otherwise be reported as split. The finding is scoped to the
      // two hosts the profile knows about, and its title says so.
      const { zone, profile } = zoneWith((z) => {
        z.apex.A = [
          { value: '198.51.100.20', ttl: 300 },
          { value: '192.0.2.99', ttl: 300 }
        ];
      });
      return { findings: checkDns(zone, profile) };
    },
    covered: () => {
      const { zone, profile } = zoneWith((z) => {
        z.apex.A = [
          { value: '198.51.100.20', ttl: 300 },
          { value: '203.0.113.10', ttl: 300 }
        ];
      });
      return checkDns(zone, profile);
    },
    present: 'DNS010',
    alsoAssert: () => {
      const { zone, profile } = zoneWith((z) => {
        z.apex.AAAA = [{ value: '2001:db8::20', ttl: 300 }];
      });
      return {
        what: 'a dual stack apex is not reported as split, which is the reason for the scoping',
        findings: checkDns(zone, profile),
        absent: 'DNS010'
      };
    }
  },
  {
    heading: 'A key is only measured when its algorithm is one this understands',
    absent: 'DKIM002',
    blind: () => {
      // An ed25519 key has no RSA modulus to measure, and the 1024 bit floor is
      // an RSA number. Reporting a length taken from a base64 length heuristic
      // would be worse than reporting nothing.
      const { zone, profile } = zoneWith((z) => {
        z['sel1._domainkey'].TXT = ['v=DKIM1; k=ed25519; p=11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo='];
      });
      return { findings: checkEmail(zone, profile) };
    },
    covered: () => {
      const { zone, profile } = zoneWith((z) => {
        z['sel1._domainkey'].TXT = [
          'v=DKIM1; k=rsa; p=MEgCQQCo9+BpMRYQ/dL3DS2CyJxRF+j6ctbT3/Qp84+KeFhnii7NT7fELilKUSnxS30WAvQCCo2yU1orfgqr41mM70MBAgMBAAE='
        ];
      });
      return checkEmail(zone, profile);
    },
    present: 'DKIM002'
  },
  {
    heading: 'A tag value that cannot be read is skipped, not reported',
    absent: 'DMARC004',
    blind: () => {
      // The parsers are total: a value they cannot read becomes null rather
      // than an error, so pct=abc is treated as absent. The policy is published
      // with a malformed percentage and nothing here says so.
      const { zone, profile } = zoneWith((z) => {
        z._dmarc.TXT = ['v=DMARC1; p=reject; rua=mailto:dmarc@example.org; pct=abc'];
      });
      return { findings: checkEmail(zone, profile) };
    },
    covered: () => {
      const { zone, profile } = zoneWith((z) => {
        z._dmarc.TXT = ['v=DMARC1; p=reject; rua=mailto:dmarc@example.org; pct=50'];
      });
      return checkEmail(zone, profile);
    },
    present: 'DMARC004',
    alsoAssert: () => {
      const { zone, profile } = zoneWith((z) => {
        z._dmarc.TXT = ['v=DMARC1; p=reject; rua=mailto:dmarc@example.org; pct=0'];
      });
      return {
        what: 'a percentage of zero is read, and is its own reason rather than a small one',
        findings: checkEmail(zone, profile),
        present: 'DMARC008'
      };
    }
  }
];

/** The headings docs/limits.md declares, so the document and this file can be compared. */
export function headingsInDocument() {
  const text = readFileSync(join(ROOT, 'docs', 'limits.md'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
}

export const AREA_COUNT = CHECKS.length;
