'use client';
/**
 * /claims — Claims tab (top-tab nav).
 *
 * PR #1: redirects to the existing /pipeline list (which already has the
 * filter bar, kanban/table toggle, and "Start a new claim" CTA). The
 * /pipeline route will be retired in PR #7 and its content moved here
 * verbatim; for now this preserves all the existing pipeline functionality
 * under the new IA URL.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';

export default function ClaimsListPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/pipeline');
  }, [router]);
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-12 text-center text-muted-foreground">
        <p>Loading claims…</p>
      </div>
    </AppShell>
  );
}
