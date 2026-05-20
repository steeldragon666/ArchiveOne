'use client';
import { useQuery } from '@tanstack/react-query';
import { getClaim } from '../_lib/api';
import { FiscalYearTimeline } from './fiscal-year-timeline';

/**
 * Timeline tab — graphical fiscal-year overview of a claim's activities
 * and evidence events. Replaces the prior stub (which read "Timeline
 * coming with chain-events integration"); the timeline is now wired to
 * the live `/v1/activities?claim_id=...` and
 * `/v1/events?subject_tenant_id=...` endpoints.
 *
 * The visualisation uses an SVG with one row per activity. Each row
 * shows the activity's range (first→last event) as a coloured bar,
 * with evidence events as clickable dots along the bar. The activity
 * code (CA-NN/SA-NN) is rendered on the left axis. Clicking a bar
 * navigates to the activity detail page; clicking a dot deep-links to
 * the specific event within that activity.
 *
 * The chronological audit-log view (the prior intent of this tab) lives
 * unchanged on the activity detail page — see `AuditTimeline` in
 * `apps/web/src/components/audit-timeline.tsx`. The graphical view here
 * answers the "what happened across the FY at a glance?" question; the
 * vertical log answers "what's the precise event sequence on this
 * activity?". Different reads, same underlying data.
 */
export function TimelineTab({ claimId }: { claimId: string }) {
  const claim = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => getClaim(claimId),
  });

  if (claim.isPending) {
    return <p className="text-sm text-muted-foreground">Loading claim…</p>;
  }

  if (claim.error || !claim.data) {
    return (
      <p className="text-sm text-destructive">
        Failed to load claim: {claim.error instanceof Error ? claim.error.message : 'Unknown error'}
      </p>
    );
  }

  return <FiscalYearTimeline claim={claim.data} />;
}
