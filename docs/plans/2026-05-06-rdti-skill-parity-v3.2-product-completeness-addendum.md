# R&DTI Skill Parity Plan v3.2 — Product Completeness Addendum

**Companion to:** v1 plan + v2 + v3 + v3.1 SERD
**Source:** End-to-end product assessment of cpa-platform mapped against the rdti-workflow skill's 4-phase consultant workflow (ingestion → activity assessment → narrative writing → expenditure → compilation/lodgement)
**Date added:** 2026-05-06

## TL;DR

v1/v2/v3 closed **compliance correctness** gaps (does the math match Division 355?). v3.1 added **regulatory monitoring** (will we know when the law changes?). v3.2 closes a third axis the prior plans never measured: **consultant workflow completeness** — does the platform save consultant time end-to-end, or only at certain moments?

The honest assessment: the platform is **strong on compliance scaffolding** (statutory-aware schema, append-only events, content hashing, raw_payload preservation, hypothesisFormedAt immutability) but **weak on the bulk consultant workflow** (no document ingestion, no cross-reference reconciliation, only 3 of 8+ PDFs shipped, no production-grade narrative drafter at scale). This is the gap between "evidence capture tool" and "claim compilation platform."

**v3.2 adds 18 new tasks across one new sprint (F) + additions to A, B, E.** Estimated effort ~22-28 days.

## Why this addendum

The product assessment surfaces gaps that the compliance-axis reviews missed because they are not compliance defects — they are workflow holes. A consultant using the platform today still:

- Manually sorts uploaded PDFs/DOCX/emails outside the platform (no bulk parser)
- Manually reconciles whether timesheet hours match activities described in project reports (no reconciliation engine)
- Manually writes 13 portal fields per Core activity + 10 per Supporting activity from scratch (drafter not productionized; no live char counter)
- Manually assembles the final submission pack from 5 missing PDF documents (Executive Summary, Activity Register, Portal Pack, Expenditure Schedule, Evidence Index, Compliance Notes)
- Manually applies overhead apportionment + staff on-costs to expenditure (engine missing)

The rdti-workflow skill defines these as "what the consultant does." If the platform's claim is "we replace the manual workflow," each missing piece is a credibility gap when a consultant tries to actually use it for a live claim.

## Map: 4 consultant phases × current state × gap × task

| Phase | Skill requires | Platform has today | Gap | New task |
|-------|----------------|--------------------|----|----------|
| 1 — Bulk Ingestion | Parse PDF/DOCX/XLSX/CSV/EML/PY/IPYNB; classify by evidence type; cross-reference timesheets↔invoices↔reports | Paste-to-classify (Haiku, 12 evidence kinds); Xero financial sync | No bulk doc parser; no reconciliation; no Ingest Summary | F.1, F.2, F.3 |
| 1 — Registration Form Extraction | Auto-extract company/financial/employee/project details | subject_tenant + project + claim + activity + beneficial_ownership tables (manual entry) | Manual entry only | (Acceptable — covered by F.1 once parser exists) |
| 2 — Activity Assessment | Apply s.355-25 across each activity; classify Core/Supporting/Ineligible; risk-level (L/M/H); rationale | Event-level Haiku classifier (12 kinds); per-criterion scoring (v2 A.9, v3 A.12) | No activity-level holistic statutory test; no risk_level enum | A.13, A.14 |
| 2 — Portal Narratives | 13 Core + 10 Supporting fields per activity, 4000-char limits, live counter, AusIndustry-portal-mapped | narrative_draft + narrative_segment tables; v1 A.1-A.8 portal-field structure | No live char counter UI; drafter agent not productionized | A.15, A.16 |
| 3 — Expenditure | 5 categories (Staff/Contractors/Materials/Overheads/Feedstock); apportionment; arm's-length; feedstock; offset rates by turnover | Xero sync; expenditure_mapping_rule; v1 B.2 feedstock + v3 B.3/B.8/B.9 | No overhead apportionment; no on-cost apportionment; no overseas R&D flagging | B.10, B.11, B.12 |
| 4 — Report Compilation | Portal-ready content pack + 6-section client report (Exec Summary, Activity Register, Portal Narratives, Expenditure Schedule, Evidence Index, Compliance Notes) | 3 PDFs: activity-application, apportionment-report, claim-summary | 5 of 8 PDFs missing | F.4, F.5, F.6, F.7, F.8, F.9 |
| Cross-cutting — Provenance | Contemporaneity provable | hypothesisFormedAt trigger (v1); content-hash chain; raw_payload | captured_at can be backdated at entry-time; no external anchor | E.5, E.6 |

## NEW Sprint F — Document Suite + Bulk Ingestion

This is a net-new sprint. It is the largest single addition across all addenda. Suggested calendar position: parallel to Sprint A (mostly independent — Sprint F.1-F.3 unblocks F.4-F.9 inputs, but F.4-F.9 PDFs can be drafted from existing schema once Sprint A primitives ship).

### Task F.1 — Bulk document parser registry

**Type:** Code (TDD)
**Severity:** Critical (blocks consultant workflow at the front door)

**Rationale:** The skill explicitly enumerates 8+ file types: `.xlsx, .csv, .pdf, .docx, .txt, .eml, .py, .ipynb`. Today the platform supports paste-to-classify only. A consultant onboarding a new client receives 50-200 source documents in a shared drive; they cannot paste each one.

**Files:**
- New package: `packages/ingest/`
  - `src/parsers/registry.ts` — parser registry with `register(extension, parser)` API
  - `src/parsers/pdf.ts` — pdf-parse + OCR fallback via tesseract.js for scanned PDFs
  - `src/parsers/docx.ts` — mammoth or docx4js for .docx → plaintext + structure
  - `src/parsers/xlsx.ts` — sheetjs (already present in deps?) for .xlsx → row stream
  - `src/parsers/csv.ts` — papaparse for .csv → row stream
  - `src/parsers/eml.ts` — mailparser for .eml → headers + body + attachments
  - `src/parsers/ipynb.ts` — JSON parse → cell stream (markdown + code)
  - `src/parsers/code.ts` — .py/.js/.ts/.r → comments + docstrings extraction
  - `src/parsers/index.ts` — `parseDocument(blob, mimeType): ParseResult`
- New schema: `packages/db/migrations/0053_ingestion_artefact.sql`
  ```sql
  CREATE TABLE ingestion_artefact (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id),
    subject_tenant_id uuid NOT NULL REFERENCES subject_tenant(id),
    source_filename text NOT NULL,
    source_mimetype text NOT NULL,
    source_sha256 text NOT NULL,
    parser_kind text NOT NULL,
    parser_version text NOT NULL,
    extracted_text text,
    extracted_structure jsonb,
    classified_evidence_kind text,
    classified_confidence numeric,
    uploaded_by uuid REFERENCES employee(id),
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_tenant_id, source_sha256)
  );
  ```
- New API: `POST /v1/ingestion/upload` (multipart, batches up to 100 files)
- Modify: `apps/web/src/app/(consultant)/clients/[id]/ingest/page.tsx` — drag-drop UI

**TDD per parser:**
- Test fixtures in `packages/ingest/test/fixtures/` for each format
- Each parser returns `{ text: string, structure: object | null }`
- Failure modes tested: corrupted file, password-protected PDF, empty file, oversized (>50MB)

**Effort:** ~5-7 days (parser-by-parser TDD; OCR pipeline is the biggest unknown).

### Task F.2 — Cross-reference reconciliation engine

**Type:** Code (TDD)
**Severity:** High (the skill explicitly requires this; ATO audits target reconciliation gaps)

**Rationale:** The skill: "Verify timesheet hours match activities described in project reports. Flag activities with no time records, costs with no activity link." The platform has expenditure + activity + time_entry tables but no automated audit.

**Files:**
- New: `packages/audit-score/src/reconciliation.ts`
  ```ts
  type ReconciliationFinding = {
    kind: 'activity_no_time' | 'activity_no_cost' | 'cost_no_activity' | 'time_no_activity'
        | 'timesheet_invoice_mismatch' | 'narrative_no_evidence';
    severity: 'high' | 'medium' | 'low';
    affected_id: string;  // activity_id, expenditure_id, or time_entry_id
    detail: string;
    suggested_action: string;
  };
  export function reconcileClaim(claim_id: string): Promise<ReconciliationFinding[]>;
  ```
- New API: `GET /v1/claims/:id/reconciliation` — returns findings list
- Modify: `apps/web/src/app/(consultant)/claims/[id]/page.tsx` — surface findings panel

**TDD:**
- Fixture: claim with 3 activities, 2 of which have time_entries, 1 of which has expenditure
- Expected findings: 1 × activity_no_cost, 1 × activity_no_time
- Edge cases: voided activities, supporting-activity-only costs

**Effort:** ~3-4 days.

### Task F.3 — Ingest Summary PDF

**Type:** Code (PDF template)
**Severity:** Medium (deliverable, not engine; explicitly required by skill)

**Files:**
- New: `packages/documents/src/templates/ingest-summary.tsx`
  - Section 1: Source documents inventory (count by parser_kind, total bytes, date range)
  - Section 2: Extraction quality (% with structure, OCR fallbacks invoked)
  - Section 3: Classification distribution (by evidence_kind)
  - Section 4: Reconciliation summary (forwarded from F.2)
  - Section 5: Source files list with SHA-256 (forensic provenance)
- API: `GET /v1/claims/:id/ingest-summary.pdf`

**Effort:** ~1 day.

### Task F.4 — Executive Summary PDF

**Type:** Code (PDF template)
**Severity:** High (lead document of the deliverable pack)

**Files:**
- New: `packages/documents/src/templates/executive-summary.tsx`
  - Header: claimant entity name, FY, claim ID, generated_at, content_hash
  - Section 1: Claim at a glance (total R&D spend, offset claimed, refund expected)
  - Section 2: Activities summary (N Core, N Supporting, total hours, total cost)
  - Section 3: Risk profile (forwarded from A.13/A.14 risk_level)
  - Section 4: Compliance posture (one-strike risk, at-risk findings, feedstock applicability)
  - Section 5: Reconciliation findings rolled up (forwarded from F.2)

**Effort:** ~1 day.

### Task F.5 — Activity Register PDF

**Type:** Code (PDF template)
**Severity:** High (skill calls out this as required deliverable)

**Files:**
- New: `packages/documents/src/templates/activity-register.tsx`
  - Per-activity row: code (CA-01), kind, title, hypothesis (truncated), uncertainty (truncated), risk_level, eligibility_score, total_hours, total_cost
  - Sortable by code or risk_level (PDF is static; sort applied at render)
  - Footer: register hash + generation timestamp

**Effort:** ~1 day.

### Task F.6 — Portal Narrative Content Pack PDF

**Type:** Code (PDF template — the largest one)
**Severity:** Critical (skill: "all 13 Core + 10 Supporting fields with character counts, mapped directly to AusIndustry portal")

**Files:**
- New: `packages/documents/src/templates/portal-narrative-pack.tsx`
  - For each Core Activity (CA-N):
    - Field 1-13 each rendered as: field number + AusIndustry label + char count `[2,847 / 4,000]` + body
    - Truncation warning if any field >4,000 chars
  - For each Supporting Activity (SA-N):
    - Field 1-10 each rendered same way
  - TOC at front; per-activity section break
  - Forensic chip per field linking to source events

**Effort:** ~2 days (heaviest PDF; 23 distinct field renderers).

### Task F.7 — Expenditure Schedule PDF

**Type:** Code (PDF template)
**Severity:** High (calculation-heavy; integrates v1 B.2 feedstock + v3 B.3 intensity + B.9 grant clawback)

**Files:**
- New: `packages/documents/src/templates/expenditure-schedule.tsx`
  - Section 1: Total R&D expenditure by category (Staff/Contractors/Materials/Overheads/Feedstock)
  - Section 2: Apportionment methodology (forwarded from B.10 overhead engine + B.12 on-costs)
  - Section 3: Per-activity allocation table (matches activity-register cross-reference)
  - Section 4: Feedstock adjustment (independent line per v3 B.8)
  - Section 5: Offset rate calculation (v3 B.3 two-slice intensity for ≥$20M turnover)
  - Section 6: Grant/subsidy clawback (v3 B.9)
  - Section 7: Final R&D offset benefit

**Effort:** ~1.5 days.

### Task F.8 — Evidence Index PDF

**Type:** Code (PDF template)
**Severity:** Medium

**Files:**
- New: `packages/documents/src/templates/evidence-index.tsx`
  - Per-activity: list of supporting events with content_hash, captured_at, source (paste/upload/Xero), evidence_kind
  - Per source document (from F.1): linked event IDs, total events extracted
  - Forensic provenance: full hash chain reference

**Effort:** ~1 day.

### Task F.9 — Compliance Notes PDF

**Type:** Code (PDF template)
**Severity:** Medium

**Files:**
- New: `packages/documents/src/templates/compliance-notes.tsx`
  - Section 1: At-risk findings (v2 B.7 + v3 B.7a/B.7b)
  - Section 2: One-strike risk score (v2 A.10) + per-criterion gaps (v2 A.9)
  - Section 3: Promoter exposure flags (v2 C.6)
  - Section 4: Body-by-Michael hypothesis-date verifications (v2 C.5)
  - Section 5: Whole-of-project / dominant-purpose checklist (v2 C.7)
  - Section 6: Tobacco/gambling exclusion check (v2 C.9 + v3 C.9 refinement)
  - Section 7: Foreign parent / contractor / IP ownership (v2 D.6/D.7/D.8)
  - Section 8: Overseas R&D / Overseas Findings (B.11)

**Effort:** ~1.5 days.

## Sprint A additions

### Task A.13 — Activity-level holistic eligibility scorer

**Type:** Code (TDD)
**Severity:** High (closes the gap between event-level classification and statutory adjudication)

**Source:** Skill phase 2 verbatim: *"Apply the eligibility test to each activity: What was technically uncertain? What hypothesis was tested? What systematic experimental approach was used? What was learned?"*

**Rationale:** v2 A.9 added per-criterion scoring (outcome_uncertainty, systematic_method, new_knowledge_purpose). v3 A.12 added risk_type (definitional/evidentiary/mixed). What is missing is the **aggregate** test that decides whether the FULL activity satisfies s.355-25 — not just the individual criteria. The classifier is an event-level triage tool; the scorer is an activity-level adjudicator.

**Files:**
- New: `packages/audit-score/src/eligibility-scorer.ts`
  ```ts
  type EligibilityVerdict = {
    s355_25_satisfied: boolean;
    confidence: number;  // 0-1
    criterion_scores: {
      outcome_uncertainty: { score: number; risk_type: 'definitional'|'evidentiary'|'mixed' };
      systematic_method: { score: number; evidentiary_completeness: string };
      new_knowledge_purpose: { score: number; risk_type: 'definitional'|'evidentiary'|'mixed' };
    };
    aggregate_rationale: string;
    recommended_classification: 'core'|'supporting'|'ineligible';
    blocking_failures: string[];
  };
  export function scoreActivityEligibility(activity_id: string): Promise<EligibilityVerdict>;
  ```
- The aggregate rule:
  - Any criterion with `risk_type: 'definitional'` → s355_25_satisfied = false (no remediation possible)
  - Any criterion score < 0.5 → s355_25_satisfied = false
  - All three ≥ 0.7 → s355_25_satisfied = true
  - Mixed → confidence dampened, surfaced for review

**Effort:** ~2 days.

### Task A.14 — risk_level enum on activity

**Type:** Schema + Code
**Severity:** Medium

**Files:**
- Migration `0054_activity_risk_level.sql`:
  ```sql
  CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
  ALTER TABLE activity ADD COLUMN risk_level risk_level;
  ALTER TABLE activity ADD COLUMN risk_level_computed_at timestamptz;
  ```
- Modify: `packages/audit-score/src/eligibility-scorer.ts` — derive risk_level from:
  - high: any blocking_failure OR confidence < 0.5
  - medium: confidence 0.5-0.8 OR any risk_type='evidentiary'
  - low: all clear

**Effort:** ~0.5 days.

### Task A.15 — Live 4000-char counter UI

**Type:** Frontend
**Severity:** Medium (consultant workflow ergonomics; AusIndustry portal hard limit)

**Files:**
- Modify: `apps/web/src/components/portal-field-editor.tsx` (NEW)
- Renders char counter `[N / 4,000]` in real time; turns terracotta at 3,800; clay-red + disable submit at 4,001
- Used by all 23 field editors (13 Core + 10 Supporting)

**Effort:** ~0.5 days.

### Task A.16 — Portal narrative drafter productionization

**Type:** Code (Agent)
**Severity:** Critical (skill phase 2 calls out narrative drafting as the highest-billable consultant work)

**Files:**
- New: `packages/agents/src/narrative-drafter/prompts/draft-narrative@1.2.0.ts`
  - Per-field structured output (one prompt per AusIndustry field, not one prompt per activity)
  - Returns `{ field_id: string, content: string, char_count: number, source_event_ids: string[] }`
  - Uses claude-opus-4-7 (was Opus 4.7 in v1 design)
  - Hard cap: 3,950 chars (50-char safety margin under AusIndustry's 4,000)
  - Citation requirement: every claim in narrative must cite ≥1 source event_id

**Effort:** ~2 days.

## Sprint B additions

### Task B.10 — Overhead apportionment engine

**Type:** Code (TDD)
**Severity:** High (skill phase 3 explicitly: "Overheads — apportionment by R&D %")

**Files:**
- New: `packages/audit-score/src/overhead-apportionment.ts`
  ```ts
  type OverheadCategory = 'rent'|'utilities'|'insurance'|'admin_salaries'|'depreciation'|'other';
  export function apportionOverhead(
    category: OverheadCategory,
    total_aud: number,
    rd_percentage: number,
    apportionment_basis: 'headcount'|'floorspace'|'time'|'revenue'
  ): { rd_aud: number; non_rd_aud: number; rationale: string };
  ```
- Migration `0055_overhead_apportionment.sql`: add `apportionment_basis` enum + column to expenditure

**Effort:** ~2 days.

### Task B.11 — Overseas R&D activity flag + Overseas Findings checklist

**Type:** Schema + UI
**Severity:** High (TA 2023/5 makes this a current high-risk audit focus)

**Files:**
- Migration `0056_overseas_rd.sql`:
  ```sql
  ALTER TABLE activity ADD COLUMN performed_overseas boolean NOT NULL DEFAULT false;
  ALTER TABLE activity ADD COLUMN overseas_country text;
  ALTER TABLE activity ADD COLUMN overseas_findings_required boolean NOT NULL DEFAULT false;
  ALTER TABLE activity ADD COLUMN overseas_findings_obtained boolean NOT NULL DEFAULT false;
  ALTER TABLE activity ADD COLUMN overseas_findings_reference text;
  ```
- Validation rule: `performed_overseas=true` AND `overseas_findings_obtained=false` → blocks claim submission with clay-red error
- Surface in F.9 Compliance Notes PDF

**Effort:** ~1 day.

### Task B.12 — Staff on-cost apportionment

**Type:** Code
**Severity:** Medium (closes a chronically under-claimed expenditure category)

**Files:**
- Modify: `packages/audit-score/src/expenditure-allocator.ts`
- Add on-cost categories: super (default 11.5% per ATO 2026), leave loading, workers comp, payroll tax
- Apportion by same R&D % as base salary (per TR 2021/5 employee remuneration)

**Effort:** ~1.5 days.

## Sprint E additions

### Task E.5 — External timestamp anchoring (RFC 3161)

**Type:** Code
**Severity:** High (closes the captured_at-can-be-backdated vulnerability)

**Rationale:** Today, captured_at is whatever the consultant types/pastes. The hash chain locks it once entered, but proves nothing about whether it was entered contemporaneously with the R&D. RFC 3161 timestamps from a trusted TSA (e.g., FreeTSA, DigiCert) anchor each event to wall-clock time at entry, externally provable.

**Files:**
- New: `packages/audit-score/src/timestamp-anchor.ts`
  - On event insert, asynchronously fetch RFC 3161 timestamp from configured TSA
  - Store opaque token + TSA URL in new column `event.tsa_token`
  - Verifier: re-validate token against TSA cert chain
- Migration `0057_event_tsa.sql`:
  ```sql
  ALTER TABLE event ADD COLUMN tsa_token bytea;
  ALTER TABLE event ADD COLUMN tsa_url text;
  ALTER TABLE event ADD COLUMN tsa_anchored_at timestamptz;
  ```
- TSA selection: configurable per tenant; default to FreeTSA (free) with DigiCert as paid upgrade

**Effort:** ~2 days.

### Task E.6 — Backdating audit query + drift dashboard

**Type:** SQL + Admin UI
**Severity:** Medium (forensic readiness)

**Files:**
- New SQL view `packages/db/migrations/0058_v_event_drift.sql`:
  ```sql
  CREATE VIEW v_event_drift AS
  SELECT e.id, e.kind, e.captured_at, e.created_at,
         EXTRACT(EPOCH FROM (e.created_at - e.captured_at))/86400.0 AS days_lag,
         e.subject_tenant_id, e.tenant_id
  FROM event e
  WHERE e.created_at - e.captured_at > interval '14 days';
  ```
- New admin page `/admin/audit/drift` — displays events with >14-day lag for forensic review
- Surface drift summary in F.4 Executive Summary

**Effort:** ~0.5 days.

## Effort summary

| Sprint | Prior (v3) | v3.2 additions | v3.2 total |
|--------|------------|----------------|------------|
| A | ~7-9 days | +5 days (A.13/A.14/A.15/A.16) | ~12-14 days |
| B | ~6-7 days | +4.5 days (B.10/B.11/B.12) | ~10.5-11.5 days |
| C | ~7-8 days | unchanged | ~7-8 days |
| D | ~3-4 days | unchanged | ~3-4 days |
| E | ~2-3 days | +2.5 days (E.5/E.6) | ~4.5-5.5 days |
| **F (NEW)** | — | **+15 days** (F.1-F.9) | **~15 days** |
| Pre-merge correction (B.3 two-slice) | +0.5 day | unchanged | +0.5 day |
| Final E2E | ~1.5 days | +1 day (PDF suite integration) | ~2.5 days |
| **Total** | **~25-32 days** | **+28 days** | **~53-60 days** |

Calendar: extends from ~5-6 weeks to **~10-12 weeks**.

## Coverage outcome — two-axis

The prior addenda used a single percentage. v3.2 splits it into two axes because they measure different things:

| Plan version | Compliance correctness | Workflow completeness |
|--------------|------------------------|----------------------|
| v1 | ~85% | ~30% |
| v1 + v2 | ~98% | ~30% |
| v1 + v2 + v3 | ~99% | ~30% |
| v1 + v2 + v3 + v3.1 | ~99% | ~30% |
| **v1 + v2 + v3 + v3.1 + v3.2** | **~99%** | **~95%** |

The 99% compliance was always 99% compliance — v3.2 doesn't move that needle. What v3.2 changes is the SECOND axis: "can a consultant actually run an end-to-end claim through this platform without escaping to Excel and Word?" Today: no. After v3.2: yes for ~95% of the workflow (the 5% deferred is still the long-tail of low-volume edge cases — bespoke industry-specific evidence, multi-jurisdiction overseas R&D combinations, and any rules introduced after May 2026).

## What v3.2 does NOT do

- Does not add the mobile claimant app (separate roadmap; partial scaffolding in `apps/mobile/`)
- Does not add the federation/financier sharing primitives (P9.3 separate roadmap)
- Does not add white-label tenant branding beyond what brand_config already supports
- Does not productionize the grant module (CRC-P, ARENA — separate skill, separate roadmap)
- Does not add an Assurance Report compiler beyond Sprint E artefacts (the cryptographic verification statement is ALREADY in P5 design; v3.2 just feeds the PDFs into it)

## Bottom line

The platform's compliance scaffolding is genuinely sophisticated. What's missing is not legal — it's product. v3.2 says: build the parser registry, the reconciliation engine, the 5 missing PDFs, the activity-level scorer, the live char counter, the productionized drafter, the overhead/on-cost engines, the overseas R&D flag, and the external timestamp anchor. After that the platform replaces the consultant's Excel + Word + email-folder + ad-hoc-PDF stack instead of sitting alongside it.

That is the difference between "we built a compliance tool" and "we built the operating system for an R&DTI consultancy."

End of v3.2 additions.
