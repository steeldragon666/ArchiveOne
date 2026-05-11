'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { listActivities } from '../_lib/api';
import { CreateActivityButton } from './create-activity-button';
import { ReviewActivityDialog } from './review-activity-dialog';
import type { ActivityWithReview } from '../_lib/api';

/**
 * Activities tab — list of CAs (Core) and SAs (Supporting) for the claim.
 *
 * Rows that were auto-created by the narrative-approval flow with confidence
 * below `AUTO_CREATE_CONFIDENCE_THRESHOLD` (default 0.80) carry
 * `needs_review = true`. They render with a 🤖 chip the consultant can click
 * to open ReviewActivityDialog — review the AI proposal + source excerpt and
 * choose Keep / Edit / Delete (or "Mark reviewed").
 *
 * Rows confirmed via the per-card flow OR auto-created at high confidence
 * have `needs_review = false` and look identical to manually-created rows.
 */
export function ActivitiesTab({ claimId }: { claimId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['activities', { claimId }] as const,
    queryFn: () => listActivities(claimId),
  });

  const [reviewActivity, setReviewActivity] = useState<ActivityWithReview | null>(null);

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
      <div className="space-y-4">
        <div className="flex justify-end">
          <CreateActivityButton claimId={claimId} />
        </div>
        <EmptyState
          icon="ribbon"
          title="No activities yet"
          description="Upload R&D evidence on the claimant page, then approve the AI narrative to auto-create activities — or click Add activity to enter one manually."
        />
      </div>
    );
  }

  const needsReviewCount = data.filter((a) => a.needs_review === true).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {needsReviewCount > 0 ? (
          <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-warning))] flex items-center gap-1.5">
            <Bot className="h-3 w-3" />
            {needsReviewCount} AI-created · needs review
          </p>
        ) : (
          <span /> /* spacer for flex-between */
        )}
        <CreateActivityButton claimId={claimId} />
      </div>

      <ul className="divide-y rounded-md border bg-background">
        {data.map((activity) => {
          const needsReview = activity.needs_review === true;
          return (
            <li
              key={activity.id}
              className={`flex items-center gap-3 px-4 py-3 text-sm ${
                needsReview ? 'bg-[hsl(var(--brand-warning))]/5' : ''
              }`}
            >
              <span className="inline-flex items-center rounded-full border border-input bg-muted/40 px-2 py-0.5 text-xs font-mono">
                {activity.code}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {activity.kind === 'core' ? 'Core' : 'Supporting'}
              </span>
              <Link
                href={`/claims/${claimId}/activities/${activity.id}`}
                className="font-medium hover:underline flex-1 min-w-0 truncate"
              >
                {activity.title}
              </Link>

              {needsReview && (
                <button
                  type="button"
                  onClick={() => setReviewActivity(activity)}
                  className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--brand-warning))]/40 bg-[hsl(var(--brand-warning))]/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-warning))] hover:bg-[hsl(var(--brand-warning))]/20 transition-colors"
                  title={
                    activity.proposal_confidence != null
                      ? `AI-created at ${Math.round(activity.proposal_confidence * 100)}% confidence — click to review`
                      : 'AI-created — click to review'
                  }
                >
                  <Bot className="h-3 w-3" />
                  review
                  {activity.proposal_confidence != null && (
                    <span className="ml-0.5 opacity-75">
                      · {Math.round(activity.proposal_confidence * 100)}%
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {reviewActivity && (
        <ReviewActivityDialog
          activity={reviewActivity}
          claimId={claimId}
          open={reviewActivity !== null}
          onClose={() => setReviewActivity(null)}
        />
      )}
    </div>
  );
}
