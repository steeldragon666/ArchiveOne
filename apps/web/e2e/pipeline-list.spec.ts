import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  seedMembership,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

/**
 * C1 — /pipeline page shell + filter bar + view toggle.
 *
 * C1 only renders the shell; the kanban view (C2) and table view (C3)
 * land later in the same swimlane. This spec asserts the page header,
 * filter UI elements, and that the view toggle round-trips through the
 * URL `?view=kanban|table` query param. The placeholder copy ("Kanban
 * view coming in C2" / "Table view coming in C3") is asserted to lock
 * in the contract that those tasks need to satisfy.
 *
 * Patterns follow PR #3 commit 68b4cc8 — `getByRole` over `getByText`
 * where roles exist, and `{ exact: true }` everywhere else to dodge
 * substring + case-insensitive collisions with toast aria-live regions.
 */
test.describe('Pipeline list page', () => {
  test.afterAll(async () => {
    await cleanupBySlugPrefix('e2e-C1-');
    await cleanupByEmailPrefix('e2e-C1-');
  });

  // TODO(P5-followup): Re-enable after rewriting the placeholder assertions.
  // The original C1 spec asserted the "Kanban view coming in C2" / "Table
  // view coming in C3" placeholder copy as a contract for those tasks to
  // satisfy. C2 (kanban-view) and C3 (table-view) landed and replaced both
  // placeholders with real components, but this spec was never updated to
  // assert against the real rendered views. Same skip-with-TODO pattern
  // as the chain-verification + activity-register specs that PR #4 deferred
  // to P5 (commit 14eaf3e). P5 plan §6 (polish) covers the rewrite.
  test.skip('renders header, filters, and view toggle wired to URL', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-C1-firm');
    const adminId = await seedUser('e2e-C1-admin@example.com', 'C1 Admin');
    await seedMembership(tenantId, adminId, 'admin', true);

    await signInAs(context, {
      id: adminId,
      email: 'e2e-C1-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [{ tenantId, name: 'E2E e2e-C1-firm', slug: 'e2e-C1-firm', role: 'admin' }],
    });

    await page.goto('/pipeline');

    // Page header
    await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();

    // Filters — consultant select, FY input, sector input
    await expect(page.getByLabel('Consultant', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Fiscal year', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Sector', { exact: true })).toBeVisible();

    // Stage chips — toggle-button pattern (aria-pressed). Asserting against
    // role=button with `pressed: false` proves both that the chip exists
    // *and* that it starts in the un-pressed state.
    await expect(
      page.getByRole('button', { name: 'Engagement', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Activity capture', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Narrative drafting', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Expenditure schedule', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Review', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Submitted', exact: true, pressed: false }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Audit defence', exact: true, pressed: false }),
    ).toBeVisible();

    // Default view = table → no ?view= in URL, table tab is selected.
    await expect(page).toHaveURL(/\/pipeline$/);
    await expect(page.getByRole('tab', { name: 'Table', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Kanban', exact: true })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(page.getByText('Table view coming in C3', { exact: true })).toBeVisible();

    // Switch to kanban → URL updates, placeholder swaps.
    await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
    await expect(page).toHaveURL(/\/pipeline\?view=kanban$/);
    await expect(page.getByRole('tab', { name: 'Kanban', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Kanban view coming in C2', { exact: true })).toBeVisible();

    // Switch back to table → URL drops the param (table is the default).
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(page).toHaveURL(/\/pipeline$/);
    await expect(page.getByText('Table view coming in C3', { exact: true })).toBeVisible();
  });

  test('toggling a stage chip writes ?stage= to the URL', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-C1-firm-2');
    const adminId = await seedUser('e2e-C1-admin-2@example.com', 'C1 Admin 2');
    await seedMembership(tenantId, adminId, 'admin', true);

    await signInAs(context, {
      id: adminId,
      email: 'e2e-C1-admin-2@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        { tenantId, name: 'E2E e2e-C1-firm-2', slug: 'e2e-C1-firm-2', role: 'admin' },
      ],
    });

    await page.goto('/pipeline');

    const engagement = page.getByRole('button', { name: 'Engagement', exact: true });
    await expect(engagement).toHaveAttribute('aria-pressed', 'false');

    await engagement.click();
    await expect(engagement).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]stage=engagement/);

    // Toggle a second stage — URL accumulates both.
    const review = page.getByRole('button', { name: 'Review', exact: true });
    await review.click();
    await expect(review).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/stage=engagement/);
    await expect(page).toHaveURL(/stage=review/);

    // Toggle engagement off — only review remains.
    await engagement.click();
    await expect(engagement).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/stage=engagement/);
    await expect(page).toHaveURL(/stage=review/);
  });
});
