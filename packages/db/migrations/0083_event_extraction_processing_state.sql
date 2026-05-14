-- Add 'processing' to the extraction_status CHECK constraint.
--
-- Why: the document-extract worker now uses an optimistic claim
-- pattern to serialize concurrent invocations of the same event_id
-- (caught by document-extract.stress.test.ts: 10x concurrent dispatch
-- of one event_id produced 10 ledger rows before the lock landed).
--
-- Flow:
--   pending -> [worker acquires advisory lock] -> processing -> complete | failed
--
-- A worker that arrives second sees 'processing', short-circuits.
-- The advisory lock prevents the race window between the SELECT and
-- the UPDATE; the status sentinel handles the case where the second
-- worker acquires the lock AFTER the first one commits but BEFORE
-- the first one finishes the analyzer call.
--
-- Append-only migration: just relaxes the CHECK. Existing rows in
-- 'pending'/'complete'/'failed' remain valid.

ALTER TABLE "event" DROP CONSTRAINT IF EXISTS event_extraction_status_valid;
--> statement-breakpoint

ALTER TABLE "event" ADD CONSTRAINT event_extraction_status_valid CHECK (
  extraction_status IS NULL
  OR extraction_status IN ('pending', 'processing', 'complete', 'failed')
);
