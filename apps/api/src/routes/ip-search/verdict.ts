/**
 * POST /v1/claims/:id/activities/:aid/ip-search/verdict
 *
 * Body: `{ hypothesisText }`.
 *
 * Loads the most-recent hits across all four databases for this
 * (activity, hypothesis), calls the ip-search-verdict agent, and
 * INSERTs a row into `ip_search_verdict` with `draft_verdict`
 * populated. The consultant subsequently approves or overrides.
 *
 * One-transaction guarantee
 * -------------------------
 * Hits-load → agent call → INSERT all live in one `sql.begin` block
 * so the verdict row is never persisted against a different snapshot
 * of hits than the agent saw. Note that the Anthropic round-trip
 * happens INSIDE the transaction — postgres-js holds the connection
 * for the call duration. We accept the slightly longer tx duration
 * (low single-digit seconds) in exchange for the consistency property,
 * because consultants will only fire one of these at a time per
 * hypothesis. If contention becomes an issue we can detach the agent
 * call and reload the hit hashes for a CHECK constraint on insert.
 *
 * Idempotency
 * -----------
 * `one_verdict_per_hypothesis` UNIQUE (activity_id, hypothesis_text)
 * means a duplicate POST returns 409. The wizard's UI gates the
 * `[Draft verdict]` button on absence of a verdict for the hypothesis,
 * but a race is possible if the consultant clicks twice.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import {
  draftVerdict,
  IpSearchVerdictConfigError,
  IpSearchVerdictParseError,
  IpSearchVerdictUpstreamError,
  type IpSearchHit,
} from '@cpa/agents/ip-search-verdict';
import type { TaggedSql } from '@cpa/agents';
import {
  VerdictBody,
  Uuid,
  hypothesisHash,
  claimActivityVisible,
  resolveAnthropicClient,
  type IpSearchTx,
} from './helpers.js';

export function registerIpSearchVerdict(app: FastifyInstance): void {
  app.post<{ Params: { id: string; aid: string } }>(
    '/v1/claims/:id/activities/:aid/ip-search/verdict',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id: claimId, aid: activityId } = req.params;
      const tenantId = req.user!.tenantId!;

      if (!Uuid.safeParse(claimId).success || !Uuid.safeParse(activityId).success) {
        return reply.status(400).send({
          error: 'invalid_path',
          message: 'claim id and activity id must be uuids',
          requestId: req.id,
        });
      }

      const bodyParse = VerdictBody.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be { hypothesisText: string }',
          requestId: req.id,
        });
      }
      const { hypothesisText } = bodyParse.data;
      const hHash = hypothesisHash(hypothesisText);

      // Visibility check.
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

      // Single-transaction: load hits → call agent → INSERT verdict.
      try {
        const result = await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

          // 1. Load the hits that fall under THIS hypothesis. We dedupe
          //    by external_id (cross-database) so the agent gets one
          //    "view" of each paper/patent even if multiple queries
          //    surfaced it. The DISTINCT ON keeps the highest
          //    relevance_score copy.
          const hitRows = await tx<
            {
              external_id: string;
              title: string;
              abstract: string | null;
              published_at: string | null;
              url: string | null;
              relevance_score: string | null;
              database_name: string;
            }[]
          >`
            SELECT DISTINCT ON (h.external_id)
                   h.external_id,
                   h.title,
                   h.abstract,
                   h.published_at::text AS published_at,
                   h.url,
                   h.relevance_score::text AS relevance_score,
                   r.database_name
              FROM ip_search_hit h
              JOIN ip_search_run r ON r.id = h.search_run_id
             WHERE r.activity_id     = ${activityId}
               AND r.hypothesis_hash = ${hHash}
             ORDER BY h.external_id, h.relevance_score DESC NULLS LAST
          `;

          // Map DB rows → agent input shape. The agent's
          // IpSearchHitForPrompt uses OPTIONAL (`undefined`) for
          // abstract/url/relevanceScore — we drop the field rather
          // than emit nulls so the prompt builder doesn't render
          // "null" literals.
          const hits: IpSearchHit[] = hitRows.map((r) => {
            const hit: IpSearchHit = {
              externalId: r.external_id,
              title: r.title,
              database: r.database_name as IpSearchHit['database'],
            };
            if (r.abstract) hit.abstract = r.abstract;
            if (r.url) hit.url = r.url;
            if (r.relevance_score !== null) hit.relevanceScore = Number(r.relevance_score);
            return hit;
          });

          // 2. Call the agent. Token-usage ledger writes via privilegedSql.
          const drafted = await draftVerdict({
            hypothesis: hypothesisText,
            hits,
            client: resolveAnthropicClient(),
            tenantId,
            claimId,
            sqlFn: privilegedSql as unknown as TaggedSql,
          });

          // 3. INSERT verdict. UNIQUE (activity_id, hypothesis_text)
          //    is enforced — we surface 23505 as a 409 below.
          const inserted = await tx<{ id: string }[]>`
            INSERT INTO ip_search_verdict (
              tenant_id, claim_id, activity_id,
              hypothesis_text, verdict, draft_verdict, analysis_markdown
            ) VALUES (
              ${tenantId}, ${claimId}, ${activityId},
              ${hypothesisText}, ${drafted.verdict}, ${drafted.verdict}, ${drafted.analysisMarkdown}
            )
            RETURNING id::text AS id
          `;
          return {
            id: inserted[0]!.id,
            verdict: drafted.verdict,
            draftVerdict: drafted.verdict,
            analysisMarkdown: drafted.analysisMarkdown,
            hitCount: hits.length,
          };
        });

        return await reply.status(201).send(result);
      } catch (err) {
        if (err instanceof IpSearchVerdictConfigError) {
          return reply.status(400).send({
            error: 'invalid_input',
            message: err.message,
            requestId: req.id,
          });
        }
        if (err instanceof IpSearchVerdictParseError) {
          return reply.status(502).send({
            error: 'agent_parse_error',
            message: 'ip-search-verdict agent returned malformed output',
            requestId: req.id,
          });
        }
        if (err instanceof IpSearchVerdictUpstreamError) {
          return reply.status(502).send({
            error: 'agent_upstream_error',
            message: 'ip-search-verdict agent upstream failure',
            requestId: req.id,
          });
        }
        // postgres-js surfaces unique-violation as { code: '23505' }.
        const e = err as { code?: string; constraint_name?: string };
        if (e.code === '23505' && e.constraint_name === 'one_verdict_per_hypothesis') {
          return reply.status(409).send({
            error: 'verdict_exists',
            message: 'a verdict already exists for this hypothesis',
            requestId: req.id,
          });
        }
        throw err;
      }
    },
  );
}
