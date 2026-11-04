# An HSTS header that enforces nothing

The header is present. Every summary that prints response headers shows it.
A reviewer reading the configuration sees `includeSubDomains` and `preload` and
concludes the policy is not only on but strict.

It is off. `max-age` is the only directive in the header that does any work, and
a header without it is malformed, so browsers discard the whole thing. The two
directives that are present modify a lifetime that was never given, which makes
them inert rather than strict.

This is the shape worth understanding, because the same reasoning applies to
`max-age=0`: that form is syntactically fine and is the documented way to
withdraw a policy, so it also reads as a configured header and enforces nothing.
A tool that only asks whether the header exists reports both as healthy.

Raises `SSL011`.

Corrected by giving the header a `max-age` long enough to mean something, and
dropping `preload` until the name is actually ready to be submitted.
