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
 * `reference_md` is never in this list — DESIGN.md §Questions: it's released
 * only to Matching, over the internal network, after Matching has verified
 * consent (ADR-06, phase 3). Not selecting it here is what makes "never served
 * to a browser" true rather than merely intended: there's no field to forget to
 * strip in the route handler.
 */
const SUMMARY_COLUMNS = 'id, title, difficulty, parts, tags, created_at';

/**
 * List / filter / search / cursor-paginate (DESIGN.md §Questions).
 *
 * Cursor over offset: `WHERE id > $last ORDER BY id LIMIT n` reads and
 * discards nothing, and doesn't duplicate or skip rows if the bank changes
 * between pages the way `OFFSET` does.
 *
 * Filtering is by `tags` (array overlap — DESIGN.md's row shape has no
 * separate `topic` column) and `difficulty`; search is a plain `ILIKE` on
 * title. The bank is small and read-heavy, not write-heavy, so a full
 * full-text index would be solving a problem this dataset doesn't have.
 */
export async function listQuestions(pool: pg.Pool, filters: ListFilters): Promise<ListResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.tags && filters.tags.length > 0) {
    params.push(filters.tags);
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
