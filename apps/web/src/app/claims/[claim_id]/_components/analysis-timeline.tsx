'use client';

/**
 * "Timeline forming" section of the Live Analysis panel.
 *
 * SVG-based fiscal-year timeline (same geometry as fiscal-year-timeline.tsx)
 * with one key addition: in "live" mode, event chips animate in one at a time
 * with a 100ms stagger as they are classified.
 *
 * Animation:
 *   - CSS opacity transition (0 → 1) + translateY (4px → 0) per chip.
 *   - Stagger: each chip's transition-delay is (index * 100ms).
 *   - No external animation library — raw CSS transitions only, matching
 *     the no-new-deps constraint.
 *   - When live=false, all chips render at full opacity immediately.
 *
 * The fiscal year is derived from events' captured_at timestamps. If no
 * events are present, we render an empty state.
 *
 * Geometry constants match fiscal-year-timeline.tsx for visual consistency:
 *   MARGIN_LEFT=64, VIEWBOX_WIDTH=1200, ROW_HEIGHT=38, ROW_GAP=6.
 */

import type { AnalysisEvent } from '../_lib/analysis-api';

// -------------------------------------------------------------------------
// Geometry — mirrors fiscal-year-timeline.tsx
// -------------------------------------------------------------------------

const MARGIN_LEFT = 64;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 36;
const ROW_HEIGHT = 38;
const ROW_GAP = 6;
const AXIS_HEIGHT = 18;
const VIEWBOX_WIDTH = 1200;

const MONTH_LABELS = [
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
];

function fyBounds(fiscalYear: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(fiscalYear - 1, 6, 1, 0, 0, 0));
  const end = new Date(Date.UTC(fiscalYear, 5, 30, 23, 59, 59));
  return { start, end };
}

function dateToX(d: Date, start: Date, end: Date): number {
  const usable = VIEWBOX_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const ratio = (d.getTime() - start.getTime()) / (end.getTime() - start.getTime());
  const clamped = Math.max(0, Math.min(1, ratio));
  return MARGIN_LEFT + clamped * usable;
}

/** Infer fiscal year from a set of captured_at timestamps. Defaults to current year. */
function inferFiscalYear(events: AnalysisEvent[]): number {
  if (events.length === 0) {
    // Default to current Australian FY
    const now = new Date();
    return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  }
  // Take the latest event timestamp and infer the FY from it.
  const latest = Math.max(...events.map((ae) => new Date(ae.event.captured_at).getTime()));
  const latestDate = new Date(latest);
  // Australian FY ends June 30. If month >= July (6), we're in the next FY.
  const year = latestDate.getUTCFullYear();
  return latestDate.getUTCMonth() >= 6 ? year + 1 : year;
}

// -------------------------------------------------------------------------
// Lane structure
// -------------------------------------------------------------------------

interface Lane {
  code: string;
  activityId: string | null;
  isCore: boolean;
  events: AnalysisEvent[];
  rangeStart: Date;
  rangeEnd: Date;
}

function buildLanes(events: AnalysisEvent[]): Lane[] {
  // Group by activity code (null = unlinked → single "Unlinked" lane).
  const byActivity = new Map<string, AnalysisEvent[]>();
  const order: string[] = [];

  for (const ae of events) {
    const key = ae.activity?.code ?? 'UNLINKED';
    const bucket = byActivity.get(key);
    if (bucket) {
      bucket.push(ae);
    } else {
      byActivity.set(key, [ae]);
      order.push(key);
    }
  }

  return order.map((code) => {
    const evts = byActivity.get(code) ?? [];
    const first = evts[0];
    const isCore = first?.activity?.kind === 'core';
    const activityId = first?.activity?.id ?? null;

    const times = evts.map((ae) => new Date(ae.event.captured_at).getTime());
    const rangeStart = new Date(Math.min(...times));
    const rangeEnd = new Date(Math.max(...times));
    // If single event, give the bar a minimum 7-day width so it's visible.
    if (rangeStart.getTime() === rangeEnd.getTime()) {
      rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 7);
    }

    return { code, activityId, isCore, events: evts, rangeStart, rangeEnd };
  });
}

// -------------------------------------------------------------------------
// SVG chart
// -------------------------------------------------------------------------

interface SvgChartProps {
  lanes: Lane[];
  fyStart: Date;
  fyEnd: Date;
  claimId: string;
  live: boolean;
  classifiedCount: number;
}

function SvgChart({ lanes, fyStart, fyEnd, claimId, live }: SvgChartProps) {
  const height = MARGIN_TOP + AXIS_HEIGHT + lanes.length * (ROW_HEIGHT + ROW_GAP) + 16;

  const monthBoundaries = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(fyStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d;
  });

  // Flatten all events in order to assign stagger indices.
  let chipIndex = 0;
  const chipIndexOf = new Map<string, number>();
  for (const lane of lanes) {
    for (const ae of lane.events) {
      chipIndexOf.set(ae.event.id, chipIndex++);
    }
  }

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className="font-body"
      role="img"
      aria-label="Analysis timeline — events appearing as classified"
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
              fill="hsl(var(--muted-foreground))"
              fontSize={10}
              fontFamily="var(--font-mono)"
            >
              {label}
            </text>
          );
        })}
      </g>

      {/* Activity lanes */}
      {lanes.map((lane, idx) => {
        const y = MARGIN_TOP + AXIS_HEIGHT + idx * (ROW_HEIGHT + ROW_GAP);
        const fillToken = lane.isCore ? 'hsl(var(--brand-accent))' : 'hsl(var(--brand-info))';

        const x1 = dateToX(lane.rangeStart, fyStart, fyEnd);
        const x2 = dateToX(lane.rangeEnd, fyStart, fyEnd);
        const barY = y + ROW_HEIGHT / 2 - 5;

        return (
          <g key={lane.code}>
            {/* Activity code label */}
            <text
              x={MARGIN_LEFT - 8}
              y={y + ROW_HEIGHT / 2 + 4}
              textAnchor="end"
              fontSize={11}
              fontFamily="var(--font-mono)"
              fill="hsl(var(--foreground))"
            >
              {lane.code}
            </text>

            {/* Activity bar */}
            {lane.activityId ? (
              <a href={`/claims/${claimId}/activities/${lane.activityId}`}>
                <rect
                  x={x1}
                  y={barY}
                  width={Math.max(8, x2 - x1)}
                  height={10}
                  rx={2}
                  fill={fillToken}
                  opacity={0.45}
                  className="hover:opacity-90 transition-opacity cursor-pointer"
                >
                  <title>
                    {lane.code}
                    {'\n'}Click to open activity
                  </title>
                </rect>
              </a>
            ) : (
              <rect
                x={x1}
                y={barY}
                width={Math.max(8, x2 - x1)}
                height={10}
                rx={2}
                fill={fillToken}
                opacity={0.35}
              />
            )}

            {/* Event chips — each fades in at its captured_at position */}
            {lane.events.map((ae) => {
              const ex = dateToX(new Date(ae.event.captured_at), fyStart, fyEnd);
              const ey = barY + 5;

              // Stagger: chip N appears with delay N*100ms.
              // In non-live mode: delay 0, opacity 1 immediately.
              const staggerIdx = chipIndexOf.get(ae.event.id) ?? 0;
              const delayMs = live ? staggerIdx * 100 : 0;
              const isVisible = !live || ae.state === 'classified' || ae.state === 'error';

              const date = new Date(ae.event.captured_at).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });

              return (
                <g
                  key={ae.event.id}
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0px)' : 'translateY(3px)',
                    transition: `opacity 400ms ease ${delayMs}ms, transform 400ms ease ${delayMs}ms`,
                  }}
                >
                  {ae.activity?.id ? (
                    <a
                      href={`/claims/${claimId}/activities/${ae.activity.id}#event-${ae.event.id}`}
                    >
                      <circle
                        cx={ex}
                        cy={ey}
                        r={5}
                        fill={fillToken}
                        stroke="hsl(var(--card))"
                        strokeWidth={1.5}
                        className="hover:opacity-80 transition-opacity cursor-pointer"
                      >
                        <title>
                          {ae.filename} · {ae.classification?.kind ?? ae.event.kind}
                          {'\n'}
                          {date}
                        </title>
                      </circle>
                    </a>
                  ) : (
                    <circle
                      cx={ex}
                      cy={ey}
                      r={5}
                      fill={fillToken}
                      stroke="hsl(var(--card))"
                      strokeWidth={1.5}
                    >
                      <title>
                        {ae.filename} · {ae.classification?.kind ?? ae.event.kind}
                        {'\n'}
                        {date} · Unlinked
                      </title>
                    </circle>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// -------------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------------

export interface AnalysisTimelineProps {
  claimId: string;
  events: AnalysisEvent[];
  /** When true, chips animate in with staggered delays as events classify. */
  live: boolean;
}

export function AnalysisTimeline({ claimId, events, live }: AnalysisTimelineProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--brand-ink-subtle))] italic">
        Timeline will form as evidence is classified.
      </p>
    );
  }

  const fiscalYear = inferFiscalYear(events);
  const { start, end } = fyBounds(fiscalYear);
  const lanes = buildLanes(events);
  const classifiedCount = events.filter((ae) => ae.state === 'classified').length;

  const fyLabel = `FY${(fiscalYear - 1).toString().slice(-2)}–${fiscalYear.toString().slice(-2)}`;

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] text-[hsl(var(--brand-ink-subtle))] uppercase tracking-widest">
        {fyLabel} · {classifiedCount}/{events.length} events classified
      </p>
      <div className="rounded border border-[hsl(var(--brand-hairline))] bg-card overflow-x-auto">
        <SvgChart
          lanes={lanes}
          fyStart={start}
          fyEnd={end}
          claimId={claimId}
          live={live}
          classifiedCount={classifiedCount}
        />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-[hsl(var(--brand-ink-subtle))]">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-5 rounded-sm bg-[hsl(var(--brand-accent))]" />
          Core activity
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-5 rounded-sm bg-[hsl(var(--brand-info))]" />
          Supporting activity
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[hsl(var(--brand-accent))]" />
          Evidence event
        </span>
      </div>
    </div>
  );
}
