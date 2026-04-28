-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- The block at the bottom is hand-authored: 4 CHECK constraints, 3 RLS
-- policies, and GRANTs to cpa_app. drizzle-kit will silently regenerate
-- this file and clobber them. If you need to change a P4 table's shape,
-- write a new migration.
--
-- Three new tables: project, claim, activity (P4 F1).
--
-- Note on event-table changes: drizzle-kit also emitted ALTER TABLE "event"
-- changes for captured_by_user_id / captured_by_employee_id, because the
-- prior hand-authored migration 0011_event_captured_by_employee.sql did not
-- write a meta/0011_snapshot.json — drizzle-kit therefore replays the diff
-- between meta/0010_snapshot.json and the current schema, re-emitting the
-- already-applied 0011 changes. Those statements have been stripped here
-- (running them again would fail with "column already exists"). The
-- pre-existing 0011 hand-authored migration remains the canonical source
-- of those event-table changes; meta/0012_snapshot.json captures the new
-- post-state correctly so future generates compute deltas against it.

CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"hypothesis" text,
	"technical_uncertainty" text,
	"experimentation_log" text,
	"expected_outcome" text,
	"actual_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"fiscal_year" integer NOT NULL,
	"stage" text DEFAULT 'engagement' NOT NULL,
	"ausindustry_reference" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_subject_tenant_id_subject_tenant_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."subject_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_subject_tenant_id_subject_tenant_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."subject_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_tenant_idx" ON "activity" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "activity_project_idx" ON "activity" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "activity_claim_idx" ON "activity" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_claim_code_unique" ON "activity" USING btree ("claim_id","code");--> statement-breakpoint
CREATE INDEX "claim_tenant_idx" ON "claim" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "claim_subject_tenant_idx" ON "claim" USING btree ("subject_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_subject_tenant_fiscal_year_unique" ON "claim" USING btree ("subject_tenant_id","fiscal_year");--> statement-breakpoint
CREATE INDEX "project_tenant_idx" ON "project" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "project_subject_tenant_idx" ON "project" USING btree ("subject_tenant_id");
--> statement-breakpoint
-- ============================================================
-- DB-level CHECK constraints
-- ============================================================

ALTER TABLE "activity" ADD CONSTRAINT activity_kind_valid
  CHECK (kind IN ('core', 'supporting'));

ALTER TABLE "activity" ADD CONSTRAINT activity_code_format
  CHECK (code ~ '^(CA|SA)-[0-9]{2,3}$');

ALTER TABLE "claim" ADD CONSTRAINT claim_stage_valid
  CHECK (stage IN ('engagement', 'activity_capture', 'narrative_drafting',
                   'expenditure_schedule', 'review', 'submitted', 'audit_defence'));

ALTER TABLE "claim" ADD CONSTRAINT claim_fiscal_year_range
  CHECK (fiscal_year BETWEEN 2010 AND 2050);

--> statement-breakpoint
-- ============================================================
-- RLS — same FORCE + USING + WITH CHECK pattern as 0002 / 0006 / 0008 / 0009 / 0010
-- ============================================================

ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project" FORCE ROW LEVEL SECURITY;
CREATE POLICY "project_tenant_isolation" ON "project"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY "claim_tenant_isolation" ON "claim"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "activity_tenant_isolation" ON "activity"
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "project" TO cpa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "claim" TO cpa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activity" TO cpa_app;