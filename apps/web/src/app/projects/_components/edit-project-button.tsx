'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { ForbiddenError, NotFoundError } from '@/lib/api';
import { updateProject } from '../_lib/mutations';

/**
 * Form schema — mirrors UpdateProjectBody in packages/schemas/src/project.ts.
 * All fields are optional; empty string description/ended_at are treated as
 * "clear" on submit (mapped to null). Date fields come from <input type="date">
 * as YYYY-MM-DD and get promoted to ISO-8601 before sending.
 */
const Schema = z
  .object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
    description: z.string(),
    started_at: z.string().min(1, 'Start date is required'),
    ended_at: z.string(),
  })
  .refine((v) => !v.ended_at || new Date(v.started_at) <= new Date(v.ended_at), {
    message: 'End date must be on or after start date',
    path: ['ended_at'],
  });

type FormValues = z.infer<typeof Schema>;

const toDateInput = (iso: string): string => iso.slice(0, 10);
const toIso = (yyyymmdd: string): string => `${yyyymmdd}T00:00:00.000Z`;

interface Props {
  project: Project;
  /** Query key scope used when invalidating: ['project', firmScope, id] */
  firmScope: string;
}

export function EditProjectButton({ project, firmScope }: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      started_at: toDateInput(project.started_at),
      ended_at: project.ended_at ? toDateInput(project.ended_at) : '',
    },
  });

  // Re-populate defaults whenever the dialog reopens (in case the project
  // was updated externally between opens).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      form.reset({
        name: project.name,
        description: project.description ?? '',
        started_at: toDateInput(project.started_at),
        ended_at: project.ended_at ? toDateInput(project.ended_at) : '',
      });
    }
    setOpen(next);
  };

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      updateProject(project.id, {
        name: values.name,
        description: values.description.trim() ? values.description.trim() : null,
        started_at: toIso(values.started_at),
        ended_at: values.ended_at.trim() ? toIso(values.ended_at) : null,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ['project', firmScope, project.id] });
      void qc.invalidateQueries({ queryKey: ['projects', firmScope] });
      toast({ title: `Project "${updated.name}" updated` });
      setOpen(false);
    },
    onError: (err) => {
      if (err instanceof ForbiddenError) {
        toast({
          title: 'Permission denied',
          description: 'Admin or consultant role is required to edit projects.',
          variant: 'destructive',
        });
      } else if (err instanceof NotFoundError) {
        toast({
          title: 'Project not found',
          description: 'This project may have been removed. Refresh and try again.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Failed to update project',
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
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            Update the project&apos;s name, description, or dates.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-4">
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
                    <Textarea rows={3} placeholder="One-paragraph scope." {...field} />
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
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
