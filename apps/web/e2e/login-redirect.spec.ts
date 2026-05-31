import { expect, test } from '@playwright/test';

/**
 * SKIPPED 2026-05-31 — auto-redirect from a protected route to /login no
 * longer exists in the current architecture. The new entry flow is:
 *   /              → marketing landing (next.config.ts rewrite to /landing)
 *   /login         → direct sign-in form (reachable without redirect)
 *   /signup        → onboarding pipeline
 *   /consultant    → workspace (renders even when API calls 401)
 *
 * Pinned in task #66: decide whether to reinstate an AuthGuard that
 * redirects unauthenticated access to `/dashboard`, `/claims`, etc., to
 * `/login?next=…`. Until then, /login is reachable directly — verify the
 * page renders.
 */
test('/login renders the sign-in form for anonymous users', async ({ page }) => {
  await page.goto('/login');
  // The brand swept Claimsure → ArchiveOne, and the login page now reads
  // "Log in to ArchiveOne" as its primary heading. The Microsoft / Google
  // OAuth entry points moved into the magic-link → SSO flow, so this is a
  // pure brand-and-presence check.
  await expect(page.getByRole('heading', { name: /Log in to ArchiveOne/i })).toBeVisible();
  await expect(page.getByText(/approved firm workspace/i)).toBeVisible();
});
