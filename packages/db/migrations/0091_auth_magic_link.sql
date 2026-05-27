-- 0091_auth_magic_link.sql
-- Magic-link login for existing users — passwordless sign-in that fills the
-- gap left by the autonomous signup pipeline.
--
-- Why this exists:
--   The autonomous signup pipeline (migrations 0088 / 0089) creates new
--   user + tenant rows but does NOT provide a return-path. OIDC routes in
--   app.ts are gated by `publicLoginRoutesEnabled = false`; dev-login is
--   behind the same flag. Existing users whose session has expired or
--   who switch devices have no way to re-authenticate. This table backs
--   the new `POST /v1/auth/login` + `GET /v1/auth/login/callback` pair.
--
-- Lifecycle:
--   POST /v1/auth/login        — generates raw token, stores sha256(token) here.
--   email                      — claimant receives `${PUBLIC_BASE_URL}/login/callback?token=<raw>`.
--   GET  /v1/auth/login/callback — looks up by token_hash, sets consumed_at
--                                  atomically (`UPDATE … WHERE consumed_at IS NULL`
--                                  RETURNING …) to avoid replay races.
--
-- No RLS. This is auth infrastructure (sibling of `user`, `tenant_user`)
-- accessed exclusively by token-gated public routes through
-- `privilegedSql`. The session this row is about to MINT doesn't exist
-- yet, so the `app.current_tenant_id` GUC that cpa_app's RLS policies
-- require can't be set. Same rationale as dev-login.ts uses
-- privilegedSql for its lookup. `magic_link_token` (the claimant table,
-- migration 0019-era) follows the same pattern.
--
-- Defensive: we REVOKE ALL on cpa_app so a future shared-grant migration
-- cannot retroactively expose this surface.

CREATE TABLE IF NOT EXISTS auth_magic_link (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ip           inet,
  user_agent   text
);

-- Lookups by (user_id, sent_at) drive the per-email rate-limit window
-- ("max N sends in the last hour for this user"). DESC matches the query
-- order so the index is range-scannable without an extra sort.
CREATE INDEX IF NOT EXISTS auth_magic_link_user_idx
  ON auth_magic_link (user_id, sent_at DESC);

-- IP-window rate-limit query ("max N sends in the last hour from this IP").
-- A separate index because (user_id) and (ip) windows are checked
-- independently in the route. NULL IPs are filtered out at the
-- application layer, so the partial-NULL exclusion isn't needed here.
CREATE INDEX IF NOT EXISTS auth_magic_link_ip_idx
  ON auth_magic_link (ip, sent_at DESC);

-- Lock the table down for cpa_app. The route writes via privilegedSql so
-- the application role never needs access. Defensive against future
-- shared-grant migrations.
REVOKE ALL ON auth_magic_link FROM cpa_app;
