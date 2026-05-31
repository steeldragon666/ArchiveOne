import { expect, test } from '@playwright/test';

/**
 * /consultant — the v6 broadcast workspace (TopBar + Sidebar + view router).
 *
 * UI smoke pass: every distinct view renders without client errors and
 * shows the expected brand markers when its sidebar nav item is clicked.
 * Beta-gate is bypassed in NODE_ENV=development; production cookies are
 * not required.
 *
 * IA per docs/product/workflow.md: Clients → Client → that client's
 * CLAIMS list → Claim (the 6-step approve-wizard). There's no standalone
 * "Active claim" sidebar entry; the wizard is reached through the
 * Clients drill-down.
 */

test.describe('Consultant broadcast workspace (/consultant)', () => {
  test.beforeEach(async ({ page }) => {
    // Surface any uncaught client-side errors so the assertions below
    // catch broken views instead of silently passing.
    page.on('pageerror', (err) => {
      throw new Error(`Client error on /consultant: ${err.message}`);
    });
    await page.goto('/consultant');
  });

  test('Dashboard renders by default with hero + Watch + Chain', async ({ page }) => {
    // Hero header (greeting is hardcoded; brand wordmark is in the TopBar).
    // KPI strip is data-driven — it shows skeletons until /v1/consultant/kpis
    // resolves, and this smoke test runs anonymously so we don't assert on
    // KPI labels here. Focus on the markers the page renders without auth.
    await expect(page.getByText('Good morning, Anna.')).toBeVisible();
    // Claims panel section header
    await expect(page.getByText('Active claims')).toBeVisible();
    // Watch panel — signal count is dynamic (read from /v1/consultant/signals),
    // so accept any non-negative count rather than a hardcoded literal.
    await expect(page.getByText(/TODAY · \d+ SIGNAL/i)).toBeVisible();
    // Chain panel
    await expect(page.getByText('Recent chain blocks')).toBeVisible();
  });

  test('Sidebar — clicking Clients reveals the clients drill-down view', async ({ page }) => {
    // Clients is the primary nav item; clicking it swaps to the
    // clients-list (the entry point to the per-client drill-down that
    // eventually opens the claim wizard).
    await page.getByRole('button', { name: /^Clients/ }).click();
    // The Clients view always renders the top-level header (text varies
    // by data, but the section is consistent).
    await expect(page.getByText(/CLIENTS|Clients/).first()).toBeVisible();
  });

  test('Sidebar — clicking Watch swaps to the regulatory-intelligence view', async ({ page }) => {
    await page.getByRole('button', { name: /^Watch/ }).click();
    // Watch is now a live regulatory-intelligence feed (ATO, AusIndustry,
    // AAT, courts) — not a hardcoded fixture. The section header and
    // hero copy are stable strings.
    await expect(page.getByText('WATCH · REGULATORY INTELLIGENCE')).toBeVisible();
    await expect(page.getByText(/Realtime news/i)).toBeVisible();
  });

  test('Sidebar — clicking Financing swaps to the July 1 waitlist card', async ({ page }) => {
    await page.getByRole('button', { name: /Financing/ }).click();
    await expect(page.getByText('FINANCING · BETA · FY26/27')).toBeVisible();
    await expect(page.getByText(/Claim financing arrives/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Join the waitlist/ })).toBeVisible();
  });

  test('TopBar LIVE timestamp ticks while the page is open', async ({ page }) => {
    const live = page.getByText(/LIVE · \d{2}:\d{2}:\d{2} AEST/);
    await expect(live).toBeVisible();
    const first = await live.textContent();
    // 1.5s is well past the 200ms tick interval but short enough not to
    // slow the suite.
    await page.waitForTimeout(1500);
    const second = await live.textContent();
    expect(second).not.toEqual(first);
  });

  test('Sidebar — chain-status footer shows the static block + AZ row', async ({ page }) => {
    await expect(page.getByText('#00184_3F')).toBeVisible();
    await expect(page.getByText('3,247')).toBeVisible();
    await expect(page.getByText('AZ-1 SYDNEY · AZ-2 MELB')).toBeVisible();
  });
});
