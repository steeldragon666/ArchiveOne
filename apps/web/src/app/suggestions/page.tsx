'use client';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/app-shell';
import { FlagSuggestionModal } from '@/components/flag-suggestion-modal';
import { SuggestionList } from './_components/suggestion-list';
import { parseSuggestionSourceKindFilter, parseSuggestionStatusFilter } from './_lib/url-params';

/**
 * /suggestions — prompt-suggestion queue list view (P7 Theme B Task B.7).
 *
 * URL-driven filters (defaults shown when omitted):
 *   - `?status=open|triaged|pr_drafted|pr_merged|dismissed|all`  (default: all)
 *   - `?source_kind=consultant_flag|rif_event|contract_test_failure|reviewer_disposition|all`  (default: all)
 *
 * Same shell as `/projects/page.tsx` and `/users/page.tsx`: AuthGuard
 * wraps the client-rendered list. The list view fetches via TanStack
 * Query against GET /v1/suggestions (B.3); the New Suggestion CTA in
 * the header opens the FlagSuggestionModal which POSTs and routes to
 * the new detail page.
 */
export default function SuggestionsPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const status = parseSuggestionStatusFilter(searchParams.get('status'));
  const sourceKind = parseSuggestionSourceKindFilter(searchParams.get('source_kind'));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Prompt Suggestions</h1>
          <p className="text-muted-foreground max-w-2xl">
            Flagged issues with agent outputs. Reviewers triage each suggestion, optionally generate
            a PR, and the queue tracks the lifecycle through merge.
          </p>
        </div>
        <FlagSuggestionModal>
          <Button>New suggestion</Button>
        </FlagSuggestionModal>
      </header>
      <SuggestionList status={status} sourceKind={sourceKind} />
    </div>
  );
}
