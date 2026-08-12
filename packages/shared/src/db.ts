import pg from 'pg';

/**
 * One `pg.Pool` per service process.
 *
 * This is the *application-side* pool: it avoids a TCP handshake per query
 * within this process. It is not, and cannot be, the thing that bounds total
 * connections — every replica runs its own copy and none of them can see the
 * others. So `max` is a per-instance number and the figure that matters is
 * `max × replicas × services`. Bounding the total needs a connection pooler in
 * front of Postgres. See docs/system/08-data.md §5.
 */
const DEFAULT_MAX = 5;

export interface PoolOptions {
  /** Overridden only by tests, which point at a throwaway database. */
  connectionString?: string;
  max?: number;
}

export function createPool(options: PoolOptions = {}): pg.Pool {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — a service cannot guess its own database');
  }

  return new pg.Pool({
    connectionString,
    max: options.max ?? DEFAULT_MAX,

    // A connection held open across a long idle gap is one Postgres backend
    // process doing nothing, charged for in memory and in the connection limit
    // whether or not a query ever arrives.
    idleTimeoutMillis: 30_000,

    // Fail fast rather than hang. Without this a service with a bad
    // DATABASE_URL reports itself live and merely never answers, which reads as
    // a slow dependency instead of a misconfiguration.
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * The readiness probe. `SELECT 1` and not a query against a real table:
 * readiness asks whether traffic may be routed here, and a service whose own
 * tables are missing is a migration problem a restart will not fix — which is a
 * *liveness* answer, not a readiness one.
 */
export async function pingDb(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
