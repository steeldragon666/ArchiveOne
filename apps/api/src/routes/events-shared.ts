import type { Classification, Event as ApiEvent } from '@cpa/schemas';

/**
 * Shared types + projection helpers for the events route family.
 *
 * Extracted from the original monolithic events.ts so the sibling route
 * files (events-crud / -override / -extraction / -proposed / -suggestion)
 * share one canonical row shape + toApi mapper. Behaviour is unchanged
 * from the pre-split monolith.
 */

export interface RawEventViewRow {
  id: string;
  tenant_id: string;
  subject_tenant_id: string;
  project_id: string | null;
  milestone_id: string | null;
  kind: string;
  effective_kind: string;
  is_overridden: boolean;
  payload: unknown;
  classification: unknown;
  override_of_event_id: string | null;
  override_new_kind: string | null;
  override_reason: string | null;
  prev_hash: string | null;
  hash: string;
  idempotency_key: string | null;
  captured_at: Date | string;
  captured_by_user_id: string;
  received_at: Date | string;
}

export const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

export const rowToEvent = (r: RawEventViewRow): ApiEvent => ({
  id: r.id,
  tenant_id: r.tenant_id,
  subject_tenant_id: r.subject_tenant_id,
  project_id: r.project_id,
  milestone_id: r.milestone_id,
  // The DB CHECK constraints already restrict kind/effective_kind to the
  // EVIDENCE_KINDS set (migration 0006 + 0007 view). Coerce for the type
  // contract; runtime validation isn't useful since we're reading back rows
  // we just wrote.
  kind: r.kind as ApiEvent['kind'],
  effective_kind: r.effective_kind as ApiEvent['effective_kind'],
  is_overridden: r.is_overridden,
  payload: r.payload,
  classification: r.classification as Classification | null,
  override_of_event_id: r.override_of_event_id,
  override_new_kind: r.override_new_kind as ApiEvent['override_new_kind'],
  override_reason: r.override_reason,
  prev_hash: r.prev_hash,
  hash: r.hash,
  idempotency_key: r.idempotency_key,
  captured_at: isoOf(r.captured_at),
  captured_by_user_id: r.captured_by_user_id,
  received_at: isoOf(r.received_at),
});
