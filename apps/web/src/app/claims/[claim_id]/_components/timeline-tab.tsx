'use client';

/**
 * Timeline tab — chronological view of the claim's chain events
 * (stage advances, activity edits, expenditure mapping changes,
 * submission events, …).
 *
 * Placeholder for C4 — the chain-events feed is owned by Swimlane T's
 * subject-tenant chain (see `subject-tenants/[id]/_components/chain-status-badge.tsx`).
 * Filtering chain events by claim_id is a query on the existing event
 * stream, but the indexing/filter API extension hasn't shipped yet.
 *
 * Could eventually surface the chain-status badge inline here too —
 * the badge component already exists and just takes a subject_tenant_id;
 * we'd resolve `claim → subject_tenant` server-side or pass it down
 * from the claim header.
 */
export function TimelineTab({ claimId: _claimId }: { claimId: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">
        Timeline coming with chain-events integration.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {/* TODO: wire to a claim-filtered chain-events stream once the API extension ships.
            Pair with the existing ChainStatusBadge for an at-a-glance integrity indicator. */}
        Pending claim-filter on chain events.
      </p>
    </div>
  );
}
