'use client';
import { AppShell } from '@/components/app-shell';
import { ApportionmentTable } from './_components/apportionment-table';

/**
 * /admin/apportionment — apportionment workbench (T-B23).
 *
 * Consultant view for setting R&D apportionment_pct on time_entry rows and
 * reviewing payroll-vs-manual flagged conflicts (T-B21).
 *
 * Wrapped in <AppShell /> which provides the global header + persistent left
 * nav and embeds AuthGuard internally.
 */
export default function ApportionmentPage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Administration
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Apportionment workbench
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Set R&amp;D apportionment percentage per time entry. Flagged entries (manual entries
            overlapping payroll-synced periods) require review before they roll into the chain.
          </p>
        </header>
        <ApportionmentTable />
      </div>
    </AppShell>
  );
}
