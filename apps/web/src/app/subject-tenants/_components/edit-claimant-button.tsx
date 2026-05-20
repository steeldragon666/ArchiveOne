'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { SubjectTenant } from '@cpa/schemas';
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
import { updateSubjectTenant } from '../_lib/mutations';

const Schema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
});
type FormValues = z.infer<typeof Schema>;

interface Props {
  subjectTenant: SubjectTenant;
}

/**
 * Edit-claimant dialog (Phase 4B).
 *
 * Sends PATCH /v1/subject-tenants/:id with the updated name. Invalidates
 * both the detail query and the list query on success.
 */
export function EditClaimantButton({ subjectTenant }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { name: subjectTenant.name },
  });

  const handleOpenChange = (next: boolean) => {
    if (next) form.reset({ name: subjectTenant.name });
    setOpen(next);
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) => updateSubjectTenant(subjectTenant.id, values),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['subject-tenant', subjectTenant.id] });
      void qc.invalidateQueries({ queryKey: ['subject-tenants'] });
      toast({ title: `Claimant renamed to "${updated.name}"` });
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof ConflictError) {
        toast({
          title: 'Duplicate name',
          description: 'A claimant with that name already exists in this firm.',
          variant: 'destructive',
        });
      } else if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to edit claimants.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Claimant not found',
          description: 'This claimant may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to update claimant',
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
          <DialogTitle>Edit claimant</DialogTitle>
          <DialogDescription>Update the claimant&apos;s display name.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Pty Ltd" autoFocus {...field} />
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
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
