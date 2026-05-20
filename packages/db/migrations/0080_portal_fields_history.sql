-- Migration 0080: portal_fields_history jsonb for AusIndustry portal field
-- versioning.
--
-- Each entry captures a snapshot of portal_fields immediately before it was
-- overwritten by a POST (agent regeneration) or PATCH (consultant edit).
-- The current portal_fields stays in its own column; history is strictly
-- prior versions. Newest entries at the end of the array.
--
-- Entry shape (validated at application layer, not by jsonb_check):
--   {
--     "portal_fields": { "activity_kind": "...", "fields": { ... } },
--     "saved_at"     : "2026-05-12T...",   -- ISO 8601
--     "source"       : "agent" | "edit"     -- which path overwrote it
--   }
--
-- Server caps the array at the most-recent 10 entries to prevent
-- unbounded growth on activities that get regenerated frequently.
-- Default `[]::jsonb` keeps pre-migration rows lint-clean.

ALTER TABLE activity
  ADD COLUMN portal_fields_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- No GIN index — the column is only ever read whole for an activity's
-- history panel, never queried by content. Add later if usage proves
-- otherwise.
