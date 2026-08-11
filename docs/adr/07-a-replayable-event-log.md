# A replayable event log for summaries/stats

(Redis Streams in prod, Kafka
in dev) — log over queue semantics, so consumed events stay readable: rewind
the bookmark to recompute after a bug, or add a consumer later and it still
sees history. Considered: a Postgres events table (viable at this scale —
rejected for the cleaner scale-up path and the learning value) and real Kafka
in prod (no free managed option; an always-on broker breaks §7). Live Yjs sync
stays on Redis pub/sub — latency-critical fanout is the wrong shape for a
polled log.
