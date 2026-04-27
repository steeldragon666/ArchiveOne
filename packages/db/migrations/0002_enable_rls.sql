-- 0002_enable_rls.sql
-- Adds Row-Level Security to the four tenant-scoped tables.
--
-- Hand-authored because drizzle-kit (any version) does not generate
-- CREATE ROLE, ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY,
-- or CREATE POLICY statements.
--
-- TWO-ROLE PATTERN
-- ---------------
-- Postgres has two independent RLS-bypass paths:
--   (1) Superusers ALWAYS bypass RLS.
--   (2) Table OWNERS bypass RLS unless FORCE is set on the table.
-- The cpa role is the bootstrap user and cannot be downgraded from
-- superuser (Postgres invariant). It also owns every table. So if the
-- application connects as cpa, RLS is doubly bypassed.
--
-- Fix: introduce a non-superuser, non-owner application role cpa_app.
-- The application connects as cpa_app at runtime; migrations continue
-- to run as cpa (privileged migration runner). cpa_app is granted
-- scoped CRUD on the public schema's existing AND future tables.
--
-- POLICY DESIGN
-- -------------
-- Each policy uses BOTH a USING clause (gates SELECT/UPDATE/DELETE
-- visibility) and a WITH CHECK clause (gates INSERT/UPDATE-to-form
-- new rows). Without WITH CHECK, FORCE-protected tables would reject
-- all INSERTs from cpa_app — even legitimate ones from the active
-- tenant — because the implicit default is to deny.
--
-- The current_setting('app.current_tenant_id', true) two-arg form
-- returns NULL when the GUC is unset (instead of throwing), and
-- NULL = anything is UNKNOWN, treated as false — so an unset GUC
-- means no rows visible and no rows insertable. Correct fail-safe.
--
-- Per ADR-0002.

-- ============================================================
-- Step 1: create cpa_app application role
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cpa_app') THEN
    CREATE ROLE cpa_app LOGIN PASSWORD 'cpa_app_dev_pwd' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO cpa_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cpa_app;

-- Future tables created by cpa get auto-granted to cpa_app
ALTER DEFAULT PRIVILEGES FOR ROLE cpa IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cpa_app;

-- ============================================================
-- Step 2: subject_tenant — direct tenant_id on the row
-- ============================================================

ALTER TABLE "subject_tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_tenant" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subject_tenant_tenant_isolation" ON "subject_tenant"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- Step 3: tenant_user — direct tenant_id on the row
-- ============================================================

ALTER TABLE "tenant_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_user" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_user_tenant_isolation" ON "tenant_user"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- Step 4: subject_tenant_user — tenant_id resolved via subquery
-- ============================================================
--
-- The subquery itself runs against subject_tenant, which IS RLS-protected
-- under the same GUC. Within the subquery's execution context the GUC is
-- the same as the outer policy, so:
--   subject_tenant_id IN (SELECT id FROM subject_tenant
--                         WHERE tenant_id = <gut>)
-- correctly limits to subject_tenants owned by the active firm.

ALTER TABLE "subject_tenant_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_tenant_user" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subject_tenant_user_tenant_isolation" ON "subject_tenant_user"
  USING (
    subject_tenant_id IN (
      SELECT id FROM "subject_tenant"
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  )
  WITH CHECK (
    subject_tenant_id IN (
      SELECT id FROM "subject_tenant"
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  );

-- ============================================================
-- Step 5: delegation_token — issuer_tenant_id is the firm's active context
-- ============================================================

ALTER TABLE "delegation_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delegation_token" FORCE ROW LEVEL SECURITY;

CREATE POLICY "delegation_token_tenant_isolation" ON "delegation_token"
  USING (issuer_tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (issuer_tenant_id = current_setting('app.current_tenant_id', true)::uuid);
