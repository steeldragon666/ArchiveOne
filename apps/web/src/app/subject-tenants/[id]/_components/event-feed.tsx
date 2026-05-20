'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Event as ApiEvent, ListEventsFilter } from '@cpa/schemas';
import { listEvents } from '../../_lib/api';
import {
  getActivityArtefacts,
  listActivitiesForClaim,
  listClaimsForSubjectTenant,
} from '../_lib/binding-api';
import type { LinkedActivity } from './event-card';
import { EventCard } from './event-card';
import { OverrideModal } from './override-modal';

/**
 * Reverse-chronological feed of classified events for one claimant.
 *
 * Single-page query for now — pagination via the API's next_cursor is
 * deferred (P2 scale tops out around tens of events per claimant). Filter
 * defaults to 'all'; T25 hooks up the FilterTabs to pass alternative
 * values down.
 *
 * Also fetches per-activity artefact links for the claimant so each
 * EventCard can show "Linked to: [CA-01] [SA-02]" chips without
 * firing N individual queries.
 */
export interface EventFeedProps {
  subjectTenantId: string;
  filter?: ListEventsFilter;
  limit?: number;
}

/**
 * Build a map from event_id (artefact_id where artefact_kind='event') to
 * the list of activities that have linked to it.
 *
 * Fetch path:
 *   1. GET /v1/claims?subject_tenant_id=...
 *   2. For each claim: GET /v1/activities?claim_id=...
 *   3. For each activity: GET /v1/activities/:id/artefacts
 *   4. Invert: artefact_id → [{ activityId, activityCode, claimId }]
 *
 * All steps run in parallel where possible. Errors on individual
 * activities are silently swallowed so the feed still renders.
 */
async function buildArtefactToActivitiesMap(
  subjectTenantId: string,
): Promise<Map<string, LinkedActivity[]>> {
  const claims = await listClaimsForSubjectTenant(subjectTenantId).catch(() => []);
  if (claims.length === 0) return new Map();

  const activityLists = await Promise.all(
    claims.map((c) => listActivitiesForClaim(c.id).catch(() => [])),
  );

  // Flatten to (activity, claim) pairs.
  const pairs = activityLists.flatMap((activities, i) =>
    activities.map((a) => ({ activity: a, claim: claims[i]! })),
  );

  if (pairs.length === 0) return new Map();

  // Fetch artefacts for all activities in parallel.
  const artefactLists = await Promise.all(
    pairs.map(({ activity }) => getActivityArtefacts(activity.id).catch(() => [])),
  );

  const map = new Map<string, LinkedActivity[]>();
  artefactLists.forEach((artefacts, i) => {
    const pair = pairs[i];
    if (!pair) return;
    for (const artefact of artefacts) {
      if (artefact.artefact_kind !== 'event') continue;
      const existing = map.get(artefact.artefact_id) ?? [];
      existing.push({
        activityId: pair.activity.id,
        activityCode: pair.activity.code,
        claimId: pair.claim.id,
      });
      map.set(artefact.artefact_id, existing);
    }
  });

  return map;
}

export function EventFeed({ subjectTenantId, filter = 'all', limit = 50 }: EventFeedProps) {
  const { data, isPending, error } = useQuery({
    queryKey: ['events', subjectTenantId, filter, limit],
    queryFn: () => listEvents({ subject_tenant_id: subjectTenantId, filter, limit }),
  });

  // Artefact-link map for all events in this feed — used to render
  // "Linked to: [CA-01]" chips per card without per-card queries.
  // Keyed on ['artefact-map', subjectTenantId] so it shares the same
  // invalidation surface as ['events', subjectTenantId].
  const artefactMapQuery = useQuery({
    queryKey: ['artefact-map', subjectTenantId],
    queryFn: () => buildArtefactToActivitiesMap(subjectTenantId),
    staleTime: 30_000,
    // Only fetch when the events query has resolved and there are events.
    enabled: !isPending && !error && (data?.events.length ?? 0) > 0,
  });

  // The override modal is shared across all cards in the feed — only
  // one can be open at a time, so we hoist its state here and pass an
  // onOverride handler to each card.
  const [overrideTarget, setOverrideTarget] = useState<ApiEvent | null>(null);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading events…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load events: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }
  if (data.events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No events yet. Paste a transcript above to classify.
      </p>
    );
  }

  const artefactMap = artefactMapQuery.data;

  return (
    <>
      <div className="space-y-3">
        {data.events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onOverride={setOverrideTarget}
            subjectTenantId={subjectTenantId}
            linkedActivities={artefactMap?.get(event.id)}
          />
        ))}
      </div>
      <OverrideModal
        subjectTenantId={subjectTenantId}
        event={overrideTarget}
        open={overrideTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOverrideTarget(null);
        }}
      />
    </>
  );
}
