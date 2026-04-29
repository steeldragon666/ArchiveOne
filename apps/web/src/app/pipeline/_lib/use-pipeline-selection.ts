'use client';
import { useCallback, useState } from 'react';
import { nextSelection, toggleAllSelection } from './selection';

/**
 * Selection state for the pipeline. Both the kanban and table views consume
 * this hook so a selection made in one view persists across the view toggle.
 *
 * The hook is intentionally agnostic of column/row geometry: callers pass
 * `orderedIds` representing the visual traversal order (kanban: stage-major;
 * table: current sort order) so shift-click ranges work consistently.
 *
 * Pure transforms live in `_lib/selection.ts` so they're testable without
 * a DOM. This hook is a thin React wrapper around those transforms.
 */
export interface UsePipelineSelectionResult {
  selected: Set<string>;
  anchor: string | null;
  /** Replace selection (plain click). */
  replace: (id: string) => void;
  /** Toggle id in/out of selection (cmd/ctrl-click). */
  toggle: (id: string) => void;
  /** Range-select from anchor to id over `orderedIds` (shift-click). */
  range: (id: string, orderedIds: readonly string[]) => void;
  /** Header checkbox: select all if not all selected, else clear. */
  toggleAll: (allIds: readonly string[]) => void;
  /** Imperative escape hatch (e.g. clear after a bulk action resolves). */
  clear: () => void;
  /** Imperative set + anchor (for tests / programmatic seeding). */
  set: (selected: Set<string>, anchor: string | null) => void;
}

export function usePipelineSelection(): UsePipelineSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const replace = useCallback((id: string): void => {
    setSelected(new Set([id]));
    setAnchor(id);
  }, []);

  const toggle = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  }, []);

  const range = useCallback(
    (id: string, orderedIds: readonly string[]): void => {
      const result = nextSelection({
        current: selected,
        anchor,
        targetId: id,
        orderedIds,
        mode: 'range',
      });
      setSelected(result.selection);
      setAnchor(result.anchor);
    },
    [anchor, selected],
  );

  const toggleAll = useCallback(
    (allIds: readonly string[]): void => {
      const result = toggleAllSelection({ current: selected, allIds });
      setSelected(result.selection);
      setAnchor(result.anchor);
    },
    [selected],
  );

  const clear = useCallback((): void => {
    setSelected(new Set());
    setAnchor(null);
  }, []);

  const set = useCallback((next: Set<string>, nextAnchor: string | null): void => {
    setSelected(next);
    setAnchor(nextAnchor);
  }, []);

  return { selected, anchor, replace, toggle, range, toggleAll, clear, set };
}
