-- 0097 — R&DTI gap foundation schema.
--
-- Implements the highest-leverage gaps from the v3.2 product-completeness
-- addendum + the 2026-05-31 product audit. Schema-only (additive); all
-- existing rows remain valid. UI + agent integration land in follow-ups.
--
-- Scope:
--   1. activity.risk_level + activity.risk_level_computed_at   (v3.2 A.14)
--   2. activity overseas R&D flags                              (v3.2 B.11, TA 2023/5)
--   3. activity.supports_activity_id  (s.355-30 supporting → core FK; audit gap)
--   4. activity.performer_kind + contractor identity            (s.355-205/210/220; audit gap)
--   5. expenditure.apportionment_basis                          (v3.2 B.10)
--   6. notional_adjustment table       (Subdiv 355-G — feedstock / recoupment /
--      associates / balancing / depreciation; audit gap)
--   7. employee_rd_allocation table    (per-employee R&D % per TR 2021/5; audit gap)
--
-- Three-way parity (per CLAUDE.md): every new enum value here must mirror
-- the Zod export in `packages/schemas/src/*` AND the migration-parity test
-- in `packages/db/src/migrations.test.ts`. The two new RLS tables are added
-- to the rls-coverage allowlist.
--
-- RLS policies use the canonical
--   (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
-- pattern — wrapped in (SELECT …) so the planner hoists the GUC read to
-- a per-statement InitPlan (same shape migration 0096 retrofitted onto
-- the federation-extended policies).

BEGIN;

-- ------------------------------------------------------------------ (1)
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');

ALTER TABLE activity
  ADD COLUMN risk_level risk_level,
  ADD COLUMN risk_level_computed_at timestamptz;

COMMENT ON COLUMN activity.risk_level IS
  'Holistic eligibility score band. NULL until the audit-score scorer
   computes it; updated whenever underlying portal_fields change. See
   packages/audit-score/src/eligibility-scorer.ts.';

-- ------------------------------------------------------------------ (2)
ALTER TABLE activity
  ADD COLUMN performed_overseas boolean NOT NULL DEFAULT false,
  ADD COLUMN overseas_country text,
  ADD COLUMN overseas_findings_required boolean NOT NULL DEFAULT false,
  ADD COLUMN overseas_findings_obtained boolean NOT NULL DEFAULT false,
  ADD COLUMN overseas_findings_reference text;

COMMENT ON COLUMN activity.performed_overseas IS
  'True when the R&D activity was conducted outside Australia. Per
   ATO Taxpayer Alert TA 2023/5 this is a high-risk audit focus: any
   overseas claim must hold an Overseas Findings determination from
   AusIndustry (s.28A IR&D Act). Validation: if performed_overseas=true
   AND overseas_findings_obtained=false, claim submission is blocked.';

-- ------------------------------------------------------------------ (3)
ALTER TABLE activity
  ADD COLUMN supports_activity_id uuid REFERENCES activity(id);

CREATE INDEX activity_supports_idx ON activity (supports_activity_id)
  WHERE supports_activity_id IS NOT NULL;

COMMENT ON COLUMN activity.supports_activity_id IS
  's.355-30 supporting-activity FK to the parent core activity it
   supports. NULL for core activities; the AusIndustry portal requires
   every supporting activity to nominate parent core(s) + dominant-purpose
   rationale. Enforced at the application layer (Zod) rather than DB
   CHECK so existing pre-0097 rows remain valid.';

-- ------------------------------------------------------------------ (4)
CREATE TYPE rd_performer_kind AS ENUM (
  'in_house',
  'contracted_arm_length',
  'contracted_associate'
);

ALTER TABLE activity
  ADD COLUMN performer_kind rd_performer_kind NOT NULL DEFAULT 'in_house',
  ADD COLUMN contractor_name text,
  ADD COLUMN contractor_abn text;

COMMENT ON COLUMN activity.performer_kind IS
  'Whether the R&D was performed by the entity (in_house), an
   arm''s-length contractor (contracted_arm_length), or an associate
   (contracted_associate per s.355-220). Drives:
     * s.355-205 associate-payments rule — associate spend is
       claimable only when paid before year-end.
     * s.355-210 overseas-permission interplay — overseas contractor
       work needs Overseas Findings.
     * Notional-adjustment math — feedstock + recoupment have
       different sign conventions depending on performer_kind.';

-- ------------------------------------------------------------------ (5)
CREATE TYPE apportionment_basis AS ENUM (
  'headcount',
  'floorspace',
  'time',
  'revenue',
  'direct'
);

ALTER TABLE expenditure
  ADD COLUMN apportionment_basis apportionment_basis;

COMMENT ON COLUMN expenditure.apportionment_basis IS
  'How an overhead is apportioned to R&D activities. Per
   packages/audit-score/src/overhead-apportionment.ts. NULL = "not yet
   apportioned" (consultant still classifying); ''direct'' = the
   expenditure is 100% R&D (e.g. lab consumables) with no apportionment
   needed.';

-- ------------------------------------------------------------------ (6)
CREATE TABLE notional_adjustment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  claim_id            uuid NOT NULL REFERENCES claim(id),
  -- Discriminator — Subdiv 355-G clauses. Keep in sync with the Zod
  -- NOTIONAL_ADJUSTMENT_KINDS export and the parity test.
  kind                text NOT NULL CHECK (kind IN (
    'feedstock',
    'recoupment',
    'associate_payment',
    'depreciation',
    'balancing_adjustment'
  )),
  -- Signed AUD. Positive = adds to claimable; negative = reduces.
  -- ATO worksheet sign conventions:
  --   feedstock          → NEGATIVE (s.355-465 input-cost reduction)
  --   recoupment         → NEGATIVE (s.355-435 government clawback)
  --   associate_payment  → POSITIVE only when paid before year-end (s.355-205)
  --   depreciation       → POSITIVE (notional R&D deduction per s.355-305/315)
  --   balancing_adjustment → +ve loss / -ve gain (s.40-285 wash-up)
  amount_aud          numeric(14, 2) NOT NULL,
  description         text NOT NULL,
  statutory_anchor    text NOT NULL,  -- e.g. 's.355-465'
  -- Forensic immutability — same pattern as activity / chain.
  first_recorded_at   timestamptz NOT NULL DEFAULT now(),
  -- Body-by-Michael: optional but immutable post-INSERT once set.
  hypothesis_formed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid NOT NULL REFERENCES "user"(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notional_adjustment_tenant_idx ON notional_adjustment (tenant_id);
CREATE INDEX notional_adjustment_claim_idx  ON notional_adjustment (claim_id);
CREATE INDEX notional_adjustment_kind_idx   ON notional_adjustment (kind);

ALTER TABLE notional_adjustment ENABLE ROW LEVEL SECURITY;
CREATE POLICY notional_adjustment_tenant_isolation ON notional_adjustment
  USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON notional_adjustment TO cpa_app;

COMMENT ON TABLE notional_adjustment IS
  'Subdiv 355-G notional R&D adjustments — feedstock, recoupment,
   associate payments, balancing, depreciation. One row per ATO worksheet
   line item. Adjustments fold into the final notional R&D deduction
   when the application drafter renders the AusIndustry registration
   + the company tax-return offset calc.';

-- ------------------------------------------------------------------ (7)
CREATE TABLE employee_rd_allocation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  claim_id            uuid NOT NULL REFERENCES claim(id),
  employee_id         uuid NOT NULL REFERENCES subject_tenant_employee(id),
  -- Optional activity narrowing; NULL = "applies to all R&D activities
  -- in this claim" (the common case). Non-null when the consultant tracks
  -- per-activity timesheets and wants a different % per activity.
  activity_id         uuid REFERENCES activity(id),
  -- 0–100 inclusive. INTEGER on purpose (R&D % rounded to whole percentages
  -- per TR 2021/5 timesheet-sampling guidance).
  rd_percentage       smallint NOT NULL CHECK (rd_percentage BETWEEN 0 AND 100),
  -- Consultant's documented audit basis ("timesheet sample Q2-Q4 FY26
  -- @ 60% R&D"). Surfaced in compliance.pdf for ATO defence.
  basis_note          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_user_id  uuid NOT NULL REFERENCES "user"(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Two-finger uniqueness: per (employee, claim) the rule is "either one
  -- claim-wide row OR per-activity rows". The schema can only enforce one
  -- side; we choose per-activity uniqueness here, and Zod enforces the
  -- "claim-wide implies no per-activity rows" exclusion at the app layer.
  UNIQUE (employee_id, claim_id, activity_id)
);

CREATE INDEX employee_rd_allocation_tenant_idx   ON employee_rd_allocation (tenant_id);
CREATE INDEX employee_rd_allocation_claim_idx    ON employee_rd_allocation (claim_id);
CREATE INDEX employee_rd_allocation_employee_idx ON employee_rd_allocation (employee_id);

ALTER TABLE employee_rd_allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_rd_allocation_tenant_isolation ON employee_rd_allocation
  USING (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON employee_rd_allocation TO cpa_app;

COMMENT ON TABLE employee_rd_allocation IS
  'Per-employee R&D percentage allocations per TR 2021/5. The
   apportionment engine multiplies a salary expenditure''s amount_aud by
   the employee''s rd_percentage to derive the R&D-claimable portion
   (then further apportioned across activities via expenditure_line).
   On-costs (super, leave loading, payroll tax) follow the same %.';

COMMIT;
