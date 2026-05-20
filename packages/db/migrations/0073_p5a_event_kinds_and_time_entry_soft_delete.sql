-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: admits P5A event kinds on the event chain,
-- adds `deleted_at` soft-delete column on `time_entry`, and adds the
-- `consultant_manual` source variant to the TIME_ENTRY_SOURCES set.
--
-- ============================================================
-- P5A — subject-tenant, employee, and time-entry CRUD events
-- ============================================================
-- New event kinds admitted by this migration:
--
--   SUBJECT_TENANT_UPDATED   — PATCH /v1/subject-tenants/:id
--   SUBJECT_TENANT_ARCHIVED  — DELETE /v1/subject-tenants/:id
--   EMPLOYEE_UPDATED         — PATCH /v1/employees/:id
--   EMPLOYEE_DEACTIVATED     — DELETE /v1/employees/:id
--   TIME_ENTRY_CREATED       — POST /v1/time-entries (consultant session)
--   TIME_ENTRY_UPDATED       — PATCH /v1/time-entries/:id
--   TIME_ENTRY_DELETED       — DELETE /v1/time-entries/:id
--
-- The kind list mirrors 0072 byte-for-byte plus the seven new entries
-- at the tail. Keep in sync with:
--   1. EVIDENCE_KINDS in @cpa/db/schema/event.ts
--   2. evidenceKind in @cpa/schemas/event.ts
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
    'TIME_ENTRY_DELETED'
  )
);
--> statement-breakpoint

-- Add soft-delete column to time_entry. NULL = active; non-NULL = deleted.
-- Matches the `deleted_at` pattern used on subject_tenant and other tables.
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint

-- Extend the source CHECK constraint on time_entry to include
-- 'consultant_manual' — entries created via POST /v1/time-entries
-- through a consultant session (distinct from mobile 'manual' entries).
-- The existing payroll sources remain unchanged.
DO $$
BEGIN
  -- Drop the old source CHECK if it exists (name may vary across envs).
  ALTER TABLE "time_entry" DROP CONSTRAINT IF EXISTS "time_entry_source_check";
  ALTER TABLE "time_entry" DROP CONSTRAINT IF EXISTS "time_entry_source_valid";
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_source_valid" CHECK (
  "source" IN (
    'manual',
    'consultant_manual',
    'employment_hero',
    'keypay',
    'deputy',
    'xero_payroll'
  )
);
