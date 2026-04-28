/**
 * Pure selection-set transitions used by both the kanban and table views.
 *
 * Extracted from pipeline-kanban.tsx in C3 so a single hook
 * (`use-pipeline-selection`) can drive selection state for either view, and
 * so the same `nextSelection` semantics apply across both. Tests import this
 * directly to hammer the modifier-key matrix without standing up a DOM.
 */

/**
 * Compute the next selection set given a click on `targetId`. Pure so the
 * test suite can hammer the matrix of modifier-key combinations without
 * standing up a DOM.
 *
 *  - `mode: 'replace'` (plain click)  → {targetId} (single)
 *  - `mode: 'toggle'`  (cmd/ctrl)     → flip target in current set
 *  - `mode: 'range'`   (shift)        → extend from anchor through target,
 *                                       using `orderedIds` (the visual
 *                                       order across all columns / rows)
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
 * "Toggle all" pure transform — header checkbox click. If every id is
 * currently selected, returns empty set; otherwise returns the full set.
 * Anchor resets to null because the header click isn't a per-row anchor.
 */
export function toggleAllSelection(args: { current: Set<string>; allIds: readonly string[] }): {
  selection: Set<string>;
  anchor: string | null;
} {
  const { current, allIds } = args;
  const allSelected = allIds.length > 0 && allIds.every((id) => current.has(id));
  return {
    selection: allSelected ? new Set() : new Set(allIds),
    anchor: null,
  };
}
