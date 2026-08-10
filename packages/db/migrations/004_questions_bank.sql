-- The question bank.
--
-- `reference_md` (the answer text) is stored here, but the Questions service
-- never sends it over HTTP (see repository.ts) — it's meant to stay hidden
-- until a future "reveal" flow confirms both users agreed to see it.
--
-- No `topic` column — filtering is entirely through `tags`. A question's
-- topic is just its first, most general tag (e.g. "os", "networking").

CREATE TABLE IF NOT EXISTS questions.bank (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  difficulty    text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),

  -- One prompt per part. Phase 4's Collab doc seeds one heading per entry, in
  -- array order.
  parts         jsonb NOT NULL,

  reference_md  text NOT NULL,

  tags          text[] NOT NULL DEFAULT '{}',

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_tags_idx ON questions.bank USING GIN (tags);
