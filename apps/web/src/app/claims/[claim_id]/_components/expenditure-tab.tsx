'use client';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Activity } from '@cpa/schemas';
import { useToast } from '@/hooks/use-toast';
import { listActivities, listExpenditures, mapExpenditure } from '../_lib/api';
import { applyMappingOptimistic, type ExpenditureRow } from '../_lib/expenditure-stub';
import { parseExpenditureFilter } from '../_lib/url-params';
import { ExpenditureFilterChips } from './expenditure-filter';
import { ExpenditureRowItem } from './expenditure-row';

/**
 * Expenditure tab — mapping UI for tying Xero expenditures (invoices,
 * bank transactions, receipts) to activities within the current claim.
 *
 * Architecture (controller decision, P4 plan §C5):
 *
 *   Mapping persistence is event-sourced. The eventual A-swimlane
 *   endpoint posts an `EXPENDITURE_MAPPED` event via
 *   `POST /v1/expenditures/:id/map`. Current-mapping state is
 *   projected from that event stream (see
 *   `_lib/expenditure-projection.ts`).
 *
 * C5 ships UI only — the backend stub in `_lib/api.ts` documents the
 * planned wire format with a TODO block. The optimistic update flow is
 * already in place so swap-in is mechanical.
 *
 * State strategy — mirrors `pipeline-kanban.tsx` / `usePipelineClaims`:
 *   1. The query result is the source of truth; we mirror it locally
 *      so we can mutate ahead of the network.
 *   2. On mapExpenditure submit, snapshot the current rows, apply the
 *      optimistic mapping, then call the stub. On any rejection,
 *      revert to the snapshot and toast destructively. On success
 *      (single PATCH today; stays Promise.allSettled-shaped so a future
 *      bulk-map flow drops in cleanly), keep the optimistic state and
 *      toast.
 *   3. When the parent invalidates ['expenditures', ...] the local
 *      mirror re-syncs to the fresh server payload (useEffect).
 */

export function ExpenditureTab({ claimId }: { claimId: string }) {
  const searchParams = useSearchParams();
  const filter = parseExpenditureFilter(searchParams.get('expenditure_filter'));
  const { toast } = useToast();

  // Pre-A?-mapping the listExpenditures stub returns the in-memory
  // fixture filtered by `filter`. The query key is shaped to match the
  // eventual cache shape so swap-in is a one-liner once the backend
  // ships.
  const expendituresQuery = useQuery({
    queryKey: ['expenditures', { claimId, filter }] as const,
    queryFn: () => listExpenditures(claimId, filter),
  });

  const activitiesQuery = useQuery({
    // Match the activities-tab query key — when both tabs render in a
    // session, react-query dedupes the request. The activity list
    // doesn't change with the expenditure filter, so it's keyed only
    // by claim id.
    queryKey: ['activities', { claimId }] as const,
    queryFn: () => listActivities(claimId),
  });

  // --- Optimistic mirror ---
  // The picker writes here ahead of the network; on stub success we
  // keep the change, on rejection we revert. Re-syncs from the parent
  // query whenever the source data changes (filter switch, manual
  // invalidate). Same shape as `useOptimisticClaims` in
  // `pipeline/_lib/use-pipeline-claims.ts`.
  const [optimisticRows, setOptimisticRows] = useState<ExpenditureRow[]>([]);
  useEffect(() => {
    if (expendituresQuery.data) setOptimisticRows(expendituresQuery.data);
  }, [expendituresQuery.data]);

  // --- Per-row pending tracker for the spinner / disabled state ---
  // A Set instead of a single boolean so multiple rows can be in flight
  // independently — matters once the picker UX gains a "map several
  // unmapped rows in a row" rhythm (the user clicks Map → picks → the
  // dropdown closes → they immediately click the next row's Map).
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  const activitiesById = useMemo(() => {
    const m = new Map<string, Activity>();
    for (const a of activitiesQuery.data ?? []) m.set(a.id, a);
    return m;
  }, [activitiesQuery.data]);

  const onMap = useCallback(
    async (expenditureId: string, activityId: string): Promise<void> => {
      const activity = activitiesById.get(activityId);
      if (!activity) {
        // Defensive — picker always passes an activity from the same
        // list, but guard against future code paths.
        toast({
          title: 'Mapping failed',
          description: 'Selected activity not found.',
          variant: 'destructive',
        });
        return;
      }

      // Snapshot for revert; build the optimistic mapping payload.
      const snapshot = optimisticRows;
      const mapping = {
        activity_id: activity.id,
        activity_code: activity.code,
        activity_title: activity.title,
        mapped_at: new Date().toISOString(),
      };
      setOptimisticRows((prev) => applyMappingOptimistic(prev, expenditureId, mapping));
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(expenditureId);
        return next;
      });

      // Promise.allSettled-shaped even though there's a single call —
      // matches the C2-fix aggregation pattern in
      // `runStageMutationsBatch` so the future bulk-map flow drops in
      // without restructuring the toast logic.
      const results = await Promise.allSettled([mapExpenditure(expenditureId, activityId)]);
      const failed = results.filter((r) => r.status === 'rejected').length;

      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(expenditureId);
        return next;
      });

      if (failed > 0) {
        // Diagnostic for failed maps; toast is the user-facing surface.
        for (const r of results) {
          if (r.status === 'rejected') {
            console.error(`mapExpenditure failed for ${expenditureId}:`, r.reason);
          }
        }
        setOptimisticRows(snapshot);
        toast({
          title: 'Mapping failed',
          description: `Could not map to ${activity.code}. Please try again.`,
          variant: 'destructive',
        });
        return;
      }

      // Success toast — deliberately fires even though the row may
      // disappear from view (filter = "Unmapped" + the row just got
      // mapped). Without it the user has no acknowledgement that the
      // action succeeded; the disappearing row is otherwise
      // indistinguishable from a swallowed error.
      toast({
        title: `Mapped to ${activity.code}`,
        description: activity.title,
      });
    },
    [activitiesById, optimisticRows, toast],
  );

  if (expendituresQuery.isPending || activitiesQuery.isPending) {
    return <p className="text-sm text-muted-foreground">Loading expenditures…</p>;
  }
  if (expendituresQuery.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load expenditures:{' '}
        {expendituresQuery.error instanceof Error
          ? expendituresQuery.error.message
          : 'Unknown error'}
      </p>
    );
  }
  if (activitiesQuery.error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load activities:{' '}
        {activitiesQuery.error instanceof Error ? activitiesQuery.error.message : 'Unknown error'}
      </p>
    );
  }

  const activities = activitiesQuery.data;

  return (
    <div className="space-y-4">
      <ExpenditureFilterChips active={filter} />

      {optimisticRows.length === 0 ? (
        <EmptyState
          filter={filter}
          // True when every server-loaded row in the unfiltered list is
          // empty — i.e. there's nothing synced yet, vs. the filter
          // narrowed everyone away. We can't know the unfiltered count
          // without a second fetch, so we infer: if the filter is "all"
          // and we got zero rows, the firm has nothing synced.
          firmHasNothing={filter === 'all'}
        />
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {optimisticRows.map((row) => (
            <ExpenditureRowItem
              key={row.id}
              row={row}
              activities={activities}
              isPending={pendingIds.has(row.id)}
              onMap={(activityId) => void onMap(row.id, activityId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Dual-shape empty state. The "no expenditures synced" copy is the
 * onboarding hint (consultant lands on a fresh firm); the "no rows
 * match filter" copy is the workflow congratulation (everything's
 * mapped). Splitting the messaging matters because the user actions
 * differ: one points at the integrations page, the other says "nice
 * work" and suggests broadening the filter.
 */
function EmptyState({
  filter,
  firmHasNothing,
}: {
  filter: 'all' | 'unmapped' | 'mapped';
  firmHasNothing: boolean;
}) {
  if (firmHasNothing) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No Xero expenditures synced for this firm yet.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Connect Xero in integrations to start syncing invoices, bank transactions, and receipts.
        </p>
      </div>
    );
  }
  if (filter === 'unmapped') {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">No unmapped expenditures — nice work.</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Switch to All or Mapped above to see the rest.
        </p>
      </div>
    );
  }
  // filter === 'mapped' with zero rows.
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">
        No mapped expenditures yet. Switch to Unmapped above to start mapping.
      </p>
    </div>
  );
}
