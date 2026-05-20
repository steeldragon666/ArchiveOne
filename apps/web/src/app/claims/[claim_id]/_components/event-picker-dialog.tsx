'use client';

/**
 * EventPickerDialog — activity-first evidence-binding chooser used by
 * Step 3 of the claim wizard.
 *
 * Unlike `BindToActivityButton` (which opens from a single event and lets
 * the consultant pick activities to bind it to), this dialog opens from a
 * specific activity card and lets the consultant pick one or more claim
 * events to bind TO that activity. The mutation fans out one
 * `POST /v1/activities/:activity_id/artefact-links` per selected event,
 * with `link_reason: 'consultant manual link'` so the chain row is
 * distinguishable from auto-allocator suggestions.
 *
 * On success, invalidates three query keys so the wizard UI reflects the
 * new bindings without a full page reload:
 *   1. `['activity-artefacts', activityId]` — the per-activity bound-events
 *      list on this card.
 *   2. `['events', subjectTenantId]` — every event card's "Linked to:"
 *      chips on the upload feed.
 *   3. `['workflow', claimId]` — `canAdvance(3)` is derived from the
 *      count of agreed activities without bindings, so a fresh binding
 *      may flip the gate from blocked to ok.
 *
 * Filtering rules (purely UI — server has no "list unbound events" route):
 *   - Only event kinds that represent classifiable R&D evidence (the
 *     `ClassifiableKind` set) are offered. State-transition events
 *     (ARTEFACT_LINKED, CLAIM_STAGE_ADVANCED, …) are not bindable.
 *   - Events already bound to THIS activity are hidden — they're
 *     redundant. (Events bound to OTHER activities ARE still shown,
 *     because a single event can support multiple activities; the
 *     existing BindToActivityButton tolerates the same pattern.)
 *   - INELIGIBLE events are filtered out — they were explicitly marked
 *     non-R&D by classification or override.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Event as ApiEvent, ClassifiableKind } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api';
import { listEvents } from '@/app/subject-tenants/_lib/api';
import { createArtefactLink } from '@/app/subject-tenants/[id]/_lib/binding-api';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Kinds that may serve as R&D evidence and thus be bound to an activity.
 * Mirrors `classifiableKind` from `@cpa/schemas` minus `INELIGIBLE` and
 * `OVERRIDE` (override events are themselves overrides, not evidence).
 */
const BINDABLE_KINDS: readonly ClassifiableKind[] = [
  'HYPOTHESIS',
  'DESIGN',
  'EXPERIMENT',
  'OBSERVATION',
  'ITERATION',
  'NEW_KNOWLEDGE',
  'UNCERTAINTY',
  'TIME_LOG',
  'ASSOCIATE_FLAG',
  'EXPENDITURE_NOTE',
  'SUPPORTING',
] as const;

const BINDABLE_KINDS_SET = new Set<string>(BINDABLE_KINDS);

interface PastePayload {
  source?: string;
  raw_text?: string;
}

const isObjectPayload = (p: unknown): p is PastePayload => typeof p === 'object' && p != null;

const getRawText = (event: ApiEvent): string | null => {
  if (isObjectPayload(event.payload) && typeof event.payload.raw_text === 'string') {
    return event.payload.raw_text;
  }
  return null;
};

const FILE_UPLOAD_PREFIX = '[FILE UPLOAD] ';

/**
 * Extract a single-line display label for an event. File uploads keep
 * their filename; everything else falls back to a truncated raw_text
 * snippet or the event kind.
 */
function eventLabel(event: ApiEvent): string {
  const raw = getRawText(event);
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
// Props
// -----------------------------------------------------------------------

export interface EventPickerDialogProps {
  claimId: string;
  activityId: string;
  activityCode: string;
  activityTitle: string;
  subjectTenantId: string;
  /**
   * Event ids already linked to this activity — they're excluded from
   * the picker list so the consultant doesn't see duplicates.
   */
  alreadyBoundEventIds: ReadonlySet<string>;
  /** Optional trigger label override. Defaults to "Add evidence". */
  triggerLabel?: string;
  /** Disables the trigger button (e.g. while the parent is loading). */
  disabled?: boolean;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export function EventPickerDialog({
  claimId,
  activityId,
  activityCode,
  activityTitle,
  subjectTenantId,
  alreadyBoundEventIds,
  triggerLabel = 'Add evidence',
  disabled = false,
}: EventPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const qc = useQueryClient();
  const { toast } = useToast();

  // Lazy load: only fetch when the dialog opens. Same staleTime as the
  // EventFeed and BindToActivityButton so cache is shared (the EventFeed
  // uses the same query key shape: ['events', subjectTenantId, filter, limit]).
  const eventsQuery = useQuery({
    queryKey: ['events', subjectTenantId, 'all', 200] as const,
    queryFn: () => listEvents({ subject_tenant_id: subjectTenantId, filter: 'all', limit: 200 }),
    enabled: open,
    staleTime: 30_000,
  });

  const candidates = useMemo<ApiEvent[]>(() => {
    const all = eventsQuery.data?.events ?? [];
    return all
      .filter((e) => BINDABLE_KINDS_SET.has(e.effective_kind))
      .filter((e) => !alreadyBoundEventIds.has(e.id));
  }, [eventsQuery.data, alreadyBoundEventIds]);

  const mutation = useMutation({
    mutationFn: async (eventIds: string[]) => {
      const results = await Promise.allSettled(
        eventIds.map((eventId) =>
          createArtefactLink(activityId, {
            artefact_kind: 'event',
            artefact_id: eventId,
            link_reason: 'consultant manual link',
          }),
        ),
      );

      const succeeded: string[] = [];
      const failed: Array<{ eventId: string; message: string }> = [];
      results.forEach((result, i) => {
        const eventId = eventIds[i];
        if (eventId === undefined) return;
        if (result.status === 'fulfilled') {
          succeeded.push(eventId);
        } else {
          const err: unknown = result.reason;
          failed.push({
            eventId,
            message:
              err instanceof ApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'Unknown error',
          });
        }
      });
      return { succeeded, failed };
    },
    onSuccess: async ({ succeeded, failed }) => {
      // Refresh the bound-events list on this activity card.
      await qc.invalidateQueries({ queryKey: ['activity-artefacts', activityId] });
      // The feed's "Linked to:" chips and the per-event artefact map both
      // hang off the events query key.
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['artefact-map', subjectTenantId] });
      // canAdvance(3) reads from agreedActivitiesWithoutBinding — invalidate
      // the workflow query so the "Next" button gating flips correctly.
      await qc.invalidateQueries({ queryKey: ['workflow', claimId] });

      if (failed.length > 0) {
        toast({
          title: `Bound ${succeeded.length} of ${succeeded.length + failed.length} events`,
          description: `${failed.length} link${failed.length === 1 ? '' : 's'} failed: ${failed
            .map((f) => f.message)
            .slice(0, 2)
            .join(' · ')}${failed.length > 2 ? ' · …' : ''}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Bound ${succeeded.length} ${succeeded.length === 1 ? 'event' : 'events'} to ${activityCode}`,
        });
      }
      setOpen(false);
      setSelected(new Set());
    },
    onError: (err) => {
      toast({
        title: 'Binding failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const toggleEvent = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenChange = (next: boolean) => {
    if (!mutation.isPending) {
      setOpen(next);
      if (!next) setSelected(new Set());
    }
  };

  const handleSubmit = () => {
    const eventIds = Array.from(selected);
    if (eventIds.length === 0) return;
    mutation.mutate(eventIds);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid={`event-picker-trigger-${activityId}`}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="leading-snug">
            Add evidence to <span className="font-mono">{activityCode}</span>
          </DialogTitle>
          <DialogDescription>
            Select events to bind to <span className="italic">{activityTitle}</span>. Each selection
            becomes an immutable chain row.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[140px] max-h-[400px] overflow-y-auto -mx-1 px-1">
          {eventsQuery.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading events&hellip;</p>
          ) : eventsQuery.isError ? (
            <p className="py-4 text-sm text-destructive">
              Failed to load events:{' '}
              {eventsQuery.error instanceof Error ? eventsQuery.error.message : 'Unknown error'}
            </p>
          ) : candidates.length === 0 ? (
            <div className="space-y-2 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No unbound events available for this activity.
              </p>
              <p className="text-xs text-muted-foreground">
                Upload more evidence in Step 1, or this activity already has every available event
                bound to it.
              </p>
            </div>
          ) : (
            <ul className="space-y-1 py-1">
              {candidates.map((event) => {
                const isChecked = selected.has(event.id);
                return (
                  <li key={event.id}>
                    <label className="group flex cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
                        checked={isChecked}
                        disabled={mutation.isPending}
                        onChange={() => toggleEvent(event.id)}
                      />
                      <span className="min-w-0 flex-1 text-sm leading-tight">
                        <span className="mr-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {event.effective_kind}
                        </span>
                        <span className="break-words">{eventLabel(event)}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending || selected.size === 0}
            data-testid={`event-picker-submit-${activityId}`}
          >
            {mutation.isPending
              ? 'Binding…'
              : selected.size === 0
                ? 'Select an event'
                : `Bind ${selected.size} ${selected.size === 1 ? 'event' : 'events'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
