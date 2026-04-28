'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { CLAIM_TAB_VALUES, TAB_LABELS, type ClaimTab } from '../_lib/url-params';
import { ActivitiesTab } from './activities-tab';
import { DocumentsTab } from './documents-tab';
import { EvidenceTab } from './evidence-tab';
import { ExpenditureTab } from './expenditure-tab';
import { TimelineTab } from './timeline-tab';

/**
 * Tab strip + active tab body for /claims/[claim_id].
 *
 * Hand-authored (no shadcn `Tabs` primitive in the project — see
 * subject-tenants/[id]/_components/filter-tabs.tsx for the same
 * decision: adding the Radix dep just for this would be over-
 * engineering). Behaviourally the same: ARIA role=tablist, role=tab on
 * each item, aria-selected on the active one, keyboard activation via
 * the underlying <button>.
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

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Claim sections" className="flex flex-wrap gap-1 border-b">
        {CLAIM_TAB_VALUES.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`claim-tab-panel-${tab}`}
              id={`claim-tab-${tab}`}
              onClick={() => onSelect(tab)}
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
        <ActiveTabBody tab={activeTab} claimId={claimId} />
      </section>
    </div>
  );
}

function ActiveTabBody({ tab, claimId }: { tab: ClaimTab; claimId: string }) {
  switch (tab) {
    case 'activities':
      return <ActivitiesTab claimId={claimId} />;
    case 'evidence':
      return <EvidenceTab claimId={claimId} />;
    case 'expenditure':
      return <ExpenditureTab claimId={claimId} />;
    case 'documents':
      return <DocumentsTab claimId={claimId} />;
    case 'timeline':
      return <TimelineTab claimId={claimId} />;
  }
}
