'use client';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { CreateProjectButton } from './_components/create-project-button';
import { ProjectList } from './_components/project-list';
import { parseProjectListSort, parseProjectListStatus } from './_lib/url-params';

/**
 * /projects — list of all projects in the active firm (T-A7).
 *
 * Wrapped in <AppShell /> which provides the global header + persistent left
 * nav and embeds AuthGuard internally; the page itself only owns the content
 * area.
 *
 * URL-driven filters:
 *   - `?status=active|archived|all` — default 'active' (omitted)
 *   - `?sort=name|recent|claim_count` — default 'name' (omitted)
 *
 * The parsers tolerate junk values (unknown / null / empty → default)
 * so a stale bookmark renders gracefully instead of 400-ing — same
 * convention as `parseFilter` in subject-tenants/[id]/_components/
 * filter-tabs.tsx.
 */
export default function ProjectsPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const status = parseProjectListStatus(searchParams.get('status'));
  const sort = parseProjectListSort(searchParams.get('sort'));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground max-w-2xl">
            Long-lived R&amp;D undertakings spanning one or more fiscal-year claims.
          </p>
        </div>
        <CreateProjectButton />
      </header>
      <ProjectList status={status} sort={sort} />
    </div>
  );
}
