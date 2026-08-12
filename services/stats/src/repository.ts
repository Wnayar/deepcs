import type pg from 'pg';

export interface SessionSummary {
  sessionId: string;
  questionId: string;
  topic: string;
  difficulty: string;
  startedAt: Date;
  endedAt: Date | null;
  revealed: boolean;
  /** Null when nobody ever opened the editor. */
  firstConnectedAt: Date | null;
}

/**
 * One summary, but only for somebody who was in it.
 *
 * The membership test is part of the query rather than a check after it, so
 * there is no arrangement of this code where the row is loaded and the check is
 * forgotten. `participants` is compared against and never selected: the other
 * person's uid is not the caller's to be told, which is the rule the whole
 * matching flow follows.
 */
export async function readSummary(
  pool: pg.Pool,
  sessionId: string,
  uid: string,
): Promise<SessionSummary | null> {
  const { rows } = await pool.query<{
    session_id: string;
    question_id: string;
    topic: string;
    difficulty: string;
    started_at: Date;
    ended_at: Date | null;
    revealed: boolean;
    first_connected_at: Date | null;
  }>(
    `SELECT session_id, question_id, topic, difficulty, started_at, ended_at,
            revealed, first_connected_at
       FROM stats.session_summaries
      WHERE session_id = $1 AND $2 = ANY (participants)`,
    [sessionId, uid],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    questionId: row.question_id,
    topic: row.topic,
    difficulty: row.difficulty,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    revealed: row.revealed,
    firstConnectedAt: row.first_connected_at,
  };
}

export interface Stats {
  sessionsTotal: number;
  sessionsCompleted: number;
  signups: number;
  perDay: { day: string; sessions: number }[];
  topics: { topic: string; sessions: number }[];
  medianWaitSeconds: number | null;
}

/**
 * The public aggregates, computed rather than stored.
 *
 * Four queries instead of one, because they group differently and combining
 * them would mean either a lateral join per shape or counting distinct ids
 * inside a cross product. At this size four round trips is nothing, and each
 * query says plainly what it counts.
 *
 * `percentile_cont` is the median, interpolated: with an even number of waits
 * it returns the midpoint between the two middle values rather than picking
 * one. The median rather than the mean because one person who queued and went
 * to lunch would otherwise be the headline number.
 */
export async function readStats(pool: pg.Pool): Promise<Stats> {
  const [totals, perDay, topics, wait] = await Promise.all([
    pool.query<{ sessions: string; completed: string; signups: string }>(
      `SELECT (SELECT count(*) FROM stats.session_summaries) AS sessions,
              (SELECT count(*) FROM stats.session_summaries WHERE ended_at IS NOT NULL) AS completed,
              (SELECT count(*) FROM stats.signups) AS signups`,
    ),
    pool.query<{ day: Date; sessions: string }>(
      `SELECT date_trunc('day', started_at) AS day, count(*) AS sessions
         FROM stats.session_summaries
        GROUP BY 1 ORDER BY 1 DESC LIMIT 30`,
    ),
    pool.query<{ topic: string; sessions: string }>(
      `SELECT topic, count(*) AS sessions
         FROM stats.session_summaries
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`,
    ),
    pool.query<{ median: string | null }>(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY waited_seconds) AS median
         FROM stats.session_summaries WHERE waited_seconds IS NOT NULL`,
    ),
  ]);

  const row = totals.rows[0]!;
  return {
    sessionsTotal: Number(row.sessions),
    sessionsCompleted: Number(row.completed),
    signups: Number(row.signups),
    perDay: perDay.rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      sessions: Number(r.sessions),
    })),
    topics: topics.rows.map((r) => ({ topic: r.topic, sessions: Number(r.sessions) })),
    medianWaitSeconds:
      wait.rows[0]?.median == null ? null : Math.round(Number(wait.rows[0].median) * 100) / 100,
  };
}
