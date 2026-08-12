-- What the Stats job writes, and what `GET /stats` reads back.
--
-- Delivery from the event log is at-least-once: a job that crashes after
-- processing an entry but before acknowledging it will be handed that entry
-- again. So every write here has to be safe to repeat, and the way that is
-- achieved is worth stating because it is the whole point of this schema.
--
-- **Rows keyed by a natural key, not counters.** A summary is keyed by its
-- session id and a signup by its user id, so reprocessing an event updates the
-- same row instead of adding a second one. A counter column would have been
-- the obvious shape and is exactly what cannot be made idempotent: `count =
-- count + 1` applied twice is wrong, and no amount of care at the call site
-- fixes it.
--
-- **Aggregates are computed on read, not maintained on write.** `GET /stats`
-- groups over these rows. That keeps the only writes idempotent by
-- construction, and at this size the grouping is free. The trade is that a
-- much larger bank would want materialised aggregates, and would then need a
-- processed-events table to make the increments safe.

CREATE TABLE IF NOT EXISTS stats.session_summaries (
  session_id  uuid PRIMARY KEY,
  question_id uuid NOT NULL,
  topic       text NOT NULL,
  difficulty  text NOT NULL,
  -- Both participants, so the job can answer "is this summary yours?" without
  -- reading matching's schema, which its role is not permitted to do (ADR-09).
  -- Compared against, never returned.
  participants text[] NOT NULL,
  -- How long the person who queued first waited to be matched. Carried on the
  -- event because only the queue knows it: the sorted set's score is the join
  -- time, and it is gone the moment the pair is claimed.
  waited_seconds numeric,
  started_at  timestamptz NOT NULL,
  -- When the first socket actually opened. Collab emits `session.started` every
  -- time a room is opened on an instance, so this arrives more than once for a
  -- session whose participants disconnect and return, and on both instances if
  -- they are on different ones. Kept as the *first* such moment via COALESCE,
  -- which makes the repeat a no-op. A matched pair with this still null never
  -- showed up, which is the one thing this event is worth recording.
  first_connected_at timestamptz,
  ended_at    timestamptz,
  revealed    boolean NOT NULL DEFAULT false
);

-- "Sessions per day" groups on this, and it is the only query that scans
-- rather than looks up.
CREATE INDEX IF NOT EXISTS session_summaries_started_idx
  ON stats.session_summaries (started_at);

CREATE TABLE IF NOT EXISTS stats.signups (
  user_id    text PRIMARY KEY,
  signed_up_at timestamptz NOT NULL
);

-- Queue joins have no natural key: the same user may join, wait, give up and
-- join again, and all of those are real. The log's own entry id is used
-- instead, which is unique and assigned by the log rather than the producer.
-- This is the second idempotency technique in the file, kept because the
-- choice between them is the interesting part.
CREATE TABLE IF NOT EXISTS stats.queue_joins (
  event_id   text PRIMARY KEY,
  user_id    text NOT NULL,
  topic      text NOT NULL,
  difficulty text NOT NULL,
  joined_at  timestamptz NOT NULL
);
