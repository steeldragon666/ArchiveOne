'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react';
import type { WorkflowStepEntry } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import type { CanAdvance } from '../_lib/workflow-client';
import { StaleStepBanner } from './stale-step-banner';

/**
 * WizardStep5 — Generate AusIndustry Application.
 *
 * Wires the application-drafter pipeline (commit 1a12c2c) into the wizard:
 *   - POST /v1/claims/:id/generate-application  enqueues the Sonnet job
 *   - GET  /v1/claims/:id/application-draft     polls the result
 *
 * The drafter call takes 60-120 seconds (Sonnet writes ~25K words across
 * the 13 portal fields × N activities + the cross-cutting registers). We
 * poll every 5s while the draft is "pending"; on completion the panel
 * swaps to a structured preview of the produced ApplicationDraft.
 */

interface ApplicationDraftResponse {
  status: 'pending' | 'drafting' | 'complete' | 'failed';
  draft?: ApplicationDraftShape | null;
  message?: string;
}

interface ApplicationDraftShape {
  applicant: { name: string; abn: string | null; anzsic_division_class: string };
  income_year: string;
  project: { name: string; description: string };
  core_activities: Array<{
    activity_id: string;
    field_1_activity_name: string;
    field_2_describe: string;
    field_6_hypothesis: string;
    estimated_expenditure_aud_ex_gst: number;
    hypothesis_ids: string[];
  }>;
  supporting_activities: Array<{
    activity_id: string;
    field_name: string;
    field_description: string;
  }>;
  hypothesis_register: Array<{ id: string; hypothesis_text: string; validation_outcome: string }>;
  failure_register: Array<{ id: string; approach_attempted: string }>;
  new_knowledge_register: Array<{ id: string; contribution: string }>;
  submission_summary: string;
}

export function WizardStep5GenerateDocuments({
  claimId,
  subjectTenantId: _subjectTenantId,
  stepEntry,
  canAdvance,
}: {
  claimId: string;
  subjectTenantId: string;
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
}) {
  const qc = useQueryClient();

  const draftQuery = useQuery({
    queryKey: ['application-draft', claimId] as const,
    queryFn: () => apiFetch<ApplicationDraftResponse>(`/v1/claims/${claimId}/application-draft`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'complete' || status === 'failed') return false;
      // While pending/drafting, poll every 5 sec so the user sees progress.
      return 5_000;
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      apiFetch<{ status: string; job_id: string; message: string }>(
        `/v1/claims/${claimId}/generate-application`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['application-draft', claimId] });
    },
  });

  const draft = draftQuery.data?.draft ?? null;
  const status = draftQuery.data?.status ?? 'pending';
  const isDrafting = status === 'drafting' || generate.isPending;

  return (
    <section className="space-y-6" data-testid="wizard-step-5">
      <StaleStepBanner stepEntry={stepEntry} canAdvance={canAdvance} />
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Generate AusIndustry Application
        </h2>
        <p className="text-sm text-muted-foreground">
          Claude Sonnet drafts a portal-ready R&amp;D Tax Incentive registration application from
          your classified evidence: 13 portal fields per core activity, plus the hypothesis /
          failure / new-knowledge registers and the submission summary.
        </p>
      </header>

      {/* Trigger button — only show when no draft exists */}
      {!draft && status !== 'drafting' && (
        <div className="rounded-md border border-border p-5 bg-muted/20 space-y-3">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Ready to draft your application</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Triggers the Sonnet drafter against every classified event for this claim&apos;s
                fiscal year. Typically takes 60–120 seconds. You can navigate away — the draft will
                be ready when you return.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            data-testid="generate-application-button"
          >
            {generate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Enqueueing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1.5" />
                Generate application
              </>
            )}
          </Button>
          {generate.isError && (
            <p className="text-xs text-destructive">
              {generate.error instanceof Error ? generate.error.message : 'Generation failed'}
            </p>
          )}
        </div>
      )}

      {/* Drafting in progress */}
      {isDrafting && !draft && (
        <div className="rounded-md border border-border p-5 bg-primary/5">
          <div className="flex items-start gap-3">
            <Loader2 className="h-5 w-5 text-primary shrink-0 mt-0.5 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium">Drafting your application…</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Claude Sonnet is reading your classified evidence and writing all 13 AusIndustry
                portal fields per activity. This page polls every 5 seconds. ETA 60–120 seconds.
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Model: claude-sonnet-4-5 · expected output ~25,000 words
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Draft preview when complete */}
      {draft && <DraftPreview draft={draft} />}
    </section>
  );
}

function DraftPreview({ draft }: { draft: ApplicationDraftShape }) {
  const totalCore = draft.core_activities.length;
  const totalSupporting = draft.supporting_activities.length;
  const totalH = draft.hypothesis_register.length;
  const totalF = draft.failure_register.length;
  const totalNK = draft.new_knowledge_register.length;
  const totalExpenditure = draft.core_activities.reduce(
    (sum, a) => sum + (a.estimated_expenditure_aud_ex_gst ?? 0),
    0,
  );

  return (
    <article className="space-y-5">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-emerald-900">Application draft complete</p>
          <p className="text-xs text-emerald-800/80 mt-1">
            {totalCore} core + {totalSupporting} supporting activities · {totalH} hypotheses ·{' '}
            {totalF} documented failures · {totalNK} new-knowledge entries · A$
            {totalExpenditure.toLocaleString()} total expenditure ex-GST
          </p>
        </div>
      </div>

      {/* Submission summary */}
      <section className="rounded-md border border-border bg-background p-5">
        <h3 className="font-display text-lg font-semibold tracking-tight mb-3">
          Submission summary
        </h3>
        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {draft.submission_summary}
        </p>
      </section>

      {/* Core activities — collapsed preview, click to expand */}
      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold tracking-tight">Core activities</h3>
        {draft.core_activities.map((a) => (
          <details
            key={a.activity_id}
            className="rounded-md border border-border bg-background overflow-hidden group"
          >
            <summary className="cursor-pointer px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground shrink-0">
                  {a.activity_id}
                </span>
                <span className="font-display text-sm font-medium truncate">
                  {a.field_1_activity_name}
                </span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                A${(a.estimated_expenditure_aud_ex_gst ?? 0).toLocaleString()} ·{' '}
                {a.hypothesis_ids.join(', ')}
              </span>
            </summary>
            <div className="px-5 pb-5 space-y-4 text-sm leading-relaxed">
              <Field label="FIELD 2 — Describe the core R&D activity" value={a.field_2_describe} />
              <Field label="FIELD 6 — Hypothesis" value={a.field_6_hypothesis} />
            </div>
          </details>
        ))}
      </section>

      {/* Hypothesis register */}
      <section className="rounded-md border border-border bg-background p-5">
        <h3 className="font-display text-lg font-semibold tracking-tight mb-3">
          Hypothesis register
        </h3>
        <ul className="space-y-2">
          {draft.hypothesis_register.map((h) => (
            <li key={h.id} className="flex items-start gap-3">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground shrink-0 w-8">
                {h.id}
              </span>
              <span className="text-xs leading-relaxed flex-1">{h.hypothesis_text}</span>
              <span
                className={
                  'font-mono text-[10px] uppercase tracking-widest shrink-0 ' +
                  (h.validation_outcome === 'validated'
                    ? 'text-emerald-700'
                    : h.validation_outcome === 'failed'
                      ? 'text-rose-700'
                      : 'text-muted-foreground')
                }
              >
                {h.validation_outcome}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </p>
      <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">{value}</p>
    </div>
  );
}
