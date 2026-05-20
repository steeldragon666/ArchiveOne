'use client';
/**
 * ReviewActivityDialog
 *
 * Opened from the 🤖 review chip on the Activities tab. Surfaces the original
 * AI proposal (name, hypothesis, technical uncertainty, expected outcome) for
 * an activity that was auto-created at low confidence, alongside the source
 * document the proposal came from. The consultant chooses:
 *
 *   - Keep + Mark reviewed → POST /v1/activities/:id/mark-reviewed
 *     (emits ACTIVITY_REVIEWED chain event; chip disappears)
 *   - Edit                  → navigates to the activity editor page
 *   - Delete                → not yet implemented; surfaces as a TODO link
 *
 * This is intentionally NOT a full inline editor — for that, the consultant
 * goes to the activity-detail page where the existing rich editor lives.
 */
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, Loader2, Pencil, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { markActivityReviewed } from '@/app/subject-tenants/[id]/_lib/narrative-api';
import type { ActivityWithReview } from '../_lib/api';

interface Props {
  activity: ActivityWithReview;
  claimId: string;
  open: boolean;
  onClose: () => void;
}

export function ReviewActivityDialog({ activity, claimId, open, onClose }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => markActivityReviewed(activity.id),
    onSuccess: () => {
      toast({
        title: `${activity.code} marked reviewed`,
      });
      void qc.invalidateQueries({ queryKey: ['activities', { claimId }] });
      onClose();
    },
    onError: (err) => {
      toast({
        title: 'Failed to mark reviewed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const confidencePct =
    activity.proposal_confidence != null ? Math.round(activity.proposal_confidence * 100) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[hsl(var(--brand-warning))]" />
            Review {activity.code}
          </DialogTitle>
          <DialogDescription>
            This activity was auto-created by the narrative-approval flow
            {confidencePct != null ? ` at ${confidencePct}% confidence` : ''}. Review the AI&apos;s
            read; mark it reviewed if it looks right, or open the editor to adjust the details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Activity name
            </p>
            <p className="font-medium">{activity.title}</p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Kind
            </p>
            <p>{activity.kind === 'core' ? 'Core R&D §355-25' : 'Supporting §355-30'}</p>
          </div>

          {activity.hypothesis && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Hypothesis (from AI)
              </p>
              <p className="text-muted-foreground leading-relaxed">{activity.hypothesis}</p>
            </div>
          )}

          {activity.technical_uncertainty && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Technical uncertainty (from AI)
              </p>
              <p className="text-muted-foreground leading-relaxed">
                {activity.technical_uncertainty}
              </p>
            </div>
          )}

          {activity.expected_outcome && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                Expected outcome (from AI)
              </p>
              <p className="text-muted-foreground leading-relaxed">{activity.expected_outcome}</p>
            </div>
          )}

          {activity.proposed_from_event_id && (
            <div className="rounded border border-[hsl(var(--brand-accent))]/30 bg-[hsl(var(--brand-accent-subtle))]/20 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Source document
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Linked on the forensic chain to the upload event that produced this proposal. Visit
                the claimant&apos;s Evidence section to see the source file.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              router.push(`/claims/${claimId}/activities/${activity.id}`);
            }}
            disabled={mutation.isPending}
            className="gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit in detail page
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="gap-1.5"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Marking reviewed…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Keep &amp; mark reviewed
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
