# Phase 6 — The event log, and making at-least-once behave like exactly-once

Six moments in the product now append to a log. A scheduled job drains it into
summaries and aggregates, and `GET /stats` and `GET /sessions/:id/summary` read
those back.

The feature is small. The reason it is worth building is one property, and
everything here is shaped by it: **delivery is at-least-once**, so the consumer
has to turn a repeated event into a repeated write and not a repeated row.

---

# The four things — read this page, then stop if you're short on time

## 1. Acknowledge after the commit, never before · ~5 min

The job reads a batch, applies it, then acks. That order is the whole safety
argument, and reversing it looks harmless:

```
read → apply → ack        a crash anywhere means the batch comes back
read → ack → apply        a crash after the ack means the batch is gone
```

An acked entry is never redelivered. So acking first converts a crash into
silent, permanent loss, and acking last converts it into a repeat. A repeat is
survivable; that is what the rest of this page is about.

The batch is also one transaction, and not for atomicity across events, which
the log already orders. It is so a failure halfway through leaves nothing
behind: those entries are still unacked, so they come back, and they come back
to a database that looks exactly as it did before.

## 2. Idempotency is per event, and there are two ways to get it · ~10 min

This is the part worth reading `consumer.ts` for. The choice is not one
technique applied everywhere:

**A natural key**, where the event names something that exists once. A session
id, a user id. `ON CONFLICT (session_id) DO UPDATE` writes the same row again
instead of a second one.

**The log's own entry id**, where it does not. A user may join the queue, give
up, and join again, and *both of those are real*. Deduplicating on
`(user_id, topic)` would delete a fact. There is nothing in the payload to key
on, so `stats.queue_joins` is keyed by the id Redis assigned, which is unique
and is not the producer's to get wrong.

A test pins the distinction directly: the same payload with two different entry
ids must produce two rows, and the same entry id twice must produce one.

**And what is absent: counters.** `count = count + 1` applied twice is wrong,
and no amount of care at the call site fixes it. So `/stats` groups over the
rows on read rather than maintaining totals on write. At this size the grouping
is free; a much larger bank would want materialised aggregates and would then
need a processed-events table to make the increments safe. That trade is the
thing to notice, not the query.

## 3. The design said Stats could not be a server. It was half right · ~5 min

DESIGN.md §3 said Stats "can't be a server at all", §2 and §6 both put a public
stats endpoint in scope, and ADR-09 says only `stats_svc` may read the `stats`
schema. All three cannot hold, and building the phase is what surfaced it.

The §3 argument is correct about what it argues: a timer cannot fire inside a
service that has scaled to zero, so *draining the log* has to be a job. The
conclusion overreaches. Serving a summary is request-driven like every other
read and scales to zero perfectly well.

So Stats is one image with two entrypoints: `index.ts` drains and exits,
`server.ts` answers reads. On the cluster that is the same image run twice,
once as a job and once as a service. The job stays the image default, so CI's
existing smoke test keeps meaning what it meant.

## 4. The wait was measurable for exactly one instant · ~3 min

"Median match wait" is one of the three aggregates §5 names, and it was very
nearly impossible to produce.

The queue is a Redis sorted set whose score is the join time. The Lua claim
script removes the waiting member, and at that moment the score is gone: no row
anywhere records when somebody started waiting, because until now nothing
needed it. Recomputing it afterwards is not possible even in principle.

So the script returns it alongside the partner, and `match.created` carries it.
The general shape is worth keeping: when a value exists only inside an atomic
operation, it leaves with the result of that operation or it does not leave.

---

# Read the code in this order

| File | Why |
|---|---|
| `packages/shared/src/events.ts` | The `EventLog` interface and the Redis Streams adapter. |
| `services/stats/src/consumer.ts` | Both idempotency techniques, one per event. |
| `services/stats/src/index.ts` | The drain loop, and the ack ordering. |
| `services/stats/src/repository.ts` | Aggregates computed on read; the membership test inside the query. |
| `packages/db/migrations/010_stats.sql` | The tables, and why none of them is a counter. |
| `services/stats/src/consumer.test.ts` | The property, stated seven ways. |

---

# Part 1 — Why the interface has three methods

`append`, `readBatch`, `ack`. Those are what Redis Streams and Kafka genuinely
share, and phase 9 adds a Kafka adapter behind the same surface for development
only. Keeping it this small is what makes the adapter the only thing that
changes.

One stream, not one per type. Ordering across types is the point: a
`session.ended` that overtook its own `match.created` would be a summary for a
session the consumer has never heard of.

`emitEvent` swallows failures and warns. A user who signed up has signed up
whether or not the log accepted the entry, and failing their request because a
statistics pipeline is unavailable trades something that matters for something
that does not.

---

# Part 2 — Two things about the summary route

**Participants only, checked inside the query.** `WHERE session_id = $1 AND $2 =
ANY (participants)` rather than fetching the row and comparing afterwards, so
there is no arrangement of this code where the row is loaded and the check is
forgotten.

**404, not 403, for a non-participant.** A 403 confirms the session exists.
There is nothing here worth telling a stranger about somebody else's session,
not even that it happened.

The participant uids are stored because membership cannot be checked without
them, and are never returned. The test asserts that against the serialised
summary rather than named fields, for the same reason the matching tests do: a
session is anonymous everywhere else, and a summary is not where that stops
being true.

---

# Part 3 — What this phase deliberately did not build

- **No dead-letter path.** A malformed event throws, rolls its batch back, and
  is redelivered. That is right for a bad producer that gets rolled back, and
  wrong for an entry that is permanently unparseable: nothing moves it aside, so
  it would be retried for ever. The fix is a poison counter and a side table,
  and it is not here.
- **No claiming of another consumer's abandoned work.** `readBatch` asks for
  entries never delivered to the group. Entries delivered to a consumer that
  then died stay in that consumer's pending list until it runs again. With one
  consumer that is exactly right; a second would need `XAUTOCLAIM` and a policy
  for how long is too long.
- **No stream trimming.** The log grows for ever. That is the point for now, and
  a retention policy is a decision about how far back replay should reach.
- **No frontend for `/stats`.** The endpoint is real; nothing renders it.

---

# Part 4 — Demonstrating the claims

## Claim 1 — replaying the whole log changes nothing

This is the phase, in one command. Rewinding the consumer group to the start
redelivers every event ever emitted, which is both ADR-07's replay promise and
the idempotency property:

```bash
# Drain first. Without this the counts move for an uninteresting reason: the
# rewind would process events that had never been processed at all, and the
# rise would be catch-up rather than duplication. Written the wrong way round
# the first time, and running it is what showed that.
docker compose run --rm stats

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT count(*) FROM stats.session_summaries"

docker compose exec redis redis-cli XGROUP SETID events stats 0
docker compose run --rm stats          # drained: N, every event ever emitted

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT count(*) FROM stats.session_summaries"   # the same number
```

## Claim 2 — the property, in tests

```bash
pnpm --filter @deepcs/stats test
```

Seven tests, against real Postgres: the same batch twice leaves one summary;
three signups leave one row; two *different* queue joins by the same user leave
two rows while a repeat of one leaves one; `session.started` keeps the first
connection time and not the latest; a malformed event rolls its whole batch
back.

## Claim 3 — the aggregates are real

```bash
curl -s http://localhost:8080/stats | python3 -m json.tool
```

`medianWaitSeconds` is the number from thing 4. Run the flow with a pause
between the two joins and it moves.

## Claim 4 — a summary is a participant's

```bash
curl -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $PARTICIPANT" \
  http://localhost:8080/sessions/$SID/summary     # 200
curl -o /dev/null -w '%{http_code}\n' -H "authorization: Bearer $OUTSIDER" \
  http://localhost:8080/sessions/$SID/summary     # 404, not 403
curl -o /dev/null -w '%{http_code}\n' \
  http://localhost:8080/sessions/$SID/summary     # 401
```
