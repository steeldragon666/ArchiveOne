'use client';
/**
 * Create-employee CTA + modal for the subject-tenant detail page.
 *
 * On success: invalidates any ['employees'] query keys, closes the dialog,
 * and shows a toast. No redirect — employees aren't viewed individually yet.
 *
 * Mirrors CreateClaimantButton's structure (Dialog + RHF + Zod +
 * TanStack mutation + toast) so the codebase has one consistent shape
 * for create-* dialogs.
 *
 * Error mapping: 409 → "email already invited" toast; 403 → "permission
 * denied" toast; 404 → "claimant not found" toast; everything else →
 * generic destructive toast.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/hooks/use-toast';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api';
import { createEmployee } from '../_lib/api';

/**
 * Form schema — mirrors createEmployeeBody in packages/schemas/src/employee.ts:
 *   - subject_tenant_id: injected via prop (not a form field)
 *   - email: required, valid email
 *   - name: required, 1-200 chars
 *   - job_title: optional, max 200 chars
 *
 * `payroll_external_id` and `payroll_provider` are intentionally omitted
 * from the create form — they're backfilled by payroll-sync (D14-D15)
 * and not something a consultant enters manually at invite time.
 */
const Schema = z.object({
  email: z.string().email('Enter a valid email address'),
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
  job_title: z.string().max(200, 'Job title must be 200 characters or fewer').optional(),
});
type FormValues = z.infer<typeof Schema>;

interface Props {
  subjectTenantId: string;
  /** Optional className applied to the trigger button. */
  triggerClassName?: string;
  /** Override the trigger label. Defaults to "Add employee". */
  triggerLabel?: string;
}

export function CreateEmployeeButton({
  subjectTenantId,
  triggerClassName,
  triggerLabel = 'Add employee',
}: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { email: '', name: '', job_title: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      createEmployee({
        subject_tenant_id: subjectTenantId,
        email: values.email,
        name: values.name,
        job_title: values.job_title?.trim() ? values.job_title.trim() : undefined,
      }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      void qc.invalidateQueries({ queryKey: ['employees', subjectTenantId] });
      toast({ title: `Employee "${created.name}" added` });
      setOpen(false);
      form.reset();
    },
    onError: (err) => {
      if (err instanceof ConflictError) {
        toast({
          title: 'Employee already invited',
          description: 'That email address has already been invited under this claimant.',
          variant: 'destructive',
        });
      } else if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to add employees.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Claimant not found',
          description: 'The claimant may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to add employee',
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={triggerClassName}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add employee</DialogTitle>
          <DialogDescription>
            Invite an employee to this claimant. They&apos;ll receive a magic-link email so they can
            log their R&amp;D activity from the mobile app.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Smith" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="jane@acme.com.au" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="job_title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Job title <span className="text-muted-foreground">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Senior Software Engineer" {...field} />
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
                {mutation.isPending ? 'Adding…' : 'Add employee'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
