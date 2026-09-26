# A redirect map with every common defect in it at once

Each of these is individually easy to see and collectively easy to ship: an old
URL nobody mapped, a chain that goes the long way round, a pair of rules that
point at each other, a target that does not exist on the new site, a campaign
URL that loses its query string, a target still written as http, two trailing
slash conventions in one file, and a wildcard placed above the specific rules it
makes unreachable.

Raises `RED001` through `RED008`.

Corrected by mapping the missing URL, collapsing the chain, breaking the loop,
pointing at URLs that exist, carrying the query string, writing targets as
https, settling on one trailing slash convention, and putting the specific
rules above the wildcard.
