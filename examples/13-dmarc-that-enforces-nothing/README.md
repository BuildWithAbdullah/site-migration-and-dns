# A DMARC policy that enforces nothing

The record reads `p=reject`. It has a reporting address, relaxed alignment, and
nothing malformed about it. Every tool that prints the policy prints `reject`,
and every summary of the migration says DMARC is enforcing.

`pct=0` is at the end of it. The percentage decides how much mail the policy is
applied to, so zero applies it to none. The domain enforces exactly as much as
`p=none` while reading as the strictest setting available.

Staging a rollout through `pct` is the normal way to deploy DMARC, so the value
is not a mistake in itself. What makes it worth a finding of its own is that the
gap between the published policy and the enforced one is invisible in the one
field anybody checks. Reporting it as a percentage below one hundred, at the
same weight as `pct=50`, buries the one value where the policy stops existing.

Raises `DMARC008`.

Corrected by removing the `pct` tag so the policy applies to all of it.
