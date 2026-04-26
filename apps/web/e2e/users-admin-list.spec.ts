import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  seedMembership,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

test.describe('Users admin list', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-T8-');
    await cleanupByEmailPrefix('e2e-T8-');
  });

  test('admin sees firm members in table', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-T8-firm');
    const adminId = await seedUser('e2e-T8-admin@example.com', 'T8 Admin');
    const consultantId = await seedUser('e2e-T8-consultant@example.com', 'T8 Consultant');
    await seedMembership(tenantId, adminId, 'admin', true);
    await seedMembership(tenantId, consultantId, 'consultant', false);

    await signInAs(context, {
      id: adminId,
      email: 'e2e-T8-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [{ tenantId, name: 'E2E e2e-T8-firm', slug: 'e2e-T8-firm', role: 'admin' }],
    });

    await page.goto('/users');
    await expect(page.getByRole('heading', { name: /Firm members/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Add user/i })).toBeVisible();
    await expect(page.getByText('e2e-T8-admin@example.com')).toBeVisible();
    await expect(page.getByText('e2e-T8-consultant@example.com')).toBeVisible();
  });

  test('non-admin sees "Admin role required" empty state', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-T8-firm-c');
    const userId = await seedUser('e2e-T8-c-only@example.com', 'T8 Consultant Only');
    await seedMembership(tenantId, userId, 'consultant', true);

    await signInAs(context, {
      id: userId,
      email: 'e2e-T8-c-only@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'consultant',
      availableTenants: [
        { tenantId, name: 'E2E e2e-T8-firm-c', slug: 'e2e-T8-firm-c', role: 'consultant' },
      ],
    });

    await page.goto('/users');
    await expect(page.getByText(/Admin role required/i)).toBeVisible();
  });
});
