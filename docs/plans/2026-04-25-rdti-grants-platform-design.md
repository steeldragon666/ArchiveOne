# R&DTI + Grants White-Label Platform — Architecture Design

**Date:** 2026-04-25
**Author:** Aaron Newson (Carbon Project Australia Pty Ltd) + AI pair
**Status:** Approved — proceeding to implementation plan
**Source spec:** `RDTI-Intelligence-Platform-Product-Feature-Guide v1.1` and `RDTI-Intelligence-Platform-Consultant-Partner-Explainer` (23 April 2026, both Commercial in Confidence)

---

## 0. Decision summary

| Question | Decision |
|---|---|
| v1 scope | AU-only: R&DTI Intelligence Platform + Australian Commonwealth Grants module |
| Repo strategy | Single greenfield monorepo (`cpa-platform`) |
| Existing platform | None — PDFs are a target spec, not shipped state |
| Grants positioning | Module *inside* the white-label R&DTI platform (same tenant, same brand, same billing surface) |
| External agent sales | None — agents not sold as standalone API / MCP / Claude Code skills |
| Grants integration | Shared evidence layer, twin assembly engines (Option A) |
| Grants module v1 surfaces | Pre-award: consultant-only. Post-award: extends Mobile Scribe with milestone-aware mode |
| Team | Aaron + AI pair, open-ended timeline, ship-when-ready |
| Sequencing override vs PDF | Build Consultant Portal *before* Mobile Scribe (PDF says portal is phase 2; that ordering doesn't fit the sales motion) |

---

## 1. Repo & stack

**Single greenfield monorepo**, working name `cpa-platform`. Single repo, single CI, single release pipeline.

Stack — locked from the PDFs:

- pnpm + turbo monorepo, TypeScript everywhere, Node 22 LTS
- Mobile: Expo SDK 51 / React Native 0.74
- Web: Next.js 15 / React 19 / TanStack Query 5
- API: Fastify 4 with zod schema validation
- DB: Postgres 16 + pgvector, AWS RDS in `ap-southeast-2`
- Object storage: S3 in `ap-southeast-2`
- Agents: `@anthropic-ai/sdk` against Claude (Opus 4.7 for high-stakes drafts, Haiku 4.5 for classifier/extractor where latency matters)
- Embeddings: Voyage AI v3 (with self-hosted fallback path)
- Auth: SSO via SAML/OIDC, MFA enforced, custom Fastify session
- Background jobs: pg-boss (Postgres-backed) — keeps infra small, escalate to BullMQ only if needed
- Observability: OpenTelemetry → Grafana Cloud
- Hosting: AWS App Runner or ECS Fargate (API), Vercel or Amplify (web), EAS (mobile)

**Deviation from PDFs:** the Consultant Portal is built *before* the Mobile Scribe, not after. The consultant is the paying customer; the portal is where the product is evaluated and sold. Mobile Scribe is the claimant's surface — important for adoption, not for the first sales conversation. The PDFs describe Web Console as "phase 2"; that ordering is wrong for a sales-led build.

---

## 2. Package layout

```
cpa-platform/
├── apps/
│   ├── api/                  # Fastify — single canonical backend
│   ├── consultant-portal/    # Next.js — consultant-side surfaces (R&DTI + Grants)
│   ├── claimant-web/         # Next.js — claimant deep-review (later phase)
│   └── mobile/               # Expo — Scribe (claimant + milestone-aware modes)
├── packages/
│   ├── schemas/              # zod schemas, shared types — events, agreements, milestones
│   ├── db/                   # Postgres schema, migrations, RLS-aware query helpers
│   ├── chain/                # Event store + SHA-256 hash chain + weekly aggregator
│   ├── agents/               # Claude agent runtime + prompt registry
│   │   ├── runtime/          #   shared infra (tracing, retries, tool use, structured output)
│   │   ├── classifier/       #   Division 355 classifier (Haiku)
│   │   ├── extractor/        #   grant-agreement intake (Opus)
│   │   └── drafter/          #   long-document drafter — R&DTI memos AND grant apps (Opus)
│   ├── documents/            # Deterministic template engine + R&DTI document templates
│   ├── grants/               # Program registry + portal-output adapters
│   │   ├── core/             #   program-agnostic types & engine
│   │   ├── ausindustry/      #   business.gov.au adapter
│   │   ├── arena/            #   ARENA portal adapter
│   │   └── ...               #   one folder per program
│   ├── federation/           # Tenancy, delegation tokens, scoped read sharing
│   ├── auth/                 # SSO (SAML/OIDC), MFA, session
│   ├── billing/              # Stripe + rev-share calculator
│   └── observability/        # OpenTelemetry conventions, structured logging
├── docs/
│   ├── plans/                # Design docs (this file lives here)
│   └── decisions/            # ADRs (one file per non-trivial architectural decision)
└── tools/
    └── scripts/              # Dev/ops scripts, seed data
```

Three deliberate choices:

1. **Agents are one package, not many.** Classifier, extractor, drafter all share the same Claude runtime, prompt registry, retry semantics, and tracing conventions. Splitting them makes prompt-management harder, not easier. Internal split is by capability folder.
2. **`grants/core` + per-program adapter.** Adding a new grant program = new adapter package implementing the adapter interface (eligibility rules, section schema, portal output format). Core engine untouched.
3. **`documents/` and `chain/` separated.** Documents *consume* the chain; they don't *own* it. Lets us swap template engines without touching the chain.

---

## 3. Agent runtime architecture

Three distinct agent capabilities with very different reliability requirements:

| Agent | Volume | Stakes | Model | Output mechanism |
|---|---|---|---|---|
| **Classifier** | Per-event (thousands/yr/claimant) | Medium — wrong classification is catchable in consultant review | `claude-haiku-4-5` | Tool use → strict JSON schema |
| **Extractor** | Per-agreement upload (~10s/yr/claimant) | High — drives milestone tracking | `claude-opus-4-7` | Tool use → strict schema; consultant confirms |
| **Drafter** | Per-section + per-document narrative | High — but content always lands inside a deterministic template | `claude-opus-4-7` | Free-form text into named template slots |

Cross-cutting patterns (live in `packages/agents/runtime/`):

- **Versioned prompt registry**: prompts at `packages/agents/prompts/<agent>/<name>@<semver>.ts`. Runtime never inlines prompt strings. Prompt-version bumps are deliberate acts that trigger fixture re-validation in CI.
- **Structured output via tool use**, not parsed JSON-from-text. The tool's input schema *is* the contract; the SDK enforces it.
- **Fallback discipline**: classifier confidence < 0.6 → never auto-mark INELIGIBLE; escalate to consultant queue. Protects partners from the worst false negative — a wrongly-discarded R&D activity.
- **Idempotency keys**: `idempotency_key = SHA256(prompt_version || input_hash)`. Replays don't re-bill; identical-input re-runs return cached output.
- **Trace + cost telemetry**: every call emits an OTel span with `prompt_version`, `model`, `input_hash`, `output_hash`, `tokens_in`, `tokens_out`, `tenant_id`. Powers per-tenant cost reporting.

**The drafter never produces a final lodgement document.** Per the PDF's "deterministic where it matters" principle, the drafter only produces *narrative content* slotted into a deterministic template (`{{r_d_purpose}}`, `{{methodology_summary}}`, etc.). LLM never owns statutory wording, only the description of what was done. Enforced via type-level contracts: a template exposes a typed `slots` interface; the drafter must satisfy it.

**Cost shape**: ~AUD 10–15 per claimant per year on agent inference at typical volumes — under 1% of the AUD 2,400 list price.

---

## 4. Data model + hash chain

Core tables (full schema in implementation plan):

```
tenant                 # consultant firm (white-label root)
  ↳ subject_tenant     # claimant or financier (the firm's "client")
      ↳ user           # via tenant_user with role
      ↳ project        # R&D project
      ↳ event          # the core append-only table — 12 evidence kinds
      ↳ weekly_log     # ISO-week aggregate, hash-linked
      ↳ document       # rendered artefact, source events cited by hash
      ↳ grant_application
      ↳ grant_agreement
          ↳ milestone
          ↳ budget_line
      ↳ application_section  # drafter output for grant apps
      ↳ portal_submission    # packaged output for AusIndustry / ARENA / etc.
audit_log              # every authenticated action + every federation retrieval
delegation_token       # scoped read tokens for financiers/auditors
```

Twelve evidence kinds (from PDF §3.2): `HYPOTHESIS`, `DESIGN`, `EXPERIMENT`, `OBSERVATION`, `ITERATION`, `NEW_KNOWLEDGE`, `UNCERTAINTY`, `TIME_LOG`, `ASSOCIATE_FLAG`, `EXPENDITURE_NOTE`, `SUPPORTING`, `INELIGIBLE`. Plus implementation-only: `OVERRIDE` (consultant override of a prior event's classification — appended, never mutates).

**Two linking dimensions on `event`**: `project_id` (nullable, R&DTI Activity Schedule view) and `milestone_id` (nullable, grants progress-report view). Same row, two queries, two views, one chain.

**Hash chain**:

- `event.hash = SHA256(prev_hash ‖ canonical(payload + classification + captured_at + captured_by))`
- Chain is **per `subject_tenant`** — multiple claimants don't share a chain. Bounds verification cost; makes export self-contained.
- `weekly_log.hash = SHA256(prev_weekly_hash ‖ ordered_event_hashes_for_week)`
- `document.hash = SHA256(rendered_bytes ‖ source_event_hashes_manifest)`
- Verification re-derives the chain from raw events; divergence → hash-break incident logged + Assurance Report compiler refuses to emit.

**RLS**:

- Every table with `tenant_id` carries Postgres RLS: `current_setting('app.current_tenant_id')::uuid = tenant_id`
- API middleware sets `app.current_tenant_id` per request from the verified session.
- Federation calls re-set context using a delegation token naming both `issuer_tenant_id` and `subject_tenant_id`. Token signature verified before SET.
- Enforces the PDF's "no cross-tenant model context at inference time" guarantee at the DB layer.

**Override semantics**: consultant overrides never mutate existing events. They create a new `OVERRIDE` event referencing the original event hash, with the consultant's revised classification. Chain stays append-only. Latest "effective classification" = `latest override OR original classification`. Critical for tamper-evidence.

---

## 5. Surfaces & API contract

```
apps/api  (Fastify, OpenAPI-spec'd, JWT auth)
  /v1/auth/*                    Login, MFA, SSO callback
  /v1/tenants/me                Current tenant config
  /v1/subject-tenants/*         Claimants/financiers under the firm
  /v1/events                    POST (append-only), GET (paged, filtered)
  /v1/events/:id/override       POST consultant override
  /v1/projects/*                CRUD on R&D projects
  /v1/weekly-logs               GET aggregates
  /v1/grants/programs           GET registry
  /v1/grants/opportunities      GET open rounds (server-curated)
  /v1/grants/applications/*     CRUD on draft applications
  /v1/grants/agreements         POST upload (triggers extractor)
  /v1/grants/agreements/:id     GET, PATCH (consultant confirms extracted fields)
  /v1/grants/milestones/*       Link events ↔ milestones
  /v1/documents/render          POST trigger render
  /v1/documents/:id             GET signed download URL
  /v1/assurance/render          POST compile Quarterly Assurance Report
  /v1/portal-submissions/*      Build a portal-ready package
  /v1/federation/grant          Issue scoped read token
  /v1/federation/redeem         Redeem token (financier surface)

apps/mobile              → /v1/events (offline-first), /v1/auth, /v1/grants/milestones (post-award)
apps/consultant-portal   → all /v1/* except /v1/federation/redeem
apps/claimant-web        → scoped subset under the claimant's own subject_tenant
```

Fastify uses zod schemas (in `packages/schemas`) to validate every request *and* generate the OpenAPI spec at build time. One source of truth for shapes across mobile, web, API — drift impossible by construction.

---

## 6. Phasing plan

Nine phases, ~3–6 weeks each at solo+AI pace. Sequencing is non-negotiable.

| # | Phase | Weeks | Critical deliverable |
|---|---|---|---|
| **P0** | Foundation | 1–2 | Monorepo, CI green, Postgres + migrations, Fastify skeleton, OTel→Grafana traces working |
| **P1** | Identity & Tenancy | 3–5 | Consultant logs in, RLS enforced at DB, "no claimants yet" empty state in portal |
| **P2** | **Event Capture Vertical Slice** | 6–9 | Consultant pastes a transcript → classifier runs → event in chain → visible in portal. **First demo.** |
| **P3** | Mobile Scribe MVP | 10–13 | Voice note on phone → classified event in consultant portal. Offline queue. |
| **P4** | First Documents | 14–16 | Compliance Memo + Activity Schedule render to PDF from real events |
| **P5** | Document Suite + Assurance Report | 17–22 | All 8 PDF documents + Quarterly Assurance Report + verification statement |
| **P6** | Grants Pre-award | 23–28 | Consultant drafts a CRC-P or ARENA application end-to-end |
| **P7** | Grants Post-award | 29–34 | Agreement upload → milestones extracted → milestone-aware Scribe → progress report exported |
| **P8** | Federation + Financier Tenancy | 35–38 | Consultant issues a 30-day read token; financier sees Assurance Report under own brand |
| **P9** | Production Readiness + SOC 2 Prep | 39–44 | Pen-test prep, billing live, partner-onboarding flow, first paying tenant |

Total: ~44 weeks at solo+AI pace, realistically **10–12 calendar months** for both modules to first paying tenant.

**P2 is the inflection point.** Until it ships, no demo. After it ships, every subsequent phase has a working baseline to extend. Treat anything delaying P2 as the highest-priority blocker; treat anything off P2's critical path as deferrable.

---

## 7. Risks & watch-outs

1. **Statutory drift (Division 355 / AusIndustry guidance)**. Classifier prompt embeds statutory anchors; wording changes need re-validation. *Mitigation:* every classifier change green against existing fixture suite + new fixtures for the change. Quarterly statutory bulletin → regression run.
2. **Voice transcription accuracy on AU accents and technical jargon**. Voice-first products live or die on this. *Mitigation:* tap-to-edit transcripts + per-claimant glossary loader. Blind-test Whisper / Deepgram / AssemblyAI on real AU technical samples in P3 before locking provider.
3. **Hash-chain forking under offline reconciliation**. Mobile captures offline; consultant overrides events; reconnection needs deterministic merge. *Mitigation:* events from different sources don't share a sequence — appended at reconciliation time in `received_at` order; chain rebuilt deterministically. Overrides are new events, never mutations.
4. **Portal output fidelity (AusIndustry / ARENA / state programs)**. Each portal expects specific DOCX/ZIP/PDF formats. *Mitigation:* prototype rendering for ONE form (Compliance Memo) end-to-end in P4 before generalising. Adapters in P7 follow that pattern.
5. **Cost runaway from on-device classification preview**. PDF promises preview chip on transcription; on-device LLM in mobile is hard in 2026. *Mitigation:* low-latency Haiku call (~200ms) + heuristic pre-filter (regex/keyword) + cache by transcript-prefix hash. Display preview when latency budget allows; degrade to "classified shortly" otherwise.
6. **Sole-founder bus factor (you)**. *Mitigation:* enforced engineering discipline from day 0 — no merge without typecheck + tests + traces; ADR per meaningful decision in `docs/decisions/`; a `RUNBOOK.md` per app. AI pair output must be legible to *future-you*, not just current-you.
7. **Scope drift toward full PDF surface before P2 ships**. Most likely failure mode of solo+AI builds. *Mitigation:* P2 demo is the gate; nothing in P3+ starts before P2 lands. Every prospective feature passes "does this block P2?"

---

## 8. Aspirational vs foundational PDF claims

The PDFs include forward-looking language ("Shipped", "145+ tests across 9 runners", "Penetration testing last completed Feb 2026 — no highs"). These are **aspirational targets**, not foundational facts. The implementation plan must explicitly track which PDF claims are:

- **Foundational** (architectural decisions we're locking in — e.g. hash chain, deterministic templates, per-subject-tenant chains, RLS, federation model)
- **Aspirational** (engineering tickets and deadlines — e.g. SOC 2 Type I FY27 Q1, ISO 27001 scoping FY27, pen-test annual, full document suite)

Both are valid; conflating them is dangerous.

---

## 9. Out of scope for v1

- Non-AU jurisdictions (NSF/NIH/DOE/DARPA/NSTC research grants from the original `research-grants` skill — defer to v3+ if customer-led)
- Standalone agent SaaS (no API/MCP/Claude Code marketplace sales)
- General-purpose project management (the platform captures evidence and compiles claims; it is not a sprint or Gantt tool — explicit per PDF §8)
- ATO / business.gov.au automated portal submission (we generate the submission package; consultant uploads it manually in v1)

---

## 10. Next step

Invoke `superpowers:writing-plans` skill to produce the detailed P0 and P1 implementation plan with file-level tasks, test specifications, and acceptance criteria. Subsequent phase plans authored phase-by-phase rather than in one go (avoids the "12-month plan instantly stale" failure mode).
