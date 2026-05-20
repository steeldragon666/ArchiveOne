-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: adds narrative-approval workflow columns to the
-- activity and expenditure tables, and extends the event_kind_valid CHECK
-- constraint with three new B+C flow kinds.
--
-- New columns on `activity`:
--   needs_review            — true when auto-created below the confidence
--                             threshold; the UI shows a 🤖 chip on these rows
--                             until a consultant calls POST /v1/activities/:id/mark-reviewed.
--   proposal_confidence     — the document-analyzer confidence score (0..1)
--                             that was used when the activity was auto-created
--                             via approve-narrative.
--   proposed_from_event_id  — back-link to the event (document upload) from
--                             which this activity's proposal was extracted.
--
-- Same three columns on `expenditure`:
--   needs_review, proposal_confidence, proposed_from_event_id
--
-- New index: fast lookup of "activities needing review" per claim.
--
-- New event kinds admitted by this migration:
--   NARRATIVE_APPROVED   — emitted once when the user clicks "Approve & auto-create"
--   ACTIVITY_REVIEWED    — emitted when a consultant clears the needs_review flag
--   EXPENDITURE_REVIEWED — emitted when a consultant clears the needs_review flag
--
-- APPEND-ONLY contract: activity.needs_review is a mutable workflow column
-- (same category as event.extraction_status in 0078). The hash chain carries
-- ACTIVITY_REVIEWED events instead; the column is soft state.

ALTER TABLE activity
  ADD COLUMN IF NOT EXISTS needs_review            boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposal_confidence     numeric(4,3) NULL,
  ADD COLUMN IF NOT EXISTS proposed_from_event_id  uuid        NULL
    REFERENCES event(id);

ALTER TABLE expenditure
  ADD COLUMN IF NOT EXISTS needs_review            boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposal_confidence     numeric(4,3) NULL,
  ADD COLUMN IF NOT EXISTS proposed_from_event_id  uuid        NULL
    REFERENCES event(id);

-- Partial index: fast lookup for the "review queue" tab.
-- Scoped to tenant + claim so the consultant portal can page through the
-- pending-review list without a full-table scan.
CREATE INDEX IF NOT EXISTS activity_needs_review_idx
  ON activity (tenant_id, claim_id, needs_review)
  WHERE needs_review = true;

CREATE INDEX IF NOT EXISTS expenditure_needs_review_idx
  ON expenditure (tenant_id, claim_id, needs_review)
  WHERE needs_review = true;

-- ============================================================
-- Admit new event kinds on the chain.
-- Carries forward ALL existing kinds from 0075_cloud_sync_connection.sql.
-- ============================================================

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_kind_valid" CHECK (
  "kind" IN (
    -- 13 P0-P3 evidence kinds (do not reorder; preserve 0006 sequence)
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    -- 15 P4 state-transition kinds
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED', 'PROJECT_UPDATED',
    'DOCUMENT_GENERATED',
    -- P5 Theme 5
    'EXPENDITURE_MAPPED',
    'EXPENDITURE_APPORTIONED',
    -- P6
    'EXPENDITURE_CLASSIFIED',
    'ACTIVITY_REGISTER_DRAFTED',
    'NARRATIVE_DRAFTED',
    -- P9 Phase 3 — federation audit trail
    'FEDERATION_READ',
    -- P5A — subject-tenant, employee, and time-entry CRUD audit trail
    'SUBJECT_TENANT_UPDATED',
    'SUBJECT_TENANT_ARCHIVED',
    'EMPLOYEE_UPDATED',
    'EMPLOYEE_DEACTIVATED',
    'TIME_ENTRY_CREATED',
    'TIME_ENTRY_UPDATED',
    'TIME_ENTRY_DELETED',
    -- Cloud sync connector
    'CLOUD_SYNC_CONNECTED',
    'CLOUD_SYNC_DISCONNECTED',
    'EVIDENCE_UPLOADED',
    -- B+C narrative-approval flow (0079)
    'NARRATIVE_APPROVED',
    'ACTIVITY_REVIEWED',
    'EXPENDITURE_REVIEWED'
  )
);
