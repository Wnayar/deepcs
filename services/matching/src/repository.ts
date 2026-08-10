import type pg from 'pg';

export interface Session {
  id: string;
  userAUid: string;
  userBUid: string;
  questionId: string;
  createdAt: Date;
  /** Uids who have agreed to reveal the reference answer. The answer is
   * released only when both participants are in here (ADR-06). */
  revealConsents: string[];
  endedAt: Date | null;
}

/** Every column the routes need, in one place so the three queries below
 * cannot drift apart. */
const SESSION_COLUMNS =
  'id, user_a_uid, user_b_uid, question_id, created_at, reveal_consents, ended_at';

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
     RETURNING ${SESSION_COLUMNS}`,
    [userAUid, userBUid, questionId],
  );
  return toSession(rows[0]!);
}

/**
 * Finds a uid's *live* session, checking both sides of the pair — e.g. if
 * "bob" is stored as `user_b_uid` on a row, `findActiveSessionForUser(pool,
 * 'bob')` still finds it. Returns `null` if the uid isn't in one.
 *
 * `ended_at IS NULL` is doing real work, not defensive filtering. This is the
 * guard `POST /match/join` checks before touching the queue, so without it a
 * user who finishes a session is handed that same dead session on every
 * subsequent join, forever, and can never be matched with anyone again.
 */
export async function findActiveSessionForUser(
  pool: pg.Pool,
  uid: string,
): Promise<Session | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
     FROM matching.sessions
     WHERE (user_a_uid = $1 OR user_b_uid = $1) AND ended_at IS NULL
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
    `SELECT ${SESSION_COLUMNS}
     FROM matching.sessions
     WHERE id = $1`,
    [id],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/**
 * Records that `uid` agreed to reveal the answer, and returns the session as
 * it now stands — e.g. `addRevealConsent(pool, 's42', 'bob')`.
 *
 * `array_append` only when the uid isn't already there, so clicking Reveal
 * twice is the same as clicking it once. Doing that in SQL rather than
 * read-modify-write in the route matters: both participants can consent at the
 * same instant, and two concurrent read-then-writes would lose one of them —
 * which here means the answer silently never unlocks.
 */
export async function addRevealConsent(
  pool: pg.Pool,
  id: string,
  uid: string,
): Promise<Session | null> {
  const { rows } = await pool.query<SessionRow>(
    `UPDATE matching.sessions
     SET reveal_consents = CASE
           WHEN $2 = ANY (reveal_consents) THEN reveal_consents
           ELSE array_append(reveal_consents, $2)
         END
     WHERE id = $1
     RETURNING ${SESSION_COLUMNS}`,
    [id, uid],
  );
  return rows[0] ? toSession(rows[0]) : null;
}

/**
 * Marks a session finished. Already-ended sessions keep their original
 * `ended_at` (`WHERE ended_at IS NULL`), so whoever clicks End second doesn't
 * move the timestamp the other person's summary is showing.
 */
export async function endSession(pool: pg.Pool, id: string): Promise<Session | null> {
  const { rows } = await pool.query<SessionRow>(
    `UPDATE matching.sessions
     SET ended_at = now()
     WHERE id = $1 AND ended_at IS NULL
     RETURNING ${SESSION_COLUMNS}`,
    [id],
  );
  // No row updated means it was already ended — return the existing row rather
  // than null, which the route would otherwise report as a missing session.
  return rows[0] ? toSession(rows[0]) : findSessionById(pool, id);
}

/** True if `uid` is one of the two people in `session`. */
export function isParticipant(session: Session, uid: string): boolean {
  return uid === session.userAUid || uid === session.userBUid;
}

interface SessionRow {
  id: string;
  user_a_uid: string;
  user_b_uid: string;
  question_id: string;
  created_at: Date;
  reveal_consents: string[];
  ended_at: Date | null;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userAUid: row.user_a_uid,
    userBUid: row.user_b_uid,
    questionId: row.question_id,
    createdAt: row.created_at,
    revealConsents: row.reveal_consents,
    endedAt: row.ended_at,
  };
}
