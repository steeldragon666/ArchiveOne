'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Activity, UpdateActivityBody } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { updateActivity } from '../../_lib/api';
import { activityToFormValues, computeChangedFields } from '../../_lib/diff';

/**
 * Activity narrative editor (T-A5).
 *
 * Wraps the seven editable narrative fields per
 * `UpdateActivityBody` in `@cpa/schemas/src/activity.ts`:
 *   - title (required, 1..500 chars — matches Activity.title)
 *   - description / hypothesis / technical_uncertainty /
 *     experimentation_log / expected_outcome / actual_outcome
 *     (all optional free text; null in DB → empty string in the form)
 *
 * The form schema below is *form-specific* — it converts the nullable
 * DB columns into always-string form inputs (avoiding
 * "controlled-input null" warnings) and converts back on submit:
 *   - title: required string (1..500)
 *   - other fields: arbitrary string (rendered as Textarea)
 *
 * On submit we compute the diff against the original record and only
 * send changed fields. Empty-string narrative values are mapped to
 * `null` in the PATCH body so the audit chain shows "from text → to
 * null" rather than "from text → to ''" (matches the DB nullable
 * representation).
 *
 * Save flow:
 *   - Disabled when nothing has changed (`formState.isDirty` is false).
 *   - PATCH `/v1/activities/:id` with the changed fields.
 *   - On success: toast "Saved" + invalidate the activity query so
 *     the page refetches the canonical row (and `defaultValues` resets
 *     via `form.reset(serverValues)` to clear `isDirty`).
 *   - On error: destructive toast.
 *
 * Read-only fields (code, kind, project_id, claim_id, timestamps) live
 * on the parent page — this component only owns the editable form.
 *
 * Form-side schema: every field is a string (empty string represents
 * "cleared"). The diff helper in `_lib/diff.ts` maps empty strings back
 * to `null` for the PATCH body so the audit chain matches the DB
 * nullable storage.
 */
const FormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title is too long (max 500 characters)'),
  description: z.string(),
  hypothesis: z.string(),
  technical_uncertainty: z.string(),
  experimentation_log: z.string(),
  expected_outcome: z.string(),
  actual_outcome: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

export interface ActivityEditorProps {
  activity: Activity;
}

export function ActivityEditor({ activity }: ActivityEditorProps) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: activityToFormValues(activity),
  });

  const mutation = useMutation({
    mutationFn: (patch: UpdateActivityBody) => updateActivity(activity.id, patch),
    onSuccess: (saved) => {
      toast({ title: 'Saved', description: 'Activity updated' });
      // Reset form with the canonical server state so isDirty flips
      // back to false and the Save button disables. Also invalidate
      // the cached activity query so any sibling readers (e.g. a
      // future activity list) see the new values.
      form.reset(activityToFormValues(saved));
      void qc.invalidateQueries({ queryKey: ['activity', activity.id] });
    },
    onError: (err) => {
      toast({
        title: 'Failed to save',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (values: FormValues) => {
    const patch = computeChangedFields(activity, values);
    if (Object.keys(patch).length === 0) {
      // Defensive — the Save button is disabled when isDirty is false,
      // but if a future change loosens that we don't want to spam the
      // chain with no-op PATCHes (the API also short-circuits these,
      // but let's not waste a round-trip).
      return;
    }
    mutation.mutate(patch);
  };

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Activity title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What is this activity?"
                  className="min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="hypothesis"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hypothesis</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What technical hypothesis is being tested?"
                  className="min-h-[120px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="technical_uncertainty"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Technical uncertainty</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What knowledge gap blocks a competent professional from solving this with current information?"
                  className="min-h-[120px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="experimentation_log"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Experimentation log</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Document the systematic progression of experiments, observations, and iterations."
                  className="min-h-[180px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="expected_outcome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expected outcome</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What did you expect to learn or achieve?"
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="actual_outcome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Actual outcome</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What did you actually observe? (Fill in once experimentation is complete.)"
                  className="min-h-[100px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
