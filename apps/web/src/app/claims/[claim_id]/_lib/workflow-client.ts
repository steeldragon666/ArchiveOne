/**
 * Typed fetchers for the claim-wizard workflow routes (Tasks 2.2-2.5).
 *
 * Separate from `workflow-api.ts` (auto-allocation + submit-claim pipeline)
 * — this file covers the 5-step wizard stepper endpoints.
 */

import { apiFetch } from '@/lib/api';
import type { WorkflowState } from '@cpa/schemas';

export type CanAdvance = { ok: true } | { ok: false; reason: string };

/**
 * Narrative section_kind enum — mirrors `NARRATIVE_SECTION_KINDS` in
 * `@cpa/db/schema` and the four-section split-pane in Step 4. Keep these
 * strings in lock-step with the server enum; the accept route 400s on
 * anything outside this union.
 */
export type NarrativeSectionKind =
  | 'new_knowledge'
  | 'hypothesis'
  | 'uncertainty'
  | 'experiments_and_results';

/**
 * Per-section narrative status surfaced by `GET /workflow.derived.narrativeSections`.
 * Mirrors `NarrativeSectionStatus` in `apps/api/src/lib/workflow.ts`.
 *
 *   'streaming' — at least one draft is mid-emit; UI shows "drafting…"
 *   'complete'  — at least one draft is ready; UI shows the Agree button
 *   'accepted'  — at least one draft is accepted; UI shows the green tick
 *   'absent'    — no narrative_draft row for this section_kind under the claim
 */
export type NarrativeSectionStatus = 'streaming' | 'complete' | 'accepted' | 'absent';

export type WorkflowResponse = {
  workflow_state: WorkflowState;
  derived: {
    canAdvance: Record<'1' | '2' | '3' | '4' | '5', CanAdvance>;
    narrativeSections: Record<NarrativeSectionKind, NarrativeSectionStatus>;
  };
};

export type AcceptNarrativeSectionResponse = {
  accepted_count: number;
  accepted_at: string | null;
  accepted_by: string;
  activity_ids: string[];
};

export async function getWorkflow(claimId: string): Promise<WorkflowResponse> {
  return apiFetch<WorkflowResponse>(`/v1/claims/${claimId}/workflow`);
}

export async function initializeWorkflow(
  claimId: string,
): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/initialize`, { method: 'POST' });
}

export async function agreeStep(
  claimId: string,
  step: 1 | 2 | 3 | 4 | 5,
): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/step/${step}/agree`, { method: 'POST' });
}

export async function reopenStep(
  claimId: string,
  step: 1 | 2 | 3 | 4 | 5,
): Promise<{ workflow_state: WorkflowState }> {
  return apiFetch(`/v1/claims/${claimId}/workflow/step/${step}/reopen`, { method: 'POST' });
}

/**
 * Flip one narrative `section_kind` to `'accepted'` across every activity
 * under the claim (Step 4 per-section Agree). Idempotent: the route returns
 * `accepted_count: 0` if the section was already accepted by a parallel
 * consultant; the caller treats that as success.
 */
export async function acceptNarrativeSection(
  claimId: string,
  sectionKind: NarrativeSectionKind,
): Promise<AcceptNarrativeSectionResponse> {
  return apiFetch<AcceptNarrativeSectionResponse>(
    `/v1/claims/${claimId}/narrative/sections/${sectionKind}/accept`,
    { method: 'POST' },
  );
}
