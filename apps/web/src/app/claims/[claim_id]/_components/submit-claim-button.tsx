'use client';

/**
 * Submit Claim button with pre-flight checks, confirmation modal,
 * and progress tracking.
 *
 * Pre-flight: GET /v1/claims/:id/preflight
 *   - Disabled + tooltip if any issue
 *   - Enabled if ok: true
 *
 * On click:
 *   1. Open confirmation modal.
 *   2. On "Continue": POST /v1/claims/:id/finalise → { job_id }
 *   3. Open progress modal: polls GET /v1/claims/:id/finalisation-status every 3s.
 *   4. On completion: redirect to ?tab=final-draft.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2, AlertCircle, CheckCircle2, Send } from 'lucide-react';
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
import { getPreflightCheck, finaliseClaim, getFinalisationStatus } from '../_lib/workflow-api';

// ---------------------------------------------------------------------------
// Pre-flight tooltip
// ---------------------------------------------------------------------------

function PreflightIssues({ issues }: { issues: string[] }) {
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-1.5 text-xs">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
          {issue}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Progress modal
// ---------------------------------------------------------------------------

function ProgressModal({
  open,
  claimId,
  onComplete,
  onClose,
}: {
  open: boolean;
  claimId: string;
  onComplete: () => void;
  onClose: () => void;
}) {
  const statusQuery = useQuery({
    queryKey: ['finalisation-status', claimId] as const,
    queryFn: () => getFinalisationStatus(claimId),
    enabled: open,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'completed' || s === 'failed') return false;
      return 3000;
    },
  });

  const status = statusQuery.data?.status;
  const progress = statusQuery.data?.progress;

  const isComplete = status === 'completed';
  const isFailed = status === 'failed';

  const activitiesDrafted = progress?.activities_drafted ?? 0;
  const totalActivities = progress?.total_activities ?? 0;
  const pct = totalActivities > 0 ? Math.round((activitiesDrafted / totalActivities) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && (isComplete || isFailed)) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => {
          if (!isComplete && !isFailed) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isComplete
              ? 'Finalisation complete'
              : isFailed
                ? 'Finalisation failed'
                : 'Finalising claim…'}
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? 'The AI has drafted the narrative and generated the PDF package.'
              : isFailed
                ? 'Something went wrong during finalisation. You can retry from the Final Draft tab.'
                : 'The AI is drafting narratives and generating the claim package. This may take a minute.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isComplete && !isFailed && (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {totalActivities > 0
                    ? `Drafting narrative… (${activitiesDrafted} of ${totalActivities} activities done)`
                    : 'Queued — starting shortly…'}
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )}

          {isComplete && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              All {totalActivities} {totalActivities === 1 ? 'activity' : 'activities'} drafted.
            </div>
          )}

          {isFailed && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {statusQuery.data?.error ?? 'An error occurred.'}
            </div>
          )}
        </div>

        {(isComplete || isFailed) && (
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                onClose();
                if (isComplete) onComplete();
              }}
            >
              {isComplete ? 'View Final Draft' : 'Close'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SubmitClaimButton({ claimId }: { claimId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);

  const preflightQuery = useQuery({
    queryKey: ['preflight', claimId] as const,
    queryFn: () => getPreflightCheck(claimId),
    staleTime: 30_000,
    retry: false,
  });

  const finaliseMutation = useMutation({
    mutationFn: () => finaliseClaim(claimId),
    onSuccess: () => {
      setConfirmOpen(false);
      setProgressOpen(true);
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast({
        title: 'Finalisation failed to start',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const handleConfirm = useCallback(() => {
    finaliseMutation.mutate();
  }, [finaliseMutation]);

  const handleComplete = useCallback(() => {
    router.push(`${pathname}?tab=final-draft`);
  }, [router, pathname]);

  const preflight = preflightQuery.data;
  const hasBlockers = !preflight?.ok;
  const issues = preflight?.issues ?? [];
  const [issuesOpen, setIssuesOpen] = useState(false);

  return (
    <>
      {/* Always visible — when blocked, opens issues modal instead of being inert. */}
      <Button
        type="button"
        size="sm"
        className="gap-2"
        variant={hasBlockers ? 'outline' : 'default'}
        onClick={() => {
          if (hasBlockers) {
            setIssuesOpen(true);
          } else {
            setConfirmOpen(true);
          }
        }}
        disabled={preflightQuery.isPending}
      >
        {preflightQuery.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : hasBlockers ? (
          <AlertCircle className="h-4 w-4 text-[hsl(var(--brand-warning))]" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {hasBlockers && issues.length > 0
          ? `Submit Claim · ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`
          : 'Submit Claim'}
      </Button>

      {/* Issues modal — shown when consultant clicks the disabled-style button */}
      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Not ready to submit yet</DialogTitle>
            <DialogDescription>
              The claim needs the following before it can be finalised:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded border-l-4 border-[hsl(var(--brand-warning))] bg-[hsl(var(--brand-warning))]/5 p-4">
            <PreflightIssues issues={issues} />
          </div>
          {preflight && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded border p-2">
                <div className="text-lg font-semibold">{preflight.activity_count}</div>
                <div className="text-muted-foreground">Activities</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-lg font-semibold">
                  {preflight.activity_count - preflight.activities_without_hypothesis}
                </div>
                <div className="text-muted-foreground">With hypothesis</div>
              </div>
              <div className="rounded border p-2">
                <div
                  className={`text-lg font-semibold ${preflight.has_expenditure ? 'text-[hsl(var(--brand-accent))]' : 'text-[hsl(var(--brand-warning))]'}`}
                >
                  {preflight.has_expenditure ? 'Yes' : 'No'}
                </div>
                <div className="text-muted-foreground">Expenditure</div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => setIssuesOpen(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation modal */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(v) => {
          if (!finaliseMutation.isPending) setConfirmOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Claim for R&DTI?</DialogTitle>
            <DialogDescription>
              You are about to finalise this claim and trigger AI narrative drafting. The system
              will generate a complete R&DTI application package including narrative sections and
              PDF documents for all registered activities.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">What happens next:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>Claim stage advances to "Narrative Drafting"</li>
              <li>AI drafts narrative for each activity using linked evidence</li>
              <li>PDF package is generated (Claim Summary, Apportionment, etc.)</li>
              <li>Final Draft tab becomes available for review</li>
            </ol>
          </div>

          {preflight && (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded border p-2">
                <div className="text-lg font-semibold">{preflight.activity_count}</div>
                <div className="text-muted-foreground">Activities</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-lg font-semibold">
                  {preflight.activity_count - preflight.activities_without_hypothesis}
                </div>
                <div className="text-muted-foreground">With hypothesis</div>
              </div>
              <div className="rounded border p-2">
                <div
                  className={`text-lg font-semibold ${preflight.has_expenditure ? 'text-green-600' : 'text-yellow-600'}`}
                >
                  {preflight.has_expenditure ? 'Yes' : 'No'}
                </div>
                <div className="text-muted-foreground">Expenditure</div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={finaliseMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={finaliseMutation.isPending}>
              {finaliseMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Progress modal */}
      <ProgressModal
        open={progressOpen}
        claimId={claimId}
        onComplete={handleComplete}
        onClose={() => setProgressOpen(false)}
      />
    </>
  );
}
