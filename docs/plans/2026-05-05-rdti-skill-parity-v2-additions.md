# R&DTI Skill Parity Plan v2 — Research Audit Additions

**Companion to:** `2026-05-05-rdti-skill-parity.md` (the v1 plan)
**Audit reference:** `2026-05-05-rdti-skill-parity-research-audit.md`
**Date added:** 2026-05-05

## Why this addendum

A research-analyst subagent audited the v1 plan + existing platform against the latest AusIndustry guidance, ATO Tax Payer Alerts, and Federal Court / ART case law. **Material findings**: 7 entirely-missing considerations + 5 partially-covered + 1 new sprint required. Severity: 4 Critical, 5 High, 3 Medium.

This document adds those tasks to the v1 plan. Each addition references the audit section that motivated it.

## Sprint A additions — One-strike policy (Critical)

### Task A.9 — Per-criterion scoring in Agent C narrative drafter

**Type:** TDD code (agent prompt + Zod schema)
**Audit ref:** Section 2.1
**Severity:** Critical

**Files:**
- Modify: `packages/agents/src/narrative-drafter/prompts/draft-narrative@1.2.0.ts` (Sprint A.3)
- Modify: `packages/schemas/src/portal-fields.ts` (Sprint A.2)

**Rationale:** From 1 July 2025 DISR applies one-strike review — single weak criterion rejects the activity. Platform's weighted-average risk model is wrong shape; needs weakest-link.

**Implementation:** Update v1.2.0 prompt to score each of the 5 s.355-25 criteria independently, output as `criterion_scores`:

```ts
criterion_scores: z.object({
  outcome_uncertainty: z.number().min(0).max(1),
  systematic_method: z.number().min(0).max(1),
  new_knowledge_purpose: z.number().min(0).max(1),
  not_ordinary_business: z.number().min(0).max(1),
  dominant_purpose: z.number().min(0).max(1),
}),
```

**Commit:** `feat(agents): per-criterion scoring in draft-narrative@1.2.0 for one-strike risk model (A.9)`

### Task A.10 — `one_strike_risk_score` in Portal Pack export

**Type:** TDD code
**Audit ref:** Section 2.1
**Severity:** Critical

**Files:**
- Modify: `packages/agents/src/portal-pack-formatter.ts` (Sprint A.6)
- Modify: `packages/audit-score/src/types.ts`

**Implementation:** Compute `one_strike_risk_score = min(criterion_scores values)`. If below 0.70 on ANY criterion, render red-flag warning in Portal Pack export naming the specific failing criterion.

**Commit:** `feat(api): one_strike_risk_score in Portal Pack export (A.10)`

## Sprint B additions — SIC + at-risk (High)

### Task B.6 — Daily-compound shortfall interest charge formula

**Type:** TDD code (refactor clawback)
**Audit ref:** Section 2.2
**Severity:** High

**Files:**
- Modify: `packages/audit-score/src/clawback-calculator.ts`
- Modify: tests

**Rationale:** Future Made in Australia Act 2025 extends SIC to overclaimed R&D offsets, compounded daily. Simple-annual interest understates exposure materially over 4 years.

**Implementation:** Add `sic_applicable: boolean` to `ClawbackInput`. When true (assessment date ≥ 2025-04-01):

```ts
const dailyRate = sicRate / 365;
const interest_aud = claimDrop * (Math.pow(1 + dailyRate, years * 365) - 1);
```

When false (pre-April-2025 assessments), keep simple-interest path. Expose `compound_vs_simple_delta_aud` in result.

**Commit:** `feat(audit-score): SIC daily-compound formula for assessments after 2025-04-01 (B.6)`

### Task B.7 — At-risk rule (s.355-405) in expenditure classifier

**Type:** TDD code (Agent A prompt bump + schema)
**Audit ref:** Section 2.4
**Severity:** High

**Files:**
- Modify: `packages/agents/src/classifier-expenditure/prompts/classify-expenditure@1.0.0.ts` (bump to `@1.1.0.ts`)
- Modify: `packages/agents/src/classifier-expenditure/types.ts`
- Modify: `packages/db/src/schema/expenditure_line.ts` (add at_risk fields)
- Tests

**Rationale:** TA 2023/4 specifically targets associate-delivery arrangements where expenditure is owed but not paid (loans, offsets). Multi-entity claimants face this routinely.

**Implementation:**
1. New classification: `eligible_at_risk_review` in `EXPENDITURE_DECISIONS` enum
2. New Step 1.5 in classifier prompt: "Check if vendor is an associate or related-party entity. If so, flag for at-risk rule review under Section 355-405."
3. Add `at_risk_flag: boolean` and `at_risk_reason: string | null` to `ExpenditureClassifierOutput`
4. Schema column `expenditure_line.at_risk_review_required: boolean default false`

**Commit:** `feat(agents,db): Section 355-405 at-risk rule flagging in expenditure classifier (B.7)`

## Sprint C additions — Body by Michael + promoter exposure + heuristics (Critical/High)

### Task C.5 — Hard gate on `evidence_kept_categories`

**Type:** TDD code
**Audit ref:** Section 4 (Body by Michael), Section 7
**Severity:** Critical

**Files:**
- Modify: `apps/api/src/routes/claim-portal-pack.ts` (Sprint A.6)
- Modify: form-completeness check

**Rationale:** Body by Michael held documentary evidence "expected feature" of genuine R&D, without which "near impossible" to establish systematic experimentation. Sprint C v1 flagged `no_records_kept` as warning; should be hard gate.

**Implementation:** Portal Pack export route returns 422 with explicit error citing Body by Michael standard if any core activity has only `no_records_kept` selected. Form-completeness flags as `evidence_categories_insufficient`.

**Commit:** `feat(api): hard gate on evidence_kept_categories per Body by Michael (C.5)`

### Task C.6 — `promoter_exposure_flag` for low-probability claim concentration

**Type:** TDD code
**Audit ref:** Section 2.5 (Bakarich)
**Severity:** High

**Files:**
- Modify: `packages/audit-score/src/compliance-risk-flags.ts` (Sprint C.2)
- Modify: Portal Pack formatter

**Rationale:** Bakarich (Dec 2024) imposed $13.6M penalties on advisors who filed R&D claims "without any regard to whether activities even qualified."

**Implementation:**
- `promoter_exposure_flag = (count of activities with eligibility_probability < 0.75) / total_activities > 0.20`
- When flag raised, Portal Pack export includes Bakarich advisory text:

> **PROMOTER PENALTY ADVISORY (Division 290 TAA 1953):** This claim contains [N] activities with eligibility probability below 0.75 ([X]% of total). Filing claims without a reasonably arguable position may attract Division 290 promoter penalties (Bakarich [2024] FCA, $13.6M precedent). Strongly recommend additional substantiation review before submission.

**Commit:** `feat(audit-score): promoter_exposure_flag with Bakarich advisory (C.6)`

### Task C.7 — Whole-of-project registration heuristic

**Type:** TDD code
**Audit ref:** Section 3.2 (TA 2017/5)
**Severity:** High

**Files:**
- Modify: `packages/audit-score/src/compliance-risk-flags.ts`
- Modify: Agent B prompt

**Implementation:**
1. Heuristic check: scan activity description for lifecycle-scope language patterns ("development of [X]", "build and deploy", "phase 1 through 3", "full stack implementation", "design, build, test")
2. If matched, raise `whole_of_project_risk` flag
3. Add to Agent B prompt: "Do not register an entire software project as a single activity. Each activity must be a discrete experimental workstream with its own hypothesis."

**Commit:** `feat(audit-score,agents): whole-of-project heuristic + Agent B prompt update per TA 2017/5 (C.7)`

### Task C.8 — Knowledge search predates hypothesis enforcement

**Type:** TDD code
**Audit ref:** Section 3.3 (Body by Michael)
**Severity:** Critical

**Files:**
- Modify: `apps/api/src/routes/compliance.ts` (form-completeness endpoint)

**Rationale:** Body by Michael held hypothesis must be formed at outset. Knowledge search recorded after `hypothesis_formed_at` doesn't satisfy the standard.

**Implementation:** For each core activity, require at least one `knowledge_search_record.search_date < activity.hypothesis_formed_at`. Surface as `knowledge_search_predates_hypothesis: false` failure reason.

**Commit:** `feat(api): enforce knowledge_search_record predates hypothesis_formed_at (C.8)`

### Task C.9 — Tobacco/gambling exclusion check

**Type:** TDD code
**Audit ref:** Section 2.3
**Severity:** Medium

**Files:**
- Modify: Agent A prompt
- Migration: add `is_tobacco_gambling_excluded: boolean` to activity

**Rationale:** Draft legislation (Dec 2024) excludes tobacco/gambling R&D effective 1 July 2025. Harm-reduction carved out.

**Implementation:** Pattern-match keywords. If matched AND `activity.created_at >= 2025-07-01`, raise `excluded_activity_post_july_2025`. Carve-out checkbox for harm-reduction.

**Commit:** `feat(agents,db): tobacco/gambling exclusion per July 2025 amendments (C.9)`

### Task C.10 — GIC rate to `compliance_config` table

**Type:** TDD code (migration + refactor)
**Audit ref:** Section 3.4
**Severity:** Medium

**Files:**
- Migration `0050_compliance_config.sql`
- Modify `clawback-calculator.ts` to read from config

**Rationale:** ATO publishes GIC rate quarterly. Hardcoded constant goes stale. Plus needed for SIC formula change (B.6).

**Implementation:** New `compliance_config` table with `key`, `value_numeric`, `valid_from`, `valid_to`. Calculator queries by date. 90-day staleness warning.

**Commit:** `feat(db,audit-score): compliance_config table with versioned GIC rate (C.10)`

## Sprint D additions — IP ownership + contractors + foreign parent (Critical/High/Medium)

### Task D.6 — IP ownership + strategic control fields

**Type:** TDD code
**Audit ref:** Section 2.6
**Severity:** Critical

**Files:**
- Migration `0051_r_and_d_ip_ownership.sql`
- Sprint D Zod schemas
- Web UI form

**Rationale:** 15 Aug 2025 form has explicit "on own behalf" questions covering IP retention + strategic control. Sprint D v1 plan adds ANZSIC/FTE/ABN/ACN but not these.

**Implementation:** Add to `beneficial_ownership` (or new `r_and_d_ip_ownership` table):
- `primary_ip_holder` enum: `r_and_d_entity | associate | mixed`
- `strategic_control_holder` enum: `r_and_d_entity | shared | associate`
- `associate_payment_method` enum: `cash | loan_conversion | offset_against_license | other`

Auto-flag when `primary_ip_holder != 'r_and_d_entity'` or `strategic_control_holder != 'r_and_d_entity'`.

**Commit:** `feat(db,api): IP ownership + strategic control per Aug 2025 form (D.6)`

### Task D.7 — Contractor count + expenditure

**Type:** TDD code
**Audit ref:** Section 2.7
**Severity:** Medium

**Files:**
- Modify: Sprint D migration `0047_subject_tenant_registration_metadata.sql`

**Implementation:** Add to subject_tenant: `r_and_d_contractors_count: integer`, `r_and_d_contractor_expenditure_aud: numeric(14,2)`. Update Portal Pack Company Registration section + form-completeness check.

**Commit:** `feat(db,api): independent contractor fields per Aug 2025 form (D.7)`

### Task D.8 — Foreign parent flag + TA 2023/5 review trigger

**Type:** TDD code
**Audit ref:** Section 6 (TA 2023/5)
**Severity:** High

**Files:**
- Modify: `beneficial_ownership` schema
- Modify: `compliance-risk-flags.ts`

**Rationale:** TA 2023/5 targets Australian entities with foreign parents claiming overseas R&D. Currently captured as `is_foreign_related` but no automatic review-required flag based on overseas activity presence.

**Implementation:** Add `has_foreign_parent: boolean` to `beneficial_ownership`. When `has_foreign_parent = true` AND activity references overseas contractors/facilities, raise `ta_2023_5_review_required` compliance flag.

**Commit:** `feat(db,audit-score): foreign parent flag + TA 2023/5 auto-review (D.8)`

## NEW Sprint E — Evidence Artefacts (~2-3 days, High severity)

**Goal:** Link software development artefacts (git commits, sprint records, photos) to activities as contemporaneous evidence per Body by Michael standard.

### Task E.1 — Migration `0048_activity_evidence_artefacts.sql`

**Files:** Migration + Drizzle schema + tests

**Implementation:**

```sql
CREATE TABLE activity_evidence_artefact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  activity_id uuid NOT NULL REFERENCES activity(id),
  artefact_kind text NOT NULL CHECK (artefact_kind IN (
    'git_commit', 'pull_request', 'sprint_record', 'jira_ticket',
    'test_result', 'lab_notebook', 'photo_video',
    'literature_search', 'expert_consultation', 'other'
  )),
  artefact_url text,
  artefact_date date NOT NULL,
  description text,
  first_recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artefact_predates_today CHECK (artefact_date <= CURRENT_DATE)
);

CREATE INDEX activity_evidence_artefact_activity_idx ON activity_evidence_artefact (activity_id, artefact_date);
ALTER TABLE activity_evidence_artefact ENABLE ROW LEVEL SECURITY;
```

RLS policy: `tenant_id = current_setting('app.current_tenant_id', true)::uuid`

**Commit:** `feat(db): activity_evidence_artefact table for contemporaneous record linkage (E.1)`

### Task E.2 — `PATCH /v1/activities/:id/evidence-artefacts` endpoint + UI

**Files:**
- Create: `apps/api/src/routes/activity-evidence-artefacts.ts`
- Tests
- Web UI in activity detail page

**Implementation:** CRUD endpoint for artefact references. UI for consultant to add git URL / sprint URL / photo per activity.

**Commit:** `feat(api,web): evidence artefact CRUD endpoint + UI (E.2)`

### Task E.3 — Form-completeness requires evidence artefact per core activity

**Files:** `compliance.ts` form-completeness endpoint

**Implementation:** Require ≥1 non-`no_records_kept` evidence category AND ≥1 linked evidence artefact per core activity before Portal Pack export is enabled.

**Commit:** `feat(api): require evidence artefact per core activity before Portal Pack export (E.3)`

### Task E.4 — Photo/video metadata advisory

**Files:** `portal-pack-formatter.ts`

**Implementation:** Advisory text in export when `photo_video` artefacts present:

> ATO examines metadata on photo and video evidence. Files should have unmodified EXIF/metadata timestamps corresponding to the date of the activity. Compressed or re-exported images may not be accepted as contemporaneous evidence.

**Commit:** `feat(api): photo/video metadata advisory in Portal Pack (E.4)`

### Sprint E → PR

```bash
gh pr create --title "feat(rdti): activity evidence artefacts per Body by Michael standard (Sprint E)"
```

---

## v2 cumulative estimates

| Item | v1 effort | v2 additions | v2 total |
|------|-----------|--------------|----------|
| Sprint A | ~5-7 days | +1 day (A.9, A.10) | ~6-8 days |
| Sprint B | ~3-4 days | +1.5 days (B.6, B.7) | ~5-6 days |
| Sprint C | ~2-3 days | +3-4 days (6 new tasks C.5-C.10) | ~6-7 days |
| Sprint D | ~2 days | +1.5 days (D.6, D.7, D.8) | ~3-4 days |
| **NEW Sprint E** | — | +2-3 days | ~2-3 days |
| Final E2E | ~1 day | +0.5 day | ~1.5 days |
| **Total** | **~13-17 days** | **+9.5-11 days** | **~22-29 days** |

Calendar: extends from ~2-2.5 weeks to **~4-5 weeks**.

## Severity summary

- **Critical (4):** A.9 + A.10 (one-strike), C.5 (Body by Michael hard gate), C.8 (knowledge search predates hypothesis), D.6 (IP ownership)
- **High (5):** B.6 (SIC daily-compound), B.7 (at-risk rule), C.6 (promoter exposure), C.7 (whole-of-project), D.8 (foreign parent), E.1-E.4 (evidence artefacts), 3.1 (admin software dominant purpose)
- **Medium (3):** C.9 (tobacco/gambling), C.10 (GIC config), D.7 (contractors)

## Coverage outcome after v2

- **Pre-v2:** ~85% rdti-workflow skill parity
- **Post-v2:** ~98% — covering one-strike policy, SIC compound interest, at-risk rule, "on own behalf" requirements, evidence artefact linkage, all 4 active TAs, and 5 recent precedents (Moreton, GQHC, Active Sports, Body by Michael, Bakarich)

The remaining ~2% is conscious deferrals: email parser (P9), ASX feed (P9), specialised code-file parsers, and any rules introduced after May 2026.

## Reference

Full audit detail at `2026-05-05-rdti-skill-parity-research-audit.md` — Sections 1-7 with case-law analysis, TA enumeration, software-specific guidance.

End of v2 additions.
