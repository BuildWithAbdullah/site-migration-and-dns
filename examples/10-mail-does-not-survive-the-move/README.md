# The zone was rebuilt at the new host and mail was not in it

A new host builds a zone for the domain it has just been asked to serve. It
knows about the website. It does not know the domain has mail, so the MX, SPF
and DKIM records are simply absent, and the website looks perfect while mail
stops.

Sending servers queue and retry for days, which is the only reason this is
usually recoverable.

Raises `DNS006`, `SPF001` and `DKIM001`.

Corrected by carrying the mail records into the new zone before the nameserver
change rather than after it.
