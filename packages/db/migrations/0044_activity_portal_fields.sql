-- Migration 0044: Add portal_fields jsonb column to activity table.
--
-- Captures per-AusIndustry-portal-field content for the 13-core / 9-supporting
-- field structure expected by the registration form. Schema enforced at
-- application layer (Zod). Default empty object for backward compatibility
-- with pre-Sprint-A activities.

ALTER TABLE activity
  ADD COLUMN portal_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- GIN index for jsonb path queries (e.g., finding activities with hypothesis content)
CREATE INDEX activity_portal_fields_idx ON activity USING GIN (portal_fields);
