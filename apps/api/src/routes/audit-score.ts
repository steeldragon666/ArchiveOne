import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { runRecomputeJob } from '../jobs/audit-score-recompute.js';

/**
 * Audit-readiness score endpoint (T-D3).
 *
 * `GET /v1/audit-score/:claimant_id` returns the latest snapshot for the
 * claimant, falling back to an on-demand compute if the cron worker hasn't
 * filled the table yet (cold start).
 *
 * `delta_7d` is wired up in T-D4 — for D3 it's a constant 0 placeholder so
 * the route shape is stable for the PWA dashboard's wire contract.
 *
 * RLS handles cross-firm isolation: the SELECT runs inside an RLS-scoped
 * transaction, so a consultant in Firm A querying claimant X (which lives
 * in Firm B) sees an empty result and gets a 404. Subject_tenant existence
 * is also gated by RLS on the subject_tenant table itself.
 */

interface SnapshotRow {
  total_pts: number;
  max_pts: number;
  rule_breakdown: unknown;
  computed_at: Date | string;
}

const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

export function registerAuditScore(app: FastifyInstance): void {
  app.get<{ Params: { claimant_id: string } }>(
    '/v1/audit-score/:claimant_id',
    { preHandler: requireSession },
    async (req, reply) => {
      const { claimant_id } = req.params;
      const tenantId = req.user!.tenantId!;

      // Step 1: confirm the claimant exists + is visible to this firm.
      // Same shape as routes/events.ts — RLS on subject_tenant covers the
      // cross-firm case, deleted_at IS NULL covers archival.
      const subjectVisible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE id = ${claimant_id} AND deleted_at IS NULL AND kind = 'claimant'
        `;
        return rows[0] != null;
      });
      if (!subjectVisible) {
        return reply.status(404).send({
          error: 'claimant_not_found',
          message: 'No claimant with that id in this firm',
          requestId: req.id,
        });
      }

      // Step 2: fetch the latest snapshot. If absent, trigger an on-demand
      // recompute (uses privilegedSql + writes a fresh row), then re-read.
      let latest = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<SnapshotRow[]>`
          SELECT total_pts, max_pts, rule_breakdown, computed_at
            FROM audit_score_snapshot
           WHERE subject_tenant_id = ${claimant_id}
           ORDER BY computed_at DESC
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!latest) {
        await runRecomputeJob({ tenant_id: tenantId, subject_tenant_id: claimant_id });
        latest = await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          const rows = await tx<SnapshotRow[]>`
            SELECT total_pts, max_pts, rule_breakdown, computed_at
              FROM audit_score_snapshot
             WHERE subject_tenant_id = ${claimant_id}
             ORDER BY computed_at DESC
             LIMIT 1
          `;
          return rows[0] ?? null;
        });
        if (!latest) {
          // Should be unreachable — runRecomputeJob always inserts.
          throw new Error('GET /v1/audit-score/:claimant_id: snapshot missing after recompute');
        }
      }

      // delta_7d is constant 0 here — D4 replaces with a real comparison
      // against the most recent snapshot ≥ 7 days old.
      return {
        total_pts: latest.total_pts,
        max_pts: latest.max_pts,
        rule_breakdown: latest.rule_breakdown,
        delta_7d: 0,
        computed_at: isoOf(latest.computed_at),
      };
    },
  );
}
