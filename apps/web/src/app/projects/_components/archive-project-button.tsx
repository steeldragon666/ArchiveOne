'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Project } from '@cpa/schemas';
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
import { archiveProject } from '../_lib/mutations';

interface Props {
  project: Project;
  /** Query key scope used when invalidating: ['project', firmScope, id] */
  firmScope: string;
  /** After archiving, redirect here. Defaults to /projects. */
  redirectTo?: string;
}

/**
 * Archive-project confirmation dialog.
 *
 * Shows a destructive "Archive" button in a confirmation dialog — mirrors
 * the pattern described in the T-A7 TODO comment (settings-tab.tsx) which
 * references the user-soft-delete dialog. Sends DELETE /v1/projects/:id
 * which sets archived_at server-side.
 */
export function ArchiveProjectButton({ project, firmScope, redirectTo = '/projects' }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => archiveProject(project.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', firmScope] });
      void qc.invalidateQueries({ queryKey: ['project', firmScope, project.id] });
      toast({ title: `Project "${project.name}" archived` });
      setOpen(false);
      router.push(redirectTo);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to archive projects.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Project not found',
          description: 'This project may have already been archived or removed.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to archive project',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
    },
  });

  // Already archived — show a disabled button so the UI is consistent.
  if (project.archived_at !== null) {
    return (
      <Button variant="outline" size="sm" disabled>
        Archived
      </Button>
    );
  }

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
          <DialogTitle>Archive project?</DialogTitle>
          <DialogDescription>
            Archiving <strong>{project.name}</strong> removes it from the active project list. The
            project and all its associated claims and activities remain accessible for audit
            purposes. This action can be reversed by support.
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
            {mutation.isPending ? 'Archiving…' : 'Archive project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
