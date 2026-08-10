import type pg from 'pg';

export interface Session {
  id: string;
  userAUid: string;
  userBUid: string;
  questionId: string;
  createdAt: Date;
}

/** Creates a session row for a newly matched pair. */
export async function createSession(
  pool: pg.Pool,
  userAUid: string,
  userBUid: string,
  questionId: string,
): Promise<Session> {
  const { rows } = await pool.query<SessionRow>(
    `INSERT INTO matching.sessions (user_a_uid, user_b_uid, question_id)
     VALUES ($1, $2, $3)
     RETURNING id, user_a_uid, user_b_uid, question_id, created_at`,
    [userAUid, userBUid, questionId],
  );
  return toSession(rows[0]!);
}

/**
 * Finds a uid's session, checking both sides of the pair — e.g. if "bob" is
 * stored as `user_b_uid` on a row, `findActiveSessionForUser(pool, 'bob')`
 * still finds it. Returns `null` if the uid isn't in any session.
 *
 * There's no "end session" flow yet (that's a later phase), so a uid only
 * ever has zero or one session right now — `ORDER BY ... LIMIT 1` is just a
 * safety net for whenever that stops being true.
 */
export async function findActiveSessionForUser(
  pool: pg.Pool,
  uid: string,
): Promise<Session | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT id, user_a_uid, user_b_uid, question_id, created_at
     FROM matching.sessions
     WHERE user_a_uid = $1 OR user_b_uid = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [uid],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/**
 * Finds a session by its id, regardless of who's asking — used by the
 * participant-check route, which decides who's allowed to see it. Returns
 * `null` if the id doesn't exist.
 */
export async function findSessionById(pool: pg.Pool, id: string): Promise<Session | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT id, user_a_uid, user_b_uid, question_id, created_at
     FROM matching.sessions
     WHERE id = $1`,
    [id],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

interface SessionRow {
  id: string;
  user_a_uid: string;
  user_b_uid: string;
  question_id: string;
  created_at: Date;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userAUid: row.user_a_uid,
    userBUid: row.user_b_uid,
    questionId: row.question_id,
    createdAt: row.created_at,
  };
}
