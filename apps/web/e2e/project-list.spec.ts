import { expect, test } from '@playwright/test';
import { signInAs } from './fixtures/auth';
import {
  cleanupByEmailPrefix,
  cleanupBySlugPrefix,
  cleanupSubjectTenantsByNamePrefix,
  seedMembership,
  seedProject,
  seedSubjectTenant,
  seedTenant,
  seedUser,
} from './fixtures/test-data';

/**
 * T-A10 — /projects list filter strip + click-into-detail (covers T-A7).
 *
 * Verifies that:
 *   - The default-active filter shows the active project but not the
 *     archived one.
 *   - Switching to the "Archived" chip surfaces the empty-state copy
 *     that documents the API's current archived_at IS NULL hardcode
 *     (A7 fix — tightened copy so the consultant knows nothing's broken).
 *   - Clicking the active project's row navigates to /projects/{id}
 *     and the detail header renders the project name.
 *
 * The page renders archived rows from the wire shape ONLY when the API
 * returns them; today /v1/projects hardcodes WHERE archived_at IS NULL
 * (per project-list.tsx docstring), so the Archived chip's natural
 * outcome is "no rows + empty state" — which is exactly what we assert.
 */
test.describe('Project list', () => {
  test.afterAll(async () => {
    await cleanupSubjectTenantsByNamePrefix('e2e-A10-projects-');
    await cleanupBySlugPrefix('e2e-A10-projects-');
    await cleanupByEmailPrefix('e2e-A10-projects-');
  });

  test('admin filters by status and clicks into a project detail', async ({ page, context }) => {
    const tenantId = await seedTenant('e2e-A10-projects-firm');
    const adminId = await seedUser('e2e-A10-projects-admin@example.com', 'A10 Projects Admin');
    await seedMembership(tenantId, adminId, 'admin', true);
    const subjectId = await seedSubjectTenant(tenantId, 'e2e-A10-projects-claimant');

    const activeProjectName = 'A10 Active Project';
    const archivedProjectName = 'A10 Archived Project';

    const activeProjectId = await seedProject({
      tenantId,
      subjectTenantId: subjectId,
      name: activeProjectName,
      description: 'Long-lived R&D for the active filter test.',
    });
    await seedProject({
      tenantId,
      subjectTenantId: subjectId,
      name: archivedProjectName,
      description: 'Already wrapped — only visible if the API ever exposes archived rows.',
      archivedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    await signInAs(context, {
      id: adminId,
      email: 'e2e-A10-projects-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        {
          tenantId,
          name: 'E2E e2e-A10-projects-firm',
          slug: 'e2e-A10-projects-firm',
          role: 'admin',
        },
      ],
    });

    await page.goto('/projects');

    // Page heading + active project visible.
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByText(activeProjectName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Archived project is filtered out by the default Active chip.
    // Today the API also filters server-side (archived_at IS NULL), so
    // even widening to All wouldn't surface it; the assertion is the
    // user-visible contract regardless of which side does the filtering.
    await expect(page.getByText(archivedProjectName, { exact: true })).not.toBeVisible();

    // Click the Archived chip — chips are role="tab" (project-list.tsx
    // hand-rolls a tablist for the status strip). The empty-state copy
    // that lands documents the current archived-projects API gap.
    await page.getByRole('tab', { name: 'Archived', exact: true }).click();
    await expect(page).toHaveURL(/\?status=archived/);
    await expect(page.getByText(/No archived projects/i)).toBeVisible();
    // A7 fix tightened the explanatory copy so the consultant knows the
    // page isn't broken — the API hardcodes `archived_at IS NULL` until
    // a follow-up widens the response.
    await expect(page.getByText(/archived projects entirely/i)).toBeVisible();

    // Switch back to Active, click into the active project.
    await page.getByRole('tab', { name: 'Active', exact: true }).click();
    // The Active chip is the default state, so the URL collapses back to
    // /projects without the `status=` query param. Two assertions are
    // easier to read than the equivalent `(?!.*status=)` lookahead:
    // (1) URL is /projects (with or without an unrelated query string),
    // (2) it does NOT carry a `status=` filter.
    await expect(page).toHaveURL(/\/projects(\?|$)/);
    await expect(page).not.toHaveURL(/status=/);
    await page.getByRole('link', { name: new RegExp(activeProjectName, 'i') }).click();

    // URL navigates to /projects/{uuid} and the detail header shows the
    // project name. Use getByRole('heading') (not getByText) to avoid
    // strict-mode collisions with the document.title or any toast/aria-
    // live region that might mirror the name.
    await page.waitForURL(new RegExp(`/projects/${activeProjectId}$`));
    await expect(page.getByRole('heading', { name: activeProjectName, exact: true })).toBeVisible();
  });
});
