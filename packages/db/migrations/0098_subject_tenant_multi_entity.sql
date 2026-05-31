-- 0098 — subject_tenant multi-entity / corporate-group modelling.
--
-- The product audit flagged that subject_tenant carried only `kind ∈
-- {claimant, financier}`, so:
--   * head-company + subsidiaries (≥80% of mid-market claimants) can't be
--     modelled, breaking the aggregated-turnover test (s.328-115).
--   * R&D entity vs associate entity can't be distinguished, breaking the
--     s.355-220 associate payment rule + the 38.5%/43.5% offset split.
--
-- Schema-only / additive. Existing rows default to 'standalone' +
-- head_company_id=NULL (i.e. unchanged behaviour) so no consumer needs
-- to be aware of multi-entity until it surfaces them.
--
-- Three-way parity:
--   * SQL CHECK below
--   * Drizzle ENTITY_KINDS export (packages/db/src/schema/subject_tenant.ts)
--   * Zod ENTITY_KINDS_LITERAL export (packages/schemas/src/subject-tenant.ts)

BEGIN;

ALTER TABLE subject_tenant
  ADD COLUMN entity_kind text NOT NULL DEFAULT 'standalone'
    CHECK (entity_kind IN ('standalone', 'head_company', 'r_and_d_entity', 'associate_entity')),
  ADD COLUMN head_company_id uuid REFERENCES subject_tenant(id),
  -- Aggregated turnover in AUD, captured per claim cycle. < $20M  → 43.5%
  -- refundable offset (small entity); >= $20M → 38.5% non-refundable.
  -- Per s.328-115; the consultant captures this annually.
  ADD COLUMN aggregated_turnover_aud numeric(14, 2),
  ADD COLUMN aggregated_turnover_fy_label text;

-- Index head_company_id so the group-rollup query (claim aggregator for
-- consolidated AusIndustry registration) is a fast lookup.
CREATE INDEX subject_tenant_head_company_idx ON subject_tenant (head_company_id)
  WHERE head_company_id IS NOT NULL;

-- Defensive: a head company cannot itself nominate a head company (no
-- two-level hierarchies in v1; this matches the R&DTI consolidated-group
-- model where the head company is the top of the tree). Enforce with a
-- CHECK that ties the two columns together.
ALTER TABLE subject_tenant
  ADD CONSTRAINT subject_tenant_head_company_not_self
    CHECK (head_company_id IS NULL OR head_company_id <> id);

COMMENT ON COLUMN subject_tenant.entity_kind IS
  'Role of this subject within its corporate group:
     standalone        — single entity claiming on its own behalf (default).
     head_company      — top of a consolidated group; aggregates subsidiary
                         turnover for the s.328-115 test.
     r_and_d_entity    — subsidiary actually performing the R&D work.
     associate_entity  — subsidiary whose payments to the R&D entity trigger
                         the s.355-220 associate rule.';

COMMENT ON COLUMN subject_tenant.head_company_id IS
  'Self-FK to the head company of this entity''s consolidated group.
   NULL for ''standalone'' and ''head_company'' rows; non-null for
   r_and_d_entity / associate_entity rows. Aggregated turnover for the
   group is read off the head_company row.';

COMMENT ON COLUMN subject_tenant.aggregated_turnover_aud IS
  's.328-115 aggregated turnover for the FY label below. Drives the
   38.5%/43.5% refundable-offset split. Captured per FY; older values
   live in the chain via subsequent UPDATE events.';

COMMIT;
