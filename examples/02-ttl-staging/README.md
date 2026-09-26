# TTL lowered too late to take effect

Lowering a TTL only takes effect once the previously cached longer TTL has
expired. Lowering it an hour before a cutover that was advertised at one day
changes nothing, and the rollback window is still a day wide.

Raises `TTL001`, `TTL002` and `TTL004`.

Corrected by lowering the TTL more than one old TTL before the cutover, and by
bringing the SOA negative caching TTL down with it so a name queried a moment
early does not stay missing.
