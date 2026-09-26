# The staging configuration arrived in production

The most expensive migration mistake per character of config. A staging
robots.txt disallowing everything, a noindex the plugin set globally, a canonical
still pointing at the staging host, hreflang alternates pointing back at the old
domain, and a sitemap advertising the URLs being retired.

The canonical is the worst of them: every page on the new site is telling search
engines the real version lives somewhere else.

Raises `IDX001`, `IDX003`, `IDX005`, `IDX006`, `IDX007`, `IDX008`, `IDX009`
and `IDX010`, and `MIX003` as well: the canonical and the alternate are
themselves absolute URLs on the domain being retired, which is a second and
separate problem living in the same two lines of markup.

Corrected by shipping the production robots.txt, removing the global noindex,
pointing the canonical and the alternates at the live host, and regenerating the
sitemap so it lists destinations rather than redirect sources.
