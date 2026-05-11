/**
 * Typed fetchers for the document extraction + proposal acceptance API.
 *
 * These wrap the four new API routes added for the document-extraction feature:
 *   GET  /v1/events/:id/extraction
 *   POST /v1/events/:id/extract-content
 *   POST /v1/proposed-activities/:event_id/accept
 *   POST /v1/proposed-invoices/:event_id/accept
 */

import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposedActivityExtract {
  proposed_name: string;
  proposed_kind: 'core' | 'supporting';
  hypothesis_text: string;
  technical_uncertainty: string;
  expected_outcome: string;
  confidence: number;
  rationale: string;
  source_excerpt: string;
}

export interface ProposedInvoiceLineItem {
  description: string;
  amount_aud: number;
}

export interface ProposedInvoiceExtract {
  vendor_name: string;
  invoice_date: string;
  amount_aud: number;
  gst_aud: number | null;
  total_aud: number;
  invoice_number: string | null;
  line_items: ProposedInvoiceLineItem[];
  confidence: number;
  source_excerpt: string;
}

export interface DocumentExtractionResult {
  activities: ProposedActivityExtract[];
  invoices: ProposedInvoiceExtract[];
  document_summary: string;
}

export type ExtractionStatus = 'not_started' | 'pending' | 'complete' | 'failed';

export interface ExtractionResponse {
  status: ExtractionStatus;
  result: DocumentExtractionResult | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

/**
 * GET /v1/events/:id/extraction
 *
 * Returns the extraction result if complete, or the current status.
 */
export async function getExtraction(eventId: string): Promise<ExtractionResponse> {
  return apiFetch<ExtractionResponse>(`/v1/events/${eventId}/extraction`, {
    method: 'GET',
  });
}

/**
 * POST /v1/events/:id/extract-content
 *
 * Manually triggers (or re-triggers) extraction for one event.
 * Returns { queued: true } on success.
 */
export async function triggerExtraction(eventId: string): Promise<{ queued: boolean }> {
  return apiFetch<{ queued: boolean }>(`/v1/events/${eventId}/extract-content`, {
    method: 'POST',
    body: '{}',
  });
}

/**
 * POST /v1/proposed-activities/:event_id/accept
 *
 * Accepts one activity proposal. Creates an activity row and emits chain events.
 * Returns the created activity's id, code, and title.
 */
export async function acceptProposedActivity(
  eventId: string,
  activityIndex: number,
): Promise<{
  activity_id: string;
  code: string;
  kind: 'core' | 'supporting';
  title: string;
  claim_id: string;
  created_at: string;
}> {
  return apiFetch(`/v1/proposed-activities/${eventId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ activity_index: activityIndex }),
  });
}

/**
 * POST /v1/proposed-invoices/:event_id/accept
 *
 * Accepts one invoice proposal. Creates an expenditure row and emits chain events.
 * Returns the created expenditure's id and summary.
 */
export async function acceptProposedInvoice(
  eventId: string,
  invoiceIndex: number,
): Promise<{
  expenditure_id: string;
  vendor_name: string;
  total_aud: number;
  claim_id: string;
}> {
  return apiFetch(`/v1/proposed-invoices/${eventId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ invoice_index: invoiceIndex }),
  });
}
