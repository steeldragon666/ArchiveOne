'use client';
import { useCallback, useReducer } from 'react';
import { Download, FileText, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { listActivities } from '../_lib/api';

/**
 * Documents tab — full 7-template PDF pack for a claim.
 *
 * Architecture:
 *   - API is SYNC: each PDF endpoint streams bytes on demand (no async job).
 *   - "Generate documents" button fans out — triggers all available endpoints
 *     in parallel, tracks per-row status (idle / generating / ready / error).
 *   - Unavailable templates (backend route not yet shipped) are shown as
 *     placeholder rows so the consultant sees the full pack shape.
 *
 * Sections:
 *   1. Claim-level pack — the compile-all CTA lives here.
 *      Available:
 *        - Claim summary       GET /v1/claims/:id/summary.pdf
 *        - Apportionment report GET /v1/claims/:id/apportionment.pdf
 *      Coming soon (templates exist in @cpa/documents; routes not yet shipped):
 *        - Ingest Summary
 *        - Executive Summary
 *        - Portal Narrative Pack
 *        - Expenditure Schedule
 *        - Evidence Index
 *        - Compliance Notes
 *
 *   2. Activity-level documents — one row per activity.
 *      Available: GET /v1/activities/:id/application.pdf (Activity Register / application PDF)
 *
 * Download flow for available PDFs:
 *   - On "Generate documents" click: status → 'generating' for all available docs.
 *   - Each available PDF fires a fetch request, captures the blob, creates an
 *     object URL, and programmatically clicks a hidden <a download> anchor.
 *   - Status → 'ready' on success, 'error' on failure.
 *   - Toast summarises the batch result.
 *
 * Individual row buttons use standard <a download> links (no JS needed) for
 * single-document downloads outside the batch flow.
 */

type DocStatus = 'idle' | 'generating' | 'ready' | 'error';

interface ClaimDocState {
  summary: DocStatus;
  apportionment: DocStatus;
  ingestSummary: DocStatus;
  executiveSummary: DocStatus;
  portalNarrative: DocStatus;
  evidenceIndex: DocStatus;
}

type ClaimDocAction =
  | { type: 'start_all' }
  | { type: 'set'; doc: keyof ClaimDocState; status: DocStatus };

function claimDocReducer(state: ClaimDocState, action: ClaimDocAction): ClaimDocState {
  switch (action.type) {
    case 'start_all':
      return {
        summary: 'generating',
        apportionment: 'generating',
        ingestSummary: 'generating',
        executiveSummary: 'generating',
        portalNarrative: 'generating',
        evidenceIndex: 'generating',
      };
    case 'set':
      return { ...state, [action.doc]: action.status };
  }
}

const INITIAL_CLAIM_DOC_STATE: ClaimDocState = {
  summary: 'idle',
  apportionment: 'idle',
  ingestSummary: 'idle',
  executiveSummary: 'idle',
  portalNarrative: 'idle',
  evidenceIndex: 'idle',
};

// Activity-level doc status: keyed by activity id
type ActivityDocStatuses = Record<string, DocStatus>;

function activityDocReducer(
  state: ActivityDocStatuses,
  action:
    | { type: 'start_all'; activityIds: string[] }
    | { type: 'set'; activityId: string; status: DocStatus },
): ActivityDocStatuses {
  switch (action.type) {
    case 'start_all': {
      const next: ActivityDocStatuses = { ...state };
      for (const id of action.activityIds) next[id] = 'generating';
      return next;
    }
    case 'set':
      return { ...state, [action.activityId]: action.status };
  }
}

/**
 * Download a PDF from the given URL and trigger a browser save dialog.
 * Returns the blob URL for optional display; caller should revoke it
 * when done.
 */
async function triggerPdfDownload(apiUrl: string, filename: string): Promise<void> {
  const res = await fetch(apiUrl, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function DocumentsTab({ claimId }: { claimId: string }) {
  const { toast } = useToast();

  const activities = useQuery({
    queryKey: ['activities', { claimId }] as const,
    queryFn: () => listActivities(claimId),
  });

  const [claimDocState, dispatchClaim] = useReducer(claimDocReducer, INITIAL_CLAIM_DOC_STATE);
  const [activityDocState, dispatchActivity] = useReducer(activityDocReducer, {});

  const isAnyClaimDocGenerating = Object.values(claimDocState).some((s) => s === 'generating');

  const isAnyActivityDocGenerating = Object.values(activityDocState).some(
    (s) => s === 'generating',
  );

  const isGenerating = isAnyClaimDocGenerating || isAnyActivityDocGenerating;

  /** Fan out all available PDF downloads in parallel. */
  const handleGenerateAll = useCallback(async () => {
    const activityIds = activities.data?.map((a) => a.id) ?? [];

    dispatchClaim({ type: 'start_all' });
    if (activityIds.length > 0) {
      dispatchActivity({ type: 'start_all', activityIds });
    }

    let successCount = 0;
    let errorCount = 0;

    /**
     * Build the claim-level download fan-out. Each entry pairs a doc-state
     * key with the API path + filename — keeps the success/error handlers
     * symmetric so adding a 7th template later is a single line change.
     */
    const CLAIM_DOC_JOBS: Array<{
      doc: keyof ClaimDocState;
      path: string;
      filename: string;
    }> = [
      {
        doc: 'summary',
        path: `/v1/claims/${claimId}/summary.pdf`,
        filename: `claim-summary-${claimId}.pdf`,
      },
      {
        doc: 'apportionment',
        path: `/v1/claims/${claimId}/apportionment.pdf`,
        filename: `apportionment-${claimId}.pdf`,
      },
      {
        doc: 'ingestSummary',
        path: `/v1/claims/${claimId}/ingest-summary.pdf`,
        filename: `ingest-summary-${claimId}.pdf`,
      },
      {
        doc: 'executiveSummary',
        path: `/v1/claims/${claimId}/executive-summary.pdf`,
        filename: `executive-summary-${claimId}.pdf`,
      },
      {
        doc: 'portalNarrative',
        path: `/v1/claims/${claimId}/portal-narrative.pdf`,
        filename: `portal-narrative-${claimId}.pdf`,
      },
      {
        doc: 'evidenceIndex',
        path: `/v1/claims/${claimId}/evidence-index.pdf`,
        filename: `evidence-index-${claimId}.pdf`,
      },
    ];

    const claimJobs: Promise<void>[] = CLAIM_DOC_JOBS.map(({ doc, path, filename }) =>
      triggerPdfDownload(path, filename)
        .then(() => {
          dispatchClaim({ type: 'set', doc, status: 'ready' });
          successCount++;
        })
        .catch(() => {
          dispatchClaim({ type: 'set', doc, status: 'error' });
          errorCount++;
        }),
    );

    const activityJobs: Promise<void>[] = (activities.data ?? []).map((a) =>
      triggerPdfDownload(
        `/v1/activities/${a.id}/application.pdf`,
        `activity-${a.code.toLowerCase()}-application.pdf`,
      )
        .then(() => {
          dispatchActivity({ type: 'set', activityId: a.id, status: 'ready' });
          successCount++;
        })
        .catch(() => {
          dispatchActivity({ type: 'set', activityId: a.id, status: 'error' });
          errorCount++;
        }),
    );

    await Promise.allSettled([...claimJobs, ...activityJobs]);

    if (errorCount === 0) {
      toast({
        title: 'Documents generated',
        description: `${successCount} PDF${successCount !== 1 ? 's' : ''} downloaded successfully.`,
      });
    } else if (successCount === 0) {
      toast({
        title: 'Generation failed',
        description: 'All document requests failed. Check your session and try again.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Partially generated',
        description: `${successCount} downloaded, ${errorCount} failed. Failed rows are highlighted.`,
        variant: 'destructive',
      });
    }
  }, [claimId, activities.data, toast]);

  // 6 claim-level docs (summary, apportionment, ingest-summary, executive-summary,
  // portal-narrative, evidence-index) + N per-activity application PDFs.
  // Expenditure-schedule and Compliance-notes are still future-scope and excluded.
  const totalAvailable = 6 + (activities.data?.length ?? 0);

  return (
    <div className="space-y-6">
      {/* Batch generation CTA */}
      <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Generate full document pack</p>
          <p className="text-xs text-muted-foreground">
            Downloads all available PDFs in one batch. {totalAvailable} document
            {totalAvailable !== 1 ? 's' : ''} available.
          </p>
        </div>
        <Button
          onClick={() => void handleGenerateAll()}
          disabled={isGenerating || activities.isPending}
          className="shrink-0"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Generating…
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Generate documents
            </>
          )}
        </Button>
      </div>

      {/* Claim-level documents */}
      <section aria-labelledby="documents-claim-level-heading">
        <h2 id="documents-claim-level-heading" className="text-base font-semibold">
          Claim-level documents
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Generated from the aggregate of this claim&apos;s activities and expenditures.
        </p>
        <ul className="mt-3 divide-y rounded-md border bg-background">
          <DocumentRow
            label="Claim summary"
            description="One-page overview: activities table, expenditures rollup."
            href={`/v1/claims/${claimId}/summary.pdf`}
            downloadName={`claim-summary-${claimId}.pdf`}
            status={claimDocState.summary}
          />
          <DocumentRow
            label="Apportionment report"
            description="Audit-grade detail: how each expenditure mapped to activities."
            href={`/v1/claims/${claimId}/apportionment.pdf`}
            downloadName={`apportionment-${claimId}.pdf`}
            status={claimDocState.apportionment}
          />
          <DocumentRow
            label="Ingest summary"
            description="Raw transcript and evidence ingest log for this claim period."
            href={`/v1/claims/${claimId}/ingest-summary.pdf`}
            downloadName={`ingest-summary-${claimId}.pdf`}
            status={claimDocState.ingestSummary}
          />
          <DocumentRow
            label="Executive summary"
            description="Board-ready narrative: R&D objectives, key findings, and spend summary."
            href={`/v1/claims/${claimId}/executive-summary.pdf`}
            downloadName={`executive-summary-${claimId}.pdf`}
            status={claimDocState.executiveSummary}
          />
          <DocumentRow
            label="Portal narrative pack"
            description="AusIndustry portal upload bundle: formatted narratives per activity."
            href={`/v1/claims/${claimId}/portal-narrative.pdf`}
            downloadName={`portal-narrative-${claimId}.pdf`}
            status={claimDocState.portalNarrative}
          />
          <ComingSoonRow
            label="Expenditure schedule"
            description="Itemised expenditure listing mapped to eligible R&D activities."
          />
          <DocumentRow
            label="Evidence index"
            description="Indexed list of all linked evidence artefacts with chain-of-custody hashes."
            href={`/v1/claims/${claimId}/evidence-index.pdf`}
            downloadName={`evidence-index-${claimId}.pdf`}
            status={claimDocState.evidenceIndex}
          />
          <ComingSoonRow
            label="Compliance notes"
            description="Consultant sign-off checklist and compliance attestation."
          />
        </ul>
      </section>

      {/* Activity-level documents */}
      <section aria-labelledby="documents-activity-level-heading">
        <h2 id="documents-activity-level-heading" className="text-base font-semibold">
          Activity-level documents
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          One application PDF per activity — Section 355-25 narrative bundle.
        </p>
        <div className="mt-3">
          {activities.isPending ? (
            <p className="text-sm text-muted-foreground">Loading activities…</p>
          ) : activities.error ? (
            <p className="text-sm text-red-600">
              Failed to load activities:{' '}
              {activities.error instanceof Error ? activities.error.message : 'Unknown error'}
            </p>
          ) : activities.data.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No activities yet for this claim. Add an activity to enable per-activity downloads.
              </p>
            </div>
          ) : (
            <ul className="divide-y rounded-md border bg-background">
              {activities.data.map((a) => (
                <DocumentRow
                  key={a.id}
                  label={`Activity application — ${a.code} ${a.title}`}
                  description={a.kind === 'core' ? 'Core activity' : 'Supporting activity'}
                  href={`/v1/activities/${a.id}/application.pdf`}
                  downloadName={`activity-${a.code.toLowerCase()}-application.pdf`}
                  status={activityDocState[a.id] ?? 'idle'}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DocumentRowProps {
  label: string;
  description: string;
  href: string;
  downloadName: string;
  status: DocStatus;
}

/**
 * Available document row with download link and batch-status indicator.
 *
 * The <a download> anchor handles single-document download via browser
 * navigation (no JS required). The status indicator reflects the current
 * state when triggered via the batch "Generate documents" button.
 */
function DocumentRow({ label, description, href, downloadName, status }: DocumentRowProps) {
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <StatusIcon status={status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button
        asChild
        variant="outline"
        size="sm"
        disabled={status === 'generating'}
        className="shrink-0"
      >
        <a href={href} download={downloadName}>
          <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
          Download
        </a>
      </Button>
    </li>
  );
}

interface ComingSoonRowProps {
  label: string;
  description: string;
}

/**
 * Placeholder row for document templates whose API routes are not yet shipped.
 * Shows the label + description so consultants can see the full pack shape.
 */
function ComingSoonRow({ label, description }: ComingSoonRowProps) {
  return (
    <li className="flex items-center gap-4 px-4 py-3 opacity-50">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <span className="shrink-0 rounded border border-dashed px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Coming soon
      </span>
    </li>
  );
}

function StatusIcon({ status }: { status: DocStatus }) {
  switch (status) {
    case 'generating':
      return (
        <Loader2
          className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
          aria-label="Generating"
        />
      );
    case 'ready':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-label="Downloaded" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-label="Error" />;
    case 'idle':
    default:
      return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}
