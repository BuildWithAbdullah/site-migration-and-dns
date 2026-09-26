# Examples

Ten pairs, each one a failing case beside its correction, and a shared baseline
they are all overlaid on.

## How a pair is stored

`baseline/` is a complete migration directory with nothing wrong in it. Every
check runs against it and every check finds nothing, which is asserted by the
test suite.

Each numbered directory holds a `fail/` and a `pass/`, containing **only the
files that differ from the baseline**. The tool copies the baseline and then
copies the overlay on top of it, so what you read in a pair is the change itself
rather than two large directories to compare by eye.

```
node bin/migrate-check.mjs examples/baseline --now 2026-10-01T00:00:00Z
```

To run one variant, materialise it first:

```
node -e "import('./tools/example.mjs').then(m=>console.log(m.materialise('06-serialized-search-and-replace','fail')))"
```

## What is asserted about every pair

Both properties are checked in `test/examples.mjs`, and they are the reason these
are evidence rather than illustration.

1. **The failing variant raises exactly the findings its own README claims.** Not
   a superset. If a change to a check starts raising something extra, the pair
   fails until either the check or the README is corrected.
2. **The corrected variant raises nothing at all, against every check.** Not only
   the check its own pair is about. This is the property that catches a corrected
   page quietly carrying somebody else's defect, and it caught exactly that
   during the build of this repository.

## The pairs

| Pair | Findings | What it is about |
|---|---|---|
| `01-apex-cname` | `DNS001`, `DNS003` | An apex CNAME breaks mail before it breaks the site |
| `02-ttl-staging` | `TTL001`, `TTL002`, `TTL004` | A TTL lowered an hour before a cutover advertised at a day |
| `03-spf-lookup-limit` | `SPF003`, `SPF004`, `SPF006` | Four providers is enough to pass ten lookups |
| `04-dkim-and-dmarc` | `DKIM002`, `DKIM003`, `DMARC001` | A signature that looks present and does nothing |
| `05-certificate-coverage` | `SSL001`, `SSL003`, `SSL007`, `SSL008` | The redirect cannot rescue an uncovered name |
| `06-serialized-search-and-replace` | `SER001` to `SER004` | The string changed and the byte length did not |
| `07-redirect-map-coverage` | `RED001` to `RED008` | Every common map defect in one file |
| `08-mixed-content` | `MIX001` to `MIX007` | What the source says, not what one page loaded |
| `09-staging-config-in-production` | eight `IDX` findings and `MIX003` | The five pieces of staging config that survive |
| `10-mail-does-not-survive-the-move` | `DNS006`, `SPF001`, `DKIM001` | A zone rebuilt for a website, by a host that did not know about the mail |
