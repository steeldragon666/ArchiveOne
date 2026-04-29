import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  cleanupSubjectTenantsByNamePrefix,
  seedActivity,
  seedClaim,
  seedMembership,
  seedProject,
  seedSubjectTenant,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

/**
 * T-A10 — /projects/[project_id] detail tabs (covers T-A7).
 *
 * Verifies that:
 *   - The detail header renders the project name + heading.
 *   - The default tab is "Claims" (no `?tab=` query param) and the two
 *     seeded claim rows are visible.
 *   - Clicking the Timeline / Settings tabs updates the URL with
 *     `?tab=timeline` / `?tab=settings` and renders each tab's content.
 *   - ArrowRight from the Settings tab wraps focus + selection back to
 *     Claims (the WAI-ARIA APG roving-tabindex contract from A7+C4).
 *
 * Tabs are hand-rolled (no shadcn primitive) — the strip uses
 * role="tablist" and each tab uses role="tab" with aria-selected. The
 * `getByRole('tab', { name, selected: true })` query asserts both
 * presence and aria-selected so we don't accidentally match an inactive
 * tab.
 */
test.describe('Project detail tabs', () => {
  test.afterAll(async () => {
    await cleanupSubjectTenantsByNamePrefix('e2e-A10-detail-');
    await cleanupBySlugPrefix('e2e-A10-detail-');
    await cleanupByEmailPrefix('e2e-A10-detail-');
  });

  test('admin sees claims, switches tabs, navigates with the keyboard', async ({
    page,
    context,
  }) => {
    const tenantId = await seedTenant('e2e-A10-detail-firm');
    const adminId = await seedUser('e2e-A10-detail-admin@example.com', 'A10 Detail Admin');
    await seedMembership(tenantId, adminId, 'admin', true);
    const subjectId = await seedSubjectTenant(tenantId, 'e2e-A10-detail-claimant');

    const projectName = 'A10 Detail Project';
    const projectId = await seedProject({
      tenantId,
      subjectTenantId: subjectId,
      name: projectName,
      description: 'Project under test for tab switching.',
    });

    // Two claims so the Claims tab has multiple rows. Distinct fiscal
    // years to satisfy the (subject_tenant_id, fiscal_year) unique index.
    const claim2025 = await seedClaim({
      tenantId,
      subjectTenantId: subjectId,
      fiscalYear: 2025,
      stage: 'narrative_drafting',
    });
    const claim2026 = await seedClaim({
      tenantId,
      subjectTenantId: subjectId,
      fiscalYear: 2026,
      stage: 'engagement',
    });
    // One activity per claim, both anchored to this project — the Claims
    // tab fan-out probes /v1/activities?claim_id=... and only counts the
    // ones whose project_id matches, so the activities have to live
    // under THIS project for the tab's row to render.
    await seedActivity({
      tenantId,
      projectId,
      claimId: claim2025,
      code: 'CA-001',
      kind: 'core',
      title: 'Activity for 2025 claim',
    });
    await seedActivity({
      tenantId,
      projectId,
      claimId: claim2026,
      code: 'CA-001',
      kind: 'core',
      title: 'Activity for 2026 claim',
    });

    await signInAs(context, {
      id: adminId,
      email: 'e2e-A10-detail-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        {
          tenantId,
          name: 'E2E e2e-A10-detail-firm',
          slug: 'e2e-A10-detail-firm',
          role: 'admin',
        },
      ],
    });

    await page.goto(`/projects/${projectId}`);

    // Header — project name in the H1, with the same name potentially
    // appearing in document.title or other regions; getByRole('heading')
    // narrows the match safely.
    await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Default tab is Claims; URL has no ?tab= param.
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await expect(page.getByRole('tab', { name: 'Claims', selected: true })).toBeVisible();

    // Both claim rows visible. Use FY-prefixed labels because the row
    // text is "FY{year} ..." per claims-tab.tsx.
    await expect(page.getByText(/FY2025/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/FY2026/)).toBeVisible();

    // Click the Timeline tab.
    await page.getByRole('tab', { name: 'Timeline', exact: true }).click();
    await expect(page).toHaveURL(/\?tab=timeline/);
    await expect(page.getByRole('tab', { name: 'Timeline', selected: true })).toBeVisible();
    // Empty-state copy from timeline-tab.tsx — we didn't seed any
    // PROJECT_* events so this is the expected render.
    await expect(page.getByText(/No timeline events for this project yet/i)).toBeVisible({
      timeout: 10_000,
    });

    // Click the Settings tab.
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\?tab=settings/);
    await expect(page.getByRole('tab', { name: 'Settings', selected: true })).toBeVisible();
    // Read-only settings header from settings-tab.tsx.
    await expect(page.getByText(/Project details/i)).toBeVisible();

    // Keyboard navigation: ArrowRight from Settings wraps to Claims
    // (WAI-ARIA APG horizontal-tab pattern, project-tabs.tsx). The
    // active tab is what handles the keydown — focus it first so the
    // event lands.
    await page.getByRole('tab', { name: 'Settings', selected: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Claims', selected: true })).toBeVisible();
    // Default tab strips the query param; URL returns to bare /projects/{id}.
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  });
});
