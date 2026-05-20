'use client';

/**
 * Live AI Analysis panel — the "Analysis" tab of /claims/[claim_id].
 *
 * Three vertically-stacked sections:
 *
 *   A. "Reading evidence" — per-evidence rows showing Queued → Reading →
 *      Classified state transitions, grouped by activity.
 *
 *   B. "Building narrative" — streaming prose with citation superscripts
 *      and a footnote footer.
 *
 *   C. "Timeline forming" — animated SVG fiscal-year timeline that grows
 *      as events are classified.
 *
 * Re-run mode (v1):
 *   Visual replay only — no API call for reclassification in this version.
 *   The reclassify route (POST /v1/events/:id/reclassify) is attempted via
 *   reclassifyEvent() in analysis-api.ts; a 404 response is swallowed and
 *   the panel falls back to visual replay. This means consultants see the
 *   AI "working through" the already-classified evidence — the intent is
 *   to make the prior AI work visible, not necessarily to re-trigger it.
 *
 *   To make Re-run trigger real backend reclassification: implement
 *   POST /v1/events/:id/reclassify in the API and the 404 branch in
 *   reclassifyEvent() will stop firing.
 *
 * Animation library: none — CSS transitions + Tailwind utilities only,
 * matching the no-new-deps constraint.
 *
 * Detail drawer: clicking a classified row opens a sheet-style panel
 * showing full classification output + raw text. Implemented with a
 * Radix Dialog (already a dep via shadcn).
 */

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getClaim } from '../_lib/api';
import {
  fetchAnalysisEvents,
  type AnalysisEvent,
  type AnalysisEventState,
  type Citation,
} from '../_lib/analysis-api';
import { AnalysisEventRow } from './analysis-event-row';
import { NarrativeStream } from './narrative-stream';
import { AnalysisTimeline } from './analysis-timeline';

// -------------------------------------------------------------------------
// Event detail drawer
// -------------------------------------------------------------------------

function EventDetailDrawer({
  ae,
  open,
  onClose,
}: {
  ae: AnalysisEvent | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!ae) return null;
  const cls = ae.classification;
  const pct = cls ? Math.round(cls.confidence * 100) : null;

  // Extract raw text from payload if available.
  const rawText: string | null = (() => {
    const p = ae.event.payload as Record<string, unknown> | null;
    if (p && typeof p['raw_text'] === 'string') return p['raw_text'];
    return null;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            {ae.filename}
            {ae.activity && (
              <span className="font-mono text-xs text-[hsl(var(--brand-ink-muted))] font-normal">
                {ae.activity.code}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Classification detail · event {ae.event.id.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>

        {cls ? (
          <div className="space-y-4">
            {/* Classification header */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center rounded-full border border-[hsl(var(--brand-hairline-strong))] bg-[hsl(var(--brand-accent-subtle))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--brand-accent-strong))]">
                {cls.kind}
              </span>
              <span className="font-mono text-xs text-[hsl(var(--brand-ink-muted))]">
                {pct}% confidence
              </span>
              {cls.statutory_anchor && (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {cls.statutory_anchor}
                </span>
              )}
              {cls.model && (
                <span className="font-mono text-[10px] text-[hsl(var(--brand-ink-subtle))]">
                  {cls.model}
                </span>
              )}
            </div>

            {/* Rationale */}
            {cls.rationale && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-ink-muted))] mb-1">
                  Rationale
                </p>
                <p className="text-sm text-[hsl(var(--brand-ink))] italic">{cls.rationale}</p>
              </div>
            )}

            {/* Extracted facts */}
            {cls.extracted_facts && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-ink-muted))] mb-1">
                  Extracted facts
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs rounded border border-[hsl(var(--brand-hairline))] bg-[hsl(var(--brand-base))] px-3 py-2">
                  {cls.extracted_facts.dates?.length ? (
                    <>
                      <dt className="text-[hsl(var(--brand-ink-muted))]">Dates</dt>
                      <dd className="font-mono">{cls.extracted_facts.dates.join(', ')}</dd>
                    </>
                  ) : null}
                  {cls.extracted_facts.amounts?.length ? (
                    <>
                      <dt className="text-[hsl(var(--brand-ink-muted))]">Amounts</dt>
                      <dd className="font-mono">{cls.extracted_facts.amounts.join(', ')}</dd>
                    </>
                  ) : null}
                  {cls.extracted_facts.parties?.length ? (
                    <>
                      <dt className="text-[hsl(var(--brand-ink-muted))]">Parties</dt>
                      <dd className="font-mono">{cls.extracted_facts.parties.join(', ')}</dd>
                    </>
                  ) : null}
                  {cls.extracted_facts.hypothesis_formed_at ? (
                    <>
                      <dt className="text-[hsl(var(--brand-ink-muted))]">Hypothesis</dt>
                      <dd className="font-mono">{cls.extracted_facts.hypothesis_formed_at}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            )}

            {/* Raw text excerpt */}
            {rawText && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-ink-muted))] mb-1">
                  Source text
                </p>
                <pre className="rounded border border-[hsl(var(--brand-hairline))] bg-[hsl(var(--brand-base))] p-3 text-xs text-[hsl(var(--brand-ink))] whitespace-pre-wrap break-words font-mono max-h-48 overflow-y-auto">
                  {rawText}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--brand-ink-subtle))] italic">
            No classification data available for this event.
          </p>
        )}

        {/* Captured timestamp */}
        <p className="font-mono text-[10px] text-[hsl(var(--brand-ink-subtle))] pt-2 border-t border-[hsl(var(--brand-hairline))]">
          Captured {new Date(ae.event.captured_at).toLocaleString('en-AU')}
        </p>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------------
// Section header
// -------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-ink-subtle))]">
        {title}
      </p>
      {subtitle && <p className="text-xs text-[hsl(var(--brand-ink-muted))] mt-0.5">{subtitle}</p>}
      <div className="mt-2 h-px bg-[hsl(var(--brand-hairline))]" />
    </div>
  );
}

// -------------------------------------------------------------------------
// Activity group header
// -------------------------------------------------------------------------

function ActivityGroupHeader({
  code,
  title,
  kind,
}: {
  code: string;
  title: string;
  kind: 'core' | 'supporting';
}) {
  return (
    <div className="flex items-baseline gap-2 mb-1 mt-4 first:mt-0">
      <span className="font-mono text-[10px] font-medium text-[hsl(var(--brand-ink-muted))]">
        {code}
      </span>
      <span className="text-xs text-[hsl(var(--brand-ink-muted))] truncate">{title}</span>
      <span
        className={
          kind === 'core'
            ? 'ml-auto flex-none inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-mono bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))]'
            : 'ml-auto flex-none inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-mono bg-slate-100 text-slate-600'
        }
      >
        {kind === 'core' ? 'CORE' : 'SUPP'}
      </span>
    </div>
  );
}

// -------------------------------------------------------------------------
// Section A — Reading evidence
// -------------------------------------------------------------------------

function EvidenceSection({
  events,
  onOpenDetail,
}: {
  events: AnalysisEvent[];
  onOpenDetail: (ae: AnalysisEvent) => void;
}) {
  // Group by activity
  const groups: Array<{
    key: string;
    label: string | null;
    code: string | null;
    kind: 'core' | 'supporting' | null;
    activityId: string | null;
    events: AnalysisEvent[];
  }> = [];

  const seen = new Map<string, number>();

  for (const ae of events) {
    const key = ae.activity?.id ?? '__unlinked__';
    if (!seen.has(key)) {
      seen.set(key, groups.length);
      groups.push({
        key,
        label: ae.activity?.title ?? null,
        code: ae.activity?.code ?? null,
        kind: (ae.activity?.kind as 'core' | 'supporting') ?? null,
        activityId: ae.activity?.id ?? null,
        events: [],
      });
    }
    groups[seen.get(key)!]!.events.push(ae);
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--brand-ink-subtle))] italic">
        No classified evidence events found for this claim.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {groups.map((group) => (
        <div key={group.key}>
          {group.code && group.label && group.kind ? (
            <ActivityGroupHeader code={group.code} title={group.label} kind={group.kind} />
          ) : (
            <div className="font-mono text-[10px] text-[hsl(var(--brand-ink-subtle))] mt-4 first:mt-0 mb-1">
              UNLINKED
            </div>
          )}
          <ul className="space-y-0.5">
            {group.events.map((ae, idx) => (
              <AnalysisEventRow
                key={ae.event.id}
                ae={ae}
                onOpenDetail={onOpenDetail}
                appearDelay={idx * 80}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------
// Re-run animation logic
// -------------------------------------------------------------------------

const READING_STEP_MS = 700;

/**
 * Play the staggered Queued → Reading → Classified animation.
 * Returns a cleanup function that cancels pending timers.
 *
 * Strategy:
 *   - Reset all events to 'queued'.
 *   - After 200ms, advance the first event to 'reading'.
 *   - Every READING_STEP_MS, mark the current event 'classified' and
 *     advance the next to 'reading'.
 *   - This gives consultants a clear left-to-right progression through
 *     the evidence list that mirrors what watching a real classifier
 *     would look like.
 */
function playRerun(
  eventIds: string[],
  onStateChange: (id: string, state: AnalysisEventState) => void,
  onDone: () => void,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let idx = 0;

  // Phase 1: all → queued (immediate)
  for (const id of eventIds) onStateChange(id, 'queued');

  const advance = () => {
    if (idx >= eventIds.length) {
      onDone();
      return;
    }
    const currentId = eventIds[idx]!;
    onStateChange(currentId, 'reading');

    const t = setTimeout(() => {
      onStateChange(currentId, 'classified');
      idx++;
      const t2 = setTimeout(advance, 150);
      timers.push(t2);
    }, READING_STEP_MS);
    timers.push(t);
  };

  const leadIn = setTimeout(advance, 300);
  timers.push(leadIn);

  return () => {
    timers.forEach(clearTimeout);
  };
}

// -------------------------------------------------------------------------
// Main panel
// -------------------------------------------------------------------------

export interface LiveAnalysisPanelProps {
  claimId: string;
}

export function LiveAnalysisPanel({ claimId }: LiveAnalysisPanelProps) {
  // Fetch claim for subject_tenant_id (needed for events fetch).
  const claimQuery = useQuery({
    queryKey: ['claim', claimId] as const,
    queryFn: () => getClaim(claimId),
  });

  const subjectTenantId = claimQuery.data?.subject_tenant_id ?? null;

  const eventsQuery = useQuery({
    queryKey: ['analysis-events', claimId, subjectTenantId] as const,
    queryFn: () =>
      subjectTenantId
        ? fetchAnalysisEvents(claimId, subjectTenantId)
        : Promise.resolve<AnalysisEvent[]>([]),
    enabled: !!subjectTenantId,
  });

  // Local overrides for event states — used during Re-run animation.
  // On load, all events show their real 'classified' state.
  // During Re-run, we temporarily override to 'queued'/'reading'.
  const [stateOverrides, setStateOverrides] = useState<Map<string, AnalysisEventState>>(new Map());
  const [isReplaying, setIsReplaying] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  // Drawer state
  const [drawerTarget, setDrawerTarget] = useState<AnalysisEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDetail = useCallback((ae: AnalysisEvent) => {
    setDrawerTarget(ae);
    setDrawerOpen(true);
  }, []);

  // Merge real event state with overrides.
  const mergedEvents: AnalysisEvent[] = (eventsQuery.data ?? []).map((ae) => {
    const override = stateOverrides.get(ae.event.id);
    return override !== undefined ? { ...ae, state: override } : ae;
  });

  const handleRerun = useCallback(() => {
    if (isReplaying) return;
    const ids = (eventsQuery.data ?? []).map((ae) => ae.event.id);
    if (ids.length === 0) return;

    setLiveMode(true);
    setIsReplaying(true);

    const cleanup = playRerun(
      ids,
      (id, state) => {
        setStateOverrides((prev) => {
          const next = new Map(prev);
          next.set(id, state);
          return next;
        });
      },
      () => {
        setIsReplaying(false);
        // Keep liveMode=true so narrative paragraphs and timeline
        // chips remain in their "appeared" animated state.
      },
    );

    // Store cleanup in a ref — not strictly needed here because
    // `isReplaying` gates re-entry, but good hygiene.
    return cleanup;
  }, [isReplaying, eventsQuery.data]);

  // When new events arrive, clear overrides and reset live mode.
  useEffect(() => {
    setStateOverrides(new Map());
    setLiveMode(false);
  }, [eventsQuery.data]);

  // -----------------------------------------------------------------------
  // Derived counts
  // -----------------------------------------------------------------------

  const totalEvents = mergedEvents.length;
  const classifiedCount = mergedEvents.filter((ae) => ae.state === 'classified').length;

  // Count distinct activities
  const activityIds = new Set(mergedEvents.map((ae) => ae.activity?.id).filter(Boolean));
  const activityCount = activityIds.size;

  const fiscalYear = claimQuery.data?.fiscal_year;
  const fyLabel = fiscalYear
    ? `FY${(fiscalYear - 1).toString().slice(-2)}–${fiscalYear.toString().slice(-2)}`
    : null;

  // -----------------------------------------------------------------------
  // Loading / error states
  // -----------------------------------------------------------------------

  if (claimQuery.isPending || eventsQuery.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-14 rounded border border-[hsl(var(--brand-hairline))] bg-card animate-pulse" />
        <div className="h-40 rounded border border-[hsl(var(--brand-hairline))] bg-card animate-pulse" />
      </div>
    );
  }

  if (claimQuery.error) {
    return (
      <p className="text-sm text-[hsl(var(--brand-error))]">
        Failed to load claim:{' '}
        {claimQuery.error instanceof Error ? claimQuery.error.message : 'Unknown error'}
      </p>
    );
  }

  if (eventsQuery.error) {
    return (
      <p className="text-sm text-[hsl(var(--brand-error))]">
        Failed to load analysis events:{' '}
        {eventsQuery.error instanceof Error ? eventsQuery.error.message : 'Unknown error'}
      </p>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-8" data-testid="live-analysis-panel">
      {/* ---------------------------------------------------------------- */}
      {/* Panel header                                                      */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex items-start justify-between gap-4 rounded border border-[hsl(var(--brand-hairline))] bg-card px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-ink-subtle))]">
            AI Analysis
            {fyLabel && <span className="ml-2 text-[hsl(var(--brand-accent))]">{fyLabel}</span>}
          </p>
          <h2 className="font-display text-lg font-medium text-[hsl(var(--brand-ink))] mt-0.5">
            {totalEvents > 0
              ? `${totalEvents} evidence ${totalEvents === 1 ? 'item' : 'items'} · ${activityCount} ${activityCount === 1 ? 'activity' : 'activities'}`
              : 'No evidence events found'}
          </h2>
          <p className="text-xs text-[hsl(var(--brand-ink-muted))] mt-0.5 font-mono">
            Claude Haiku · R&DTI classifier
            {totalEvents > 0 && (
              <span className="ml-2 text-[hsl(var(--brand-accent))]">
                {classifiedCount}/{totalEvents} classified
              </span>
            )}
          </p>
        </div>

        {/* Re-run button */}
        <button
          type="button"
          onClick={handleRerun}
          disabled={isReplaying || totalEvents === 0}
          aria-label="Re-run AI analysis — replays the classification sequence"
          className="flex-none inline-flex items-center gap-1.5 rounded border border-[hsl(var(--brand-hairline-strong))] bg-[hsl(var(--brand-base))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--brand-ink))] transition-colors hover:border-[hsl(var(--brand-accent))] hover:text-[hsl(var(--brand-accent))] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span
            className={isReplaying ? 'inline-block' : 'inline-block'}
            style={
              isReplaying ? { animation: 'spin 1s linear infinite', display: 'inline-block' } : {}
            }
            aria-hidden
          >
            ⟳
          </span>
          {isReplaying ? 'Analysing…' : 'Re-run'}
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Section A: Reading evidence                                       */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Reading evidence"
          subtitle={
            isReplaying
              ? 'Claude Haiku is reading and classifying each document…'
              : totalEvents > 0
                ? 'All evidence classified — click any row to inspect the full output.'
                : undefined
          }
        />
        <EvidenceSection events={mergedEvents} onOpenDetail={openDetail} />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section B: Building narrative                                     */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Building narrative"
          subtitle={liveMode ? 'Synthesising narrative from classified evidence…' : undefined}
        />
        <NarrativeStream
          claimId={claimId}
          events={mergedEvents}
          live={liveMode}
          onCitationEventClick={(c: Citation) => {
            // Find the event that matches the citation's event_id and open drawer.
            if (c.event_id) {
              const ae = mergedEvents.find((e) => e.event.id === c.event_id);
              if (ae) openDetail(ae);
            }
          }}
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Section C: Timeline forming                                       */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeader
          title="Timeline forming"
          subtitle={
            liveMode
              ? 'Events appearing on the fiscal-year timeline as they are classified…'
              : undefined
          }
        />
        <AnalysisTimeline claimId={claimId} events={mergedEvents} live={liveMode} />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Event detail drawer                                               */}
      {/* ---------------------------------------------------------------- */}
      <EventDetailDrawer ae={drawerTarget} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
