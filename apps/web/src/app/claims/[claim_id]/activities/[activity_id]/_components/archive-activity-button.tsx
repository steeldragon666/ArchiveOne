'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Activity } from '@cpa/schemas';
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
import { archiveActivity } from '../../_lib/mutations';

interface Props {
  activity: Activity;
  claimId: string;
}

/**
 * Archive-activity confirmation dialog (Phase 4B).
 *
 * Activities don't have a dedicated archive endpoint in the current API —
 * we soft-delete via DELETE /v1/activities/:id (sets archived_at server-side,
 * same pattern as DELETE /v1/projects/:id). After archiving, redirects back
 * to the parent claim.
 */
export function ArchiveActivityButton({ activity, claimId }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => archiveActivity(activity.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activity', activity.id] });
      void qc.invalidateQueries({ queryKey: ['activities'] });
      toast({
        title: `Activity ${activity.code} archived`,
        description: `"${activity.title}" has been archived.`,
      });
      setOpen(false);
      router.push(`/claims/${claimId}`);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to archive activities.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Activity not found',
          description: 'This activity may have already been archived or removed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to archive activity',
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
          <DialogTitle>Archive activity?</DialogTitle>
          <DialogDescription>
            Archiving{' '}
            <strong>
              {activity.code} — {activity.title}
            </strong>{' '}
            removes it from the active activity list. All linked evidence and time entries remain
            accessible for audit purposes.
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
            {mutation.isPending ? 'Archiving…' : 'Archive activity'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
