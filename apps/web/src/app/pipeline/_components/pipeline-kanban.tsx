'use client';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { CLAIM_STAGES_LITERAL, type Claim, type ClaimStage } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { patchClaimStage } from '../_lib/api';
import { STAGE_LABELS } from './url-params';

// TODO(p4-c-cleanup): post-C2 review-flagged refactors deferred to a separate
// cross-cutting task after the swimlanes merge:
//
//   1. F10 mirror drift test — `validateClientStageTransition` here mirrors
//      `validateStageTransition` in `apps/api/src/lib/claim-stage.ts` but no
//      test asserts the two functions agree on every (from, to, role) input.
//      Risk: silent stale UX (drop targets that look valid but always 403).
//      Better long-term fix: lift `validateStageTransition` into `@cpa/schemas`
//      (or a shared package) so both call sites share one impl.
//
//   2. Keyboard / a11y for drag-drop. HTML5 native draggable is invisible
//      to screen readers and keyboard users. Plan: roving-tabindex column
//      focus, Space toggles selection, M+ArrowRight moves card right one
//      stage. Critical for accessibility audit; introduce in C3 with table
//      view as the natural keyboard surface.
//
//   3. Context-menu off-screen clipping. `position: 'fixed', left: x, top: y`
//      can clip near the right/bottom edge. Fix: measure menu rect after
//      mount and clamp to viewport, or replace with Radix DropdownMenu
//      (already in package.json) which handles flip/clamp automatically.
//
//   4. `subjectTenantNames` prop is unused (page.tsx never populates it)
//      and will be replaced when A2's GET /v1/claims includes claimant_name.
//      Remove this prop in the C3 lift-state refactor.
//
// See: C2 quality review 2026-04-28.

/**
 * Swimlane C2: 7-column kanban for `/pipeline?view=kanban`.
 *
 * Uses HTML5 native drag-drop (no `@hello-pangea/dnd` — not in the workspace
 * deps; keeping the bundle lean, and the UX requirement here is forward-only
 * card moves which native d&d handles fine). Wired against the `_lib/api`
 * stub so it ships ahead of Swimlane A's A2 PATCH route — the stub already
 * has the correct shape, so the swap to a real fetch is a one-line change.
 *
 * Stage transitions follow the same rules as F10's `validateStageTransition`:
 *   - Forward = any role
 *   - Backward = admin only
 *   - `submitted` is terminal (no revert)
 *   - No-op (same column) is a no-op
 *
 * `validateClientStageTransition` re-implements the F10 contract on the
 * client because the web app explicitly does NOT import server types
 * (cross-network boundary, see `claim-stage-timeline.tsx`'s comment).
 *
 * Multi-select:
 *   - plain click on card  → navigate to detail
 *   - cmd/ctrl-click       → toggle card in selection
 *   - shift-click          → extend selection from anchor
 *   - click empty board    → clear selection
 *
 * Bulk actions appear in a floating toolbar when `selected.size > 0`.
 */

// --- Pure logic (kanban.test.tsx imports these directly) -------------------

export type Role = 'admin' | 'consultant' | 'viewer';

export type ClientStageTransition =
  | { ok: true; from: ClaimStage; to: ClaimStage; direction: 'forward' | 'backward' }
  | {
      ok: false;
      reason: 'invalid_target' | 'cannot_revert_from_submitted' | 'role_required' | 'no_op';
    };

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
}): ClientStageTransition {
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
 * Compute the next selection set given a click on `targetId`. Pure so the
 * test suite can hammer the matrix of modifier-key combinations without
 * standing up a DOM.
 *
 *  - `mode: 'replace'` (plain click)  → {targetId} (single)
 *  - `mode: 'toggle'`  (cmd/ctrl)     → flip target in current set
 *  - `mode: 'range'`   (shift)        → extend from anchor through target,
 *                                       using `orderedIds` (the visual
 *                                       order across all columns)
 *
 * `anchor` is the last single-clicked id (or last range start). Falls
 * back to the target when no anchor is set.
 */
export function nextSelection(args: {
  current: Set<string>;
  anchor: string | null;
  targetId: string;
  orderedIds: readonly string[];
  mode: 'replace' | 'toggle' | 'range';
}): { selection: Set<string>; anchor: string | null } {
  const { current, anchor, targetId, orderedIds, mode } = args;
  if (mode === 'replace') {
    return { selection: new Set([targetId]), anchor: targetId };
  }
  if (mode === 'toggle') {
    const next = new Set(current);
    if (next.has(targetId)) next.delete(targetId);
    else next.add(targetId);
    return { selection: next, anchor: targetId };
  }
  // mode === 'range'
  const start = anchor ?? targetId;
  const startIdx = orderedIds.indexOf(start);
  const endIdx = orderedIds.indexOf(targetId);
  if (startIdx === -1 || endIdx === -1) {
    // Fallback: treat as single select if either id is missing from order.
    return { selection: new Set([targetId]), anchor: targetId };
  }
  const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  const range = orderedIds.slice(lo, hi + 1);
  // Range select REPLACES the prior selection (matches Finder/GMail
  // convention; cmd-shift-click for additive ranges is out of scope).
  return { selection: new Set(range), anchor: start };
}

/**
 * Group claims by stage. Stages with no claims still appear (empty array)
 * so the kanban renders all 7 columns. Order within a column matches the
 * input order — caller is responsible for sort.
 */
export function groupClaimsByStage(claims: readonly Claim[]): Record<ClaimStage, Claim[]> {
  const out = {} as Record<ClaimStage, Claim[]>;
  for (const stage of CLAIM_STAGES_LITERAL) out[stage] = [];
  for (const c of claims) out[c.stage].push(c);
  return out;
}

/**
 * Format an ISO-8601 timestamp as a relative-time English phrase
 * ("3 mins ago", "2 days ago"). Pure for testability. Caps at "30+ days
 * ago" — older entries probably shouldn't be in the active pipeline anyway.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return '30+ days ago';
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
 * Exported for testability — the kanban component delegates to this so the
 * mutation logic is exercisable without a DOM.
 */
export async function runStageMutationsBatch(
  ids: string[],
  toStage: ClaimStage,
  patchStage: typeof patchClaimStage,
  toast: ReturnType<typeof useToast>['toast'],
): Promise<{ ok: number; failed: number }> {
  const results = await Promise.allSettled(ids.map((id) => patchStage({ id, toStage })));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  if (failed > 0) {
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        // Diagnostic for failed PATCHes; toast is the user-facing surface.
        console.error(`patchClaimStage failed for ${ids[i]}:`, r.reason);
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

// --- Component -------------------------------------------------------------

export interface PipelineKanbanProps {
  claims: Claim[];
  /** Current viewer role; gates backward drag + revert context-menu item. */
  role: Role;
  /**
   * Optional name lookup for `subject_tenant_id → display name`. The eventual
   * `GET /v1/claims` response (A2) will likely embed claimant_name; until then
   * page.tsx can pass an empty map and the card falls back to the truncated id.
   */
  subjectTenantNames?: Record<string, string>;
  /**
   * Optional override of the API stub — primarily for tests / Storybook.
   * Defaults to the `_lib/api` stub.
   */
  patchStage?: typeof patchClaimStage;
}

interface ContextMenuState {
  cardId: string;
  fromStage: ClaimStage;
  x: number;
  y: number;
}

export function PipelineKanban({
  claims,
  role,
  subjectTenantNames,
  patchStage = patchClaimStage,
}: PipelineKanbanProps) {
  const { toast } = useToast();

  // --- Optimistic state ---
  // Mirror the `claims` prop locally so drag-drop can move cards visually
  // before the PATCH resolves. When the parent's `claimsQuery` invalidates
  // and re-renders this component with fresh data, the useEffect re-syncs.
  // On PATCH failure we revert to the pre-drop snapshot.
  const [optimisticClaims, setOptimisticClaims] = useState<Claim[]>(claims);
  useEffect(() => {
    setOptimisticClaims(claims);
  }, [claims]);

  const grouped = useMemo(() => groupClaimsByStage(optimisticClaims), [optimisticClaims]);
  const orderedIds = useMemo(() => {
    // Visual order across columns: stage-major, then claim order within stage.
    const ids: string[] = [];
    for (const stage of CLAIM_STAGES_LITERAL) {
      for (const c of grouped[stage]) ids.push(c.id);
    }
    return ids;
  }, [grouped]);
  const claimById = useMemo(() => {
    const m = new Map<string, Claim>();
    for (const c of optimisticClaims) m.set(c.id, c);
    return m;
  }, [optimisticClaims]);

  // --- Selection state ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [busy, setBusy] = useState(false);

  // Drop the context menu on any background click + Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const onAnyClick = (): void => setContextMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('click', onAnyClick);
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('click', onAnyClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // --- Drag tracking (HTML5 native) ---
  const dragSourceRef = useRef<{ id: string; from: ClaimStage } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<ClaimStage | null>(null);

  const onCardDragStart = useCallback(
    (e: ReactDragEvent<HTMLElement>, id: string, from: ClaimStage) => {
      // If the user starts a drag on a card that isn't selected, treat the
      // drag as single-card. If the card IS selected, the whole selection
      // moves together (bulk drag).
      dragSourceRef.current = { id, from };
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers require setData for a drag to register at all.
      e.dataTransfer.setData('text/plain', id);
    },
    [],
  );

  const onColumnDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>, to: ClaimStage) => {
      const src = dragSourceRef.current;
      if (!src) return;
      const result = validateClientStageTransition({ from: src.from, to, role });
      if (!result.ok) return;
      // Allow the drop.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverStage(to);
    },
    [role],
  );

  const onColumnDragLeave = useCallback((to: ClaimStage) => {
    setDragOverStage((prev) => (prev === to ? null : prev));
  }, []);

  const onColumnDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>, to: ClaimStage) => {
      e.preventDefault();
      const src = dragSourceRef.current;
      dragSourceRef.current = null;
      setDragOverStage(null);
      if (!src) return;
      const result = validateClientStageTransition({ from: src.from, to, role });
      if (!result.ok) return;
      // If the dragged card is in the selection, move the whole selection;
      // otherwise just the dragged card.
      const draggedIds = selected.has(src.id) ? Array.from(selected) : [src.id];

      // Optimistic update: snapshot current state, then mutate the dragged
      // ids to the new stage. If any PATCH fails we revert to the snapshot.
      const snapshot = optimisticClaims;
      const nowIso = new Date().toISOString();
      setOptimisticClaims((prev) =>
        prev.map((c) => (draggedIds.includes(c.id) ? { ...c, stage: to, updated_at: nowIso } : c)),
      );

      // Clear selection on drop — the cards are now in their new column;
      // keeping them selected would confuse subsequent shift-click ranges.
      setSelected(new Set());
      setAnchor(null);

      void (async () => {
        try {
          // Filter to ids that pass client-side validation (matches the
          // claimById lookup against the *snapshot*, since optimistic state
          // already reflects the move).
          const claimsAtDrop = new Map(snapshot.map((c) => [c.id, c]));
          const eligible = draggedIds
            .map((id) => claimsAtDrop.get(id))
            .filter((c): c is Claim => Boolean(c))
            .filter((c) => validateClientStageTransition({ from: c.stage, to, role }).ok)
            .map((c) => c.id);
          if (eligible.length === 0) {
            setOptimisticClaims(snapshot);
            return;
          }
          setBusy(true);
          const { failed } = await runStageMutationsBatch(eligible, to, patchStage, toast);
          if (failed > 0) {
            // Full revert if anything failed and let the user retry — we
            // don't surgically revert per-id since allSettled-by-index is
            // brittle once eligibility filtering reorders things.
            setOptimisticClaims(snapshot);
          }
        } catch (err) {
          // Defensive; runStageMutationsBatch should not throw, but log if it does.
          console.error('Stage advance error:', err);
          setOptimisticClaims(snapshot);
        } finally {
          setBusy(false);
        }
      })();
    },
    [optimisticClaims, patchStage, role, selected, toast],
  );

  // --- Card click → select / navigate ---
  const onCardClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, id: string): void => {
      // cmd/ctrl-click toggles; shift-click ranges; plain click on an
      // already-selected card with N > 1 selects single. Plain click on a
      // single-selection card navigates (Link's default).
      if (e.shiftKey) {
        e.preventDefault();
        const next = nextSelection({
          current: selected,
          anchor,
          targetId: id,
          orderedIds,
          mode: 'range',
        });
        setSelected(next.selection);
        setAnchor(next.anchor);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const next = nextSelection({
          current: selected,
          anchor,
          targetId: id,
          orderedIds,
          mode: 'toggle',
        });
        setSelected(next.selection);
        setAnchor(next.anchor);
        return;
      }
      // Plain click — Link handles navigation; clear selection so the next
      // shift-click anchors fresh.
      setSelected(new Set());
      setAnchor(id);
    },
    [anchor, orderedIds, selected],
  );

  const onBoardBackgroundClick = useCallback((e: ReactMouseEvent<HTMLDivElement>): void => {
    // Only clear if the click was on the bare board, not on a card or
    // toolbar. Cards stop propagation in their click handler? No — we
    // want the natural bubbling. Use `currentTarget === target` to detect.
    if (e.target === e.currentTarget) {
      setSelected(new Set());
      setAnchor(null);
    }
  }, []);

  // --- Context menu ---
  const onCardContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, id: string, from: ClaimStage): void => {
      // Only admins have a useful context menu (revert). For non-admins,
      // do not preempt the browser's native menu — gives them at least the
      // "open in new tab" option on the link.
      if (role !== 'admin') return;
      e.preventDefault();
      setContextMenu({ cardId: id, fromStage: from, x: e.clientX, y: e.clientY });
    },
    [role],
  );

  const revertCard = useCallback(
    (id: string, fromStage: ClaimStage): void => {
      // Revert = move one stage backward (or to the closest valid prior
      // stage, but for V1 we keep it simple).
      const idx = CLAIM_STAGES_LITERAL.indexOf(fromStage);
      if (idx <= 0) return;
      const prev = CLAIM_STAGES_LITERAL[idx - 1];
      if (!prev) return;
      setContextMenu(null);

      // Optimistic update + revert on failure (mirrors onColumnDrop).
      const snapshot = optimisticClaims;
      const nowIso = new Date().toISOString();
      setOptimisticClaims((cur) =>
        cur.map((c) => (c.id === id ? { ...c, stage: prev, updated_at: nowIso } : c)),
      );

      void (async () => {
        setBusy(true);
        try {
          const { failed } = await runStageMutationsBatch([id], prev, patchStage, toast);
          if (failed > 0) setOptimisticClaims(snapshot);
        } catch (err) {
          // Defensive; runStageMutationsBatch should not throw.
          console.error('Revert error:', err);
          setOptimisticClaims(snapshot);
        } finally {
          setBusy(false);
        }
      })();
    },
    [optimisticClaims, patchStage, toast],
  );

  // --- Bulk actions ---
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  /**
   * Run a per-card stage transition (each card moves to its OWN target
   * stage, computed by `targetFor`). Uses optimistic state + revert on any
   * failure, and emits a single aggregated toast for partial / full
   * failure across the whole batch.
   */
  const runBulkPerCard = useCallback(
    (targetFor: (c: Claim) => ClaimStage | null): void => {
      const moves = selectedIds
        .map((id) => {
          const c = claimById.get(id);
          if (!c) return null;
          const next = targetFor(c);
          if (!next) return null;
          if (!validateClientStageTransition({ from: c.stage, to: next, role }).ok) return null;
          return { id: c.id, toStage: next };
        })
        .filter((m): m is { id: string; toStage: ClaimStage } => m !== null);
      if (moves.length === 0) {
        setSelected(new Set());
        setAnchor(null);
        return;
      }

      const snapshot = optimisticClaims;
      const nowIso = new Date().toISOString();
      const movesById = new Map(moves.map((m) => [m.id, m.toStage]));
      setOptimisticClaims((prev) =>
        prev.map((c) => {
          const to = movesById.get(c.id);
          return to ? { ...c, stage: to, updated_at: nowIso } : c;
        }),
      );
      setSelected(new Set());
      setAnchor(null);

      void (async () => {
        setBusy(true);
        try {
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
            setOptimisticClaims(snapshot);
          }
        } catch (err) {
          // Defensive; Promise.allSettled should not throw, but log if it does.
          console.error('Bulk stage mutation error:', err);
          setOptimisticClaims(snapshot);
        } finally {
          setBusy(false);
        }
      })();
    },
    [claimById, optimisticClaims, patchStage, role, selectedIds, toast],
  );

  const onBulkAdvance = useCallback((): void => {
    // Advance each selected card by exactly one stage (per-card target).
    runBulkPerCard((c) => {
      const idx = CLAIM_STAGES_LITERAL.indexOf(c.stage);
      if (idx === -1 || idx >= CLAIM_STAGES_LITERAL.length - 1) return null;
      return CLAIM_STAGES_LITERAL[idx + 1] ?? null;
    });
  }, [runBulkPerCard]);

  const onBulkRevert = useCallback((): void => {
    if (role !== 'admin') return;
    runBulkPerCard((c) => {
      const idx = CLAIM_STAGES_LITERAL.indexOf(c.stage);
      if (idx <= 0) return null;
      return CLAIM_STAGES_LITERAL[idx - 1] ?? null;
    });
  }, [role, runBulkPerCard]);

  const onBulkClear = useCallback((): void => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  return (
    <div
      role="region"
      aria-label="Kanban view"
      className="flex flex-col gap-3"
      onClick={onBoardBackgroundClick}
    >
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-3 shadow-sm"
        >
          <span className="text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          <Button type="button" size="sm" variant="default" disabled={busy} onClick={onBulkAdvance}>
            Advance
          </Button>
          {role === 'admin' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onBulkRevert}
            >
              Revert
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            // TODO(C2): assignee endpoint isn't defined yet — hidden affordance
            // to communicate intent; wire when bulk-assign route ships.
            title="Bulk assign — coming soon"
          >
            Assign…
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onBulkClear}>
            Clear
          </Button>
        </div>
      )}

      <div className="grid grid-flow-col gap-3 overflow-x-auto">
        {CLAIM_STAGES_LITERAL.map((stage) => {
          const items = grouped[stage];
          const isOver = dragOverStage === stage;
          return (
            <section
              key={stage}
              role="list"
              aria-label={`${STAGE_LABELS[stage]} column`}
              data-stage={stage}
              className={cn(
                'flex min-w-[15rem] flex-col rounded-md border bg-muted/30 p-2 transition-colors',
                isOver && 'border-primary bg-primary/5',
              )}
              onDragOver={(e) => onColumnDragOver(e, stage)}
              onDragLeave={() => onColumnDragLeave(stage)}
              onDrop={(e) => onColumnDrop(e, stage)}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {STAGE_LABELS[stage]}
                </h2>
                <span
                  aria-label={`${items.length} cards`}
                  className="rounded-full bg-background px-2 py-0.5 text-xs"
                >
                  {items.length}
                </span>
              </header>

              <div className="flex flex-col gap-2">
                {items.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No claims</p>
                ) : (
                  items.map((claim) => {
                    const isSelected = selected.has(claim.id);
                    const claimantName = subjectTenantNames?.[claim.subject_tenant_id];
                    const cardLabel =
                      claimantName ?? `Claim ${claim.subject_tenant_id.slice(0, 8)}`;
                    return (
                      <div
                        key={claim.id}
                        role="listitem"
                        draggable
                        data-claim-id={claim.id}
                        aria-label={`Claim card: ${cardLabel}, FY ${claim.fiscal_year}, ${STAGE_LABELS[claim.stage]}`}
                        aria-selected={isSelected}
                        onDragStart={(e) => onCardDragStart(e, claim.id, claim.stage)}
                        onContextMenu={(e) => onCardContextMenu(e, claim.id, claim.stage)}
                        onClick={(e) => onCardClick(e, claim.id)}
                        className={cn(
                          'cursor-grab rounded-md border bg-background p-3 text-sm shadow-sm hover:border-primary/50 active:cursor-grabbing',
                          isSelected && 'ring-2 ring-primary ring-offset-1',
                        )}
                      >
                        <Link
                          href={`/claims/${claim.id}`}
                          className="block focus:outline-none"
                          // Prevent navigation when the click was a
                          // selection-modifier click; onCardClick called
                          // preventDefault on the synthetic event already.
                          onClick={(e) => {
                            if (e.shiftKey || e.metaKey || e.ctrlKey) e.preventDefault();
                          }}
                        >
                          <div className="font-medium">{cardLabel}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            FY {claim.fiscal_year}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Updated {formatRelativeTime(claim.updated_at)}
                          </div>
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      {contextMenu && role === 'admin' && (
        <div
          role="menu"
          aria-label="Card actions"
          // Position via inline style — values come from the synthetic event,
          // not from CSS classes, so they have to be inline.
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50 }}
          className="min-w-[8rem] rounded-md border bg-popover p-1 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={
              contextMenu.fromStage === 'engagement' || contextMenu.fromStage === 'submitted'
            }
            onClick={() => revertCard(contextMenu.cardId, contextMenu.fromStage)}
            className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50"
          >
            Revert to previous stage
          </button>
        </div>
      )}
    </div>
  );
}
