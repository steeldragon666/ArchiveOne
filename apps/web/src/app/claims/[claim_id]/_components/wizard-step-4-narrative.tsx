'use client';

import { useQuery } from '@tanstack/react-query';
import type { Claim } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { NarrativeStream } from './narrative-stream';
import { FiscalYearTimeline } from './fiscal-year-timeline';
import { fetchAnalysisEvents } from '../_lib/analysis-api';
import type { CanAdvance } from '../_lib/workflow-client';

/**
 * Wizard Step 4 -- Narrative & Timeline.
 *
 * Split-pane layout: the synthesised R&D narrative on the left and the
 * fiscal-year timeline on the right. The narrative is populated by
 * `fetchAnalysisEvents` (which returns `AnalysisEvent[]` ready for
 * NarrativeStream) and the timeline is rendered by FiscalYearTimeline
 * (which fetches its own data internally).
 */
export function WizardStep4ReviewNarrative({
  claimId,
  subjectTenantId,
  claim,
  canAdvance,
  onNext,
}: {
  claimId: string;
  subjectTenantId: string;
  claim: Claim;
  canAdvance: CanAdvance;
  onNext: () => void;
}) {
  const eventsQuery = useQuery({
    queryKey: ['analysis-events', claimId, subjectTenantId] as const,
    queryFn: () => fetchAnalysisEvents(claimId, subjectTenantId),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-6" data-testid="wizard-step-4">
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Narrative &amp; Timeline
        </h2>
        <p className="text-sm text-muted-foreground">
          Review the synthesised R&amp;D narrative and verify the fiscal-year timeline. The
          narrative is built from your classified evidence and activity definitions.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left pane: Narrative */}
        <div className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-5 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            R&amp;D Narrative
          </p>

          {eventsQuery.isPending && (
            <p className="text-sm text-muted-foreground">Loading narrative...</p>
          )}

          {eventsQuery.error && (
            <p className="text-sm text-destructive">
              Failed to load events:{' '}
              {eventsQuery.error instanceof Error ? eventsQuery.error.message : 'Unknown error'}
            </p>
          )}

          {eventsQuery.data && (
            <NarrativeStream claimId={claimId} events={eventsQuery.data} live={false} />
          )}
        </div>

        {/* Right pane: Timeline */}
        <div className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-5 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Fiscal Year Timeline
          </p>
          <FiscalYearTimeline claim={claim} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--brand-line))] pt-4">
        {!canAdvance.ok && (
          <p className="mr-auto text-sm text-muted-foreground">{canAdvance.reason}</p>
        )}
        <Button onClick={onNext} disabled={!canAdvance.ok}>
          Next: Generate Documents &rarr;
        </Button>
      </div>
    </section>
  );
}
