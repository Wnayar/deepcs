# ADR-10 — `pg` and hand-written SQL now, an ORM deferred rather than rejected

**Decision:** the `pg` driver with parameterized SQL, and migrations as numbered
`.sql` files run by a small script.

**Why:** parameterized queries are required anyway; it keeps
[ADR-09](09-one-database-one-schema-per-service.md)'s per-schema `GRANT` and
`REVOKE` as literal SQL rather than something generated; and it adds no
schema-definition language to learn.

**Rejected *for now*, not on merit: Drizzle**, which would derive types from a
schema definition and remove the hand-written result types that are this
decision's real cost.

**Tradeoffs accepted:** query result types are written by hand and can drift
from the schema, and there is no generated migration diffing.

**This is the highest-priority item in the additive backlog**, because it is the
only deferred item that pays down a cost incurred by every further table rather
than adding a new capability. It is also cheap to adopt: Drizzle wraps a `pg`
pool, so it can be introduced one service at a time with no rewrite and no data
migration. It should not be introduced ad hoc.
