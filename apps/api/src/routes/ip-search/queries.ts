/**
 * POST /v1/claims/:id/activities/:aid/ip-search/queries
 *
 * Generates candidate per-database search queries for an R&D hypothesis
 * by calling the ip-search-query agent. Returns the JSON of per-database
 * queries WITHOUT running them — the consultant ticks/edits the list in
 * Wizard Step 2 and then POSTs to /run.
 *
 * Authorization
 * -------------
 * - `requireSession` populates `req.user.tenantId`.
 * - Path params `(claim, activity)` are verified to belong to the
 *   caller's tenant via {@link claimActivityVisible}. 404 on mismatch.
 *
 * Billing
 * -------
 * The agent writes one `llm_token_usage` row scoped to (tenant_id,
 * claim_id). `privilegedSql` cast → TaggedSql is the documented seam
 * (matches `generative-insights.ts`).
 *
 * Response shape mirrors `GeneratedQueries` from the agent so the UI
 * can render the four arrays directly with no further transformation.
 */
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import {
  generateQueries,
  IpSearchQueryConfigError,
  IpSearchQueryParseError,
  IpSearchQueryUpstreamError,
} from '@cpa/agents/ip-search-query';
import type { TaggedSql } from '@cpa/agents';
import { QueriesBody, Uuid, claimActivityVisible, resolveAnthropicClient } from './helpers.js';

export function registerIpSearchQueries(app: FastifyInstance): void {
  app.post<{ Params: { id: string; aid: string } }>(
    '/v1/claims/:id/activities/:aid/ip-search/queries',
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

      const bodyParse = QueriesBody.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be { hypothesisText: string }',
          requestId: req.id,
        });
      }
      const { hypothesisText } = bodyParse.data;

      // Tenant-scope check inside a transaction so the visibility query
      // runs under the same GUC as any future RLS-relevant statement.
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return claimActivityVisible(
          tx as unknown as Parameters<typeof claimActivityVisible>[0],
          claimId,
          activityId,
          tenantId,
        );
      });
      if (!visible) {
        return reply.status(404).send({
          error: 'not_found',
          message: 'claim/activity not found in this firm',
          requestId: req.id,
        });
      }

      try {
        const queries = await generateQueries(hypothesisText, {
          client: resolveAnthropicClient(),
          tenantId,
          claimId,
          sqlFn: privilegedSql as unknown as TaggedSql,
        });
        return await reply.status(200).send({ queries });
      } catch (err) {
        if (err instanceof IpSearchQueryConfigError) {
          return reply.status(400).send({
            error: 'invalid_hypothesis',
            message: err.message,
            requestId: req.id,
          });
        }
        if (err instanceof IpSearchQueryParseError) {
          return reply.status(502).send({
            error: 'agent_parse_error',
            message: 'ip-search-query agent returned malformed output',
            requestId: req.id,
          });
        }
        if (err instanceof IpSearchQueryUpstreamError) {
          return reply.status(502).send({
            error: 'agent_upstream_error',
            message: 'ip-search-query agent upstream failure',
            requestId: req.id,
          });
        }
        throw err;
      }
    },
  );
}
