'use client';
/**
 * Fiscal-year timeline — graphical at-a-glance view of a claim's
 * activities + evidence across the FY.
 *
 * The Australian fiscal year runs July 1 → June 30. `claim.fiscal_year`
 * is the year *ending* in June (i.e. fiscal_year=2026 means FY2025-26,
 * spanning 2025-07-01 to 2026-06-30). The horizontal axis renders the
 * 12 months in order with light gridlines at month boundaries.
 *
 * Rows:
 *   - Each activity gets one lane spanning its first→last event.
 *     Activities with no events render as a 14-day marker around their
 *     created_at (so they're still visible).
 *   - Evidence events are dots placed at their captured_at timestamp.
 *     Clicking a dot navigates to the activity's detail page (where the
 *     full chain entry is browsable).
 *   - Clicking an activity bar navigates to its detail page.
 *
 * Colour:
 *   - Core activities use --brand-accent (patina green).
 *   - Supporting activities use --brand-info (slate).
 *   - Events on a lane inherit that lane's hue.
 *
 * SVG over canvas because (a) DOM events on chips are simpler than
 * canvas hit-testing, (b) chip count is bounded (dozens), (c) the
 * platform's design tokens flow naturally into SVG fills via Tailwind
 * text-* classes.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Activity, Claim, Event as ApiEvent } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';
import { EmptyState } from '@/components/empty-state';

interface Props {
  claim: Claim;
}

// Geometry — pure-functional, easy to unit-test.
const MARGIN_LEFT = 64;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 36;
const ROW_HEIGHT = 38;
const ROW_GAP = 6;
const AXIS_HEIGHT = 18;
const VIEWBOX_WIDTH = 1200;

const MONTH_LABELS = [
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
];

function fyBounds(fiscalYear: number): { start: Date; end: Date } {
  // FY2026 = Jul 1 2025 → Jun 30 2026
  const start = new Date(Date.UTC(fiscalYear - 1, 6, 1, 0, 0, 0)); // month index 6 = July
  const end = new Date(Date.UTC(fiscalYear, 5, 30, 23, 59, 59)); // month index 5 = June
  return { start, end };
}

function dateToX(d: Date, start: Date, end: Date): number {
  const usable = VIEWBOX_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const ratio = (d.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  const clamped = Math.max(0, Math.min(1, ratio));
  return MARGIN_LEFT + clamped * usable;
}

interface ActivityLane {
  activity: Activity;
  events: ApiEvent[];
  rangeStart: Date; // earliest of created_at / first event
  rangeEnd: Date; // latest event or 14 days after created_at
}

function buildLanes(activities: Activity[], allEvents: ApiEvent[]): ActivityLane[] {
  return activities.map((a) => {
    const evts = allEvents.filter((e) => {
      // Defensive narrowing: an event might cite the activity via
      // `payload.activity_id` OR a top-level activity_id column.
      if ((e as { activity_id?: string | null }).activity_id === a.id) return true;
      if (
        typeof e.payload === 'object' &&
        e.payload !== null &&
        'activity_id' in e.payload &&
        (e.payload as Record<string, unknown>).activity_id === a.id
      ) {
        return true;
      }
      return false;
    });

    const created = new Date(a.created_at);
    const eventTimes = evts.map((e) => new Date(e.captured_at));
    const rangeStart = eventTimes.length
      ? new Date(Math.min(created.getTime(), ...eventTimes.map((t) => t.getTime())))
      : created;
    const rangeEnd = eventTimes.length
      ? new Date(Math.max(created.getTime(), ...eventTimes.map((t) => t.getTime())))
      : new Date(created.getTime() + 14 * 24 * 60 * 60 * 1000);

    return { activity: a, events: evts, rangeStart, rangeEnd };
  });
}

export function FiscalYearTimeline({ claim }: Props) {
  const activities = useQuery({
    queryKey: ['activities', 'claim', claim.id],
    queryFn: () =>
      apiFetch<{ activities: Activity[] }>(
        `/v1/activities?claim_id=${encodeURIComponent(claim.id)}`,
      ),
  });

  const events = useQuery({
    queryKey: ['events', 'subject_tenant', claim.subject_tenant_id],
    queryFn: () =>
      apiFetch<{ events: ApiEvent[]; next_cursor: string | null }>(
        `/v1/events?subject_tenant_id=${encodeURIComponent(claim.subject_tenant_id)}&limit=200`,
      ),
  });

  if (activities.isPending || events.isPending) {
    return <p className="text-sm text-muted-foreground">Loading timeline…</p>;
  }

  if (activities.error || events.error) {
    return (
      <p className="text-sm text-destructive">Failed to load timeline data. Refresh to retry.</p>
    );
  }

  const lanes = buildLanes(activities.data?.activities ?? [], events.data?.events ?? []);
  const { start, end } = fyBounds(claim.fiscal_year);

  return (
    <div className="space-y-4">
      <Header
        fiscalYear={claim.fiscal_year}
        activityCount={lanes.length}
        eventCount={lanes.reduce((n, l) => n + l.events.length, 0)}
      />
      {lanes.length === 0 ? (
        <EmptyState
          icon="ribbon"
          title="No activities yet"
          description="Add an activity from the Activities tab to see it appear on the timeline."
        />
      ) : (
        <div className="rounded border border-border bg-card overflow-x-auto">
          <SvgChart lanes={lanes} fyStart={start} fyEnd={end} claimId={claim.id} />
        </div>
      )}
      <Legend />
    </div>
  );
}

function Header({
  fiscalYear,
  activityCount,
  eventCount,
}: {
  fiscalYear: number;
  activityCount: number;
  eventCount: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-4 justify-between">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Year overview
        </p>
        <h3 className="font-display text-xl font-medium">
          FY{(fiscalYear - 1).toString().slice(-2)}–{fiscalYear.toString().slice(-2)}
        </h3>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {activityCount} {activityCount === 1 ? 'activity' : 'activities'} · {eventCount}{' '}
        {eventCount === 1 ? 'event' : 'events'}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2.5 w-6 rounded-sm bg-[hsl(var(--brand-accent))]" />
        Core activity
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2.5 w-6 rounded-sm bg-[hsl(var(--brand-info))]" />
        Supporting activity
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[hsl(var(--brand-accent))]" />
        Evidence event (click to inspect)
      </span>
    </div>
  );
}

function SvgChart({
  lanes,
  fyStart,
  fyEnd,
  claimId,
}: {
  lanes: ActivityLane[];
  fyStart: Date;
  fyEnd: Date;
  claimId: string;
}) {
  const height = MARGIN_TOP + AXIS_HEIGHT + lanes.length * (ROW_HEIGHT + ROW_GAP) + 16;

  // Month boundary x positions for gridlines + axis labels.
  const monthBoundaries = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(fyStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d;
  });

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className="font-body"
      role="img"
      aria-label="Fiscal year activity timeline"
    >
      {/* Month gridlines */}
      <g>
        {monthBoundaries.slice(0, -1).map((boundary, i) => {
          const x = dateToX(boundary, fyStart, fyEnd);
          return (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={MARGIN_TOP}
              y2={height - 8}
              stroke="hsl(var(--border))"
              strokeDasharray={i === 0 ? 'none' : '2 4'}
              strokeWidth={1}
            />
          );
        })}
        {/* Closing right boundary */}
        <line
          x1={VIEWBOX_WIDTH - MARGIN_RIGHT}
          x2={VIEWBOX_WIDTH - MARGIN_RIGHT}
          y1={MARGIN_TOP}
          y2={height - 8}
          stroke="hsl(var(--border))"
          strokeWidth={1}
        />
      </g>

      {/* Month axis labels */}
      <g>
        {MONTH_LABELS.map((label, i) => {
          const boundary = monthBoundaries[i];
          const nextBoundary = monthBoundaries[i + 1];
          if (!boundary || !nextBoundary) return null;
          const x = (dateToX(boundary, fyStart, fyEnd) + dateToX(nextBoundary, fyStart, fyEnd)) / 2;
          return (
            <text
              key={label}
              x={x}
              y={MARGIN_TOP - 14}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={11}
              fontFamily="var(--font-mono)"
            >
              {label.toUpperCase()}
            </text>
          );
        })}
      </g>

      {/* Activity lanes */}
      <g>
        {lanes.map((lane, idx) => {
          const y = MARGIN_TOP + AXIS_HEIGHT + idx * (ROW_HEIGHT + ROW_GAP);
          return (
            <ActivityLaneRow
              key={lane.activity.id}
              lane={lane}
              y={y}
              fyStart={fyStart}
              fyEnd={fyEnd}
              claimId={claimId}
            />
          );
        })}
      </g>
    </svg>
  );
}

function ActivityLaneRow({
  lane,
  y,
  fyStart,
  fyEnd,
  claimId,
}: {
  lane: ActivityLane;
  y: number;
  fyStart: Date;
  fyEnd: Date;
  claimId: string;
}) {
  const { activity, events, rangeStart, rangeEnd } = lane;
  const isCore = activity.kind === 'core';
  const fillToken = isCore ? 'var(--brand-accent)' : 'var(--brand-info)';

  const x1 = dateToX(rangeStart, fyStart, fyEnd);
  const x2 = dateToX(rangeEnd, fyStart, fyEnd);
  const barY = y + ROW_HEIGHT / 2 - 5;

  return (
    <g>
      {/* Code label on the left */}
      <text
        x={MARGIN_LEFT - 8}
        y={y + ROW_HEIGHT / 2 + 4}
        textAnchor="end"
        fontSize={11}
        fontFamily="var(--font-mono)"
        className="fill-foreground"
      >
        {activity.code}
      </text>

      {/* Activity bar — clickable */}
      <a href={`/claims/${claimId}/activities/${activity.id}`}>
        <rect
          x={x1}
          y={barY}
          width={Math.max(8, x2 - x1)}
          height={10}
          rx={2}
          fill={`hsl(${fillToken})`}
          opacity={0.55}
          className="hover:opacity-100 transition-opacity cursor-pointer"
        >
          <title>
            {activity.code} · {activity.title}
            {'\n'}Click to open activity
          </title>
        </rect>
      </a>

      {/* Event chips along the lane */}
      {events.map((evt) => {
        const ex = dateToX(new Date(evt.captured_at), fyStart, fyEnd);
        const ey = barY + 5; // centred on bar
        const date = new Date(evt.captured_at).toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        return (
          <Link
            key={evt.id}
            href={`/claims/${claimId}/activities/${activity.id}#event-${evt.id}`}
            className="cursor-pointer"
          >
            <g>
              <circle
                cx={ex}
                cy={ey}
                r={5}
                fill={`hsl(${fillToken})`}
                stroke="hsl(var(--card))"
                strokeWidth={1.5}
                className="hover:r-7 transition-all"
              >
                <title>
                  {evt.kind ?? 'event'} · {date}
                  {'\n'}Click to inspect evidence
                </title>
              </circle>
            </g>
          </Link>
        );
      })}
    </g>
  );
}
