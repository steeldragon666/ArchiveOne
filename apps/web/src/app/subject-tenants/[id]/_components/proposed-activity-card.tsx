'use client';
/**
 * ProposedActivityCard
 *
 * Surfaces one AI-proposed R&D activity extracted from an uploaded document.
 * Shows the proposed name, kind, hypothesis, technical uncertainty, confidence,
 * and a verbatim source excerpt.
 *
 * The "Create activity" button opens a pre-filled confirmation dialog.
 * On confirm, calls POST /v1/proposed-activities/:event_id/accept and
 * transitions to a "Created · CA-NN" success state with a link to the
 * new activity.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Link2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { acceptProposedActivity } from '../_lib/extraction-api';
import type { ProposedActivityExtract } from '../_lib/extraction-api';

interface Props {
  eventId: string;
  activityIndex: number;
  proposal: ProposedActivityExtract;
  subjectTenantId: string;
  /**
   * Filename of the upload-event this proposal was extracted from. Surfaced
   * in the card, dialog, and success state so the consultant can see that
   * confirming the activity also links it to the source document on the chain
   * (ARTEFACT_LINKED event emitted server-side).
   */
  sourceFilename: string;
}

export function ProposedActivityCard({
  eventId,
  activityIndex,
  proposal,
  subjectTenantId,
  sourceFilename,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [excerptExpanded, setExcerptExpanded] = useState(false);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => acceptProposedActivity(eventId, activityIndex),
    onSuccess: (result) => {
      setCreatedCode(result.code);
      setDialogOpen(false);
      void qc.invalidateQueries({ queryKey: ['events', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
      toast({ title: `Activity ${result.code} created` });
    },
    onError: (err) => {
      toast({
        title: 'Failed to create activity',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const confidencePct = Math.round(proposal.confidence * 100);
  const confidenceColour =
    proposal.confidence >= 0.8
      ? 'text-[hsl(var(--brand-accent-strong))]'
      : proposal.confidence >= 0.6
        ? 'text-[hsl(var(--brand-warning))]'
        : 'text-muted-foreground';

  const kindLabel = proposal.proposed_kind === 'core' ? 'Core R&D §355-25' : 'Supporting §355-30';
  const kindChip =
    proposal.proposed_kind === 'core'
      ? 'border-[hsl(var(--brand-accent))]/40 bg-[hsl(var(--brand-accent))]/10 text-[hsl(var(--brand-accent-strong))]'
      : 'border-border bg-muted text-muted-foreground';

  if (createdCode) {
    return (
      <div className="rounded border border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-subtle))]/20 px-4 py-3 flex items-start gap-3">
        <CheckCircle2 className="h-4 w-4 text-[hsl(var(--brand-accent-strong))] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Confirmed · {createdCode}</p>
          <p className="font-mono text-[10px] text-muted-foreground truncate">
            {proposal.proposed_name}
          </p>
          <p className="font-mono text-[10px] text-[hsl(var(--brand-accent-strong))] mt-1 flex items-center gap-1">
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate" title={sourceFilename}>
              Linked to {sourceFilename}
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          {/* Header: name + kind chip + confidence */}
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight">{proposal.proposed_name}</p>
              <p
                className="font-mono text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1"
                title={`Will be linked to ${sourceFilename}`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">From {sourceFilename}</span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${kindChip}`}
              >
                {kindLabel}
              </span>
              <span className={`font-mono text-[10px] ${confidenceColour}`}>
                {confidencePct}% confidence
              </span>
            </div>
          </div>

          {/* Hypothesis */}
          <div className="space-y-1">
            <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Hypothesis
            </p>
            <p className="text-xs leading-relaxed text-foreground/90">{proposal.hypothesis_text}</p>
          </div>

          {/* Technical uncertainty */}
          <div className="space-y-1">
            <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              Technical uncertainty
            </p>
            <p className="text-xs leading-relaxed text-foreground/90">
              {proposal.technical_uncertainty}
            </p>
          </div>

          {/* Rationale */}
          <p className="text-[11px] text-muted-foreground italic leading-snug">
            <Sparkles className="h-3 w-3 inline-block mr-1 text-[hsl(var(--brand-accent))]" />
            {proposal.rationale}
          </p>

          {/* Source excerpt (collapsible) */}
          <div className="rounded border border-border/40 bg-muted/30 px-3 py-2">
            <button
              type="button"
              onClick={() => setExcerptExpanded((v) => !v)}
              className="w-full flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Source excerpt
              {excerptExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {excerptExpanded && (
              <p className="mt-2 text-[11px] font-mono leading-relaxed text-foreground/70 whitespace-pre-wrap">
                &ldquo;{proposal.source_excerpt}&rdquo;
              </p>
            )}
          </div>

          {/* Action */}
          <div className="pt-1">
            <Button size="sm" onClick={() => setDialogOpen(true)} className="h-8 text-xs gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm activity
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm activity from document</DialogTitle>
            <DialogDescription>
              This will create a new {proposal.proposed_kind} R&D activity from the AI-extracted
              proposal and link it on the forensic chain to the source document below. Review the
              details, then confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            {/* Source document — visible so the consultant knows what will be linked */}
            <div className="rounded border border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-subtle))]/20 px-3 py-2 flex items-start gap-2">
              <Link2 className="h-3.5 w-3.5 text-[hsl(var(--brand-accent-strong))] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Source document
                </p>
                <p className="font-mono text-xs truncate" title={sourceFilename}>
                  {sourceFilename}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  The new activity will reference this document via an
                  <span className="font-mono"> ARTEFACT_LINKED </span>
                  chain event — the link survives audit.
                </p>
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Activity name
              </p>
              <p className="font-medium">{proposal.proposed_name}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Kind
              </p>
              <p>{kindLabel}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Hypothesis
              </p>
              <p className="text-muted-foreground leading-relaxed">{proposal.hypothesis_text}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Technical uncertainty
              </p>
              <p className="text-muted-foreground leading-relaxed">
                {proposal.technical_uncertainty}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Expected outcome
              </p>
              <p className="text-muted-foreground leading-relaxed">{proposal.expected_outcome}</p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Confirming…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Confirm & link to document
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
