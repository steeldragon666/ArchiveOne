'use client';
import type { Event as ApiEvent } from '@cpa/schemas';
import { KindChip } from '@/app/subject-tenants/[id]/_components/kind-chip';
import { summariseEvent } from './summarise-event';

/**
 * Technical-uncertainty register feed (T-A6).
 *
 * Renders a reverse-chronological list of register events for one
 * activity. Each event is rendered as a card with:
 *   - Kind chip (reused from the consultant-portal event-feed —
 *     `apps/web/src/app/subject-tenants/[id]/_components/kind-chip.tsx`).
 *   - Captured-at relative time (formatted inline; matches the small
 *     helper in event-card.tsx).
 *   - Payload summary (kind-specific via {@link summariseEvent}).
 *
 * The component is intentionally read-only — overrides and links are
 * surfaced from the consultant-portal feed and the activity-detail
 * editor respectively. The register is the consultant's "what happened
 * for this activity, in order" view; mutations live elsewhere.
 *
 * The feed is data-driven — the page owns the fetch + filter and passes
 * the resolved events down. This keeps the component pure-render and
 * easy to compose in future surfaces (e.g. an assurance-report
 * embedded view).
 */

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return 'just now';
  if (sec < 90) return '1 minute ago';
  const min = Math.round(sec / 60);
  if (min < 45) return `${min} minutes ago`;
  if (min < 90) return '1 hour ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hours ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 14) return `${day} days ago`;
  return new Date(iso).toLocaleDateString();
};

export interface UncertaintyFeedProps {
  events: ApiEvent[];
}

export function UncertaintyFeed({ events }: UncertaintyFeedProps) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No register events yet. Hypotheses, uncertainties, and observations captured against this
        activity will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <article key={event.id} className="border rounded-md p-4 space-y-2 bg-card">
          <header className="flex flex-wrap items-center gap-2">
            <KindChip kind={event.effective_kind} />
            <span className="ml-auto text-xs text-muted-foreground" title={event.captured_at}>
              {formatRelative(event.captured_at)}
            </span>
          </header>
          <p className="text-sm whitespace-pre-wrap break-words">{summariseEvent(event)}</p>
        </article>
      ))}
    </div>
  );
}
