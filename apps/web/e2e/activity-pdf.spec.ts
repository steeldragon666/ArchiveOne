import { promises as fs } from 'node:fs';
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
 * T-A10 — activity-application PDF download (covers T-A8).
 *
 * Verifies that:
 *   - Clicking the "Download PDF" button on the A5 activity-detail page
 *     triggers a real file download.
 *   - The suggested filename matches the `activity-{code}-{fy}.pdf`
 *     pattern produced by the sanitizer in activity-pdf.ts (the `safeCode`
 *     / `safeYear` `replace` calls — defence-in-depth against header
 *     injection per CWE-93).
 *   - The downloaded payload is non-empty and starts with the `%PDF-`
 *     magic bytes — proving Playwright captured the rendered binary
 *     rather than an HTML error page.
 *
 * Cross-firm 404 (defence-in-depth at the e2e layer):
 *   - Seeds a second firm + activity in TENANT_B.
 *   - Uses Playwright's request context (carries the same cookie as
 *     the page) to GET `/v1/activities/{TENANT_B_id}/application.pdf`
 *     while signed in as TENANT_A's admin.
 *   - Asserts 404 — locks in the route's RLS gate at the integration
 *     boundary (mirrors the unit-test `cross-firm activity ⇒ 404`
 *     contract in activity-pdf.test.ts).
 */
test.describe('Activity application PDF', () => {
  test.afterAll(async () => {
    await cleanupSubjectTenantsByNamePrefix('e2e-A10-pdf-');
    await cleanupBySlugPrefix('e2e-A10-pdf-');
    await cleanupByEmailPrefix('e2e-A10-pdf-');
  });

  test('Download PDF triggers a real file download with sanitized filename', async ({
    page,
    context,
  }) => {
    const tenantId = await seedTenant('e2e-A10-pdf-firm');
    const adminId = await seedUser('e2e-A10-pdf-admin@example.com', 'A10 PDF Admin');
    await seedMembership(tenantId, adminId, 'admin', true);
    const subjectId = await seedSubjectTenant(tenantId, 'e2e-A10-pdf-claimant');

    const projectId = await seedProject({
      tenantId,
      subjectTenantId: subjectId,
      name: 'A10 PDF Project',
      description: 'Catalyst longevity research project (PDF download test).',
    });
    const fiscalYear = 2027;
    const claimId = await seedClaim({
      tenantId,
      subjectTenantId: subjectId,
      fiscalYear,
      stage: 'narrative_drafting',
    });
    const activityCode = 'CA-001';
    const activityId = await seedActivity({
      tenantId,
      projectId,
      claimId,
      code: activityCode,
      kind: 'core',
      title: 'A10 PDF Activity',
      description: 'Bench-test the proprietary catalyst formulation.',
      hypothesis: 'Catalyst will retain >85% activity at 200 hours.',
      technicalUncertainty: 'No published longevity data for this catalyst class.',
      expectedOutcome: 'Establish whether the catalyst meets the design target.',
      actualOutcome: 'Confirmed degradation mechanism is sintering-driven.',
    });

    await signInAs(context, {
      id: adminId,
      email: 'e2e-A10-pdf-admin@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'admin',
      availableTenants: [
        {
          tenantId,
          name: 'E2E e2e-A10-pdf-firm',
          slug: 'e2e-A10-pdf-firm',
          role: 'admin',
        },
      ],
    });

    await page.goto(`/claims/${claimId}/activities/${activityId}`);

    // Activity detail header is up before we look for the button.
    await expect(page.getByRole('heading', { name: 'A10 PDF Activity', exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Download flow — Playwright's `page.waitForEvent('download')` is
    // the canonical pattern. The button is an <a download> wrapped in
    // a Button-as-Slot (apps/web/.../activities/[activity_id]/page.tsx):
    // the browser intercepts the navigation and emits a download event
    // because the response carries `Content-Disposition: attachment`.
    //
    // We trigger via the `data-testid` selector rather than a name regex
    // because the button text "Download PDF" is short enough to collide
    // with any future toast or aria-live region.
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await page.getByTestId('download-application-pdf').click();
    const download = await downloadPromise;

    // Suggested filename matches the activity-{code}-{fy}.pdf pattern.
    // The sanitizer in activity-pdf.ts replaces non-[A-Za-z0-9._-] in
    // `code` with underscore and digits-only in `fy`, so for the canonical
    // `CA-001` / `2027` inputs the filename is unchanged.
    expect(download.suggestedFilename()).toMatch(/^activity-CA-001-\d{4}\.pdf$/);
    expect(download.suggestedFilename()).toBe(`activity-${activityCode}-${fiscalYear}.pdf`);

    // Download body — non-empty + first 5 bytes are `%PDF-` (PDF magic).
    // `path()` resolves to the temp-file Playwright wrote the bytes to.
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const bytes = await fs.readFile(downloadPath!);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  test('cross-firm activity PDF download returns 404', async ({ context }) => {
    // TENANT_A admin is the caller; TENANT_B owns the activity. The two
    // firms are isolated via RLS — `activity-pdf.ts` adds an explicit
    // `AND a.tenant_id = ${tenantId}` filter on top, so even if a future
    // RLS bug widened visibility the route still 404s. This test locks
    // in that contract at the e2e layer.
    const tenantA = await seedTenant('e2e-A10-pdf-cross-firm-a');
    const adminA = await seedUser('e2e-A10-pdf-cross-firm-a@example.com', 'A10 PDF Cross A');
    await seedMembership(tenantA, adminA, 'admin', true);
    const subjectA = await seedSubjectTenant(tenantA, 'e2e-A10-pdf-cross-firm-claimant-a');

    const tenantB = await seedTenant('e2e-A10-pdf-cross-firm-b');
    const adminB = await seedUser('e2e-A10-pdf-cross-firm-b@example.com', 'A10 PDF Cross B');
    await seedMembership(tenantB, adminB, 'admin', true);
    const subjectB = await seedSubjectTenant(tenantB, 'e2e-A10-pdf-cross-firm-claimant-b');

    const projectB = await seedProject({
      tenantId: tenantB,
      subjectTenantId: subjectB,
      name: 'A10 PDF Cross-Firm Project',
    });
    const claimB = await seedClaim({
      tenantId: tenantB,
      subjectTenantId: subjectB,
      fiscalYear: 2028,
    });
    const activityB = await seedActivity({
      tenantId: tenantB,
      projectId: projectB,
      claimId: claimB,
      code: 'CA-001',
      kind: 'core',
      title: 'Cross-firm B activity',
    });

    await signInAs(context, {
      id: adminA,
      email: 'e2e-A10-pdf-cross-firm-a@example.com',
      primaryIdp: 'microsoft',
      activeTenantId: tenantA,
      activeRole: 'admin',
      availableTenants: [
        {
          tenantId: tenantA,
          name: 'E2E e2e-A10-pdf-cross-firm-a',
          slug: 'e2e-A10-pdf-cross-firm-a',
          role: 'admin',
        },
      ],
    });

    // Hit the API directly — `context.request` uses the same cookie jar
    // we just populated, so the request is authenticated as adminA.
    // Bypass the Next rewrite by talking to the API origin straight up;
    // the rewrite is HTTP→HTTP so it would 404 the same way, but going
    // direct gives a tighter error envelope to assert against.
    const res = await context.request.get(
      `http://localhost:3000/v1/activities/${activityB}/application.pdf`,
    );
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('activity_not_found');
  });
});
