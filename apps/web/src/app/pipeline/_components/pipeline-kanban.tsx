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
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../_lib/format';
import {
  validateClientStageTransition,
  type Role,
  type UsePipelineClaimsResult,
} from '../_lib/use-pipeline-claims';
import { type UsePipelineSelectionResult } from '../_lib/use-pipeline-selection';
import { STAGE_LABELS } from './url-params';

// TODO(p4-c-cleanup): post-C2 review-flagged refactors. C3 lifted state and
// mutations to `_lib/use-pipeline-claims.ts` + `_lib/use-pipeline-selection.ts`.
// Remaining items deferred to a separate cross-cutting task after the
// swimlanes merge:
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
//      stage. Critical for accessibility audit; the table view (C3) is the
//      keyboard-friendly surface today.
//
//   3. Context-menu off-screen clipping. `position: 'fixed', left: x, top: y`
//      can clip near the right/bottom edge. Fix: measure menu rect after
//      mount and clamp to viewport, or replace with Radix DropdownMenu
//      (already in package.json) which handles flip/clamp automatically.
//
// See: C2 quality review 2026-04-28; C3 lift-state plan 2026-04-29.

/**
 * Swimlane C2: 7-column kanban for `/pipeline?view=kanban`.
 *
 * Uses HTML5 native drag-drop (no `@hello-pangea/dnd` — not in the workspace
 * deps; keeping the bundle lean, and the UX requirement here is forward-only
 * card moves which native d&d handles fine).
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
 * State (claims, mutations, selection) lives in hooks so the same data
 * powers both kanban + table views — see `_lib/use-pipeline-claims.ts` and
 * `_lib/use-pipeline-selection.ts`. The bulk-action toolbar is a shared
 * sibling component (`pipeline-bulk-toolbar.tsx`).
 */

// --- Pure logic (kanban.test.tsx imports these directly) -------------------

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

// --- Component -------------------------------------------------------------

export interface PipelineKanbanProps {
  /** Hook result from `usePipelineClaims` — owns optimistic state. */
  claims: UsePipelineClaimsResult;
  /** Hook result from `usePipelineSelection` — shared with the table view. */
  selection: UsePipelineSelectionResult;
  /** Current viewer role; gates backward drag + revert context-menu item. */
  role: Role;
  /**
   * Optional name lookup for `subject_tenant_id → display name`. The eventual
   * `GET /v1/claims` response (A2) will likely embed claimant_name; until then
   * page.tsx can pass an empty map and the card falls back to the truncated id.
   */
  subjectTenantNames?: Record<string, string>;
}

interface ContextMenuState {
  cardId: string;
  fromStage: ClaimStage;
  x: number;
  y: number;
}

export function PipelineKanban({
  claims: claimsHook,
  selection,
  role,
  subjectTenantNames,
}: PipelineKanbanProps) {
  const { claims, isPending, mutateStage } = claimsHook;
  const { selected, toggle, range, clear, set: setSelection } = selection;

  const grouped = useMemo(() => groupClaimsByStage(claims), [claims]);
  const orderedIds = useMemo(() => {
    // Visual order across columns: stage-major, then claim order within stage.
    const ids: string[] = [];
    for (const stage of CLAIM_STAGES_LITERAL) {
      for (const c of grouped[stage]) ids.push(c.id);
    }
    return ids;
  }, [grouped]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

      // Clear selection on drop — the cards are now in their new column;
      // keeping them selected would confuse subsequent shift-click ranges.
      clear();

      void mutateStage(draggedIds, to, role);
    },
    [clear, mutateStage, role, selected],
  );

  // --- Card click → select / navigate ---
  const onCardClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, id: string): void => {
      // cmd/ctrl-click toggles; shift-click ranges; plain click on an
      // already-selected card with N > 1 selects single. Plain click on a
      // single-selection card navigates (Link's default).
      if (e.shiftKey) {
        e.preventDefault();
        range(id, orderedIds);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggle(id);
        return;
      }
      // Plain click — Link handles navigation; clear selection so the next
      // shift-click anchors fresh.
      setSelection(new Set(), id);
    },
    [orderedIds, range, setSelection, toggle],
  );

  const onBoardBackgroundClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      // Only clear if the click was on the bare board, not on a card or
      // toolbar. Cards stop propagation in their click handler? No — we
      // want the natural bubbling. Use `currentTarget === target` to detect.
      if (e.target === e.currentTarget) clear();
    },
    [clear],
  );

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
      void mutateStage([id], prev, role);
    },
    [mutateStage, role],
  );

  return (
    <div
      role="region"
      aria-label="Kanban view"
      className="flex flex-col gap-3"
      onClick={onBoardBackgroundClick}
    >
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
                          isPending && 'opacity-90',
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
