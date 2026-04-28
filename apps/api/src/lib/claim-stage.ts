import { CLAIM_STAGES_LITERAL, type ClaimStage } from '@cpa/schemas';

export type Role = 'admin' | 'consultant' | 'viewer';

export type StageTransition =
  | { ok: true; from: ClaimStage; to: ClaimStage; direction: 'forward' | 'backward' }
  | {
      ok: false;
      reason: 'invalid_target' | 'cannot_revert_from_submitted' | 'role_required' | 'no_op';
    };

/**
 * Validate a claim-stage transition request.
 *
 * - Forward transitions are allowed for any role (admin / consultant / viewer
 *   — viewer typically can't write at the route layer, but the validator is
 *   shape-only; the route's authz middleware enforces write permission).
 * - Backward transitions are admin-only (consultants can't revert).
 * - The `submitted` stage is terminal — no role can revert FROM `submitted`
 *   (regulatory: once an R&DTI application is lodged with AusIndustry, it
 *   stays lodged; corrections happen via the audit_defence stage).
 * - No-op transitions (from === to) return `ok: false, reason: 'no_op'`.
 * - Unknown stage strings return `ok: false, reason: 'invalid_target'`.
 *
 * The 7-stage canonical sequence: engagement → activity_capture →
 * narrative_drafting → expenditure_schedule → review → submitted →
 * audit_defence.
 *
 * The helper does NOT enforce that consecutive stages must be adjacent —
 * skipping forward (e.g., engagement → review) is allowed because
 * consultants sometimes set up a claim mid-pipeline.
 */
export function validateStageTransition(args: {
  from: ClaimStage;
  to: ClaimStage;
  role: Role;
}): StageTransition {
  const fromIdx = CLAIM_STAGES_LITERAL.indexOf(args.from);
  const toIdx = CLAIM_STAGES_LITERAL.indexOf(args.to);
  if (toIdx === -1 || fromIdx === -1) {
    return { ok: false, reason: 'invalid_target' };
  }
  if (toIdx === fromIdx) {
    return { ok: false, reason: 'no_op' };
  }
  if (args.from === 'submitted' && toIdx < fromIdx) {
    return { ok: false, reason: 'cannot_revert_from_submitted' };
  }
  const direction = toIdx > fromIdx ? 'forward' : 'backward';
  if (direction === 'backward' && args.role !== 'admin') {
    return { ok: false, reason: 'role_required' };
  }
  return { ok: true, from: args.from, to: args.to, direction };
}
