-- 0004_user_idp_external_id_unique.sql
-- Adds a unique index on (primary_idp, external_id) for non-deleted users.
--
-- Why: findOrCreateUser is the OIDC callback's user-resolution step; it
-- must be race-free across concurrent logins. The index lets the new
-- ON CONFLICT-based query pattern (T6 follow-up) treat duplicate inserts
-- as no-ops rather than error rows.
--
-- Filter on deleted_at IS NULL keeps soft-deleted users from blocking
-- a re-creation — if a user is undeleted, they can be re-onboarded
-- under the same IdP id.

CREATE UNIQUE INDEX "user_idp_external_id_uniq"
  ON "user" (primary_idp, external_id)
  WHERE deleted_at IS NULL;
