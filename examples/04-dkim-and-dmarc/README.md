# Short DKIM key left in testing mode, and no DMARC record at all

A 512 bit key is treated as unsigned by some receivers, and `t=y` tells every
receiver to ignore a failure, so a signature that looks present does nothing.
With no DMARC record there is also no report telling anyone.

Raises `DKIM002`, `DKIM003` and `DMARC001`.

Corrected with a 2048 bit key, testing mode removed, and a DMARC record that
has a reporting address before it has a policy.
