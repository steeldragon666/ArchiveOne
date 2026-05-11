-- Migration 0078: add document content extraction columns to event table.
--
-- These columns are populated by the document-analyzer agent
-- (POST /v1/events/:id/extract-content). Text is extracted client-side
-- (mammoth.js / pdfjs-dist / xlsx in the browser) and submitted alongside
-- the file-upload event. The analyzer agent reads the text and proposes
-- R&D activities and invoices found inside the document.
--
-- extracted_content: JSONB carrying { activities, invoices, document_summary }
--   per the DocumentAnalyzerOutput schema.
-- extraction_status: text nullable; null = not yet run, 'pending' = queued,
--   'complete' = analyzer finished, 'failed' = error stored in payload.
--
-- APPEND-ONLY contract preserved: these columns are mutable metadata (soft
-- state), not part of the append-only hash chain. Like the suggestion columns
-- (0076), they are a workflow-layer overlay.

ALTER TABLE event
  ADD COLUMN IF NOT EXISTS extracted_content  jsonb NULL,
  ADD COLUMN IF NOT EXISTS extraction_status  text  NULL
    CONSTRAINT event_extraction_status_valid
    CHECK (extraction_status IN ('pending', 'complete', 'failed'));

-- Index: fast lookup by extraction status for batch-processing and UI queries.
CREATE INDEX IF NOT EXISTS event_extraction_status_idx
  ON event (subject_tenant_id, extraction_status)
  WHERE extraction_status IS NOT NULL;
