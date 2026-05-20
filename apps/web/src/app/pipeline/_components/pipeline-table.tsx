'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { daysInStage, formatRelativeTime } from '../_lib/format';
import { type Role, type UsePipelineClaimsResult } from '../_lib/use-pipeline-claims';
import { type UsePipelineSelectionResult } from '../_lib/use-pipeline-selection';
import {
  applySorting,
  DEFAULT_SORT,
  STAGE_LABELS,
  type PipelineSort,
  type SortColumn,
  type SortDir,
} from './url-params';

/**
 * Swimlane C3: table view for `/pipeline?view=table` (default).
 *
 * Eight columns: select, Claimant, FY, Stage, Activities, Days-in-stage,
 * Assignee, Last updated, Actions. Sortable column headers drive a
 * `?sort=col&dir=asc|desc` URL param so views are shareable, just like the
 * filter pattern in C1.
 *
 * Selection is shared with the kanban via `usePipelineSelection` so a
 * selection made in either view persists across the view toggle. The
 * bulk-action toolbar (`pipeline-bulk-toolbar.tsx`) is rendered by page.tsx
 * once above both views — it picks up state from the same hooks.
 *
 * Stub data:
 *   - Activities count: 0 (TODO(A2): GET /v1/claims doesn't return it yet).
 *   - Assignee:        "—" (TODO(A2): claim_assignee table doesn't exist).
 *   - Days-in-stage:   approximated from `claim.updated_at` (TODO(A2)).
 *
 * Rows are not draggable in this view — keyboard / a11y is the table's
 * core advantage and the source of the kanban's a11y-todo (see kanban file
 * comment). Multi-select via checkbox + cmd/ctrl-click + shift-click range.
 */

const SORTABLE_COLUMNS: ReadonlyArray<{
  id: SortColumn;
  label: string;
  /** Right-align numeric / time columns. */
  numeric?: boolean;
}> = [
  { id: 'claimant', label: 'Claimant' },
  { id: 'fy', label: 'FY', numeric: true },
  { id: 'stage', label: 'Stage' },
  { id: 'activities', label: 'Activities', numeric: true },
  { id: 'days_in_stage', label: 'Days in stage', numeric: true },
  { id: 'last_updated', label: 'Last updated' },
];

export interface PipelineTableProps {
  /** Hook result from `usePipelineClaims` — owns optimistic state. */
  claims: UsePipelineClaimsResult;
  /** Hook result from `usePipelineSelection` — shared with the kanban view. */
  selection: UsePipelineSelectionResult;
  /** Current viewer role; reserved for future per-row admin affordances. */
  role: Role;
  /** Current sort (parsed from URL by page.tsx; pass DEFAULT_SORT when null). */
  sort: PipelineSort;
  /** Optional name lookup for `subject_tenant_id → display name`. */
  subjectTenantNames?: Record<string, string>;
}

export function PipelineTable({
  claims: claimsHook,
  selection,
  role: _role,
  sort,
  subjectTenantNames,
}: PipelineTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { claims, isPending } = claimsHook;
  const { selected, anchor, toggle, range, toggleAll, set: setSelection } = selection;

  const sortedClaims = useMemo(
    () =>
      applySorting(claims, sort, {
        ...(subjectTenantNames ? { subjectTenantNames } : {}),
      }),
    [claims, sort, subjectTenantNames],
  );

  const orderedIds = useMemo(() => sortedClaims.map((c) => c.id), [sortedClaims]);
  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selected.has(id));
  const someSelected = !allSelected && orderedIds.some((id) => selected.has(id));

  const onSortClick = useCallback(
    (col: SortColumn) => {
      // Same column → flip dir. New column → asc (numeric/string default).
      const params = new URLSearchParams(searchParams.toString());
      let nextDir: SortDir;
      if (sort.column === col) {
        nextDir = sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        // Time/days/fy columns: default desc (most recent / largest first
        // is the more useful default). Other columns: asc.
        nextDir =
          col === 'last_updated' || col === 'days_in_stage' || col === 'fy' ? 'desc' : 'asc';
      }
      // If the new state matches the default, omit from URL.
      if (col === DEFAULT_SORT.column && nextDir === DEFAULT_SORT.dir) {
        params.delete('sort');
        params.delete('dir');
      } else {
        params.set('sort', col);
        params.set('dir', nextDir);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, sort.column, sort.dir],
  );

  const onRowClick = useCallback(
    (e: ReactMouseEvent<HTMLTableRowElement>, id: string): void => {
      // Modifier-key handling: shift = range, cmd/ctrl = toggle, plain = nav.
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
      // Plain click → navigate. Reset the anchor so subsequent shift-clicks
      // anchor here, but don't lose the existing selection (that would be
      // jarring after, say, shift-selecting 5 rows then clicking one to
      // open it). Mirrors the kanban's plain-click behavior.
      setSelection(new Set(), id);
      router.push(`/claims/${id}`);
    },
    [orderedIds, range, router, setSelection, toggle],
  );

  const onCheckboxClick = useCallback(
    (e: ReactMouseEvent<HTMLInputElement>, id: string): void => {
      // Stop propagation so clicking the checkbox doesn't navigate.
      e.stopPropagation();
      // Shift on a checkbox = range select (Finder/GMail convention).
      if (e.shiftKey) {
        range(id, orderedIds);
        return;
      }
      toggle(id);
    },
    [orderedIds, range, toggle],
  );

  const onHeaderCheckboxClick = useCallback(
    (e: ReactMouseEvent<HTMLInputElement>): void => {
      e.stopPropagation();
      toggleAll(orderedIds);
    },
    [orderedIds, toggleAll],
  );

  if (sortedClaims.length === 0) {
    return (
      <section role="region" aria-label="Table view">
        <EmptyState
          icon="file"
          title="No claims found"
          description="No claims match the current filters. Try adjusting stage or search filters."
        />
      </section>
    );
  }

  return (
    <section
      role="region"
      aria-label="Table view"
      className={cn('rounded-md border bg-background', isPending && 'opacity-90')}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onClick={onHeaderCheckboxClick}
                onChange={() => {
                  /* handled in onClick to also catch shift-click; React
                     warns if onChange is omitted on a controlled checkbox */
                }}
                className="h-4 w-4 cursor-pointer rounded border-input"
              />
            </TableHead>
            {SORTABLE_COLUMNS.map((col) => {
              const active = sort.column === col.id;
              const ariaSort: 'ascending' | 'descending' | 'none' = active
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';
              return (
                <TableHead
                  key={col.id}
                  aria-sort={ariaSort}
                  className={col.numeric ? 'text-right' : undefined}
                >
                  <button
                    type="button"
                    aria-label={`Sort by ${col.label}`}
                    onClick={() => onSortClick(col.id)}
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide',
                      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {col.label}
                    <SortIndicator active={active} dir={sort.dir} />
                  </button>
                </TableHead>
              );
            })}
            <TableHead className="w-24 text-right">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedClaims.map((claim) => {
            const isSelected = selected.has(claim.id);
            const claimantName = subjectTenantNames?.[claim.subject_tenant_id];
            const cardLabel = claimantName ?? `Claim ${claim.subject_tenant_id.slice(0, 8)}`;
            return (
              <TableRow
                key={claim.id}
                aria-selected={isSelected}
                data-claim-id={claim.id}
                data-state={isSelected ? 'selected' : undefined}
                onClick={(e) => onRowClick(e, claim.id)}
                className={cn(
                  'cursor-pointer',
                  isSelected && 'bg-muted/50',
                  anchor === claim.id && 'ring-1 ring-inset ring-primary/40',
                )}
              >
                <TableCell className="w-10">
                  <input
                    type="checkbox"
                    aria-label={`Select claim ${cardLabel}`}
                    checked={isSelected}
                    onClick={(e) => onCheckboxClick(e, claim.id)}
                    onChange={() => {
                      /* see header checkbox comment */
                    }}
                    className="h-4 w-4 cursor-pointer rounded border-input"
                  />
                </TableCell>
                <TableCell className="font-medium">{cardLabel}</TableCell>
                <TableCell className="text-right tabular-nums">{claim.fiscal_year}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full border border-input bg-muted/40 px-2 py-0.5 text-xs">
                    {STAGE_LABELS[claim.stage]}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {/* TODO(A2): real activity_count once GET /v1/claims returns it. */}0
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {/* TODO(A2): replace with last_stage_change.captured_at delta. */}
                  {daysInStage(claim.updated_at)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {/* TODO(A2): claim_assignee table doesn't exist yet; placeholder. */}—
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatRelativeTime(claim.updated_at)}
                </TableCell>
                <TableCell className="w-24 text-right">
                  <button
                    type="button"
                    aria-label={`Open ${cardLabel}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/claims/${claim.id}`);
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Open
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

function SortIndicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <span aria-hidden="true" className="text-muted-foreground/40">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="text-foreground">
      {dir === 'asc' ? '↑' : '↓'}
    </span>
  );
}
