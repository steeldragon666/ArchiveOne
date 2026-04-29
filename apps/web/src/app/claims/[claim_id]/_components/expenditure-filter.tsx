'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  EXPENDITURE_FILTER_LABELS,
  EXPENDITURE_FILTER_VALUES,
  type ExpenditureFilter,
} from '../_lib/url-params';

/**
 * Filter chip strip for the expenditure tab — All / Unmapped / Mapped.
 *
 * URL-driven via `?expenditure_filter=...` (parser lives in
 * `_lib/url-params.ts`). Default is 'unmapped' (the most common
 * consultant workflow on this tab is "what's left to map?"); selecting
 * 'unmapped' omits the param from the URL so the canonical claim
 * URL doesn't carry the redundant default.
 *
 * Hand-authored chips — same decision as `claim-tabs.tsx`: no Tabs
 * primitive in the project, and `aria-pressed` on a `<button>` is the
 * right semantic for a toggle group anyway. Keeps the bundle lean.
 *
 * Counts are intentionally NOT shown next to each chip — unlike
 * `filter-tabs.tsx` (events feed), the per-filter counts here would
 * require running listExpenditures three times to fan out, and the
 * filter is one level deep (the empty state in the tab body already
 * tells the user "no results"). If audience research shows users want
 * the count, the listExpenditures stub already returns the full row
 * set so adding a `useMemo` count is cheap.
 */

export interface ExpenditureFilterProps {
  active: ExpenditureFilter;
}

export function ExpenditureFilterChips({ active }: ExpenditureFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onSelect = useCallback(
    (next: ExpenditureFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      // Default = unmapped, so omit it from URL when selected.
      if (next === 'unmapped') {
        params.delete('expenditure_filter');
      } else {
        params.set('expenditure_filter', next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return (
    <div
      role="tablist"
      aria-label="Filter expenditures by mapping state"
      className="flex flex-wrap gap-2"
    >
      {EXPENDITURE_FILTER_VALUES.map((value) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(value)}
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {EXPENDITURE_FILTER_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}
