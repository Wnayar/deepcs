import pg from 'pg';

/**
 * One `pg.Pool` per service process (ADR-10).
 *
 * The pool here is the *application-side* one: it avoids a TCP+TLS handshake
 * per query within this process. It is not, and cannot be, the thing that
 * bounds total connections — each Cloud Run instance runs its own copy of this
 * file and none of them can see the others. That job belongs to PgBouncer at
 * Neon's `-pooler` endpoint (ADR-09), which is the only point every instance
 * passes through.
 *
 * Which means `max` below is a per-instance number, and the figure that matters
 * is `max × maxInstances × services`. Five services × 2 instances × 5 is 50
 * client connections — fine through the pooler, fatal without it.
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

    /**
     * Return a connection to the pool after 30s idle. Cloud Run freezes an
     * instance's CPU between requests, so a connection held open across a long
     * idle gap is one Postgres process doing nothing on a machine that is also
     * doing nothing — and Neon's free tier counts it either way.
     */
    idleTimeoutMillis: 30_000,

    /**
     * Fail fast rather than hang. Without this a service with a bad
     * DATABASE_URL reports itself live and merely never answers, which reads
     * as a slow dependency instead of a misconfiguration.
     */
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Readiness probe for `/health/ready` (§6). Deliberately `SELECT 1` and not a
 * query against a real table: readiness asks whether traffic may be routed
 * here, and a service whose own tables are missing is a migration problem that
 * a restart will not fix — which is a *liveness* answer, not a readiness one.
 */
export async function pingDb(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
