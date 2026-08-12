# ADR-07 — A replayable event log for summaries and stats

**Decision:** domain events go to a Redis Stream, read by a consumer group,
behind an `EventLog` interface with three methods.

**Why a log and not a queue:** a queue deletes on consume, so a bug in the
summary logic means the data needed to recompute it is gone. A log keeps entries
after they are read, so fixing the bug is rewinding a bookmark, and a consumer
added later still sees history.

**Rejected:** a Postgres `events` table, which is perfectly viable at this size
and was turned down for the cleaner scale-up path. Kafka, which needs an
always-on broker for one stream of a few events a minute — **nothing here runs
one**; a Kafka adapter behind the same interface is in the backlog and is not
built, and keeping the interface to three methods is what would make it the only
thing that changes.

**Not this:** live Yjs sync stays on Redis pub/sub. Latency-critical fanout is
the wrong shape for a log that is drained on a schedule.

See [`../system/06-events-and-stats.md`](../system/06-events-and-stats.md).
