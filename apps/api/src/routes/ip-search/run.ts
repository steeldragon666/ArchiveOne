/**
 * POST /v1/claims/:id/activities/:aid/ip-search/run
 *
 * Body: `{ hypothesisText, queries: { ip_australia, semantic_scholar,
 * pubmed, arxiv } }`.
 *
 * For each (database, query) pair:
 *   1. Hash the hypothesis (sha256 hex).
 *   2. Look up the most-recent `ip_search_run` row within 30 days for
 *      `(hypothesis_hash, database_name, query)`. If found → reuse its
 *      hits (RLS still scopes to this firm).
 *   3. Otherwise call the integration package, persist a new run row
 *      + per-hit rows, return them.
 *
 * Returns `{ runs: Array<{ database, query, source: 'cache'|'fresh', runId, hits }> }`.
 *
 * Cache contract
 * --------------
 * `ip_search_run_cache_idx` is on `(hypothesis_hash, database_name,
 * query, ran_at DESC)`. The 30-day window is the analyst-reviewed
 * verdict (per design doc Q6). RLS still applies to the lookup: a hit
 * in tenant A's history can NEVER be returned to tenant B because
 * `ip_search_run.tenant_id = current_setting('app.current_tenant_id')`
 * is part of the row-level policy.
 *
 * Error model
 * -----------
 * One failing integration does NOT abort the rest. Each query is
 * isolated; failures surface as `{ source: 'error', error: { code,
 * message } }` entries so the consultant can re-tick + retry that
 * specific cell without losing the successful ones.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { searchIpAustralia, IpAustraliaError } from '@cpa/integrations/ip-australia';
import { searchSemanticScholar, SemanticScholarError } from '@cpa/integrations/semantic-scholar';
import { searchPubMed, PubMedError } from '@cpa/integrations/pubmed';
import { searchArxiv, ArxivError } from '@cpa/integrations/arxiv';
import {
  RunBody,
  Uuid,
  hypothesisHash,
  claimActivityVisible,
  IP_SEARCH_DATABASE_NAMES,
  type IpSearchDatabaseName,
  type IpSearchTx,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test seam — allow tests to short-circuit the per-database integration.
// ---------------------------------------------------------------------------

/**
 * Per-database call function. The default implementation hits the real
 * integration package. Tests inject a mock via
 * {@link _setIntegrationCallerForTests} so they can drive cache + run
 * paths without nock'ing four upstream APIs.
 */
type IntegrationCaller = (
  database: IpSearchDatabaseName,
  query: string,
) => Promise<{ hits: NormalisedHit[]; rawResponse: unknown }>;

let _injectedCaller: IntegrationCaller | null = null;

/** Test-only seam — production code MUST NOT call this. */
export function _setIntegrationCallerForTests(fn: IntegrationCaller | null): void {
  _injectedCaller = fn;
}

// ---------------------------------------------------------------------------
// Normalised hit shape (subset shared by all four integrations)
// ---------------------------------------------------------------------------

interface NormalisedHit {
  externalId: string;
  title: string;
  abstract: string | null;
  publishedAt: string | null;
  url: string | null;
  relevanceScore: number | null;
}

interface RunResult {
  database: IpSearchDatabaseName;
  query: string;
  source: 'cache' | 'fresh' | 'error';
  runId: string | null;
  hits: NormalisedHit[];
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Per-integration dispatcher
// ---------------------------------------------------------------------------

/**
 * Call the per-database integration. The four packages return
 * structurally similar shapes; we re-key into the uniform
 * NormalisedHit. Each branch wraps its own typed error class so the
 * caller can flag a `source: 'error'` row.
 *
 * Auth tokens come from env at this layer for the IP-Australia call
 * (the only one that needs OAuth). The other three are public; rate
 * limits apply but no token. PubMed accepts an optional `NCBI_API_KEY`
 * which we pass through if set — without it, the integration falls
 * back to anonymous NCBI rate limits.
 */
async function callIntegration(
  database: IpSearchDatabaseName,
  query: string,
): Promise<{ hits: NormalisedHit[]; rawResponse: unknown }> {
  switch (database) {
    case 'ip_australia': {
      const bearerToken = process.env.IP_AUSTRALIA_BEARER_TOKEN;
      const raw = await searchIpAustralia(query, bearerToken ? { bearerToken } : {});
      return {
        hits: raw.map((r) => ({
          externalId: r.externalId,
          title: r.title,
          abstract: r.abstract.length === 0 ? null : r.abstract,
          publishedAt: r.publishedAt,
          url: r.url,
          relevanceScore: r.relevanceScore ?? null,
        })),
        rawResponse: { results: raw },
      };
    }
    case 'semantic_scholar': {
      const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
      const raw = await searchSemanticScholar(query, apiKey ? { apiKey } : {});
      return {
        hits: raw.map((r) => ({
          externalId: r.externalId,
          title: r.title,
          abstract: r.abstract,
          publishedAt: r.publishedAt,
          url: r.url,
          relevanceScore: r.relevanceScore ?? null,
        })),
        rawResponse: { results: raw },
      };
    }
    case 'pubmed': {
      const apiKey = process.env.NCBI_API_KEY;
      const raw = await searchPubMed(query, apiKey ? { apiKey } : {});
      return {
        hits: raw.map((r) => ({
          externalId: r.externalId,
          title: r.title,
          abstract: r.abstract ?? null,
          publishedAt: r.publishedAt,
          url: r.url,
          relevanceScore: r.relevanceScore ?? null,
        })),
        rawResponse: { results: raw },
      };
    }
    case 'arxiv': {
      const raw = await searchArxiv(query);
      return {
        hits: raw.map((r) => ({
          externalId: r.externalId,
          title: r.title,
          abstract: r.abstract ?? null,
          publishedAt: r.publishedAt,
          url: r.url,
          relevanceScore: r.relevanceScore ?? null,
        })),
        rawResponse: { results: raw },
      };
    }
  }
}

/**
 * Translate a typed integration error into a stable `{ code, message }`
 * pair we surface back to the wizard. We do not leak `cause` or `body`
 * — the wizard only needs to know which class of failure happened.
 */
function classifyIntegrationError(err: unknown): { code: string; message: string } | null {
  if (err instanceof IpAustraliaError) {
    return { code: `ip_australia.${err.code}`, message: err.message };
  }
  if (err instanceof SemanticScholarError) {
    return { code: `semantic_scholar.${err.kind}`, message: err.message };
  }
  if (err instanceof PubMedError) {
    return { code: `pubmed.${err.code}`, message: err.message };
  }
  if (err instanceof ArxivError) {
    return { code: `arxiv.${err.code}`, message: err.message };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cache lookup
// ---------------------------------------------------------------------------

interface CachedRunRow {
  id: string;
  result_count: number;
}

interface HitRow {
  id: string;
  external_id: string;
  title: string;
  abstract: string | null;
  published_at: string | null;
  url: string | null;
  relevance_score: string | null;
}

async function lookupCacheHits(
  tx: IpSearchTx,
  params: { hypothesisHash: string; database: IpSearchDatabaseName; query: string },
): Promise<{ runId: string; hits: NormalisedHit[] } | null> {
  const runs = await tx<CachedRunRow[]>`
    SELECT id::text AS id, result_count
      FROM ip_search_run
     WHERE hypothesis_hash = ${params.hypothesisHash}
       AND database_name   = ${params.database}
       AND query           = ${params.query}
       AND ran_at          > now() - interval '30 days'
     ORDER BY ran_at DESC
     LIMIT 1
  `;
  const run = runs[0];
  if (!run) return null;

  const hitRows = await tx<HitRow[]>`
    SELECT id::text AS id,
           external_id,
           title,
           abstract,
           published_at::text AS published_at,
           url,
           relevance_score::text AS relevance_score
      FROM ip_search_hit
     WHERE search_run_id = ${run.id}
     ORDER BY relevance_score DESC NULLS LAST, title ASC
  `;

  return {
    runId: run.id,
    hits: hitRows.map((r) => ({
      externalId: r.external_id,
      title: r.title,
      abstract: r.abstract,
      publishedAt: r.published_at,
      url: r.url,
      relevanceScore: r.relevance_score === null ? null : Number(r.relevance_score),
    })),
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function registerIpSearchRun(app: FastifyInstance): void {
  app.post<{ Params: { id: string; aid: string } }>(
    '/v1/claims/:id/activities/:aid/ip-search/run',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id: claimId, aid: activityId } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      if (!Uuid.safeParse(claimId).success || !Uuid.safeParse(activityId).success) {
        return reply.status(400).send({
          error: 'invalid_path',
          message: 'claim id and activity id must be uuids',
          requestId: req.id,
        });
      }

      const bodyParse = RunBody.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message:
            'Body must match { hypothesisText, queries: { ip_australia, semantic_scholar, pubmed, arxiv } }',
          requestId: req.id,
        });
      }
      const { hypothesisText, queries } = bodyParse.data;
      const hHash = hypothesisHash(hypothesisText);

      // Visibility check upfront in its own short transaction. We do
      // NOT hold a single big transaction open across all the external
      // HTTP calls — those can take seconds each.
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return claimActivityVisible(tx as unknown as IpSearchTx, claimId, activityId, tenantId);
      });
      if (!visible) {
        return reply.status(404).send({
          error: 'not_found',
          message: 'claim/activity not found in this firm',
          requestId: req.id,
        });
      }

      // Flatten (database, query) pairs and process each independently.
      // One failure does NOT abort the rest — we want the consultant to
      // see whatever did succeed.
      const pairs: Array<{ database: IpSearchDatabaseName; query: string }> = [];
      for (const database of IP_SEARCH_DATABASE_NAMES) {
        for (const q of queries[database]) {
          pairs.push({ database, query: q });
        }
      }

      const results: RunResult[] = [];
      for (const { database, query } of pairs) {
        // Step 1 — cache lookup. Short transaction so the GUC is set
        // before the SELECT runs against the RLS-policy'd table.
        try {
          const cached = await sql.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            return lookupCacheHits(tx as unknown as IpSearchTx, {
              hypothesisHash: hHash,
              database,
              query,
            });
          });
          if (cached) {
            results.push({
              database,
              query,
              source: 'cache',
              runId: cached.runId,
              hits: cached.hits,
            });
            continue;
          }
        } catch (err) {
          req.log.error({ err, database, query }, 'ip-search cache lookup failed');
          // Fall through to a fresh call — a cache failure should not
          // strand a query the consultant wants to run.
        }

        // Step 2 — call the integration (or its test stub).
        let fresh: { hits: NormalisedHit[]; rawResponse: unknown };
        try {
          fresh = _injectedCaller
            ? await _injectedCaller(database, query)
            : await callIntegration(database, query);
        } catch (err) {
          const classified = classifyIntegrationError(err);
          if (classified) {
            results.push({
              database,
              query,
              source: 'error',
              runId: null,
              hits: [],
              error: classified,
            });
            continue;
          }
          // Genuinely unexpected — propagate so the route returns 500.
          throw err;
        }

        // Step 3 — persist run + hits in one transaction. We
        // pre-serialise the integration's raw response and bind it
        // through postgres-js's text-with-`::jsonb`-cast path. The
        // alternative `sql.json(payload)` helper requires the SAME
        // tagged binding the value is interpolated under — it cannot
        // be invoked on the top-level `sql` and then passed into a
        // `tx\`\`` template (postgres-js's helper objects are tied to
        // their producer's binary protocol context).
        const rawResponseText = JSON.stringify(fresh.rawResponse);
        const runId: string = await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const inserted = await tx<{ id: string }[]>`
            INSERT INTO ip_search_run (
              tenant_id, claim_id, activity_id,
              hypothesis_text, hypothesis_hash, database_name, query, query_source,
              raw_response, result_count, ran_by_user_id
            ) VALUES (
              ${tenantId}, ${claimId}, ${activityId},
              ${hypothesisText}, ${hHash}, ${database}, ${query}, 'llm',
              ${rawResponseText}::jsonb, ${fresh.hits.length}, ${userId}
            )
            RETURNING id::text AS id
          `;
          const newRunId = inserted[0]!.id;
          // Per-hit inserts inside a loop. Hit counts top out at ~20
          // per query (PubMed/arXiv default page sizes), so this is
          // bounded and the simpler shape avoids hand-rolling a
          // postgres-js bulk-insert helper for one call site.
          for (const h of fresh.hits) {
            await tx`
              INSERT INTO ip_search_hit (
                search_run_id, external_id, title, abstract,
                published_at, relevance_score, url
              ) VALUES (
                ${newRunId}, ${h.externalId}, ${h.title}, ${h.abstract},
                ${h.publishedAt}, ${h.relevanceScore}, ${h.url}
              )
            `;
          }
          return newRunId;
        });

        results.push({ database, query, source: 'fresh', runId, hits: fresh.hits });
      }

      return reply.status(200).send({ runs: results });
    },
  );
}
