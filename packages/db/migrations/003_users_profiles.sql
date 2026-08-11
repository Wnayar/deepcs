-- The profile row (the overview §5, Users).
--
-- `firebase_uid` is the join key for the entire system, and it is deliberately
-- opaque: ADR-04 accepts vendor lock-in on identity precisely because the app
-- keys off this string rather than off anything Firebase-shaped, which makes a
-- provider migration a re-registration flow instead of a rewrite.
--
-- No foreign key in this file points outside the `users` schema, and none ever
-- will (ADR-09). Other services store `firebase_uid` as a plain column and
-- validate it by calling GET /users/:uid/exists.

CREATE TABLE IF NOT EXISTS users.profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE is load-bearing, not decorative: it is what ON CONFLICT keys on in
  -- the lazy upsert, and therefore what makes "first sight of this UID"
  -- detectable at all. Without it the upsert has nothing to conflict against
  -- and every sign-in inserts a duplicate row.
  firebase_uid  text NOT NULL UNIQUE,

  -- App-owned data Firebase knows nothing about (§5). Nullable: the lazy upsert
  -- creates the row from a token alone, before the user has told us anything.
  display_name  text,
  preferred_topics text[] NOT NULL DEFAULT '{}',

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- gen_random_uuid() is built in from Postgres 13 — no pgcrypto extension
-- needed, which matters because Neon's free tier restricts which extensions
-- can be installed.
