-- 0099 — prompt_suggestion: add triage_notes column for persisting consultant rationale.
--
-- Fixes issue #29 (P7 I6). The triage endpoint accepted a `notes` field in the
-- request body but silently dropped it because no column existed. Consultants
-- typing triage rationale saw a 200 and assumed it was captured — it was not.
-- Add the column; pre-existing triaged rows keep NULL.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-runs are safe.

ALTER TABLE prompt_suggestion
  ADD COLUMN IF NOT EXISTS triage_notes text;
