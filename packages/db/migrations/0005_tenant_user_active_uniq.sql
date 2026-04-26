-- 0005_tenant_user_active_uniq.sql
-- Partial unique index on tenant_user(tenant_id, user_id) for non-deleted membership rows.
--
-- Why: getOrAddTenantUser (W3 T4) uses INSERT ... ON CONFLICT (tenant_id, user_id)
-- DO UPDATE for race-safe membership add/undelete. ON CONFLICT requires a unique
-- target index. The partial filter (deleted_at IS NULL) means soft-deleted
-- memberships don't block re-adding the same user — they get un-soft-deleted
-- via the ON CONFLICT branch.
--
-- This mirrors migration 0004's pattern on the user(primary_idp, external_id) index.

CREATE UNIQUE INDEX "tenant_user_active_uniq"
  ON "tenant_user" (tenant_id, user_id)
  WHERE deleted_at IS NULL;
