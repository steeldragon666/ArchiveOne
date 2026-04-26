import { sql, privilegedSql } from '@cpa/db/client';

export interface FindOrCreateUserInput {
  primaryIdp: 'microsoft' | 'google';
  externalId: string;
  email: string;
  displayName: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  primaryIdp: 'microsoft' | 'google';
  externalId: string;
}

export interface AvailableTenantRow {
  tenantId: string;
  name: string;
  slug: string;
  role: 'admin' | 'consultant' | 'viewer';
  isDefault: boolean;
}

export interface ActiveTenantResult {
  activeTenantId: string | null;
  activeRole: 'admin' | 'consultant' | 'viewer' | null;
  availableTenants: AvailableTenantRow[];
}

/**
 * Look up a user by (primaryIdp, externalId). If found, bump
 * last_login_at to NOW() and return. If not found, INSERT and return.
 *
 * email + displayName from the IdP are used ONLY when creating; we
 * deliberately do NOT update them on subsequent logins. Rationale:
 * a malicious IdP-side rename should not change our authoritative
 * email — the audit trail anchors on it.
 *
 * Note: user table is GLOBAL (no RLS) — direct sql writes work as cpa_app.
 */
export async function findOrCreateUser(input: FindOrCreateUserInput): Promise<UserRow> {
  // Race-free single-roundtrip pattern. The unique index on
  // (primary_idp, external_id) WHERE deleted_at IS NULL means concurrent
  // logins for the same external user will both target the same row;
  // the second one's ON CONFLICT branch updates last_login_at without
  // touching email or display_name. RETURNING * gives us the row either
  // way.
  const newId = crypto.randomUUID();
  const rows = await sql<UserRow[]>`
    INSERT INTO "user" (id, email, display_name, primary_idp, external_id, last_login_at)
    VALUES (${newId}, ${input.email}, ${input.displayName}, ${input.primaryIdp}, ${input.externalId}, NOW())
    ON CONFLICT (primary_idp, external_id) WHERE deleted_at IS NULL
    DO UPDATE SET last_login_at = NOW()
    RETURNING id, email, display_name AS "displayName", primary_idp AS "primaryIdp", external_id AS "externalId"
  `;
  if (!rows[0]) throw new Error('findOrCreateUser: INSERT/ON CONFLICT did not return a row');
  return rows[0];
}

interface PrivilegedTenantUserRow {
  tenant_id: string;
  name: string;
  slug: string;
  role: 'admin' | 'consultant' | 'viewer';
  is_default: boolean;
}

/**
 * Look up the user's active tenant + all firms they belong to.
 *
 * Privileged query — bypasses RLS so we can see the user's memberships
 * across all tenants. THIS function determines the tenant scope; it
 * cannot itself be tenant-scoped.
 *
 * Active = the row with is_default=true if present, else the
 * earliest-created row.
 */
export async function lookupActiveTenant(userId: string): Promise<ActiveTenantResult> {
  const rows = await privilegedSql<PrivilegedTenantUserRow[]>`
    SELECT tu.tenant_id, t.name, t.slug, tu.role, tu.is_default
      FROM tenant_user tu
      JOIN tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
     WHERE tu.user_id = ${userId}
       AND tu.deleted_at IS NULL
     ORDER BY tu.is_default DESC, tu.created_at ASC
  `;

  const availableTenants = rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    role: r.role,
    isDefault: r.is_default,
  }));

  const active = availableTenants[0] ?? null;
  return {
    activeTenantId: active?.tenantId ?? null,
    activeRole: active?.role ?? null,
    availableTenants,
  };
}
