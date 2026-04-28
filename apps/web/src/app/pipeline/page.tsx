'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Claim } from '@cpa/schemas';
import { AuthGuard } from '@/components/auth-guard';
import { PipelineBulkToolbar } from './_components/pipeline-bulk-toolbar';
import { PipelineFilters, type ConsultantOption } from './_components/pipeline-filters';
import { PipelineKanban } from './_components/pipeline-kanban';
import { PipelineTable } from './_components/pipeline-table';
import {
  currentFiscalYear,
  DEFAULT_SORT,
  parseFiscalYear,
  parseSort,
  parseStages,
  parseView,
  type PipelineView,
} from './_components/url-params';
import { usePipelineClaims } from './_lib/use-pipeline-claims';
import { usePipelineSelection } from './_lib/use-pipeline-selection';
import { useUsers } from '@/hooks/use-users';
import { useWhoami } from '@/hooks/use-whoami';

/**
 * /pipeline — Swimlane C entry point. Renders a filter bar + (kanban or
 * table) view + a shared bulk-action toolbar. C1 established URL-driven
 * filter state; C2 added the kanban; C3 added the table and lifted state
 * (claims + selection) into hooks so a selection in one view persists
 * across the view toggle.
 *
 * Following the P1 dynamic-route pattern (see subject-tenants/[id]/page.tsx):
 * `'use client'` + AuthGuard wraps the page; URL state is read via
 * useSearchParams. AuthGuard's whoami query is the gate for showing any
 * tenant-scoped data.
 *
 * NOTE: GET /v1/claims doesn't exist yet — that's Swimlane A's A2 task.
 * For C1/C2/C3 we stub the data fetch by short-circuiting useQuery to an
 * empty list. Swap to the real `listClaims()` call when A2 ships; the
 * query key shape already matches.
 */
export default function PipelinePage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const stages = parseStages(searchParams.getAll('stage'));
  const consultantId = searchParams.get('consultant');
  const fiscalYear = parseFiscalYear(searchParams.get('fy'), currentFiscalYear());
  const sector = searchParams.get('sector') ?? '';
  const sort = parseSort(searchParams.get('sort'), searchParams.get('dir')) ?? DEFAULT_SORT;

  // Consultants for the dropdown come from the firm-members list (the
  // existing /v1/users endpoint already returns the active firm's
  // members). Using the same query key as the /users page to share the
  // tanstack cache across pages.
  //
  // Filter to admin + consultant roles only — viewers don't own claims and
  // shouldn't pollute the "Consultant" filter dropdown. UserRef.role is
  // exposed by the /v1/users endpoint (see hooks/use-users.ts).
  const usersQuery = useUsers();
  const consultants = useMemo<ConsultantOption[]>(() => {
    if (!usersQuery.data) return [];
    return usersQuery.data
      .filter((u) => u.role === 'admin' || u.role === 'consultant')
      .map((u) => ({
        id: u.id,
        label: u.displayName ?? u.email,
      }));
  }, [usersQuery.data]);

  // TODO(A2): replace with `listClaims({ stages, consultantId, fiscalYear, sector })`
  // once Swimlane A's GET /v1/claims endpoint ships. Until then we render
  // an empty list so the page shell + filter wiring is exercisable. The
  // query key intentionally mirrors what the real fetch will use, so
  // swapping in the API call is a one-line change.
  const claimsQuery = useQuery({
    queryKey: ['claims', { stages, consultantId, fiscalYear, sector }] as const,
    queryFn: (): Promise<Claim[]> => Promise.resolve([]),
  });

  // Role drives admin-only affordances inside the views (revert via
  // context-menu, backward drag-drop, bulk-revert). AuthGuard guarantees
  // `whoami` data is loaded before children render, so the optional chain
  // here is just a TS courtesy — the value will be present.
  const whoami = useWhoami();
  const role = whoami.data?.user.role ?? 'viewer';

  // Hooks lifted from the kanban / table so selection persists across the
  // view toggle and a single mutation flow drives both views (C3 refactor).
  const claimsHook = usePipelineClaims({ claims: claimsQuery.data ?? [] });
  const selection = usePipelineSelection();

  return (
    <main className="container mx-auto space-y-6 px-4 py-8">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <span className="text-xs text-muted-foreground">
          {claimsQuery.data?.length ?? 0} claim{claimsQuery.data?.length === 1 ? '' : 's'}
        </span>
      </header>

      <PipelineFilters
        view={view}
        stages={stages}
        consultantId={consultantId}
        fiscalYear={fiscalYear}
        sector={sector}
        consultants={consultants}
      />

      <PipelineBulkToolbar claims={claimsHook} selection={selection} role={role} />

      <ViewBody
        view={view}
        isPending={claimsQuery.isPending}
        error={claimsQuery.error}
        claimsHook={claimsHook}
        selection={selection}
        role={role}
        sort={sort}
      />
    </main>
  );
}

interface ViewBodyProps {
  view: PipelineView;
  isPending: boolean;
  error: unknown;
  claimsHook: ReturnType<typeof usePipelineClaims>;
  selection: ReturnType<typeof usePipelineSelection>;
  role: 'admin' | 'consultant' | 'viewer';
  sort: ReturnType<typeof parseSort> extends infer R ? NonNullable<R> : never;
}

function ViewBody({ view, isPending, error, claimsHook, selection, role, sort }: ViewBodyProps) {
  if (isPending) {
    return <p className="text-sm text-muted-foreground">Loading claims…</p>;
  }
  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load claims: {error instanceof Error ? error.message : 'Unknown error'}
      </p>
    );
  }
  if (view === 'kanban') {
    return <PipelineKanban claims={claimsHook} selection={selection} role={role} />;
  }
  return <PipelineTable claims={claimsHook} selection={selection} role={role} sort={sort} />;
}
