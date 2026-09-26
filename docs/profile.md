# profile.json

One file per migration, written by hand. It is the only input the tool cannot
collect for you, because it describes intent: which host is supposed to be
serving, whether mail is moving, and when the cutover is. Most findings depend on
knowing the intent, because the same zone is correct before a cutover and wrong
after it.

## Required

| Field | Type | Meaning |
|---|---|---|
| `domain` | string | The domain being migrated, with no scheme and no `www`. |

Everything else is optional, and each omission disables the findings that depend
on it rather than guessing. What you leave out is not checked, and the report
does not pretend otherwise.

## Identity and hosts

| Field | Type | Used by |
|---|---|---|
| `oldDomain` | string | Serialized data, mixed content, indexing. Omit it for a host move that keeps the domain. |
| `phase` | `"pre"` or `"post"` | Everything time based. Defaults to `"pre"`. This is the field that decides whether an old address is a design or a fault. |
| `oldHost.addresses` | string array | `DNS004`, `DNS010` |
| `newHost.addresses` | string array | `DNS007`, `DNS010` |
| `newHost.name` | string | `DNS007` |
| `intendedNameservers` | string array | `DNS005`. The delegation you believe you are editing. |
| `certificateIssuer` | string | `DNS009`. The CAA identity of the issuer the new host uses. |
| `canonicalHost` | string | Documentation for the reader of the report. |
| `stagingHosts` | string array | `IDX006` |
| `subdomains` | string array | `SSL010` |
| `httpsSubdomains` | string array | `SSL010`. The subset of `subdomains` reachable over https. |

## Timing

| Field | Type | Used by |
|---|---|---|
| `cutoverAt` | ISO timestamp | `TTL001`, `TTL003`, `SSL003` |
| `ttlBeforeLowering` | seconds | `TTL002`. The TTL resolvers may still be holding, which is **not** the TTL currently in the zone once you have lowered it. |
| `ttlLoweredAt` | ISO timestamp | `TTL002` |

## Mail

| Field | Type | Used by |
|---|---|---|
| `mail.movesWithSite` | boolean | `DNS008`. Leaving mail where it is while the site moves is a normal choice, so the old mail host is only a finding when you said mail was moving. |
| `mail.oldMailHosts` | string array | `DNS008` |
| `mail.oldSendingHosts` | string array | `SPF007` |
| `mail.newSendingHosts` | string array | `SPF008` |
| `mail.dkimSelectors` | string array | `DKIM001` and everything else DKIM. No selectors means no DKIM checks. |
| `mail.includeLookupCosts` | object | `SPF003`. Lookups inside each include, by include name. Anything not listed counts as one, which understates most providers. |
| `mail.alignedAuthentication` | boolean | `DMARC005`. Set it only when the envelope domain and the DKIM signing domain match the visible from domain exactly. |

## A note on includeLookupCosts

The ten lookup limit is the SPF rule that breaks quietly, because the cost of an
include lives in somebody else's DNS. If you do not supply costs, each include
counts as one, and a record that really costs fourteen will be reported as
costing four. Look the costs up once per provider and record them here. They
change, so look them up again next migration rather than copying this file.
