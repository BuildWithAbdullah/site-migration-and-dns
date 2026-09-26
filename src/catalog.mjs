// The finding catalogue. This file is the single source of truth: every check
// module raises findings by id, every report renders them from here, and the
// repository verifier compares the counts quoted in the README against it.
//
// Each entry answers three questions, because a finding that only says what is
// wrong is a finding the reader cannot act on:
//   nextAction   what to do about it
//   doesNotProve the inference the finding does not support, so nobody reads
//                more into it than the evidence carries

export const SEVERITIES = ['blocker', 'high', 'medium', 'low'];

export const AREAS = [
  'dns',
  'ttl',
  'email',
  'ssl',
  'serialized',
  'redirects',
  'mixed',
  'indexing'
];

const FINDINGS = [
  // ---------------------------------------------------------------- dns
  {
    id: 'DNS001',
    area: 'dns',
    title: 'Apex name is served by a CNAME',
    severity: 'blocker',
    nextAction:
      'Replace the apex CNAME with address records, or with the provider ALIAS, ANAME or flattened CNAME type that returns an address at the apex.',
    doesNotProve:
      'That the name is currently failing to resolve. Many resolvers tolerate an apex CNAME until an MX or SOA lookup at the same name is needed, at which point mail stops rather than the site.'
  },
  {
    id: 'DNS002',
    area: 'dns',
    title: 'Apex name has no address record',
    severity: 'blocker',
    nextAction:
      'Add A records, AAAA records or the provider ALIAS record for the apex before cutover.',
    doesNotProve:
      'That visitors see an error. If the previous zone is still authoritative, resolvers may be answering from it rather than from the zone being inspected.'
  },
  {
    id: 'DNS003',
    area: 'dns',
    title: 'www has no record',
    severity: 'high',
    nextAction:
      'Add a CNAME from www to the apex, or address records matching the apex, and confirm the server answers for both names.',
    doesNotProve:
      'That www is the canonical host. Check which of the two the site redirects to before deciding which one needs the record.'
  },
  {
    id: 'DNS004',
    area: 'dns',
    title: 'Address record still points at the old host',
    severity: 'blocker',
    nextAction:
      'Update the address record to the new host address, then wait for the previous TTL to expire before concluding anything from a test.',
    doesNotProve:
      'That the cutover failed. Inside the old TTL window both answers are live and correct, which is the point of lowering the TTL beforehand.'
  },
  {
    id: 'DNS005',
    area: 'dns',
    title: 'Delegated nameservers do not match the intended set',
    severity: 'blocker',
    nextAction:
      'Either update the delegation at the registrar to the intended nameservers, or edit the zone that is actually authoritative. Editing the wrong one is the most common reason a correct change appears to do nothing.',
    doesNotProve:
      'Which zone is correct. The check compares the delegation against what the migration profile declares, and the profile can be the thing that is wrong.'
  },
  {
    id: 'DNS006',
    area: 'dns',
    title: 'No MX record for the domain',
    severity: 'blocker',
    nextAction:
      'Add the MX records for the mail provider before the nameserver change, not after. A zone built from scratch at a new host usually has no mail records at all.',
    doesNotProve:
      'That mail is already being lost. Sending servers queue and retry for days, so a short gap is often recoverable if it is caught quickly.'
  },
  {
    id: 'DNS007',
    area: 'dns',
    title: 'MX points at the web host',
    severity: 'high',
    nextAction:
      'Point MX at the mail provider. A web host that creates a default MX for the domain it just started serving will silently accept and drop mail.',
    doesNotProve:
      'That the web host does not handle mail. Some do. The finding flags the coincidence of web and mail on one name, which is worth confirming rather than assuming.'
  },
  {
    id: 'DNS008',
    area: 'dns',
    title: 'MX still points at the old mail host',
    severity: 'high',
    nextAction:
      'Decide deliberately whether mail moves with the site. If it does not, carry the old MX records into the new zone unchanged.',
    doesNotProve:
      'That this is a mistake. Leaving mail where it is while the website moves is a normal and often correct choice.'
  },
  {
    id: 'DNS009',
    area: 'dns',
    title: 'CAA records do not authorise the new certificate issuer',
    severity: 'high',
    nextAction:
      'Add a CAA record for the issuer the new host uses, or remove the CAA set if it is no longer wanted. Certificate issuance will fail while the issuer is unauthorised.',
    doesNotProve:
      'That issuance has failed yet. CAA is checked at issuance time, so an existing certificate keeps working until it needs renewal.'
  },
  {
    id: 'DNS010',
    area: 'dns',
    title: 'Apex has address records at more than one host',
    severity: 'medium',
    nextAction:
      'Remove the addresses that are not meant to serve the site. Two live addresses means a share of visitors reach the old host and a share reach the new one, with no pattern the client can reproduce.',
    doesNotProve:
      'That this is unintended. Multiple addresses are how round robin and some failover setups are meant to look.'
  },

  // ---------------------------------------------------------------- ttl
  {
    id: 'TTL001',
    area: 'ttl',
    title: 'TTL is still long with the cutover close',
    severity: 'high',
    nextAction:
      'Lower the TTL now and wait at least the length of the old TTL before changing the record, otherwise resolvers hold the old answer for that long after the change.',
    doesNotProve:
      'That the cutover will break. It sets how long the rollback takes, which matters most on the day something else goes wrong.'
  },
  {
    id: 'TTL002',
    area: 'ttl',
    title: 'TTL was not lowered early enough to take effect',
    severity: 'high',
    nextAction:
      'Move the cutover later, to at least one old TTL after the moment the TTL was lowered. Lowering a TTL only takes effect once the previously cached longer TTL has expired.',
    doesNotProve:
      'That every resolver will hold the old answer for the full window. It is the worst case, and the worst case is what a rollback plan has to survive.'
  },
  {
    id: 'TTL003',
    area: 'ttl',
    title: 'TTL left low after the migration settled',
    severity: 'low',
    nextAction:
      'Raise the TTL back to its normal value once the migration is signed off, to cut resolver traffic and reduce the blast radius of an authoritative outage.',
    doesNotProve:
      'That anything is broken. This is housekeeping, and it is the step most often forgotten because nothing fails when it is skipped.'
  },
  {
    id: 'TTL004',
    area: 'ttl',
    title: 'SOA negative caching TTL is long',
    severity: 'medium',
    nextAction:
      'Lower the SOA minimum field before cutover. It controls how long resolvers cache the absence of a record, so a name queried a moment too early stays missing for that long.',
    doesNotProve:
      'That a name is currently being cached as missing. It is the exposure, not the event.'
  },

  // ---------------------------------------------------------------- email
  {
    id: 'SPF001',
    area: 'email',
    title: 'No SPF record',
    severity: 'high',
    nextAction:
      'Publish a TXT record at the domain apex starting v=spf1, listing the hosts that send on the domain behalf, ending in -all or ~all.',
    doesNotProve:
      'That mail is being rejected. Many receivers accept unauthenticated mail, and DKIM alone can still satisfy DMARC.'
  },
  {
    id: 'SPF002',
    area: 'email',
    title: 'More than one SPF record published',
    severity: 'blocker',
    nextAction:
      'Merge the records into one. Two SPF records is a permanent error, and a receiver that treats it that way will not authorise any sender, including the ones both records list.',
    doesNotProve:
      'That both records are wrong. The contents may each be correct, which is what makes this easy to miss by reading them.'
  },
  {
    id: 'SPF003',
    area: 'email',
    title: 'SPF exceeds the ten DNS lookup limit',
    severity: 'high',
    nextAction:
      'Reduce the include, a, mx, ptr and exists mechanisms to ten lookups or fewer, counting the lookups inside each include. Flatten the largest include to addresses if the provider publishes a stable range.',
    doesNotProve:
      'The exact count in production. The lookups inside a third party include are counted from the profile, and the provider can change them without telling anyone.'
  },
  {
    id: 'SPF004',
    area: 'email',
    title: 'SPF has no all mechanism',
    severity: 'medium',
    nextAction:
      'End the record in -all or ~all. Without a final all the result for an unlisted sender is neutral, which is the same outcome as publishing nothing.',
    doesNotProve:
      'That the listed senders fail. They still pass. The gap is in what happens to everyone else.'
  },
  {
    id: 'SPF005',
    area: 'email',
    title: 'SPF ends in +all',
    severity: 'blocker',
    nextAction:
      'Replace +all with -all or ~all. As published, the record authorises every host on the internet to send as this domain.',
    doesNotProve:
      'That the domain is being abused. It proves nothing is stopping it.'
  },
  {
    id: 'SPF006',
    area: 'email',
    title: 'SPF uses the ptr mechanism',
    severity: 'medium',
    nextAction:
      'Remove ptr and list the sending hosts with ip4, ip6 or include. The mechanism is deprecated, slow, and some receivers skip it.',
    doesNotProve:
      'That mail from those hosts fails. A receiver that still evaluates ptr may pass it.'
  },
  {
    id: 'SPF007',
    area: 'email',
    title: 'SPF still authorises the old host',
    severity: 'low',
    nextAction:
      'Remove the old host once the migration is signed off and nothing is still sending from it. Application mail, cron jobs and form handlers are the usual stragglers.',
    doesNotProve:
      'That the old host is idle. Check outbound mail logs before removing it, or the removal is the thing that breaks mail.'
  },
  {
    id: 'SPF008',
    area: 'email',
    title: 'SPF does not authorise the new host',
    severity: 'high',
    nextAction:
      'Add the new host to the SPF record before the application starts sending from it. Contact form mail and order confirmations are usually the first to fail and the last to be noticed.',
    doesNotProve:
      'That the new host sends mail directly. If it relays through the mail provider already listed, the record is fine as it stands.'
  },
  {
    id: 'SPF009',
    area: 'email',
    title: 'SPF published under the obsolete SPF record type',
    severity: 'low',
    nextAction:
      'Publish the policy as a TXT record. The dedicated SPF record type was withdrawn, and receivers no longer look for it.',
    doesNotProve:
      'That the policy is wrong. It is in the wrong place, which means it is not being read.'
  },
  {
    id: 'DKIM001',
    area: 'email',
    title: 'DKIM selector has no record',
    severity: 'high',
    nextAction:
      'Publish the selector record the mail provider issues, at selector._domainkey under the domain. A zone rebuilt at a new host loses these silently.',
    doesNotProve:
      'That signing is broken. The sender may be signing with a different selector than the one the profile names.'
  },
  {
    id: 'DKIM002',
    area: 'email',
    title: 'DKIM key is shorter than 1024 bits',
    severity: 'medium',
    nextAction:
      'Reissue the key at 2048 bits. Some receivers treat keys below 1024 as unsigned, which turns a passing signature into no signature at all.',
    doesNotProve:
      'That signatures are being rejected today. Receiver behaviour on short keys varies.'
  },
  {
    id: 'DKIM003',
    area: 'email',
    title: 'DKIM record is in testing mode',
    severity: 'medium',
    nextAction:
      'Remove t=y once signing is confirmed working. While it is set, receivers are told to treat a failed signature as if the domain were not signing.',
    doesNotProve:
      'That anything is misconfigured. Testing mode is correct during rollout and wrong once it is finished.'
  },
  {
    id: 'DKIM004',
    area: 'email',
    title: 'DKIM record has an empty public key',
    severity: 'high',
    nextAction:
      'Restore the public key, or remove the selector record. An empty p= means the key is revoked, and every signature with that selector fails.',
    doesNotProve:
      'That the revocation was accidental. Revoking a selector is the correct response to a leaked private key.'
  },
  {
    id: 'DMARC001',
    area: 'email',
    title: 'No DMARC record',
    severity: 'medium',
    nextAction:
      'Publish a TXT record at _dmarc under the domain, starting with p=none and an rua address, so the reports arrive before any policy is enforced.',
    doesNotProve:
      'That the domain can be spoofed at will. SPF and DKIM still apply. DMARC is what ties them to the visible from address and reports on the result.'
  },
  {
    id: 'DMARC002',
    area: 'email',
    title: 'DMARC policy is none',
    severity: 'low',
    nextAction:
      'Move to quarantine and then reject once the reports show every legitimate sender aligning. Do not move the policy during a migration week.',
    doesNotProve:
      'That the record is wrong. p=none is the correct first step and the correct place to sit while senders are still being found.'
  },
  {
    id: 'DMARC003',
    area: 'email',
    title: 'DMARC record has no reporting address',
    severity: 'medium',
    nextAction:
      'Add rua. Without it the policy is enforced and nobody finds out which legitimate senders it is catching.',
    doesNotProve:
      'That mail is being lost. It proves that if mail is being lost, there is no record of it.'
  },
  {
    id: 'DMARC004',
    area: 'email',
    title: 'DMARC pct is below 100',
    severity: 'low',
    nextAction:
      'Raise pct to 100 once the sample looks clean. A partial percentage applied to a reject policy means failures are intermittent, which is harder to diagnose than a consistent failure.',
    doesNotProve:
      'That the setting is a mistake. Ramping pct is the standard way to roll a policy out.'
  },
  {
    id: 'DMARC005',
    area: 'email',
    title: 'DMARC uses strict alignment with no aligned authentication',
    severity: 'high',
    nextAction:
      'Either relax alignment, or make the envelope domain and DKIM signing domain match the visible from domain exactly. Under strict alignment a subdomain sender no longer counts as aligned.',
    doesNotProve:
      'That mail is failing now. If the policy is p=none the effect is confined to the reports.'
  },
  {
    id: 'DMARC006',
    area: 'email',
    title: 'More than one DMARC record published',
    severity: 'high',
    nextAction:
      'Remove all but one. Multiple records at _dmarc means receivers apply no policy, which is worse than the weakest policy of the two.',
    doesNotProve:
      'That either record is wrong on its own terms.'
  },
  {
    id: 'DMARC007',
    area: 'email',
    title: 'Subdomain policy is weaker than the domain policy',
    severity: 'medium',
    nextAction:
      'Decide whether sp=none is deliberate. If it is not, remove it and let the domain policy apply to subdomains, which is the default.',
    doesNotProve:
      'That it is wrong. A subdomain used by a bulk sender that cannot align yet is a normal reason to hold it at none.'
  },

  // ---------------------------------------------------------------- ssl
  {
    id: 'SSL001',
    area: 'ssl',
    title: 'Certificate does not cover www',
    severity: 'blocker',
    nextAction:
      'Reissue the certificate with both the apex and www as subject alternative names, even if only one of them is canonical. The redirect from the other one happens after the handshake, so it cannot rescue a name the certificate does not cover.',
    doesNotProve:
      'That visitors see a warning. They see it only on the name that is missing.'
  },
  {
    id: 'SSL002',
    area: 'ssl',
    title: 'Certificate does not cover the apex',
    severity: 'blocker',
    nextAction:
      'Reissue with the apex included. A wildcard does not cover the name it is a wildcard of.',
    doesNotProve:
      'That the site is unreachable. It is reachable on every name the certificate does cover.'
  },
  {
    id: 'SSL003',
    area: 'ssl',
    title: 'Certificate expires inside the migration window',
    severity: 'high',
    nextAction:
      'Renew before cutover. Automatic renewal usually validates over HTTP on the name being moved, so the renewal and the cutover are competing for the same record.',
    doesNotProve:
      'That renewal will fail. It says the renewal is scheduled to land in the week with the least slack in it.'
  },
  {
    id: 'SSL004',
    area: 'ssl',
    title: 'Certificate has expired',
    severity: 'blocker',
    nextAction:
      'Issue a new certificate now. If validation is failing, check that the challenge path is not being caught by a redirect added for the migration.',
    doesNotProve:
      'Why it expired. An expired certificate on the new host often means validation never succeeded there in the first place.'
  },
  {
    id: 'SSL005',
    area: 'ssl',
    title: 'Certificate is not yet valid',
    severity: 'blocker',
    nextAction:
      'Check the clock on the server and on the machine running the check. A certificate that is not yet valid is almost always a clock, not a certificate.',
    doesNotProve:
      'That the certificate is wrong.'
  },
  {
    id: 'SSL006',
    area: 'ssl',
    title: 'No redirect from http to https',
    severity: 'high',
    nextAction:
      'Redirect http to https with a single permanent hop on both the apex and www, and confirm it applies to paths as well as the home page.',
    doesNotProve:
      'That https is unavailable. Both may work, which is the case search engines treat as two sites.'
  },
  {
    id: 'SSL007',
    area: 'ssl',
    title: 'Redirect chain to the canonical host passes through http',
    severity: 'medium',
    nextAction:
      'Reorder the rules so the scheme is fixed in the first hop. As it stands, one request in the chain travels in clear text and can be intercepted.',
    doesNotProve:
      'That the final response is insecure. The destination is https. The route to it is not.'
  },
  {
    id: 'SSL008',
    area: 'ssl',
    title: 'HSTS header missing after a move to https',
    severity: 'low',
    nextAction:
      'Add Strict-Transport-Security once https is stable on every hostname, starting with a short max-age.',
    doesNotProve:
      'That anything is broken. HSTS closes the gap on the very first request, which the redirect cannot.'
  },
  {
    id: 'SSL009',
    area: 'ssl',
    title: 'HSTS preload requested with a short max-age',
    severity: 'high',
    nextAction:
      'Raise max-age to at least one year before requesting preload, or remove the preload token. Preload is difficult to reverse and takes effect before the site is asked.',
    doesNotProve:
      'That the domain is on the preload list. The token is a request, not a state.'
  },
  {
    id: 'SSL010',
    area: 'ssl',
    title: 'HSTS includeSubDomains with a subdomain not on https',
    severity: 'high',
    nextAction:
      'Serve every subdomain over https first, or drop includeSubDomains. The header applies to names nobody checked, and staging, mail and admin subdomains are the ones that break.',
    doesNotProve:
      'That those subdomains are currently unreachable. They break for visitors who have already seen the header, which is not the person running the check.'
  },

  // ---------------------------------------------------------------- serialized
  {
    id: 'SER001',
    area: 'serialized',
    title: 'Serialized string length prefix does not match the string',
    severity: 'blocker',
    nextAction:
      'Rewrite the value with a serialization aware replacement, which recomputes every length prefix. A value in this state does not unserialize, and the application sees the option, widget or setting as absent.',
    doesNotProve:
      'That the visible symptom comes from this row. Broken serialized data fails quietly, so the missing widget and the broken row have to be tied together deliberately.'
  },
  {
    id: 'SER002',
    area: 'serialized',
    title: 'Evidence of a plain text search and replace inside serialized data',
    severity: 'blocker',
    nextAction:
      'Restore the affected rows from the pre-migration dump and redo the replacement with a tool that walks the structure. A second plain text pass over the damage does not undo it.',
    doesNotProve:
      'Which tool did it. The signature is a length prefix that matches the old domain length and a string that holds the new one.'
  },
  {
    id: 'SER003',
    area: 'serialized',
    title: 'Old domain still present inside serialized data',
    severity: 'high',
    nextAction:
      'Run the serialization aware replacement over the remaining rows. Values reached only through nested structures are the ones a first pass misses.',
    doesNotProve:
      'That the reference is live. Revision history and inactive theme settings hold references that nothing reads.'
  },
  {
    id: 'SER004',
    area: 'serialized',
    title: 'Serialized payload nested inside a serialized string',
    severity: 'high',
    nextAction:
      'Replace recursively, unserializing the inner payload, rewriting it and reserializing before fixing the outer length. A single pass fixes the outer prefix and leaves the inner one wrong.',
    doesNotProve:
      'That the nesting is a fault. Plugins legitimately store serialized data inside serialized data.'
  },
  {
    id: 'SER005',
    area: 'serialized',
    title: 'Old domain inside an encoded value that cannot be rewritten safely',
    severity: 'medium',
    nextAction:
      'Change it through the application interface that wrote it. Rewriting the encoded blob by hand risks a value the application can no longer read, and the check cannot tell whether the encoding is base64, a cache key or a signature.',
    doesNotProve:
      'That the value is actually an encoded domain reference. It matched a pattern, and that is all.'
  },

  // ---------------------------------------------------------------- redirects
  {
    id: 'RED001',
    area: 'redirects',
    title: 'Old URL with no redirect and no equivalent on the new site',
    severity: 'high',
    nextAction:
      'Map it, or decide deliberately that it becomes a 410. Every unmapped URL with inbound links or existing rankings is a loss that is hard to see in aggregate traffic.',
    doesNotProve:
      'That the URL matters. Check it against the link and impression data before spending time on a mapping.'
  },
  {
    id: 'RED002',
    area: 'redirects',
    title: 'Redirect reaches its destination through more than one hop',
    severity: 'medium',
    nextAction:
      'Collapse the chain so each old URL points at its final destination in one hop. Chains slow the first visit and some crawlers stop following after a few.',
    doesNotProve:
      'That the destination is wrong. It is reached. The cost is in the route.'
  },
  {
    id: 'RED003',
    area: 'redirects',
    title: 'Redirect loop',
    severity: 'blocker',
    nextAction:
      'Break the cycle. The usual cause is a canonical host rule and a path rule that each assume the other has already run.',
    doesNotProve:
      'That the loop is reachable in production. Rule order and scoping in the real server config may cut it short.'
  },
  {
    id: 'RED004',
    area: 'redirects',
    title: 'Redirect points at a URL that is not in the new inventory',
    severity: 'high',
    nextAction:
      'Correct the target. A redirect to a 404 costs more than no redirect, because it converts a fixable gap into a page that looks intentional.',
    doesNotProve:
      'That the target 404s. The inventory can be incomplete, which is worth checking before editing the map.'
  },
  {
    id: 'RED005',
    area: 'redirects',
    title: 'Redirect drops the query string',
    severity: 'medium',
    nextAction:
      'Preserve the query string, or map the parameters deliberately. Paid campaign URLs and tracked links are the ones that lose their attribution here.',
    doesNotProve:
      'That the parameters are needed. Some should be dropped, which is a decision rather than a default.'
  },
  {
    id: 'RED006',
    area: 'redirects',
    title: 'Trailing slash handling is inconsistent across the map',
    severity: 'medium',
    nextAction:
      'Pick one form, redirect the other to it once, and make the map agree with the choice. Mixed handling produces two URLs for one page and a chain for whichever form the map did not expect.',
    doesNotProve:
      'Which form is correct. It depends on what the new platform emits in its own links.'
  },
  {
    id: 'RED007',
    area: 'redirects',
    title: 'Redirect target uses http',
    severity: 'medium',
    nextAction:
      'Write the target as https. As it stands every mapped URL takes an extra hop through the scheme redirect, and the first hop is in clear text.',
    doesNotProve:
      'That the target is insecure. The scheme redirect will fix it, one request later.'
  },
  {
    id: 'RED008',
    area: 'redirects',
    title: 'A broad rule shadows a more specific one later in the map',
    severity: 'high',
    nextAction:
      'Order specific rules before broad ones, or narrow the broad pattern. The shadowed entries were written for a reason and will never run.',
    doesNotProve:
      'That the server evaluates the map in file order. Some platforms sort by specificity, in which case this is harmless.'
  },

  // ---------------------------------------------------------------- mixed
  {
    id: 'MIX001',
    area: 'mixed',
    title: 'Subresource loaded over http',
    severity: 'high',
    nextAction:
      'Change the URL to https. Scripts and stylesheets on http are blocked outright by browsers, so this is the category that breaks layout and behaviour rather than just warning.',
    doesNotProve:
      'That the resource is unavailable over https. Most hosts serve both, and the fix is often only the scheme.'
  },
  {
    id: 'MIX002',
    area: 'mixed',
    title: 'Protocol relative URL',
    severity: 'low',
    nextAction:
      'Write the scheme explicitly. A protocol relative URL is safe on an https page and becomes http on any page that is not, which includes a local copy opened from disk.',
    doesNotProve:
      'That the page is affected. On https it resolves to https, which is why this survives for years unnoticed.'
  },
  {
    id: 'MIX003',
    area: 'mixed',
    title: 'Absolute URL pointing at the old domain',
    severity: 'high',
    nextAction:
      'Rewrite it to the new domain, or make it root relative. Left alone it works only while the old domain answers, and it is the reason a site appears fine for a month and then breaks all at once.',
    doesNotProve:
      'That the reference is broken now. While the old host is live and redirecting, everything works.'
  },
  {
    id: 'MIX004',
    area: 'mixed',
    title: 'Stylesheet url() over http',
    severity: 'high',
    nextAction:
      'Change the scheme in the stylesheet. Background images, fonts and mask references hide here, and they are missed by a scan that only reads markup.',
    doesNotProve:
      'That the asset is visible on the page. Unused rules are still findings, and still cheap to fix.'
  },
  {
    id: 'MIX005',
    area: 'mixed',
    title: 'srcset candidate over http',
    severity: 'high',
    nextAction:
      'Change every candidate in the attribute. A srcset where only some candidates were rewritten fails for a share of viewport and density combinations, which is why it reproduces on one machine and not another.',
    doesNotProve:
      'That the image fails for the person testing. Their device may pick a candidate that was rewritten.'
  },
  {
    id: 'MIX006',
    area: 'mixed',
    title: 'Inline style referencing http',
    severity: 'medium',
    nextAction:
      'Rewrite the inline style, and check the database if the markup is page content rather than a template. Inline styles in content are usually the output of an editor, so the source is a row rather than a file.',
    doesNotProve:
      'That the file being scanned is where it originates.'
  },
  {
    id: 'MIX007',
    area: 'mixed',
    title: 'Form action over http',
    severity: 'blocker',
    nextAction:
      'Change the action to https immediately. This form sends whatever the visitor typed in clear text, and a redirect on the receiving end does not undo a request that has already been sent.',
    doesNotProve:
      'That data has been intercepted. It proves nothing prevents it.'
  },

  // ---------------------------------------------------------------- indexing
  {
    id: 'IDX001',
    area: 'indexing',
    title: 'robots.txt disallows everything',
    severity: 'blocker',
    nextAction:
      'Replace the staging robots.txt with the production one. This is the single most expensive file to carry across a migration by accident.',
    doesNotProve:
      'That pages have been dropped from the index. Removal takes time, which is the window in which this is still cheap to fix.'
  },
  {
    id: 'IDX002',
    area: 'indexing',
    title: 'robots.txt points its sitemap at the old domain',
    severity: 'medium',
    nextAction:
      'Update the Sitemap line to the new domain. A sitemap reached through a redirect is treated with less trust than one served directly.',
    doesNotProve:
      'That the sitemap is unreachable. It is reachable while the redirect holds.'
  },
  {
    id: 'IDX003',
    area: 'indexing',
    title: 'Page carries a noindex meta tag',
    severity: 'blocker',
    nextAction:
      'Remove the tag. On a staging build this is usually set globally by a plugin or environment flag rather than written into the template.',
    doesNotProve:
      'That the tag is in the file it was found in. Check for a plugin or platform setting emitting it before editing templates.'
  },
  {
    id: 'IDX004',
    area: 'indexing',
    title: 'X-Robots-Tag response header says noindex',
    severity: 'blocker',
    nextAction:
      'Remove the header at the server or platform level. It carries the same weight as the meta tag and is invisible in the page source, so it survives a careful review of the markup.',
    doesNotProve:
      'That the markup is wrong. The markup can be perfect while the header overrides it.'
  },
  {
    id: 'IDX005',
    area: 'indexing',
    title: 'Canonical URL points at the old domain',
    severity: 'blocker',
    nextAction:
      'Rewrite the canonical to the new domain. As it stands every page on the new site tells search engines the real version lives on the domain being retired.',
    doesNotProve:
      'That rankings have moved. The instruction is being given. Acting on it takes a recrawl.'
  },
  {
    id: 'IDX006',
    area: 'indexing',
    title: 'Canonical URL points at a staging host',
    severity: 'blocker',
    nextAction:
      'Rewrite the canonical, and check where the value comes from. A hardcoded staging canonical usually means the site URL setting was never changed, which affects more than the canonical.',
    doesNotProve:
      'That the staging host is indexable. If it is not, the canonical points at a page search engines cannot confirm, which is worse rather than better.'
  },
  {
    id: 'IDX007',
    area: 'indexing',
    title: 'Sitemap lists URLs on the old domain',
    severity: 'high',
    nextAction:
      'Regenerate the sitemap on the new site. A sitemap of old URLs asks search engines to recrawl exactly the pages being retired.',
    doesNotProve:
      'That the sitemap is stale everywhere. Paginated sitemap index files are often partly regenerated.'
  },
  {
    id: 'IDX008',
    area: 'indexing',
    title: 'Sitemap lists a URL that redirects',
    severity: 'medium',
    nextAction:
      'List final destination URLs only. A sitemap is a statement about canonical URLs, and a redirecting entry contradicts itself.',
    doesNotProve:
      'That the destination is wrong. The entry is, for this purpose.'
  },
  {
    id: 'IDX009',
    area: 'indexing',
    title: 'robots.txt does not reference the sitemap',
    severity: 'low',
    nextAction:
      'Add a Sitemap line. It is the one piece of discovery that does not depend on an account with the search engine.',
    doesNotProve:
      'That the sitemap is undiscovered. A submitted sitemap is found without it.'
  },
  {
    id: 'IDX010',
    area: 'indexing',
    title: 'hreflang alternate points at the old domain',
    severity: 'high',
    nextAction:
      'Update every alternate to the new domain, in every language version. hreflang has to be reciprocal, so one language left behind invalidates the cluster it belongs to.',
    doesNotProve:
      'That the cluster is broken. One missing return reference breaks the pair, not necessarily the whole set.'
  }
];

const BY_ID = new Map(FINDINGS.map((f) => [f.id, f]));

export function allFindings() {
  return FINDINGS.slice();
}

export function findingIds() {
  return FINDINGS.map((f) => f.id);
}

export function describe(id) {
  const entry = BY_ID.get(id);
  if (!entry) {
    throw new Error(`Unknown finding id: ${id}. Every raised finding must exist in src/catalog.mjs.`);
  }
  return entry;
}

export function countByArea() {
  const counts = {};
  for (const area of AREAS) counts[area] = 0;
  for (const f of FINDINGS) counts[f.area] += 1;
  return counts;
}

// A raised finding: the catalogue entry, plus where it was seen.
export function raise(id, evidence) {
  const entry = describe(id);
  return {
    id: entry.id,
    area: entry.area,
    title: entry.title,
    severity: entry.severity,
    nextAction: entry.nextAction,
    doesNotProve: entry.doesNotProve,
    where: evidence.where,
    detail: evidence.detail ?? null,
    line: evidence.line ?? null
  };
}
