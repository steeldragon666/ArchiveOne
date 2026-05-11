'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { getSubjectTenant } from '../_lib/api';
// Phase 4B — edit + archive controls (agent B)
import { ArchiveClaimantButton } from '../_components/archive-claimant-button';
import { EditClaimantButton } from '../_components/edit-claimant-button';
import { ChainStatusBadge } from './_components/chain-status-badge';
import { CreateClaimButton } from './_components/create-claim-button';
import { CreateEmployeeButton } from './_components/create-employee-button';
import { EventFeed } from './_components/event-feed';
import { FilterTabs, parseFilter } from './_components/filter-tabs';
import { EmployeeList } from './_components/employee-list';
import { PasteForm } from './_components/paste-form';
import { PendingNarrativePanel } from './_components/pending-narrative-panel';
import { UploadEvidenceButton } from './_components/upload-evidence-button';
import { UploadedEvidenceList } from './_components/uploaded-evidence-list';

/**
 * /subject-tenants/[id] — the demo screen scaffold.
 *
 * This commit (T23) lays down the header (claimant name + chain badge +
 * event count) and placeholders for the paste form and event feed; T24
 * fills those in. Following the P1 dynamic-route pattern (see
 * users/[userId]/page.tsx): `'use client'` + React.use(params) so the
 * AuthGuard wraps cleanly without needing server-side cookie reads.
 */
export default function SubjectTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell>
      <Inner subjectTenantId={id} />
    </AppShell>
  );
}

/**
 * Review mode for AI-extracted activities + invoices.
 *
 * `narrative` (default): show the PendingNarrativePanel — one-gesture approval
 *   that auto-creates every proposal, flagging low-confidence ones for spot
 *   review on the Activities tab. Per-card Confirm buttons are hidden.
 *
 * `per-document`: hide the narrative panel and surface per-proposal Confirm
 *   buttons inside each uploaded-file card (the legacy flow). For power users
 *   who want to review individually.
 */
type ReviewMode = 'narrative' | 'per-document';

function Inner({ subjectTenantId }: { subjectTenantId: string }) {
  const searchParams = useSearchParams();
  const filter = parseFilter(searchParams.get('filter'));
  const [reviewMode, setReviewMode] = useState<ReviewMode>('narrative');

  const detail = useQuery({
    queryKey: ['subject-tenant', subjectTenantId],
    queryFn: () => getSubjectTenant(subjectTenantId),
  });

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">Loading claimant…</p>;
  }
  if (detail.error || !detail.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">
          Failed to load claimant:{' '}
          {detail.error instanceof Error ? detail.error.message : 'Unknown error'}
        </p>
        <Link href="/subject-tenants" className="text-sm text-primary underline mt-4 inline-block">
          Back to claimants
        </Link>
      </div>
    );
  }

  const { subject_tenant, event_count } = detail.data;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/subject-tenants" className="text-sm text-muted-foreground hover:underline">
          ← Claimants
        </Link>
      </div>
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Client firm
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {subject_tenant.name}
          </h1>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {subject_tenant.kind}
          </span>
          <ChainStatusBadge subjectTenantId={subjectTenantId} />
          <span className="font-mono text-xs text-muted-foreground">
            {event_count} event{event_count === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Phase 4B: edit + archive (agent B — do not remove) */}
            <EditClaimantButton subjectTenant={subject_tenant} />
            <ArchiveClaimantButton subjectTenant={subject_tenant} />
            {/* End Phase 4B */}
            <CreateClaimButton subjectTenantId={subjectTenantId} />
            <CreateEmployeeButton subjectTenantId={subjectTenantId} />
            <UploadEvidenceButton subjectTenantId={subjectTenantId} />
          </div>
        </div>
      </header>
      <section>
        <PasteForm subjectTenantId={subjectTenantId} />
      </section>

      {/* AI narrative-approval panel — shown only when there's pending extraction
          across uploaded docs and we're in narrative mode. The component itself
          returns null when nothing's pending. */}
      {reviewMode === 'narrative' && (
        <section>
          <PendingNarrativePanel subjectTenantId={subjectTenantId} />
        </section>
      )}

      {/* Phase 4B: employee list with edit + deactivate controls */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-medium">Employees</h2>
          <CreateEmployeeButton subjectTenantId={subjectTenantId} triggerLabel="Add employee" />
        </div>
        <EmployeeList subjectTenantId={subjectTenantId} />
      </section>
      {/* End Phase 4B */}
      {/* Uploaded Evidence — primary surface showing each file with its AI analysis */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Uploaded files
            </p>
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Your evidence,{' '}
              <span className="italic font-medium text-[hsl(var(--brand-accent))]">analysed</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Every uploaded file is hashed, recorded on the immutable chain, and read by Claude
              Haiku. Each card below shows the AI&apos;s classification, confidence, and the
              statutory anchor it cited.
            </p>
          </div>
          <UploadEvidenceButton
            subjectTenantId={subjectTenantId}
            triggerLabel="Upload more evidence"
            triggerVariant="default"
          />
        </div>

        {/* Mode toggle — narrative (default) vs per-document review. The two
            paths produce identical chain events; this is purely a UX choice
            for whether the consultant wants one big approval or per-card. */}
        <div className="flex flex-wrap items-center gap-1 rounded border border-border bg-muted/40 p-0.5 self-start text-xs">
          <button
            type="button"
            onClick={() => setReviewMode('narrative')}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest transition-colors ${
              reviewMode === 'narrative'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Narrative approval
          </button>
          <button
            type="button"
            onClick={() => setReviewMode('per-document')}
            className={`px-3 py-1.5 rounded font-mono text-[10px] uppercase tracking-widest transition-colors ${
              reviewMode === 'per-document'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Review per-document
          </button>
        </div>

        <UploadedEvidenceList
          subjectTenantId={subjectTenantId}
          showProposalConfirmCards={reviewMode === 'per-document'}
        />
      </section>

      {/* Full chronological event log (covers pasted transcripts + override events too) */}
      <section className="space-y-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Forensic chain
          </p>
          <h2 className="font-display text-2xl font-medium">Full event log</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Every chain entry — uploads, pasted transcripts, overrides, agent actions — in
            reverse-chronological order. Filter to narrow.
          </p>
        </div>
        <FilterTabs subjectTenantId={subjectTenantId} active={filter} />
        <EventFeed subjectTenantId={subjectTenantId} filter={filter} />
      </section>
    </div>
  );
}
