-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: extends the event_kind_valid CHECK constraint
-- with 14 P4 state-transition evidence kinds. drizzle-kit cannot generate
-- this because CHECK constraints live outside drizzle's schema model.
--
-- This migration touches ONLY event_kind_valid. The companion constraint
-- event_override_new_kind_valid (which restricts override_new_kind to
-- classifiable R&D evidence kinds) is intentionally left alone — the new
-- P4 kinds are state-transition events and cannot be re-classified via
-- OVERRIDE.

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS event_kind_valid;
--> statement-breakpoint

ALTER TABLE "event" ADD CONSTRAINT event_kind_valid CHECK (
  kind IN (
    -- existing 13 P0–P3 kinds (do not reorder; preserve 0006 sequence)
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    -- 14 P4 state-transition kinds (must match `EVIDENCE_KINDS` const in event.ts)
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED',
    'DOCUMENT_GENERATED'
  )
);
