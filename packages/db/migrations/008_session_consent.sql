-- Consent and end-of-life for a session.
--
-- Both columns land on the existing row rather than in tables of their own.
-- `reveal_consents` could be a `session_consents` join table, but a session has
-- exactly two participants and always will (the overview scopes out group
-- sessions), so the join table would buy normalisation nobody ever reads. An
-- array of uids is the whole state: empty, one uid, or both.
--
-- `ended_at` is nullable rather than a `status` column with a default — "not
-- ended" is the absence of an end time, not a separate state to keep in sync,
-- and it doubles as the timestamp a summary needs.
--
-- No GRANT here: 002_service_roles.sql set ALTER DEFAULT PRIVILEGES on the
-- `matching` schema, so `matching_svc` picks these up automatically.

ALTER TABLE matching.sessions
  ADD COLUMN IF NOT EXISTS reveal_consents text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ended_at        timestamptz;

-- `/match/join` asks "is this user already in a session?" before touching the
-- queue, and from here on that question means *unended* sessions only. Without
-- this index that check reads every session a user has ever had; with it,
-- Postgres jumps straight to the live one.
CREATE INDEX IF NOT EXISTS sessions_user_a_active_idx
  ON matching.sessions (user_a_uid) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_user_b_active_idx
  ON matching.sessions (user_b_uid) WHERE ended_at IS NULL;
