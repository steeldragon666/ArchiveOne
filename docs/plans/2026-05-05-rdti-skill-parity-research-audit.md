# R&DTI Compliance Audit: Gap Delta Report

**Scope:** cpa-platform (through migration 0040) + `rdti-skill-parity` plan (2026-05-05) vs. current AusIndustry guidance, ATO Taxpayer Alerts, and Federal Court / ART case law as at May 2026.

**Sources confirmed fetched:** business.gov.au software sector guide, eligibility framework, Far Side case study; TA 2017/5 / TA 2017/5A; TA 2023/4; TA 2023/5; Moreton Resources [2019] FCAFC 120 (via RSM and Swanson Reed commentary); Active Sports Management (November 2024, Federal Court); Body by Michael (January 2025, ART); GQHC [2024] AATA 409; Bakarich (December 2024, Federal Court); 15 August 2025 form changes; one-strike policy (1 July 2025); shortfall interest charge (1 April 2025); new excluded activities (July 2025).

**Audit date:** 2026-05-05
**Prepared by:** research-analyst subagent (via WebFetch + cross-reference against codebase)

---

## Section 1 — Considerations the Platform/Plan Already Covers

1. **Section 355-25 five-criteria eligibility test:** Agent A's system prompt (`classify-expenditure@1.0.0.ts`) carries the full decision tree — outcome uncertainty, systematic method, not-ordinary-business, dominant purpose, statutory anchor. The activity `kind` enum (`core` | `supporting`) maps to the statutory distinction. Fully covered.

2. **Body by Michael (January 2025) — contemporaneous hypothesis formation:** Migration 0037 adds `activity.hypothesis_formed_at` as an immutable, NOT NULL column with a PL/pgSQL trigger that raises a `check_violation` on any attempted update. This is the precise architecture the case requires. The P7 design correctly cites this decision as the driver. Fully covered structurally; the UI gate (blocking submission until populated) is referenced in P7 Theme D.

3. **Multi-cycle narrative continuity / proposed_id chain:** Theme A (migration 0037, `walk-proposed-id.ts`, `multi-cycle-summarize@1.0.0`) is fully implemented with citation-graph output that cannot structurally carry paraphrased prior-year text. This satisfies the no-paraphrase policy imposed by the Body by Michael evidentiary standard.

4. **TA 2023/4 (activities delivered by associated entities) and TA 2023/5 (overseas activities for foreign related entities):** Migration 0039 creates `beneficial_ownership` with `is_associate` and `is_foreign_related` GENERATED columns (`ta_2023_4_flag`, `ta_2023_5_flag`). P7 design Section 4.5.2 explicitly references both TAs. Structurally covered.

5. **DISR multi-entity pattern-matching exposure:** Migration 0039 creates `multi_entity_similarity_score` with nightly scan, 0.75-threshold flags, and reviewer disposition. Theme C multi-entity comparison panel renders cross-entity grid. Covered.

6. **Knowledge search records (prior-art investigation documentation):** Migration 0039 creates `knowledge_search_record` with `search_date`, `sources_consulted` (jsonb), `finding_summary`. DELETE intentionally not granted. Covered.

7. **Section 355-465 feedstock adjustment:** Sprint B plan (Task B.2) implements `calculateFeedstockAdjustment` with min(revenue, input_cost) / 3 formula, binding constraint tracking, and zero-case. Correct per the statutory formula.

8. **Section 355-100 R&D intensity tiers for large entities:** Sprint B Task B.3 implements `calculateOffsetRate` with the 2% intensity threshold, 8.5pp / 16.5pp large-entity premiums, and refundable small-entity path. Correct.

9. **15 August 2025 form structure (13 core / 9 supporting portal fields + character limits):** Sprint A addresses this with `CorePortalFieldsSchema` / `SupportingPortalFieldsSchema` Zod validation and 4,000-character limits per narrative field, plus the Export Portal Pack deliverable. Covered as planned.

10. **Regulatory Intelligence Feed (RIF):** Migration 0040 creates `regulatory_source` and `regulatory_event` with seeds for ATO, AustLII, business.gov.au, ISA, RSM. Daily cron + `regulatory-classify@1.0.0` covered in P7 Theme D.

---

## Section 2 — Considerations Missing Entirely

### 2.1 — One-Strike Review Policy (1 July 2025)

**Rule:** From 1 July 2025, DISR assessors apply a one-strike standard: if any single eligibility requirement is found not met, the activity is rejected outright without examining remaining criteria.

**Source:** RSM "Reflecting on 2025"; Treadstone compliance updates; SwansonReed implementation note.

**Why it matters:** An activity that has a defensible hypothesis but whose new-knowledge narrative is weak will now be rejected in full. The platform's current audit score uses weighted average, not weakest-link.

**Recommended addition:** Add `one_strike_risk_score` (the minimum criterion score) to activity. Update Agent C prompt to score each of the five eligibility criteria independently. Add `one_strike_weak_criterion` compliance flag.

**Severity:** Critical.

### 2.2 — Shortfall Interest Charge on Overclaimed Refundable Offsets (1 April 2025)

**Rule:** Future Made in Australia Act 2025 extends SIC to repayments of overclaimed R&D offsets. SIC compounded daily. Effective for assessments after 1 April 2025.

**Source:** ATO "Strengthen penalty and shortfall interest charge provisions"; Grant Thornton FY25 wrap-up.

**Why it matters:** `clawback-calculator.ts` uses simple interest. SIC compounds daily. For a 4-year clawback at 11.22%, simple ≈ 44.88% vs compound ≈ 56.4% — material understatement.

**Recommended addition:** Daily-compound formula. Add `sic_applicable: boolean` flag (true for assessments after 1 April 2025). Expose compound-vs-simple delta.

**Severity:** High.

### 2.3 — New Excluded Activities: Tobacco and Gambling (1 July 2025)

**Rule:** Draft legislation (Dec 2024, submissions closed Jan 2026) excludes tobacco-related and gambling-related R&D from eligibility. Harm-reduction carved out.

**Source:** RSM 2025 review; Grant Thornton FY25 wrap-up.

**Why it matters:** Agent A doesn't enumerate the July 2025 additions.

**Recommended addition:** Add `tobacco_or_gambling_purpose` to ineligible exclusion enum. Checkbox in activity schema with carve-out for harm-reduction.

**Severity:** Medium.

### 2.4 — "At Risk" Rule (Section 355-405) Not Modelled

**Rule:** Section 355-405 reduces notional R&D deductions for expenditure not "at risk." Expenditure is not at risk if entity receives consideration as direct/indirect result of incurring it. TR 2021/5 has 11 example scenarios. TA 2023/4 specifically flags associate-delivery arrangements.

**Source:** PwC at-risk rule guidance; ATO 2024 R&D Schedule Instructions; TA 2023/4.

**Why it matters:** Multi-entity claimants (your four-entity group) face this rule routinely. Platform classifies expenditure as eligible without flagging at-risk question.

**Recommended addition:** Fourth classification: `eligible_at_risk_review`. Add `at_risk_flag: boolean` and `at_risk_reason: string | null` to ExpenditureClassifierOutput. Add to Agent A prompt as Step 1.5.

**Severity:** High.

### 2.5 — Promoter Penalty Exposure (Division 290 TAA 1953)

**Rule:** Bakarich (Dec 2024) — $13.6M penalties on advisors who promoted R&D schemes without assessing reasonably arguable position. Proposed amendment raises max to $780M.

**Source:** Grant Thornton FY25 wrap-up; KPMG Tax News Flash December 2024.

**Why it matters:** Platform facilitates claim preparation for an advisor (Aaron). Systematic over-classification could create promoter-penalty exposure.

**Recommended addition:** `promoter_exposure_flag` raised when more than 20% of activities have `eligibility_probability < 0.75`. Surface in Portal Pack export with Bakarich advisory text.

**Severity:** High.

### 2.6 — "Own Behalf" Requirement — Project Control and IP Retention

**Rule:** 15 August 2025 form introduced explicit questions on "on own behalf" compliance: financial risk, project control, IP ownership/retention. Aligns with TA 2023/4's "strategic control" and "primary IP rights" requirements.

**Source:** Intellect Labs 2025 form update; Swanson Reed FY25 form update.

**Why it matters:** `beneficial_ownership` captures UBO structure but not IP rights or project control. Sprint D adds ANZSIC/FTE/ABN/ACN but not these.

**Recommended addition:** Add `primary_ip_holder`, `strategic_control_holder`, `associate_payment_method` fields. Auto-flag when `primary_ip_holder != 'R&D entity'`.

**Severity:** Critical.

### 2.7 — Independent Contractor Information (Aug 2025 Form)

**Rule:** August 2025 form has new contractor-specific fields.

**Source:** RSM 2025 review.

**Why it matters:** Sprint D's registration metadata distinguishes employees + STEM-qualified, but not contractors. For software companies, contractors are often a major R&D resource.

**Recommended addition:** Add `r_and_d_contractors_count` and `r_and_d_contractor_expenditure_aud` to subject_tenant.

**Severity:** Medium.

---

## Section 3 — Considerations Partially Covered (Refinement Needed)

### 3.1 — "Internal Administration" Software Exclusion — Dominant Purpose Test

**What's in place:** Agent A's INELIGIBLE branch lists "commodity software for ordinary admin." TA 2017/5A noted in business.gov.au.

**What's missing:** May 2024 AusIndustry guidance distinguishes "purely internal admin" (HR, maintenance) from "client-facing delivery systems." Latter may be supporting R&D. Current classifier doesn't capture this nuance. `SupportingPortalFieldsSchema.dominant_purpose.is_dominant_purpose: z.literal(true)` hardcodes assertion rather than capturing assessment.

**Source:** business.gov.au software sector guide (May 2024 update); TA 2017/5A.

**Recommendation:** Update Agent A INELIGIBLE branch. Distinguish internal-admin (no client interface) from client-facing systems. Change `dominant_purpose` to capture `assessed_dominant_purpose` + `basis_for_assessment` narrative.

**Severity:** High.

### 3.2 — Whole-of-Project Registration vs. Activity-Level Precision (TA 2017/5)

**What's in place:** Agent B drafts activity register with kind enum. Portal-fields requires per-activity population.

**What's missing:** No validation that activity scope isn't whole-of-project. TA 2017/5 specifically warns against this in software claims.

**Source:** TA 2017/5.

**Recommendation:** Heuristic check in `compliance-risk-flags.ts`: scan descriptions for lifecycle-scope patterns ("development of [system]", "build and deploy", "phase 1 through 3"). Flag for review. Add explicit instruction to Agent B prompt.

**Severity:** High.

### 3.3 — Knowledge Search Records — "Before Work Commences" Constraint

**What's in place:** Migration 0039 creates `knowledge_search_record` with `search_date <= CURRENT_DATE`.

**What's missing:** Body by Michael held hypothesis must be formed at outset. Current schema doesn't enforce `search_date < activity.hypothesis_formed_at`. Knowledge searches recorded after experimentation began don't satisfy the standard.

**Source:** Body by Michael [2025] ART; business.gov.au August 2025 form update.

**Recommendation:** Add cross-table validation `knowledge_search_record.search_date < activity.hypothesis_formed_at`. Surface as `knowledge_search_predates_hypothesis: false` in form completeness.

**Severity:** Critical.

### 3.4 — GIC Rate Maintenance

**What's in place:** Hardcoded constant `ATO_GIC_RATE = 0.1122`.

**What's missing:** No update mechanism. ATO publishes quarterly. Plus formula-change need (Section 2.2).

**Recommendation:** Move to `compliance_config` table with `rate_valid_from`/`rate_valid_to`. Staleness warning if not updated 90+ days.

**Severity:** Medium.

### 3.5 — Large-Entity Offset Rate Currently Outdated

**What's in place:** `RDTI_OFFSET_RATE_LARGE = 0.385`. Sprint B fixes via intensity-tier logic.

**What's missing:** Until Sprint B merges, displays incorrect figure for large entities.

**Recommendation:** Already in Sprint B plan. Add interim disclaimer in audit-score UI.

**Severity:** Medium (sprint-sequencing issue).

---

## Section 4 — Case Law Implications

### Moreton Resources Limited v Innovation and Science Australia [2019] FCAFC 120

**Held:** Activities applying existing technology in new context may satisfy s.355-25 — question is whether legislative requirements met on specific facts. Activities where outcome could be known abstractly may still be conducted "for the purpose of generating new knowledge." Test is purpose + epistemic state of specific applicant.

**Impact:** Pre-Moreton, ATO/AAT applied restrictive "knowledge frontier" test. Post-Moreton, applying established tech to new domain can be eligible if outcome was field-specific uncertain.

**Platform reflection:** Agent A teaches the test correctly. `why_competent_professional_couldnt_know` field directly targets this. Agent B prompt should be verified to avoid disqualifying activities solely on basis of "existing techniques being used."

### GQHC v Commissioner of Taxation [2024] AATA 409

**Held:** ATO has concurrent authority to assess activity eligibility independent of IISA/DISR. Feedstock adjustment applies even absent eligible R&D where inputs are transformed.

**Platform reflection:** Add `ato_review_flag` to model dual-regulator risk. Feedstock calculator should flag input-transformation cases beyond just finished-goods sale.

### Active Sports Management (November 2024)

**Held:** Customising basketball shoes to player preferences is not core R&D — modification of known design rather than systematic experimentation. Contemporaneous hypothesis required but absent.

**Platform reflection:** Software analog: customising existing platform to client requirements is not R&D unless specific technical hypothesis about unresolvable uncertainty. Add to Agent A prompt explicit pattern.

### Body by Michael (January 2025, ART)

**Held:** No documented hypothesis at outset (formulated retrospectively). Poor experiment definition. "Documentary evidence is an expected feature." Without it, "near impossible" to establish systematic experimentation.

**Platform reflection:** Architectural response (immutable hypothesis_formed_at, knowledge_search_record, first_recorded_at) is correct. The gap (Section 3.3) on knowledge search predating hypothesis is the most direct exposure. Make `evidence_kept_categories` a hard gate (not just warning).

### Bakarich (December 2024)

**Held:** $13.6M promoter penalties for advisors filing R&D claims "without any regard to whether activities even qualified."

**Platform reflection:** Section 2.5 — promoter exposure flag in compliance layer.

---

## Section 5 — Software-Specific Considerations

### 5.1 — Documentation Expectations Specific to Software R&D

**Industry guidance:** Git commit histories, PR logs, branch histories serve as contemporaneous records of experimental progression. Sprint records (JIRA/Linear) filtered by R&D activity code provide systematic-progression evidence.

**Gap:** No table linking software development artefacts (repo URLs, commit SHAs, PR numbers) to activities.

**Recommendation:** New migration `0048_activity_evidence_artefacts.sql`: `activity_evidence_artefact` table with kind enum (`git_commit`, `pull_request`, `sprint_record`, `jira_ticket`, `test_result`, `lab_notebook`, `photo_video`, `literature_search`, `expert_consultation`, `other`), URL, date, description.

**Severity:** High. Body by Michael makes documentary linkage critical.

### 5.2 — ATO Metadata Review of Photos/Videos

**Rule:** RSM 2025: "ATO now examining metadata on supporting photos and videos." EXIF/file metadata timestamps verified against claim period.

**Recommendation:** Warning in Portal Pack export: "Photo/video evidence files should have unmodified metadata timestamps. Do not use compressed or re-exported files."

**Severity:** Medium (UI guidance only).

### 5.3 — Far Side Case Study Teaching Points

(a) Knowledge frontier investigation required — covered structurally.
(b) Competent professional test is central — `why_competent_professional_couldnt_know` field correctly named.
(c) Supporting activities must not independently produce goods/services — `produces_good_or_service: boolean` covers this.
(d) Far Side predates one-strike policy. Portal Pack guidance text should note each criterion now independently assessed.

### 5.4 — IntelliHR Worked Example

Source not accessible (404 on direct customer-story URL). Flagged as unverified.

### 5.5 — Distinguishing "Routine Software Development" from Eligible R&D

Patterns to flag in Agent B prompt:
- Whole-of-project registration
- UI/UX iterations without architectural uncertainty
- Customising existing platform to client requirements
- Agile methodology as "evidence" of systematic experimentation (process ≠ hypothesis)

**Severity:** High for Agent B prompt — gatekeeper for what enters claim register.

---

## Section 6 — Active Taxpayer Alerts

### TA 2017/5 — Whole-of-project software claims (active since 2017)

Detection: flag activities with anomalous description-to-expenditure ratio OR exceeding configurable share of total claim. Pattern-match lifecycle scope.

### TA 2017/5A — Dominant purpose addendum

Detection: Verify supporting activities mentioning admin/management/reporting also carry mechanism-of-support narrative.

### TA 2023/4 — Associated entities (Dec 2023, active)

Detection: Already in `beneficial_ownership.ta_2023_4_flag`. Add `at_risk_flag` for associate-sourced expenditure (Section 2.4).

### TA 2023/5 — Overseas R&D for foreign related entities (Dec 2023, active)

Detection: Already in `beneficial_ownership.ta_2023_5_flag`. Add `has_foreign_parent` flag. Auto-raise `ta_2023_5_review_required` when foreign parent + overseas activities.

---

## Section 7 — Suggested Plan Additions

See `2026-05-05-rdti-skill-parity-v2-additions.md` for the actionable plan tasks. Summary:

### Sprint A additions
- A.9 — Per-criterion scoring in Agent C prompt (Section 2.1, one-strike) — Critical
- A.10 — `one_strike_risk_score` in portal export (Section 2.1) — Critical

### Sprint B additions
- B.6 — Daily-compound SIC formula (Section 2.2) — High
- B.7 — At-risk flag in expenditure classifier (Section 2.4) — High

### Sprint C additions
- C.5 — Hard gate on `evidence_kept_categories` — Critical (Body by Michael)
- C.6 — `promoter_exposure_flag` for low-probability claim concentration — High (Section 2.5)
- C.7 — Whole-of-project registration heuristic — High (Section 3.2 / TA 2017/5)
- C.8 — Knowledge search predates hypothesis — Critical (Section 3.3 / Body by Michael)
- C.9 — Tobacco/gambling exclusion check — Medium (Section 2.3)
- C.10 — GIC rate to compliance_config table — Medium (Section 3.4)

### Sprint D additions
- D.6 — IP ownership + strategic control fields — Critical (Section 2.6)
- D.7 — Contractor count + expenditure — Medium (Section 2.7)
- D.8 — `has_foreign_parent` boolean + ta_2023_5_review_required flag — High (Section 6)

### NEW Sprint E — Evidence Artefacts (~2-3 days)
- E.1-E.4 — `activity_evidence_artefact` table + endpoint + form-completeness gating + photo/video metadata advisory — High (Section 5.1)

---

## Sources

- Moreton Resources [2019] FCAFC 120 — RSM Australia commentary
- Active Sports Management — Swanson Reed
- TA 2023/4 + TA 2023/5 — Swanson Reed
- GQHC [2024] AATA 409 — Swanson Reed
- Body by Michael [2025] ART — Intellect Labs
- Bakarich (Dec 2024) — KPMG Tax News Flash
- ATO Shortfall Interest Charge guidance
- Grant Thornton FY25 R&D Tax Files Wrap-Up
- RSM "Reflecting on 2025" R&DTI year-end review
- TA 2017/5 — ATO Legal Database
- 15 August 2025 Updated R&DTI Form — Intellect Labs
- One-Strike Policy — Treadstone
- business.gov.au software sector guide
- business.gov.au eligibility framework + Far Side case study
- GWN Consulting 2025 R&DTI changes summary
- RSF Consulting — Agile R&D documentation guide
- TA 2023/5 — EY Australia
