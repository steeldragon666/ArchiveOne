'use client';
/**
 * Uploaded Evidence — prominent list of file uploads with full AI analysis
 * displayed per row.
 *
 * Distinct from EventFeed (which shows ALL chain events including pasted
 * transcripts, override events, and so on). This component filters to
 * just events whose raw_text starts with `[FILE UPLOAD]` — i.e. things a
 * consultant explicitly uploaded — and renders them as rich cards with:
 *   - Filename as a large title
 *   - File type / size / SHA-256 prefix in mono
 *   - AI classification: kind chip + confidence percentage + statutory anchor
 *   - AI rationale: the full Haiku-produced sentence explaining the call
 *   - Model + timestamp
 *   - AI extraction: proposed activities + invoices (collapsible section)
 *
 * Why a separate component (not a flag on EventFeed): the consultant's
 * mental model is "I uploaded files; what did the AI think of each?"
 * Mixing uploads with pasted text + override events buries that thread.
 * This is the surface for "see what I uploaded + what the AI made of
 * it"; the chronological feed below is the audit-grade chain log.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Hash,
  Sparkles,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { Event as ApiEvent } from '@cpa/schemas';
import { listEvents } from '../../_lib/api';
import { getExtraction, triggerExtraction } from '../_lib/extraction-api';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProposedActivityCard } from './proposed-activity-card';
import { ProposedInvoiceCard } from './proposed-invoice-card';
import type { DocumentExtractionResult, ExtractionStatus } from '../_lib/extraction-api';

// ---------------------------------------------------------------------------
// Parser — same shape as event-card.tsx but extracted for re-use here.
// ---------------------------------------------------------------------------

interface FileUploadParsed {
  filename: string;
  mimeType: string;
  sizeKb: string;
  sha256: string;
  description?: string;
}
const FILE_UPLOAD_PREFIX = '[FILE UPLOAD] ';
const parseFileUpload = (raw: string | null | undefined): FileUploadParsed | null => {
  if (!raw || !raw.startsWith(FILE_UPLOAD_PREFIX)) return null;
  const lines = raw.split('\n');
  const filename = lines[0]?.slice(FILE_UPLOAD_PREFIX.length).trim() ?? '';
  if (!filename) return null;
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return {
    filename,
    mimeType: fields['Type'] ?? 'application/octet-stream',
    sizeKb: fields['Size'] ?? '',
    sha256: fields['SHA-256'] ?? '',
    description: fields['Description'] ?? undefined,
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  HYPOTHESIS: 'Hypothesis',
  UNCERTAINTY: 'Technical uncertainty',
  DESIGN: 'Design / methodology',
  ITERATION: 'Iteration / refinement',
  OBSERVATION: 'Observation',
  NEW_KNOWLEDGE: 'New knowledge',
  TIME_LOG: 'Time log',
  EXPENDITURE_NOTE: 'Expenditure',
  SUPPORTING: 'Supporting',
  INELIGIBLE: 'Ineligible (filtered)',
  OVERRIDE: 'Override',
};

const KIND_COLOUR: Record<string, string> = {
  HYPOTHESIS:
    'border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent))]/10 text-[hsl(var(--brand-accent-strong))]',
  UNCERTAINTY:
    'border-[hsl(var(--brand-warning))]/40 bg-[hsl(var(--brand-warning))]/10 text-[hsl(var(--brand-warning))]',
  DESIGN:
    'border-[hsl(var(--brand-info))]/40 bg-[hsl(var(--brand-info))]/10 text-[hsl(var(--brand-info))]',
  ITERATION:
    'border-[hsl(var(--brand-info))]/40 bg-[hsl(var(--brand-info))]/10 text-[hsl(var(--brand-info))]',
  OBSERVATION:
    'border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent))]/10 text-[hsl(var(--brand-accent-strong))]',
  NEW_KNOWLEDGE:
    'border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent))]/10 text-[hsl(var(--brand-accent-strong))]',
  TIME_LOG: 'border-border bg-muted text-muted-foreground',
  EXPENDITURE_NOTE: 'border-border bg-muted text-muted-foreground',
  SUPPORTING: 'border-border bg-muted text-muted-foreground',
  INELIGIBLE: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  subjectTenantId: string;
  /**
   * When true, the per-proposal "Confirm activity" / "Confirm invoice" cards
   * are rendered inside each upload card (the legacy per-document flow).
   * When false (default), the proposal cards are hidden and the consultant is
   * expected to approve everything in one gesture via PendingNarrativePanel.
   *
   * The two paths produce IDENTICAL chain events server-side — this is purely
   * a UX choice. Activities/invoices created via either are indistinguishable
   * on the Activities/Expenditure tabs (apart from the needs_review chip on
   * low-confidence narrative-approved items).
   */
  showProposalConfirmCards?: boolean;
}

export function UploadedEvidenceList({ subjectTenantId, showProposalConfirmCards = false }: Props) {
  const { data, isPending, error } = useQuery({
    queryKey: ['events', subjectTenantId, 'all', 200],
    queryFn: () => listEvents({ subject_tenant_id: subjectTenantId, filter: 'all', limit: 200 }),
  });

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading uploaded evidence…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }

  // Filter to file-upload events only, with their parsed metadata.
  type Row = { event: ApiEvent; file: FileUploadParsed };
  const rows: Row[] = data.events
    .map((event) => {
      const payload = event.payload as { raw_text?: string } | null;
      const file = parseFileUpload(payload?.raw_text);
      return file ? { event, file } : null;
    })
    .filter((r): r is Row => r !== null);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="file"
        title="No files uploaded yet"
        description="Drop PDFs, Word documents, screenshots, lab notes — anything. Each file becomes an evidence event with a SHA-256 hash and AI-classified kind."
      />
    );
  }

  // Aggregate stats for the header.
  const classifiedCount = rows.filter((r) => r.event.classification?.kind != null).length;
  const ineligibleCount = rows.filter((r) => r.event.classification?.kind === 'INELIGIBLE').length;
  const avgConfidence =
    rows
      .filter((r) => typeof r.event.classification?.confidence === 'number')
      .reduce((acc, r) => acc + r.event.classification!.confidence, 0) /
    Math.max(1, classifiedCount);

  return (
    <div className="space-y-4">
      {/* Stats banner */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-display text-2xl font-medium tabular-nums">{rows.length}</span>
          <span className="text-muted-foreground ml-1.5">files</span>
        </span>
        <span>
          <span className="font-display text-2xl font-medium tabular-nums">{classifiedCount}</span>
          <span className="text-muted-foreground ml-1.5">AI-analysed</span>
        </span>
        <span>
          <span className="font-display text-2xl font-medium tabular-nums">
            {Math.round(avgConfidence * 100)}%
          </span>
          <span className="text-muted-foreground ml-1.5">avg confidence</span>
        </span>
        {ineligibleCount > 0 && (
          <span className="text-destructive">
            <span className="font-display text-2xl font-medium tabular-nums">
              {ineligibleCount}
            </span>
            <span className="ml-1.5">flagged ineligible</span>
          </span>
        )}
      </div>

      {/* Rich evidence cards */}
      <div className="space-y-3">
        {rows.map((r) => (
          <UploadedFileCard
            key={r.event.id}
            event={r.event}
            file={r.file}
            subjectTenantId={subjectTenantId}
            showProposalConfirmCards={showProposalConfirmCards}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-file card — primary surface for AI analysis + extraction proposals
// ---------------------------------------------------------------------------

function UploadedFileCard({
  event,
  file,
  subjectTenantId,
  showProposalConfirmCards,
}: {
  event: ApiEvent;
  file: FileUploadParsed;
  subjectTenantId: string;
  showProposalConfirmCards: boolean;
}) {
  const c = event.classification;
  const classifiedKind = c?.kind ?? null;
  const confidence = typeof c?.confidence === 'number' ? c.confidence : null;
  const rationale = c?.rationale ?? null;
  const anchor = c?.statutory_anchor ?? null;
  const model = c?.model ?? null;

  const kindLabel = classifiedKind ? (KIND_LABEL[classifiedKind] ?? classifiedKind) : 'Pending';
  const kindClasses =
    classifiedKind && KIND_COLOUR[classifiedKind]
      ? KIND_COLOUR[classifiedKind]
      : 'border-border bg-muted text-muted-foreground';
  const isIneligible = classifiedKind === 'INELIGIBLE';

  return (
    <Card className="border-border">
      <CardContent className="p-5 space-y-4">
        {/* Top row: filename + AI kind chip + confidence */}
        <div className="flex flex-wrap items-start gap-4">
          {/* File icon + name + meta */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="rounded bg-primary/10 p-2 text-primary shrink-0 mt-0.5">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                className="font-display text-lg font-medium leading-tight truncate"
                title={file.filename}
              >
                {file.filename}
              </h3>
              <p className="font-mono text-[10px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span>{shortMime(file.mimeType)}</span>
                {file.sizeKb && <span>· {file.sizeKb}</span>}
                {file.sha256 && (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`SHA-256: ${file.sha256}`}
                  >
                    <Hash className="h-3 w-3" />
                    {file.sha256.slice(0, 12)}…
                  </span>
                )}
                <span>· {formatRelative(event.captured_at)}</span>
              </p>
            </div>
          </div>

          {/* AI classification chip + confidence */}
          {classifiedKind && (
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest ${kindClasses}`}
              >
                {kindLabel}
              </span>
              {confidence !== null && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {Math.round(confidence * 100)}% confidence
                </span>
              )}
            </div>
          )}
        </div>

        {/* AI rationale — the primary content */}
        {rationale && (
          <div
            className={`rounded border-l-4 px-4 py-3 ${
              isIneligible
                ? 'border-destructive bg-destructive/5'
                : 'border-[hsl(var(--brand-accent))] bg-[hsl(var(--brand-accent-subtle))]/30'
            }`}
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
              {isIneligible ? (
                <AlertCircle className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              AI analysis
              {model && (
                <span className="ml-auto font-normal normal-case tracking-normal">{model}</span>
              )}
            </p>
            <p className="text-sm leading-relaxed">{rationale}</p>
            {anchor && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-2 pt-2 border-t border-border/50">
                ITAA 1997 anchor &middot; {anchor}
              </p>
            )}
          </div>
        )}

        {/* Description (consultant-supplied) */}
        {file.description && (
          <p className="text-xs text-muted-foreground italic">
            <span className="font-mono uppercase tracking-widest text-[10px] not-italic mr-2">
              Note
            </span>
            {file.description}
          </p>
        )}

        {/* AI Extraction proposals (activities + invoices) */}
        <ExtractionSection
          eventId={event.id}
          subjectTenantId={subjectTenantId}
          sourceFilename={file.filename}
          showProposalConfirmCards={showProposalConfirmCards}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Extraction section — polls for extraction status + renders proposals
// ---------------------------------------------------------------------------

function ExtractionSection({
  eventId,
  subjectTenantId,
  sourceFilename,
  showProposalConfirmCards,
}: {
  eventId: string;
  subjectTenantId: string;
  sourceFilename: string;
  showProposalConfirmCards: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['extraction', eventId],
    queryFn: () => getExtraction(eventId),
    // Poll every 3s while pending so the UI updates when the job completes.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'not_started' ? 3000 : false;
    },
    // Only fetch if the event might have extraction data.
    staleTime: 10_000,
  });

  const status: ExtractionStatus = data?.status ?? 'not_started';
  const result: DocumentExtractionResult | null = data?.result ?? null;

  const activityCount = result?.activities?.length ?? 0;
  const invoiceCount = result?.invoices?.length ?? 0;

  // Don't render the section at all if extraction has never run and there are
  // no proposals — keeps the card clean for older uploads.
  if (status === 'not_started' && !isLoading) {
    return null;
  }

  // Pending state: show a subtle loading indicator.
  if (status === 'pending' || isLoading) {
    return (
      <div className="flex items-center gap-2 pt-1 border-t border-border/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Analysing document…
        </p>
      </div>
    );
  }

  // Failed state.
  if (status === 'failed') {
    return (
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Extraction failed
          {data?.error ? ` · ${data.error}` : ''}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 font-mono text-[9px] uppercase tracking-widest gap-1"
          onClick={() => {
            void triggerExtraction(eventId).then(() => void refetch());
          }}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  // Complete — render the collapsible proposals section.
  if (status === 'complete' && result) {
    const totalProposals = activityCount + invoiceCount;
    if (totalProposals === 0) {
      return (
        <div className="pt-1 border-t border-border/40">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            AI analysis complete · no activity or invoice proposals found
          </p>
          {result.document_summary && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">
              {result.document_summary}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="pt-1 border-t border-border/40 space-y-3">
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between group"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-accent))] flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            AI extracted
            {activityCount > 0 &&
              ` · ${activityCount} activity proposal${activityCount === 1 ? '' : 's'}`}
            {invoiceCount > 0 &&
              ` · ${invoiceCount} invoice record${invoiceCount === 1 ? '' : 's'}`}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="space-y-4">
            {/* Document summary */}
            {result.document_summary && (
              <p className="text-xs text-muted-foreground leading-snug italic">
                {result.document_summary}
              </p>
            )}

            {/* Narrative-mode notice: explain that the proposal cards are hidden
                here because the consultant will approve everything together via
                the PendingNarrativePanel above. Click "Review per-document" to
                see per-proposal Confirm buttons. */}
            {!showProposalConfirmCards && (activityCount > 0 || invoiceCount > 0) && (
              <p className="rounded border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground leading-snug">
                <span className="font-mono uppercase tracking-widest text-[9px] mr-1">
                  Heads-up
                </span>
                Per-proposal Confirm buttons are hidden in narrative-approval mode. Approve
                everything together using the AI narrative panel above, or switch the mode toggle to{' '}
                <span className="font-mono">Review per-document</span> if you want to confirm
                proposals individually.
              </p>
            )}

            {/* Activity proposals — only shown in per-document mode */}
            {showProposalConfirmCards && activityCount > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  Activity proposals
                </p>
                {result.activities.map((proposal, idx) => (
                  <ProposedActivityCard
                    key={idx}
                    eventId={eventId}
                    activityIndex={idx}
                    proposal={proposal}
                    subjectTenantId={subjectTenantId}
                    sourceFilename={sourceFilename}
                  />
                ))}
              </div>
            )}

            {/* Invoice proposals — only shown in per-document mode */}
            {showProposalConfirmCards && invoiceCount > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  Invoice records
                </p>
                {result.invoices.map((invoice, idx) => (
                  <ProposedInvoiceCard
                    key={idx}
                    eventId={eventId}
                    invoiceIndex={idx}
                    invoice={invoice}
                    subjectTenantId={subjectTenantId}
                    sourceFilename={sourceFilename}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function shortMime(mime: string): string {
  // Long OOXML strings are ugly. Replace with friendly labels.
  if (mime.includes('wordprocessingml')) return 'DOCX';
  if (mime.includes('spreadsheetml')) return 'XLSX';
  if (mime.includes('presentationml')) return 'PPTX';
  if (mime === 'application/msword') return 'DOC';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.slice(6).toUpperCase();
  if (mime === 'text/plain') return 'TXT';
  if (mime === 'text/markdown') return 'MD';
  return mime;
}
