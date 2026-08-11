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
   * This is the entire reason the upsert is written the way it is. The overview §5:
   * "there is no signup endpoint", so this flag is the only place
   * `user.signed_up` can be emitted from. Get it wrong and the event fires on
   * every request and the sign-up count in /stats means nothing.
   */
  created: boolean;
}

/**
 * Lazy upsert (the overview §5).
 *
 * The client calls GET /users/me immediately after sign-in and this runs. The
 * `RETURNING` is load-bearing: `ON CONFLICT ... DO NOTHING` returns **no row**
 * when the UID already existed, so an empty result is the signal that this was
 * *not* a first sight — which is what makes `created` trustworthy.
 *
 * `DO NOTHING` rather than `DO UPDATE SET firebase_uid = EXCLUDED.firebase_uid`:
 * the update form would return a row every time and destroy the signal, and it
 * would also take a row lock on every sign-in for no reason.
 */
export async function upsertProfile(pool: pg.Pool, firebaseUid: string): Promise<UpsertResult> {
  const inserted = await pool.query<ProfileRow>(
    `INSERT INTO users.profiles (firebase_uid)
     VALUES ($1)
     ON CONFLICT (firebase_uid) DO NOTHING
     RETURNING id, firebase_uid, display_name, preferred_topics, created_at`,
    [firebaseUid],
  );

  if (inserted.rows.length === 1) {
    return { profile: toProfile(inserted.rows[0]!), created: true };
  }

  /**
   * The row existed. A second query rather than one clever statement, because
   * this is the common path and it is a primary-key lookup on a unique index —
   * the cost is a round trip, and the alternative (a CTE, or DO UPDATE) buys
   * back that round trip by destroying the `created` signal above.
   */
  const existing = await pool.query<ProfileRow>(
    `SELECT id, firebase_uid, display_name, preferred_topics, created_at
     FROM users.profiles
     WHERE firebase_uid = $1`,
    [firebaseUid],
  );

  const row = existing.rows[0];
  if (!row) {
    /**
     * Reachable only if the row was deleted between the two statements — the
     * account-deletion flow (§5) is the one thing that does this. Surfacing it
     * rather than returning a null profile keeps "deleted mid-request" from
     * looking like "never existed".
     */
    throw new Error(`profile for ${firebaseUid} vanished between insert and select`);
  }

  return { profile: toProfile(row), created: false };
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
 * The hand-written mapping ADR-10 accepts as the cost of deferring Drizzle:
 * this function is the only place the snake_case schema and the camelCase API
 * meet, so schema drift shows up here rather than in five call sites.
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
