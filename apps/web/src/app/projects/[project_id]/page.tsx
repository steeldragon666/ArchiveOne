'use client';
import Link from 'next/link';
import { use } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AuthGuard } from '@/components/auth-guard';
import { cn } from '@/lib/utils';
import { getProject } from '../_lib/api';
import { parseProjectTab } from '../_lib/url-params';
import { ClaimsTab } from './_components/claims-tab';
import { ProjectTabs } from './_components/project-tabs';
import { SettingsTab } from './_components/settings-tab';
import { TimelineTab } from './_components/timeline-tab';

/**
 * /projects/[project_id] — project detail page (T-A7).
 *
 * Mirrors the dynamic-route pattern in
 * `app/claims/[claim_id]/activities/[activity_id]/page.tsx`:
 * `'use client'` + React.use(params) + AuthGuard. The header shows
 * project name, id-prefix, dates, and status badge; below that the
 * three-tab shell (Claims / Timeline / Settings) URL-driven via
 * `?tab=...`.
 *
 * Page-level loading + error states are handled here; tab content
 * components own their own data-fetching loading + error UI so each
 * tab is independently usable.
 */
export default function ProjectDetailPage({ params }: { params: Promise<{ project_id: string }> }) {
  const { project_id } = use(params);
  return (
    <AuthGuard>
      <Inner projectId={project_id} />
    </AuthGuard>
  );
}

function Inner({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const tab = parseProjectTab(searchParams.get('tab'));

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });

  if (project.isPending) {
    return (
      <main className="container mx-auto py-8 px-4">
        <p className="text-slate-500">Loading project…</p>
      </main>
    );
  }
  if (project.error || !project.data) {
    return (
      <main className="container mx-auto py-8 px-4 space-y-4">
        <p className="text-red-600">
          Failed to load project:{' '}
          {project.error instanceof Error ? project.error.message : 'Unknown error'}
        </p>
        <Link href="/projects" className="text-sm text-primary underline mt-4 inline-block">
          Back to projects
        </Link>
      </main>
    );
  }

  const p = project.data;
  const isArchived = p.archived_at !== null;

  return (
    <main className="container mx-auto py-8 px-4 space-y-8">
      <div>
        <Link href="/projects" className="text-sm text-muted-foreground hover:underline">
          ← Back to projects
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          <span className="font-mono text-xs rounded bg-muted px-2 py-0.5" title={p.id}>
            {p.id.slice(0, 8)}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
              isArchived
                ? 'border-slate-200 bg-slate-50 text-slate-600'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {isArchived ? 'Archived' : 'Active'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Started {new Date(p.started_at).toLocaleDateString()}</span>
          {p.ended_at ? <span>· Ended {new Date(p.ended_at).toLocaleDateString()}</span> : null}
        </div>
      </header>

      <ProjectTabs active={tab} />

      <section className="pt-2">
        {tab === 'claims' ? (
          <ClaimsTab project={p} />
        ) : tab === 'timeline' ? (
          <TimelineTab project={p} />
        ) : (
          <SettingsTab project={p} />
        )}
      </section>
    </main>
  );
}
