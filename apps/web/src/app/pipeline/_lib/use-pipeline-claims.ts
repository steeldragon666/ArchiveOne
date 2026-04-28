'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CLAIM_STAGES_LITERAL, type Claim, type ClaimStage } from '@cpa/schemas';
import { useToast } from '@/hooks/use-toast';
import { patchClaimStage, type PatchClaimStageInput } from './api';

/**
 * Toast shape we depend on. Imported via `useToast` in the hook, but the
 * pure `runStageMutationsBatch` helper takes a typed callback so its tests
 * can stub without pulling in the toast provider tree. Loosely typed
 * (string | undefined) on title/description so test spies don't need to
 * import the full ToasterToast tree.
 */
type ToastFn = (t: {
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => unknown;

/**
 * Single source of truth for the pipeline's claims state. Both the kanban
 * and table views consume this hook so:
 *
 *   1. Optimistic moves (drag-drop, bulk advance) update one place; both
 *      views re-render from the same data.
 *   2. Mutation logic (`Promise.allSettled` + toast + revert-on-failure)
 *      is shared rather than duplicated across views.
 *   3. View toggles preserve any in-flight optimistic state — no flicker.
 *
 * Architecture note: the `claims` prop comes from page.tsx's `useQuery`
 * (currently stubbed to `[]` until A2 ships). We mirror it locally so we
 * can mutate ahead of the network. When the parent's query invalidates and
 * re-renders us with a fresh `claims` array, the useEffect re-syncs.
 */

export type Role = 'admin' | 'consultant' | 'viewer';

export interface UsePipelineClaimsOptions {
  /** Source claims (from page.tsx's useQuery; currently stub `[]`). */
  claims: Claim[];
  /** Override of the API stub — primarily for tests / Storybook. */
  patchStage?: (input: PatchClaimStageInput) => Promise<void>;
}

export interface UsePipelineClaimsResult {
  /** Current claim list — optimistic when a mutation is in flight. */
  claims: Claim[];
  /** True while at least one PATCH is outstanding. */
  isPending: boolean;
  /** Last error from a mutation batch, if any. Cleared on next mutation. */
  error: Error | null;
  /**
   * Move each id to the given stage. Optimistic + revert on any failure.
   * Filters ineligible ids client-side (server still validates). Returns
   * once all PATCHes settle. Caller should clear selection on resolve.
   */
  mutateStage: (ids: string[], toStage: ClaimStage, role: Role) => Promise<void>;
  /**
   * Per-card stage transition: each claim moves to its OWN target,
   * computed by `targetFor(claim)`. Used by bulk-advance (each card → next
   * stage) and bulk-revert (each card → previous stage).
   */
  mutatePerCard: (
    ids: string[],
    targetFor: (c: Claim) => ClaimStage | null,
    role: Role,
  ) => Promise<void>;
}

/**
 * Client-side mirror of `validateStageTransition` from
 * `apps/api/src/lib/claim-stage.ts`. Used to gate UI affordances (drop
 * targets, bulk actions) before issuing the PATCH. Server still validates
 * authoritatively. Keep in sync with F10.
 */
export function validateClientStageTransition(args: {
  from: ClaimStage;
  to: ClaimStage;
  role: Role;
}):
  | { ok: true; from: ClaimStage; to: ClaimStage; direction: 'forward' | 'backward' }
  | {
      ok: false;
      reason: 'invalid_target' | 'cannot_revert_from_submitted' | 'role_required' | 'no_op';
    } {
  const fromIdx = CLAIM_STAGES_LITERAL.indexOf(args.from);
  const toIdx = CLAIM_STAGES_LITERAL.indexOf(args.to);
  if (toIdx === -1 || fromIdx === -1) {
    return { ok: false, reason: 'invalid_target' };
  }
  if (toIdx === fromIdx) {
    return { ok: false, reason: 'no_op' };
  }
  if (args.from === 'submitted' && toIdx < fromIdx) {
    return { ok: false, reason: 'cannot_revert_from_submitted' };
  }
  const direction = toIdx > fromIdx ? 'forward' : 'backward';
  if (direction === 'backward' && args.role !== 'admin') {
    return { ok: false, reason: 'role_required' };
  }
  return { ok: true, from: args.from, to: args.to, direction };
}

/**
 * Run a batch of stage-PATCHes concurrently using `Promise.allSettled` so a
 * single failure doesn't silently throw away the rest of the responses.
 * Counts successes vs failures and surfaces a toast for partial / total
 * failure (success-only is silent — toast noise is its own UX cost).
 *
 * Returned `{ ok, failed }` lets the caller decide whether to keep the
 * optimistic UI or revert.
 *
 * Exported for testability — the hook delegates to this so the mutation
 * logic is exercisable without a DOM.
 */
export async function runStageMutationsBatch(
  moves: ReadonlyArray<{ id: string; toStage: ClaimStage }>,
  patchStage: (input: PatchClaimStageInput) => Promise<void>,
  toast: ToastFn,
): Promise<{ ok: number; failed: number }> {
  if (moves.length === 0) return { ok: 0, failed: 0 };
  const results = await Promise.allSettled(
    moves.map((m) => patchStage({ id: m.id, toStage: m.toStage })),
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  if (failed > 0) {
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        // Diagnostic for failed PATCHes; toast is the user-facing surface.
        console.error(`patchClaimStage failed for ${moves[i]?.id}:`, r.reason);
      }
    });
    const allFailed = failed === results.length;
    toast({
      title: allFailed ? 'Stage advance failed' : 'Partial success',
      description: allFailed
        ? `All ${results.length} attempts failed`
        : `${ok} of ${results.length} advanced; ${failed} failed`,
      variant: allFailed ? 'destructive' : 'default',
    });
  }
  return { ok, failed };
}

export function useOptimisticClaims(claims: Claim[]): {
  optimistic: Claim[];
  setOptimistic: React.Dispatch<React.SetStateAction<Claim[]>>;
} {
  const [optimistic, setOptimistic] = useState<Claim[]>(claims);
  // Re-sync when the parent query invalidates and passes fresh data. Don't
  // reach in mid-mutation — the mutateStage flow snapshots the current
  // optimistic array before mutating, so a re-sync to the parent during a
  // pending PATCH is the correct behavior (server is authoritative).
  useEffect(() => {
    setOptimistic(claims);
  }, [claims]);
  return { optimistic, setOptimistic };
}

export function usePipelineClaims(opts: UsePipelineClaimsOptions): UsePipelineClaimsResult {
  const { claims, patchStage = patchClaimStage } = opts;
  const { toast } = useToast();
  const { optimistic, setOptimistic } = useOptimisticClaims(claims);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const claimById = useMemo(() => {
    const m = new Map<string, Claim>();
    for (const c of optimistic) m.set(c.id, c);
    return m;
  }, [optimistic]);

  const runMutationsBatch = useCallback(
    (moves: Array<{ id: string; toStage: ClaimStage }>) =>
      runStageMutationsBatch(moves, patchStage, toast),
    [patchStage, toast],
  );

  const mutateStage = useCallback(
    async (ids: string[], toStage: ClaimStage, role: Role): Promise<void> => {
      const eligible = ids
        .map((id) => claimById.get(id))
        .filter((c): c is Claim => Boolean(c))
        .filter((c) => validateClientStageTransition({ from: c.stage, to: toStage, role }).ok)
        .map((c) => ({ id: c.id, toStage }));
      if (eligible.length === 0) return;

      const snapshot = optimistic;
      const nowIso = new Date().toISOString();
      const eligibleIds = new Set(eligible.map((m) => m.id));
      setOptimistic((prev) =>
        prev.map((c) => (eligibleIds.has(c.id) ? { ...c, stage: toStage, updated_at: nowIso } : c)),
      );

      setPendingCount((n) => n + 1);
      setError(null);
      try {
        const { failed } = await runMutationsBatch(eligible);
        if (failed > 0) {
          setOptimistic(snapshot);
          setError(new Error(`${failed} of ${eligible.length} stage advances failed`));
        }
      } catch (err) {
        // Defensive — runMutationsBatch should not throw.
        console.error('Stage advance error:', err);
        setOptimistic(snapshot);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [claimById, optimistic, runMutationsBatch, setOptimistic],
  );

  const mutatePerCard = useCallback(
    async (
      ids: string[],
      targetFor: (c: Claim) => ClaimStage | null,
      role: Role,
    ): Promise<void> => {
      const moves = ids
        .map((id) => {
          const c = claimById.get(id);
          if (!c) return null;
          const next = targetFor(c);
          if (!next) return null;
          if (!validateClientStageTransition({ from: c.stage, to: next, role }).ok) return null;
          return { id: c.id, toStage: next };
        })
        .filter((m): m is { id: string; toStage: ClaimStage } => m !== null);
      if (moves.length === 0) return;

      const snapshot = optimistic;
      const nowIso = new Date().toISOString();
      const movesById = new Map(moves.map((m) => [m.id, m.toStage]));
      setOptimistic((prev) =>
        prev.map((c) => {
          const to = movesById.get(c.id);
          return to ? { ...c, stage: to, updated_at: nowIso } : c;
        }),
      );

      setPendingCount((n) => n + 1);
      setError(null);
      try {
        const { failed } = await runMutationsBatch(moves);
        if (failed > 0) {
          setOptimistic(snapshot);
          setError(new Error(`${failed} of ${moves.length} stage advances failed`));
        }
      } catch (err) {
        // Defensive — runMutationsBatch should not throw.
        console.error('Bulk stage mutation error:', err);
        setOptimistic(snapshot);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setPendingCount((n) => Math.max(0, n - 1));
      }
    },
    [claimById, optimistic, runMutationsBatch, setOptimistic],
  );

  return {
    claims: optimistic,
    isPending: pendingCount > 0,
    error,
    mutateStage,
    mutatePerCard,
  };
}
