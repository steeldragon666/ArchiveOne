-- Migration 0077: add finalisation tracking columns to claim table.
--
-- These columns are populated by the claim-finalisation pg-boss job
-- (apps/api/src/jobs/claim-finalisation.ts) triggered by
-- POST /v1/claims/:id/finalise.
--
-- finalisation_status: current state of the finalisation workflow.
--   NULL = never started | 'queued' | 'active' | 'completed' | 'failed'
--
-- finalisation_progress: JSONB carrying per-step progress counters
--   { activities_drafted, total_activities, pdfs_generated, total_pdfs }
--
-- finalisation_started_at / finalisation_completed_at: timestamps for
--   the progress modal's "working…" display.

ALTER TABLE claim
  ADD COLUMN IF NOT EXISTS finalisation_status       text        NULL
    CONSTRAINT claim_finalisation_status_valid
    CHECK (finalisation_status IN ('queued', 'active', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS finalisation_progress     jsonb       NULL,
  ADD COLUMN IF NOT EXISTS finalisation_started_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS finalisation_completed_at timestamptz NULL;
