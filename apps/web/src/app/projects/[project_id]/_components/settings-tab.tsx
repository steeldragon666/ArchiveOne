'use client';
import type { Project } from '@cpa/schemas';

/**
 * Project-detail Settings tab (T-A7).
 *
 * Read-only view of the project's editable fields (name, description,
 * dates). The PATCH wiring is intentionally deferred — see the TODO
 * below — so the consultant gets a structured-summary placeholder until
 * the form lands.
 *
 * Brief explicitly allows: "Stub the form interactions for now (TODO
 * references for PATCH wiring); rendering the read-only view is
 * sufficient if PATCH wiring takes too long."
 *
 * TODO(p4-a-followup): wire a real edit form here. Plan:
 *   - Use react-hook-form + Zod (UpdateProjectBody) for parity with the
 *     activity editor (apps/web/src/app/claims/[claim_id]/activities/
 *     [activity_id]/_components/activity-editor.tsx).
 *   - Submit via PATCH /v1/projects/:id and invalidate the
 *     ['project', id] query on success.
 *   - Archive control (DELETE /v1/projects/:id) goes here too — same
 *     shape as the user-soft-delete dialog at /users/[userId].
 */

export interface SettingsTabProps {
  project: Project;
}

export function SettingsTab({ project }: SettingsTabProps) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-2">Project details</h2>
        <p className="text-sm text-muted-foreground">
          Read-only view. Editing controls are deferred to a later iteration; the API endpoints
          (PATCH and DELETE /v1/projects/:id) already exist — see <code>TODO(p4-a-followup)</code>{' '}
          in <code>settings-tab.tsx</code>.
        </p>
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
