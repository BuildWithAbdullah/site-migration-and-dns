# Apex served by a CNAME, and www with no record

A control panel will accept a CNAME at the apex without complaint. The name
then cannot answer SOA or MX at the same label, so mail is what breaks rather
than the website, which is why this survives a visual check of the site.

Raises `DNS001` and `DNS003`.

Corrected by returning an address at the apex and giving www a record of its
own.
