-- The question bank (DESIGN.md §Questions).
--
-- `reference_md` is stored here but this service never serves it over HTTP
-- (see services/questions/src/repository.ts) — it is released only to
-- Matching, over the internal network, once Matching has verified consent
-- (ADR-06, phase 3). Questions has no way to know who consented, so the
-- column is simply never selected on the public read path.
--
-- Filtering is by `tags`, not a separate `topic` column — DESIGN.md's row
-- shape lists parts[], reference_md, tags text[] (GIN-indexed), difficulty,
-- with no topic field of its own. A question's topic is just its first tag.

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
