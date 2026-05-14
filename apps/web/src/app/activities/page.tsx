'use client';
/**
 * /activities — Activities tab (top-tab nav).
 *
 * PR #1 stub: renders inside the new top-tab AppShell so the tab is
 * navigable, but content is a placeholder pointing at the next PR that
 * fills it in.
 *
 * Spec (from docs/product/client-side-app-spec.md §3):
 *   - Continuing activities from previous years
 *   - Core + supporting activities for current FY
 *   - Created via streaming intake (email/app) OR inferred from bulk data
 *   - Scoped to a single claimant once one is selected on the Claimants tab
 */
import { AppShell } from '@/components/app-shell';
import { Beaker } from 'lucide-react';

export default function ActivitiesPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-12">
        <div className="flex items-center gap-3 mb-4">
          <Beaker className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Activities</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          Continuing and current-FY R&amp;D activities — core and supporting. Inferred from streamed
          claimant inputs (email, mobile, cloud sync) or bulk data analysis.
        </p>
        <div className="rounded-md border border-dashed border-border p-6 bg-muted/20">
          <p className="text-sm font-medium mb-2">Coming next</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Pick a claimant first on the Claimants tab — activities scope to them</li>
            <li>Streaming intake from email + mobile app + Google Drive / Xero</li>
            <li>AI inference of activities from raw evidence streams</li>
            <li>Consultant override of any auto-generated activity</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
