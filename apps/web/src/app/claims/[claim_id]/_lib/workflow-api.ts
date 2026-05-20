/**
 * Typed fetchers for the R&DTI workflow (auto-allocation + submit-claim).
 *
 * All calls go through the shared `apiFetch` wrapper so auth cookies are
 * forwarded and errors are thrown as typed ApiError instances.
 */

import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Auto-allocation
// ---------------------------------------------------------------------------

export interface AllocationSuggestion {
  unallocated: boolean;
  activity_id: string | null;
  activity_code: string | null;
  confidence: number | null;
  rationale: string;
}

export interface SuggestAllocationResponse {
  event_id: string;
  suggestion: AllocationSuggestion;
}

export interface BatchSuggestion {
  event_id: string;
  suggestion: AllocationSuggestion;
}

export interface BatchSuggestResponse {
  suggestions: BatchSuggestion[];
  total: number;
  suggested: number;
  unallocated: number;
}

export async function suggestAllocation(eventId: string): Promise<SuggestAllocationResponse> {
  return apiFetch<SuggestAllocationResponse>(`/v1/events/${eventId}/suggest-allocation`, {
    method: 'POST',
  });
}

export async function batchAutoAllocate(claimId: string): Promise<BatchSuggestResponse> {
  return apiFetch<BatchSuggestResponse>(`/v1/claims/${claimId}/auto-allocate-batch`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Pending review queue
// ---------------------------------------------------------------------------

export interface PendingEvent {
  id: string;
  kind: string;
  effective_kind: string;
  payload: unknown;
  classification: {
    kind: string;
    confidence: number;
    rationale: string;
    statutory_anchor: string | null;
  } | null;
  suggested_activity_id: string | null;
  suggested_at: string | null;
  suggestion_confidence: number | null;
  suggestion_status: 'pending' | 'confirmed' | 'rejected' | 'edited' | null;
  captured_at: string;
  // Resolved from suggestion
  suggested_activity_code: string | null;
  suggested_activity_title: string | null;
}

export interface PendingReviewResponse {
  events: PendingEvent[];
  total_in_claim: number;
  pending_count: number;
  confirmed_count: number;
  rejected_count: number;
  edited_count: number;
}

export async function listPendingReview(claimId: string): Promise<PendingReviewResponse> {
  return apiFetch<PendingReviewResponse>(`/v1/claims/${claimId}/pending-review`);
}

// ---------------------------------------------------------------------------
// Confirm / Reject suggestion
// ---------------------------------------------------------------------------

export interface ConfirmAllocationBody {
  event_id: string;
}

export interface ConfirmAllocationResponse {
  event_id: string;
  suggestion_status: 'confirmed';
  link_event_id: string;
}

export async function confirmAllocation(
  claimId: string,
  eventId: string,
): Promise<ConfirmAllocationResponse> {
  return apiFetch<ConfirmAllocationResponse>(
    `/v1/claims/${claimId}/events/${eventId}/confirm-allocation`,
    { method: 'POST' },
  );
}

export interface RejectAllocationResponse {
  event_id: string;
  suggestion_status: 'rejected';
}

export async function rejectAllocation(
  claimId: string,
  eventId: string,
  reason?: string,
): Promise<RejectAllocationResponse> {
  return apiFetch<RejectAllocationResponse>(
    `/v1/claims/${claimId}/events/${eventId}/reject-allocation`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}

export interface BatchConfirmResponse {
  confirmed: number;
  failed: number;
}

export async function batchConfirmAllocations(
  claimId: string,
  eventIds: string[],
): Promise<BatchConfirmResponse> {
  return apiFetch<BatchConfirmResponse>(`/v1/claims/${claimId}/batch-confirm-allocations`, {
    method: 'POST',
    body: JSON.stringify({ event_ids: eventIds }),
  });
}

// ---------------------------------------------------------------------------
// Pre-flight check
// ---------------------------------------------------------------------------

export interface PreflightCheckResult {
  ok: boolean;
  issues: string[];
  activity_count: number;
  activities_without_hypothesis: number;
  unlinked_evidence_count: number;
  has_expenditure: boolean;
}

export async function getPreflightCheck(claimId: string): Promise<PreflightCheckResult> {
  return apiFetch<PreflightCheckResult>(`/v1/claims/${claimId}/preflight`);
}

// ---------------------------------------------------------------------------
// Finalise (Submit Claim)
// ---------------------------------------------------------------------------

export interface FinaliseClaimResponse {
  job_id: string;
  claim_id: string;
}

export async function finaliseClaim(claimId: string): Promise<FinaliseClaimResponse> {
  return apiFetch<FinaliseClaimResponse>(`/v1/claims/${claimId}/finalise`, {
    method: 'POST',
  });
}

export interface FinalisationStatus {
  status: 'queued' | 'active' | 'completed' | 'failed';
  progress: {
    activities_drafted: number;
    total_activities: number;
    pdfs_generated: number;
    total_pdfs: number;
  };
  error?: string;
}

export async function getFinalisationStatus(claimId: string): Promise<FinalisationStatus> {
  return apiFetch<FinalisationStatus>(`/v1/claims/${claimId}/finalisation-status`);
}

// ---------------------------------------------------------------------------
// Final draft
// ---------------------------------------------------------------------------

export interface NarrativeDraftSection {
  activity_id: string;
  activity_code: string;
  activity_title: string;
  prose: string;
  generated_at: string;
}

export interface FinalDraftResponse {
  claim_id: string;
  sections: NarrativeDraftSection[];
  pdf_urls: {
    claim_summary?: string;
    apportionment?: string;
    activity_application?: string;
    ingest_summary?: string;
    executive_summary?: string;
    evidence_index?: string;
  };
  locked: boolean;
}

export async function getFinalDraft(claimId: string): Promise<FinalDraftResponse> {
  return apiFetch<FinalDraftResponse>(`/v1/claims/${claimId}/final-draft`);
}
