import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  seedMembership,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

test.describe('Dashboard', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-T6-');
    await cleanupByEmailPrefix('e2e-T6-');
  });

  // SKIPPED 2026-05-31 — the legacy `/` admin dashboard (email-chip +
  // "Active firm: <strong>" + "Manage firm members" link) was retired
  // in the consultant-workspace redesign. `/dashboard` now renders the
  // System-A Claimsure shell which doesn't surface these markers.
  // Tracked in task #66.
  test.skip('admin sees own email + active firm name + role badge', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-T6-firm-alpha', 'E2E T6 Firm Alpha');
    const userId = await seedUser('e2e-T6-admin@example.com', 'T6 Admin');
    await seedMembership(tenantId, userId, 'admin', true);

    await signInAs(context, {
      id: userId,
      email: 'e2e-T6-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        {
          tenantId,
          name: 'E2E T6 Firm Alpha',
          slug: 'e2e-T6-firm-alpha',
          role: 'admin',
        },
      ],
    });

    // `/` is now the marketing landing (next.config.ts rewrite), so the
    // authenticated dashboard lives at `/dashboard` and must be navigated
    // to explicitly.
    await page.goto('/dashboard');
    await expect(page.getByText('e2e-T6-admin@example.com')).toBeVisible();
    // Firm name appears twice on the dashboard (TenantSwitcher button +
    // "Active firm: <strong>" label). Scope to the <strong> so the
    // assertion is unambiguous and resilient to tenant-switcher refactors.
    await expect(page.locator('strong', { hasText: 'E2E T6 Firm Alpha' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage firm members/i })).toBeVisible();
  });
});
