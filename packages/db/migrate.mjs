/**
 * The migration runner (ADR-10). Deliberately small: numbered `.sql` files
 * applied in filename order, each inside a transaction, each recorded so it is
 * never applied twice.
 *
 * Why not a migration library: ADR-10 defers the ORM, and a library would bring
 * back the schema-definition language that deferral exists to avoid. The whole
 * mechanism is the forty lines below, and ADR-09's GRANT/REVOKE stays literal
 * SQL rather than something generated.
 *
 * Runs as the OWNER role (the `deepcs` superuser locally), not as a service
 * role — creating schemas and granting privileges is exactly what the service
 * roles are forbidden from doing.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — refusing to guess which database to migrate');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

/**
 * The bookkeeping table lives in `public` rather than in any service's schema:
 * it belongs to none of them, and putting it in one would give that service's
 * role a reason to be granted something it otherwise does not need.
 */
await client.query(`
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  )
`);

const { rows } = await client.query('SELECT filename FROM public.schema_migrations');
const applied = new Set(rows.map((r) => r.filename));

const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;

  const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

  /**
   * One transaction per file, so a migration that fails halfway leaves nothing
   * behind. Postgres supports transactional DDL, which is the reason this is
   * forty lines and not four hundred — in MySQL each statement would commit on
   * its own and a half-applied file would have to be unwound by hand.
   */
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO public.schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`applied ${file}`);
    ran += 1;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${file}: ${err.message}`);
    await client.end();
    process.exit(1);
  }
}

console.log(ran === 0 ? 'up to date, nothing to apply' : `applied ${ran} migration(s)`);
await client.end();
