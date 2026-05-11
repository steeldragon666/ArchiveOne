'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { Employee } from '@cpa/schemas';
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
import { ForbiddenError, NotFoundError } from '@/lib/api';
import { updateEmployee } from '../_lib/mutations';

const Schema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
  job_title: z.string().max(200, 'Job title must be 200 characters or fewer'),
});
type FormValues = z.infer<typeof Schema>;

interface Props {
  employee: Employee;
  subjectTenantId: string;
}

/**
 * Edit-employee dialog (Phase 4B).
 *
 * Editable fields: name, job_title. Email is immutable post-invite.
 * On success: invalidates the ['employees', subjectTenantId] and
 * ['employees'] queries.
 */
export function EditEmployeeButton({ employee, subjectTenantId }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      name: employee.name,
      job_title: employee.job_title ?? '',
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({ name: employee.name, job_title: employee.job_title ?? '' });
    }
    setOpen(next);
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      updateEmployee(employee.id, {
        name: values.name,
        job_title: values.job_title.trim() ? values.job_title.trim() : null,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['employees', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
      toast({ title: `Employee "${updated.name}" updated` });
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to edit employees.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Employee not found',
          description: 'This employee may have been deactivated or removed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to update employee',
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
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit employee</DialogTitle>
          <DialogDescription>
            Update {employee.name}&apos;s name or job title. Email address cannot be changed after
            the initial invite.
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
            <div className="rounded border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Email: <span className="font-mono">{employee.email}</span> (read-only)
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
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
