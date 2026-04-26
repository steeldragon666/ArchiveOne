CREATE TABLE "agent_call_cache" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output" jsonb NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"milestone_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"classification" jsonb,
	"override_of_event_id" uuid,
	"override_new_kind" text,
	"override_reason" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"idempotency_key" text,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_by_user_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_subject_tenant_id_subject_tenant_id_fk" FOREIGN KEY ("subject_tenant_id") REFERENCES "public"."subject_tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_captured_by_user_id_user_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_feed_idx" ON "event" USING btree ("subject_tenant_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "event_kind_idx" ON "event" USING btree ("subject_tenant_id","kind");--> statement-breakpoint
CREATE INDEX "event_override_idx" ON "event" USING btree ("override_of_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_idempotency_unique" ON "event" USING btree ("idempotency_key") WHERE "event"."idempotency_key" IS NOT NULL;