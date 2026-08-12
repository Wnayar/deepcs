-- ADR-09: one role per service, privileges ONLY on its own schema, so that a
-- cross-service read is rejected by Postgres rather than discouraged by
-- convention.
--
-- It lands before the first table on purpose: a boundary that is not enforced
-- from the first table will be violated by the third, and retrofitting grants
-- means untangling queries that already cross.
--
-- The passwords here are local-only and match the compose convention (role
-- name as password). Nothing in this file is a credential for anything that
-- is reachable from outside this machine.

-- CREATE ROLE has no IF NOT EXISTS, and this file must be safe to re-run
-- against a database where the runner's bookkeeping table was wiped.
DO $$
DECLARE
  svc text;
BEGIN
  FOREACH svc IN ARRAY ARRAY['users', 'questions', 'matching', 'collab', 'stats'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc || '_svc') THEN
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', svc || '_svc', svc || '_svc');
    END IF;
  END LOOP;
END
$$;

-- Nobody creates tables in `public`. Postgres 15+ already revokes this by
-- default, but stating it means the guarantee does not depend on which server
-- version a future environment happens to run.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Each role gets USAGE on exactly one schema. USAGE is the gate: without it,
-- every reference to a table inside that schema fails with "permission denied
-- for schema", regardless of any table-level grant. That single missing grant
-- is what makes the boundary real.
DO $$
DECLARE
  svc text;
  role_name text;
BEGIN
  FOREACH svc IN ARRAY ARRAY['users', 'questions', 'matching', 'collab', 'stats'] LOOP
    role_name := svc || '_svc';

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', svc, role_name);

    -- Existing tables (none yet on a fresh database; matters on re-run).
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I',
      svc, role_name
    );
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', svc, role_name);

    -- Tables created by LATER migrations. Without this, every future migration
    -- would have to remember to re-grant, and the one that forgets produces a
    -- service that starts fine and fails on its first query.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
      svc, role_name
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
      svc, role_name
    );

    -- Defence in depth: an unqualified table name resolves inside the service's
    -- own schema rather than falling through to `public`. Queries are written
    -- fully qualified anyway — this only decides what a mistake does.
    EXECUTE format('ALTER ROLE %I SET search_path = %I', role_name, svc);
  END LOOP;
END
$$;

-- Deliberately absent: any GRANT that crosses a boundary. Stats reads other
-- services' data through the event log, not through their tables — if a GRANT
-- ever appears here, ADR-09 has been abandoned and the doc should say so
-- rather than the schema quietly disagreeing with it.
