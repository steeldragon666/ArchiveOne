'use client';

/**
 * Evidence tab — claim-filtered evidence, grouped by activity.
 *
 * Layout:
 *
 *   X of Y evidence linked                              [Upload evidence]
 *
 *   Activity CA-01 · Lithium battery thermal modelling
 *     ▢ Lab notebook Q1.pdf        89% MEETING_NOTE     [unlink]
 *
 *   Activity CA-02 · Prototype testing
 *     ▢ Design spec v3.docx        78% LEGAL_DOC        [unlink]
 *
 *   Unlinked evidence — 5 items not yet bound to any activity
 *     ▢ Vendor invoice Mar.xlsx    94% EXPENDITURE       [Bind to activity]
 *
 * Data flow:
 *   - Activities: same ['activities', { claimId }] query as ActivitiesTab;
 *     the stub resolves in the current state (A3 not yet live).
 *   - Per-activity artefacts: GET /v1/activities/:id/artefacts,
 *     keyed ['activity-artefacts', activityId].
 *   - Events for unlinked section: GET /v1/events?subject_tenant_id=...
 *     (same query as the claimant event feed, keyed ['events', subjectTenantId]).
 *   - Claim → subjectTenantId: read from the ['claim', claimId] cache
 *     that the parent page populates (same approach as the old placeholder).
 *
 * Unlink: DELETE /v1/activities/:activity_id/artefact-links/:event_id
 *   On success: invalidate ['activity-artefacts', activityId] so the row
 *   disappears and the unlinked section picks it up.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { Activity, Claim, Event as ApiEvent } from '@cpa/schemas';
import { UploadEvidenceButton } from '@/app/subject-tenants/[id]/_components/upload-evidence-button';
import {
  deleteArtefactLink,
  getActivityArtefacts,
  type ActivityArtefact,
} from '@/app/subject-tenants/[id]/_lib/binding-api';
import { BindToActivityButton } from '@/app/subject-tenants/[id]/_components/bind-to-activity-button';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/hooks/use-toast';
import { ConflictError } from '@/lib/api';
import { listActivities } from '../_lib/api';
import { listEvents } from '@/app/subject-tenants/_lib/api';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** FILE_UPLOAD prefix used in uploadEvidence() raw_text events. */
const FILE_UPLOAD_PREFIX = '[FILE UPLOAD] ';

function parseFilename(rawText: string | null): string | null {
  if (!rawText?.startsWith(FILE_UPLOAD_PREFIX)) return null;
  const line = rawText.split('\n')[0] ?? '';
  return line.slice(FILE_UPLOAD_PREFIX.length).trim() || null;
}

function parseSha256(rawText: string | null): string | null {
  if (!rawText) return null;
  const match = rawText.match(/SHA-256:\s*([0-9a-f]{64})/i);
  return match?.[1] ?? null;
}

function parseMime(rawText: string | null): string | null {
  if (!rawText) return null;
  const match = rawText.match(/Type:\s*(.+)/);
  return match?.[1]?.trim() ?? null;
}

function confidencePercent(confidence: number | null | undefined): string {
  if (confidence == null) return '';
  return `${Math.round(confidence * 100)}%`;
}

function getRawText(event: ApiEvent): string | null {
  const p = event.payload;
  if (
    typeof p === 'object' &&
    p !== null &&
    'raw_text' in p &&
    typeof (p as { raw_text?: unknown }).raw_text === 'string'
  ) {
    return (p as { raw_text: string }).raw_text;
  }
  return null;
}

// -----------------------------------------------------------------------
// UnlinkButton
// -----------------------------------------------------------------------

function UnlinkButton({
  activityId,
  linkedEventId,
}: {
  activityId: string;
  linkedEventId: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => deleteArtefactLink(activityId, linkedEventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activity-artefacts', activityId] });
      toast({ title: 'Evidence unlinked' });
    },
    onError: (err) => {
      if (err instanceof ConflictError) {
        toast({
          title: 'Already unlinked',
          description: 'This evidence was already unlinked — refreshing.',
          variant: 'destructive',
        });
        void qc.invalidateQueries({ queryKey: ['activity-artefacts', activityId] });
      } else {
        toast({
          title: 'Failed to unlink',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  return (
    <button
      type="button"
      className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      aria-label="Unlink evidence from activity"
    >
      {mutation.isPending ? 'Unlinking…' : 'unlink'}
    </button>
  );
}

// -----------------------------------------------------------------------
// EvidenceRow — a single artefact row inside an activity group
// -----------------------------------------------------------------------

function LinkedEvidenceRow({
  artefact,
  activityId,
  eventsById,
}: {
  artefact: ActivityArtefact;
  activityId: string;
  eventsById: Map<string, ApiEvent>;
}) {
  const event = eventsById.get(artefact.artefact_id);
  const rawText = event ? getRawText(event) : null;
  const filename = (event && parseFilename(rawText)) ?? `Event ${artefact.artefact_id.slice(0, 8)}`;
  const sha256 = rawText ? parseSha256(rawText) : null;
  const mime = rawText ? parseMime(rawText) : null;
  const confidence = event?.classification?.confidence;
  const effectiveKind = event?.effective_kind;

  return (
    <li className="group flex items-start gap-3 px-4 py-2.5 rounded hover:bg-accent/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium truncate"
          title={sha256 ? `SHA-256: ${sha256}` : undefined}
        >
          {filename}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
          {confidence != null ? <span>{confidencePercent(confidence)}</span> : null}
          {effectiveKind ? <span>{effectiveKind}</span> : null}
          {mime ? <span>{mime}</span> : null}
          {/* Show full SHA-256 on hover — per spec */}
          {sha256 ? (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[10px]">
              SHA-256: {sha256}
            </span>
          ) : null}
        </p>
      </div>
      <UnlinkButton activityId={activityId} linkedEventId={artefact.linked_event_id} />
    </li>
  );
}

// -----------------------------------------------------------------------
// UnlinkedEvidenceRow — an event not yet bound to any activity in this claim
// -----------------------------------------------------------------------

function UnlinkedEvidenceRow({
  event,
  subjectTenantId,
}: {
  event: ApiEvent;
  subjectTenantId: string;
}) {
  const rawText = getRawText(event);
  const filename = parseFilename(rawText) ?? `Event ${event.id.slice(0, 8)}`;
  const confidence = event.classification?.confidence;
  const effectiveKind = event.effective_kind;
  const sha256 = rawText ? parseSha256(rawText) : null;
  const mime = rawText ? parseMime(rawText) : null;

  return (
    <li className="group flex items-start gap-3 px-4 py-2.5 rounded hover:bg-accent/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium truncate"
          title={sha256 ? `SHA-256: ${sha256}` : undefined}
        >
          {filename}
        </p>
        <p className="font-mono text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
          {confidence != null ? <span>{confidencePercent(confidence)}</span> : null}
          {effectiveKind ? <span>{effectiveKind}</span> : null}
          {mime ? <span>{mime}</span> : null}
          {sha256 ? (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity font-mono text-[10px]">
              SHA-256: {sha256}
            </span>
          ) : null}
        </p>
      </div>
      <BindToActivityButton
        eventId={event.id}
        filename={filename}
        subjectTenantId={subjectTenantId}
        triggerLabel="bind"
      />
    </li>
  );
}

// -----------------------------------------------------------------------
// ActivityArtefactsLoader — fetches artefacts for one activity + renders
// -----------------------------------------------------------------------

function ActivityArtefactsList({
  activity,
  claimId,
  eventsById,
}: {
  activity: Activity;
  claimId: string;
  eventsById: Map<string, ApiEvent>;
}) {
  const { data: artefacts = [], isPending } = useQuery({
    queryKey: ['activity-artefacts', activity.id],
    queryFn: () => getActivityArtefacts(activity.id),
    staleTime: 30_000,
  });

  // Filter to artefacts of kind 'event' (chain events); other kinds
  // (media, expenditure, time_entry) handled in their own tabs.
  const eventArtefacts = artefacts.filter((a) => a.artefact_kind === 'event');

  return (
    <div className="mb-5">
      {/* Activity heading */}
      <div className="flex items-center gap-2 mb-1">
        <Link
          href={`/claims/${claimId}/activities/${activity.id}`}
          className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
        >
          {activity.code}
        </Link>
        <span className="text-sm font-medium">{activity.title}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {isPending
            ? '…'
            : `${eventArtefacts.length} file${eventArtefacts.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {isPending ? (
        <p className="text-xs text-muted-foreground pl-4">Loading…</p>
      ) : eventArtefacts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-4">No evidence linked yet.</p>
      ) : (
        <ul className="divide-y rounded border bg-background">
          {eventArtefacts.map((artefact) => (
            <LinkedEvidenceRow
              key={artefact.linked_event_id}
              artefact={artefact}
              activityId={activity.id}
              eventsById={eventsById}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// EvidenceTab
// -----------------------------------------------------------------------

export function EvidenceTab({ claimId }: { claimId: string }) {
  const qc = useQueryClient();

  // Claim → subjectTenantId (read from cache; parent page populates it).
  const cachedClaim = qc.getQueryData<Claim>(['claim', claimId]);
  const subjectTenantId = cachedClaim?.subject_tenant_id;

  // Activities for this claim — same query key as ActivitiesTab so cache is shared.
  const activitiesQuery = useQuery({
    queryKey: ['activities', { claimId }] as const,
    queryFn: () => listActivities(claimId),
  });

  // All events for this claimant — used to (a) resolve event metadata for
  // linked artefacts, and (b) find unlinked events.
  const eventsQuery = useQuery({
    queryKey: ['events', subjectTenantId, 'all', 200],
    queryFn: () => listEvents({ subject_tenant_id: subjectTenantId!, filter: 'all', limit: 200 }),
    enabled: subjectTenantId !== undefined,
    staleTime: 30_000,
  });

  // Per-activity artefact queries (run inside ActivityArtefactsList below).
  // We also need the full set to compute the "unlinked" section.
  // Fetch all activity artefacts here so we can compute the linked event id set.
  const activities = activitiesQuery.data ?? [];

  // Individual per-activity artefact queries — one per activity, all enabled.
  const artefactQueries = useQuery({
    queryKey: ['all-activity-artefacts', claimId],
    queryFn: async () => {
      if (activities.length === 0) return new Map<string, string[]>();
      const results = await Promise.all(
        activities.map((a) =>
          getActivityArtefacts(a.id)
            .then((artefacts) =>
              artefacts.filter((ar) => ar.artefact_kind === 'event').map((ar) => ar.artefact_id),
            )
            .catch(() => [] as string[]),
        ),
      );
      // Map: artefact_id → true (linked to at least one activity in this claim)
      const linkedSet = new Set<string>();
      results.forEach((ids) => ids.forEach((id) => linkedSet.add(id)));
      return linkedSet;
    },
    enabled: activities.length > 0,
    staleTime: 30_000,
  });

  // Build a lookup map: event_id → ApiEvent for rendering linked rows.
  const eventsById = new Map<string, ApiEvent>(
    (eventsQuery.data?.events ?? []).map((e) => [e.id, e]),
  );

  // Unlinked events: file-upload events NOT in the linked set.
  const linkedEventIds = artefactQueries.data ?? new Set<string>();
  const allEvents = eventsQuery.data?.events ?? [];
  const unlinkedEvents = allEvents.filter((e) => {
    if (e.kind === 'OVERRIDE') return false;
    const raw = getRawText(e);
    if (!raw?.startsWith(FILE_UPLOAD_PREFIX)) return false;
    return !linkedEventIds.has(e.id);
  });

  // Counter: total linked = size of linkedEventIds set (only events, not other artefact kinds).
  const linkedCount = linkedEventIds.size;
  const totalFileEvents = allEvents.filter((e) => {
    const raw = getRawText(e);
    return raw?.startsWith(FILE_UPLOAD_PREFIX) ?? false;
  }).length;

  return (
    <div className="space-y-4">
      {/* Tab header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-medium">Evidence</h2>
          {totalFileEvents > 0 && !activitiesQuery.isPending && !artefactQueries.isPending ? (
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
              {linkedCount} of {totalFileEvents} file{totalFileEvents === 1 ? '' : 's'} linked to
              activities
            </p>
          ) : null}
        </div>
        {subjectTenantId !== undefined ? (
          <UploadEvidenceButton subjectTenantId={subjectTenantId} />
        ) : null}
      </div>

      {activitiesQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading activities…</p>
      ) : activitiesQuery.isError ? (
        <p className="text-sm text-destructive">
          Failed to load activities:{' '}
          {activitiesQuery.error instanceof Error ? activitiesQuery.error.message : 'Unknown error'}
        </p>
      ) : activities.length === 0 ? (
        <EmptyState
          icon="file"
          title="No activities yet"
          description="Create activities under this claim, then bind uploaded evidence to them."
          action={{ label: 'Go to Activities tab', href: `?tab=activities` }}
        />
      ) : (
        <div>
          {/* Per-activity grouped evidence */}
          {activities.map((activity) => (
            <ActivityArtefactsList
              key={activity.id}
              activity={activity}
              claimId={claimId}
              eventsById={eventsById}
            />
          ))}

          {/* Unlinked evidence section */}
          {subjectTenantId !== undefined ? (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Unlinked evidence
                </p>
                {eventsQuery.isPending ? (
                  <span className="font-mono text-[10px] text-muted-foreground">…</span>
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {unlinkedEvents.length} item{unlinkedEvents.length === 1 ? '' : 's'} not yet
                    bound to any activity
                  </span>
                )}
              </div>

              {eventsQuery.isPending ? (
                <p className="text-xs text-muted-foreground pl-4">Loading events…</p>
              ) : unlinkedEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground italic pl-4">
                  All uploaded evidence is bound to an activity.
                </p>
              ) : (
                <ul className="divide-y rounded border bg-background">
                  {unlinkedEvents.map((event) => (
                    <UnlinkedEvidenceRow
                      key={event.id}
                      event={event}
                      subjectTenantId={subjectTenantId}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
