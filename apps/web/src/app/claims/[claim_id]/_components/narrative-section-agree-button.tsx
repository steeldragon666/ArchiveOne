'use client';

/**
 * NarrativeSectionAgreeButton — per-section Agree control inside wizard Step 4.
 *
 * Mirrors the `AgreeStepButton` pattern: useMutation + invalidate
 * ['workflow', claimId] on success. The workflow GET re-derives both
 * `derived.canAdvance['4']` AND `derived.narrativeSections[sectionKind]`
 * from the same snapshot, so a single invalidate refreshes both the
 * per-section UI state AND the bottom-of-step "Next: Generate Documents →"
 * gate at once.
 *
 * Status → UI mapping:
 *   'absent'    — disabled muted "{label} — not drafted yet"
 *   'streaming' — disabled muted "{label} — drafting…"
 *   'complete'  — enabled button "Agree to {label}"
 *   'accepted'  — green "✓ {label} approved" indicator (no button)
 *
 * Idempotency: the route guarantees re-accept is safe (returns
 * `accepted_count: 0`). When the section is already 'accepted' on the
 * client we don't render the button at all, but a race where another
 * consultant accepted between this client's load and click will still
 * surface as success — we toast "Already accepted" rather than failing.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  acceptNarrativeSection,
  type NarrativeSectionKind,
  type NarrativeSectionStatus,
} from '../_lib/workflow-client';

interface NarrativeSectionAgreeButtonProps {
  claimId: string;
  sectionKind: NarrativeSectionKind;
  status: NarrativeSectionStatus;
  /** Display name shown to the consultant. Falls back to the section_kind
   *  rendered as Title Case if omitted. */
  label?: string;
}

function humanizeSectionKind(kind: NarrativeSectionKind): string {
  return kind
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function NarrativeSectionAgreeButton({
  claimId,
  sectionKind,
  status,
  label,
}: NarrativeSectionAgreeButtonProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const displayLabel = label ?? humanizeSectionKind(sectionKind);

  const mutation = useMutation({
    mutationFn: () => acceptNarrativeSection(claimId, sectionKind),
    onSuccess: async (data) => {
      // Single invalidate covers both per-section status AND canAdvance(4)
      // — both are read from the same snapshot in the workflow GET.
      await qc.invalidateQueries({ queryKey: ['workflow', claimId] });
      if (data.accepted_count === 0) {
        toast({
          title: 'Already accepted',
          description: `${displayLabel} was already accepted by another consultant.`,
        });
      } else {
        toast({
          title: 'Section approved',
          description: `${displayLabel} marked as accepted.`,
        });
      }
    },
    onError: (err) => {
      toast({
        title: 'Could not accept section',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  if (status === 'accepted') {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400"
        data-testid={`narrative-section-${sectionKind}-accepted`}
      >
        <CheckCircle2 className="h-4 w-4" />
        <span>{displayLabel} approved</span>
      </div>
    );
  }

  if (status === 'absent') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        data-testid={`narrative-section-${sectionKind}-absent`}
      >
        <span className="text-muted-foreground">{displayLabel} — not drafted yet</span>
      </Button>
    );
  }

  if (status === 'streaming') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        data-testid={`narrative-section-${sectionKind}-streaming`}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span className="text-muted-foreground">{displayLabel} — drafting…</span>
      </Button>
    );
  }

  // status === 'complete' — enabled Agree
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid={`narrative-section-${sectionKind}-agree`}
    >
      {mutation.isPending ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Approving…
        </span>
      ) : (
        `Agree to ${displayLabel}`
      )}
    </Button>
  );
}
