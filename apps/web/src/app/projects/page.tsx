'use client';
import { useSearchParams } from 'next/navigation';
import { AuthGuard } from '@/components/auth-guard';
import { ProjectList } from './_components/project-list';
import { parseProjectListSort, parseProjectListStatus } from './_lib/url-params';

/**
 * /projects — list of all projects in the active firm (T-A7).
 *
 * Pattern matches the C1/C4 conventions established in this repo:
 * `'use client'` + AuthGuard wrapping a client-rendered <ProjectList />.
 * Same shell as `/subject-tenants/page.tsx` and `/users/page.tsx`.
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
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const status = parseProjectListStatus(searchParams.get('status'));
  const sort = parseProjectListSort(searchParams.get('sort'));

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Long-lived R&amp;D undertakings spanning one or more fiscal-year claims.
        </p>
      </div>
      <ProjectList status={status} sort={sort} />
    </main>
  );
}
