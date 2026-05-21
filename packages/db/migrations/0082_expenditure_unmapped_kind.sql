-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: extends the event_kind_valid CHECK constraint
-- to admit the EXPENDITURE_UNMAPPED event kind.
--
-- EXPENDITURE_UNMAPPED is emitted by POST /v1/expenditures/:id/unmap when
-- a consultant explicitly clears a current mapping. Payload:
--   { expenditure_id, prior_activity_id?, unmapped_by_user_id, reason? }
--
-- Carries forward ALL existing kinds from 0079_narrative_approval_columns.sql.

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
    -- A-endpoints: consultant clears a mapping
    'EXPENDITURE_UNMAPPED',
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
