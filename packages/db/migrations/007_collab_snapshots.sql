-- Yjs document snapshots, one row per session.
--
-- `session_id` is a plain column, not an FK into `matching.sessions`
-- (ADR-09) — same reasoning as `matching.sessions.question_id`: it's
-- validated by an HTTP call to Matching (see clients.ts), not a
-- cross-schema constraint. `state` is the binary output of
-- `Y.encodeStateAsUpdate(doc)`; a snapshot is written every 30s, on
-- disconnect, and before SIGTERM, and read back on reconnect.

CREATE TABLE IF NOT EXISTS collab.snapshots (
  session_id  uuid PRIMARY KEY,
  state       bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
