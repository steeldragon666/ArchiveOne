# R&DTI Skill Parity Plan v3 — Primary-Source Refinements

**Companion to:** v1 plan (`2026-05-05-rdti-skill-parity.md`) + v2 additions (`2026-05-05-rdti-skill-parity-v2-additions.md`) + audit (`2026-05-05-rdti-skill-parity-research-audit.md`)
**Audit reference:** Second-pass research-analyst review of ATO Legal Database direct sources (GQHC AATA 409 ATO DIS, EM202033 — Treasury Laws Amendment (A Tax Plan for the COVID-19 Economic Recovery) Act 2020, EM20238 unresolved, EV/1052237848852 unresolved without authenticated access, TR 2021/5 at-risk rule)
**Date added:** 2026-05-05

## Why this addendum

The second-pass research used DIRECT ATO sources (vs the v2 audit's secondary commentary). It surfaced material refinements to v2 tasks + 3 entirely-new tasks. The Tax Office's own Decision Impact Statements and Tax Rulings establish positions that secondary commentary summarized incompletely.

## Critical refinements to v2 tasks

### Refinement to A.9 — `systematic_method` criterion floor cap

**Source:** GQHC ATO DIS — confirms ATO uses Tribunal's evidentiary standard for systematic-progression criterion.

**Refinement:** The `systematic_method` criterion score must be **capped at 0.5** when any of these four evidentiary elements is absent:
1. Documented hypothesis with date
2. Experiment log
3. Observation records
4. Evaluation/conclusion records

This is independent of narrative quality — strong prose cannot rescue a missing element.

**Implementation:** Update Task A.9's Agent C prompt to enforce the cap mechanically. Add a `systematic_method_evidentiary_completeness` enum to the score output: `complete | hypothesis_missing | log_missing | observations_missing | evaluations_missing | multiple_missing`.

**Severity:** Critical (most common audit failure mode).

### Refinement to B.7 — Split into B.7a + B.7b (TR 2021/5 two-limb structure)

**Source:** TR 2021/5 — at-risk rule is two distinct limbs, BOTH must be satisfied for rule to apply.

**Limb 1 (nexus):** Did entity receive consideration as direct/indirect result of incurring R&D expenditure?
**Limb 2 (regardless):** Was consideration received irrespective of R&D outcomes — would it apply whether R&D succeeded or failed?

**Implementation:** Replace single `at_risk_flag` with structured fields:
```ts
at_risk_limb1_nexus: boolean,        // Limb 1 satisfied
at_risk_limb2_regardless: boolean,   // Limb 2 satisfied
at_risk_triggered: boolean,          // BOTH true
at_risk_reason: string | null
```

Agent A prompt Step 1.5 → Steps 1.5a + 1.5b (independent assessment).

**Severity:** High. Conflating limbs creates both false positives (flagging fixed-price contracts where outcome-contingent payments don't satisfy Limb 2) and false negatives (missing arrangements where consideration is received regardless).

### Refinement to B.7 — "Consideration" includes non-monetary benefits

**Source:** TR 2021/5 + the "Little P" associate-loan example.

**Refinement:** Agent A prompt + at-risk schema must explicitly enumerate non-monetary consideration:
- Loans from associates
- License rights received in advance
- Equity stakes
- Offset arrangements (R&D costs credited against future royalties/licenses)
- Pre-paid services from related parties

Cash-only check insufficient.

**Severity:** High.

### Refinement to C.9 — Gambling/tobacco structured sub-fields + "solely" test

**Source:** Treasury Laws Amendment (Delivering an Efficient and Trusted Tax System) Bill 2026, Schedule 4 (introduces s.355-25(2)(i)–(j)).

**Refinement:** Replace pattern-match keywords with structured sub-fields cross-referenced to three separate Acts:

```ts
gambling_exclusion_applies: boolean,      // Interactive Gambling Act 2001 def
gambling_harm_minimisation_carveout: boolean,  // requires "solely" test
tobacco_exclusion_applies: boolean,        // Public Health (Tobacco and Other Products) Act 2023
tobacco_harm_minimisation_carveout: boolean,  // requires "solely" test (incl Therapeutic Goods Act 1989 s.41P for vaping)
```

Carve-outs require "solely for the purpose of generating new knowledge about minimising harm" — dual-purpose activities fail. Make this an explicit prompt question, not a keyword match.

**Severity:** Medium (volume) but Implementation Complexity: HIGH.

### Refinement to B.3 (correction flag) — Two-slice intensity calculation

**Source:** EM202033 Schedule 4 — confirms intensity premium is a TWO-SLICE calculation, not a tier lookup.

**Refinement (pre-merge code review):** For large entities (≥$20M turnover) above 2% intensity, the offset is calculated on TWO SLICES:
- Slice 1: 8.5pp premium on R&D up to 2% of total expenses
- Slice 2: 16.5pp premium on R&D above 2% intensity

Not a flat 16.5pp on all R&D. Verify B.3's `calculateOffsetRate` implements two-slice math; if it returns a single rate per tier, the calculation is wrong for entities above 2% intensity.

**Severity:** High (silent under-calculation if implemented as flat-rate).

## New v3 tasks

### Task A.11 — `ato_review_flag` scoped to amendment-period proximity

**Source:** GQHC ATO DIS — three-part exercise-of-power framework.

**Rationale:** Prior audit's "ATO concurrent authority" framing is incomplete. ATO will exercise concurrent authority "ordinarily" by IISA referral, NOT independently. Independent action only when IISA referral not practicable within statutory timeframes.

**Implementation:** Replace any universal `ato_review_flag` with conditional trigger:
```ts
ato_review_flag = (amendment_period_expiry_days < 365) AND (has_iisa_finding === false)
```

Surfaces only when statutory amendment period is closing AND IISA hasn't issued a Finding yet — the actual scenario where ATO will act alone.

**Severity:** Medium (avoids overstating risk; sharpens compliance signal).

### Task A.12 — `risk_type` field per criterion: definitional vs evidentiary

**Source:** GQHC vs Active Sports Management — distinct failure types require distinct remediation.

**Rationale:** Failures fall into two classes:
- **Definitional**: activity structurally cannot qualify (excluded category, ordinary business). NO remediation possible.
- **Evidentiary**: activity could qualify but lacks documentation. REMEDIABLE with contemporaneous records.
- **Mixed**: both elements present.

The Portal Pack export should give different remediation advice per type:
- Definitional → "Remove from claim" or "Reclassify as supporting"
- Evidentiary → "Document hypothesis date" or "Add experiment logs"

**Implementation:** Add to Agent C output schema:
```ts
criterion_scores: z.object({
  outcome_uncertainty: z.object({ score: z.number(), risk_type: z.enum(['definitional','evidentiary','mixed']) }),
  // ... same shape per criterion
}),
```

**Severity:** High. Wrong remediation advice (e.g., suggesting documentation for a definitionally-excluded activity) wastes consultant time and entrenches non-compliant claims.

### Task B.8 — Feedstock adjustment as independent clawback exposure

**Source:** GQHC — Tribunal applied feedstock adjustment EVEN WHERE activities ineligible. Subdivision 355-H runs independently of activity eligibility.

**Rationale:** Current `clawback-calculator.ts` does not model feedstock as a separate exposure line. Entities whose activities are disqualified may still face feedstock clawback on transformed inputs.

**Implementation:**
1. New function `calculateFeedstockExposure` separate from main clawback path.
2. Add `feedstock_fully_transformed: boolean` flag.
3. When `true`, apply 100% inclusion (per GQHC's rejection of partial-transformation argument); when `false`, apply existing `min(revenue, input_cost) / 3` formula.
4. Output structure shows feedstock exposure as a distinct line item, not a reduction within main R&D offset calc.

**Files:**
- Modify: `packages/audit-score/src/feedstock-calculator.ts` (created in v1 Task B.2)
- Modify: `packages/audit-score/src/clawback-calculator.ts`

**Severity:** High.

### Task B.9 — Grant/subsidy double-dipping clawback (Schedule 5, EM202033)

**Source:** EM202033 Schedule 5 — distinct clawback rule for entities receiving concurrent government assistance.

**Rationale:** Prior audit didn't capture this. Entities receiving CSIRO grants, Accelerating Commercialisation grants, state co-investment, etc. for the same R&D activities face dollar-for-dollar reduction of the R&D offset benefit. This is independent of the at-risk rule.

**Implementation:**
1. Add to claim data model:
   ```ts
   government_assistance_received: boolean,
   government_assistance_aud: numeric(14,2),
   government_assistance_program: text  // e.g., "CSIRO Innovation Connections", "Accelerating Commercialisation"
   ```
2. Update `clawback-calculator.ts` to subtract `government_assistance_aud` from net R&D offset benefit.
3. Surface in Portal Pack with Schedule 5 statutory citation.
4. Add compliance flag `concurrent_assistance_review_required` when populated.

**Files:**
- Migration: `0052_government_assistance_clawback.sql`
- Modify: `packages/schemas/src/billing.ts` or dedicated R&D claim schema
- Modify: `packages/audit-score/src/clawback-calculator.ts`

**Severity:** Medium (only relevant for entities with concurrent grants).

### Refinement to A.9 prompt — Active Sports + Edited Versions ineligibility patterns

**Source:** Synthesis of ATO Edited Version corpus + Active Sports Management precedent.

**New ineligible patterns to add to Agent A prompt** (beyond v2 list):

1. **"Testing conducted to meet contractual or regulatory requirements"** — distinct from routine testing exclusion (s.355-25(2)). Bespoke contractual testing that superficially looks experimental but is performed to satisfy a contract/standard rather than to generate new knowledge.

2. **"Technical outcomes predetermined by project scope"** — fixed-price contracts or statements of work where the deliverable is specified leave no room for genuine experimental uncertainty.

**Implementation:** Bump Agent A to `classify-expenditure@1.1.0.ts` (also adds Task B.7's at-risk steps). Add these two new INELIGIBLE branch triggers explicitly.

**Severity:** Medium.

## Unresolved items (require authenticated ATO Legal Database access)

1. **EV/1052237848852** — content not retrievable via public sources. Recommend ATO Legal Database authenticated session OR CCH iKnowConnect subscription to retrieve. Likely high-relevance ruling on core eligibility based on its rank position.

2. **NEM/EM20238/NAT/ATO/00007** — EM identity unresolved despite extensive search. Sub-document `00007` suggests substantial multi-section EM. Probably an instrument enabling 15 Aug 2025 form changes OR primary legislation EM not publicly indexed under R&D keywords.

3. **GQHC paragraphs beyond [57]–[98]** — full per-criterion analysis of the four poultry projects. Useful for refining `risk_type` heuristics. Available via Westlaw/LexisNexis subscription or AustLII (if/when accessible).

## v3 cumulative estimates

| Item | v2 effort | v3 additions | v3 total |
|------|-----------|--------------|----------|
| Sprint A | ~6-8 days | +0.5 day (A.11, A.12 + A.9 refinement + Active Sports patterns) | ~7-9 days |
| Sprint B | ~5-6 days | +1 day (B.7 split, B.8 feedstock independence, B.9 grant clawback) | ~6-7 days |
| Sprint C | ~6-7 days | +0.5 day (C.9 structural upgrade) | ~7-8 days |
| Sprint D | ~3-4 days | unchanged | ~3-4 days |
| Sprint E (evidence artefacts) | ~2-3 days | unchanged | ~2-3 days |
| Pre-merge correction review (B.3 two-slice) | — | +0.5 day | +0.5 day |
| Final E2E | ~1.5 days | unchanged | ~1.5 days |
| **Total** | **~22-29 days** | **+2.5 days** | **~25-32 days** |

Calendar: extends from ~4-5 weeks to **~5-6 weeks**.

## Coverage outcome after v3

- v1 plan: ~85% rdti-workflow skill parity
- v1 + v2: ~98%
- **v1 + v2 + v3: ~99%** with primary-source refinements + ATO DIS positions reflected

The remaining ~1% is conscious deferrals: email parser (P9), ASX feed (P9), specialised code-file parsers, EM20238 (unresolved), EV/1052237848852 (unresolved without authenticated access), and any rules introduced after May 2026.

End of v3 additions.
