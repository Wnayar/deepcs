import type pg from 'pg';

/**
 * Upserts a session's Yjs state — `state` is the output of
 * `Y.encodeStateAsUpdate(doc)`. Called every 30s per active room, on the
 * room's last disconnect, and once per room before SIGTERM (see rooms.ts).
 */
export async function saveSnapshot(pool: pg.Pool, sessionId: string, state: Buffer): Promise<void> {
  await pool.query(
    `INSERT INTO collab.snapshots (session_id, state, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (session_id) DO UPDATE SET state = $2, updated_at = now()`,
    [sessionId, state],
  );
}

/**
 * Loads a session's last snapshot, or `null` if none exists yet — a room is
 * seeded fresh from the question's parts in that case (see rooms.ts).
 */
export async function loadSnapshot(pool: pg.Pool, sessionId: string): Promise<Buffer | null> {
  const { rows } = await pool.query<{ state: Buffer }>(
    `SELECT state FROM collab.snapshots WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0]?.state ?? null;
}
