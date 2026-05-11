'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Claim } from '@cpa/schemas';
import { CLAIM_STAGES_LITERAL } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api';
import { advanceClaimStage, updateClaim } from '../_lib/mutations';

/**
 * Human-readable labels for each pipeline stage (matches STAGE_LABELS
 * in @/lib/claim-stage but defined locally to avoid a cross-feature import).
 */
const STAGE_LABELS: Record<string, string> = {
  engagement: 'Engagement',
  activity_capture: 'Activity capture',
  narrative_drafting: 'Narrative drafting',
  expenditure_schedule: 'Expenditure schedule',
  review: 'Review',
  submitted: 'Submitted',
  audit_defence: 'Audit defence',
};

/**
 * Stages the consultant can advance TO from a given current stage.
 * Stages can only move forward in the pipeline — not backward.
 */
function forwardStages(currentStage: string): string[] {
  const idx = CLAIM_STAGES_LITERAL.indexOf(currentStage as (typeof CLAIM_STAGES_LITERAL)[number]);
  if (idx < 0) return [];
  // Return stages strictly after the current one.
  return CLAIM_STAGES_LITERAL.slice(idx + 1);
}

const Schema = z.object({
  ausindustry_reference: z.string().max(200).optional(),
  advance_to_stage: z.string().optional(),
});
type FormValues = z.infer<typeof Schema>;

interface Props {
  claim: Claim;
}

/**
 * Edit-claim dialog (Phase 4B).
 *
 * Two distinct PATCH operations are exposed:
 *   1. PATCH /v1/claims/:id — set ausindustry_reference (only valid once
 *      stage === 'submitted', but we allow entering it early and let the
 *      server enforce the stage gate with a clear toast).
 *   2. PATCH /v1/claims/:id/stage — advance the pipeline stage forward.
 *
 * Both run in sequence on submit (stage advance first if requested, then
 * the ausindustry_reference patch). Either can be omitted — the form
 * gracefully no-ops empty fields.
 */
export function EditClaimButton({ claim }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      ausindustry_reference: claim.ausindustry_reference ?? '',
      advance_to_stage: '',
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({
        ausindustry_reference: claim.ausindustry_reference ?? '',
        advance_to_stage: '',
      });
    }
    setOpen(next);
  };

  const stageOptions = forwardStages(claim.stage);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Step 1: advance stage if requested.
      let current = claim;
      if (values.advance_to_stage) {
        current = await advanceClaimStage(claim.id, values.advance_to_stage);
      }
      // Step 2: update ausindustry_reference if it differs from current.
      const newRef = values.ausindustry_reference?.trim() ?? '';
      const existingRef = claim.ausindustry_reference ?? '';
      if (newRef !== existingRef && newRef.length > 0) {
        current = await updateClaim(claim.id, { ausindustry_reference: newRef });
      }
      return current;
    },
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['claim', claim.id] });
      toast({ title: `Claim FY${updated.fiscal_year} updated` });
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to edit claims.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Claim not found',
          description: 'This claim may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else if (err instanceof ConflictError) {
        toast({
          title: 'Stage constraint',
          description: err.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to update claim',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit claim</DialogTitle>
          <DialogDescription>
            Update the AusIndustry reference or advance the pipeline stage for FY{claim.fiscal_year}
            .
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
            <FormField
              control={form.control}
              name="ausindustry_reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    AusIndustry reference{' '}
                    <span className="text-muted-foreground">(optional — set post-submission)</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. 2024-RDTI-001234" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {stageOptions.length > 0 && (
              <FormField
                control={form.control}
                name="advance_to_stage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Advance to stage <span className="text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Leave at current stage" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {stageOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STAGE_LABELS[s] ?? s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <p className="text-xs text-muted-foreground">
              Current stage:{' '}
              <span className="font-medium">{STAGE_LABELS[claim.stage] ?? claim.stage}</span>
            </p>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
