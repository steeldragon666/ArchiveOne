'use client';

/**
 * Review tab — the consultant's queue for approving / rejecting / editing
 * AI auto-allocation suggestions.
 *
 * Data flow:
 *   1. GET /v1/claims/:id/pending-review → list of events with suggestion status
 *   2. POST /v1/claims/:id/auto-allocate-batch → generate suggestions for events
 *      that don't have one yet (one-time "run AI" action)
 *   3. Per-row: Approve → confirm-allocation | Reject → reject-allocation
 *   4. Edit → opens BindToActivityButton (manual override → marks 'edited')
 *   5. "Approve all" batch button → batch-confirm-allocations
 *
 * Counter banner at top: "Reviewing N of M events · X confirmed · Y rejected"
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Edit3, Loader2, AlertCircle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  listPendingReview,
  confirmAllocation,
  rejectAllocation,
  batchConfirmAllocations,
  batchAutoAllocate,
  type PendingEvent,
} from '../_lib/workflow-api';

// ---------------------------------------------------------------------------
// Kind chip colours (matches evidence-tab pattern)
// ---------------------------------------------------------------------------

const KIND_COLORS: Record<string, string> = {
  HYPOTHESIS: 'bg-violet-100 text-violet-800',
  DESIGN: 'bg-blue-100 text-blue-800',
  EXPERIMENT: 'bg-cyan-100 text-cyan-800',
  OBSERVATION: 'bg-teal-100 text-teal-800',
  ITERATION: 'bg-green-100 text-green-800',
  NEW_KNOWLEDGE: 'bg-emerald-100 text-emerald-800',
  UNCERTAINTY: 'bg-yellow-100 text-yellow-800',
  TIME_LOG: 'bg-orange-100 text-orange-800',
  ASSOCIATE_FLAG: 'bg-rose-100 text-rose-800',
  EXPENDITURE_NOTE: 'bg-amber-100 text-amber-800',
  SUPPORTING: 'bg-slate-100 text-slate-700',
  INELIGIBLE: 'bg-red-100 text-red-700',
};

function KindChip({ kind }: { kind: string }) {
  const cls = KIND_COLORS[kind] ?? 'bg-gray-100 text-gray-700';
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
        cls,
      )}
    >
      {kind.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: string | null }) {
  if (status === 'confirmed') return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
  if (status === 'rejected') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === 'edited') return <Edit3 className="h-4 w-4 text-blue-500 shrink-0" />;
  return (
    <span className="h-4 w-4 rounded-full border-2 border-dashed border-muted-foreground/40 inline-block shrink-0" />
  );
}

// ---------------------------------------------------------------------------
// Reject-reason dialog
// ---------------------------------------------------------------------------

function RejectDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject allocation</DialogTitle>
          <DialogDescription>
            Optionally explain why this evidence was not allocated to the suggested activity.
          </DialogDescription>
        </DialogHeader>
        <textarea
          className="w-full rounded border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-none"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending} type="button">
            Cancel
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={isPending}
            onClick={() => onConfirm(reason)}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({
  event,
  claimId,
  onRefresh,
}: {
  event: PendingEvent;
  claimId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: () => confirmAllocation(claimId, event.id),
    onSuccess: () => {
      toast({ title: 'Allocation confirmed' });
      onRefresh();
    },
    onError: (err) =>
      toast({
        title: 'Confirm failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      }),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => rejectAllocation(claimId, event.id, reason || undefined),
    onSuccess: () => {
      toast({ title: 'Allocation rejected' });
      setRejectOpen(false);
      onRefresh();
    },
    onError: (err) =>
      toast({
        title: 'Reject failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      }),
  });

  const cls = event.classification;
  const rawText =
    typeof (event.payload as Record<string, unknown>)?.raw_text === 'string'
      ? ((event.payload as Record<string, unknown>).raw_text as string)
      : null;

  const confidencePct =
    event.suggestion_confidence != null ? Math.round(event.suggestion_confidence * 100) : null;

  const isMutating = confirmMutation.isPending || rejectMutation.isPending;
  const isDone =
    event.suggestion_status === 'confirmed' ||
    event.suggestion_status === 'rejected' ||
    event.suggestion_status === 'edited';

  return (
    <>
      <li
        className={cn(
          'group rounded-lg border p-3 transition-colors',
          isDone ? 'border-border bg-muted/30' : 'border-border bg-card hover:bg-muted/20',
        )}
      >
        <div className="flex flex-wrap items-start gap-3">
          {/* Status icon */}
          <div className="mt-0.5">
            <StatusIcon status={event.suggestion_status} />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-1">
            {/* Kind + filename/text */}
            <div className="flex flex-wrap items-center gap-2">
              <KindChip kind={event.effective_kind} />
              {cls && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(cls.confidence * 100)}% confident
                </span>
              )}
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {event.id.slice(0, 8)}
              </span>
            </div>

            {/* Raw text snippet */}
            {rawText && <p className="line-clamp-2 text-xs text-muted-foreground">{rawText}</p>}

            {/* Suggestion */}
            {event.suggested_activity_id ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">AI suggests:</span>
                <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                  <span className="font-mono">{event.suggested_activity_code}</span>
                  {event.suggested_activity_title && (
                    <span className="max-w-[180px] truncate">{event.suggested_activity_title}</span>
                  )}
                  {confidencePct != null && (
                    <span className="text-[10px] text-primary/70">{confidencePct}%</span>
                  )}
                </span>
              </div>
            ) : (
              event.suggestion_status === 'pending' && (
                <p className="text-xs text-muted-foreground italic">
                  AI could not suggest an activity — manually assign using Edit.
                </p>
              )
            )}
          </div>

          {/* Actions */}
          {!isDone && (
            <div className="flex items-center gap-1.5 shrink-0">
              {event.suggested_activity_id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs text-green-700 border-green-300 hover:bg-green-50"
                  disabled={isMutating}
                  onClick={() => confirmMutation.mutate()}
                  type="button"
                >
                  {confirmMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Approve
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs text-red-600 border-red-300 hover:bg-red-50"
                disabled={isMutating}
                onClick={() => setRejectOpen(true)}
                type="button"
              >
                <XCircle className="h-3 w-3" />
                Reject
              </Button>
            </div>
          )}

          {/* Done badge */}
          {isDone && (
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                event.suggestion_status === 'confirmed' && 'bg-green-100 text-green-700',
                event.suggestion_status === 'rejected' && 'bg-red-100 text-red-700',
                event.suggestion_status === 'edited' && 'bg-blue-100 text-blue-700',
              )}
            >
              {event.suggestion_status}
            </span>
          )}
        </div>
      </li>

      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reason) => rejectMutation.mutate(reason)}
        isPending={rejectMutation.isPending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main ReviewTab
// ---------------------------------------------------------------------------

export function ReviewTab({ claimId }: { claimId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const reviewQuery = useQuery({
    queryKey: ['pending-review', claimId] as const,
    queryFn: () => listPendingReview(claimId),
    staleTime: 15_000,
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['pending-review', claimId] });
  }, [qc, claimId]);

  // "Run AI allocation" for events that haven't been allocated yet.
  const batchAllocateMutation = useMutation({
    mutationFn: () => batchAutoAllocate(claimId),
    onSuccess: (data) => {
      toast({
        title: `AI allocation complete`,
        description: `${data.suggested} suggested, ${data.unallocated} unmatched of ${data.total} events.`,
      });
      refresh();
    },
    onError: (err) =>
      toast({
        title: 'Auto-allocation failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      }),
  });

  // "Approve all" batch action (only for events with a pending suggestion + an activity).
  const batchConfirmMutation = useMutation({
    mutationFn: (eventIds: string[]) => batchConfirmAllocations(claimId, eventIds),
    onSuccess: (data) => {
      toast({
        title: `Approved ${data.confirmed} allocation${data.confirmed === 1 ? '' : 's'}`,
        description: data.failed > 0 ? `${data.failed} failed.` : undefined,
      });
      refresh();
    },
    onError: (err) =>
      toast({
        title: 'Batch approve failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      }),
  });

  if (reviewQuery.isPending) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading review queue…
      </div>
    );
  }

  if (reviewQuery.error) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        Failed to load review queue:{' '}
        {reviewQuery.error instanceof Error ? reviewQuery.error.message : 'Unknown error'}
      </div>
    );
  }

  const data = reviewQuery.data;
  const pendingApproval = data.events.filter(
    (e) => e.suggestion_status === 'pending' && e.suggested_activity_id != null,
  );
  const unallocatedCount = data.events.filter((e) => e.suggestion_status === null).length;

  return (
    <div className="space-y-4">
      {/* Header: counters + batch actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{data.pending_count} pending</span>
          {' · '}
          {data.confirmed_count} confirmed
          {' · '}
          {data.rejected_count} rejected
          {data.edited_count > 0 && ` · ${data.edited_count} edited`}
          {' · '}
          <span className="font-medium text-foreground">{data.total_in_claim} total</span>
        </div>

        <div className="flex items-center gap-2">
          {unallocatedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              disabled={batchAllocateMutation.isPending}
              onClick={() => batchAllocateMutation.mutate()}
              type="button"
            >
              {batchAllocateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Run AI on {unallocatedCount} unallocated
            </Button>
          )}

          {pendingApproval.length > 0 && (
            <Button
              size="sm"
              className="gap-1.5 text-xs"
              disabled={batchConfirmMutation.isPending}
              onClick={() => batchConfirmMutation.mutate(pendingApproval.map((e) => e.id))}
              type="button"
            >
              {batchConfirmMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Approve all ({pendingApproval.length})
            </Button>
          )}
        </div>
      </div>

      {/* Event list */}
      {data.events.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No classified evidence found for this claim yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload evidence and run classification first.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data.events.map((event) => (
            <EventRow key={event.id} event={event} claimId={claimId} onRefresh={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}
