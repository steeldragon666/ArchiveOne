'use client';
import type { Project } from '@cpa/schemas';
import { useWhoami } from '@/hooks/use-whoami';
import { ArchiveProjectButton } from '../../_components/archive-project-button';
import { EditProjectButton } from '../../_components/edit-project-button';

export interface SettingsTabProps {
  project: Project;
}

/**
 * Project-detail Settings tab (T-A7 / Phase 4B).
 *
 * Replaced the read-only stub (TODO(p4-a-followup)) with:
 *   - EditProjectButton: Dialog + RHF + Zod + PATCH /v1/projects/:id
 *   - ArchiveProjectButton: confirmation dialog + DELETE /v1/projects/:id
 *
 * The detail section below the buttons stays — consultants often want a
 * quick read-only summary while the edit dialog is closed.
 */
export function SettingsTab({ project }: SettingsTabProps) {
  const whoami = useWhoami();
  const firmScope = whoami.data?.user.tenantId ?? 'unknown';

  return (
    <section className="space-y-6">
      {/* --- Edit / Archive controls --- */}
      <div className="flex items-center gap-3">
        <EditProjectButton project={project} firmScope={firmScope} />
        <ArchiveProjectButton project={project} firmScope={firmScope} />
      </div>

      {/* --- Read-only summary --- */}
      <div>
        <h2 className="text-base font-semibold mb-2">Project details</h2>
      </div>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{project.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <span
              className={
                project.archived_at !== null
                  ? 'inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600'
                  : 'inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
              }
            >
              {project.archived_at !== null ? 'Archived' : 'Active'}
            </span>
          </dd>
        </div>
        <div className="md:col-span-2">
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-wrap">
            {project.description ?? <span className="italic text-muted-foreground">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Started</dt>
          <dd>{new Date(project.started_at).toLocaleDateString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Ended</dt>
          <dd>
            {project.ended_at ? (
              new Date(project.ended_at).toLocaleDateString()
            ) : (
              <span className="italic text-muted-foreground">—</span>
            )}
          </dd>
        </div>
        {project.archived_at ? (
          <div className="md:col-span-2">
            <dt className="text-muted-foreground">Archived at</dt>
            <dd>{new Date(project.archived_at).toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{new Date(project.created_at).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last updated</dt>
          <dd>{new Date(project.updated_at).toLocaleString()}</dd>
        </div>
      </dl>
    </section>
  );
}
