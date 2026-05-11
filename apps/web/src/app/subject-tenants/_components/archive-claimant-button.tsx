'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { ForbiddenError, NotFoundError } from '@/lib/api';
import { archiveSubjectTenant } from '../_lib/mutations';

interface Props {
  subjectTenant: SubjectTenant;
  redirectTo?: string;
}

/**
 * Archive-claimant confirmation dialog (Phase 4B).
 *
 * Sends DELETE /v1/subject-tenants/:id (soft-delete). After archiving,
 * redirects to /subject-tenants.
 */
export function ArchiveClaimantButton({ subjectTenant, redirectTo = '/subject-tenants' }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => archiveSubjectTenant(subjectTenant.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subject-tenants'] });
      void qc.invalidateQueries({ queryKey: ['subject-tenant', subjectTenant.id] });
      toast({ title: `Claimant "${subjectTenant.name}" archived` });
      setOpen(false);
      router.push(redirectTo);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to archive claimants.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Claimant not found',
          description: 'This claimant may have already been removed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to archive claimant',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          Archive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive claimant?</DialogTitle>
          <DialogDescription>
            Archiving <strong>{subjectTenant.name}</strong> removes it from the active claimants
            list. All associated projects, claims, and activities remain accessible for audit
            purposes.
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
            {mutation.isPending ? 'Archiving…' : 'Archive claimant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
