-- 0095 — federation RLS extension on subject_tenant.
--
-- Mirrors 0071_federation_rls_extension.sql, which extended the
-- claim / activity / expenditure / narrative_draft policies with an
-- OR EXISTS clause referencing federation_share. subject_tenant was
-- missed in that pass, so target tenants of an active federation_share
-- couldn't read the SOURCE-owned subject_tenant row directly. That
-- breaks the GET /v1/federation/shares list endpoint: it JOINs
-- subject_tenant to surface the shared entity's display name, but the
-- INNER JOIN drops the row when subject_tenant's tenant-isolation USING
-- excludes it for the target reader.
--
-- Read-only extension: USING is widened, WITH CHECK is unchanged
-- (writes still require own-tenant). Read access matches the existing
-- federation grant — the target legitimately needs the subject_tenant
-- name to render the federated-claim picker.
--
-- Performance: uses the partial index `federation_share_subject_tenant_idx`
-- (WHERE revoked_at IS NULL) created in 0070.

DROP POLICY "subject_tenant_tenant_isolation" ON "subject_tenant";
--> statement-breakpoint

CREATE POLICY "subject_tenant_tenant_isolation" ON "subject_tenant"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM federation_share fs
       WHERE fs.subject_tenant_id = subject_tenant.id
         AND fs.target_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
         AND fs.revoked_at IS NULL
         AND (fs.expires_at IS NULL OR fs.expires_at > now())
    )
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );
