-- 0016_nullif_p4_rls_policies.sql
-- Hand-authored migration. DO NOT REGENERATE via `pnpm --filter @cpa/db generate`.
--
-- Wraps current_setting() in NULLIF for the RLS policies on `event` (0006),
-- `project` / `claim` / `activity` (0012) — extending the fix already applied
-- in 0003 to subject_tenant / tenant_user / subject_tenant_user / delegation_token.
--
-- Why this is needed (recap of 0003 rationale, applied to the P4 tables)
-- ---------------------------------------------------------------------
-- postgres-js keeps custom GUCs in the 'recognized' state across connection
-- reuse: once SET LOCAL has run on a connection, the two-arg
-- current_setting('app.current_tenant_id', true) returns '' (empty string) on
-- subsequent transactions where the GUC isn't re-set, NOT NULL as the docs
-- suggest. Without NULLIF, ''::uuid throws "invalid input syntax for type
-- uuid: ''" on every read/write that hits the policy with an unset GUC —
-- which surfaces as a 500 instead of the intended fail-safe (policy excludes
-- all rows).
--
-- This was the exact failure mode flagged in commit d16fbf7 for the
-- artefact-links DELETE disambiguation read; that fix wrapped one bare
-- `sql<>` call in `sql.begin` with `set_config`. Migration 0016 closes the
-- gap at the policy layer so the same bug class can't bite OTHER call sites
-- that miss the wrap (or call from a connection where the GUC has been
-- session-cleared by sessionPlugin's onResponse hook between checkouts).
--
-- Tables fixed:
--   - event                (from migrations/0006_fair_network.sql)
--   - project              (from migrations/0012_hard_titania.sql)
--   - claim                (from migrations/0012_hard_titania.sql)
--   - activity             (from migrations/0012_hard_titania.sql)
--
-- Other P3 tables that already use the un-wrapped pattern (subject_tenant_employee,
-- media_artefact, time_entry, signing_request, brand_config, expenditure*, etc.)
-- have the same latent issue but are not included here — the two failing
-- tests on PR #4 (CI run 25102321917) point specifically at the event +
-- project chain. Other tables can be picked up in a follow-up sweep.

DROP POLICY "event_tenant_isolation" ON "event";
CREATE POLICY "event_tenant_isolation" ON "event"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY "project_tenant_isolation" ON "project";
CREATE POLICY "project_tenant_isolation" ON "project"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY "claim_tenant_isolation" ON "claim";
CREATE POLICY "claim_tenant_isolation" ON "claim"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY "activity_tenant_isolation" ON "activity";
CREATE POLICY "activity_tenant_isolation" ON "activity"
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
