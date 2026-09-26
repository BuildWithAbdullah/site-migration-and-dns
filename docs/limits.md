# What this cannot tell you

The value of a migration check is not the list of things it found. It is knowing
exactly where the list stops. This page is that boundary, written out, because a
tool whose limits are undocumented gets trusted for things it never did.

## It checks what was collected, not what exists

Every finding comes from a file in the migration directory. If `zone.json` is
missing a record type because the lookup failed rather than because the record is
absent, the check cannot tell the difference, and it will read a failed lookup as
an absent record.

`probe/collect.mjs` separates the two as far as it can: a lookup that returned
nothing is not reported, and a lookup that could not be performed is listed
under `lookupErrors`. Read that list. It is the difference between "there is no
DKIM record" and "nobody managed to ask".

The report always names the checks that did not run. A check with no input is
skipped, never passed. Exit code 0 means the checks that ran found nothing at or
above the threshold, and nothing more than that.

## It cannot see resolver caches

There is no way to ask the internet what it currently believes about a name.
Every propagation statement in this repository is arithmetic over TTLs, and it is
a worst case.

That makes it the right number for a rollback plan, where you need to know how
long the worst affected visitor stays on the wrong host. It makes it the wrong
number for telling a client the change has landed, because most resolvers will
have picked it up far sooner, and a few corporate resolvers ignore TTLs
altogether and will hold the old answer for longer than any arithmetic predicts.

`planTtl` also assumes the TTL you give it as `ttlBeforeLowering` is what
resolvers actually cached. If the record was changed more than once, or if the
TTL was raised at some point, the real worst case is the largest TTL that was
ever served, which is not something a zone snapshot can tell you.

## It reads the source, not the rendered page

The mixed content and indexing checks scan text. This catches more than a browser
scan in one direction and less in another.

More: it finds srcset candidates the tested screen never requested, stylesheet
rules the tested page never used, and template code on paths nobody visited.

Less: it cannot see anything introduced after the page is served. A script that
injects an http image, a plugin that adds a noindex on output, a tag manager
container that loads a third party over http, and a consent banner that rewrites
links are all invisible to it. A canonical set by JavaScript is invisible to it.
If the site is rendered client side, this check is looking at a shell.

The scanner is deliberately a scanner and not an HTML parser, because its input is
usually a template fragment or a database row rather than a whole document. That
means it can be fooled by a URL inside a comment or inside a string in an inline
script, and it will report those.

## It does not prove the serialized data is fine

`findLengthMismatches` finds strings whose declared byte length does not match
their contents. That is one specific kind of damage, and it is the common one.

It does not find: a value that was replaced consistently but wrongly, a row that
was truncated at a row boundary, a value that unserializes into the wrong shape,
an encoding mismatch between the dump and the target database, or a reference
stored in a format the scanner does not recognise as a domain at all.

`SER005` reports an encoded value that appears to contain the old domain, and it
checks all three base64 byte alignments to do it. It still cannot tell whether
what it found is an encoded URL, a cache key, or a signature over the old value,
and rewriting the last of those produces a value the application can no longer
verify. That is why the action for it is to change the value through the
interface that wrote it rather than by hand.

Nothing in this repository writes to a database. `replaceInSerialized` is a
function; calling it on your rows, in a transaction, from a dump you have already
taken, is your decision and your backup.

## Redirect coverage is only as good as the inventories

`RED001` and `RED004` compare the map against two lists of URLs you supplied.
If the old inventory is a crawl of the old site, it is missing every URL that was
never linked and still has inbound links from elsewhere, which is exactly the set
worth preserving. Build the old inventory from server logs, search impressions
and backlink data as well as a crawl, or the most valuable unmapped URLs will not
appear in it.

`RED008` assumes the map is evaluated in file order. Some platforms sort rules by
specificity, in which case a broad rule above a specific one is harmless and the
finding is noise. Check how your platform evaluates rules before acting on it.

## Email authentication is checked as published, not as delivered

The SPF lookup count uses the costs you declare for each include. Those costs
live inside somebody else's DNS and change without notice, so a record that
counted nine last month can count eleven today with no change on your side.
Re-run the count rather than trusting a number from a previous migration.

Nothing here sends a message. A record set that passes every check in this
repository can still fail delivery because of reputation, content filtering, a
missing PTR record on the sending address, or a receiver that applies its own
rules. The only proof that mail works is mail arriving.

Key length is read from the DER structure, which is exact for RSA. For key types
this does not understand, the bit length is reported as unknown rather than
guessed, so an absent key size is not a passing key size.

## The checks that can only be done after the switch

These are not in the tool, because before the cutover there is nothing to
measure. They belong in the runbook.

- That the new host is serving the new content on the real hostname, rather than
  on a temporary preview URL where a different virtual host configuration applies.
- That the certificate the public actually receives is the new one. Before the
  cutover you can only inspect the certificate on the name you can reach.
- That mail sent from the application arrives. Contact forms, order
  confirmations and password resets are the three that fail quietly, and they
  often send through a different path from the mail a person sends.
- That redirects fire on the live server with its real rule ordering, rather than
  in a map file.
- That search engines are recrawling, which takes days and is measured in a
  search console rather than by a script.

## The window where both hosts are live

Between lowering the TTL and the last resolver dropping the old answer, both
hosts are serving and both answers are correct. During that window:

- A finding that says an address still points at the old host is describing the
  design, not a fault. The checks scope that finding to the post cutover phase
  for exactly this reason, which means setting `phase` in the profile honestly is
  what makes those findings meaningful.
- Any write that reaches the old host is lost when the old host is retired. New
  orders, new comments, new form submissions and new uploads are the usual
  casualties, and no check in this repository can see them.
- Two live databases will diverge. Putting the old host into a read only state
  before the cutover is worth more than any check here.

Assume the window is as wide as the arithmetic says, not as wide as your own
resolver suggests.
