-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: rebuilds the event_kind_valid CHECK to
-- EXCLUDE the three MAPPING_RULE_* values that 0018 added. drizzle-kit
-- cannot generate this because CHECK constraints live outside drizzle's
-- schema model.
--
-- ============================================================
-- P5 Theme 2 Task 2.2 — move MAPPING_RULE_* off the event chain
-- ============================================================
-- Migration 0018 added MAPPING_RULE_{CREATED,UPDATED,ARCHIVED} to the
-- event_kind_valid CHECK as RESERVED kinds for a future audit surface
-- (the three were never actually inserted into `event`, because the
-- table's `subject_tenant_id` is NOT NULL and mapping rules are firm-
-- scoped). P5 Task 2.1 builds that audit surface (the `audit_log`
-- table); P5 Task 2.4 wires `mapping-rules.ts` to write to it. This
-- migration completes the relocation by REBUILDING the event CHECK to
-- exclude the three values — any future attempt to insert MAPPING_RULE_*
-- into `event` now fails with `event_kind_valid` CHECK violation,
-- nudging callers to use `insertAuditLog` instead.
--
-- The list mirrors `EVIDENCE_KINDS` in @cpa/db/schema/event.ts and the
-- Zod `evidenceKind` enum in @cpa/schemas/event.ts; all three must stay
-- in lockstep. The three MAPPING_RULE_* values now live in `AUDIT_KINDS`
-- in @cpa/db/schema/audit_log.ts and @cpa/schemas/audit.ts.
-- ============================================================

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_kind_valid" CHECK (
  "kind" IN (
    -- 13 P0–P3 evidence kinds (do not reorder; preserve 0006 sequence)
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    -- 14 P4 state-transition kinds (must match `EVIDENCE_KINDS` in
    -- @cpa/db/schema/event.ts — set lifted from 0014 + 0015 + 0018,
    -- minus the three MAPPING_RULE_* values 0018 added)
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED', 'PROJECT_UPDATED',
    'DOCUMENT_GENERATED'
    -- MAPPING_RULE_CREATED / UPDATED / ARCHIVED moved to AUDIT_KINDS
    -- (audit_log table); see 0022_audit_log_table.sql for the new home.
  )
);
