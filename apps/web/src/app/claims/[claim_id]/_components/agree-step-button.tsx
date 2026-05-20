'use client';

/**
 * AgreeStepButton — wires `POST /v1/claims/:id/workflow/step/:n/agree`
 * into the wizard step shells so the wizard's central state mechanism
 * actually fires.
 *
 * Behaviour:
 *   1. On click, call agreeStep(claimId, step). The server runs
 *      canAdvance(step, snapshot) again under the row's tx and either
 *      returns the new workflow_state or 409 cannot_advance.
 *   2. On success, invalidate the ['workflow', claimId] query so the
 *      orchestrator's getWorkflow() refetches the new state (agreed_at
 *      timestamp populated, stepper tick rendered) BEFORE the URL
 *      advances. Then call the parent's onSuccess prop, which advances
 *      ?step=N+1.
 *   3. On error, surface via a destructive toast. The mutation isn't
 *      retried automatically — the consultant retries by clicking again.
 *
 * The button is disabled when canAdvance.ok === false (data isn't ready
 * yet) or while the mutation is in flight. When disabled with a reason,
 * the reason is rendered in the row before the button — same pattern
 * the wizard-step-*.tsx files used before this component existed.
 *
 * Step 5 deliberately doesn't render this component: canAdvance(5)
 * always returns { ok: false, reason: 'terminal' } and there's no
 * agreeStep(5) call — see the F2 test in claim-workflow.test.ts which
 * pins this behaviour. Completion semantics for step 5 will arrive with
 * the real document-generation endpoints.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { agreeStep, type CanAdvance } from '../_lib/workflow-client';

interface AgreeStepButtonProps {
  claimId: string;
  step: 1 | 2 | 3 | 4;
  canAdvance: CanAdvance;
  /** Called after the server confirms the agree AND the workflow query
   *  has been invalidated. Typically advances `?step=N+1` in the URL. */
  onSuccess: () => void;
  /** Button label, e.g. "Next: Review Activities →". */
  label: string;
}

export function AgreeStepButton({
  claimId,
  step,
  canAdvance,
  onSuccess,
  label,
}: AgreeStepButtonProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => agreeStep(claimId, step),
    onSuccess: async () => {
      // Refetch ['workflow', claimId] BEFORE advancing — so when the
      // next step mounts, useQuery returns the freshly-agreed state
      // (stepEntry !== null) and the stale-step banner logic has a
      // real agreed_at timestamp to reason about.
      await qc.invalidateQueries({ queryKey: ['workflow', claimId] });
      onSuccess();
    },
    onError: (err) => {
      toast({
        title: 'Could not advance step',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const disabled = !canAdvance.ok || mutation.isPending;

  return (
    <>
      {!canAdvance.ok && !mutation.isPending && (
        <p className="mr-auto text-sm text-muted-foreground">{canAdvance.reason}</p>
      )}
      <Button
        onClick={() => mutation.mutate()}
        disabled={disabled}
        data-testid={`wizard-step-${step}-agree`}
      >
        {mutation.isPending ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Agreeing...
          </span>
        ) : (
          label
        )}
      </Button>
    </>
  );
}
