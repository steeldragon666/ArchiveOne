-- Local-dev Postgres bootstrap for native (non-Docker) Postgres on :5432.
-- Run as postgres superuser:
--   psql -h localhost -p 5432 -U postgres -v ON_ERROR_STOP=1 -f local-dev-setup.sql
-- PGPASSWORD env var is read automatically; do not hardcode passwords here.
--
-- Idempotent: re-running is a no-op once tables / roles exist.

-- 1. Reset cpa role (DDL/migrations) to known dev password
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpa') THEN
    CREATE ROLE cpa LOGIN PASSWORD 'cpa' CREATEDB;
  ELSE
    ALTER ROLE cpa WITH LOGIN PASSWORD 'cpa' CREATEDB;
  END IF;
END $$;

-- 2. Reset cpa_app role (RLS-restricted runtime) to known dev password
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpa_app') THEN
    CREATE ROLE cpa_app LOGIN PASSWORD 'cpa_app_dev_pwd';
  ELSE
    ALTER ROLE cpa_app WITH LOGIN PASSWORD 'cpa_app_dev_pwd';
  END IF;
END $$;

-- 3. Create cpa_dev database owned by cpa, if it doesn't already exist.
--    `\gexec` is the workaround for Postgres's lack of CREATE DATABASE IF NOT EXISTS.
SELECT 'CREATE DATABASE cpa_dev OWNER cpa'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cpa_dev')\gexec

-- 4. Switch into the new database to install extensions there
\c cpa_dev

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 5. Verify everything landed
\echo '--- Roles ---'
SELECT rolname FROM pg_roles WHERE rolname IN ('cpa','cpa_app') ORDER BY rolname;

\echo '--- Database ---'
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database WHERE datname = 'cpa_dev';

\echo '--- Extensions in cpa_dev ---'
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pgcrypto') ORDER BY extname;
