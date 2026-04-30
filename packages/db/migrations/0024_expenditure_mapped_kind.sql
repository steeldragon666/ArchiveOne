-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: rebuilds the event_kind_valid CHECK to
-- INCLUDE the new EXPENDITURE_MAPPED kind. drizzle-kit cannot generate
-- this because CHECK constraints live outside drizzle's schema model.
--
-- ============================================================
-- P5 Theme 5 Task 5.1 — admit EXPENDITURE_MAPPED on the event chain
-- ============================================================
-- The apply-rules endpoint (apps/api/src/routes/apply-rules.ts) emits
-- `EXPENDITURE_MAPPED` whenever a mapping rule's action type is
-- `map_to_activity`. The kind needs the chain's append-only
-- guarantees (vs. the firm-scoped audit_log table the MAPPING_RULE_*
-- kinds moved to in P5 Task 2.2) because each mapping is bound to a
-- specific subject_tenant + project + activity — those are
-- subject-tenant-scoped facts, not firm-level admin facts, so the
-- canonical home is the per-claimant hash chain.
--
-- This migration rebuilds the CHECK to admit `EXPENDITURE_MAPPED`,
-- matching the addition to `EVIDENCE_KINDS` in @cpa/db/schema/event.ts
-- and `evidenceKind` in @cpa/schemas/event.ts. The list mirrors 0023
-- byte-for-byte plus the new entry at the tail (preserves the existing
-- order so 0023's documented sequence remains intact).
--
-- The companion EXPENDITURE_APPORTIONED kind lands in
-- 0025_expenditure_apportioned_kind.sql so each migration changes one
-- thing — easier to revert independently if a downstream test catches
-- a payload-shape issue.
-- ============================================================

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_kind_valid" CHECK (
  "kind" IN (
    -- 13 P0–P3 evidence kinds (do not reorder; preserve 0006 sequence)
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    -- 15 P4 state-transition kinds (set lifted from 0023 verbatim)
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED', 'PROJECT_UPDATED',
    'DOCUMENT_GENERATED',
    -- P5 Theme 5 Task 5.1 — apply-rules emitter (map_to_activity action)
    'EXPENDITURE_MAPPED'
  )
);
