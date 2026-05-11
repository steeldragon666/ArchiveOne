-- Migration 0076: add auto-allocation suggestion columns to event table.
--
-- These columns are populated by the auto-allocator agent (POST /v1/events/:id/suggest-allocation
-- and POST /v1/events/:id/auto-allocate-batch). A suggestion is ephemeral until a consultant
-- confirms (status = 'confirmed'), rejects (status = 'rejected'), or manually overrides
-- (status = 'edited').
--
-- Nullable: old events that never ran through the allocator have NULL suggestion_status,
-- which is distinct from 'pending' (has a suggestion but not yet reviewed).
--
-- APPEND-ONLY contract preserved: these columns are mutable metadata (soft state),
-- not part of the append-only chain. The chain is the hash-linked event sequence;
-- suggestions are a workflow-layer overlay.

ALTER TABLE event
  ADD COLUMN IF NOT EXISTS suggested_activity_id     uuid        NULL,
  ADD COLUMN IF NOT EXISTS suggested_at              timestamptz NULL,
  ADD COLUMN IF NOT EXISTS suggestion_confidence     float       NULL,
  ADD COLUMN IF NOT EXISTS suggestion_status         text        NULL
    CONSTRAINT event_suggestion_status_valid
    CHECK (suggestion_status IN ('pending', 'confirmed', 'rejected', 'edited'));

-- Index: fast lookup of events awaiting review (suggestion_status = 'pending')
-- scoped by subject_tenant_id (the claim's review queue).
CREATE INDEX IF NOT EXISTS event_suggestion_status_idx
  ON event (subject_tenant_id, suggestion_status)
  WHERE suggestion_status IS NOT NULL;
