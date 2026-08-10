-- Matched sessions.
--
-- No foreign key crosses a schema (ADR-09): `user_a_uid`/`user_b_uid` and
-- `question_id` are plain columns, not FKs into `users.profiles` or
-- `questions.bank`. They're validated by an HTTP call at creation time
-- instead (see clients.ts) — a cross-schema FK would re-couple services that
-- are supposed to be independently deployable.

CREATE TABLE IF NOT EXISTS matching.sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_uid    text NOT NULL,
  user_b_uid    text NOT NULL,
  question_id   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A session lookup by uid needs "does this user appear as either side of any
-- session" — one index per side covers both.
CREATE INDEX IF NOT EXISTS sessions_user_a_idx ON matching.sessions (user_a_uid);
CREATE INDEX IF NOT EXISTS sessions_user_b_idx ON matching.sessions (user_b_uid);
