import { expect, test } from '@playwright/test';

test('anonymous user is redirected from / to /login', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login', { timeout: 10_000 });
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue with Microsoft/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue with Google/i })).toBeVisible();
});
