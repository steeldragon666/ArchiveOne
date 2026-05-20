'use client';

/**
 * ActivityAttributionPanel — one card per agreed activity in Step 3 of
 * the wizard. Shows currently bound events (with a "Suggested" badge for
 * those that came from the auto-allocator), an unlink action per row, and
 * an "Add evidence" button that opens the event picker.
 *
 * Auto-allocator detection (purely on the wire — there is no
 * ARTEFACT_LINK_CONFIRMED event kind):
 *   - Manual binds from BindToActivityButton / EventPickerDialog use
 *     `link_reason: 'consultant manual link'`.
 *   - Auto-allocator binds emit `link_reason: result.rationale` (free
 *     text describing why the model matched the event to this activity;
 *     see apps/api/src/jobs/claim-evidence-binding.ts).
 *
 * Any link with a `link_reason` that ISN'T the manual marker is treated
 * as auto-suggested for UI purposes. Accepting a suggestion is implicit
 * (the link already exists in the chain); the consultant can also
 * unlink it if the suggestion is wrong, which appends an
 * ARTEFACT_UNLINKED event and removes the row from the live set.
 *
 * Per-event labels (filename / snippet) require a second query against
 * GET /v1/events?subject_tenant_id=… because GET
 * /v1/activities/:id/artefacts only returns the artefact_id, not the
 * full event payload. The events query is shared with the picker
 * dialog (same query key) so the second fetch is free.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Activity, Event as ApiEvent } from '@cpa/schemas';
import { useToast } from '@/hooks/use-toast';
import { listEvents } from '@/app/subject-tenants/_lib/api';
import {
  deleteArtefactLink,
  getActivityArtefacts,
  type ActivityArtefact,
} from '@/app/subject-tenants/[id]/_lib/binding-api';
import { EventPickerDialog } from './event-picker-dialog';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const MANUAL_LINK_REASON = 'consultant manual link';

const FILE_UPLOAD_PREFIX = '[FILE UPLOAD] ';

interface PastePayload {
  raw_text?: string;
}

const isObjectPayload = (p: unknown): p is PastePayload => typeof p === 'object' && p != null;

function eventLabel(event: ApiEvent): string {
  const raw =
    isObjectPayload(event.payload) && typeof event.payload.raw_text === 'string'
      ? event.payload.raw_text
      : null;
  if (raw && raw.startsWith(FILE_UPLOAD_PREFIX)) {
    const firstLine = raw.split('\n', 1)[0] ?? '';
    const filename = firstLine.slice(FILE_UPLOAD_PREFIX.length).trim();
    if (filename) return filename;
  }
  if (raw && raw.length > 0) {
    const oneLine = raw.replace(/\s+/g, ' ').trim();
    return oneLine.length > 80 ? `${oneLine.slice(0, 79)}…` : oneLine;
  }
  return event.effective_kind;
}

// -----------------------------------------------------------------------
// Bound-event row
// -----------------------------------------------------------------------

interface BoundEventRowProps {
  artefact: ActivityArtefact;
  event: ApiEvent | undefined;
  activityId: string;
  subjectTenantId: string;
  claimId: string;
}

function BoundEventRow({
  artefact,
  event,
  activityId,
  subjectTenantId,
  claimId,
}: BoundEventRowProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  // A link from the auto-allocator is one whose link_reason isn't the
  // manual marker. Null link_reason is impossible from auto-allocator
  // (rationale is always populated) and impossible from the picker
  // (we always set the manual marker), so a missing reason means
  // "unknown source" and is treated as manual.
  const isSuggested = artefact.link_reason !== null && artefact.link_reason !== MANUAL_LINK_REASON;

  const unlinkMutation = useMutation({
    mutationFn: () => deleteArtefactLink(activityId, artefact.linked_event_id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['activity-artefacts', activityId] });
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['artefact-map', subjectTenantId] });
      // canAdvance(3) keys off agreedActivitiesWithoutBinding — unlinking
      // the last bound event flips the gate, so refresh the workflow.
      await qc.invalidateQueries({ queryKey: ['workflow', claimId] });
      toast({ title: 'Evidence unlinked' });
    },
    onError: (err) => {
      toast({
        title: 'Unlink failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const label = event ? eventLabel(event) : `event ${artefact.artefact_id.slice(0, 8)}…`;
  const kindBadge = event?.effective_kind ?? 'EVENT';

  return (
    <li
      className="flex flex-wrap items-start gap-2 rounded border border-[hsl(var(--brand-line))] bg-white px-3 py-2"
      data-testid={`bound-event-${artefact.artefact_id}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {kindBadge}
          </span>
          {isSuggested && (
            <span
              className="inline-flex items-center rounded-full bg-[hsl(var(--brand-accent))]/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--brand-accent-strong))]"
              title={artefact.link_reason ?? undefined}
              data-testid="suggested-badge"
            >
              Suggested
            </span>
          )}
        </div>
        <p className="text-sm leading-tight break-words">{label}</p>
        {isSuggested && artefact.link_reason && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">
            {artefact.link_reason}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => unlinkMutation.mutate()}
        disabled={unlinkMutation.isPending}
        className="shrink-0 text-xs text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        data-testid={`unlink-${artefact.artefact_id}`}
      >
        {unlinkMutation.isPending ? 'Unlinking…' : 'Unlink'}
      </button>
    </li>
  );
}

// -----------------------------------------------------------------------
// Activity panel
// -----------------------------------------------------------------------

interface ActivityAttributionPanelProps {
  activity: Activity;
  claimId: string;
  subjectTenantId: string;
}

export function ActivityAttributionPanel({
  activity,
  claimId,
  subjectTenantId,
}: ActivityAttributionPanelProps) {
  const artefactsQuery = useQuery({
    queryKey: ['activity-artefacts', activity.id] as const,
    queryFn: () => getActivityArtefacts(activity.id),
    staleTime: 30_000,
  });

  // Shared with the picker dialog — we load it eagerly here so we can
  // render filenames / snippets next to bound rows. The dialog reuses
  // the same query key, so opening it costs nothing extra.
  const eventsQuery = useQuery({
    queryKey: ['events', subjectTenantId, 'all', 200] as const,
    queryFn: () => listEvents({ subject_tenant_id: subjectTenantId, filter: 'all', limit: 200 }),
    staleTime: 30_000,
  });

  const eventsById = useMemo(() => {
    const map = new Map<string, ApiEvent>();
    for (const ev of eventsQuery.data?.events ?? []) {
      map.set(ev.id, ev);
    }
    return map;
  }, [eventsQuery.data]);

  // Event-typed artefacts only — the picker can only bind kind='event'
  // artefacts, and the auto-allocator only emits kind='event' links too.
  // Filtering keeps the panel honest if future code links other kinds.
  const eventArtefacts = useMemo(
    () => (artefactsQuery.data ?? []).filter((a) => a.artefact_kind === 'event'),
    [artefactsQuery.data],
  );

  const alreadyBoundEventIds = useMemo<ReadonlySet<string>>(
    () => new Set(eventArtefacts.map((a) => a.artefact_id)),
    [eventArtefacts],
  );

  return (
    <div
      className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4 space-y-3"
      data-testid={`activity-panel-${activity.id}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium">{activity.code}</span>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                activity.kind === 'core'
                  ? 'bg-[hsl(var(--brand-accent))]/15 text-[hsl(var(--brand-accent-strong))]'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {activity.kind}
            </span>
          </div>
          <p className="text-sm font-medium leading-tight">{activity.title}</p>
        </div>
        <div className="shrink-0">
          <EventPickerDialog
            claimId={claimId}
            activityId={activity.id}
            activityCode={activity.code}
            activityTitle={activity.title}
            subjectTenantId={subjectTenantId}
            alreadyBoundEventIds={alreadyBoundEventIds}
            disabled={artefactsQuery.isPending}
          />
        </div>
      </header>

      {artefactsQuery.isPending ? (
        <p className="text-xs text-muted-foreground">Loading bound evidence…</p>
      ) : artefactsQuery.error ? (
        <p className="text-xs text-destructive">
          Failed to load bound evidence:{' '}
          {artefactsQuery.error instanceof Error ? artefactsQuery.error.message : 'Unknown error'}
        </p>
      ) : eventArtefacts.length === 0 ? (
        <div className="rounded border border-dashed border-[hsl(var(--brand-line))] bg-white/40 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            No evidence bound yet. Click <span className="font-medium">Add evidence</span> above to
            attach events from this claim.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5" data-testid={`bound-events-${activity.id}`}>
          {eventArtefacts.map((artefact) => (
            <BoundEventRow
              key={artefact.linked_event_id}
              artefact={artefact}
              event={eventsById.get(artefact.artefact_id)}
              activityId={activity.id}
              subjectTenantId={subjectTenantId}
              claimId={claimId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
