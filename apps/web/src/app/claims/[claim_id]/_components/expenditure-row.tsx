'use client';
import { useState } from 'react';
import type { Activity } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  formatAmount,
  type ExpenditureKind,
  type ExpenditureRow as Row,
} from '../_lib/expenditure-stub';

/**
 * Single row in the expenditure tab's list. Renders the expenditure's
 * facts (kind chip, date, payee, amount, reference) + the current
 * mapping state, with an inline picker for (re)mapping.
 *
 * Parent owns the activities + the optimistic-update flow — this
 * component is presentational, calling back via `onMap` when the user
 * picks an activity. The picker collapses immediately on selection;
 * the row's mapping is rendered from props (so the optimistic state
 * lives in one place at the parent — same pattern as the kanban's
 * `usePipelineClaims` hook).
 */

/**
 * Distinct chip styling per kind. Mirrors the colour-group convention
 * from `subject-tenants/[id]/_components/kind-chip.tsx`:
 *   - blue   = INVOICE  (the "primary" Xero document)
 *   - amber  = BANK_TX  (financial / admin)
 *   - violet = RECEIPT  (out-of-pocket / reimbursable)
 *
 * Tailwind needs literal class strings at build time — keep this as a
 * static map rather than computing the class names.
 */
const KIND_STYLES: Record<ExpenditureKind, string> = {
  INVOICE: 'bg-blue-50 text-blue-700 border-blue-200',
  BANK_TX: 'bg-amber-50 text-amber-700 border-amber-200',
  RECEIPT: 'bg-violet-50 text-violet-700 border-violet-200',
};

const KIND_LABELS: Record<ExpenditureKind, string> = {
  INVOICE: 'Invoice',
  BANK_TX: 'Bank tx',
  RECEIPT: 'Receipt',
};

/** Cap reference text so a long Xero memo doesn't blow up the row. */
const REFERENCE_TRUNCATE = 80;

export interface ExpenditureRowProps {
  row: Row;
  activities: ReadonlyArray<Activity>;
  /** True while a map call for THIS row is in flight (parent-tracked). */
  isPending: boolean;
  /** Fired when the user picks an activity from the inline picker. */
  onMap: (activityId: string) => void;
}

export function ExpenditureRowItem({ row, activities, isPending, onMap }: ExpenditureRowProps) {
  // Picker visibility is local — the rest of the optimistic flow lives
  // in the parent. Closing the picker on a successful select is handled
  // here (immediately on selection); reopening for re-map happens via
  // the "Re-map" button, which sets this back to true.
  const [picking, setPicking] = useState(false);

  const onPickerChange = (activityId: string): void => {
    setPicking(false);
    // Defer to parent so the optimistic update + toast happen in one
    // place. Empty string is the "no selection" sentinel from Radix —
    // ignore it (shouldn't happen in normal use, but defensive).
    if (activityId) onMap(activityId);
  };

  const truncatedRef =
    row.reference && row.reference.length > REFERENCE_TRUNCATE
      ? `${row.reference.slice(0, REFERENCE_TRUNCATE - 1)}…`
      : row.reference;

  return (
    <li
      data-expenditure-id={row.id}
      className={cn(
        'flex flex-wrap items-center gap-3 px-4 py-3 text-sm transition-opacity',
        isPending && 'opacity-60',
      )}
    >
      {/* Kind chip */}
      <span
        className={cn(
          'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide',
          KIND_STYLES[row.kind],
        )}
        aria-label={`Source: ${KIND_LABELS[row.kind]}`}
      >
        {KIND_LABELS[row.kind]}
      </span>

      {/* Date */}
      <time dateTime={row.date} className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {row.date}
      </time>

      {/* Payee */}
      <span className="min-w-[10rem] grow font-medium">{row.payee}</span>

      {/* Amount */}
      <span className="shrink-0 tabular-nums font-mono text-sm">
        {formatAmount(row.amount, row.currency)}
      </span>

      {/* Reference (truncated) */}
      {truncatedRef && (
        <span
          className="min-w-0 max-w-[18rem] grow truncate text-xs text-muted-foreground"
          title={row.reference ?? undefined}
        >
          {truncatedRef}
        </span>
      )}

      {/* Mapping state + action */}
      <div className="flex shrink-0 items-center gap-2">
        {row.current_mapping ? (
          <span className="inline-flex items-center gap-1 text-xs">
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-emerald-700">
              {row.current_mapping.activity_code}
            </span>
            <span className="max-w-[14rem] truncate text-muted-foreground">
              {row.current_mapping.activity_title}
            </span>
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground">Unmapped</span>
        )}

        {picking ? (
          <Select onValueChange={onPickerChange} open onOpenChange={(o) => setPicking(o)}>
            <SelectTrigger className="h-8 w-[14rem]" aria-label={`Pick activity for ${row.payee}`}>
              <SelectValue placeholder="Choose an activity…" />
            </SelectTrigger>
            <SelectContent>
              {activities.length === 0 ? (
                // Defensive: shouldn't render the picker if there are no
                // activities (the tab disables the button), but Radix
                // requires at least one item to avoid rendering an empty
                // popover that's impossible to dismiss.
                <SelectItem value="__none__" disabled>
                  No activities yet
                </SelectItem>
              ) : (
                activities.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="font-mono text-xs">{a.code}</span> <span>{a.title}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || activities.length === 0}
            onClick={() => setPicking(true)}
            aria-label={
              row.current_mapping
                ? `Re-map ${row.payee} (currently ${row.current_mapping.activity_code})`
                : `Map ${row.payee} to an activity`
            }
          >
            {row.current_mapping ? 'Re-map' : 'Map to activity'}
          </Button>
        )}
      </div>
    </li>
  );
}
