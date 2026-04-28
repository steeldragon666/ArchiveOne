-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: mapping_rule table with composite primary key,
-- jsonb columns for B8's discriminated-union conditions/action, RLS
-- policy, and CHECK constraints. drizzle-kit cannot fully express:
--   1. CHECK constraints — Drizzle's check() helper round-trips poorly
--      and is omitted from the schema model on this branch (see existing
--      pattern in 0006/0008/0010/0012/0013/0016).
--   2. The RLS / FORCE / policy block (same hand-authored pattern as 0016).
--
-- ============================================================
-- T-B9 — Mapping rule persistence
-- ============================================================
-- Persists rules authored by consultants/admins for the
-- expenditure-to-activity mapping engine (T-B8 ships the runtime, T-B10
-- wires the apply-rules job). The `(tenant_id, id)` composite PK pins
-- tenant isolation structurally; the `(tenant_id, priority)` index
-- powers the B10 apply-rules job's priority-ordered scan.
--
-- `conditions` and `action` are jsonb columns typed against B8's
-- `RuleCondition[]` / `RuleAction` discriminated unions in TypeScript.
-- We deliberately do NOT add a CHECK constraint validating the JSON
-- shape — the API layer (T-B9) calls B8's `evaluateRule` with a
-- synthetic expenditure to trigger the runtime validator at write time,
-- and B8's engine is the single source of truth for rule semantics.
-- ============================================================

CREATE TABLE "mapping_rule" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_rule_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "mapping_rule_priority_nonnegative" CHECK ("priority" >= 0),
	CONSTRAINT "mapping_rule_name_nonempty" CHECK ("name" <> ''),
	CONSTRAINT "mapping_rule_name_max_length" CHECK (length("name") <= 200)
);
--> statement-breakpoint
ALTER TABLE "mapping_rule" ADD CONSTRAINT "mapping_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rule" ADD CONSTRAINT "mapping_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mapping_rule_priority_idx" ON "mapping_rule" USING btree ("tenant_id","priority");
--> statement-breakpoint

-- ============================================================
-- RLS — same FORCE + USING + WITH CHECK pattern as 0002 / 0006 / 0008
-- / 0009 / 0010 / 0012 / 0013 / 0016. mapping_rule is tenant-scoped;
-- a firm's rules are NEVER visible across tenants, even to platform
-- admins acting on behalf of one firm.
-- ============================================================

ALTER TABLE "mapping_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mapping_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mapping_rule_tenant_isolation" ON "mapping_rule"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "mapping_rule" TO cpa_app;

--> statement-breakpoint

-- ============================================================
-- Extend the event_kind_valid CHECK to admit the three MAPPING_RULE_*
-- state-transition kinds. The list mirrors `EVIDENCE_KINDS` in
-- @cpa/db/schema/event.ts and the Zod evidenceKind enum in
-- @cpa/schemas/src/event.ts; all three must stay in lockstep.
--
-- NOTE: B9 does NOT itself emit chain events for these kinds — the
-- `event` table requires a NOT NULL `subject_tenant_id`, but mapping
-- rules are tenant-scoped (firm-wide), not subject-tenant-scoped.
-- The kinds are reserved here so future audit surfaces (or a wider
-- audit_log table) can adopt them without another schema change.
-- ============================================================

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_kind_valid";
ALTER TABLE "event" ADD CONSTRAINT "event_kind_valid" CHECK (
  "kind" IN (
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE', 'OVERRIDE',
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_LOCKED',
    'ARTEFACT_LINKED', 'ARTEFACT_UNLINKED',
    'EXPENDITURE_INGESTED', 'EXPENDITURE_LINE_MAPPED',
    'EXPENDITURE_LINE_UNMAPPED', 'EXPENDITURE_VOIDED',
    'CLAIM_STAGE_ADVANCED', 'CLAIM_SUBMITTED',
    'PROJECT_CREATED', 'PROJECT_ARCHIVED', 'DOCUMENT_GENERATED',
    'MAPPING_RULE_CREATED', 'MAPPING_RULE_UPDATED', 'MAPPING_RULE_ARCHIVED'
  )
);
