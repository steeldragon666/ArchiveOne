'use client';

/**
 * Final Draft tab — rendered after the AI finalisation job completes.
 *
 * Shows:
 *   - Per-activity narrative prose sections
 *   - Download links for each PDF in the claim package
 *   - "Approve and lock" / "Send back for revisions" CTAs
 *
 * Data: GET /v1/claims/:id/final-draft
 * Polling: while finalisation is 'active', polls GET /v1/claims/:id/finalisation-status
 *   every 3s and shows a progress bar.
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getFinalDraft, getFinalisationStatus } from '../_lib/workflow-api';

// ---------------------------------------------------------------------------
// Progress display (shown while finalisation is in flight)
// ---------------------------------------------------------------------------

function FinalisationProgress({ claimId }: { claimId: string }) {
  const qc = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['finalisation-status', claimId] as const,
    queryFn: () => getFinalisationStatus(claimId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 3000;
    },
  });

  // When completed, invalidate the final-draft query so it auto-fetches.
  useEffect(() => {
    if (statusQuery.data?.status === 'completed') {
      void qc.invalidateQueries({ queryKey: ['final-draft', claimId] });
    }
  }, [statusQuery.data?.status, claimId, qc]);

  if (statusQuery.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking finalisation status…
      </div>
    );
  }

  const status = statusQuery.data?.status ?? 'not_started';
  const progress = statusQuery.data?.progress;

  if (status === 'not_started') {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center space-y-2">
        <Clock className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">No finalisation started yet</p>
        <p className="text-xs text-muted-foreground">
          Use the "Submit Claim" button in the page header to start the AI drafting process.
        </p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium text-destructive">Finalisation failed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {statusQuery.data?.error ?? 'An error occurred during narrative drafting.'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'queued' || status === 'active') {
    const activitiesDrafted = progress?.activities_drafted ?? 0;
    const totalActivities = progress?.total_activities ?? 0;
    const pdfsDone = progress?.pdfs_generated ?? 0;
    const totalPdfs = progress?.total_pdfs ?? 6;
    const pct = totalActivities > 0 ? Math.round((activitiesDrafted / totalActivities) * 100) : 0;

    return (
      <div className="space-y-4 py-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">
              {status === 'queued' ? 'Queued for processing…' : 'Drafting narrative…'}
            </p>
            <p className="text-xs text-muted-foreground">
              {activitiesDrafted} of {totalActivities} activities drafted
              {pdfsDone > 0 && ` · ${pdfsDone} of ${totalPdfs} PDFs generated`}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  // Completed — caller will re-render with FinalDraftContent.
  return null;
}

// ---------------------------------------------------------------------------
// PDF download row
// ---------------------------------------------------------------------------

function PdfRow({ label, url, available }: { label: string; url?: string; available: boolean }) {
  const handleDownload = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = label.replace(/\s+/g, '-').toLowerCase() + '.pdf';
    a.click();
  };

  return (
    <div className="flex items-center justify-between rounded border p-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm">{label}</span>
        {!available && <span className="text-[10px] text-muted-foreground">(coming soon)</span>}
      </div>
      {available && url && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-7 text-xs"
          onClick={handleDownload}
          type="button"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main final draft content (post-completion)
// ---------------------------------------------------------------------------

function FinalDraftContent({ claimId }: { claimId: string }) {
  const draftQuery = useQuery({
    queryKey: ['final-draft', claimId] as const,
    queryFn: () => getFinalDraft(claimId),
    staleTime: 60_000,
  });

  if (draftQuery.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading final draft…
      </div>
    );
  }

  if (draftQuery.error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
        <p className="text-sm text-destructive">
          Failed to load final draft:{' '}
          {draftQuery.error instanceof Error ? draftQuery.error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  const data = draftQuery.data;
  const urls = data.pdf_urls;

  return (
    <div className="space-y-8">
      {/* Lock status banner */}
      {data.locked && (
        <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          <p className="text-sm text-green-700">
            This claim has been submitted and is locked. Documents are read-only.
          </p>
        </div>
      )}

      {/* PDF Pack */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          R&DTI Claim Package
        </h2>
        <div className="space-y-1.5">
          <PdfRow label="Claim Summary" url={urls.claim_summary} available={!!urls.claim_summary} />
          <PdfRow
            label="Apportionment Report"
            url={urls.apportionment}
            available={!!urls.apportionment}
          />
          <PdfRow label="Activity Register" url={undefined} available={false} />
          <PdfRow label="Ingest Summary" url={undefined} available={false} />
          <PdfRow label="Executive Summary" url={undefined} available={false} />
          <PdfRow label="Evidence Index" url={undefined} available={false} />
        </div>
      </section>

      {/* Narrative sections */}
      {data.sections.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Narrative Drafts
          </h2>
          <div className="space-y-6">
            {data.sections.map((section) => (
              <article key={section.activity_id} className="rounded-lg border p-4 space-y-2">
                <header>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {section.activity_code}
                  </span>
                  <h3 className="text-sm font-medium">{section.activity_title}</h3>
                  <p className="text-[10px] text-muted-foreground">
                    Generated {new Date(section.generated_at).toLocaleDateString()}
                  </p>
                </header>
                <div className="prose prose-sm max-w-none text-sm">
                  {section.prose.split('\n\n').map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {data.sections.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No narrative sections generated yet. The finalisation job is still running or has not
            been started.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function FinalDraftTab({ claimId }: { claimId: string }) {
  const statusQuery = useQuery({
    queryKey: ['finalisation-status', claimId] as const,
    queryFn: () => getFinalisationStatus(claimId),
    staleTime: 5_000,
  });

  const status = statusQuery.data?.status;

  // Show content view when completed; otherwise show progress/waiting.
  if (status === 'completed') {
    return <FinalDraftContent claimId={claimId} />;
  }

  return <FinalisationProgress claimId={claimId} />;
}
