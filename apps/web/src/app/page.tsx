'use client';
/**
 * / — root route.
 *
 * Per the workflow-shaped IA (Claimants → Activities → Evidence → Claims →
 * Financing), Claimants is the entry point. Root redirects to the Claimants
 * tab list at /subject-tenants.
 *
 * The old Dashboard component is archived at /dashboard-legacy (PR #7 will
 * delete it entirely once the new Claimants picker has all its capabilities).
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/subject-tenants');
  }, [router]);
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-12 text-center text-muted-foreground">
        <p>Loading claimants…</p>
      </div>
    </AppShell>
  );
}
