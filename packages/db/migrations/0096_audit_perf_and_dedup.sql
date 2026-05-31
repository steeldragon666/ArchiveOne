-- 0096 — Audit-driven perf + correctness pass.
--
-- Bundles 4 small, independent fixes flagged by the platform audit:
--
--   (a) Wrap NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
--       in (SELECT …) inside the federation-extended USING clauses so the
--       planner hoists the GUC read to a per-statement InitPlan instead of
--       evaluating it per row scanned. The previous form (0071, 0095) was
--       fine for correctness but degraded performance on federated reads
--       of large claim / activity / expenditure / narrative_draft / subject_tenant
--       result sets.
--
--   (b) Add an expression index on event(payload->>'activity_id') restricted
--       to the artefact/activity/narrative/expenditure event kinds. The
--       canAdvance(3) projection in workflow.ts and the per-activity
--       finalisation fan-out in claim-finalisation.ts both filter on this
--       payload field; without an expression index Postgres falls back to
--       a full event-table scan.
--
--   (c) Promote the canonical NULLIF(...)::uuid guard onto the
--       llm_token_usage policy (was using a raw text equality, which is
--       fail-safe but inconsistent with every other table's pattern).
--
--   (d) Append-only privileges audit — re-revoke UPDATE/DELETE on
--       narrative_draft_version + prompt_suggestion_review + audit_log.
--       Migration 0084 blanket-granted on a list that did not include
--       these three; the original CREATE-time REVOKEs are still in
--       effect, but a defensive re-REVOKE makes the invariant explicit
--       in the journal so any future blanket-GRANT inadvertently
--       restoring the privileges is visible at the next CI parity check.
--
-- The duplicate 0082 filename collision (0082_expenditure_unmapped_kind
-- vs 0082_llm_token_usage) is documented in the journal but cannot be
-- renamed in-place without bumping every consumer that joins on tag.
-- Tracked as a separate cleanup task.

BEGIN;

-- ------------------------------------------------------------------ (a)
-- claim
DROP POLICY IF EXISTS "claim_tenant_isolation" ON "claim";
CREATE POLICY "claim_tenant_isolation" ON "claim"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM federation_share fs
       WHERE fs.subject_tenant_id = claim.subject_tenant_id
         AND fs.target_tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- activity
DROP POLICY IF EXISTS "activity_tenant_isolation" ON "activity";
CREATE POLICY "activity_tenant_isolation" ON "activity"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM claim c
        JOIN federation_share fs ON fs.subject_tenant_id = c.subject_tenant_id
       WHERE c.id = activity.claim_id
         AND fs.target_tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- expenditure
DROP POLICY IF EXISTS "expenditure_tenant_isolation" ON "expenditure";
CREATE POLICY "expenditure_tenant_isolation" ON "expenditure"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM claim c
        JOIN federation_share fs ON fs.subject_tenant_id = c.subject_tenant_id
       WHERE c.id = expenditure.claim_id
         AND fs.target_tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- narrative_draft
DROP POLICY IF EXISTS "narrative_draft_tenant_isolation" ON "narrative_draft";
CREATE POLICY "narrative_draft_tenant_isolation" ON "narrative_draft"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM activity a
        JOIN claim c ON c.id = a.claim_id
        JOIN federation_share fs ON fs.subject_tenant_id = c.subject_tenant_id
       WHERE a.id = narrative_draft.activity_id
         AND fs.target_tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- subject_tenant (federation-extended in 0095)
DROP POLICY IF EXISTS "subject_tenant_tenant_isolation" ON "subject_tenant";
CREATE POLICY "subject_tenant_tenant_isolation" ON "subject_tenant"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM federation_share fs
       WHERE fs.subject_tenant_id = subject_tenant.id
         AND fs.target_tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- ------------------------------------------------------------------ (b)
CREATE INDEX IF NOT EXISTS event_payload_activity_id_idx
  ON event ((payload->>'activity_id'))
  WHERE kind IN (
    'ARTEFACT_LINKED',
    'ARTEFACT_UNLINKED',
    'ACTIVITY_CREATED',
    'ACTIVITY_UPDATED',
    'NARRATIVE_DRAFTED',
    'EXPENDITURE_APPORTIONED'
  );

-- ------------------------------------------------------------------ (c)
DROP POLICY IF EXISTS "llm_token_usage_tenant_isolation" ON "llm_token_usage";
CREATE POLICY "llm_token_usage_tenant_isolation" ON "llm_token_usage"
  USING (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  )
  WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  );

-- ------------------------------------------------------------------ (d)
REVOKE UPDATE, DELETE ON narrative_draft_version FROM cpa_app;
REVOKE UPDATE, DELETE ON prompt_suggestion_review FROM cpa_app;
REVOKE UPDATE, DELETE ON audit_log FROM cpa_app;

COMMIT;
