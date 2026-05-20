'use client';
import type { Event as ApiEvent } from '@cpa/schemas';
import { FileText, Hash } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { BindToActivityButton } from './bind-to-activity-button';
import { ConfidenceChip } from './confidence-chip';
import { KindChip } from './kind-chip';

/**
 * Render a single event row in the feed.
 *
 * The payload column is `unknown` over the wire (events can carry varied
 * shapes: paste, override, future ingest sources), so we narrow it with
 * a small guard before pulling raw_text out for the snippet.
 *
 * The override action is a no-op stub in this commit (T24) — T26 wires
 * up the modal. The button is hidden when kind === 'OVERRIDE' because
 * the API rejects override-of-override (events.ts step 2).
 *
 * "Bind to activity" button appears on every file-upload card (and all
 * other non-OVERRIDE events). Existing artefact links are shown as small
 * chips below the card: "Linked to: [CA-01] [SA-02]".
 */
interface PastePayload {
  _v: number;
  source: string;
  raw_text?: string;
}

const isPastePayload = (p: unknown): p is PastePayload =>
  typeof p === 'object' && p != null && 'source' in p;

const getRawText = (event: ApiEvent): string | null => {
  if (isPastePayload(event.payload) && typeof event.payload.raw_text === 'string') {
    return event.payload.raw_text;
  }
  return null;
};

const truncate = (s: string, max = 80): string =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';

/**
 * Detect + parse the structured `[FILE UPLOAD]` raw_text format produced
 * by `uploadEvidence()` in the upload-evidence-button flow. Returns
 * structured fields (filename, mimeType, etc.) if it matches; null
 * otherwise. The format is the small line-oriented one in
 * `apps/web/src/app/subject-tenants/[id]/_lib/api.ts#uploadEvidence`:
 *
 *   [FILE UPLOAD] <filename>
 *   Type: <mime>
 *   Size: <kb> KB
 *   SHA-256: <hex>
 *   Description: <optional>
 */
interface FileUploadParsed {
  filename: string;
  mimeType: string;
  sizeKb: string;
  sha256: string;
  description?: string;
}
const FILE_UPLOAD_PREFIX = '[FILE UPLOAD] ';
const parseFileUpload = (raw: string | null): FileUploadParsed | null => {
  if (!raw || !raw.startsWith(FILE_UPLOAD_PREFIX)) return null;
  const lines = raw.split('\n');
  const filename = lines[0]?.slice(FILE_UPLOAD_PREFIX.length).trim() ?? '';
  if (!filename) return null;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return {
    filename,
    mimeType: fields['Type'] ?? 'application/octet-stream',
    sizeKb: fields['Size'] ?? '',
    sha256: fields['SHA-256'] ?? '',
    description: fields['Description'] ?? undefined,
  };
};

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

// -----------------------------------------------------------------------
// LinkedToChips: queries artefact links for this event and renders chips
// -----------------------------------------------------------------------

/**
 * An artefact-linked event has `payload.artefact_id === event.id` and
 * `payload.artefact_kind === 'event'`. We discover which activities this
 * event has been bound to by checking the activity-artefacts query for
 * activities we already know about — but the cleaner and fully general
 * approach is to store the activity codes from the linked chain events.
 *
 * Since the API exposes GET /v1/activities/:id/artefacts (returns artefacts
 * linked TO that activity), we would need to know which activities to check.
 * Instead, we hold per-event artefact links in local state via the query
 * key ['activity-artefacts', activityId] (invalidated on bind).
 *
 * The most practical approach without a dedicated "GET /v1/events/:id/links"
 * endpoint: we pass `linkedActivities` down as a prop (pre-computed by the
 * parent EventFeed, which can query all activities + their artefacts) — but
 * that couples the feed too tightly.
 *
 * Better: Accept `activityArtefactsByActivity` as an optional prop; if not
 * provided, render nothing (graceful degradation). The EventFeed can be
 * upgraded separately once the A6 cross-activity view ships.
 *
 * For now we expose a lightweight sub-component that accepts pre-resolved
 * linkedActivities so EventCard stays self-contained.
 */

export interface LinkedActivity {
  activityId: string;
  activityCode: string;
  claimId: string;
}

/**
 * Renders "Linked to: [CA-01] [SA-02]" chips if `linkedActivities` is
 * non-empty. Each chip links to the activity detail page.
 */
function LinkedToChips({ linkedActivities }: { linkedActivities: LinkedActivity[] }) {
  if (linkedActivities.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Linked to:
      </span>
      {linkedActivities.map(({ activityId, activityCode, claimId }) => (
        <Link
          key={activityId}
          href={`/claims/${claimId}/activities/${activityId}`}
          className="inline-flex items-center rounded border border-border bg-[hsl(var(--brand-accent-subtle)/0.5)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-foreground/70 hover:text-primary hover:border-primary transition-colors"
        >
          {activityCode}
        </Link>
      ))}
    </div>
  );
}

export interface EventCardProps {
  event: ApiEvent;
  /** T26 will wire this up; pass `undefined` to keep button as a stub. */
  onOverride?: (event: ApiEvent) => void;
  /** Which claimant this event belongs to (needed for the bind dialog). */
  subjectTenantId?: string;
  /**
   * Pre-resolved activity links for this event. Computed externally (e.g.
   * by EventFeed once it fetches activity-artefacts) and passed down so the
   * card doesn't need to fan out N queries for N cards.
   * When absent, linked-to chips are not rendered.
   */
  linkedActivities?: LinkedActivity[];
}

export function EventCard({
  event,
  onOverride,
  subjectTenantId,
  linkedActivities,
}: EventCardProps) {
  const rawText = getRawText(event);
  const overrideReason = event.kind === 'OVERRIDE' ? event.override_reason : null;
  const fileUpload = parseFileUpload(rawText);
  // For non-file events, fall back to the generic raw_text snippet.
  const snippet = overrideReason ?? (fileUpload ? null : rawText);
  const showOverrideButton = event.kind !== 'OVERRIDE';
  // Show "Bind to activity" on every non-OVERRIDE event when we have the
  // subjectTenantId context.
  const showBindButton = showOverrideButton && subjectTenantId !== undefined;

  // Display name for the bind dialog header: prefer filename for file uploads,
  // fall back to a truncated snippet or the event kind.
  const displayName =
    fileUpload?.filename ?? (snippet ? truncate(snippet, 40) : event.effective_kind);

  return (
    <article className="border rounded-md p-4 space-y-2 bg-card">
      <header className="flex flex-wrap items-center gap-2">
        <KindChip kind={event.effective_kind} />
        <ConfidenceChip
          value={event.classification?.confidence}
          isOverridden={event.is_overridden}
        />
        {event.classification?.statutory_anchor ? (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            {event.classification.statutory_anchor}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatRelative(event.captured_at)}
        </span>
      </header>

      {/* File-upload event: render a structured file card. */}
      {fileUpload ? (
        <div className="flex items-start gap-3 mt-1">
          <div className="rounded bg-primary/10 p-2 text-primary shrink-0">
            <FileText className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" title={fileUpload.filename}>
              {fileUpload.filename}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
              <span>{fileUpload.mimeType}</span>
              {fileUpload.sizeKb ? <span>· {fileUpload.sizeKb}</span> : null}
              {fileUpload.sha256 ? (
                <span
                  className="inline-flex items-center gap-1"
                  title={`SHA-256: ${fileUpload.sha256}`}
                >
                  <Hash className="h-3 w-3" />
                  {fileUpload.sha256.slice(0, 12)}…
                </span>
              ) : null}
            </p>
            {fileUpload.description ? (
              <p className="text-xs text-muted-foreground mt-1.5 italic">
                {truncate(fileUpload.description, 140)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Non-file events: original text snippet. */}
      {snippet ? (
        <p className="text-sm">
          {event.kind === 'OVERRIDE' ? (
            <span className="text-muted-foreground italic">Reason: </span>
          ) : null}
          {truncate(snippet)}
        </p>
      ) : null}

      {event.classification?.rationale ? (
        <p className="text-xs italic text-muted-foreground">{event.classification.rationale}</p>
      ) : null}

      {/* Linked-to chips — shown when linkedActivities have been resolved. */}
      {linkedActivities !== undefined && linkedActivities.length > 0 ? (
        <LinkedToChips linkedActivities={linkedActivities} />
      ) : null}

      {/* Action row: Override + Bind to activity */}
      {showOverrideButton || showBindButton ? (
        <div className="flex items-center justify-end gap-3">
          {showBindButton ? (
            <BindToActivityButton
              eventId={event.id}
              filename={displayName}
              subjectTenantId={subjectTenantId}
            />
          ) : null}
          {showOverrideButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOverride?.(event)}
              disabled={!onOverride}
            >
              Override
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
