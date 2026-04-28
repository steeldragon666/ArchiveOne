# P4 Design — First Documents & Activity Register

**Date:** 2026-04-28
**Status:** Approved (brainstorm complete; awaiting implementation plan)
**Anchor docs:**

- Product spec: [`docs/product/2026-04-27-omniscient-feature-spec.md`](../product/2026-04-27-omniscient-feature-spec.md)
- Phase mapping: [`docs/product/2026-04-27-spec-to-phase-mapping.md`](../product/2026-04-27-spec-to-phase-mapping.md)
- Prior phase: [`docs/plans/2026-04-27-p3-mobile-scribe-design.md`](2026-04-27-p3-mobile-scribe-design.md)

---

## Goal

Ship the **evidence-and-compliance moat** end-to-end: project model, R&DTI activity register with hierarchical CA-##/SA-## IDs, technical-uncertainty register, source-artefact linkage, full-source expenditure ingestion (Xero invoices + bank transactions + reimbursed expense claims + manual entries), invoice-to-activity cross-walk, three deterministic audit-defensible documents, and the 7-stage Module 4 pipeline UI. P4 turns the platform from "captures evidence" into "produces audit-ready submissions."

## Modules covered

- **Module 1 advanced** in full: activity register CA/SA IDs, technical uncertainty register, project model populated, invoice-to-activity cross-walk
- **Module 4** pipeline + workflow (consultant productivity dashboard, QMS module, knowledge base remain in P8/P9)
- **Module 5 Tier A** (early): real Xero accounting integration (MYOB deferred to P5; AusIndustry portal API deferred to P9)

## Pillars advanced

- Pillar 1 (compliance-grade by default) — every R&D dollar accounted for in cross-walk artefact; activity register locked to Division 355 wording; document content-hashed on the chain
- Pillar 3 (AU-native) — Xero-first integration matching Synnch's only differentiator; AusIndustry portal field naming preserved in skeleton documents
- Pillar 4 (closed system, citation-grounded) — every document derives from the live event chain + structured DB rows; nothing fabricated; document SHA-256 logged on the chain at every generation

---

## Decision log

The brainstorm produced 9 decisions before design sections. Each is recorded here verbatim from the conversation.

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Scope of P4 | **A — Full P4 per the canonical spec.** All 5 deliverables (project + activity register + technical uncertainty register + invoice cross-walk + Module 4 pipeline workflow). |
| Q2 | What is a "project" | **C — Hybrid project + claim layers.** `project` = long-lived R&D undertaking; `claim` = per-FY application. Activities link to both. Matches AusIndustry submission shape AND consultant mental model. |
| Q3 | Invoice cross-walk source | **B — Real Xero in P4, MYOB deferred to P5.** Xero is the dominant AU mid-market accounting tool; Synnch is Xero-only globally so we must match. MYOB users use manual entry in P4. |
| Q4 | Activity edit + audit model | **A — Activities are mutable rows; every edit creates a new event on the existing P2 chain.** Add new evidence kinds (ACTIVITY_CREATED / UPDATED / LOCKED). Single audit mechanism — extends the moat already shipped in P2. |
| Q5 | Module 4 pipeline | **A + N — Canonical 7-stage pipeline + Kanban + Tabular toggle.** Stages: `engagement` → `activity_capture` → `narrative_drafting` → `expenditure_schedule` → `review` → `submitted` → `audit_defence`. Both views over the same data. |
| Q6 | Document generation scope | **B — Three deterministic documents.** Activity application skeleton (AusIndustry portal mirror, no AI narrative — that is P5), expenditure schedule (FY total + breakdowns), ATO cross-walk artefact (one-page table). Engagement letter, QMS forms, internal review checklist deferred. |
| Q7 | Invoice-to-activity mapping | **A — Manual + rules, no AI in P4.** Drag-drop / dropdown per line item; rules engine for vendor / account-code / description-pattern auto-mapping with priority ordering. AI suggestions deferred to P5 (will reuse P2 classifier scaffolding when added). |
| Q8 | Source-artefact linkage | **B — `ARTEFACT_LINKED` event kind on the chain.** No join table. Linkages are events; queries filter the chain. Matches Q4's "everything rides on the chain" principle. P9 may add a materialised view for performance. |
| Q9 | AusIndustry submission integration | **A — Manual flag + reference number entry.** Consultant submits via the AusIndustry portal directly, returns to our system, marks the claim submitted with reference number. Real portal API deferred to P9. |
| Scope-add | Bank transactions + reimbursed expenses | Generalised `invoice` to `expenditure` covering 4 sources: Xero invoices (ACCPAY), Xero bank transactions (SPEND), Xero receipts (Expenses module), and admin-entered manual entries. Single mapping flow, single cross-walk artefact, source visible for filtering and audit. |

---

## Architecture

### Core tables (new in P4)

```
project
  id              uuid PRIMARY KEY
  tenant_id       uuid NOT NULL  → tenant.id
  subject_tenant_id uuid NOT NULL  → subject_tenant.id
  name            text NOT NULL                            -- e.g. "ML pipeline rebuild"
  description     text
  started_at      timestamptz NOT NULL
  ended_at        timestamptz                              -- nullable; null = ongoing
  archived_at     timestamptz                              -- soft delete
  created_at, updated_at
  -- RLS: tenant_id = current_setting('app.current_tenant_id')

claim
  id              uuid PRIMARY KEY
  tenant_id       uuid NOT NULL
  subject_tenant_id uuid NOT NULL
  fiscal_year     int  NOT NULL                            -- 2025 = FY ending June 2025
  stage           text NOT NULL                            -- 7-stage enum
  ausindustry_reference text                               -- entered on submission
  submitted_at    timestamptz                              -- set when stage advances to 'submitted'
  submitted_by_user_id uuid
  created_at, updated_at
  UNIQUE (subject_tenant_id, fiscal_year)

activity
  id              uuid PRIMARY KEY
  tenant_id       uuid NOT NULL
  project_id      uuid NOT NULL  → project.id
  claim_id        uuid NOT NULL  → claim.id
  code            text NOT NULL                            -- "CA-01" or "SA-01"
  kind            text NOT NULL                            -- 'core' | 'supporting'
  title           text NOT NULL
  description     text
  hypothesis      text                                     -- canonical statement; chain has revisions
  technical_uncertainty text
  experimentation_log text
  expected_outcome text
  actual_outcome  text
  created_at, updated_at
  UNIQUE (claim_id, code)

expenditure
  id              uuid PRIMARY KEY
  tenant_id       uuid NOT NULL
  subject_tenant_id uuid NOT NULL
  source          text NOT NULL                            -- 'xero_invoice' | 'xero_bank_tx'
                                                           -- | 'xero_receipt' | 'manual'
  source_external_id text                                  -- Xero ID; null for manual
  vendor_name     text NOT NULL
  reference       text                                     -- invoice #, bank ref, receipt #
  expenditure_date date NOT NULL
  total_amount    numeric(12, 2) NOT NULL
  currency        text NOT NULL                            -- AUD only in P4
  reimbursed_to_user_id uuid                               -- non-null for employee expense claims
  raw_payload     jsonb NOT NULL                           -- full source response for audit
  ingested_at     timestamptz NOT NULL DEFAULT now()
  voided_at       timestamptz
  UNIQUE (tenant_id, source, source_external_id)
    WHERE source_external_id IS NOT NULL                   -- partial: manual entries don't need uniqueness

expenditure_line
  id              uuid PRIMARY KEY
  expenditure_id  uuid NOT NULL  → expenditure.id
  description     text NOT NULL
  account_code    text                                     -- Xero account code
  amount          numeric(12, 2) NOT NULL
  rd_percent      int                                      -- apportionment % (0-100); null = unmapped

expenditure_mapping_rule
  id              uuid PRIMARY KEY
  tenant_id       uuid NOT NULL
  source          text                                      -- per-source or '*' (any)
  vendor_pattern  text                                      -- regex
  account_code    text                                      -- exact
  description_pattern text                                  -- regex
  activity_id     uuid NOT NULL  → activity.id
  rd_percent      int NOT NULL
  priority        int NOT NULL                             -- highest match wins
  created_at, updated_at
```

All new tables get FORCE ROW LEVEL SECURITY with `tenant_id` policies plus FK + CHECK constraints, hand-authored in migrations 0012-0014 following the P2 / P3 convention (DO NOT REGENERATE header).

### Event chain extensions

The existing P2 hash chain (per-`subject_tenant`, SHA-256, append-only with OVERRIDE) is extended with new evidence kinds. **No P2 backward-compat impact** — existing event hashes remain byte-identical because `canonicaliseEvent` already conditionally includes nullable / optional fields (P3 fix for `captured_by_employee_id`).

```
ACTIVITY_CREATED          payload: { activity_id, code, kind, title, project_id, claim_id }
ACTIVITY_UPDATED          payload: { activity_id, fields_changed: { hypothesis: { from, to }, ... } }
ACTIVITY_LOCKED           payload: { activity_id, locked_by_user_id, lock_reason }
ARTEFACT_LINKED           payload: { activity_id, artefact_kind, artefact_id, link_reason? }
ARTEFACT_UNLINKED         payload: { activity_id, artefact_kind, artefact_id, reason? }
EXPENDITURE_INGESTED      payload: { expenditure_id, source, vendor_name, line_count }
EXPENDITURE_LINE_MAPPED   payload: { expenditure_line_id, activity_id, rd_percent, mapped_via, rule_id? }
EXPENDITURE_LINE_UNMAPPED payload: { expenditure_line_id, prior_activity_id, reason? }
EXPENDITURE_VOIDED        payload: { expenditure_id, voided_at, reason? }
CLAIM_STAGE_ADVANCED      payload: { claim_id, from_stage, to_stage, advanced_by_user_id }
CLAIM_SUBMITTED           payload: { claim_id, ausindustry_reference, submitted_by_user_id }
PROJECT_CREATED           payload: { project_id, name, started_at }
PROJECT_ARCHIVED          payload: { project_id, archived_by_user_id, reason? }
DOCUMENT_GENERATED        payload: { doc_kind, claim_id, generated_for_user_id, content_sha256 }
```

Existing kinds (`HYPOTHESIS`, `UNCERTAINTY`, `EXPERIMENT`, `OBSERVATION`, `ITERATION`, `NEW_KNOWLEDGE`, `TIME_LOG`, `EXPENDITURE_NOTE`, `ASSOCIATE_FLAG`, `INELIGIBLE`, `SUPPORTING`, `OVERRIDE`) continue unchanged. The technical-uncertainty register is rendered as a filtered query: events of kind `HYPOTHESIS` / `UNCERTAINTY` / `EXPERIMENT` / `OBSERVATION` / `ITERATION` / `NEW_KNOWLEDGE` whose payload has `activity_id` set.

### Activity-claim-project relationship

- An **activity** belongs to exactly one project AND exactly one claim
- A **project** can have multiple activities across multiple claims (a long-running R&D effort)
- A **claim** has activities specific to its FY; CA-XX / SA-XX numbering is per-claim
- Soft-delete on project via `archived_at`; activities cascade to archived state when project archived

---

## Module 4 pipeline

### 7-stage canonical pipeline

```
engagement → activity_capture → narrative_drafting → expenditure_schedule
            → review → submitted → audit_defence
```

| Stage | What's happening | Exit criterion |
| --- | --- | --- |
| `engagement` | Engagement letter signed; consultant assigned | First activity created |
| `activity_capture` | Mobile + portal capture of evidence; activities edited | Consultant marks "ready to draft" |
| `narrative_drafting` | (P5) AI drafter writes narratives; P4 ships skeleton form for manual entry | Activity application document approved |
| `expenditure_schedule` | Apportionment + invoice cross-walk completed | Expenditure schedule generated + reviewed |
| `review` | Internal QMS review; supervisor sign-off (P9 = full QMS module) | Reviewer marks ready-to-submit |
| `submitted` | Consultant submitted via AusIndustry portal; reference captured | Terminal until inquiry |
| `audit_defence` | AusIndustry inquiry / Finding application underway | Manual close when resolved |

**Stage advance:** any consultant or admin can advance forward; only admin can revert backward. Each transition writes a `CLAIM_STAGE_ADVANCED` event on the chain.

**Stage gates:**
- Cannot advance beyond `expenditure_schedule` if `claim.activities` count is 0
- Cannot advance to `submitted` without an `ausindustry_reference` value
- Cannot move backward from `submitted` (post-submission edits are a P9 versioning concern)

### UI

- **Kanban view** (`/pipeline?view=kanban`) — 7 columns; drag-drop forward; context-menu revert (admin); bulk multi-select
- **Tabular view** (`/pipeline?view=table`) — sortable, filterable, multi-select for bulk operations, dense for spreadsheet-style work
- **Claim detail** (`/claims/[id]`) — tabs: Activities, Evidence, Expenditure, Documents, Timeline

---

## Document generation

All three documents are **deterministic** PDF generation via `@react-pdf/renderer` (Node-runnable, ~250 kB runtime, has table primitives). Documents are **not stored as files** — re-rendered from current state on every request, hash-stamped at generation time, returned as a streamed PDF. Every generation creates a `DOCUMENT_GENERATED` event with `content_sha256` for audit reconstruction.

### 1. Activity application skeleton

(`/claims/[id]/documents/activity-application.pdf`)

Cover page: claimant, FY, registration reference (if submitted), generated-on date.

Per-activity sections: code, title, dominant-purpose statement, hypothesis, technical uncertainty, systematic experimentation log, expected outcome, actual outcome.

AusIndustry portal field-naming preserved; word-count indicators in the UI. P4 ships blank narrative fields; P5's AI drafter populates.

### 2. Expenditure schedule

(`/claims/[id]/documents/expenditure-schedule.pdf`)

FY total + per-activity breakdown.

Per-activity: salary (from time entries × `rd_percent`), contractor invoices, materials (Xero accounts), reimbursed claims, other.

`ASSOCIATE_FLAG` evidence kind (already in P2) highlights TA 2023/4 / TA 2023/5 rows. Dominant-purpose test note for SA-XX entries.

### 3. ATO cross-walk artefact

(`/claims/[id]/documents/cross-walk.pdf`)

One-page table — every R&D dollar in the FY, mapped to an activity ID:

```
Date       Source       Vendor       Description           Acct  Amount  RD%   Activity   Evidence
─────────────────────────────────────────────────────────────────────────────────────────────────
2024-08-12 Invoice      AWS          EC2 compute Aug 24    6500  $4,200  100%  CA-01      INV-1234
2024-08-15 Bank tx      GitHub       Subscription          6500  $99     100%  CA-01      BT-5678
2024-08-20 Reimbursed   Sarah Patel  Prototype components  6300  $500    100%  CA-02      RC-9012
2024-08-22 Manual       (Cash)       USB drives            6300  $48     100%  CA-02      MAN-0001
─────────────────────────────────────────────────────────────────────────────────────────────────
                                                FY24 R&D total: $4,847    Activities covered: 2
```

Footer: SHA-256 of canonical content, timestamp, generator version.

---

## Xero accounting integration

### OAuth + tenant linking

Reuses P3's `@cpa/integrations/xero-payroll` OAuth scaffolding (PKCE, AES-256-GCM token storage, 5-minute pre-expiry refresh, tenant_id header). New provider: `xero_accounting`. Different scope set:

```
accounting.transactions accounting.contacts accounting.settings offline_access
```

### Synced surfaces

| Xero entity | Source value | Role |
| --- | --- | --- |
| `Invoices` (type=ACCPAY) | `xero_invoice` | Vendor bills the firm pays |
| `BankTransactions` (type=SPEND) | `xero_bank_tx` | Direct bank-feed expenses |
| `Receipts` (Expenses module) | `xero_receipt` | Employee-submitted reimbursements |
| `Contacts` | (cached, not own row) | Vendor matching for rules |
| `Accounts` | (cached, not own row) | Account-code matching for rules |

Out of scope (P4): `BankTransactions` type=RECEIVE (income), `ManualJournals`, `Items` / inventory, multi-currency.

### Sync mechanics

- Initial backfill: full pull of last 24 months on first connect (paginated, 200 invoices/page)
- Ongoing: every 15 minutes, poll with `If-Modified-Since` header (Xero supports it natively)
- pg-boss job per connected tenant; idempotent; dedup'd
- Rate-limit safety: 60 req/min standard, 5000/day; we use ~20/hr per tenant
- Reconciliation: on update, re-fetch + diff + write `EXPENDITURE_UPDATED` event; on void, mark `voided_at`, retain row for audit

### Stub / dev fallback

`@cpa/integrations/xero-accounting` exports two implementations behind a `XERO_IMPL` env (matching P2 classifier pattern):

- `real`: actual Xero API client
- `stub`: file-system fixtures under `tests/fixtures/xero/` (sample invoices, bank txs, receipts)

CI sets `XERO_IMPL=stub`. Local dev without keys: same. Real keys flip to `real`.

---

## Expenditure mapping

### Manual + rules engine (Q7 = A)

Every line item routes to one of three states:

1. **Auto-mapped by rule** — first matching rule applied at ingest time; `mapped_via='rule'`, rule_id captured in event payload
2. **Manually mapped** — consultant assigns in mapping UI; can save mapping as a new rule for vendor/account/description match
3. **Unmapped** — surfaces in "needs mapping" UI; rolled into BAU expenditure if left unmapped at submission

### Rule evaluation order

1. Filter rules where `tenant_id` matches the line's tenant
2. Filter rules where ALL provided fields match: `vendor_pattern` (regex), `account_code` (exact), `description_pattern` (regex). Empty field = wildcard.
3. Order by `priority DESC`, take first
4. Apply: write `EXPENDITURE_LINE_MAPPED` event with `mapped_via='rule'`, rule_id

### Rule creation UX

When a consultant manually maps a line, the mapping modal offers:

- "Apply this mapping to all unmapped lines from this vendor" (priority 100 — vendor only)
- "...with this account code" (priority 200 — vendor + account code)
- "...with this description pattern" (priority 300 — full pattern)

Higher priority = more specific. The newly-created rule auto-applies to existing unmapped lines via a background job.

### Mapping UI

`/claims/[id]/expenditure` — tabular view with Source filter, inline mapping editor, multi-select bulk operations, RD% slider.

---

## API surface

```
# Pipeline + claims
POST   /v1/claims                            -- create claim for (subject_tenant, FY)
GET    /v1/claims                            -- list with pipeline filter
GET    /v1/claims/:id                        -- detail
PATCH  /v1/claims/:id/stage                  -- advance/revert stage
PATCH  /v1/claims/:id                        -- set ausindustry_reference + submitted_at

# Projects
POST   /v1/projects
GET    /v1/projects                          -- filter: subject_tenant_id
PATCH  /v1/projects/:id
DELETE /v1/projects/:id                      -- archive (soft)

# Activities
POST   /v1/activities                        -- create CA/SA under (project, claim)
GET    /v1/activities                        -- filter: claim_id
GET    /v1/activities/:id
PATCH  /v1/activities/:id                    -- writes ACTIVITY_UPDATED event

# Artefact linkage
POST   /v1/activities/:id/artefact-links     -- writes ARTEFACT_LINKED event
DELETE /v1/activities/:id/artefact-links/:linkId

# Expenditures
GET    /v1/expenditures                      -- filter: subject_tenant_id, FY, source, mapped_state
GET    /v1/expenditures/:id
POST   /v1/expenditures                      -- create manual entry
PATCH  /v1/expenditures/:id                  -- edit manual only; Xero-sourced read-only
DELETE /v1/expenditures/:id                  -- void (soft)

# Expenditure-line mapping
PATCH  /v1/expenditure-lines/:id/mapping     -- writes EXPENDITURE_LINE_MAPPED event
DELETE /v1/expenditure-lines/:id/mapping     -- writes EXPENDITURE_LINE_UNMAPPED event

# Mapping rules
POST   /v1/expenditure-mapping-rules
GET    /v1/expenditure-mapping-rules
PATCH  /v1/expenditure-mapping-rules/:id
DELETE /v1/expenditure-mapping-rules/:id

# Xero integration
POST   /v1/integrations/xero-accounting/connect
GET    /v1/integrations/xero-accounting/callback
DELETE /v1/integrations/xero-accounting
POST   /v1/integrations/xero-accounting/sync   -- manual trigger; admin-only

# Documents
GET    /v1/claims/:id/documents/activity-application.pdf
GET    /v1/claims/:id/documents/expenditure-schedule.pdf
GET    /v1/claims/:id/documents/cross-walk.pdf
```

All routes `requireSession` (consultant) with role gates; admin-only operations explicitly marked. RLS at the DB layer is the safety net.

---

## Sequencing

### Foundation (F1-F12) — single coordinator track

```
F1.  Migration 0012: project + claim + activity tables
F2.  Migration 0013: expenditure + expenditure_line + expenditure_mapping_rule
F3.  Migration 0014: extend evidence_kind enum with new P4 kinds (14 additions)
F4.  Drizzle schema files + types
F5.  @cpa/schemas Zod additions (Project, Claim, Activity, Expenditure, ExpenditureLine, MappingRule + new event payload schemas)
F6.  Update chain.ts canonicaliseEvent — verify byte-identical to pre-P4 for existing events; new-kinds tests
F7.  RLS policy verification suite — rls.test.ts gets a P4 chapter
F8.  Base route registrations: claims, projects, activities, expenditures, mapping-rules, integrations/xero-accounting
F9.  CA/SA code auto-generation helper
F10. Stage advance/revert helper (validates transitions, writes events)
F11. @cpa/documents package: @react-pdf/renderer base + helpers
F12. CI: turbo passthrough for new env vars (XERO_ACCOUNTING_*, XERO_IMPL=stub for CI)
```

### Swimlane A — Evidence Engine (Module 1)

```
A1.  POST /v1/projects + GET list + PATCH + DELETE (archive)
A2.  POST /v1/claims + GET list with pipeline filters + PATCH stage + PATCH ausindustry_reference
A3.  POST /v1/activities + GET (filter claim_id) + PATCH (writes ACTIVITY_UPDATED event)
A4.  POST /v1/activities/:id/artefact-links + DELETE (writes ARTEFACT_LINKED / UNLINKED events)
A5.  Activity detail view (web): code/title/hypothesis/uncertainty/experimentation log/outcomes editor
A6.  Activity feed view: filter event chain WHERE payload.activity_id = X to render the technical uncertainty register
A7.  Project list + detail (web)
A8.  Activity application skeleton PDF: React-PDF template + route + DOCUMENT_GENERATED event
A9.  Hash-chain extension test: 100 mixed-kind events including new P4 kinds; verifyChain green
A10. Tests for A1-A8 + e2e: "create project → claim → activity → link evidence → see register"
```

### Swimlane B — Xero + Expenditure (Module 5 Tier A early)

```
B1.  @cpa/integrations/xero-accounting module: OAuth (PKCE), token rotation, tenant_id header
B2.  Sync: Invoices (ACCPAY) — paginated initial backfill (24mo) + If-Modified-Since incremental
B3.  Sync: BankTransactions (type=SPEND)
B4.  Sync: Receipts (Xero Expenses); map submitter to reimbursed_to_user_id where matchable
B5.  Sync: Contacts cache + Accounts cache
B6.  pg-boss job: per-tenant 15-min poll trigger; idempotent; dedup'd
B7.  Stub fallback: tests/fixtures/xero/*.json + XERO_IMPL=stub env routing
B8.  Expenditure mapping rules engine: insert/match/apply (priority-ordered, regex+exact fields)
B9.  Manual expenditure entry route (POST /v1/expenditures with source='manual')
B10. PATCH /v1/expenditure-lines/:id/mapping + rule auto-creation toggle
B11. Bulk operations (multi-line map/unmap)
B12. Tests for B1-B11 + e2e: "connect Xero (stub) → sync → map a line → see in cross-walk"
```

### Swimlane C — Pipeline + Documents

```
C1.  Pipeline page route: /pipeline + view=kanban|table toggle; stage/consultant/FY filters
C2.  Kanban view component: 7 columns, drag-drop forward, context-menu revert (admin), bulk multi-select
C3.  Tabular view component: sortable, filterable, multi-select, stage advance via dropdown
C4.  Claim detail page: /claims/[id] tabs (Activities | Evidence | Expenditure | Documents | Timeline)
C5.  Expenditure mapping UI: tabular line-by-line with source filter, inline edit modal, bulk ops
C6.  Apportionment integration: line-level rd_percent slider, integrates with P3 apportionment workbench
C7.  Expenditure schedule PDF: per-activity breakdown, salary + invoices + reimbursed + manual, ASSOCIATE_FLAG highlighting
C8.  ATO cross-walk PDF: one-page table with source column, content-hash footer, DOCUMENT_GENERATED event
C9.  Document download routes (3) with content-hash response header
C10. Tests for C1-C9 + e2e: "complete a claim end-to-end"
```

### Final integration (D1-D6)

```
D1.  Cross-cutting integration test: full happy-path e2e
D2.  Hash-chain integrity smoke test: 500 mixed events across all P0-P4 kinds → verifyChain green
D3.  Audit-readiness score (P3) extension: rules score activities + expenditure coverage + evidence linkage
D4.  ADR-0006: P4 architecture
D5.  Documentation: @cpa/integrations/xero-accounting README, schema diagram update
D6.  Final review checklist + first-customer onboarding test
```

### Estimated task count

- Foundation: 12 tasks
- Swimlane A: 10 tasks
- Swimlane B: 12 tasks
- Swimlane C: 10 tasks
- Final: 6 tasks
- **Total: ~50 tasks** (vs P3's ~80; P4 reuses more existing infrastructure)

---

## Testing strategy

| Layer | Coverage | Tools |
| --- | --- | --- |
| Schema | Migrations 0012-0014 apply cleanly; RLS isolates tenants; FKs + CHECK constraints enforce shape | `pnpm db:migrate` in CI; `rls.test.ts` per-table |
| Unit | Pure functions: code generator (next CA-XX), stage validator, mapping rule matcher, expenditure-schedule arithmetic | `node:test` |
| Integration | Routes against ephemeral postgres: CRUD per resource, role gates, stage transitions, event-chain side effects | `node:test` + `privilegedSql` fixtures with per-test UUID prefixes |
| Hash chain | After each new event kind, `verifyChain` green across mixed-kind sequences | `chain.test.ts` extension |
| Xero | Nock fixtures matching real Xero responses; sync round-trip; rule matching; reconciliation | `nock` + `tests/fixtures/xero/` |
| Document | PDF generation produces stable content; `content_sha256` deterministic for same input | byte-compare against golden PDF in `tests/fixtures/documents/` |
| E2E | Three Playwright flows: create-project-to-evidence; xero-sync-to-cross-walk; full-pipeline-to-submitted | `apps/web/e2e/p4-*.spec.ts` |

---

## Acceptance criteria — P4 done when

- [ ] Migrations 0012-0014 apply cleanly on a fresh DB; `verifyChain` green on existing P0-P3 fixtures (backward compat)
- [ ] Connect Xero sandbox → 24-month backfill of invoices + bank transactions + receipts → expenditure rows in DB
- [ ] Create project + claim + activities (CA-01, SA-01) → activity application PDF generates with content-hash logged on chain
- [ ] Map 50+ expenditure lines (mix of rule-driven + manual) → expenditure schedule + cross-walk PDFs generate
- [ ] Pipeline kanban + tabular both render; advance through 7 stages writes `CLAIM_STAGE_ADVANCED` events
- [ ] Mark a claim submitted with reference number → claim frozen; post-submission edits rejected
- [ ] Hash chain verifies across all P0-P4 event kinds for every test subject_tenant
- [ ] CI green (lint, typecheck, format, test, e2e) on `p4/foundation` (or merged feature branches)
- [ ] First-customer manual onboarding test: blank account → connect Xero → 1 project → 2 activities → 20 expenditures mapped → submission flag → 3 docs all generate

---

## Phase boundaries

**In scope (P4):**

- project, claim, activity (with CA/SA code generation)
- expenditure (Xero invoices + bank transactions + receipts + manual entries)
- expenditure-line mapping with rules engine
- 7-stage Module 4 pipeline (kanban + tabular)
- 3 deterministic documents (activity application skeleton, expenditure schedule, ATO cross-walk)
- Manual submission flag with AusIndustry reference

**Deferred:**

- AI mapping suggestions for invoices → P5 (drafter agent module)
- AI narrative drafting for activities → P5
- Sector-specific prompting → P5
- AusIndustry portal API → P9
- MYOB integration → P5
- QMS module (Code Determination 2024 §30) → P9
- Per-firm AI fine-tune → P10+
- Bank transaction RECEIVE / income side → not planned (R&DTI is expense-side only)
- Multi-currency expenditure → P9 (international R&D operations are rare for AU R&DTI but exist)

---

## Execution

Use `superpowers:subagent-driven-development` to execute task-by-task with two-stage review (spec compliance → code quality) after each. Or open a parallel session with `superpowers:executing-plans` once the implementation plan exists.

Sequencing: complete F1-F12 (Foundation) before any swimlane starts. Swimlanes A / B / C can run in parallel against the foundation. Final integration (D1-D6) merges the three swimlanes.
