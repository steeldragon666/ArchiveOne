'use client';

import { useQuery } from '@tanstack/react-query';
import type { Activity } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { BindToActivityButton } from '@/app/subject-tenants/[id]/_components/bind-to-activity-button';
import { apiFetch } from '@/lib/api';
import type { CanAdvance } from '../_lib/workflow-client';

/**
 * Wizard Step 3 -- Attribute Evidence.
 *
 * Renders one card per activity with its code, title, and kind badge
 * (core / supporting). Each card embeds a BindToActivityButton so the
 * consultant can link additional evidence documents to that activity.
 *
 * Activities are fetched via the standard GET /v1/activities?claim_id=...
 * endpoint.
 */
export function WizardStep3AttributeEvidence({
  claimId,
  subjectTenantId,
  canAdvance,
  onNext,
}: {
  claimId: string;
  subjectTenantId: string;
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
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">Attribute Evidence</h2>
        <p className="text-sm text-muted-foreground">
          Link evidence documents to the R&amp;D activities they support. The platform has
          auto-suggested bindings where confident — review and adjust as needed.
        </p>
      </header>

      {/* Activity cards */}
      {activitiesQuery.isPending && (
        <p className="text-sm text-muted-foreground">Loading activities...</p>
      )}

      {activitiesQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load activities:{' '}
          {activitiesQuery.error instanceof Error ? activitiesQuery.error.message : 'Unknown error'}
        </p>
      )}

      {activitiesQuery.data && activitiesQuery.data.activities.length === 0 && (
        <div className="rounded border border-[hsl(var(--brand-line))] p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No activities have been created yet. Go back to Step 2 and approve the AI narrative to
            auto-create activities.
          </p>
        </div>
      )}

      {activitiesQuery.data && activitiesQuery.data.activities.length > 0 && (
        <div className="space-y-3">
          {activitiesQuery.data.activities.map((activity) => (
            <div
              key={activity.id}
              className="flex flex-wrap items-start gap-3 rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium">{activity.code}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                      activity.kind === 'core'
                        ? 'bg-[hsl(var(--brand-accent))]/15 text-[hsl(var(--brand-accent-strong))]'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {activity.kind}
                  </span>
                </div>
                <p className="text-sm font-medium leading-tight">{activity.title}</p>
              </div>

              <div className="shrink-0">
                <BindToActivityButton
                  eventId=""
                  filename="evidence"
                  subjectTenantId={subjectTenantId}
                  triggerLabel="Link evidence"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--brand-line))] pt-4">
        {!canAdvance.ok && (
          <p className="mr-auto text-sm text-muted-foreground">{canAdvance.reason}</p>
        )}
        <Button onClick={onNext} disabled={!canAdvance.ok}>
          Next: Narrative &amp; Timeline &rarr;
        </Button>
      </div>
    </section>
  );
}
