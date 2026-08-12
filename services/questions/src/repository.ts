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
 * The only function here that touches `reference_md`. Questions cannot check
 * who consented — it has no idea who is in a session — which is exactly why the
 * answer is released to Matching rather than to a browser (ADR-06).
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
 * Search matches the title or an exact tag, with a plain `ILIKE` rather than a
 * full-text index — the bank is 27 rows, so a `tsvector` would solve a problem
 * this dataset does not have.
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
    params.push(filters.q.toLowerCase());
    // Titles *or* tags. Searching titles alone made the finer tags
    // ("fork", "deadlock", "mvcc") dead weight — carried on every row, indexed,
    // and matched by nothing, since the only tag anything ever filtered on was
    // the topic. Now typing "deadlock" finds the synchronisation lesson whose
    // title never says it.
    //
    // Tags match a whole element, not a substring: they are lowercase single
    // words, so `@>` ("the tags contain this one") is both the right meaning
    // and the only form the GIN index on `tags` can serve. The equivalent
    // `$1 = ANY (tags)` reads more naturally and has no index path at all —
    // EXPLAIN picks a sequential scan even with seqscan priced absurdly high.
    conditions.push(`(title ILIKE $${params.length - 1} OR tags @> ARRAY[$${params.length}])`);
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

export interface RoadmapStep {
  id: string;
  step: number;
  title: string;
  questionCount: number;
}

export interface RoadmapTopic {
  topic: string;
  title: string;
  summary: string;
  dependsOn: string[];
  gridX: number;
  gridY: number;
  steps: RoadmapStep[];
}

/**
 * Everything the roadmap screen draws, in one query.
 *
 * The nine topics with their prerequisites and grid positions, each carrying
 * its three steps. It is one call rather than one per topic because the whole
 * thing is nine rows and twenty-seven children: paginating it would cost more
 * requests than it saves bytes, and the roadmap cannot render a partial graph
 * anyway, since a missing topic is a missing arrow.
 *
 * No lesson bodies. Those are about 400KB together and this screen shows none
 * of them.
 */
export async function getRoadmap(pool: pg.Pool): Promise<RoadmapTopic[]> {
  const { rows } = await pool.query<{
    topic: string;
    title: string;
    summary: string;
    depends_on: string[];
    grid_x: number;
    grid_y: number;
    steps: RoadmapStep[] | null;
  }>(`
    SELECT t.topic, t.title, t.summary, t.depends_on, t.grid_x, t.grid_y,
           (
             SELECT json_agg(json_build_object(
                      'id', b.id, 'step', b.step, 'title', b.title,
                      'questionCount', jsonb_array_length(b.parts)
                    ) ORDER BY b.step)
             FROM questions.bank b
             WHERE b.tags[1] = t.topic
           ) AS steps
    FROM questions.topics t
    ORDER BY t.grid_y, t.grid_x
  `);

  return rows.map((r) => ({
    topic: r.topic,
    title: r.title,
    summary: r.summary,
    dependsOn: r.depends_on,
    gridX: r.grid_x,
    gridY: r.grid_y,
    steps: r.steps ?? [],
  }));
}

export interface Step {
  id: string;
  topic: string;
  topicTitle: string;
  step: number;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  parts: string[];
  lessonMd: string;
  /** The other steps in this topic, so the page can offer them without a
   * second request and without sending the reader back to the roadmap. */
  siblings: { id: string; step: number; title: string }[];
}

/**
 * One step in full: its lesson, its questions, and the way on to its siblings.
 *
 * Everything the step page needs, so opening one is a single request. Still no
 * `reference_md`: the answer is a separate call that checks who is asking.
 */
export async function getStep(pool: pg.Pool, id: string): Promise<Step | null> {
  const { rows } = await pool.query<{
    id: string;
    topic: string;
    topic_title: string;
    step: number;
    title: string;
    difficulty: string;
    parts: string[];
    lesson_md: string;
    siblings: { id: string; step: number; title: string }[] | null;
  }>(
    `SELECT b.id, b.tags[1] AS topic, t.title AS topic_title, b.step, b.title,
            b.difficulty, b.parts, b.lesson_md,
            (
              SELECT json_agg(json_build_object('id', s.id, 'step', s.step, 'title', s.title)
                     ORDER BY s.step)
              FROM questions.bank s
              WHERE s.tags[1] = b.tags[1]
            ) AS siblings
     FROM questions.bank b
     JOIN questions.topics t ON t.topic = b.tags[1]
     WHERE b.id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    topic: row.topic,
    topicTitle: row.topic_title,
    step: row.step,
    title: row.title,
    difficulty: row.difficulty as Step['difficulty'],
    parts: row.parts,
    lessonMd: row.lesson_md,
    siblings: row.siblings ?? [],
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
