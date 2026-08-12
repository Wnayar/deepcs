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
