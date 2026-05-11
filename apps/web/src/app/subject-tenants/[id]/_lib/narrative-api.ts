/**
 * Typed fetchers for the narrative-approval workflow (Phase 2 of the
 * AI-extraction flow).
 *
 * The narrative-approval flow lets a consultant approve all AI-extracted
 * activities + invoices for a claimant in one gesture, rather than confirming
 * each proposal individually. After approval, the server auto-creates
 * everything, flagging low-confidence items (< AUTO_CREATE_CONFIDENCE_THRESHOLD,
 * default 0.80) with `needs_review = true` so the consultant can spot-check.
 *
 * Endpoints wrapped:
 *   GET  /v1/subject-tenants/:id/pending-narrative
 *   POST /v1/subject-tenants/:id/approve-narrative
 *   POST /v1/activities/:id/mark-reviewed
 *   POST /v1/expenditures/:id/mark-reviewed
 *
 * The narrative itself is written by an Opus-class model (NOT Haiku) — the
 * narrative is the one AI artefact a consultant reads carefully and approves,
 * so the synthesis quality matters more than per-invocation cost.
 */

import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Shapes — matched to the backend spec. Update these once the backend
// subagent reports back with the actual response types.
// ---------------------------------------------------------------------------

export interface PendingNarrativeActivity {
  event_id: string;
  index: number;
  name: string;
  kind: 'core' | 'supporting';
  hypothesis: string;
  confidence: number;
  source_filename: string;
}

export interface PendingNarrativeInvoice {
  event_id: string;
  index: number;
  vendor: string;
  total_aud: number;
  confidence: number;
  source_filename: string;
}

export interface PendingNarrativeDocument {
  event_id: string;
  filename: string;
  captured_at: string;
}

/**
 * `status: 'none'` — nothing pending. Either no extractions have completed
 * for this claimant, or everything previously extracted has already been
 * approved (via `NARRATIVE_APPROVED` chain event).
 *
 * `status: 'pending'` — there are extractions ready for narrative-level
 * approval. The `narrative` field is the AI-written summary the consultant
 * approves.
 */
export type PendingNarrativeResponse =
  | { status: 'none' }
  | {
      status: 'pending';
      narrative: string;
      total_aud: number;
      core_count: number;
      supporting_count: number;
      invoice_count: number;
      document_count: number;
      documents: PendingNarrativeDocument[];
      activities: PendingNarrativeActivity[];
      invoices: PendingNarrativeInvoice[];
      /**
       * Whether this is the first-ever narrative approval for this claimant.
       * When true, the panel covers ALL extractions ever produced. When false,
       * it covers only docs uploaded since the last NARRATIVE_APPROVED event.
       */
      is_first_approval: boolean;
    };

export interface ApproveNarrativeRequest {
  /**
   * Optional list of proposals to skip during auto-creation. Each entry
   * identifies one proposal by its source event + kind + index. Anything
   * not in this list gets auto-created.
   */
  excluded_proposals?: Array<{
    event_id: string;
    kind: 'activity' | 'invoice';
    index: number;
  }>;
}

export interface ApproveNarrativeResponse {
  activities_created: number;
  invoices_created: number;
  excluded_count: number;
  total_aud: number;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * GET /v1/subject-tenants/:id/pending-narrative
 *
 * Aggregates all unapproved extractions for the claimant, runs the
 * narrative-summarizer agent, and returns the summary + structured
 * proposal lists.
 *
 * Batch scope: if there's no prior NARRATIVE_APPROVED chain event,
 * returns ALL pending extractions (first-time unified view). Otherwise,
 * returns only extractions captured after the most recent approval.
 */
export async function getPendingNarrative(
  subjectTenantId: string,
): Promise<PendingNarrativeResponse> {
  return apiFetch<PendingNarrativeResponse>(
    `/v1/subject-tenants/${subjectTenantId}/pending-narrative`,
    { method: 'GET' },
  );
}

/**
 * POST /v1/subject-tenants/:id/approve-narrative
 *
 * Loops through every pending proposal (minus excluded). Auto-creates
 * activities + expenditures applying confidence-graded review flags:
 *   confidence ≥ AUTO_CREATE_CONFIDENCE_THRESHOLD → needs_review = false
 *   confidence <  threshold                       → needs_review = true
 *
 * Emits one NARRATIVE_APPROVED chain event capturing the approval moment,
 * plus the usual ACTIVITY_CREATED / EXPENDITURE_CREATED / ARTEFACT_LINKED
 * events per proposal so the audit chain is unchanged.
 */
export async function approveNarrative(
  subjectTenantId: string,
  body: ApproveNarrativeRequest = {},
): Promise<ApproveNarrativeResponse> {
  return apiFetch<ApproveNarrativeResponse>(
    `/v1/subject-tenants/${subjectTenantId}/approve-narrative`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/**
 * POST /v1/activities/:id/mark-reviewed
 *
 * Flips `needs_review = false` on an activity that was auto-created with
 * a low confidence score. Emits ACTIVITY_REVIEWED chain event.
 */
export async function markActivityReviewed(
  activityId: string,
): Promise<{ activity_id: string; needs_review: false }> {
  return apiFetch(`/v1/activities/${activityId}/mark-reviewed`, {
    method: 'POST',
    body: '{}',
  });
}

/**
 * POST /v1/expenditures/:id/mark-reviewed
 *
 * Same as `markActivityReviewed`, for expenditure records.
 */
export async function markExpenditureReviewed(
  expenditureId: string,
): Promise<{ expenditure_id: string; needs_review: false }> {
  return apiFetch(`/v1/expenditures/${expenditureId}/mark-reviewed`, {
    method: 'POST',
    body: '{}',
  });
}
