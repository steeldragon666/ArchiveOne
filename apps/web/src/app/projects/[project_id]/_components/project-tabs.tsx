'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { PROJECT_TAB_LABELS, type ProjectTab } from '../../_lib/url-params';

/**
 * Tab strip for the /projects/[project_id] detail page (T-A7).
 *
 * Hand-authored — no shadcn `Tabs` primitive in deps and the brief
 * forbids adding one. Behavioural parity with the WAI-ARIA APG tabs
 * pattern:
 *   - role="tablist" on the strip
 *   - role="tab" on each item, aria-selected on the active one
 *   - roving tabindex (0 on active, -1 on the rest) so the focus
 *     ring follows selection
 *   - ArrowLeft/ArrowRight cycles, Home/End jumps to first/last,
 *     wrapping at the boundaries.
 *
 * Pattern intentionally mirrors `subject-tenants/[id]/_components/
 * filter-tabs.tsx` (the established hand-rolled tabs in this repo on
 * the p4a/evidence-engine branch). The C4 `claim-tabs.tsx` referenced
 * in the brief lives on a different swimlane (p4c/pipeline-documents)
 * and is not present here, so this is the second hand-rolled tabs
 * instance on this branch — extracting a shared `RouteTabs` component
 * is premature with N=2 across non-converged swimlanes; revisit when
 * branches merge.
 *
 * Selected tab lives in the `?tab=...` URL search param so the view is
 * shareable and back-button-friendly. Default tab ('claims') is
 * omitted from the URL — matches the C4 view-toggle convention.
 */

const ORDERED_TABS: ReadonlyArray<ProjectTab> = ['claims', 'timeline', 'settings'];

interface ProjectTabsProps {
  active: ProjectTab;
}

export function ProjectTabs({ active }: ProjectTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Refs to each tab button so the keyboard handler can `.focus()` the
  // newly-active one. Map keyed by ProjectTab so the lookup is total.
  const tabRefs = useRef<Partial<Record<ProjectTab, HTMLButtonElement | null>>>({});

  const onSelect = useCallback(
    (next: ProjectTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'claims') {
        // Default tab — omit from URL for clean shareable links.
        params.delete('tab');
      } else {
        params.set('tab', next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = ORDERED_TABS.indexOf(active);
      if (idx < 0) return; // defensive — active is always in the list

      let nextIdx: number | null = null;
      // Horizontal first; accept vertical too because role=tablist's
      // orientation is implicit horizontal but browsers handle both.
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIdx = (idx + 1) % ORDERED_TABS.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIdx = (idx - 1 + ORDERED_TABS.length) % ORDERED_TABS.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = ORDERED_TABS.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const nextTab = ORDERED_TABS[nextIdx];
      if (nextTab === undefined) return; // unreachable, narrows the type
      onSelect(nextTab);
      // Focus the newly-active tab so the focus ring follows the
      // selection — matches the WAI-ARIA APG roving-tabindex pattern.
      const el = tabRefs.current[nextTab];
      if (el) {
        // Defer the focus call so it lands after React's re-render
        // settles the tabindex update.
        queueMicrotask(() => el.focus());
      }
    },
    [active, onSelect],
  );

  return (
    <div
      role="tablist"
      aria-label="Project section"
      className="flex flex-wrap gap-1 border-b"
      onKeyDown={onKeyDown}
    >
      {ORDERED_TABS.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(tab)}
            className={cn(
              'inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {PROJECT_TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
