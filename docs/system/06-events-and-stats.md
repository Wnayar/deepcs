# Events and Stats

Six moments in the product append to a log. A scheduled job drains it into
summaries and aggregates, and two routes read those back.

The feature is small. The reason it is worth building is one property, and
everything here is shaped by it: **delivery is at-least-once**, so the consumer
has to turn a repeated event into a repeated *write* and not a repeated *row*.

Code: [`packages/shared/src/events.ts`](../../packages/shared/src/events.ts) (the
interface and the Redis Streams adapter) and
[`services/stats/src/`](../../services/stats/src/) — `consumer.ts`, `index.ts`
(the job), `server.ts` (the reads), `repository.ts`.

---

## 1. The six events, and who emits each

| Event | Emitted by | On |
|---|---|---|
| `user.signed_up` | Users | the insert that created the profile row |
| `queue.joined` | Matching | a join that found nobody waiting |
| `match.created` | Matching | a claim that found a partner |
| `session.started` | Collab | a room opening on an instance |
| `reveal.consented` | Matching | either participant agreeing |
| `session.ended` | Matching | the end route |

Named after what happened, in the past tense, because an event is a record of a
fact and not an instruction to do something.

**One stream, not one per type.** Ordering across types is the point: a
`session.ended` that overtook its own `match.created` would be a summary for a
session the consumer has never heard of. `match.created` is the only event that
*inserts* a summary row; every other one updates it.

**Payloads are flat and string-valued.** Redis Streams entries are field/value
pairs, so anything nested would have to be JSON in one field. Keeping them flat
means an entry is readable with `XRANGE` from a shell.

### Adding a seventh

Three places, and missing any one of them is a silent gap: the `EventType` union
in `events.ts`, the `switch` in `consumer.ts`, and a table keyed so that
reprocessing the event changes nothing (§4).

---

## 2. `emitEvent` cannot fail a user's request

```ts
try { await log.append(type, data); }
catch (err) { logger.warn({ err, event_type: type }, 'event not recorded'); }
```

Fire-and-forget on purpose. A user who signed up has signed up whether or not the
log accepted the entry, and failing their request because a statistics pipeline
is unavailable trades something that matters for something that does not.

The cost of a dropped entry is a summary that undercounts, which is why it is
warned about rather than swallowed silently. It is also why Redis is not part of
readiness on Users: the only thing Users needs Redis for is this
([`02-users.md`](02-users.md) §5).

**Events go through this interface, never a log line.** A log line is not
replayable, is not ordered against anything else, and has no bookmark.

---

## 3. Why the interface has exactly three methods

`append`, `readBatch`, `ack`. Those are what Redis Streams and Kafka genuinely
share, and keeping the surface this small is what would make a second adapter the
only thing that changes.

*Why a log and not a queue?* A queue deletes on consume, so a bug in the summary
logic means the data needed to recompute it is gone. A log keeps entries after
they are read, so the fix is rewinding a bookmark
([`../adr/07-a-replayable-event-log.md`](../adr/07-a-replayable-event-log.md)).
That property is the reason this is worth building at all.

A **consumer group** is what gives Redis a server-side bookmark and a per-consumer
pending list, which is what makes redelivery after a crash possible rather than
silent loss. Creating it is idempotent and has to happen before the first read;
`MKSTREAM` covers a fresh database where the stream does not exist yet, and
`BUSYGROUP` means somebody already did it, which is success rather than an error.

`readBatch` asks for `>`, meaning entries never delivered to this group. Entries
that were delivered but never acked are deliberately *not* read: claiming another
consumer's abandoned work needs `XAUTOCLAIM` and a policy for how long is too
long, and with one consumer that is exactly right.

---

## 4. Acknowledge after the commit, never before

```
read → apply → ack        a crash anywhere means the batch comes back
read → ack → apply        a crash after the ack means the batch is gone
```

An acked entry is never redelivered. So acking first converts a crash into
silent, permanent loss, and acking last converts it into a repeat. A repeat is
survivable, and everything below is what makes it survivable.

**The batch is one transaction**, and not for atomicity across events, which the
log already orders. It is so a failure halfway through leaves nothing behind:
those entries are still unacked, so they come back, and they come back to a
database that looks exactly as it did before. Without it, redelivery would replay
events on top of half-applied ones, which is a situation the idempotency below
happens to survive and should not have to.

### Idempotency is per event, and there are two ways to get it

**A natural key**, where the event names something that exists once: a session
id, a user id. `ON CONFLICT (session_id) DO UPDATE` writes the same row again
instead of a second one.

**The log's own entry id**, where it does not. A user may join the queue, give up
and join again, and *both of those are real* — deduplicating on
`(user_id, topic)` would delete a fact. There is nothing in the payload to key
on, so `stats.queue_joins` is keyed by the id Redis assigned, which is unique and
is not the producer's to get wrong.

A test pins the distinction directly: the same payload with two different entry
ids must produce two rows, and the same entry id twice must produce one.

Two events are idempotent for their own reasons. `session.started` arrives once
per *room opened*, not once per session — participants who disconnect and return
open it again, and two instances open it separately — so `COALESCE` keeps the
first connection time and makes every repeat a no-op. `reveal.consented` fires
twice when both people consent, and setting a flag to true twice is the cheapest
kind of idempotent there is.

### And what is absent: counters

`count = count + 1` applied twice is wrong, and no amount of care at the call
site fixes it. So there is no counter column anywhere, and `GET /stats` groups
over the rows on read.

At this size the grouping is free. A much larger bank would want materialised
aggregates and would then need a processed-events table to make the increments
safe. That trade is the thing to notice, not the query.

### A missing field is a bug, not a data condition

`need(field)` throws with the entry id rather than writing a row with a hole in
it. The batch then rolls back and the entries stay unacknowledged, which is right
for a deploy that shipped a bad producer and is retried once it is rolled back.

The limitation that buys, stated rather than hidden: **a permanently unparseable
entry is retried for ever**, because nothing moves it aside. A dead-letter path is
a poison counter and a side table, and it is not built.

---

## 5. Stats is a job *and* a server, and the design said otherwise

[`00-overview.md`](00-overview.md) §3 says Stats "can't be a server at all", the
same document puts a public stats endpoint in scope, and the schema decision says
only `stats_svc` may read the `stats` schema. All three cannot hold, and building
it is what surfaced the contradiction.

**The §3 argument is correct about what it argues.** A timer cannot fire inside a
service that is not running between requests, so *draining the log* has to be a
job. The conclusion overreaches: serving a summary is request-driven like every
other read.

So Stats is one image with two entrypoints. `index.ts` drains and exits;
`server.ts` answers reads. Under compose that is `docker compose run --rm stats`
and a long-running `stats-api` container; on the cluster it is the same image run
twice, once as a CronJob and once as a Deployment. The job stays the image
default, so CI's smoke test keeps meaning what it meant.

**The job's exit code is the entire contract**: 0 means the run succeeded,
anything else marks it failed and retryable.

`BATCH` is 200 — small enough that a crash re-does little work, large enough that
a backlog drains in a few round trips. `MAX_BATCHES` is 50, and it is a backstop
rather than a target: the job is meant to reach an empty log and stop, and this
only bounds the damage if something is appending faster than it reads, so a run
cannot quietly become the always-on consumer.

The job turns its offline queue back on, because its first Redis command is
issued immediately with no request to have waited behind, so it would otherwise
race its own connect and fail on a socket milliseconds from ready.

Worst case a summary lands a few minutes after the session ends.

---

## 6. The two read routes

```
GET /stats                      public aggregates
GET /sessions/:id/summary       participants only
```

**`/stats` is unauthenticated, deliberately.** These are counts of activity with
nobody named in them, and an empty stats page is what a first-time visitor would
otherwise be shown. It returns totals, sessions per day, the most-solved topics
and `medianWaitSeconds`.

Four queries rather than one, because they group differently and combining them
would mean either a lateral join per shape or counting distinct ids inside a
cross product. At this size four round trips is nothing, and each query says
plainly what it counts. `percentile_cont` is an interpolated median: with an even
number of waits it returns the midpoint rather than picking one, and the median
rather than the mean because one person who queued and went to lunch would
otherwise be the headline number.

**The summary check is inside the query**, not after it:

```sql
WHERE session_id = $1 AND $2 = ANY (participants)
```

There is no arrangement of this code where the row is loaded and the check is
forgotten. `participants` is compared against and never selected: the caller
already knows they are in the session, and the other person's uid is not theirs
to be told — the same rule the whole matching flow follows
([`04-matching.md`](04-matching.md) §9), and a test asserts it against the
serialised summary rather than named fields.

**404, not 403, for a non-participant.** A 403 confirms the session exists, and
there is nothing here worth telling a stranger about somebody else's session, not
even that it happened.

Stats stores both uids because membership cannot be checked without them, and it
cannot ask Matching who was in a session: its role may not read that schema. The
event is how the fact arrived, which is one of the quieter arguments for a log.

---

## 7. Replay, and how to see it

Rewinding the consumer group to the start redelivers every event ever emitted,
which is both the replay promise and the idempotency property in one command:

```bash
# Drain first. Without this the counts move for an uninteresting reason: the
# rewind would process events that had never been processed at all, and the
# rise would be catch-up rather than duplication.
docker compose run --rm stats

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT count(*) FROM stats.session_summaries"

docker compose exec redis redis-cli XGROUP SETID events stats 0
docker compose run --rm stats          # drained: every event ever emitted

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT count(*) FROM stats.session_summaries"   # the same number
```

That drain-first ordering was written the wrong way round the first time, and
running it is what showed why it matters.

---

## 8. Known gaps

- **No dead-letter path.** §4.
- **No claiming of an abandoned pending list.** §3. A second consumer would need
  `XAUTOCLAIM` and a staleness policy.
- **No stream trimming.** The log grows for ever, which is the point for now; a
  retention policy is a decision about how far back replay should reach.
- **Nothing renders `/stats`.** The endpoint is real and no screen shows it.
- **A load run pollutes the aggregates.** `make load` leaves 250 users and 125
  ended sessions behind, so the next drain puts them in `/stats`. A prefix to
  exclude (`k6-`) exists in the uid; using it does not.
