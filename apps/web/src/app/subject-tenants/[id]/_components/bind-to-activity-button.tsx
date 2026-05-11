'use client';
/**
 * BindToActivityButton — opens a Dialog that lets the consultant link
 * a chain event (evidence file or other artefact) to one or more
 * activities across the claimant's claims.
 *
 * Pattern: mirrors create-claimant-button.tsx (Dialog + TanStack mutation
 * + toast) and create-project-button.tsx (dependency-guard empty state
 * when no activities exist yet).
 *
 * API: POST /v1/activities/:activity_id/artefact-links once per selected
 * activity, fanned out in parallel. On success: invalidate
 * ['events', subjectTenantId] and ['activity-artefacts', activityId] for
 * every linked activity.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { Activity, Claim } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api';
import {
  createArtefactLink,
  listActivitiesForClaim,
  listClaimsForSubjectTenant,
  type ClaimWithActivities,
} from '../_lib/binding-api';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function fiscalYearLabel(fy: number): string {
  // Australian R&DTI convention: FY2025 = year ending June 2025.
  return `FY${fy}`;
}

// -----------------------------------------------------------------------
// Data hook: loads claims + activities for the claimant
// -----------------------------------------------------------------------

async function loadClaimsWithActivities(subjectTenantId: string): Promise<ClaimWithActivities[]> {
  const claims = await listClaimsForSubjectTenant(subjectTenantId);
  if (claims.length === 0) return [];

  // Fetch activities for all claims in parallel.
  const activityLists = await Promise.all(
    claims.map((c) => listActivitiesForClaim(c.id).catch(() => [] as Activity[])),
  );

  return claims.map((claim, i) => ({
    claim,
    activities: activityLists[i] ?? [],
  }));
}

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

export interface BindToActivityButtonProps {
  /** The chain event id that will become the `artefact_id` in the link. */
  eventId: string;
  /** Name of the file / event shown in the dialog header. */
  filename: string;
  /** Which claimant this event belongs to. */
  subjectTenantId: string;
  /** Trigger label override (default: "Bind to activity"). */
  triggerLabel?: string;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function BindToActivityButton({
  eventId,
  filename,
  subjectTenantId,
  triggerLabel = 'Bind to activity',
}: BindToActivityButtonProps) {
  const [open, setOpen] = useState(false);
  // Checkboxes: set of activity IDs the consultant has ticked.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const qc = useQueryClient();
  const { toast } = useToast();

  // Fetch claims + activities when the dialog opens — same lazy pattern
  // as CreateProjectButton's subjectTenants query.
  const claimsQuery = useQuery({
    queryKey: ['bind-dialog-claims', subjectTenantId],
    queryFn: () => loadClaimsWithActivities(subjectTenantId),
    enabled: open,
    staleTime: 30_000,
  });

  const claimsWithActivities: ClaimWithActivities[] = claimsQuery.data ?? [];
  const totalActivities = claimsWithActivities.reduce((n, c) => n + c.activities.length, 0);
  const hasNoActivities = claimsQuery.isSuccess && totalActivities === 0;
  const hasNoClaims = claimsQuery.isSuccess && claimsWithActivities.length === 0;

  // Map activity_id → Claim so we know which claim to link to after submit.
  // TODO: wire up post-submit redirect that consumes this map.
  const _activityToClaimMap = new Map<string, Claim>(
    claimsWithActivities.flatMap((cwa) =>
      cwa.activities.map((a) => [a.id, cwa.claim] as [string, Claim]),
    ),
  );

  const mutation = useMutation({
    mutationFn: async (activityIds: string[]) => {
      // Fan out in parallel — one POST per selected activity.
      const results = await Promise.allSettled(
        activityIds.map((activityId) =>
          createArtefactLink(activityId, {
            artefact_kind: 'event',
            artefact_id: eventId,
            link_reason: 'consultant manual link',
          }),
        ),
      );

      const succeeded: string[] = [];
      const failed: Array<{ activityId: string; message: string }> = [];

      results.forEach((result, i) => {
        const activityId = activityIds[i];
        if (activityId === undefined) return;
        if (result.status === 'fulfilled') {
          succeeded.push(activityId);
        } else {
          // result.reason is typed `any` by the TS lib; narrow to unknown.
          const err: unknown = result.reason;
          failed.push({
            activityId,
            message:
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Unknown error',
          });
        }
      });

      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      // Invalidate the events feed so linked-to chips refresh.
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });

      // Invalidate per-activity artefact lists for every newly linked activity.
      for (const activityId of succeeded) {
        void qc.invalidateQueries({ queryKey: ['activity-artefacts', activityId] });
      }

      if (failed.length > 0) {
        // Surface per-link errors but don't block on them.
        toast({
          title: `Linked to ${succeeded.length} of ${succeeded.length + failed.length} activities`,
          description: `${failed.length} link${failed.length === 1 ? '' : 's'} failed: ${failed
            .map((f) => f.message)
            .slice(0, 2)
            .join(' · ')}${failed.length > 2 ? ' · …' : ''}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Linked to ${succeeded.length} ${succeeded.length === 1 ? 'activity' : 'activities'}`,
        });
      }

      setOpen(false);
      setSelected(new Set());
    },
    onError: (err) => {
      toast({
        title: 'Binding failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const toggleActivity = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!mutation.isPending) {
      setOpen(next);
      if (!next) setSelected(new Set());
    }
  };

  const handleSubmit = () => {
    const activityIds = Array.from(selected);
    if (activityIds.length === 0) return;
    mutation.mutate(activityIds);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {triggerLabel}
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">
            Bind &ldquo;{filename}&rdquo; to one or more activities
          </DialogTitle>
          <DialogDescription>
            Select the activities this evidence supports. Each link is recorded as an immutable
            chain event.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[120px] max-h-[380px] overflow-y-auto -mx-1 px-1">
          {claimsQuery.isPending ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Loading activities&hellip;
            </p>
          ) : claimsQuery.isError ? (
            <p className="text-sm text-destructive py-4">
              Failed to load activities. Try closing and reopening.
            </p>
          ) : hasNoClaims ? (
            // No claims exist at all — point the consultant to the claims tab.
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground">
                This claimant has no claims yet. Create a claim first, then add activities before
                binding evidence.
              </p>
            </div>
          ) : hasNoActivities ? (
            // Claims exist but none have activities — dependency guard.
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground">
                No activities have been created under any claim for this claimant. Create your first
                activity in the relevant claim&apos;s Activities tab.
              </p>
              <div className="flex flex-col gap-1.5">
                {claimsWithActivities.map(({ claim }) => (
                  <Link
                    key={claim.id}
                    href={`/claims/${claim.id}?tab=activities`}
                    className="text-sm text-primary hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    {fiscalYearLabel(claim.fiscal_year)} &rarr; Activities tab
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            // Normal case: render claims grouped with their activities.
            <div className="space-y-4 py-1">
              {claimsWithActivities.map(({ claim, activities }) => (
                <div key={claim.id}>
                  {/* Claim heading */}
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                    {fiscalYearLabel(claim.fiscal_year)} — {claim.stage.replace(/_/g, ' ')}
                  </p>

                  {activities.length === 0 ? (
                    <p className="ml-3 text-xs text-muted-foreground italic">
                      (no activities yet &mdash;{' '}
                      <Link
                        href={`/claims/${claim.id}?tab=activities`}
                        className="text-primary hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        create one first
                      </Link>
                      )
                    </p>
                  ) : (
                    <ul className="space-y-1 ml-3">
                      {activities.map((activity) => {
                        const isChecked = selected.has(activity.id);
                        return (
                          <li key={activity.id}>
                            <label className="flex items-start gap-2.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--primary))] cursor-pointer shrink-0"
                                checked={isChecked}
                                disabled={mutation.isPending}
                                onChange={() => toggleActivity(activity.id)}
                              />
                              <span className="text-sm leading-tight group-hover:text-primary transition-colors">
                                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mr-1.5">
                                  {activity.code}
                                </span>
                                {activity.title}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || selected.size === 0}
          >
            {mutation.isPending
              ? 'Binding…'
              : selected.size === 0
                ? 'Select an activity'
                : `Bind to ${selected.size} ${selected.size === 1 ? 'activity' : 'activities'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
