# site-migration-and-dns

Pre-flight and post-flight verification for a website migration, as something
that runs rather than something you read.

A migration checklist tells you to check the DNS records, the redirects and the
mail authentication. It does not tell you whether you got them right, and it
cannot be run again next week by somebody else. This repository is the same
knowledge as a program: `migrate-check` reads a description of the migration and
the artefacts you have collected, and reports what is wrong, what to do about
it, and what the finding does not prove.

That last part matters more than it sounds. A migration goes wrong in the gap
between what a tool checked and what everybody assumed it checked, so every
finding here carries the inference it does not support, and a check with no input
is reported as skipped rather than passing quietly.

- **74 catalogued findings** across **8 areas**: DNS zone shape, TTL staging,
  email authentication, certificates and transport, PHP serialized data,
  redirect map coverage, mixed content, and indexing.
- **10 failing and corrected example pairs**, each one an overlay on a shared
  clean baseline, so a pair reads as a diff rather than two directories.
- **213 tests** and a repository verifier, green on Node 18, 20 and 22.
- No dependencies. No API key. Nothing to sign up for.

## The claim this repository is built around

**The judgement is a pure function. Only `probe/` touches the network.**

Every check is a function from data to findings. Nothing in `src/` opens a
socket, resolves a name or makes a request, which is why every branch of every
check is reachable from a test, and why the same input always gives the same
answer. `tools/verify.mjs` reads the source of every file under `src/` and
`bin/` and fails the build if a network module, a `fetch` or a filesystem write
appears in it.

`probe/collect.mjs` is the part that does touch the network, and it is the one
part CI does not run, because its output depends on somebody else's nameserver.
It collects; it does not judge.

## Install and run

```
git clone https://github.com/BuildWithAbdullah/site-migration-and-dns.git
cd site-migration-and-dns
node bin/migrate-check.mjs examples/baseline --now 2026-10-01T00:00:00Z
```

Against a real migration, in two steps:

```
# 1. Collect. This is the only step that goes near the network.
node probe/collect.mjs example.org ./my-migration --selectors=selector1

# 2. Describe the migration, then judge it.
#    See docs/profile.md for the fields.
cp docs/profile.example.json ./my-migration/profile.json
node bin/migrate-check.mjs ./my-migration
```

```
Usage: migrate-check <directory> [options]

  --format <text|json|markdown>   default text
  --fail-on <blocker|high|medium|low>
                                  lowest severity that exits 1, default high
  --now <iso timestamp>           evaluate time based checks at this moment
```

Exit code 0 means the checks that ran found nothing at or above the threshold.
It does not mean the migration is safe. Read the skipped list.

## What a migration directory holds

Everything is optional except `profile.json`. A check with no input is skipped
and named in the report.

| Path | Feeds | Produced by |
|---|---|---|
| `profile.json` | all checks | you, once, per migration |
| `zone.json` | DNS, TTL, email | `probe/collect.mjs` |
| `observed.json` | certificates and transport | `probe/collect.mjs` |
| `redirects.json` | redirect map coverage | your redirect map and URL inventories |
| `robots.txt`, `sitemap.xml` | indexing | the new site |
| `pages/*.html` | mixed content, indexing | saved pages or templates |
| `assets/*.css` | mixed content | the theme |
| `db/*.sql` | serialized data | a database dump |

## The eight areas

**DNS zone shape.** An apex CNAME, a missing address record, a delegation that
does not match the zone you have been editing, MX records a new host invented
for a domain it has just started serving, and CAA records that will refuse the
next certificate.

**TTL staging.** The arithmetic, not the advice. `planTtl` derives the moment by
which the TTL has to be lowered, the earliest cutover that is actually staged,
the worst case moment the last resolver drops the old answer, and the width of
the rollback window. Lowering a TTL an hour before a cutover advertised at one
day changes nothing, and that is the kind of thing worth computing rather than
remembering.

**Email authentication.** SPF parsed into mechanisms and modifiers, with the ten
DNS lookup limit counted through the includes rather than assumed to be one each.
DKIM keys measured by walking the DER to the RSA modulus, so a 512 bit key is
reported as 512 bits rather than estimated from the length of the base64. DMARC
with the defaults the specification actually gives, so an absent `pct` reads as
100 and not as missing.

**Certificates and transport.** Subject alternative names matched properly, so a
wildcard covers one label and never the name it wildcards. Expiry compared
against the migration window, because automatic renewal validates over the name
being moved. Redirect chains that reach https through a hop in clear text.
`includeSubDomains` and `preload` checked against the subdomains that are
actually on https.

**PHP serialized data.** The one that breaks WordPress migrations. A plain text
search and replace changes the string and leaves the byte length in front of it,
so the value stops unserializing and the application behaves as though the
option had never been set. This repository contains a correct replacement that
walks the structure, recurses into payloads nested inside strings, and recomputes
every prefix in bytes rather than characters. It also contains the scanner that
finds the damage, which has to work on dumps that cannot be parsed at all.

**Redirect map coverage.** Arithmetic over two URL inventories, so it can run
before the new site is reachable. Unmapped URLs, chains, loops, targets that do
not exist, dropped query strings, two trailing slash conventions in one file, and
a wildcard placed above the specific rules it makes unreachable.

**Mixed content.** Scanning the source rather than watching a page load, so it
finds the srcset candidates a particular screen never requested and the
stylesheet rules the tested page never used. Form actions over http are the
blocker: the request has already been sent by the time anything can redirect it.

**Indexing.** The staging configuration arriving in production. A blanket
`Disallow: /`, a global noindex, an `X-Robots-Tag` header that is invisible in
the page source, a canonical still pointing at the staging host, hreflang
alternates pointing back at the old domain, and a sitemap advertising the URLs
being retired.

## Examples

`examples/` holds a clean baseline and ten pairs. Each pair contributes only the
files that differ from the baseline, so the correction is readable as a diff.

| Pair | Demonstrates |
|---|---|
| `01-apex-cname` | An apex CNAME, and www with no record |
| `02-ttl-staging` | A TTL lowered too late to take effect |
| `03-spf-lookup-limit` | SPF past ten lookups, no `all`, and a `ptr` |
| `04-dkim-and-dmarc` | A short key left in testing mode, and no DMARC |
| `05-certificate-coverage` | Apex only certificate, expiring in the window |
| `06-serialized-search-and-replace` | A plain text replace over serialized data |
| `07-redirect-map-coverage` | Every common redirect map defect at once |
| `08-mixed-content` | Mixed content and old domain references |
| `09-staging-config-in-production` | The staging configuration shipped live |
| `10-mail-does-not-survive-the-move` | A rebuilt zone with no mail records |

Two things are asserted about every pair, and they are the reason the examples
are evidence rather than illustration. The failing variant has to raise exactly
the findings its own README claims, no more and no fewer. And the corrected
variant has to raise nothing at all when run against **every** check, not only
the one its pair is about, which is what stops a corrected page from quietly
carrying somebody else's defect.

## Verifying

Everything below runs with no network access and no configuration.

```
npm test          # 213 tests
npm run verify    # the repository verifier
```

`npm test` covers the parsers and the checks directly, then runs all ten example
pairs through the whole pipeline and asserts the two properties above. One test
is worth calling out: `test/coverage.mjs` asserts that every one of the 74
catalogued findings can actually be raised by some input. A finding nothing can
produce is documentation pretending to be a check, and this repository fails to
build if one appears.

`npm run verify` checks the repository against itself:

- the counts quoted in this README match the catalogue, the example directory
  and the number of tests that actually ran
- every file in `test/` is named in the `test` script, because `node --test` did
  not accept glob patterns before Node 21 and a test file that silently never
  runs is worse than no test
- nothing under `src/` or `bin/` imports a network module, calls `fetch` or
  writes to the filesystem, which is the claim at the top of this file
- every example has a README, a `fail` and a `pass`
- there are no em dashes or en dashes anywhere in the repository

CI runs both on Node 18, 20 and 22.

## What this does not do

Read `docs/limits.md` before relying on any of it. The short version:

- It checks what you collected. A record that was not collected is not a record
  that is absent, and the report says which checks did not run for that reason.
- It cannot see resolver caches. Everything about propagation here is a worst
  case derived from TTLs, which is the right number for a rollback plan and the
  wrong number for reassuring somebody that the change has landed.
- It reads the source, not the rendered page. A defect introduced by JavaScript
  at runtime, or by a plugin on output, is invisible to it.
- It never writes to your database, your zone or your site. The serialization
  aware replacement is a function you can call; nothing calls it for you.
- The checks that can only be done after the switch are listed in
  `docs/limits.md`, along with the window where both hosts are live and every
  answer is legitimately ambiguous.

## Documentation

- `docs/profile.md` and `docs/profile.example.json`: every field of the profile
- `docs/limits.md`: what this cannot tell you, in detail
- `docs/runbook.md`: the order of operations around a cutover

## Licence

MIT. No attribution required.
