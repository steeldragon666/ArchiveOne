-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: rebuilds the event_kind_valid CHECK to
-- INCLUDE the new EXPENDITURE_APPORTIONED kind. drizzle-kit cannot
-- generate this because CHECK constraints live outside drizzle's
-- schema model.
--
-- ============================================================
-- P5 Theme 5 Task 5.2 — admit EXPENDITURE_APPORTIONED on the chain
-- ============================================================
-- The apply-rules endpoint (apps/api/src/routes/apply-rules.ts) emits
-- `EXPENDITURE_APPORTIONED` whenever a mapping rule's action type is
-- `apportion`. Same rationale as 0024_expenditure_mapped_kind.sql:
-- apportionment is a subject-tenant-scoped fact (binds an
-- expenditure to a list of (activity_id, percentage) allocations
-- that together must sum to 100), so the canonical home is the
-- per-claimant hash chain rather than the firm-level audit_log.
--
-- The Zod payload schema in @cpa/schemas/event.ts
-- (`ExpenditureApportionedPayload`) enforces that allocations sum to
-- 100 with a ±0.001 tolerance; B8's `validateRuleAction` catches
-- malformed `apportion` actions at rule-create time, and B8's
-- `applyRules` re-validates eagerly each call. This migration only
-- admits the kind on the chain CHECK — the integrity invariant lives
-- on the schema/engine side.
--
-- This migration rebuilds the CHECK to admit
-- `EXPENDITURE_APPORTIONED`, mirroring the addition to
-- `EVIDENCE_KINDS` in @cpa/db/schema/event.ts and `evidenceKind` in
-- @cpa/schemas/event.ts. The list mirrors 0024 byte-for-byte plus the
-- new entry at the tail.
-- ============================================================

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_kind_valid" CHECK (
  "kind" IN (
    -- 13 P0–P3 evidence kinds (do not reorder; preserve 0006 sequence)
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    -- 15 P4 state-transition kinds (set lifted from 0024 verbatim)
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED', 'PROJECT_UPDATED',
    'DOCUMENT_GENERATED',
    -- P5 Theme 5 Task 5.1 — apply-rules emitter (map_to_activity action)
    'EXPENDITURE_MAPPED',
    -- P5 Theme 5 Task 5.2 — apply-rules emitter (apportion action)
    'EXPENDITURE_APPORTIONED'
  )
);
