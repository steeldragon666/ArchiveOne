'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { AuditTimeline } from '@/components/audit-timeline';
import { Button } from '@/components/ui/button';
import { MultiCycleTimelineSection } from '@/components/multi-cycle-timeline-section';
import { getClaim } from '../../_lib/api';
import { getActivity, listActivityArtefacts } from '../_lib/api';
import { ArchiveActivityButton } from './_components/archive-activity-button';
import { ActivityEditor } from './_components/activity-editor';
import { TimeEntrySection } from './_components/time-entry-section';

/**
 * /claims/[claim_id]/activities/[activity_id] — activity detail editor (T-A5).
 *
 * Mirrors the dynamic-route pattern established in
 * `app/subject-tenants/[id]/page.tsx`: `'use client'` + React.use(params)
 * so AuthGuard wraps cleanly without a server-side cookie read.
 *
 * Page composition:
 *   - Header: breadcrumb back to claim, code (CA/SA-NN), kind badge
 *   - Editable form (ActivityEditor): title + 6 narrative fields
 *   - Read-only metadata block: project_id, claim_id, created_at,
 *     updated_at (these are not editable here per the schema —
 *     UpdateActivityBody intentionally excludes them)
 *   - Linked artefacts panel: real list from
 *     GET /v1/activities/:id/artefacts (T-A6) + a "View register"
 *     deeplink to the technical-uncertainty register page.
 *
 * Test approach: this is a React component with a hook + useQuery + form
 * state, so it's not amenable to pure-function unit tests in the
 * apps/web Node test runner (no jsdom). The pure-function helper
 * `computeChangedFields` is unit-tested in
 * `_components/activity-editor.test.tsx`. Full DOM interaction is
 * deferred to Playwright e2e in T-A10.
 */
export default function ActivityDetailPage({
  params,
}: {
  params: Promise<{ claim_id: string; activity_id: string }>;
}) {
  const { claim_id, activity_id } = use(params);
  return (
    <AppShell>
      <Inner claimId={claim_id} activityId={activity_id} />
    </AppShell>
  );
}

function Inner({ claimId, activityId }: { claimId: string; activityId: string }) {
  const detail = useQuery({
    queryKey: ['activity', activityId],
    queryFn: () => getActivity(activityId),
  });

  // Fetch the parent claim so the time-entry section can scope its query
  // by subject_tenant_id (time entries belong to claimants, not directly
  // to activities). Loads in parallel with the activity detail; the
  // section renders an empty state until both resolve.
  const claim = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => getClaim(claimId),
  });

  // A6 wired up — real list from GET /v1/activities/:id/artefacts. Runs
  // alongside the activity detail query (parallel fetches; the panel
  // renders independently of the editor's load state).
  const artefacts = useQuery({
    queryKey: ['activity-artefacts', activityId],
    queryFn: () => listActivityArtefacts(activityId),
  });

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  }
  if (detail.error || !detail.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">
          Failed to load activity:{' '}
          {detail.error instanceof Error ? detail.error.message : 'Unknown error'}
        </p>
        <Link
          href={`/claims/${claimId}`}
          className="text-sm text-primary underline mt-4 inline-block"
        >
          Back to claim
        </Link>
      </div>
    );
  }

  const activity = detail.data;
  const kindLabel = activity.kind === 'core' ? 'Core activity' : 'Supporting activity';

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/claims/${claimId}`} className="text-sm text-muted-foreground hover:underline">
          ← Back to claim
        </Link>
      </div>

      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Activity
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{activity.title}</h1>
          <span className="font-mono text-sm rounded bg-muted px-2 py-0.5">{activity.code}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {kindLabel}
          </span>
          {/* Phase 4B: archive control */}
          <div className="ml-auto flex items-center gap-2">
            <ArchiveActivityButton activity={activity} claimId={claimId} />
            {/*
              Download PDF button — links straight to the API path with the
              `download` attribute so the browser saves the bytes rather
              than navigating. Suggested filename is derived server-side
              from `Content-Disposition: attachment; filename="..."`.
              Wraps an <a> via shadcn's `asChild` slot so the button
              styling is preserved.
            */}
            <Button asChild variant="outline" size="sm">
              <a
                href={`/v1/activities/${activityId}/application.pdf`}
                download
                data-testid="download-application-pdf"
              >
                Download PDF
              </a>
            </Button>
          </div>
        </div>
      </header>

      {/*
        Multi-cycle citation-graph timeline (P7 Task A.5). Self-gates on
        the activity having a `proposed_id` chain with 2+ FYs; renders
        nothing otherwise. The supporting API endpoint is added in a
        follow-up task — until it lands, the section silently no-ops.
      */}
      <MultiCycleTimelineSection activityId={activityId} />

      <section className="space-y-4">
        <h2 className="font-display text-2xl font-medium">Audit timeline</h2>
        <AuditTimeline activityId={activityId} />
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-2xl font-medium">Edit narrative</h2>
        <ActivityEditor activity={activity} />
      </section>

      {/* Phase 4C: time-entry editing — only renders once the parent claim
          has resolved (we need its subject_tenant_id to scope the query). */}
      {claim.data ? <TimeEntrySection subjectTenantId={claim.data.subject_tenant_id} /> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-medium">Linked artefacts</h2>
          <Link
            href={`/claims/${claimId}/activities/${activityId}/register`}
            className="text-sm text-primary hover:underline"
          >
            View register →
          </Link>
        </div>
        {artefacts.isPending ? (
          <p className="text-sm text-muted-foreground">Loading linked artefacts…</p>
        ) : artefacts.error ? (
          <p className="text-sm text-destructive">
            Failed to load artefacts:{' '}
            {artefacts.error instanceof Error ? artefacts.error.message : 'Unknown error'}
          </p>
        ) : artefacts.data.length === 0 ? (
          <div className="rounded border-2 border-dashed border-border bg-transparent p-6 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              No links yet
            </p>
            <p className="text-sm text-muted-foreground">
              Link evidence (media, events, expenditures, time entries) from the consultant feed.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {artefacts.data.map((a) => (
              <li
                key={a.linked_event_id}
                className="border border-border rounded px-3 py-2 text-sm bg-card flex flex-wrap items-center gap-2"
              >
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {a.artefact_kind}
                </span>
                <span className="font-mono text-xs break-all">{a.artefact_id}</span>
                {a.link_reason ? (
                  <span className="text-xs text-muted-foreground italic">— {a.link_reason}</span>
                ) : null}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {new Date(a.linked_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-medium">Details</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Code
            </dt>
            <dd className="font-mono">{activity.code}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Kind
            </dt>
            <dd>{kindLabel}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Project
            </dt>
            <dd className="font-mono break-all">{activity.project_id}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Claim
            </dt>
            <dd className="font-mono break-all">{activity.claim_id}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Created
            </dt>
            <dd className="font-mono">{new Date(activity.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Updated
            </dt>
            <dd className="font-mono">{new Date(activity.updated_at).toLocaleString()}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
