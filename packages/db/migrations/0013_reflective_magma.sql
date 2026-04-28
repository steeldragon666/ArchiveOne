CREATE TABLE "expenditure_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expenditure_id" uuid NOT NULL,
	"description" text NOT NULL,
	"account_code" text,
	"amount" numeric(12, 2) NOT NULL,
	"rd_percent" integer
);
--> statement-breakpoint
CREATE TABLE "expenditure_mapping_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" text,
	"vendor_pattern" text,
	"account_code" text,
	"description_pattern" text,
	"activity_id" uuid NOT NULL,
	"rd_percent" integer NOT NULL,
	"priority" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenditure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_external_id" text,
	"vendor_name" text NOT NULL,
	"reference" text,
	"expenditure_date" date NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"reimbursed_to_user_id" uuid,
	"raw_payload" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expenditure_line" ADD CONSTRAINT "expenditure_line_expenditure_id_expenditure_id_fk" FOREIGN KEY ("expenditure_id") REFERENCES "public"."expenditure"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_mapping_rule" ADD CONSTRAINT "expenditure_mapping_rule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure_mapping_rule" ADD CONSTRAINT "expenditure_mapping_rule_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure" ADD CONSTRAINT "expenditure_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure" ADD CONSTRAINT "expenditure_subject_tenant_id_subject_tenant_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."subject_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditure" ADD CONSTRAINT "expenditure_reimbursed_to_user_id_user_id_fk" FOREIGN KEY ("reimbursed_to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenditure_line_expenditure_idx" ON "expenditure_line" USING btree ("expenditure_id");--> statement-breakpoint
CREATE INDEX "expenditure_mapping_rule_tenant_idx" ON "expenditure_mapping_rule" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenditure_mapping_rule_activity_idx" ON "expenditure_mapping_rule" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "expenditure_tenant_idx" ON "expenditure" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenditure_subject_tenant_idx" ON "expenditure" USING btree ("subject_tenant_id");--> statement-breakpoint
CREATE INDEX "expenditure_source_idx" ON "expenditure" USING btree ("source");