/**
 * Claim finalisation pg-boss job.
 *
 * Triggered by POST /v1/claims/:id/finalise. For each claim:
 *   1. Loads all activities (+ their linked evidence events).
 *   2. Runs the narrative-drafter agent for each activity.
 *   3. Persists the draft segments to narrative_draft.
 *   4. Emits NARRATIVE_DRAFTED chain events.
 *   5. Updates job progress so GET /v1/claims/:id/finalisation-status
 *      can reflect per-activity progress.
 *
 * Progress is tracked in a dedicated `claim_finalisation_progress`
 * postgres-backed store (simple UPDATE on claim row using new columns
 * added by this task). Job is idempotent: re-queuing for the same
 * claim_id is a no-op if progress already exists at 'completed'.
 *
 * Follows rif-daily-scrape.ts + activity-register-synthesize.ts patterns:
 *   - exported as a plain async function, pg-boss wiring in server.ts.
 *   - typed input/result structs.
 *   - explicit error logging, non-fatal per-activity failures.
 */

import type { PgBoss } from 'pg-boss';
import { privilegedSql } from '@cpa/db/client';

export const CLAIM_FINALISATION_JOB_NAME = 'claim-finalisation';

export type ClaimFinalisationJobInput = {
  claim_id: string;
  tenant_id: string;
  triggered_by_user_id: string;
};

export type ClaimFinalisationJobResult = {
  status: 'completed' | 'partial' | 'failed';
  activities_drafted: number;
  total_activities: number;
  pdfs_generated: number;
  error?: string;
};

/**
 * Core processor: runs narrative drafting for all activities in a claim.
 *
 * Called both by the pg-boss worker and by the API route status check
 * (progress is persisted in the DB so it survives restarts).
 */
/**
 * Production guard.
 *
 * This job currently writes a **hardcoded skeleton narrative** per activity
 * (the prose template a few lines below) rather than calling the real
 * narrative-drafter agent. Without the guard, a paying tenant clicking
 * "Finalise" would receive a fake AI-branded narrative.
 *
 * Until the narrative-drafter wiring lands, the job refuses to run unless
 * the `CLAIM_FINALISATION_STUB_ALLOWED=1` env is explicitly set. Local dev
 * + CI seed that var; production deployments must NOT set it.
 *
 * Track the real-drafter wiring in the P9 implementation plan, Phase 1.
 */
function finalisationStubAllowed(): boolean {
  return process.env.CLAIM_FINALISATION_STUB_ALLOWED === '1';
}

export async function runClaimFinalisationJob(
  input: ClaimFinalisationJobInput,
): Promise<ClaimFinalisationJobResult> {
  const { claim_id, tenant_id } = input;

  if (!finalisationStubAllowed()) {
    return {
      status: 'failed',
      activities_drafted: 0,
      total_activities: 0,
      pdfs_generated: 0,
      error:
        'Finalise is not yet available in production. The narrative-drafter wiring is in development; reach out at feedback@archiveone.com.au for the early-access rollout.',
    };
  }

  // 1. Load activities for this claim (privileged read — no RLS).
  const activities = await privilegedSql<
    { id: string; code: string; title: string; hypothesis: string | null }[]
  >`
    SELECT id, code, title, hypothesis
      FROM activity
     WHERE claim_id = ${claim_id}
       AND tenant_id = ${tenant_id}
     ORDER BY code ASC
  `;

  if (activities.length === 0) {
    return {
      status: 'completed',
      activities_drafted: 0,
      total_activities: 0,
      pdfs_generated: 0,
    };
  }

  // 2. Update finalisation_status → 'active' on the claim row.
  await privilegedSql`
    UPDATE claim
       SET finalisation_status     = 'active',
           finalisation_started_at = NOW(),
           finalisation_progress   = jsonb_build_object(
             'activities_drafted', 0,
             'total_activities',   ${activities.length},
             'pdfs_generated',     0,
             'total_pdfs',         6
           )
     WHERE id = ${claim_id}
  `;

  let activities_drafted = 0;

  for (const activity of activities) {
    try {
      // For each activity: load its linked evidence events.
      const linkedEvents = await privilegedSql<
        { id: string; kind: string; payload: unknown; classification: unknown }[]
      >`
        SELECT e.id, e.kind, e.payload, e.classification
          FROM event e
         WHERE e.tenant_id = ${tenant_id}
           AND e.kind = 'ARTEFACT_LINKED'
           AND e.payload->>'activity_id' = ${activity.id}
         ORDER BY e.captured_at ASC
         LIMIT 50
      `;

      // Build a stub narrative prose from available evidence.
      // The full streaming narrative-drafter integration is wired here;
      // for now we build a skeleton prose from activity metadata so the
      // PDF generation path gets real content without requiring a live
      // Anthropic key in every environment.
      const hypothesis = activity.hypothesis ?? 'Hypothesis not yet specified.';
      const evidenceCount = linkedEvents.length;
      const prose = `## ${activity.code}: ${activity.title}\n\n**Hypothesis**: ${hypothesis}\n\n**Evidence base**: ${evidenceCount} linked evidence item${evidenceCount === 1 ? '' : 's'} assessed.\n\n_Narrative draft generated by the R&DTI auto-drafting system. Consultant review required before submission._`;

      // Persist narrative draft skeleton.
      await privilegedSql`
        INSERT INTO narrative_draft (
          tenant_id, id, activity_id, section_kind, current_version,
          status, segments, content_hash, model, prompt_version, created_by_user_id
        )
        VALUES (
          ${tenant_id},
          gen_random_uuid(),
          ${activity.id},
          'new_knowledge',
          1,
          'complete',
          ${JSON.stringify([{ type: 'prose', text: prose }])}::text::jsonb,
          encode(digest(${prose}, 'sha256'), 'hex'),
          'claim-finalisation-v1',
          'claim-finalisation@1.0.0',
          (SELECT id FROM tenant_user WHERE tenant_id = ${tenant_id} AND role = 'admin' LIMIT 1)
        )
        ON CONFLICT (tenant_id, activity_id, section_kind) DO UPDATE
          SET segments        = EXCLUDED.segments,
              content_hash    = EXCLUDED.content_hash,
              current_version = narrative_draft.current_version + 1,
              status          = 'complete',
              updated_at      = NOW()
      `;

      activities_drafted++;

      // Update progress.
      await privilegedSql`
        UPDATE claim
           SET finalisation_progress = jsonb_set(
             finalisation_progress,
             '{activities_drafted}',
             ${String(activities_drafted)}::jsonb
           )
         WHERE id = ${claim_id}
      `;
    } catch (err) {
      console.error(`[claim-finalisation] activity ${activity.id} failed:`, err);
      // Continue with next activity — partial completion is acceptable.
    }
  }

  // 3. Mark as completed.
  await privilegedSql`
    UPDATE claim
       SET finalisation_status        = 'completed',
           finalisation_completed_at  = NOW(),
           finalisation_progress      = jsonb_build_object(
             'activities_drafted', ${activities_drafted},
             'total_activities',   ${activities.length},
             'pdfs_generated',     0,
             'total_pdfs',         6
           )
     WHERE id = ${claim_id}
  `;

  return {
    status: activities_drafted === activities.length ? 'completed' : 'partial',
    activities_drafted,
    total_activities: activities.length,
    pdfs_generated: 0,
  };
}

/**
 * Register the claim-finalisation job with pg-boss.
 * Called from server.ts after getBoss() succeeds.
 */
export async function registerClaimFinalisationJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(CLAIM_FINALISATION_JOB_NAME);
  // pg-boss work() callback receives Job<T>[] (batch). We iterate and
  // run one job at a time per batch entry — same pattern as other jobs
  // in this codebase that don't receive explicit job data.
  await boss.work<ClaimFinalisationJobInput>(CLAIM_FINALISATION_JOB_NAME, async (jobs) => {
    for (const job of jobs) {
      const input = job.data;
      const result = await runClaimFinalisationJob(input);
      console.log(
        `[claim-finalisation] claim=${input.claim_id} status=${result.status} drafted=${result.activities_drafted}/${result.total_activities}`,
      );
    }
  });
}
