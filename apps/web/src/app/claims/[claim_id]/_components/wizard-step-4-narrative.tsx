'use client';

import { useQuery } from '@tanstack/react-query';
import type { Claim, WorkflowStepEntry } from '@cpa/schemas';
import { NarrativeStream } from './narrative-stream';
import { FiscalYearTimeline } from './fiscal-year-timeline';
import { fetchAnalysisEvents } from '../_lib/analysis-api';
import {
  getWorkflow,
  type CanAdvance,
  type NarrativeSectionKind,
  type NarrativeSectionStatus,
} from '../_lib/workflow-client';
import { StaleStepBanner } from './stale-step-banner';
import { AgreeStepButton } from './agree-step-button';
import { NarrativeSectionAgreeButton } from './narrative-section-agree-button';

/**
 * Display order + human label for the four narrative section_kinds.
 * Matches the schema enum in `@cpa/db/schema` (`NARRATIVE_SECTION_KINDS`)
 * and the wizard plan's ordering: hypothesis → uncertainty → experiments →
 * new knowledge mirrors the R&DTI core-activity narrative arc.
 */
const NARRATIVE_SECTIONS: { kind: NarrativeSectionKind; label: string }[] = [
  { kind: 'new_knowledge', label: 'New knowledge' },
  { kind: 'hypothesis', label: 'Hypothesis' },
  { kind: 'uncertainty', label: 'Uncertainty' },
  { kind: 'experiments_and_results', label: 'Experiments & Results' },
];

const FALLBACK_SECTIONS: Record<NarrativeSectionKind, NarrativeSectionStatus> = {
  new_knowledge: 'absent',
  hypothesis: 'absent',
  uncertainty: 'absent',
  experiments_and_results: 'absent',
};

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
  stepEntry,
  canAdvance,
  onNext,
}: {
  claimId: string;
  subjectTenantId: string;
  claim: Claim;
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
  onNext: () => void;
}) {
  const eventsQuery = useQuery({
    queryKey: ['analysis-events', claimId, subjectTenantId] as const,
    queryFn: () => fetchAnalysisEvents(claimId, subjectTenantId),
    staleTime: 30_000,
  });

  // Re-read the workflow query for `derived.narrativeSections`. Same
  // queryKey as the orchestrator → cache hit, no extra round trip. The
  // per-section Agree buttons invalidate this same key on success, which
  // refreshes BOTH the per-section status AND canAdvance(4) the parent
  // passed in (the parent re-renders on the same invalidation).
  const workflowQuery = useQuery({
    queryKey: ['workflow', claimId] as const,
    queryFn: () => getWorkflow(claimId),
  });
  const narrativeSections = workflowQuery.data?.derived.narrativeSections ?? FALLBACK_SECTIONS;

  return (
    <section className="space-y-6" data-testid="wizard-step-4">
      <StaleStepBanner stepEntry={stepEntry} canAdvance={canAdvance} />
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Narrative &amp; Timeline
        </h2>
        <p className="text-sm text-muted-foreground">
          Review the synthesised R&amp;D narrative and verify the fiscal-year timeline. The
          narrative is built from your classified evidence and activity definitions.
        </p>
      </header>

      {/*
       * Per-section Agree panel. Each of the four narrative section_kinds
       * surfaces an independent status pill / Agree button. When all four
       * are 'accepted', `canAdvance(4)` flips to ok=true on the next
       * workflow query — gating the "Next: Generate Documents →" button
       * at the bottom of the step.
       */}
      <div
        className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-5 space-y-3"
        data-testid="wizard-step-4-section-agree-panel"
      >
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Approve narrative sections
          </p>
          <p className="text-xs text-muted-foreground">
            Approve each section independently. All four must be approved to advance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {NARRATIVE_SECTIONS.map(({ kind, label }) => (
            <NarrativeSectionAgreeButton
              key={kind}
              claimId={claimId}
              sectionKind={kind}
              status={narrativeSections[kind]}
              label={label}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left pane: Narrative */}
        <div className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-5 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            R&amp;D Narrative
          </p>

          {eventsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading narrative...</p>
          ) : eventsQuery.error ? (
            <p className="text-sm text-destructive">
              Failed to load events:{' '}
              {eventsQuery.error instanceof Error ? eventsQuery.error.message : 'Unknown error'}
            </p>
          ) : eventsQuery.data ? (
            <NarrativeStream claimId={claimId} events={eventsQuery.data} live={false} />
          ) : null}
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
        <AgreeStepButton
          claimId={claimId}
          step={4}
          canAdvance={canAdvance}
          onSuccess={onNext}
          label="Next: Generate Documents →"
        />
      </div>
    </section>
  );
}
