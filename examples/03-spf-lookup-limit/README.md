# SPF over the ten lookup limit, with no all mechanism and a ptr

Every include costs the lookups inside it, not one lookup. Four providers is
usually enough to pass ten, and past ten a receiver stops evaluating and
returns a permanent error, so the senders listed first stop passing too.

Raises `SPF003`, `SPF004` and `SPF006`.

Corrected by flattening the provider that publishes a stable address range,
dropping the deprecated `ptr`, and ending the record in `-all`.
