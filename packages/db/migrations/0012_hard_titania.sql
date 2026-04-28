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
--
-- F2 will append the FORCE RLS block + tenant_isolation policies + GRANTs
-- for these three tables, plus the activity.kind/code CHECK constraints
-- and claim.stage/fiscal_year CHECK. Do not regenerate this file.

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