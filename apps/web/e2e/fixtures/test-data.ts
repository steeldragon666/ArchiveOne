import { privilegedSql } from '@cpa/db/client';

/**
 * Seed a tenant. Returns the tenantId.
 *
 * Uses privilegedSql (cpa role, RLS-bypass) — e2e tests aren't testing
 * RLS, just browser flow. Each test uses a unique slug prefix
 * (e.g., 'e2e-T6-firm-alpha') so concurrent runs don't collide.
 */
export async function seedTenant(slug: string, name = `E2E ${slug}`): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO tenant (id, name, slug, primary_idp)
                       VALUES (${id}, ${name}, ${slug}, 'mixed')`;
  return id;
}

/**
 * Seed a user. Returns the userId. external_id is derived from email
 * to keep the IdP-stable lookup contract (see W2 findOrCreateUser).
 */
export async function seedUser(email: string, displayName: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
                       VALUES (${id}, ${email}, 'microsoft', ${'microsoft:' + email}, ${displayName})`;
  return id;
}

/**
 * Seed a tenant_user membership row. Returns the row id.
 * Use privilegedSql so we don't need to set up an RLS context just for
 * test fixture seeding.
 */
export async function seedMembership(
  tenantId: string,
  userId: string,
  role: 'admin' | 'consultant' | 'viewer',
  isDefault = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (${id}, ${tenantId}, ${userId}, ${role}, ${isDefault})`;
  return id;
}

/**
 * Clean up tenants + tenant_user rows whose slug starts with the prefix.
 * Use this in afterAll() to remove all tenants/memberships seeded by a
 * single spec, regardless of how many tests created fixtures.
 */
export async function cleanupBySlugPrefix(prefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE tenant_id IN (SELECT id FROM tenant WHERE slug LIKE ${prefix + '%'})`;
  await privilegedSql`DELETE FROM tenant WHERE slug LIKE ${prefix + '%'}`;
}

/**
 * Clean up users + their tenant_user rows whose email starts with the
 * prefix. Pair with cleanupBySlugPrefix in afterAll.
 */
export async function cleanupByEmailPrefix(prefix: string): Promise<void> {
  await privilegedSql`DELETE FROM tenant_user
                       WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE ${prefix + '%'})`;
  await privilegedSql`DELETE FROM "user" WHERE email LIKE ${prefix + '%'}`;
}
