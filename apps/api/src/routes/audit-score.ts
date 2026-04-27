import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { privilegedSql } from '@cpa/db/client';
import {
  CLAIMANT_SESSION_COOKIE,
  verifyClaimantSession,
} from './claimant-magic-link.js';

/**
 * Audit-readiness score (T-C13, placeholder).
 *
 * v1 returns a static 78/100 with the 10-rule breakdown the design doc
 * lists. The real scoring engine lands in D1-D4 and will read from an
 * `audit_score_snapshot` table; this route is the stable contract that
 * front-end work can depend on now.
 *
 * TODO D1-D4: replace with real scoring from `audit_score_snapshot`
 * table. The placeholder breakdown matches the rule IDs the engine will
 * emit so the gauge + table layouts don't churn when the data flips
 * to live.
 */

interface AuditScoreResponse {
  total_pts: number;
  max_pts: number;
  rule_breakdown: Array<{
    id: string;
    label: string;
    earned: number;
    max: number;
  }>;
  delta_7d: number;
  computed_at: string;
}

const PLACEHOLDER_RULES: ReadonlyArray<{
  id: string;
  label: string;
  earned: number;
  max: number;
}> = [
  { id: 'has_recent_capture', label: 'Recent evidence', earned: 10, max: 10 },
  { id: 'hypothesis_per_core', label: 'Hypotheses pre-dated', earned: 10, max: 15 },
  { id: 'no_30day_gap', label: 'No 30-day gaps', earned: 10, max: 10 },
  { id: 'every_event_has_artefact', label: 'Evidence linked', earned: 12, max: 15 },
  { id: 'time_tracking_active', label: 'Time tracking', earned: 10, max: 10 },
  { id: 'apportionment_complete', label: 'Apportionment done', earned: 5, max: 10 },
  { id: 'engagement_letter_signed', label: 'Engagement signed', earned: 10, max: 10 },
  { id: 'classifier_avg_confidence', label: 'Classification quality', earned: 6, max: 10 },
  { id: 'override_rate_low', label: 'Low override rate', earned: 3, max: 5 },
  { id: 'evidence_kinds_diverse', label: 'Diverse evidence kinds', earned: 2, max: 5 },
];

const errEnvelope = (
  code: string,
  message: string,
  requestId: string,
): { error: { code: string; message: string }; requestId: string } => ({
  error: { code, message },
  requestId,
});

const sessionSecret = (): string => {
  const v = process.env['SESSION_JWT_SECRET'];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('SESSION_JWT_SECRET unset');
  }
  return v;
};

interface ResolvedClaimantContext {
  tenantId: string;
  subjectTenantId: string;
}

/**
 * Resolve the auth context for a request to /v1/audit-score/:claimant_id.
 *
 * Two paths in:
 *
 *   1. cpa_claimant_session cookie — PWA-side. Audience-checked JWT;
 *      the cookie's subject_tenant_id MUST equal the URL param (404 if
 *      not, mirroring the status route).
 *
 *   2. cpa_session cookie + active tenant — consultant-side. The
 *      consultant must have access to the claimant via the firm's
 *      tenant_id (we verify the subject_tenant row is in their firm
 *      via privilegedSql).
 *
 * Returns null on any auth failure (with the 401/404 already sent on
 * `reply`); returns the resolved context on success.
 */
async function resolveClaimantContext(
  req: FastifyRequest,
  reply: FastifyReply,
  claimantId: string,
): Promise<ResolvedClaimantContext | null> {
  // Path 1: PWA-claimant cookie.
  const claimantCookie = req.cookies[CLAIMANT_SESSION_COOKIE];
  if (typeof claimantCookie === 'string' && claimantCookie.length > 0) {
    try {
      const principal = await verifyClaimantSession(claimantCookie, sessionSecret());
      if (principal.subjectTenantId !== claimantId) {
        await reply
          .status(404)
          .send(errEnvelope('NOT_FOUND', 'Claimant not found', req.id));
        return null;
      }
      return {
        tenantId: principal.tenantId,
        subjectTenantId: principal.subjectTenantId,
      };
    } catch {
      // Fall through; the consultant-side cookie may still be valid.
      // (A request that carries both cookies should resolve via either.)
    }
  }

  // Path 2: consultant session. The session plugin already populated
  // req.user from the cpa_session cookie; we just check it's there
  // and has an active tenant, then verify the claimant is in that firm.
  if (!req.user) {
    await reply
      .status(401)
      .send(errEnvelope('UNAUTHENTICATED', 'No session', req.id));
    return null;
  }
  if (req.user.tenantId === null) {
    await reply
      .status(401)
      .send(errEnvelope('UNAUTHENTICATED', 'No active tenant', req.id));
    return null;
  }

  // Confirm the claimant exists in the consultant's active firm.
  const rows = await privilegedSql<{ id: string }[]>`
    SELECT id FROM subject_tenant
     WHERE id = ${claimantId}
       AND tenant_id = ${req.user.tenantId}
       AND deleted_at IS NULL
  `;
  if (!rows[0]) {
    await reply
      .status(404)
      .send(errEnvelope('NOT_FOUND', 'Claimant not found', req.id));
    return null;
  }
  return {
    tenantId: req.user.tenantId,
    subjectTenantId: claimantId,
  };
}

/**
 * Register GET /v1/audit-score/:claimant_id (T-C13).
 *
 * Returns the placeholder 78/100 score with the 10-rule breakdown.
 * Auth: cpa_claimant_session OR cpa_session (with claimant in active
 * firm). 404 on cross-firm / cross-claimant.
 */
export function registerAuditScore(app: FastifyInstance): void {
  app.get<{ Params: { claimant_id: string } }>(
    '/v1/audit-score/:claimant_id',
    async (req, reply) => {
      const { claimant_id } = req.params;
      const ctx = await resolveClaimantContext(req, reply, claimant_id);
      if (!ctx) return;

      // ctx.tenantId is the resolved firm — D1-D4 will use it as the
      // RLS GUC when SELECTing from audit_score_snapshot. v1 just
      // returns the placeholder, but we resolve the context anyway so
      // the cross-firm 404 path is exercised.
      void ctx;

      const response: AuditScoreResponse = {
        total_pts: PLACEHOLDER_RULES.reduce((sum, r) => sum + r.earned, 0),
        max_pts: PLACEHOLDER_RULES.reduce((sum, r) => sum + r.max, 0),
        rule_breakdown: PLACEHOLDER_RULES.map((r) => ({ ...r })),
        delta_7d: 10,
        computed_at: new Date().toISOString(),
      };

      return reply.status(200).send(response);
    },
  );
}
