import type { TimeEntry } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

/**
 * API helpers for the time-entry surface exposed to consultants.
 *
 * Backend reference: apps/api/src/routes/time-entries.ts (T-B22)
 *
 * Available consultant endpoints:
 *   GET    /v1/time-entries?subject_tenant_id=...  — list entries for a claimant
 *   PATCH  /v1/time-entries/:id/apportionment      — set R&D % (admin/consultant)
 *   POST   /v1/time-entries/:id/clear-flag         — clear flagged_at
 *
 * NOT available to consultants (mobile-only):
 *   POST   /v1/time-entries   — create manual entry (mobile JWT required)
 *
 * The list endpoint requires `subject_tenant_id` (scopes to a claimant).
 * Optional filters: employee_id, from/to (YYYY-MM-DD), include_flagged.
 */

export interface ListTimeEntriesOptions {
  subject_tenant_id: string;
  employee_id?: string;
  from?: string;
  to?: string;
  include_flagged?: boolean;
}

/** GET /v1/time-entries — list time entries for a claimant. */
export async function listTimeEntries(opts: ListTimeEntriesOptions): Promise<TimeEntry[]> {
  const qs = new URLSearchParams();
  qs.set('subject_tenant_id', opts.subject_tenant_id);
  if (opts.employee_id) qs.set('employee_id', opts.employee_id);
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  if (opts.include_flagged !== undefined) {
    qs.set('include_flagged', String(opts.include_flagged));
  }
  const body = await apiFetch<{ time_entries: TimeEntry[] }>(`/v1/time-entries?${qs.toString()}`);
  return body.time_entries;
}

/** PATCH /v1/time-entries/:id/apportionment — set R&D % (0–100). */
export async function setApportionment(id: string, apportionment_pct: number): Promise<TimeEntry> {
  const body = await apiFetch<{ time_entry: TimeEntry }>(`/v1/time-entries/${id}/apportionment`, {
    method: 'PATCH',
    body: JSON.stringify({ apportionment_pct }),
  });
  return body.time_entry;
}

/** POST /v1/time-entries/:id/clear-flag — clear flagged_at on a time entry. */
export async function clearTimeEntryFlag(id: string): Promise<TimeEntry> {
  const body = await apiFetch<{ time_entry: TimeEntry }>(`/v1/time-entries/${id}/clear-flag`, {
    method: 'POST',
  });
  return body.time_entry;
}
