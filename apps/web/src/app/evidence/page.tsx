'use client';
/**
 * /evidence — Evidence tab (top-tab nav).
 *
 * PR #1 stub. Spec from docs/product/client-side-app-spec.md §3:
 *   - AI-classified from raw docs / pics / videos / voice notes
 *   - Aligned to activities (via chain ARTEFACT_LINKED events)
 *   - Plotted on a visual narrative timeline to verify cohesion
 */
import { AppShell } from '@/components/app-shell';
import { FileText } from 'lucide-react';

export default function EvidencePage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-12">
        <div className="flex items-center gap-3 mb-4">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Evidence</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          AI-classified evidence from raw streamed documents, pictures, videos, and voice notes —
          aligned to activities and plotted on a visual timeline to verify the cohesive, succinct
          narrative your claim depends on.
        </p>
        <div className="rounded-md border border-dashed border-border p-6 bg-muted/20">
          <p className="text-sm font-medium mb-2">Coming next</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Per-claimant evidence stream (uploads + email + cloud sync)</li>
            <li>Haiku-classified into activities automatically</li>
            <li>Visual timeline view — drag/drop to re-attribute</li>
            <li>Narrative cohesion score per activity</li>
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
