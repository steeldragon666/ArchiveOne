-- 0086_ip_search.sql
-- Wizard Step 2 — IP-search prior-art tables.
--
-- Three tables that together capture one analyst-approved pass/fail
-- verdict per R&D hypothesis, backed by cached prior-art searches
-- across IP Australia / Semantic Scholar / PubMed / arXiv.
--
--   ip_search_run     — one row per (hypothesis, database, query) call
--                       to an external search API; payload + result count
--                       captured so we can replay or audit.
--   ip_search_hit     — denormalised hits surfaced by a run (title, url,
--                       relevance). Child of ip_search_run.
--   ip_search_verdict — one row per (activity, hypothesis_text). Carries
--                       LLM draft + consultant-approved final verdict +
--                       analysis_markdown + optional PDF evidence link.
--
-- All three tables are tenant-scoped via
--   tenant_id = current_setting('app.current_tenant_id', true)::uuid
-- (ip_search_hit defers to its parent run via an EXISTS subquery).
--
-- CACHING
--   ip_search_run_cache_idx orders rows by ran_at DESC so the 30-day TTL
--   lookup (see design doc §"Cache") can read the most recent row for a
--   given (hypothesis_hash, database, query) in O(log n). hypothesis_hash
--   is the hex sha256 of hypothesis_text — produced application-side; the
--   column is plain text here so callers can hash with any algorithm
--   without a CHECK constraint making future changes painful.
--
-- DEVIATION FROM TASK SPEC
--   The task spec (docs/plans/wizard-step-2/01-migration.md §"SQL to write")
--   declares ip_search_verdict.pdf_evidence_id with
--     REFERENCES evidence(id)
--   No `evidence` table exists in the schema today — "evidence" is a
--   logical view over media_artefact + event in apps/api/src/routes/
--   evidence.ts. Task 07 (07-pdf-report-job.md) plans to INSERT into an
--   evidence table that doesn't yet exist; that table will be authored
--   later. To keep this migration runnable, pdf_evidence_id is declared
--   as plain `uuid` with NO FK constraint. A follow-up migration in the
--   wizard-step-2 sequence (when evidence lands) should add
--     ALTER TABLE ip_search_verdict
--       ADD CONSTRAINT ip_search_verdict_pdf_evidence_id_fkey
--       FOREIGN KEY (pdf_evidence_id) REFERENCES evidence(id);
--   This deviation is the minimum-viable change vs. the spec; semantics
--   (nullable uuid pointing at an evidence-shaped row) are preserved.
--
-- RLS POLICY ROLE
--   Per 0002 / 0022 / 0082 precedent, policies are scoped TO cpa_app —
--   the non-superuser, non-owner application role. The migration runner
--   (postgres) bypasses RLS because it owns the table; only sessions
--   that SET ROLE cpa_app pay the policy cost. FORCE ROW LEVEL SECURITY
--   is set so even the table owner is policy-gated when running as
--   cpa_app via SET LOCAL ROLE.
--
-- IDEMPOTENT — every CREATE uses IF NOT EXISTS; policies are wrapped in
-- a DO block that skips re-creation if the named policy already exists.

-- ============================================================
-- Table 1: ip_search_run
-- ============================================================

CREATE TABLE IF NOT EXISTS ip_search_run (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  claim_id        uuid        NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  activity_id     uuid        NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  hypothesis_text text        NOT NULL,
  hypothesis_hash text        NOT NULL,    -- hex sha256 of hypothesis_text
  database_name   text        NOT NULL     CHECK (database_name IN ('ip_australia', 'semantic_scholar', 'pubmed', 'arxiv')),
  query           text        NOT NULL,
  query_source    text        NOT NULL     CHECK (query_source IN ('llm', 'analyst_edit')),
  raw_response    jsonb,
  result_count    integer     NOT NULL DEFAULT 0,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  ran_by_user_id  uuid        REFERENCES "user"(id)
);

-- Cache lookup: most-recent row by (hypothesis, db, query). The DESC
-- order on ran_at lets the cache-hit path read row #1 directly.
CREATE INDEX IF NOT EXISTS ip_search_run_cache_idx
  ON ip_search_run (hypothesis_hash, database_name, query, ran_at DESC);

-- ============================================================
-- Table 2: ip_search_hit
-- ============================================================

CREATE TABLE IF NOT EXISTS ip_search_hit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  search_run_id   uuid        NOT NULL REFERENCES ip_search_run(id) ON DELETE CASCADE,
  external_id     text        NOT NULL,    -- patent number / DOI / arxiv id
  title           text        NOT NULL,
  abstract        text,
  published_at    date,
  relevance_score numeric,                  -- LLM-assigned 0..1
  url             text
);

-- Hot path: list hits for a run.
CREATE INDEX IF NOT EXISTS ip_search_hit_run_idx
  ON ip_search_hit (search_run_id);

-- ============================================================
-- Table 3: ip_search_verdict
-- ============================================================

CREATE TABLE IF NOT EXISTS ip_search_verdict (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
  claim_id            uuid        NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  activity_id         uuid        NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  hypothesis_text     text        NOT NULL,
  verdict             text        NOT NULL CHECK (verdict IN ('pass', 'fail', 'inconclusive')),
  draft_verdict       text                  CHECK (draft_verdict IN ('pass', 'fail', 'inconclusive')),
  analysis_markdown   text        NOT NULL,
  approved_by_user_id uuid        REFERENCES "user"(id),
  approved_at         timestamptz,
  -- See "DEVIATION FROM TASK SPEC" header note. FK to evidence(id) is
  -- deferred until the evidence table lands (task 07 scope).
  pdf_evidence_id     uuid,
  CONSTRAINT one_verdict_per_hypothesis UNIQUE (activity_id, hypothesis_text)
);

-- ============================================================
-- RLS — three policies, FORCE-enforced
-- ============================================================

ALTER TABLE ip_search_run     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_search_run     FORCE  ROW LEVEL SECURITY;
ALTER TABLE ip_search_hit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_search_hit     FORCE  ROW LEVEL SECURITY;
ALTER TABLE ip_search_verdict ENABLE ROW LEVEL SECURITY;
ALTER TABLE ip_search_verdict FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'ip_search_run_tenant_isolation'
       AND polrelid = 'ip_search_run'::regclass
  ) THEN
    CREATE POLICY ip_search_run_tenant_isolation ON ip_search_run
      FOR ALL TO cpa_app
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'ip_search_hit_tenant_isolation'
       AND polrelid = 'ip_search_hit'::regclass
  ) THEN
    -- ip_search_hit has no tenant_id of its own; it inherits scope via
    -- its parent ip_search_run row. EXISTS is cheap because the
    -- ip_search_hit_run_idx + ip_search_run primary key cover the lookup.
    CREATE POLICY ip_search_hit_tenant_isolation ON ip_search_hit
      FOR ALL TO cpa_app
      USING (EXISTS (
        SELECT 1 FROM ip_search_run r
         WHERE r.id = ip_search_hit.search_run_id
           AND r.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM ip_search_run r
         WHERE r.id = ip_search_hit.search_run_id
           AND r.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polname = 'ip_search_verdict_tenant_isolation'
       AND polrelid = 'ip_search_verdict'::regclass
  ) THEN
    CREATE POLICY ip_search_verdict_tenant_isolation ON ip_search_verdict
      FOR ALL TO cpa_app
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END
$$;

-- ============================================================
-- GRANTs — task 0084 added ALTER DEFAULT PRIVILEGES for postgres so
-- this should auto-grant, but we GRANT explicitly belt-and-braces.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ip_search_run, ip_search_hit, ip_search_verdict
  TO cpa_app;
