# Output exemplars — gold standards for the document-generation pipeline

This directory holds reference outputs that the platform's AI agents and document
generators must reproduce at equivalent quality. They are **inputs to prompts**
(few-shot exemplars) and **acceptance bars for engineering tests**.

## Files

### `ausindustry-application-FY25-26-gold.txt`

A complete, portal-ready AusIndustry R&D Tax Incentive registration application,
produced by a hand-tuned Claude skill against a single fiscal year's evidence
for the **NEM Digital Twin for BESS FCAS Optimisation** project (Jonaz Power and
Flow Pty Ltd, FY2025-26). ~128KB, 2,047 lines, 5 core + 2 supporting activities.

**Why this exists:** when the user upload the same evidence into both their
Claude skill and the platform, the skill produces this; the platform produces
short generic summaries. This file pins the quality bar so prompts and document
generators can be rewritten against it.

**Structural anchors** (every prompt and renderer in this domain must respect
these):

#### Top-level sections

1. **Submission summary** — activity list (table) + nexus matrix (matrix of
   supporting × core activities with bullet links)
2. **Applicant & registration details** — 4 sub-sections: company details
   (ABN/ACN/ANZSIC), financial details (turnover, R&D expenditure, govt grants),
   employee details (FTE, STEM qualifications), project-level details (name,
   description, start/end dates, FY expenditure)
3. **Core R&D activities** — one full record per activity (CA-01 … CA-NN)
4. **Supporting R&D activities** — one record per (SA-01 … SA-NN), reduced
   field set
5. **Expenditure schedule** — summary of allocations across activities
6. **Evidence index** — list of all evidence documents with type, date,
   activity binding
7. **Compliance checklist & submission notes** — Div 355 self-certification

#### Core activity record (the 13 portal fields)

Each core activity record opens with a header block:

| Field                        | Source                                                   |
| ---------------------------- | -------------------------------------------------------- |
| Activity ID                  | `CA-NN` (numbered in order)                              |
| Project phases               | derived from time_log + design events                    |
| Period                       | within FY, ISO dates                                     |
| Estimated expenditure        | derived from EXPENDITURE_NOTE events + apportionment     |
| Hypotheses                   | `H1`, `H2`, … (cross-references the hypothesis register) |
| Linked supporting activities | `SA-01`, `SA-02` etc                                     |

Then the 13 portal fields in order:

| #   | Field name                                                              | Portal prompt                                                                                                | Hard limit  | Typical length (gold)                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | ACTIVITY NAME                                                           | "Provide a clear, descriptive name"                                                                          | 4,000 chars | 60-80 chars                                                                                                                                      |
| 2   | DESCRIBE THE CORE R&D ACTIVITY                                          | "Briefly describe what will be conducted and what is planned to be achieved"                                 | 4,000 chars | 1,900-2,200 chars                                                                                                                                |
| 3   | HOW DID THE COMPANY DETERMINE THE OUTCOME COULD NOT BE KNOWN IN ADVANCE | (multi-select checkboxes)                                                                                    | n/a         | 3 checkboxes typical: no applicable literature, expert advice confirmed no solution, no adaptation from other companies                          |
| 4   | SOURCES INVESTIGATED AND FINDINGS                                       | "Please explain what sources were investigated and what information was found"                               | 4,000 chars | 2,000-2,400 chars                                                                                                                                |
| 5   | WHY COULDN'T A COMPETENT PROFESSIONAL KNOW THE OUTCOME                  | "Why couldn't a competent professional have known or determined the outcome in advance?"                     | 4,000 chars | 2,100-2,400 chars                                                                                                                                |
| 6   | HYPOTHESIS                                                              | "What is the hypothesis?"                                                                                    | 4,000 chars | 1,900-2,200 chars. Multi-hypothesis: explicitly numbered (H1, H2, H3...), each with pre-registered falsifiable acceptance criteria               |
| 7   | EXPERIMENT DESCRIPTION                                                  | "What is the experiment and how will it / did it test the hypothesis?"                                       | 4,000 chars | 2,000-2,300 chars                                                                                                                                |
| 8   | EVALUATION METHODOLOGY                                                  | "How did you evaluate or plan to evaluate results from your experiment?"                                     | 4,000 chars | 1,900-2,100 chars. Statistical tests + acceptance criteria explicit                                                                              |
| 9   | CONCLUSIONS                                                             | "If you reached conclusions from your experiments in the selected income period, describe those conclusions" | 4,000 chars | 1,900-2,100 chars. Per-hypothesis validated/partially-validated/failed with quantitative results, references documented failures (F1, F2, F3...) |
| 10  | EVIDENCE KEPT                                                           | (multi-select checkboxes)                                                                                    | n/a         | 5 boxes typical: hypothesis-design, results-evaluation, revisions, search-enquiries, systematic-progression                                      |
| 11a | NEW KNOWLEDGE PURPOSE                                                   | "Was the purpose to generate new knowledge?"                                                                 | yes/no      | yes (for core activities)                                                                                                                        |
| 11b | NEW KNOWLEDGE DESCRIPTION                                               | "Describe the new knowledge created"                                                                         | 4,000 chars | 800-1,500 chars                                                                                                                                  |
| 12  | EXPENDITURE                                                             | (numeric AUD, ex-GST + breakdown)                                                                            | n/a         | references expenditure schedule                                                                                                                  |
| 13  | RELATED SUPPORTING ACTIVITIES                                           | (multi-select of SA-NN codes)                                                                                | n/a         | 1-N supporting activities                                                                                                                        |

#### Supporting activity record (reduced field set)

Supporting activities don't need to meet the systematic-experimentation test
(s.355-25). They need to satisfy the dominant-purpose test (s.355-30). Reduced
field set, but still substantial: nexus to which core activities it supports,
description of the support work, why it predominantly supports R&D.

#### Cross-cutting registers

The document references three registers that the platform's chain ledger
should produce alongside the application:

- **Hypothesis register** — H1, H2, …, H12 — each: hypothesis text,
  pre-registration date, falsifiable acceptance criteria, validation
  outcome
- **Failure register** — F1, F2, …, F10 — each: approach attempted, result
  observed, root cause, knowledge gained, pivot action
- **New knowledge register** — NK1, NK2, …, NK8 — each: quantified
  threshold/benchmark/methodology/finding that was not knowable in advance

These map cleanly onto the existing chain event kinds:

- HYPOTHESIS (→ hypothesis register entries)
- ITERATION (→ failure register entries, with payload.failure_id = F1, F2, ...)
- NEW_KNOWLEDGE (→ new knowledge register entries)

## How prompts should use these exemplars

1. **Few-shot anchor.** Include the entire CA-01 record as a worked example in
   the system prompt for the application-drafter agent. Show the model what
   "good" looks like before asking it to produce a new activity record.
2. **Length calibration.** Tell the model the per-field typical-length range
   (e.g., FIELD 4 should be 2,000-2,400 chars) — Sonnet defaults to ~500-800
   chars otherwise.
3. **Statutory anchoring.** Reference s.355-25 and s.355-30 explicitly in each
   field where they apply (the gold doc does this).
4. **Citation density.** Fields 4 and 5 should cite specific sources (authors,
   year, journal, page). The model produces hand-wavy references otherwise.
5. **Quantitative rigor.** Field 9 (conclusions) must include specific
   numbers (RMSE values, accuracy scores, p-values) sourced from the evidence
   events. Reject conclusions that are qualitative-only.

## How to add a new exemplar

When a high-quality output gets produced (by the platform or by a hand-tuned
process), save it here. Document:

- Source project + fiscal year
- What pipeline produced it
- What field structure it codifies (if different from the AusIndustry gold)
- What gaps in the platform's output it exposes

Keep filenames lowercase, hyphen-separated, dated where useful. The
human-readable text version is the canonical form; PDFs / DOCX are convenience.
