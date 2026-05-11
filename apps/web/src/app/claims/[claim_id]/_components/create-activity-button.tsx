'use client';
/**
 * Create-activity CTA + modal for the claim detail activities tab.
 *
 * Dependency-bound: every activity must be attached to a project_id.
 * When the dialog opens we pre-fetch the firm's projects so the consultant
 * can pick one from a dropdown. If there are no projects, the dialog tells
 * the consultant to create one first and links to /projects.
 *
 * On success: invalidates the ['activities', { claimId }] query so the new
 * row shows up immediately in the activities list, closes the dialog, and
 * routes to the new activity detail page.
 *
 * Mirrors CreateClaimantButton's structure (Dialog + RHF + Zod +
 * TanStack mutation + toast) so the codebase has one consistent shape
 * for create-* dialogs.
 *
 * Error mapping: 403 → "permission denied" toast; 404 → "claim or project
 * not found" toast; everything else → generic destructive toast.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useWhoami } from '@/hooks/use-whoami';
import { ForbiddenError, NotFoundError } from '@/lib/api';
import { listProjects } from '../../../projects/_lib/api';
import { createActivity } from '../activities/_lib/api';

/**
 * Form schema — mirrors CreateActivityBody in packages/schemas/src/activity.ts:
 *   - claim_id: injected via prop (not a form field)
 *   - project_id: required UUID — selected from the firm's project list
 *   - kind: 'core' | 'supporting' (Core Activity vs Supporting Activity)
 *   - title: required, 1-500 chars
 *   - description: optional free-form
 *   - hypothesis: optional — pre-populate from hypothesis-prompt mobile form
 *   - technical_uncertainty: optional
 *   - expected_outcome: optional
 */
const Schema = z.object({
  project_id: z.string().uuid('Select a project'),
  kind: z.enum(['core', 'supporting']),
  title: z
    .string()
    .min(1, 'Activity title is required')
    .max(500, 'Title must be 500 characters or fewer'),
  description: z.string().optional(),
  hypothesis: z.string().optional(),
  technical_uncertainty: z.string().optional(),
  expected_outcome: z.string().optional(),
});
type FormValues = z.infer<typeof Schema>;

interface Props {
  claimId: string;
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
  /** Override the trigger label. Defaults to "Add activity". */
  triggerLabel?: string;
}

export function CreateActivityButton({
  claimId,
  triggerClassName,
  triggerLabel = 'Add activity',
}: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const whoami = useWhoami();
  const firmScope = whoami.data?.user.tenantId ?? 'unknown';

  // Fetch the firm's projects to populate the project dropdown.
  // Only fires when the dialog is open — no point burning a query on
  // mount for a button the user may never click.
  const projects = useQuery({
    queryKey: ['projects', firmScope],
    queryFn: () => listProjects({}),
    enabled: open,
  });

  const projectList = projects.data ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      project_id: '',
      kind: 'core',
      title: '',
      description: '',
      hypothesis: '',
      technical_uncertainty: '',
      expected_outcome: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createActivity({
        project_id: values.project_id,
        claim_id: claimId,
        kind: values.kind,
        title: values.title,
        description: values.description?.trim() ? values.description.trim() : undefined,
        hypothesis: values.hypothesis?.trim() ? values.hypothesis.trim() : undefined,
        technical_uncertainty: values.technical_uncertainty?.trim()
          ? values.technical_uncertainty.trim()
          : undefined,
        expected_outcome: values.expected_outcome?.trim()
          ? values.expected_outcome.trim()
          : undefined,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['activities', { claimId }] });
      toast({ title: `Activity "${created.title}" created` });
      setOpen(false);
      form.reset();
      router.push(`/claims/${claimId}/activities/${created.id}`);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to create activities.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Claim or project not found',
          description:
            'The claim or selected project may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to create activity',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const noProjects = projects.isSuccess && projectList.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={triggerClassName}>{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add activity</DialogTitle>
          <DialogDescription>
            Add a Core Activity (CA) or Supporting Activity (SA) to this claim. The activity code
            (CA-001, SA-002, etc.) is assigned automatically.
          </DialogDescription>
        </DialogHeader>

        {noProjects ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              You need at least one project before creating an activity. Create a project first,
              then come back here.
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button asChild>
                <Link href="/projects">Go to Projects</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={projects.isPending}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              projects.isPending ? 'Loading projects…' : 'Select a project'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projectList.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kind</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select kind" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="core">Core Activity (CA)</SelectItem>
                        <SelectItem value="supporting">Supporting Activity (SA)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Adaptive scaffolding algorithm"
                        autoFocus
                        {...field}
                      />
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
                    <FormLabel>
                      Description <span className="text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="Brief description of the activity scope."
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
                    <FormLabel>
                      Hypothesis <span className="text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="What technical outcome are you testing for?"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                  {mutation.isPending ? 'Creating…' : 'Add activity'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
