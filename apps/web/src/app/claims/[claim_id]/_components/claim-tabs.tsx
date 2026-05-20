'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { CLAIM_TAB_VALUES, nextTabFromKey, TAB_LABELS, type ClaimTab } from '../_lib/url-params';
import { ActivitiesTab } from './activities-tab';
import { DocumentsTab } from './documents-tab';
import { EvidenceTab } from './evidence-tab';
import { ExpenditureTab } from './expenditure-tab';
import { LiveAnalysisPanel } from './live-analysis-panel';
import { TimelineTab } from './timeline-tab';
import { ReviewTab } from './review-tab';
import { FinalDraftTab } from './final-draft-tab';

/**
 * Tab strip + active tab body for /claims/[claim_id].
 *
 * Hand-authored (no shadcn `Tabs` primitive in the project — see
 * subject-tenants/[id]/_components/filter-tabs.tsx for the same
 * decision: adding the Radix dep just for this would be over-
 * engineering).
 *
 * Accessibility (WAI-ARIA APG tabs pattern, automatic-activation flavour):
 *   - role="tablist" + role="tab" + role="tabpanel" with the matching
 *     aria-selected / aria-controls / aria-labelledby wiring.
 *   - Roving tabindex: only the active tab is in the focus ring
 *     (tabIndex=0); the others are tabIndex=-1, so Tab/Shift-Tab moves
 *     past the whole strip in one hop.
 *   - Arrow-key traversal on the tablist: Left/Up → previous,
 *     Right/Down → next, both wrap; Home → first; End → last. Activation
 *     is automatic — moving focus also calls `onSelect`, so panel content
 *     follows the focused tab. (Cheap to render, no async work per panel.)
 *
 * URL is the source of truth for the active tab (`?tab=...`) — matches
 * the pipeline view-toggle pattern in /pipeline. The page passes the
 * parsed value down so it can co-locate any tab-aware data fetches.
 *
 * The default tab ('activities') is omitted from the URL when active so
 * `/claims/<id>` and `/claims/<id>?tab=activities` are canonicalised to
 * the same back-button / share state.
 */

export interface ClaimTabsProps {
  claimId: string;
  activeTab: ClaimTab;
}

export function ClaimTabs({ claimId, activeTab }: ClaimTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Refs to each tab button so arrow-key activation can move DOM focus to
  // the newly-active tab (roving-tabindex + automatic activation requires
  // focus to follow selection).
  const tabRefs = useRef<Record<ClaimTab, HTMLButtonElement | null>>({
    analysis: null,
    activities: null,
    review: null,
    evidence: null,
    expenditure: null,
    documents: null,
    timeline: null,
    'final-draft': null,
  });

  const onSelect = useCallback(
    (next: ClaimTab) => {
      const params = new URLSearchParams(searchParams.toString());
      // Default = activities, so omit it from URL when selected.
      if (next === 'activities') {
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
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const next = nextTabFromKey(e.key, activeTab);
      if (next === null) return;
      e.preventDefault();
      onSelect(next);
      // Focus follows selection so the user can keep arrow-keying without
      // having to re-locate focus. requestAnimationFrame isn't needed —
      // the ref already points at the correct DOM node regardless of which
      // tab is active.
      tabRefs.current[next]?.focus();
    },
    [activeTab, onSelect],
  );

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Claim sections" className="flex flex-wrap gap-1 border-b">
        {CLAIM_TAB_VALUES.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`claim-tab-panel-${tab}`}
              id={`claim-tab-${tab}`}
              // Roving tabindex: only the active tab is in the focus ring.
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(tab)}
              onKeyDown={onKeyDown}
              className={cn(
                'inline-flex items-center gap-2 -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        aria-labelledby={`claim-tab-${activeTab}`}
        id={`claim-tab-panel-${activeTab}`}
      >
        {/* Panels unmount when inactive — co-locate persistent state above
            this component if you need it to survive tab switches. */}
        <ActiveTabBody tab={activeTab} claimId={claimId} />
      </section>
    </div>
  );
}

function ActiveTabBody({ tab, claimId }: { tab: ClaimTab; claimId: string }) {
  switch (tab) {
    case 'analysis':
      return <LiveAnalysisPanel claimId={claimId} />;
    case 'activities':
      return <ActivitiesTab claimId={claimId} />;
    case 'review':
      return <ReviewTab claimId={claimId} />;
    case 'evidence':
      return <EvidenceTab claimId={claimId} />;
    case 'expenditure':
      return <ExpenditureTab claimId={claimId} />;
    case 'documents':
      return <DocumentsTab claimId={claimId} />;
    case 'timeline':
      return <TimelineTab claimId={claimId} />;
    case 'final-draft':
      return <FinalDraftTab claimId={claimId} />;
  }
}
