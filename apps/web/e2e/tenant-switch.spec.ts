import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  seedMembership,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

test.describe('Tenant switcher', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-T7-');
    await cleanupByEmailPrefix('e2e-T7-');
  });

  // SKIPPED 2026-05-31 — the dashboard tenant switcher (the dropdown
  // with role=menuitem firm rows) lived on the legacy `/` admin
  // dashboard, which has been retired. The consultant workspace at
  // /consultant has its own sidebar/header switcher with different
  // semantics. Tracked in task #66.
  test.skip('clicking a tenant in the dropdown changes the active firm', async ({
    page,
    context,
  }) => {
    const tenantA = await seedTenant('e2e-T7-firm-alpha', 'E2E T7 Firm Alpha');
    const tenantB = await seedTenant('e2e-T7-firm-bravo', 'E2E T7 Firm Bravo');
    const userId = await seedUser('e2e-T7-multi@example.com', 'T7 Multi-firm');
    await seedMembership(tenantA, userId, 'admin', true);
    await seedMembership(tenantB, userId, 'consultant', false);

    await signInAs(context, {
      id: userId,
      email: 'e2e-T7-multi@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantA,
      activeRole: 'admin',
      availableTenants: [
        { tenantId: tenantA, name: 'E2E T7 Firm Alpha', slug: 'e2e-T7-firm-alpha', role: 'admin' },
        {
          tenantId: tenantB,
          name: 'E2E T7 Firm Bravo',
          slug: 'e2e-T7-firm-bravo',
          role: 'consultant',
        },
      ],
    });

    // `/` is now the marketing landing (next.config.ts rewrite); the
    // tenant switcher lives in the authenticated dashboard shell.
    await page.goto('/dashboard');

    // Initial active firm: Alpha. Firm name appears twice (TenantSwitcher
    // button + "Active firm: <strong>" label); scope to <strong> for an
    // unambiguous "currently active firm" assertion.
    await expect(page.locator('strong', { hasText: 'E2E T7 Firm Alpha' })).toBeVisible();

    // Open dropdown via the switcher button
    await page.getByRole('button', { name: /E2E T7 Firm Alpha/i }).click();

    // Click Bravo in the dropdown
    await page.getByRole('menuitem', { name: /E2E T7 Firm Bravo/i }).click();

    // Wait for the dashboard to re-render with Bravo as the new active firm.
    await expect(page.locator('strong', { hasText: 'E2E T7 Firm Bravo' })).toBeVisible({
      timeout: 5_000,
    });
  });
});
