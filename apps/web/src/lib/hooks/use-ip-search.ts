'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/**
 * Hook bundle for Wizard Step 2 — IP-search.
 *
 * Six hooks, one per API endpoint:
 *
 *   - useGenerateQueries — POST /v1/claims/:id/activities/:aid/ip-search/queries
 *   - useRunSearches     — POST /v1/claims/:id/activities/:aid/ip-search/run
 *   - useDraftVerdict    — POST /v1/claims/:id/activities/:aid/ip-search/verdict
 *   - useApproveVerdict  — POST /v1/ip-search/verdicts/:id/approve
 *   - useOverrideVerdict — POST /v1/ip-search/verdicts/:id/override
 *   - useClaimVerdicts   — GET  /v1/claims/:id/ip-search/verdicts
 *
 * All mutations invalidate the claim's verdict list on success so the
 * hypothesis cards re-render with the latest state.
 */

// ---------------------------------------------------------------------------
// Shared types — mirror the API contract
// ---------------------------------------------------------------------------

export type IpSearchDatabase = 'ip_australia' | 'semantic_scholar' | 'pubmed' | 'arxiv';

export interface GeneratedQueries {
  ip_australia: string[];
  semantic_scholar: string[];
  pubmed: string[];
  arxiv: string[];
}

export interface IpSearchHit {
  externalId: string;
  title: string;
  abstract: string | null;
  publishedAt: string | null;
  url: string | null;
  relevanceScore: number | null;
}

export interface IpSearchRunResult {
  database: IpSearchDatabase;
  query: string;
  source: 'cache' | 'fresh' | 'error';
  runId: string | null;
  hits: IpSearchHit[];
  error?: { code: string; message: string };
}

export type IpSearchVerdictValue = 'pass' | 'fail' | 'inconclusive';

export interface IpSearchVerdictRow {
  id: string;
  activityId: string;
  hypothesisText: string;
  verdict: IpSearchVerdictValue;
  draftVerdict: IpSearchVerdictValue | null;
  analysisMarkdown: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  status: 'draft' | 'approved';
}

export interface DraftedVerdictResponse {
  id: string;
  verdict: IpSearchVerdictValue;
  draftVerdict: IpSearchVerdictValue;
  analysisMarkdown: string;
  hitCount: number;
}

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

const verdictsKey = (claimId: string): readonly unknown[] =>
  ['ip-search-verdicts', claimId] as const;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

interface GenerateQueriesArgs {
  claimId: string;
  activityId: string;
  hypothesisText: string;
}

export function useGenerateQueries() {
  return useMutation({
    mutationFn: (args: GenerateQueriesArgs) =>
      apiFetch<{ queries: GeneratedQueries }>(
        `/v1/claims/${args.claimId}/activities/${args.activityId}/ip-search/queries`,
        {
          method: 'POST',
          body: JSON.stringify({ hypothesisText: args.hypothesisText }),
        },
      ),
  });
}

interface RunSearchesArgs {
  claimId: string;
  activityId: string;
  hypothesisText: string;
  queries: GeneratedQueries;
}

export function useRunSearches() {
  return useMutation({
    mutationFn: (args: RunSearchesArgs) =>
      apiFetch<{ runs: IpSearchRunResult[] }>(
        `/v1/claims/${args.claimId}/activities/${args.activityId}/ip-search/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            hypothesisText: args.hypothesisText,
            queries: args.queries,
          }),
        },
      ),
  });
}

interface DraftVerdictArgs {
  claimId: string;
  activityId: string;
  hypothesisText: string;
}

export function useDraftVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: DraftVerdictArgs) =>
      apiFetch<DraftedVerdictResponse>(
        `/v1/claims/${args.claimId}/activities/${args.activityId}/ip-search/verdict`,
        {
          method: 'POST',
          body: JSON.stringify({ hypothesisText: args.hypothesisText }),
        },
      ),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: verdictsKey(args.claimId) });
    },
  });
}

interface ApproveVerdictArgs {
  verdictId: string;
  claimId: string;
}

export function useApproveVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: ApproveVerdictArgs) =>
      apiFetch<{ id: string; verdict: IpSearchVerdictValue; approved_at: string }>(
        `/v1/ip-search/verdicts/${args.verdictId}/approve`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: verdictsKey(args.claimId) });
    },
  });
}

interface OverrideVerdictArgs {
  verdictId: string;
  claimId: string;
  verdict: IpSearchVerdictValue;
  reasoningMarkdown: string;
}

export function useOverrideVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: OverrideVerdictArgs) =>
      apiFetch<{
        id: string;
        verdict: IpSearchVerdictValue;
        draft_verdict: IpSearchVerdictValue | null;
        analysis_markdown: string;
        approved_at: string;
      }>(`/v1/ip-search/verdicts/${args.verdictId}/override`, {
        method: 'POST',
        body: JSON.stringify({
          verdict: args.verdict,
          reasoningMarkdown: args.reasoningMarkdown,
        }),
      }),
    onSuccess: (_data, args) => {
      void qc.invalidateQueries({ queryKey: verdictsKey(args.claimId) });
    },
  });
}

export function useClaimVerdicts(claimId: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: verdictsKey(claimId),
    queryFn: () =>
      apiFetch<{ verdicts: IpSearchVerdictRow[] }>(`/v1/claims/${claimId}/ip-search/verdicts`),
    enabled: opts.enabled ?? true,
  });
}
