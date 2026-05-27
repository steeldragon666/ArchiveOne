/**
 * Shared helpers for the wizard-step-2 IP-search routes.
 *
 * Pulled out into a sibling module so each route file stays focused on
 * its single HTTP handler. Nothing here is part of the public API
 * surface — these symbols only travel inside `routes/ip-search/`.
 */
import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Uuid } from '@cpa/schemas';
import { IP_SEARCH_DATABASE_NAMES, IP_SEARCH_VERDICTS } from '@cpa/db/schema';
import { getAnthropicClient } from '@cpa/agents/runtime';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Body for POST /v1/.../ip-search/queries.
 * The endpoint only needs the hypothesis text; everything else is
 * derived from the URL path or the session.
 */
export const QueriesBody = z
  .object({
    hypothesisText: z.string().min(4).max(8000),
  })
  .strict();

/**
 * Body for POST /v1/.../ip-search/run.
 *
 * `queries` is the (consultant-edited, possibly partially-ticked)
 * per-database query bundle returned by the queries endpoint. Each
 * array may be empty (consultant unticked everything in that DB).
 *
 * `hypothesisText` is re-supplied so we can compute the cache hash
 * without round-tripping back to /queries.
 */
export const RunBody = z
  .object({
    hypothesisText: z.string().min(4).max(8000),
    queries: z
      .object({
        ip_australia: z.array(z.string().min(1)).max(20),
        semantic_scholar: z.array(z.string().min(1)).max(20),
        pubmed: z.array(z.string().min(1)).max(20),
        arxiv: z.array(z.string().min(1)).max(20),
      })
      .strict(),
  })
  .strict();

/**
 * Body for POST /v1/.../ip-search/verdict.
 */
export const VerdictBody = z
  .object({
    hypothesisText: z.string().min(4).max(8000),
  })
  .strict();

/**
 * Body for POST /v1/ip-search/verdicts/:id/override.
 *
 * Override REQUIRES reasoning — the UI surfaces this as a modal that
 * disables submit until reasoningMarkdown is non-empty. The 30-char
 * floor is a guard against accidental "ok" / "fine" overrides; the
 * 8000 ceiling matches the LLM draft envelope.
 */
export const OverrideBody = z
  .object({
    verdict: z.enum(IP_SEARCH_VERDICTS),
    reasoningMarkdown: z.string().min(30).max(8000),
  })
  .strict();

/** Re-export for routes that need to validate the path UUIDs. */
export { Uuid };

// ---------------------------------------------------------------------------
// Anthropic-client test seam
// ---------------------------------------------------------------------------

/**
 * Pluggable accessor for the Anthropic SDK client used by the
 * ip-search-query and ip-search-verdict agents. Default behaviour
 * delegates to {@link getAnthropicClient} — i.e. production uses the
 * env-driven lazy singleton.
 *
 * Tests call {@link _setIpSearchAnthropicClientForTests} to inject a
 * mock with a `messages.create` method that returns a canned
 * tool_use response. Same pattern Agent C uses with
 * `_setStreamingClientForTests`.
 */
type AnthropicLike = Pick<Anthropic, 'messages'>;
let _injectedClient: AnthropicLike | null = null;

export function resolveAnthropicClient(): AnthropicLike {
  return _injectedClient ?? getAnthropicClient();
}

/** Test-only seam — production code MUST NOT call this. */
export function _setIpSearchAnthropicClientForTests(client: AnthropicLike | null): void {
  _injectedClient = client;
}

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

/**
 * Hex-sha256(hypothesisText). Same hash function the cache index
 * `ip_search_run_cache_idx` was built around (see 0086_ip_search.sql).
 * Trims trailing whitespace BUT preserves internal structure — two
 * hypotheses that differ only in trailing newlines hash the same; two
 * that differ by a single internal character do not.
 */
export function hypothesisHash(hypothesisText: string): string {
  return crypto.createHash('sha256').update(hypothesisText.trim()).digest('hex');
}

// ---------------------------------------------------------------------------
// Database name list — re-exported so route files can type their dispatch
// ---------------------------------------------------------------------------

export { IP_SEARCH_DATABASE_NAMES };
export type IpSearchDatabaseName = (typeof IP_SEARCH_DATABASE_NAMES)[number];

// ---------------------------------------------------------------------------
// 404 helper — confirm (claim, activity) belong to caller's tenant
// ---------------------------------------------------------------------------

/**
 * Structural type for a `postgres`-js transaction handle. Inlined to
 * avoid adding `postgres` as a direct dep of `@cpa/api` (see
 * `lib/workflow.ts` for the original copy of this type). Covers the
 * tagged-template invocation shape — the only thing helpers below
 * actually need.
 */
export type IpSearchTx = <T>(
  strings: TemplateStringsArray,
  ...args: unknown[]
) => Promise<T> & PromiseLike<T>;

/**
 * Confirm the path-param (claim, activity) tuple is visible to the
 * caller's tenant. Returns true on hit. The caller MUST send a 404 on
 * false so internal tenant ids do not leak via timing/error signals.
 *
 * Takes the open transaction so RLS GUC + this lookup happen in the
 * same scope.
 */
export async function claimActivityVisible(
  tx: IpSearchTx,
  claimId: string,
  activityId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await tx<{ id: string; tenant_id: string }[]>`
    SELECT a.id::text AS id, c.tenant_id::text AS tenant_id
      FROM activity a
      JOIN claim c ON c.id = a.claim_id
     WHERE a.id        = ${activityId}
       AND a.claim_id  = ${claimId}
       AND c.tenant_id = ${tenantId}
  `;
  return rows.length > 0;
}
