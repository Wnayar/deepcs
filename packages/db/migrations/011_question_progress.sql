-- What a reader has finished, and what they have starred (the overview §5,
-- Users).
--
-- Owned by Users rather than Questions, because it is state about a *person*.
-- Questions has no idea users exist, and a query joining the two would cross a
-- schema boundary the database refuses (ADR-09). The roadmap screen therefore
-- fetches both and merges them in the browser, which is the visible cost of
-- that boundary and a cheap one: two requests that do not depend on each other.
--
-- `question_id` is a `questions.bank` row — what the roadmap presents as a
-- "step" is one bank row with a `step` number. It is stored as a plain uuid
-- with no foreign key, the same as `matching.sessions.question_id`, because a
-- foreign key there would cross schemas. A deleted question leaves rows here
-- pointing at nothing, which is harmless: the roadmap decides which steps
-- exist, and progress for one it does not list is never read.

CREATE TABLE IF NOT EXISTS users.question_progress (
  -- The Firebase uid, the join key for the whole system (003_users_profiles).
  -- This foreign key is allowed where the others are not, because it stays
  -- inside the `users` schema: progress cannot exist for somebody who never
  -- signed in, and deleting a profile takes their progress with it.
  uid         text NOT NULL REFERENCES users.profiles (firebase_uid) ON DELETE CASCADE,

  question_id uuid NOT NULL,

  -- Two independent flags rather than one status column, because starring
  -- something you have *not* done yet is most of the point of starring it.
  done        boolean NOT NULL DEFAULT false,
  starred     boolean NOT NULL DEFAULT false,

  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- The composite key is what makes the write an upsert: one row per person per
  -- question, so ticking a box twice lands on the same row instead of stacking
  -- up a history nobody asked for. It is also what makes the route idempotent,
  -- which matters because the browser fires it on every click without waiting.
  PRIMARY KEY (uid, question_id)
);

-- Every read is "everything for one person", which the primary key already
-- serves as its leading column. No second index is needed and none is added.

-- No GRANT here: 002_service_roles.sql set ALTER DEFAULT PRIVILEGES on the
-- `users` schema, so `users_svc` already holds SELECT/INSERT/UPDATE/DELETE on
-- tables created in it afterwards.
