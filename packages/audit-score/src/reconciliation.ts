/**
 * Cross-reference reconciliation engine (Task F.2).
 *
 * Runs six diagnostic queries against a claim's data graph and returns
 * a list of `ReconciliationFinding` items that flag linkage gaps an auditor
 * would scrutinise. The function is stateless and fully unit-testable: supply
 * an injectable `sql_client` mock in tests; omit it in production to use
 * `privilegedSql` from `@cpa/db/client`.
 *
 * === Schema realities that shaped this implementation ===
 *
 * The spec referenced columns that do not exist in the current migrations:
 *
 *   activity        — no `voided_at` column (voiding lives on `expenditure`).
 *                     The spec's `AND a.voided_at IS NULL` filter is omitted;
 *                     all non-deleted activities are included.
 *
 *   expenditure_line — no `activity_id` column (activity linkage is done at
 *                     the `expenditure` level via `claim_id`, not at the line
 *                     level). `cost_no_activity` is therefore adapted to flag
 *                     expenditure_line rows with rd_percent > 0 that belong to
 *                     expenditures whose `claim_id` is null (unlinked to any
 *                     claim/activity context).
 *
 *   time_entry      — no `activity_id`, `hours`, `date`, or
 *                     `expenditure_line_id` columns.  time entries are linked
 *                     to a claim only through `subject_tenant_id` (same subject
 *                     that the claim covers). `time_no_activity` flags time
 *                     entries with no `apportionment_pct` set (they float
 *                     unattached to any activity apportionment decision).
 *
 *   narrative_segment — uses `citing_events uuid[]` (empty array = no source
 *                       citations). No `narrative_segment_source` table exists.
 *                       `narrative_no_evidence` flags segments where the array
 *                       has cardinality 0 (= `citing_events = ARRAY[]::uuid[]`).
 *
 *   timesheet_invoice_mismatch — there is no direct hours/invoice comparison
 *                       possible from the current schema (no `hours` column on
 *                       time_entry, no `category` on expenditure_line). The
 *                       query detects a structurally analogous mismatch:
 *                       time entries that lack `apportionment_pct` while the
 *                       parent expenditure IS linked to a claim (meaning the
 *                       firm has committed to claiming them but the time detail
 *                       is unresolved). Tagged with the `timesheet_invoice_mismatch`
 *                       kind to preserve API contract.
 *
 * Each query embeds its own finding-kind label as a SQL comment (e.g.
 * `-- activity_no_time`) so the test mock can match on it deterministically
 * using a fragment search.
 */

import { privilegedSql } from '@cpa/db/client';
import type { SqlClient } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ReconciliationFinding = {
  kind:
    | 'activity_no_time'
    | 'activity_no_cost'
    | 'cost_no_activity'
    | 'time_no_activity'
    | 'timesheet_invoice_mismatch'
    | 'narrative_no_evidence';
  severity: 'high' | 'medium' | 'low';
  /** activity_id, expenditure_line_id, time_entry_id, or narrative_segment_id */
  affected_id: string;
  detail: string;
  suggested_action: string;
};

export type ReconciliationInput = {
  claim_id: string;
  sql_client?: SqlClient;
};

// ---------------------------------------------------------------------------
// Internal row interfaces
// ---------------------------------------------------------------------------

interface ActivityNoTimeRow {
  id: string;
  code: string;
  title: string;
}

interface ActivityNoCostRow {
  id: string;
  code: string;
  kind: string;
}

interface CostNoActivityRow {
  id: string;
  description: string;
  amount: string;
  rd_percent: number;
}

interface TimeNoActivityRow {
  id: string;
  employee_id: string;
  duration_minutes: number;
  started_at: string;
}

interface TimesheetInvoiceMismatchRow {
  id: string;
  employee_id: string;
  duration_minutes: number;
  started_at: string;
}

interface NarrativeNoEvidenceRow {
  id: string;
  narrative_draft_id: string;
  section_kind: string;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getSql(input: ReconciliationInput): SqlClient {
  if (input.sql_client) {
    return input.sql_client;
  }
  // postgres-js's PendingQuery<T> structurally satisfies SqlClient at runtime.
  // The two-step cast avoids TS's covariance diagnostic on return-type — same
  // pattern as rules.ts getSql().
  return privilegedSql as unknown as SqlClient;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all six reconciliation checks against a single claim and return the
 * combined list of findings. An empty array means the claim is fully linked.
 *
 * Queries run sequentially (not in parallel) to avoid overwhelming a shared
 * DB connection pool and to keep the finding order deterministic for tests.
 */
export async function reconcileClaim(input: ReconciliationInput): Promise<ReconciliationFinding[]> {
  const sql = getSql(input);
  const findings: ReconciliationFinding[] = [];

  // ------------------------------------------------------------------
  // 1. activity_no_time
  //    Activities in the claim that have no time_entry rows referencing
  //    them via the claim's subject_tenant_id linkage.
  //
  //    Schema note: time_entry has no activity_id column. Linkage is
  //    detected by checking if there are ANY time entries recorded for
  //    the claim's subject_tenant. Activities are filtered by claim_id.
  //    If the claim has activities but ZERO time entries for the subject,
  //    each activity is flagged (they all lack time evidence).
  //    This is the closest structural approximation with the current schema.
  // ------------------------------------------------------------------
  const activityNoTimeRows = await sql<ActivityNoTimeRow>`
    -- activity_no_time
    SELECT a.id, a.code, a.title
    FROM activity a
    JOIN claim c ON c.id = a.claim_id
    WHERE a.claim_id = ${input.claim_id}
      AND NOT EXISTS (
        SELECT 1
        FROM time_entry te
        WHERE te.subject_tenant_id = c.subject_tenant_id
          AND te.is_rd = true
      )
  `;

  for (const row of activityNoTimeRows) {
    findings.push({
      kind: 'activity_no_time',
      severity: 'medium',
      affected_id: row.id,
      detail: `Activity ${row.code} "${row.title}" has no associated time entries for this claim's subject.`,
      suggested_action:
        'Add time entries for the subject tenant or link existing entries via payroll integration.',
    });
  }

  // ------------------------------------------------------------------
  // 2. activity_no_cost
  //    Activities with no expenditure_line rows (acceptable for supporting
  //    activities, suspicious for core activities).
  //
  //    Schema note: expenditure_line has no activity_id. We detect missing
  //    cost linkage by checking if there are ANY expenditure rows with
  //    claim_id matching this claim (and non-null rd_percent lines). If the
  //    claim has activities but zero mapped expenditures at all, each
  //    activity may lack cost evidence.
  //    The finer per-activity linkage would require an activity_id FK that
  //    does not yet exist in the schema.
  // ------------------------------------------------------------------
  const activityNoCostRows = await sql<ActivityNoCostRow>`
    -- activity_no_cost
    SELECT a.id, a.code, a.kind
    FROM activity a
    WHERE a.claim_id = ${input.claim_id}
      AND NOT EXISTS (
        SELECT 1
        FROM expenditure e
        JOIN expenditure_line el ON el.expenditure_id = e.id
        WHERE e.claim_id = ${input.claim_id}
          AND el.rd_percent IS NOT NULL
          AND el.rd_percent > 0
      )
  `;

  for (const row of activityNoCostRows) {
    findings.push({
      kind: 'activity_no_cost',
      severity: 'medium',
      affected_id: row.id,
      detail: `Activity ${row.code} (${row.kind}) has no mapped R&D expenditure lines for this claim.`,
      suggested_action:
        'Map expenditure lines with rd_percent > 0 to this claim, or confirm this activity has no direct costs.',
    });
  }

  // ------------------------------------------------------------------
  // 3. cost_no_activity
  //    Expenditure lines with rd_percent > 0 that belong to expenditures
  //    not linked to any claim (claim_id IS NULL), meaning they carry an
  //    R&D apportionment decision but are not attributed to any registered
  //    activity context.
  //
  //    Schema note: expenditure_line has no activity_id. The spec's intent
  //    (R&D expenditure floating without an activity) is mapped to the
  //    nearest structural equivalent: lines with rd_percent > 0 on
  //    expenditures whose claim_id is null (i.e. the expenditure is not
  //    associated with any claim, let alone an activity).
  //    We scope to expenditures for this claim's subject_tenant_id.
  // ------------------------------------------------------------------
  const costNoActivityRows = await sql<CostNoActivityRow>`
    -- cost_no_activity
    SELECT el.id, el.description, el.amount, el.rd_percent
    FROM expenditure_line el
    JOIN expenditure e ON e.id = el.expenditure_id
    JOIN claim c ON c.id = ${input.claim_id}
    WHERE e.subject_tenant_id = c.subject_tenant_id
      AND e.voided_at IS NULL
      AND el.rd_percent IS NOT NULL
      AND el.rd_percent > 0
      AND e.claim_id IS NULL
  `;

  for (const row of costNoActivityRows) {
    findings.push({
      kind: 'cost_no_activity',
      severity: 'high',
      affected_id: row.id,
      detail: `Expenditure line "${row.description}" (${row.rd_percent}% R&D, $${row.amount} AUD) has rd_percent > 0 but is not linked to any claim or activity.`,
      suggested_action:
        'Assign this expenditure to a claim and map it to the relevant activity to ensure it appears in the R&D schedule.',
    });
  }

  // ------------------------------------------------------------------
  // 4. time_no_activity
  //    Time entries with no apportionment decision (apportionment_pct IS NULL)
  //    for the claim's subject, meaning they are unattributed to any activity
  //    apportionment context.
  //
  //    Schema note: time_entry has no activity_id, hours, date, or
  //    expenditure_line_id. The structural equivalent of "time floating
  //    without activity linkage" is apportionment_pct IS NULL (the
  //    consultant has not yet apportioned the entry to any activity).
  // ------------------------------------------------------------------
  const timeNoActivityRows = await sql<TimeNoActivityRow>`
    -- time_no_activity
    SELECT te.id, te.employee_id, te.duration_minutes, te.started_at
    FROM time_entry te
    JOIN claim c ON c.id = ${input.claim_id}
    WHERE te.subject_tenant_id = c.subject_tenant_id
      AND te.apportionment_pct IS NULL
      AND te.is_rd = true
  `;

  for (const row of timeNoActivityRows) {
    findings.push({
      kind: 'time_no_activity',
      severity: 'high',
      affected_id: row.id,
      detail: `Time entry for employee ${row.employee_id} (${row.duration_minutes} min, starting ${row.started_at}) has no apportionment decision and cannot be attributed to any R&D activity.`,
      suggested_action:
        'Apply apportionment to this time entry via the apportionment tool or payroll reconciliation workflow.',
    });
  }

  // ------------------------------------------------------------------
  // 5. timesheet_invoice_mismatch
  //    Time entries that are marked is_rd=true but lack apportionment_pct
  //    while the claim has at least one expenditure with a staff-related
  //    context — indicating a potential mismatch between what was invoiced
  //    and what is evidenced by timesheets.
  //
  //    Schema note: neither time_entry.hours nor expenditure_line.category
  //    exist. The structurally closest mismatch detectable is: time entries
  //    for the claim period that are marked as R&D (is_rd=true) but have
  //    no apportionment_pct, paired with a claim that has at least one
  //    mapped expenditure (suggesting costs were registered but time detail
  //    was not resolved). We emit one finding per unresolved time entry that
  //    coexists with mapped expenditures.
  // ------------------------------------------------------------------
  const timesheetMismatchRows = await sql<TimesheetInvoiceMismatchRow>`
    -- timesheet_invoice_mismatch
    SELECT te.id, te.employee_id, te.duration_minutes, te.started_at
    FROM time_entry te
    JOIN claim c ON c.id = ${input.claim_id}
    WHERE te.subject_tenant_id = c.subject_tenant_id
      AND te.is_rd = true
      AND te.apportionment_pct IS NULL
      AND EXISTS (
        SELECT 1
        FROM expenditure e
        JOIN expenditure_line el ON el.expenditure_id = e.id
        WHERE e.claim_id = ${input.claim_id}
          AND el.rd_percent IS NOT NULL
          AND el.rd_percent > 0
      )
  `;

  for (const row of timesheetMismatchRows) {
    findings.push({
      kind: 'timesheet_invoice_mismatch',
      severity: 'high',
      affected_id: row.id,
      detail: `Time entry for employee ${row.employee_id} (${row.duration_minutes} min, starting ${row.started_at}) is marked R&D but unapportioned while the claim has mapped expenditure lines — potential timesheet/invoice mismatch.`,
      suggested_action:
        'Reconcile this time entry against staff invoices and apply apportionment before claim submission.',
    });
  }

  // ------------------------------------------------------------------
  // 6. narrative_no_evidence
  //    Narrative segments that have an empty `citing_events` array,
  //    meaning no source events are cited to support the narrative text.
  //
  //    Schema note: the `narrative_segment` table uses `citing_events uuid[]`
  //    (set by migration 0037). No `narrative_segment_source` table exists.
  //    A segment with `cardinality(citing_events) = 0` is unfounded.
  // ------------------------------------------------------------------
  const narrativeNoEvidenceRows = await sql<NarrativeNoEvidenceRow>`
    -- narrative_no_evidence
    SELECT ns.id, ns.narrative_draft_id, ns.section_kind
    FROM narrative_segment ns
    JOIN narrative_draft nd ON nd.id = ns.narrative_draft_id
    WHERE nd.activity_id IN (
        SELECT a.id FROM activity a WHERE a.claim_id = ${input.claim_id}
      )
      AND cardinality(ns.citing_events) = 0
  `;

  for (const row of narrativeNoEvidenceRows) {
    findings.push({
      kind: 'narrative_no_evidence',
      severity: 'medium',
      affected_id: row.id,
      detail: `Narrative segment in section "${row.section_kind}" (draft ${row.narrative_draft_id}) has no cited source events.`,
      suggested_action:
        'Link at least one supporting event (hypothesis, experiment, observation) to this narrative segment before finalising the claim narrative.',
    });
  }

  return findings;
}
