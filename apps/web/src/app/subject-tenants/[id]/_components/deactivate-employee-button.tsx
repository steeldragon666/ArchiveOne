'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { ForbiddenError, NotFoundError } from '@/lib/api';
import { deactivateEmployee } from '../_lib/mutations';

interface Props {
  employee: Employee;
  subjectTenantId: string;
}

/**
 * Deactivate-employee confirmation dialog (Phase 4B).
 *
 * "Archive" for employees is called "deactivate" to match the schema field
 * (`deactivated_at`). Sends DELETE /v1/employees/:id. On success invalidates
 * the employee list — the deactivated employee disappears from active lists.
 */
export function DeactivateEmployeeButton({ employee, subjectTenantId }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => deactivateEmployee(employee.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees', subjectTenantId] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
      toast({ title: `Employee "${employee.name}" deactivated` });
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to deactivate employees.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Employee not found',
          description: 'This employee may have already been deactivated.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to deactivate employee',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  // Already deactivated — show disabled.
  if (employee.deactivated_at !== null) {
    return (
      <Button variant="ghost" size="sm" disabled className="text-muted-foreground">
        Deactivated
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
          Deactivate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate employee?</DialogTitle>
          <DialogDescription>
            Deactivating <strong>{employee.name}</strong> ({employee.email}) prevents them from
            logging in via magic link and removes them from active employee lists. Historical time
            entries and activity logs are preserved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Deactivating…' : 'Deactivate employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
