'use client';

import { useQuery } from '@tanstack/react-query';
import type { Activity, WorkflowStepEntry } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';
import type { CanAdvance } from '../_lib/workflow-client';
import { ActivityAttributionPanel } from './activity-attribution-panel';
import { AgreeStepButton } from './agree-step-button';
import { StaleStepBanner } from './stale-step-banner';

/**
 * Wizard Step 3 — Attribute Evidence.
 *
 * Activity-first attribution: each agreed activity gets its own panel
 * showing currently bound events (with a "Suggested" badge for
 * auto-allocator picks) plus an "Add evidence" button that opens a
 * chooser populated with events from this claim's subject_tenant.
 *
 * The earlier implementation passed `eventId=""` to `BindToActivityButton`,
 * which is event-first by design (open from an event row, pick activities
 * to bind it to). That mismatch produced an unusable dialog — the
 * artefact-link POST would have written empty `artefact_id` (or 400'd at
 * the Zod validator). C3 fix replaces the misuse with the dedicated
 * `EventPickerDialog`, which is activity-first end-to-end.
 *
 * `canAdvance(3)` is derived server-side from agreed activities without
 * bindings; the `EventPickerDialog` and `BoundEventRow` mutations
 * invalidate `['workflow', claimId]` so the gate re-derives every time
 * the consultant adds or removes a binding.
 */
export function WizardStep3AttributeEvidence({
  claimId,
  subjectTenantId,
  stepEntry,
  canAdvance,
  onNext,
}: {
  claimId: string;
  subjectTenantId: string;
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
  onNext: () => void;
}) {
  const activitiesQuery = useQuery({
    queryKey: ['activities', 'claim', claimId] as const,
    queryFn: () =>
      apiFetch<{ activities: Activity[] }>(
        `/v1/activities?claim_id=${encodeURIComponent(claimId)}`,
      ),
    staleTime: 30_000,
  });

  return (
    <section className="space-y-6" data-testid="wizard-step-3">
      <StaleStepBanner stepEntry={stepEntry} canAdvance={canAdvance} />
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">Attribute Evidence</h2>
        <p className="text-sm text-muted-foreground">
          Link evidence to the R&amp;D activities they support. Items tagged{' '}
          <span className="font-mono text-[10px] uppercase tracking-widest">Suggested</span> were
          auto-allocated by the model — review and unlink if any look wrong.
        </p>
      </header>

      {activitiesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading activities…</p>
      ) : activitiesQuery.error ? (
        <p className="text-sm text-destructive">
          Failed to load activities:{' '}
          {activitiesQuery.error instanceof Error ? activitiesQuery.error.message : 'Unknown error'}
        </p>
      ) : (activitiesQuery.data?.activities ?? []).length === 0 ? (
        <div className="rounded border border-[hsl(var(--brand-line))] p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No activities have been created yet. Go back to Step 2 and approve the AI narrative to
            auto-create activities.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(activitiesQuery.data?.activities ?? []).map((activity) => (
            <ActivityAttributionPanel
              key={activity.id}
              activity={activity}
              claimId={claimId}
              subjectTenantId={subjectTenantId}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--brand-line))] pt-4">
        <AgreeStepButton
          claimId={claimId}
          step={3}
          canAdvance={canAdvance}
          onSuccess={onNext}
          label="Next: Narrative & Timeline →"
        />
      </div>
    </section>
  );
}
