'use client';
import { AppShell } from '@/components/app-shell';
import { CreateClaimantButton } from './_components/create-claimant-button';
import { SubjectTenantList } from './_components/subject-tenant-list';

/**
 * /subject-tenants — list of the active firm's claimants + Create CTA.
 *
 * Wrapped in <AppShell /> which provides the global header + persistent left
 * nav and embeds AuthGuard internally.
 */
export default function SubjectTenantsPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Client firms</h1>
          <p className="text-muted-foreground max-w-2xl">
            Subject (claimant) firms your firm advises on R&amp;DTI matters.
          </p>
        </div>
        <CreateClaimantButton />
      </header>
      <SubjectTenantList />
    </div>
  );
}
