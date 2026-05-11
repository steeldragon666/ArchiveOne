-- DO NOT REGENERATE THIS MIGRATION VIA `pnpm --filter @cpa/db generate`.
-- Hand-authored migration: Google Drive cloud-sync connector tables.
--
-- drizzle-kit cannot fully express:
--   1. CHECK constraints (provider_check, last_sync_status_valid) — same
--      pattern as 0006/0008/0010/0012/0013/0016/0018/0022/0029/0030/0038/0039.
--   2. UNIQUE partial-index and UNIQUE constraint with nullable FK.
--   3. The RLS / FORCE / policy block (same hand-authored pattern as
--      0016 / 0018 / 0022 / 0029 / 0030 / 0038 / 0039).
--
-- NEW EVENT KINDS admitted by this migration:
--   CLOUD_SYNC_CONNECTED    — emitted when a folder connection is activated
--   CLOUD_SYNC_DISCONNECTED — emitted when a connection is deleted
--   EVIDENCE_UPLOADED       — emitted per file ingested by the polling job
--
-- ============================================================
-- 1. cloud_sync_connection — one row per (project, Drive folder) pair.
-- ============================================================

CREATE TABLE "cloud_sync_connection" (
  "id"                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                uuid        NOT NULL,
  "project_id"               uuid        NOT NULL,
  "provider"                 text        NOT NULL DEFAULT 'google_drive',
  "provider_account_email"   text        NOT NULL DEFAULT '',
  "provider_folder_id"       text        NOT NULL DEFAULT '',
  "provider_folder_name"     text        NOT NULL DEFAULT '',
  -- TODO(security): rotate to pgcrypto pgp_sym_encrypt with master key from
  -- CLOUD_SYNC_TOKEN_KEY env var before handling production data. Currently
  -- stored as plaintext for dev speed. See cloud-sync.ts route comment.
  "refresh_token_encrypted"  text        NOT NULL DEFAULT '',
  "access_token_cached"      text,
  "access_token_expires_at"  timestamptz,
  "status"                   text        NOT NULL DEFAULT 'pending_folder_selection',
  "last_synced_at"           timestamptz,
  "last_sync_status"         text,
  "last_sync_error"          text,
  "files_synced_count"       integer     NOT NULL DEFAULT 0,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now(),
  "deleted_at"               timestamptz,
  CONSTRAINT "cloud_sync_connection_provider_check" CHECK (
    "provider" IN ('google_drive')
  ),
  CONSTRAINT "cloud_sync_connection_status_check" CHECK (
    "status" IN ('pending_folder_selection', 'active', 'error')
  ),
  CONSTRAINT "cloud_sync_connection_last_sync_status_valid" CHECK (
    "last_sync_status" IS NULL OR "last_sync_status" IN ('success', 'error')
  )
);
--> statement-breakpoint

ALTER TABLE "cloud_sync_connection"
  ADD CONSTRAINT "cloud_sync_connection_tenant_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "cloud_sync_connection"
  ADD CONSTRAINT "cloud_sync_connection_project_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."project"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

-- Prevent duplicate connections to the same folder on the same project.
-- Only applies to active rows (deleted_at IS NULL) so soft-deleted entries
-- don't block reconnection.
CREATE UNIQUE INDEX "cloud_sync_connection_uniq_active_folder"
  ON "cloud_sync_connection" ("tenant_id", "project_id", "provider_folder_id")
  WHERE "deleted_at" IS NULL AND "provider_folder_id" <> '';
--> statement-breakpoint

-- Project-level lookup: "list all sync connections for project X"
CREATE INDEX "cloud_sync_connection_project_idx"
  ON "cloud_sync_connection" ("tenant_id", "project_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Polling job: "find all active connections with a folder selected"
CREATE INDEX "cloud_sync_connection_active_poll_idx"
  ON "cloud_sync_connection" ("status", "last_synced_at")
  WHERE "deleted_at" IS NULL AND "provider_folder_id" <> '';
--> statement-breakpoint

ALTER TABLE "cloud_sync_connection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cloud_sync_connection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "cloud_sync_connection_tenant_isolation" ON "cloud_sync_connection"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "cloud_sync_connection" TO cpa_app;
-- DELETE intentionally not granted: connections are soft-deleted (deleted_at).
REVOKE DELETE ON "cloud_sync_connection" FROM cpa_app;
--> statement-breakpoint

-- ============================================================
-- 2. cloud_sync_synced_file — de-duplication ledger for the polling job.
-- ============================================================

CREATE TABLE "cloud_sync_synced_file" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id"    uuid        NOT NULL,
  "provider_file_id" text        NOT NULL,
  "sha256_hex"       text        NOT NULL,
  "synced_at"        timestamptz NOT NULL DEFAULT now(),
  "event_id"         uuid,
  CONSTRAINT "cloud_sync_synced_file_uniq" UNIQUE ("connection_id", "provider_file_id")
);
--> statement-breakpoint

ALTER TABLE "cloud_sync_synced_file"
  ADD CONSTRAINT "cloud_sync_synced_file_connection_id_fk"
  FOREIGN KEY ("connection_id") REFERENCES "public"."cloud_sync_connection"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- event_id FK is intentionally nullable + no ON DELETE CASCADE: chain events
-- are append-only and must never be cascade-deleted. If a connection is
-- hard-deleted (ops tooling) the synced_file row becomes an orphan, which is
-- acceptable — the event record on the audit chain remains intact.
ALTER TABLE "cloud_sync_synced_file"
  ADD CONSTRAINT "cloud_sync_synced_file_event_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."event"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
--> statement-breakpoint

-- Per-connection lookup: "which files have we already seen for connection X?"
CREATE INDEX "cloud_sync_synced_file_connection_idx"
  ON "cloud_sync_synced_file" ("connection_id");
--> statement-breakpoint

-- cloud_sync_synced_file is NOT RLS-protected: it is an internal
-- deduplication table accessed only by the polling job (server-side,
-- privileged path). The connection_id FK indirectly scopes it to a tenant.
GRANT SELECT, INSERT ON "cloud_sync_synced_file" TO cpa_app;
REVOKE UPDATE, DELETE ON "cloud_sync_synced_file" FROM cpa_app;
--> statement-breakpoint

-- ============================================================
-- 3. Admit new event kinds on the chain.
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
    'TIME_ENTRY_DELETED',
    -- Cloud sync connector
    'CLOUD_SYNC_CONNECTED',
    'CLOUD_SYNC_DISCONNECTED',
    'EVIDENCE_UPLOADED'
  )
);
--> statement-breakpoint

-- Admit the new override-eligible kinds in the override_new_kind CHECK too.
-- EVIDENCE_UPLOADED is classifiable (a consultant may re-classify a file's
-- evidence kind). CLOUD_SYNC_CONNECTED / CLOUD_SYNC_DISCONNECTED are
-- state-transition events and are NOT re-classifiable (same pattern as
-- PROJECT_CREATED, ACTIVITY_CREATED, etc.).
ALTER TABLE "event" DROP CONSTRAINT IF EXISTS "event_override_new_kind_valid";
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_override_new_kind_valid" CHECK (
  "override_new_kind" IS NULL OR "override_new_kind" IN (
    'HYPOTHESIS', 'DESIGN', 'EXPERIMENT', 'OBSERVATION', 'ITERATION',
    'NEW_KNOWLEDGE', 'UNCERTAINTY', 'TIME_LOG', 'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE', 'SUPPORTING', 'INELIGIBLE'
  )
);
