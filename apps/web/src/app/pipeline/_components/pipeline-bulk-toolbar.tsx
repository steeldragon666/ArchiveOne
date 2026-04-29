'use client';
import { CLAIM_STAGES_LITERAL, type Claim, type ClaimStage } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { type Role, type UsePipelineClaimsResult } from '../_lib/use-pipeline-claims';
import { type UsePipelineSelectionResult } from '../_lib/use-pipeline-selection';

/**
 * Bulk-action toolbar shared by the kanban and table views. Renders only
 * when there's a non-empty selection. Wires into the same hooks both views
 * already consume so the actions update one place and re-render both views.
 *
 * Buttons:
 *   - Advance — each card moves forward one stage (per-card target).
 *   - Revert  — admin only; each card moves back one stage.
 *   - Assign… — disabled stub. Wires when bulk-assign route ships.
 *   - Clear   — clears the selection.
 *
 * The "Assign…" button is gated behind A2's claim_assignee table — until
 * then it's a hidden affordance to communicate intent. Tooltip explains.
 */
export interface PipelineBulkToolbarProps {
  claims: UsePipelineClaimsResult;
  selection: UsePipelineSelectionResult;
  role: Role;
  /** Optional: gives the toolbar a stable label for screen readers in either view. */
  ariaLabel?: string;
}

export function PipelineBulkToolbar({
  claims: claimsHook,
  selection,
  role,
  ariaLabel = 'Bulk actions',
}: PipelineBulkToolbarProps) {
  const { isPending, mutatePerCard } = claimsHook;
  const { selected, clear } = selection;

  if (selected.size === 0) return null;
  const selectedIds = Array.from(selected);

  const onAdvance = (): void => {
    void (async () => {
      await mutatePerCard(selectedIds, (c) => stageAtOffset(c.stage, 1), role);
      clear();
    })();
  };

  const onRevert = (): void => {
    if (role !== 'admin') return;
    void (async () => {
      await mutatePerCard(selectedIds, (c) => stageAtOffset(c.stage, -1), role);
      clear();
    })();
  };

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-3 shadow-sm"
    >
      <span className="text-sm font-medium" aria-live="polite">
        {selected.size} selected
      </span>
      <Button type="button" size="sm" variant="default" disabled={isPending} onClick={onAdvance}>
        Advance
      </Button>
      {role === 'admin' && (
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={onRevert}>
          Revert
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        // TODO(C2/A2): assignee endpoint isn't defined yet — hidden affordance
        // to communicate intent; wire when bulk-assign route ships and the
        // claim_assignee table lands.
        title="Bulk assign — coming soon"
      >
        Assign…
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}

/**
 * Compute the stage `offset` positions away from `from`, or null if the
 * result is out of range. Used by Advance (+1) and Revert (-1).
 *
 * Exported for testability — the toolbar's bulk handlers are integration
 * surfaces that depend on this transition rule.
 */
export function stageAtOffset(from: ClaimStage, offset: number): ClaimStage | null {
  const idx = CLAIM_STAGES_LITERAL.indexOf(from);
  if (idx === -1) return null;
  const next = idx + offset;
  if (next < 0 || next >= CLAIM_STAGES_LITERAL.length) return null;
  return CLAIM_STAGES_LITERAL[next] ?? null;
}

// Re-export Claim so consumers don't need a separate import. Kept named to
// avoid module-augmentation surprises.
export type { Claim };
