import type pg from 'pg';

export interface QuestionSummary {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  parts: string[];
  tags: string[];
  createdAt: Date;
}

export interface ListFilters {
  tags?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  q?: string;
  cursor?: string;
  limit: number;
}

export interface ListResult {
  items: QuestionSummary[];
  nextCursor: string | null;
}

/**
 * The columns every public query selects. `reference_md` (the answer text)
 * is deliberately left out — it stays hidden until the reveal flow confirms
 * both users agreed to see it. Leaving it out of the query, instead of
 * stripping it from the response later, means there's no field a route
 * handler could ever forget to remove.
 */
const SUMMARY_COLUMNS = 'id, title, difficulty, parts, tags, created_at';

/**
 * Reads a question's answer text — e.g.
 *   getReferenceMd(pool, '3f2e1c9a-...')
 * returns the markdown, or `null` if the id doesn't exist.
 *
 * The only function in this service that touches `reference_md`, and its one
 * caller is the internal route Matching uses after it has verified both
 * participants consented (ADR-06). Questions cannot make that check itself —
 * it has no idea who is in a session — which is exactly why the answer is
 * released to Matching rather than to a browser.
 */
export async function getReferenceMd(pool: pg.Pool, id: string): Promise<string | null> {
  const { rows } = await pool.query<{ reference_md: string }>(
    'SELECT reference_md FROM questions.bank WHERE id = $1',
    [id],
  );
  return rows[0]?.reference_md ?? null;
}

/**
 * Lists questions, applying whichever filters are present, then returns one
 * page plus a cursor for the next one.
 *
 * Pagination remembers the last id seen instead of a page number/offset:
 * `WHERE id > $cursor ORDER BY id LIMIT n`. That avoids two `OFFSET`
 * problems — reading and throwing away rows just to skip them, and
 * skipping or repeating a row if the bank changes mid-pagination.
 *
 * Search is a plain `ILIKE` on the title, not a full-text index — the bank
 * is only 15 rows, so a fancier index would solve a problem this dataset
 * doesn't have yet.
 */
export async function listQuestions(pool: pg.Pool, filters: ListFilters): Promise<ListResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.tags && filters.tags.length > 0) {
    params.push(filters.tags);
    // `&&` means "share at least one tag", not "match exactly" — e.g. a row
    // tagged {os, memory} matches a request for tags=[memory, databases].
    conditions.push(`tags && $${params.length}::text[]`);
  }
  if (filters.difficulty) {
    params.push(filters.difficulty);
    conditions.push(`difficulty = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }
  if (filters.cursor) {
    params.push(filters.cursor);
    // `cursor` is the last id from the previous page, so this keeps only
    // rows that sort after it — e.g. cursor="abc" skips straight past "abc".
    conditions.push(`id > $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Fetch one extra row to learn whether a next page exists, without a
  // separate COUNT query.
  params.push(filters.limit + 1);

  const { rows } = await pool.query<QuestionRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM questions.bank ${where} ORDER BY id LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;

  return {
    items: page.map(toSummary),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** Fetches one question by id, or `null` if no row has that id. */
export async function getQuestion(pool: pg.Pool, id: string): Promise<QuestionSummary | null> {
  const { rows } = await pool.query<QuestionRow>(
    `SELECT ${SUMMARY_COLUMNS} FROM questions.bank WHERE id = $1`,
    [id],
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

interface QuestionRow {
  id: string;
  title: string;
  difficulty: string;
  parts: string[];
  tags: string[];
  created_at: Date;
}

function toSummary(row: QuestionRow): QuestionSummary {
  return {
    id: row.id,
    title: row.title,
    difficulty: row.difficulty as QuestionSummary['difficulty'],
    parts: row.parts,
    tags: row.tags,
    createdAt: row.created_at,
  };
}
