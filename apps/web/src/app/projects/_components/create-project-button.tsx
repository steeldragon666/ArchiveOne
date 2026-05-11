'use client';
/**
 * Create-project CTA + modal.
 *
 * Dependency-bound: a project must be attached to a `subject_tenant_id`
 * (one of the consultant's claimant firms). Before opening the form, we
 * fetch the firm's claimants. If there are none, the dialog tells the
 * consultant to create a claimant first and links to /subject-tenants
 * (which has its own CreateClaimantButton).
 *
 * On success: invalidates the ['projects', firmScope] query so the new
 * row appears in the list, closes the dialog, and routes to the new
 * project detail page (where activities and evidence get attached next).
 *
 * Mirrors CreateClaimantButton's structure (Dialog + RHF + Zod +
 * TanStack mutation + toast) so the codebase has one consistent shape
 * for create-* dialogs.
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
import { listSubjectTenants } from '../../subject-tenants/_lib/api';
import { createProject } from '../_lib/api';

/**
 * Form schema — strict client-side validation that mirrors
 * `CreateProjectBody` on the server (packages/schemas/src/project.ts):
 *   - subject_tenant_id: required UUID
 *   - name: 1-200 chars
 *   - description: optional, free-form
 *   - started_at: required calendar date (YYYY-MM-DD from <input type="date">)
 *   - ended_at: optional, must be >= started_at
 *
 * Date inputs come back as 'YYYY-MM-DD' strings; we promote to ISO at
 * submit time so the wire payload matches the server's `Iso8601` zod check.
 */
const Schema = z
  .object({
    subject_tenant_id: z.string().uuid('Pick a client firm'),
    name: z.string().min(1, 'Name is required').max(200, 'Name must be ≤200 chars'),
    description: z.string().optional(),
    started_at: z.string().min(1, 'Start date is required'),
    ended_at: z.string().optional(),
  })
  .refine((v) => !v.ended_at || new Date(v.started_at) <= new Date(v.ended_at), {
    message: 'End date must be on or after start date',
    path: ['ended_at'],
  });
type FormValues = z.infer<typeof Schema>;

const dateToIso = (yyyymmdd: string): string => `${yyyymmdd}T00:00:00.000Z`;

interface Props {
  /**
   * Optional className applied to the trigger button so callers can
   * adjust placement (e.g. an inline button in an empty-state card vs
   * the page-header CTA).
   */
  triggerClassName?: string;
  /** Render the trigger as text instead of the default button look. */
  triggerVariant?: 'default' | 'outline' | 'ghost';
  /** Override the trigger label. Defaults to "New project". */
  triggerLabel?: string;
}

export function CreateProjectButton({
  triggerClassName,
  triggerVariant = 'default',
  triggerLabel = 'New project',
}: Props = {}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const whoami = useWhoami();
  const firmScope = whoami.data?.user.tenantId ?? 'unknown';

  // Fetch the firm's claimants to populate the subject-tenant dropdown.
  // Only fires when the dialog is open — no point burning a query on
  // mount for a button most users never click.
  const subjectTenants = useQuery({
    queryKey: ['subject-tenants', firmScope],
    queryFn: listSubjectTenants,
    enabled: open,
  });

  const claimants = (subjectTenants.data ?? []).filter((t) => t.kind === 'claimant');

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      subject_tenant_id: '',
      name: '',
      description: '',
      started_at: '',
      ended_at: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createProject({
        subject_tenant_id: values.subject_tenant_id,
        name: values.name,
        description: values.description?.trim() ? values.description.trim() : undefined,
        started_at: dateToIso(values.started_at),
        ended_at: values.ended_at?.trim() ? dateToIso(values.ended_at) : undefined,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['projects', firmScope] });
      toast({ title: `Project "${created.name}" created` });
      setOpen(false);
      form.reset();
      router.push(`/projects/${created.id}`);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to create projects.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Client firm not found',
          description: 'The selected claimant may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to create project',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate(values);
  };

  const noClaimants = subjectTenants.isSuccess && claimants.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            R&amp;D projects group activities across one or more fiscal-year claims.
          </DialogDescription>
        </DialogHeader>

        {noClaimants ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              You need at least one client firm before creating a project. Create one first, then
              come back here.
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button asChild>
                <Link href="/subject-tenants">Go to Client firms</Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
              <FormField
                control={form.control}
                name="subject_tenant_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client firm</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={subjectTenants.isPending}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              subjectTenants.isPending
                                ? 'Loading client firms…'
                                : 'Select a client firm'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {claimants.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
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
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Lithium battery thermal modelling"
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
                        rows={3}
                        placeholder="One-paragraph scope. You can flesh out activities and hypotheses next."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="started_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ended_at"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        End date <span className="text-muted-foreground">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                  {mutation.isPending ? 'Creating…' : 'Create project'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
