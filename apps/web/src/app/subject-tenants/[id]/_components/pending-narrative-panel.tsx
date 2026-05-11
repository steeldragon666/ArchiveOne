'use client';
/**
 * PendingNarrativePanel
 *
 * The "agree with the AI's read" gate that sits between document extraction
 * and activity creation. Renders an Opus-written 2-3 sentence narrative
 * summarising what the AI has found across all uploaded documents (or just
 * the latest batch, if a prior narrative has been approved), and lets the
 * consultant approve everything in one gesture.
 *
 * On approve:
 *   - Server creates every non-excluded activity + expenditure
 *   - Items with confidence < AUTO_CREATE_CONFIDENCE_THRESHOLD (default 0.80)
 *     are flagged needs_review=true → shown with a 🤖 chip on the Activities tab
 *   - One NARRATIVE_APPROVED chain event captures the approval moment
 *
 * Hidden when there's nothing pending (e.g. no extractions yet, or everything
 * already approved). Shows a brief "Approved · auto-created N activities + M
 * invoices" success state after submission until the page is reloaded.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  CheckCircle2,
  Loader2,
  FileText,
  Receipt,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  approveNarrative,
  getPendingNarrative,
  type ApproveNarrativeRequest,
} from '../_lib/narrative-api';

interface Props {
  subjectTenantId: string;
}

/**
 * Local confidence threshold used to colour the per-proposal confidence chip.
 * The actual server-side threshold (`AUTO_CREATE_CONFIDENCE_THRESHOLD`) is
 * authoritative for needs_review; this is just for visual emphasis here.
 */
const HIGH_CONFIDENCE = 0.8;

const formatAud = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export function PendingNarrativePanel({ subjectTenantId }: Props) {
  const [reviewMode, setReviewMode] = useState(false);
  const [excluded, setExcluded] = useState<
    Set<string> // key: `${event_id}:${kind}:${index}`
  >(new Set());
  const [submittedSummary, setSubmittedSummary] = useState<{
    activities_created: number;
    invoices_created: number;
    excluded_count: number;
    total_aud: number;
  } | null>(null);

  const qc = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['pending-narrative', subjectTenantId],
    queryFn: () => getPendingNarrative(subjectTenantId),
    // Poll every 5s while extractions might still be running. Once it returns
    // status: 'none' or status: 'pending' (stable shape), we stop.
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      // Re-poll if backend isn't reachable yet (data undefined) or returns 'none'
      // because new uploads might still be processing in the background.
      if (!status || status === 'none') return 15_000;
      return false; // stable 'pending' — only refetch on manual invalidation
    },
  });

  const mutation = useMutation({
    mutationFn: (req: ApproveNarrativeRequest) => approveNarrative(subjectTenantId, req),
    onSuccess: (res) => {
      setSubmittedSummary(res);
      toast({
        title: 'Narrative approved',
        description: `Auto-created ${res.activities_created} ${
          res.activities_created === 1 ? 'activity' : 'activities'
        } and ${res.invoices_created} invoice${
          res.invoices_created === 1 ? '' : 's'
        } · ${formatAud(res.total_aud)} total expenditure.`,
      });
      // Invalidate adjacent caches so newly-created activities / expenditures
      // show up immediately on neighbouring views.
      void qc.invalidateQueries({ queryKey: ['pending-narrative', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
      void qc.invalidateQueries({ queryKey: ['expenditures'] });
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
    },
    onError: (err) => {
      toast({
        title: 'Approval failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Loading state — keep this subtle. The panel is non-essential until ready.
  if (query.isPending) {
    return null;
  }
  // Backend not reachable or wrong shape — fail silently rather than break the page.
  if (query.isError) {
    return null;
  }
  if (!query.data || query.data.status === 'none') {
    return submittedSummary ? <PostApprovalCard summary={submittedSummary} /> : null;
  }

  const data = query.data;

  if (submittedSummary) {
    return <PostApprovalCard summary={submittedSummary} />;
  }

  const toggleExcluded = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onApprove = () => {
    const excluded_proposals: NonNullable<ApproveNarrativeRequest['excluded_proposals']> = [];
    for (const key of excluded) {
      // Key shape is `${event_id}:${kind}:${index}` — we control it on insert
      // so the split is always exactly 3 segments.
      const parts = key.split(':');
      if (parts.length !== 3) continue;
      excluded_proposals.push({
        event_id: parts[0]!,
        kind: parts[1] as 'activity' | 'invoice',
        index: Number(parts[2]),
      });
    }
    mutation.mutate(excluded_proposals.length > 0 ? { excluded_proposals } : {});
  };

  const willBeCreated = {
    activities: data.activities.filter((a) => !excluded.has(`${a.event_id}:activity:${a.index}`)),
    invoices: data.invoices.filter((i) => !excluded.has(`${i.event_id}:invoice:${i.index}`)),
  };
  const lowConfidenceCount =
    willBeCreated.activities.filter((a) => a.confidence < HIGH_CONFIDENCE).length +
    willBeCreated.invoices.filter((i) => i.confidence < HIGH_CONFIDENCE).length;

  return (
    <Card className="border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent-subtle))]/30">
      <CardContent className="p-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded bg-[hsl(var(--brand-accent))]/15 p-2">
              <Brain className="h-4 w-4 text-[hsl(var(--brand-accent-strong))]" />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--brand-accent-strong))]">
                AI analysis ready · pending your approval
              </p>
              <h3 className="font-display text-xl font-medium leading-tight">
                {data.document_count} document{data.document_count === 1 ? '' : 's'} analysed
                {data.is_first_approval ? '' : ' (new batch)'}
              </h3>
            </div>
          </div>

          {/* Stats banner */}
          <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <Stat label="activities" value={`${data.core_count + data.supporting_count}`} />
            <Stat
              label="core / supporting"
              value={`${data.core_count} / ${data.supporting_count}`}
            />
            <Stat label="invoices" value={`${data.invoice_count}`} />
            <Stat label="total" value={formatAud(data.total_aud)} />
          </div>
        </div>

        {/* Narrative — the headline thing the consultant reads */}
        <div className="rounded border-l-4 border-[hsl(var(--brand-accent))] bg-background/60 px-4 py-3.5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[hsl(var(--brand-accent))]" />
            Project narrative
            <span className="ml-auto font-normal normal-case tracking-normal">Opus 4.7</span>
          </p>
          <p className="text-sm leading-relaxed">{data.narrative}</p>
        </div>

        {/* Threshold caveat — visible so the consultant knows what auto-creates vs gets flagged */}
        {lowConfidenceCount > 0 && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[hsl(var(--brand-warning))]" />
            <p className="leading-snug">
              <span className="font-medium text-foreground">{lowConfidenceCount}</span>{' '}
              {lowConfidenceCount === 1 ? 'item has' : 'items have'} confidence below 80% —
              they&apos;ll still be auto-created, but flagged with a{' '}
              <span className="font-mono">🤖 review</span> chip on the Activities tab so you can
              spot-check.
            </p>
          </div>
        )}

        {/* Toggle: review & exclude items before approving */}
        <button
          type="button"
          onClick={() => setReviewMode((v) => !v)}
          className="w-full flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          <span>
            {reviewMode
              ? `Review mode · ${excluded.size > 0 ? `${excluded.size} excluded` : 'all items selected'}`
              : 'Review & exclude items before approving'}
          </span>
          {reviewMode ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        {reviewMode && (
          <div className="space-y-3">
            {data.activities.length > 0 && (
              <ReviewSection title="Activities">
                {data.activities.map((a) => {
                  const key = `${a.event_id}:activity:${a.index}`;
                  return (
                    <ReviewRow
                      key={key}
                      checked={!excluded.has(key)}
                      onToggle={() => toggleExcluded(key)}
                      icon={
                        a.kind === 'core' ? (
                          <span className="font-mono text-[9px] uppercase tracking-widest text-[hsl(var(--brand-accent-strong))]">
                            CORE
                          </span>
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                            SUPP
                          </span>
                        )
                      }
                      title={a.name}
                      subtitle={a.hypothesis}
                      meta={
                        <>
                          <ConfidencePill confidence={a.confidence} />
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <FileText className="h-3 w-3" /> {a.source_filename}
                          </span>
                        </>
                      }
                    />
                  );
                })}
              </ReviewSection>
            )}

            {data.invoices.length > 0 && (
              <ReviewSection title="Invoices">
                {data.invoices.map((i) => {
                  const key = `${i.event_id}:invoice:${i.index}`;
                  return (
                    <ReviewRow
                      key={key}
                      checked={!excluded.has(key)}
                      onToggle={() => toggleExcluded(key)}
                      icon={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}
                      title={i.vendor}
                      subtitle={formatAud(i.total_aud)}
                      meta={
                        <>
                          <ConfidencePill confidence={i.confidence} />
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <FileText className="h-3 w-3" /> {i.source_filename}
                          </span>
                        </>
                      }
                    />
                  );
                })}
              </ReviewSection>
            )}
          </div>
        )}

        {/* Approve action */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            size="lg"
            onClick={onApprove}
            disabled={mutation.isPending}
            className="gap-2"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Approving…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Approve &amp; auto-create{' '}
                {willBeCreated.activities.length + willBeCreated.invoices.length}{' '}
                {willBeCreated.activities.length + willBeCreated.invoices.length === 1
                  ? 'item'
                  : 'items'}
              </>
            )}
          </Button>
          {excluded.size > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              ({excluded.size} excluded)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-display text-lg font-medium tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
    </span>
  );
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cls =
    confidence >= 0.8
      ? 'bg-[hsl(var(--brand-accent))]/15 text-[hsl(var(--brand-accent-strong))]'
      : confidence >= 0.6
        ? 'bg-[hsl(var(--brand-warning))]/15 text-[hsl(var(--brand-warning))]'
        : 'bg-muted text-muted-foreground';
  return <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] ${cls}`}>{pct}%</span>;
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ReviewRow({
  checked,
  onToggle,
  icon,
  title,
  subtitle,
  meta,
}: {
  checked: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  meta: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded border px-3 py-2 cursor-pointer transition-colors ${
        checked
          ? 'border-border bg-background/40 hover:bg-background/70'
          : 'border-border/40 bg-muted/20 opacity-60 hover:opacity-100'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[hsl(var(--brand-accent-strong))]"
      />
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight truncate">{title}</p>
        <p className="text-xs text-muted-foreground leading-snug line-clamp-2">{subtitle}</p>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-0.5">{meta}</div>
    </label>
  );
}

function PostApprovalCard({
  summary,
}: {
  summary: {
    activities_created: number;
    invoices_created: number;
    excluded_count: number;
    total_aud: number;
  };
}) {
  return (
    <Card className="border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-subtle))]/15">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded bg-[hsl(var(--brand-accent))]/15 p-2 shrink-0">
          <CheckCircle2 className="h-4 w-4 text-[hsl(var(--brand-accent-strong))]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Narrative approved</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            Auto-created {summary.activities_created} activit
            {summary.activities_created === 1 ? 'y' : 'ies'} · {summary.invoices_created} invoice
            {summary.invoices_created === 1 ? '' : 's'} ·{' '}
            {summary.total_aud.toLocaleString('en-AU', {
              style: 'currency',
              currency: 'AUD',
            })}{' '}
            total
            {summary.excluded_count > 0 && ` · ${summary.excluded_count} excluded`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
