# Certificate covers the apex only, expires inside the window, and the redirect
# passes through http

The redirect from the uncovered name happens after the handshake, so it cannot
rescue a name the certificate does not cover: the warning is shown first. The
renewal is also scheduled to land in the migration week, and the chain to the
canonical host takes a hop in clear text on the way.

Raises `SSL001`, `SSL003`, `SSL007` and `SSL008`.

Corrected by reissuing with both names, renewing before the cutover, fixing the
scheme in the first hop, and adding a transport security header once https is
stable.
