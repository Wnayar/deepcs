import type pg from 'pg';

export interface Profile {
  id: string;
  firebaseUid: string;
  displayName: string | null;
  preferredTopics: string[];
  createdAt: Date;
}

export interface UpsertResult {
  profile: Profile;
  /**
   * True only when this call was the one that created the row.
   *
   * This is the entire reason the upsert is written the way it is. There is no
   * signup endpoint anywhere in this system, so this flag is the only place
   * `user.signed_up` can be emitted from. Get it wrong and the event fires on
   * every sign-in and the sign-up count in /stats is a request counter.
   */
  created: boolean;
}

/**
 * The lazy upsert, run by `GET /users/me`.
 *
 * The `RETURNING` is load-bearing: `ON CONFLICT ... DO NOTHING` returns **no
 * row** when the uid already existed, so an empty result is proof this was not
 * a first sight — which is what makes `created` trustworthy.
 *
 * `DO NOTHING` rather than `DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid`:
 * the update form returns a row every time, destroying the signal, and takes a
 * row lock on every sign-in for no reason.
 */
export async function upsertProfile(
  pool: pg.Pool,
  firebaseUid: string,
  /**
   * Only ever used by the insert. `DO NOTHING` means a later call carrying a
   * different name changes nothing, so "set once at sign-up and not editable"
   * is enforced by the statement rather than by a rule somebody has to
   * remember. Giving it a write path later means adding one, deliberately.
   */
  displayName: string | null = null,
): Promise<UpsertResult> {
  const inserted = await pool.query<ProfileRow>(
    `INSERT INTO users.profiles (firebase_uid, display_name)
     VALUES ($1, $2)
     ON CONFLICT (firebase_uid) DO NOTHING
     RETURNING id, firebase_uid, display_name, preferred_topics, created_at`,
    [firebaseUid, displayName],
  );

  if (inserted.rows.length === 1) {
    return { profile: toProfile(inserted.rows[0]!), created: true };
  }

  /**
   * The row existed. A second query rather than one clever statement: this is
   * the common path and a lookup on a unique index, so the cost is one round
   * trip, and the alternative (a CTE, or DO UPDATE) buys that round trip back
   * by destroying the `created` signal above.
   */
  const existing = await pool.query<ProfileRow>(
    `SELECT id, firebase_uid, display_name, preferred_topics, created_at
     FROM users.profiles
     WHERE firebase_uid = $1`,
    [firebaseUid],
  );

  const row = existing.rows[0];
  if (!row) {
    // Reachable only if the row was deleted between the two statements.
    // Surfacing it keeps "deleted mid-request" from looking like "never
    // existed".
    throw new Error(`profile for ${firebaseUid} vanished between insert and select`);
  }

  return { profile: toProfile(row), created: false };
}

/** One reader's mark on one roadmap step. `questionId` is a `questions.bank`
 * row, which is what the roadmap draws as a step. */
export interface QuestionProgress {
  questionId: string;
  done: boolean;
  starred: boolean;
}

/**
 * Everything this reader has marked, in one query.
 *
 * The whole set rather than a page of it: the roadmap draws ten topics and
 * thirty steps at once and cannot render a partial graph, so paginating
 * would cost more requests than it saves bytes. Same reasoning as the roadmap
 * query it is merged with in the browser.
 *
 * Rows with both flags false are returned rather than filtered out. They are
 * what a tick followed by an untick leaves behind, and hiding them here would
 * only move the "is it absent or is it false?" question to the caller.
 */
export async function readProgress(pool: pg.Pool, uid: string): Promise<QuestionProgress[]> {
  const { rows } = await pool.query<{ question_id: string; done: boolean; starred: boolean }>(
    `SELECT question_id, done, starred
     FROM users.question_progress
     WHERE uid = $1`,
    [uid],
  );

  return rows.map((row) => ({
    questionId: row.question_id,
    done: row.done,
    starred: row.starred,
  }));
}

/**
 * Sets both flags for one step, creating the row if this is the first mark.
 *
 * A replacement rather than a toggle, and that is the point: the caller sends
 * the state it wants, so the same request arriving twice lands on the same row.
 * A toggle endpoint retried by a flaky network would flip twice and leave the
 * box wrong with nothing to detect it.
 */
export async function setProgress(
  pool: pg.Pool,
  uid: string,
  questionId: string,
  done: boolean,
  starred: boolean,
): Promise<QuestionProgress> {
  const { rows } = await pool.query<{ question_id: string; done: boolean; starred: boolean }>(
    `INSERT INTO users.question_progress (uid, question_id, done, starred)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (uid, question_id) DO UPDATE
       SET done = EXCLUDED.done, starred = EXCLUDED.starred, updated_at = now()
     RETURNING question_id, done, starred`,
    [uid, questionId, done, starred],
  );

  const row = rows[0]!;
  return { questionId: row.question_id, done: row.done, starred: row.starred };
}

/**
 * One user's display name, for Matching to show a partner in the room.
 *
 * Returns only the name. Nothing else about the user crosses this boundary, and
 * in particular the caller already knows the uid it asked about, so nothing is
 * revealed by answering. The route in front of this is under `/internal`, which
 * the Gateway proxies nothing to, so a browser cannot reach it and cannot ask
 * about a uid it has no business knowing.
 */
export async function readDisplayName(pool: pg.Pool, firebaseUid: string): Promise<string | null> {
  const { rows } = await pool.query<{ display_name: string | null }>(
    'SELECT display_name FROM users.profiles WHERE firebase_uid = $1',
    [firebaseUid],
  );
  return rows[0]?.display_name ?? null;
}

export async function profileExists(pool: pg.Pool, firebaseUid: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM users.profiles WHERE firebase_uid = $1', [
    firebaseUid,
  ]);
  return rows.length === 1;
}

interface ProfileRow {
  id: string;
  firebase_uid: string;
  display_name: string | null;
  preferred_topics: string[];
  created_at: Date;
}

/**
 * The hand-written mapping ADR-10 accepts as the cost of deferring an ORM: the
 * only place the snake_case schema and the camelCase API meet, so schema drift
 * shows up here rather than at five call sites.
 */
function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    displayName: row.display_name,
    preferredTopics: row.preferred_topics,
    createdAt: row.created_at,
  };
}
