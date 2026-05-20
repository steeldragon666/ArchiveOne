'use client';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SuggestionDetail } from '../_components/suggestion-detail';

/**
 * /suggestions/[id] — prompt-suggestion detail view (P7 Theme B Task B.7).
 *
 * Wrapped in <AppShell /> which provides the global header + persistent left
 * nav and embeds AuthGuard internally. The detail body fetches via TanStack
 * Query against GET /v1/suggestions/:id (B.3); the bottom of the page mounts
 * the PR-tracking widget which polls independently.
 */
export default function SuggestionDetailPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return <SuggestionDetail suggestionId={id} />;
}
