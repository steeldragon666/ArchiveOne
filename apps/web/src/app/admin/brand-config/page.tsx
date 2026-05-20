'use client';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { BrandConfigForm } from './_components/brand-config-form';

/**
 * /admin/brand-config — firm-level white-label settings (T-C1).
 *
 * Wraps content in <AuthGuard>, matching the P1+P2 flat-route convention
 * used by `/users`, `/tenants`, and `/subject-tenants` (no `(authed)`
 * route group). Render structure:
 *
 *   AuthGuard → page chrome (h1 + description) → Suspense → form.
 *
 * The form is a client component because it pulls TanStack Query for the
 * read + react-hook-form for the edit, and resolves the active tenant
 * from useWhoami. C1 scaffolds the page; C2-C4 layer in logo upload,
 * theme picker, and the text fields (display_name, support_email,
 * terms_of_service_url).
 */
export default function BrandConfigPage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Administration
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Brand &amp; white-label
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Configure your firm&apos;s logo, colours, and branding. The mobile app and claimant
            dashboard inherit these settings.
          </p>
        </header>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <BrandConfigForm />
        </Suspense>
      </div>
    </AppShell>
  );
}
