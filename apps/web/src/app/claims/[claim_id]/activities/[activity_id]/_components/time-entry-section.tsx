'use client';
import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { TimeEntry } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from '@/hooks/use-toast';
import { clearTimeEntryFlag, listTimeEntries, setApportionment } from '../../_lib/time-entry-api';

/**
 * TimeEntrySection — consultant view of time entries for a claimant.
 *
 * Placement: render as a section on the activity detail page below the
 * narrative editor. Pass `subjectTenantId` from the parent claim row.
 *
 * Capabilities:
 *   - Lists all time entries for the claimant (scoped by subject_tenant_id).
 *   - Shows employee ID, started_at date, duration in hours, R&D flag,
 *     and current apportionment %.
 *   - "Set R&D %" button opens a dialog to PATCH the apportionment_pct.
 *   - "Clear flag" button appears when the entry is flagged (payroll conflict).
 *   - Toggle to include flagged entries (hidden by default per API default).
 *
 * API surface used (consultant session, no mobile JWT required):
 *   GET    /v1/time-entries?subject_tenant_id=...   — list
 *   PATCH  /v1/time-entries/:id/apportionment       — set R&D %
 *   POST   /v1/time-entries/:id/clear-flag          — clear flag
 *
 * Note: POST /v1/time-entries (create) requires a mobile JWT and is not
 * available to consultants. Time entries are created by employees on the
 * mobile app; consultants review and annotate them here.
 */

export interface TimeEntrySectionProps {
  /** UUID of the subject_tenant (claimant) — required to scope the list. */
  subjectTenantId: string;
}

export function TimeEntrySection({ subjectTenantId }: TimeEntrySectionProps) {
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['time-entries', { subjectTenantId, includeFlagged }] as const,
    queryFn: () =>
      listTimeEntries({ subject_tenant_id: subjectTenantId, include_flagged: includeFlagged }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-medium">Time entries</h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={includeFlagged}
            onChange={(e) => setIncludeFlagged(e.target.checked)}
            className="rounded border-border"
          />
          Show flagged
        </label>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading time entries…</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          Failed to load time entries: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      ) : data.length === 0 ? (
        <div className="rounded border-2 border-dashed border-border bg-transparent p-6 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            No time entries yet
          </p>
          <p className="text-sm text-muted-foreground">
            Time entries are captured by employees on the mobile app. Once entries are logged for
            this claimant, they will appear here for apportionment review.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Date</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 pr-4 font-medium">R&amp;D</th>
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Apportionment %</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.map((entry) => (
                <TimeEntryRow
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditingEntry(entry)}
                  subjectTenantId={subjectTenantId}
                  includeFlagged={includeFlagged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingEntry !== null && (
        <ApportionmentDialog
          entry={editingEntry}
          subjectTenantId={subjectTenantId}
          includeFlagged={includeFlagged}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface TimeEntryRowProps {
  entry: TimeEntry;
  onEdit: () => void;
  subjectTenantId: string;
  includeFlagged: boolean;
}

function TimeEntryRow({ entry, onEdit, subjectTenantId, includeFlagged }: TimeEntryRowProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const clearFlagMutation = useMutation({
    mutationFn: () => clearTimeEntryFlag(entry.id),
    onSuccess: () => {
      toast({ title: 'Flag cleared', description: 'Time entry conflict flag removed.' });
      void qc.invalidateQueries({
        queryKey: ['time-entries', { subjectTenantId, includeFlagged }],
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to clear flag',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const startDate = new Date(entry.started_at);
  const durationHours = (entry.duration_minutes / 60).toFixed(2);
  const dateLabel = startDate.toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <tr className={entry.flagged_at !== null ? 'bg-yellow-50' : undefined}>
      <td className="py-2 pr-4">
        <span className="font-mono text-xs">{dateLabel}</span>
        {entry.flagged_at !== null && (
          <span
            className="ml-2 rounded border border-yellow-400 bg-yellow-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-yellow-700"
            title={`Flagged at ${new Date(entry.flagged_at).toLocaleString()}`}
          >
            Flagged
          </span>
        )}
      </td>
      <td className="py-2 pr-4 font-mono text-xs">{durationHours}h</td>
      <td className="py-2 pr-4">
        <span
          className={
            entry.is_rd
              ? 'font-mono text-[10px] uppercase tracking-widest text-green-700'
              : 'font-mono text-[10px] uppercase tracking-widest text-muted-foreground'
          }
        >
          {entry.is_rd ? 'Yes' : 'No'}
        </span>
      </td>
      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{entry.source}</td>
      <td className="py-2 pr-4">
        {entry.apportionment_pct !== null ? (
          <span className="font-mono text-xs">{entry.apportionment_pct}%</span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">Not set</span>
        )}
      </td>
      <td className="py-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="h-7 text-xs">
            Set R&amp;D %
          </Button>
          {entry.flagged_at !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearFlagMutation.mutate()}
              disabled={clearFlagMutation.isPending}
              className="h-7 text-xs text-yellow-700 hover:text-yellow-900"
            >
              {clearFlagMutation.isPending ? 'Clearing…' : 'Clear flag'}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Apportionment dialog
// ---------------------------------------------------------------------------

const ApportionmentSchema = z.object({
  apportionment_pct: z
    .number({ invalid_type_error: 'Enter a number between 0 and 100' })
    .min(0, 'Must be at least 0')
    .max(100, 'Must be at most 100'),
});
type ApportionmentFormValues = z.infer<typeof ApportionmentSchema>;

interface ApportionmentDialogProps {
  entry: TimeEntry;
  subjectTenantId: string;
  includeFlagged: boolean;
  onClose: () => void;
}

/**
 * Dialog for setting (or updating) the R&D apportionment % on a time entry.
 *
 * PATCH /v1/time-entries/:id/apportionment — admin/consultant only.
 * Body: { apportionment_pct: number (0–100) }
 */
function ApportionmentDialog({
  entry,
  subjectTenantId,
  includeFlagged,
  onClose,
}: ApportionmentDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<ApportionmentFormValues>({
    resolver: zodResolver(ApportionmentSchema),
    defaultValues: {
      apportionment_pct: entry.apportionment_pct ?? 100,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: ApportionmentFormValues) =>
      setApportionment(entry.id, values.apportionment_pct),
    onSuccess: (updated) => {
      toast({
        title: 'Apportionment updated',
        description: `Set to ${updated.apportionment_pct ?? '—'}% R&D for this entry.`,
      });
      void qc.invalidateQueries({
        queryKey: ['time-entries', { subjectTenantId, includeFlagged }],
      });
      onClose();
    },
    onError: (err) => {
      toast({
        title: 'Failed to update apportionment',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: ApportionmentFormValues) => {
    mutation.mutate(values);
  };

  const startDate = new Date(entry.started_at).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const durationHours = (entry.duration_minutes / 60).toFixed(2);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set R&amp;D apportionment</DialogTitle>
          <DialogDescription>
            {startDate} — {durationHours}h ({entry.source})
            {entry.notes ? `. Notes: ${entry.notes}` : ''}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
            <FormField
              control={form.control}
              name="apportionment_pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>R&amp;D percentage (0–100)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      placeholder="100"
                      {...field}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    The fraction of this time entry attributable to eligible R&amp;D activities.
                    100% = fully R&amp;D. 0% = not R&amp;D (will be excluded from the schedule).
                  </p>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
