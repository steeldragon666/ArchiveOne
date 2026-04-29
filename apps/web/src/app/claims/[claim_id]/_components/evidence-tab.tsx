'use client';

/**
 * Evidence tab — claim-filtered events feed.
 *
 * Placeholder for C4. The events feed already exists at
 * `apps/web/src/app/subject-tenants/[id]/_components/event-feed.tsx`,
 * but it filters by `subject_tenant_id`. Filtering by `claim_id`
 * requires the API extension being built by Swimlane A's A6 task — we
 * intentionally don't reach into the existing feed and shoehorn a
 * client-side filter in, because the claim ↔ event relationship in F-
 * tasks is server-side (events get linked to a claim via the activity
 * they reference).
 *
 * When A6 ships, replace this body with `<EventFeed claimId={claimId} />`
 * (or whatever the new signature ends up being).
 */
export function EvidenceTab({ claimId: _claimId }: { claimId: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">Evidence feed coming in A6+.</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {/* TODO(A6): wire to a claim-filtered events feed once the API extension ships. */}
        Pending claim-filter on GET /v1/events (A6).
      </p>
    </div>
  );
}
