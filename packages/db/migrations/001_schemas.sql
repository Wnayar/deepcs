-- One schema per service (ADR-09). Created before any table exists, so that no
-- table can be created in `public` by accident and become everyone's.
--
-- `collab` and `stats` are created now even though nothing uses them until
-- phases 4 and 7: the roles migration grants against these names, and a role
-- granted on a schema that does not exist yet is a migration that fails later
-- for a reason unrelated to what changed.

CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS questions;
CREATE SCHEMA IF NOT EXISTS matching;
CREATE SCHEMA IF NOT EXISTS collab;
CREATE SCHEMA IF NOT EXISTS stats;
