# A plain text search and replace over serialized data

The single most common way a WordPress migration breaks. The replacement
changes the string and leaves the byte length in front of it, so the value no
longer unserializes and the application behaves as though the option had never
been set. Nothing errors, so it is found later, by a client.

The failing file holds three kinds of damage at once: rows where the length
prefix now disagrees with the string, a row still carrying the old domain, and
a serialized payload nested inside a serialized string, where a single pass
fixes the outer prefix and leaves the inner one wrong.

Raises `SER001`, `SER002`, `SER003` and `SER004`.

Corrected with `replaceInSerialized`, which walks the structure, recurses into
nested payloads and recomputes every prefix in bytes.
