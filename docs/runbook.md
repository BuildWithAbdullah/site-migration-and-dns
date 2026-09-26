# The order of operations around a cutover

The tool checks state. This is the sequence that produces the state worth
checking. It is written as an order rather than a list, because most migration
failures are a correct step taken at the wrong time.

## More than one old TTL before the cutover

1. Take the inventory of old URLs now, from server logs, search impressions and
   backlink data as well as a crawl. A crawl alone misses every URL that has
   inbound links and no internal ones, which is the set most worth keeping.
2. Record the current TTL of the records you are going to change. This is
   `ttlBeforeLowering`, and it is the number every deadline is derived from.
3. Lower the TTL, and lower the SOA minimum with it. Record the moment as
   `ttlLoweredAt`.
4. Run `migrate-check` with `phase: "pre"`. At this stage you are looking for
   `TTL002`: if it fires, the cutover date is too early and the tool will tell you
   the earliest one that is actually staged.

Lowering the TTL is the step that gets skipped, because nothing fails when you
skip it. What it buys is the width of the rollback window, and you find out how
wide that is on the one day you need it to be narrow.

## Before the nameserver change

5. Build the new zone in full, including the records that have nothing to do with
   the website. A zone built fresh at a new host knows about the site and does not
   know the domain has mail, so MX, SPF and DKIM are simply absent. Example
   `10-mail-does-not-survive-the-move` is this failure.
6. Add the new sending host to SPF before the application starts sending from it,
   not after. Contact form mail and order confirmations fail first and get
   noticed last.
7. Check CAA against the issuer the new host uses. An existing certificate keeps
   working, so this surfaces at the first renewal rather than at the cutover.
8. Issue the certificate for both the apex and `www`, whichever one is canonical.
   The redirect from the other happens after the handshake, so it cannot rescue a
   name the certificate does not cover.
9. Do the database work on a copy. Use a serialization aware replacement. Run
   `migrate-check` over the dump and get `serialized` clean before the dump goes
   anywhere near the new host.
10. Remove the staging configuration: the robots.txt, the global noindex, the
    canonical, the site URL setting. Example `09-staging-config-in-production` is
    what happens when one of the five survives.

## The cutover

11. Put the old site into a read only state if anything on it accepts writes.
    Between the change and the last resolver dropping the old answer, both hosts
    are live, and a write that reaches the old one is lost when it is retired. No
    check can see those.
12. Change the records. Not the nameservers and the records in one step, if you
    can avoid it, because then a wrong answer has two possible causes.
13. Run `migrate-check` with `phase: "post"`. `DNS004` is now meaningful where
    before it was not.

## After the switch, and only after

These cannot be done earlier, which is why they are the ones that get dropped.

14. Confirm the certificate the public receives is the new one, on the real
    hostname rather than a preview URL.
15. Send mail from the application. Not from your own client: the contact form,
    a test order, a password reset. They often take a different path.
16. Confirm redirects on the live server, with its real rule ordering, rather
    than in the map file.
17. Submit the new sitemap and watch for recrawling. This takes days and is
    measured in a search console, not by a script.

## Once it has settled

18. Raise the TTL back. `planTtl` gives the moment it is safe to.
19. Remove the old sending host from SPF, after checking the outbound mail logs
    rather than instead of checking them. Application mail, cron jobs and form
    handlers are the stragglers, and the removal is what breaks them.
20. Keep the old host answering, and redirecting, for longer than feels
    necessary. Absolute URLs pointing at the old domain work perfectly until the
    day it stops answering, which is how a site appears fine for a month and then
    breaks all at once.
