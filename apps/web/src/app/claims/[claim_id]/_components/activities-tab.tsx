'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listActivities } from '../_lib/api';

/**
 * Activities tab — list of CAs (Core Activities) and SAs (Supporting
 * Activities) for the claim.
 *
 * C4's job here is the SHELL: the data path is wired through to
 * `listActivities(claim_id)` (currently a stub returning `[]`) so that
 * once Swimlane A's A3 (`GET /v1/activities`) ships, swapping the stub
 * is a one-liner and the empty-state turns into real rows on the next
 * deploy. The query key is shaped to match the eventual cache shape.
 *
 * Renders code, kind, title per the plan (a fuller layout — narrative
 * fields, status, etc — comes with A5's activity-detail page).
 */
export function ActivitiesTab({ claimId }: { claimId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['activities', { claimId }] as const,
    queryFn: () => listActivities(claimId),
  });

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading activities…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load activities: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No activities yet. Activities are captured from the mobile app or added manually here.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {/* TODO(A3): listActivities currently returns []; rows appear here once GET /v1/activities ships. */}
          Pending GET /v1/activities (A3).
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border bg-background">
      {data.map((activity) => (
        <li key={activity.id} className="flex items-center gap-3 px-4 py-3 text-sm">
          <span className="inline-flex items-center rounded-full border border-input bg-muted/40 px-2 py-0.5 text-xs font-mono">
            {activity.code}
          </span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {activity.kind === 'core' ? 'Core' : 'Supporting'}
          </span>
          <Link
            href={`/claims/${claimId}/activities/${activity.id}`}
            className="font-medium hover:underline"
          >
            {activity.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
