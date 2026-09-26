# Mixed content and old domain references left in the templates

A browser scan finds what the page loaded on the URL that was tested. This finds
what the source says, including the srcset candidates a particular screen never
requested and the stylesheet rules the tested page never used.

The form action is the one to fix first: it sends what the visitor typed in
clear text, and a redirect on the receiving end does not unsend a request.

Raises `MIX001` through `MIX007`.

Corrected by writing every scheme as https, replacing the old domain with root
relative paths, and rewriting every candidate in the srcset rather than the
first one.
