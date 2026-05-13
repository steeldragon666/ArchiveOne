# Client-Side App — Purpose, Functions, Specification

**Status:** spec v1.0
**Last updated:** 2026-05-13
**Owner:** Aaron Newson
**Companion docs:** [`financier-pillar-plan-summary.md`](./financier-pillar-plan-summary.md)
(the lending pillar that this app feeds); [`2026-04-27-omniscient-feature-spec.md`](./2026-04-27-omniscient-feature-spec.md)
(the canonical 8-module / 5-pillar Omniscient platform spec — this doc is the deep-dive
expansion of Module 3, with scope additions noted in §0)

---

## 0. Product architecture — the three gated tiers

Omniscient is sold as **three nested products**. Each tier is unlocked
through the tier above it. A claimant company cannot access tier 1.2
without going through a consultant on tier 1.1, and cannot access tier 1.3
without being on tier 1.2.

```
                    ┌─────────────────────────────────────────────────┐
                    │  Product 1.1 — Consultant App (SHIPPED)         │
                    │  R&DTI consulting firms subscribe.              │
                    │  The wizard. The evidence chain. The drafters.  │
                    └──────────────────────┬──────────────────────────┘
                                           │
                              consultant invites client
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Product 1.2 — Client-Side App (this spec)      │
                    │  Claimant companies plan + advise through year. │
                    │  Webapp + mobile. The contemporaneous evidence. │
                    └──────────────────────┬──────────────────────────┘
                                           │
                              client opts in at sign-off
                                           │
                                           ▼
                    ┌─────────────────────────────────────────────────┐
                    │  Product 1.3 — Financier Loan Module            │
                    │  Panel of lenders fund the R&DTI refund advance.│
                    │  Auto-decisioning gated on Claim Quality Score. │
                    └─────────────────────────────────────────────────┘
```

### Why this gating is the whole strategy

| Gate                      | Without it                                                                                                                          | With it                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consultant gates 1.2      | Clients churn through self-serve signup without compliance discipline; consultant trust eroded; A-band CQS scores never accumulate  | Consultant is the trust intermediary; the platform's quality signal stays calibrated; consulting firms get a recurring-revenue partner not a disintermediator |
| Client-side app gates 1.3 | Lenders compete cold for borrowers; CAC is A$1,500–3,000/loan; pricing inefficiency at the tail; ceiling at 200–400 loans/lender/yr | Lenders pay platform fees + origination % to access pre-qualified deal flow; CAC drops to ~0; underwriting cost drops 90%+; volume ceiling lifts              |

The architecture is the answer to "why won't a Big-4 bank just go direct to
the claimants?" — they can't, because the consultant is the gatekeeper, and
the consultant won't refer a borrower who hasn't been through the
client-side app (because doing so means lower-quality evidence chain, which
means higher clawback risk for the consultant).

### Pricing recap (per tier)

| Tier                      | SKU                       | Price                                                     |
| ------------------------- | ------------------------- | --------------------------------------------------------- |
| 1.1 Consultant App        | Per-claim fee             | A$1,500 / claim                                           |
| 1.2 Client-Side App       | Webapp seat               | A$500 / seat / yr                                         |
| 1.2 Client-Side App       | Mobile seat               | A$250 / seat / yr                                         |
| 1.3 Financier Loan Module | Origination fee           | 1.5–2.5% of loan principal (paid by lender, not borrower) |
| 1.3 Financier Loan Module | Platform fee (per lender) | A$48–360K / yr                                            |

### Access flow

A new claimant joins the platform as follows:

1. Their consulting firm is subscribed to Product 1.1 (consultant app)
2. The consultant invites the claimant company via the consultant-side
   admin panel (creates the subject_tenant + first user)
3. The claimant logs in to Product 1.2 (client-side app) under that
   subject_tenant
4. The claimant uses the app through their R&D year, generating
   contemporaneous chain events
5. At Q1 (or any quarter) sign-off, the "Finance my refund" CTA inside the
   client-side app surfaces Product 1.3 (financier loan module)
6. Borrower opts in via myGovID step-up; the deal package is transmitted to
   the panel; lender funds the advance against the projected refund

**There is no self-serve signup at tier 1.2 or 1.3.** Every account is
provisioned through a consultant on tier 1.1.

---

## 1. Purpose

### 1.1 The structural shift

The consultant-side platform (the existing wizard) prepares R&DTI claims
**retrospectively** from evidence the consultant gathers after the year is over.
The client-side app inverts this: it operates **prospectively**, used by the
R&D claimant company throughout their R&D year as a **planning and advisory
tool**.

This converts R&D claim preparation from a backward-looking audit task into a
forward-looking financial planning workflow. The R&DTI refund stops being a
year-end surprise and becomes a quarterly budget input the client plans
against.

### 1.2 Why it's a moat (not just a feature)

R&DTI compliance depends on **contemporaneous evidence** — documentation
created at the time of the R&D activity, not retrofitted before lodgement.
The 2024-25 AAT/ART rulings cycle (BBM, UVI, GQHC) established that
retrofitted documentation is a primary basis for AusIndustry challenge.

A client who plans their year inside the app generates contemporaneous
evidence **as a structural property of how they work** — not as a discipline
they have to remember. By the time the claim is prepared at year-end:

- Every hypothesis is timestamped at the moment of conception
- Every planned experiment has the AI's tax-classification reasoning attached
- Every spend allocation was logged before the dollars were committed
- Every milestone was registered as it happened

This is the **competitive moat**. Other R&DTI consultancies have no
equivalent, and clients who switch away from the platform mid-cycle lose the
contemporaneous record going forward.

### 1.3 Who it's for

| Audience           | Description                                                                          | Persona                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Primary user**   | R&D budget owner at a claimant company — founder, CTO, R&D manager, finance director | Working through annual R&D planning; cares about cash-flow timing of the refund and quarterly spend discipline |
| **Secondary user** | The consultant who will prepare the eventual claim                                   | Read-only or notified; uses the same evidence chain for year-end claim drafting                                |
| **Tertiary user**  | The CFO / accountant who tracks expenditure against budget                           | Reads the budget rollup; reconciles actual spend vs planned                                                    |

**Market sizing anchor:** ~13,134 R&DTI claimants in AU (FY22-23). Median
claim size A$280K notional. Aggregate refundable offset A$2.3B/yr. Each
claimant is one potential webapp seat.

---

## 2. The annual user journey

The client-side app follows the AU R&DTI fiscal year (Jul 1 – Jun 30) plus a
conceptualisation phase that precedes it. One full pass per fiscal year per
claimant company.

```
        Conceptualisation        Quarterly cadence           Annual rollup
              ↓                         ↓                         ↓
       ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
       │ Hypothesis   │   →     │   Q1 spend   │   →     │  Annual      │
       │ + IP research│   →     │   ↓ refund   │   →     │  summary +   │
       │ + experiments│   →     │   ↓ Q2 budget│   →     │  claim       │
       │ + tax advice │   →     │   ↓ ...Q4    │   →     │  handoff     │
       └──────────────┘         └──────────────┘         └──────────────┘
```

### 2.1 Conceptualisation phase (pre-fiscal-year)

The user is planning their annual R&D. They enter:

1. **A hypothesis** — a conjecture or prediction whose outcome is not knowable
   in advance. Free-text, structured by guided prompts that match the
   Division 355-25 ITAA 1997 core-activity test (knowledge gap, falsifiability,
   novelty).

2. **Hypothesis entry triggers a global IP research activity** — the platform
   automatically searches existing patents, papers, prior art, and adjacent
   commercial products to validate novelty. The search results are time- and
   date-stamped at the moment of the hypothesis entry and persisted as
   contemporaneous evidence of the novelty test being applied.

3. **Planned experimentation** — the user details the systematic experiments
   they plan to run against the hypothesis. Structure: method, expected
   outcome, success criteria, anticipated resources.

4. **AI tax advisory** runs in-flow as the user types:
   - "Is this a core activity (355-25) or supporting activity (355-30)?"
   - "What portion of this proposed expenditure qualifies for the offset?"
   - "Will this equipment be claimed in-year, or depreciated over X years
     under Div 40?"

5. The **plan-as-formed is logged as a chain event**. The hypothesis, IP
   search result, experiment plan, and AI advisory output together constitute
   the contemporaneous record for that activity.

### 2.2 Quarterly cadence (Q1 → Q4)

After conceptualisation, the year operates as four quarterly planning loops:

**Q1 — Initial commitment**

- Q1 spend allocated against the planned activities
- The platform calculates the **estimated Q1 refund value**:
  - Qualifying R&D spend × applicable offset rate (44% refundable for <A$20M
    aggregated turnover; 37.5–46.5% non-refundable above)
  - Minus depreciation portion handled separately under Div 40
- Subtract **cost of finance** (interest on R&DTI advance loan if used)
- Subtract **cost of consultant** (Claimsure's fee for preparing the claim)
- Output: **next-quarter spend figure** — the dollars available to deploy in
  Q2 from the projected refund

**Q2 — Refunded Q1 dollars + optional top-up**

- The Q1 refund figure flows into Q2 as available budget
- User decides: deploy only the refunded amount? Allocate additional company
  capital? Some mix?
- Q2 experiments + spend logged contemporaneously
- Q2 refund value calculated, feeding Q3

**Q3 + Q4** — same pattern. Refund + optional capital → next quarter's budget.

### 2.3 Annual rollup

By end of Q4, the platform displays:

- **Total annual R&D spend** (dollars deployed)
- **Quarterly consultant fees** (4 × Claimsure's per-claim fee, or pro-rated)
- **Total man-hours** allocated across activities
- **Capital equipment** allocated (purchase, lease, or depreciation schedule)
- **Human resources** allocated (FTE, contractor split, salary load)
- **Refund delivered vs forecast** (variance analysis)
- **Claim package ready for consultant lodgement** — every piece of evidence
  the consultant needs has been accumulating in the chain all year

The handoff to the consultant-side wizard is one click: the year's chain
events feed directly into the existing 5-step wizard at the consultant's
firm.

---

## 3. Functional specification

Eight functional modules. Each lists its purpose, primary user actions,
data inputs/outputs, and AI behaviour (if any).

### 3.1 Hypothesis Entry Module

**Purpose:** capture the falsifiable hypothesis that anchors a planned R&D
activity, structured to match Division 355-25 evidentiary requirements.

**User actions:**

- Free-text hypothesis entry with guided prompts
- Tag related activities, projects, subject-tenant
- Save as draft / commit (commit triggers IP research)

**Inputs:** free text, optional structured fields (industry sector, related
prior work, intended timeframe)

**Outputs:**

- A `HYPOTHESIS_ENTERED` chain event with payload `{hypothesis_text,
knowledge_gap_articulation, falsifiability_statement, novelty_assertion,
timestamp, author, related_activity_id}`
- Triggers IP research module on commit

**AI behaviour:** light-touch — checks the hypothesis structure against the
BBM/UVI defensibility criteria (knowledge gap explicit? falsifiable?) and
flags weak areas before commit. Does NOT auto-approve or auto-reject.

### 3.2 Global IP Research Agent

**Purpose:** validate novelty of the hypothesis against existing prior art at
the moment of conception.

**Triggered by:** hypothesis commit.

**Searches:**

- Patent databases (IP Australia, USPTO, EPO, WIPO)
- Academic papers (Semantic Scholar, ArXiv, Google Scholar API)
- Commercial product descriptions (where queryable)
- Public regulatory filings in adjacent industries

**Outputs:**

- An `IP_RESEARCH_COMPLETED` chain event with payload
  `{hypothesis_id, sources_searched, top_matches, novelty_assessment,
confidence_score, model_used, timestamp}`
- A user-facing summary: "We found X papers and Y patents that touch this
  area. Z appear closest. Your hypothesis appears novel on dimensions A, B
  but not on dimension C."

**AI behaviour:** retrieval + summarisation + structured novelty assessment.
Outputs are advisory — the user sees the assessment and decides whether to
refine the hypothesis or proceed. The fact that the search happened, with
results, at the time of conception is the contemporaneous-evidence value.

**Guardrails:**

- Citations are required for every "prior art exists" claim
- Confidence score below 0.7 surfaces "manual review recommended" flag
- Search results stored verbatim in the chain — auditable post-hoc

### 3.3 Planned Experimentation Editor

**Purpose:** structured capture of the systematic experimental method
planned against the hypothesis.

**User actions:**

- Add experiments to a hypothesis (one-to-many)
- For each: method description, expected outcome, success criteria,
  required resources, estimated timeframe
- Link experiments to activities (core vs supporting)
- Iterate and revise; every revision is timestamped

**Outputs:**

- `EXPERIMENT_PLANNED` chain events, one per experiment commit
- Updates to the corresponding `ACTIVITY_DRAFTED` record (links experiments
  to activities)

**AI behaviour:** assists with method structuring — checks that the
described experiment is genuinely systematic (vs ad-hoc), surfaces missing
elements (e.g. "you've described the method but not the success criteria").

### 3.4 AI Tax Advisory Module

**Purpose:** answer R&DTI tax-law questions in-flow as the user plans, so
the plan is structurally compliant from the moment it's formed.

**Three primary question types:**

1. **Core vs Supporting** (Division 355-25 vs 355-30)
   - "Is this experiment a core R&D activity, or a supporting activity?"
   - AI applies the systematic-experimentation test, dominant-purpose test,
     and ordinary-business exclusion
   - Output: classification + rationale + statutory anchor + confidence

2. **Claimable Amount Analysis** (qualifying expenditure)
   - "Of this proposed A$120K expenditure on cloud compute + contractor +
     equipment, what portion qualifies?"
   - AI decomposes the line items and applies the qualifying-expenditure
     rules (incurred-on-R&D test, associate-payment test, feedstock rules)
   - Output: line-item breakdown with qualifying amount per item

3. **Depreciation Handling** (Div 40 capital allowances)
   - "We're buying a A$50K piece of equipment for this experiment — claim
     in-year or depreciate?"
   - AI applies the effective-life tables + R&DTI-specific capital allowance
     rules to recommend treatment
   - Output: depreciation schedule recommendation + Year 1 claimable amount

**Outputs (all three):**

- `AI_TAX_ADVICE_GIVEN` chain event with payload `{question_type, question,
plan_context, advice, confidence, statutory_anchors, model_used,
prompt_version, timestamp}`
- User-facing rationale display with citations

**Guardrails (CRITICAL — see §6 Risk Surface below):**

- Every advisory output cites the specific ITAA/ATO/AusIndustry source
- Confidence < 0.7 surfaces "consultant review recommended" prominently
- The platform's tax advisory output is FRAMED as informational, not as
  registered-tax-agent advice (the consultant who lodges the claim is the
  registered tax agent of record)

### 3.5 Quarterly Budget Calculator

**Purpose:** compute the quarterly refund figure and feed it as next-quarter
budget.

**Inputs (Q1 calc):**

- Qualifying R&D spend for the quarter (sum of classified, plan-attributed
  expenditure)
- Company's aggregated turnover (determines refundable vs non-refundable
  offset rate)
- Cost-of-finance rate (if R&DTI advance loan is used — see §4 integration)
- Consultant fee structure (per-claim flat OR % of refund, configurable)

**Calculation:**

```
quarterly_refund_forecast =
    qualifying_rd_spend × applicable_offset_rate
  - depreciation_carry_forward
  - cost_of_finance_for_period
  - cost_of_consultant_for_period

next_quarter_available_budget =
    quarterly_refund_forecast + optional_additional_capital
```

**Outputs:**

- `QUARTERLY_BUDGET_FORECAST` chain event per quarter
- Visual: quarter-by-quarter cash-flow waterfall
- User-editable: the user can adjust optional capital allocation per quarter

**AI behaviour:** none in the calc itself (deterministic finance math). AI
flags when assumptions look optimistic vs sector benchmarks (e.g. "your
turnover assumption is at the threshold — sensitivity-test this").

### 3.6 Annual Rollup Dashboard

**Purpose:** show the year's R&D plan + actuals + refund trajectory in one
view.

**Displays:**

- Total spend by quarter (planned + actual)
- Activity breakdown (core vs supporting, by activity)
- Refund trajectory (Q1 forecast → Q4 actual)
- Variance: planned vs actual spend, planned vs received refund
- Resource allocation: man-hours, capex, contractor split, FTE load
- Claim readiness: % of evidence chain anchored, hypothesis articulation
  scores, contemporaneous-doc coverage

**Outputs:**

- One-click "Ready for consultant lodgement" handoff: the year's chain
  events become the input to the consultant-side wizard
- PDF export for management reporting

**AI behaviour:** generates a narrative summary of the year's R&D
activities, drawing from the chain events. The narrative is the same
structure the consultant-side wizard's narrative module will use, so the
consultant inherits the client's plan-as-narrative rather than starting
from scratch.

### 3.7 Evidence Chain Logging (cross-cutting)

**Purpose:** every input the user makes, every AI response generated, every
piece of supporting documentation uploaded, every revision — recorded as a
chain event with cryptographic timestamping.

**This is not a feature**, it's a structural property. The platform doesn't
_allow_ the user to bypass chain logging — every interaction goes through
it. This is what makes the contemporaneous-evidence claim defensible: there
is no path through the app that doesn't generate evidence.

**Mechanism:** existing chain-event infrastructure from the consultant-side
platform (event ledger, hash-anchored daily to OpenTimestamps, RLS-scoped
per tenant). The client-side app emits the same event types into the same
chain.

### 3.8 Mobile App (companion surface, lower-fidelity)

**Purpose:** quick-capture interactions on the go — photos of whiteboards,
voice memos describing experiment results, receipts, real-time
observations.

**Functions:**

- Photo capture → ingested as evidence event
- Voice memo → transcribed → chain event with audio attached
- Quick hypothesis log ("had an idea — want to test X")
- View-only access to dashboards (no editing on mobile)
- Push notifications for consultant questions or platform reminders

**Pricing:** A$250/seat (vs A$500 webapp) — narrower feature set, lower
price.

---

## 4. Data model and chain events

### 4.1 New chain event kinds

The spec implies these event kinds (none exist in the current chain yet):

| Event kind                   | Emitted by                  | Payload (abbreviated)                                                                          |
| ---------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `HYPOTHESIS_ENTERED`         | Hypothesis module           | hypothesis_text, knowledge_gap, falsifiability, novelty_assertion, author, timestamp           |
| `IP_RESEARCH_COMPLETED`      | IP research agent           | hypothesis_id, sources, top_matches, novelty_assessment, confidence, model                     |
| `EXPERIMENT_PLANNED`         | Experimentation editor      | hypothesis_id, method, expected_outcome, success_criteria, resources                           |
| `AI_TAX_ADVICE_GIVEN`        | Tax advisory module         | question_type, question, plan_context, advice, confidence, statutory_anchors, model            |
| `QUARTERLY_BUDGET_FORECAST`  | Budget calculator           | quarter, qualifying_spend, refund_forecast, finance_cost, consultant_cost, next_quarter_budget |
| `CAPITAL_ALLOCATION_DECIDED` | Quarterly user decision     | quarter, refund_only_or_topup, additional_capital_dollars, decision_rationale                  |
| `RD_MILESTONE_REACHED`       | User mark or auto-detection | milestone_description, activity_id, evidence_refs                                              |

All emit through the existing `insertEventWithChain` helper, RLS-scoped per
tenant + subject-tenant, contributing to the existing event ledger.

### 4.2 Three-way parity rule (codebase convention)

Every new event kind requires:

1. SQL CHECK constraint addition (new migration)
2. Zod enum addition in `packages/schemas/src/event.ts`
3. AUDIT_KINDS constant addition (if the event is audit-relevant)

Standard pattern — same as `ACTIVITY_REGISTER_DRAFTED`, `ARTEFACT_LINKED`,
etc. shipped this week.

### 4.3 Relationships to existing entities

```
tenant (consulting firm)
  └─ subject_tenant (the claimant company — the client-side app user)
     ├─ project (R&D project shell)
     │   └─ event (chain rows, both existing + new kinds)
     ├─ claim (one per fiscal year)
     │   ├─ workflow_state (consultant wizard's 5-step state)
     │   └─ quarterly_budget_state (NEW — the client-side budget rollup)
     ├─ activity (per-experiment record)
     │   └─ narrative_draft (existing — for consultant-side narrative)
     └─ hypothesis (NEW — the conceptualisation anchor)
         └─ experiment (NEW — planned experiments per hypothesis)
```

Two new tables likely needed: `hypothesis` and `experiment`. The
`quarterly_budget_state` may be a jsonb column on `claim` (like
`workflow_state` was) rather than a separate table.

---

## 5. Integration with the rest of the platform

The client-side app does not exist in isolation. Three integration surfaces:

### 5.1 To the consultant-side wizard (existing, shipped)

- Client's chain events are visible to the consultant under the same
  tenant + subject-tenant scoping
- The consultant's wizard reads them as it always reads chain events: events
  with `kind = HYPOTHESIS_ENTERED` and `kind = EXPERIMENT_PLANNED` become
  inputs to the synthesizer-register agent (Sonnet, runs on Step 1 agree)
- At year-end, the consultant clicks into the claim and the wizard
  pre-populates from the client's already-accumulated evidence
- **The consultant wizard's value compounds** — claims drafted from
  client-side-app input data are higher quality, more defensible, and
  faster to finalise

### 5.2 To the financier pillar (planned, see companion doc)

The client-side app generates **exactly the data the financier pillar's
Claim Quality Score (CQS) needs**. Per
[`financier-pillar-plan-summary.md`](./financier-pillar-plan-summary.md),
the 6 CQS components map to client-side outputs:

| CQS component (weight)              | Client-side data source                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| Advisor track record (25%)          | Consultant-side observation (existing)                                             |
| Evidence chain integrity (20%)      | Every client-side input is a chain event with OTS anchor — **maxed out by design** |
| BBM/UVI defensibility (15%)         | Hypothesis structure + experiment articulation from §3.1/§3.3                      |
| Hypothesis articulation (15%)       | §3.1 output directly                                                               |
| Contemporaneous documentation (15%) | §3.7 chain-logging guarantees contemporaneity                                      |
| Sector benchmark alignment (10%)    | Quarterly budget data vs ATO sector medians                                        |

**Implication:** clients using the client-side app produce A-band CQS scores
(80–100, auto-decision eligible for lender financing) almost as a structural
property. Clients NOT using the app are stuck in B/C band with manual
review. This is the lever that flips claimant adoption of the client-side
app from "nice-to-have" to "table stakes" once lending is live.

### 5.3 To the broader platform infrastructure

- **Auth:** shared with consultant side. Client users log in via the same
  myGovID / SSO mechanism the platform uses for consultants. Their tenant
  scoping puts them in the right subject_tenant context.
- **Storage:** same chain ledger, same RLS, same OpenTimestamps anchoring.
- **AI runtime:** shared `withAgentSpan` telemetry, idempotency cache,
  feature flags. The IP research agent and the tax advisory agent both
  run through `packages/agents/src/runtime/`.
- **Database:** same Supabase, same migrations directory.

---

## 6. Risk surface

Three categories of risk specific to the client-side app:

### 6.1 Tax advisory liability

The AI tax advisory module gives advice that, if wrong, has real financial
consequences for the user. Three mitigations:

1. **Framing.** All advisory output is framed as informational, not as
   registered-tax-agent advice. The registered tax agent of record remains
   the consultant who lodges the claim.
2. **Citations required.** Every advisory output cites the specific ITAA
   section, ATO ruling, or AusIndustry guideline. The user can verify the
   source.
3. **Confidence gating.** Below-threshold advisories surface "consultant
   review recommended" prominently. The platform pushes ambiguous calls to
   the consultant rather than letting the AI make them unilaterally.

**Open question:** does the AI tax advisory layer trigger an AFSL (financial
services licence) or tax-agent registration requirement? Initial reading
suggests no, because the platform is informational and the registered tax
agent is in the loop — but this needs legal review before launch.

### 6.2 Privacy and consent

The client-side app collects far more personal/operational data than the
consultant-side wizard does (the user is the data subject, not just a
record in someone else's chain). Privacy Act 1988 + APP compliance
considerations:

- Explicit consent at signup for AI processing of business plans (APP 3)
- Clear data retention policies (APP 11) — the chain ledger keeps events
  indefinitely; user-deletable elements need careful design
- Cross-border disclosure (APP 8) — AWS Sydney hosting, no offshore by
  default

**Maps to existing platform compliance posture** — same PbD discipline as
the consultant-side platform, but applied to a new user persona.

### 6.3 Hallucination + audit defensibility

If the AI tax advisory hallucinates a non-existent ITAA section, the user
might rely on it. The chain event will record what the AI said, including
the (false) citation, and that becomes part of the contemporaneous evidence.

**Mitigations:**

- All citations are validated against a curated corpus (ITAA 1997 + ATO
  rulings + AusIndustry guidelines) before display — if the citation can't
  be resolved, it's not shown
- Citation-required prompting (tool-use schema enforces a `statutory_anchor`
  field that must resolve against the corpus)
- Periodic audit of advisory outputs vs corpus drift

---

## 7. Commercial model

### 7.1 Pricing (three SKUs)

| SKU                 | Price               | Side            | Recurrence                        |
| ------------------- | ------------------- | --------------- | --------------------------------- |
| **Webapp seat**     | **A$500 / seat**    | Client-side     | Recurring (annual or monthly TBD) |
| **Mobile app seat** | **A$250 / seat**    | Client-side     | Recurring                         |
| **Per-claim fee**   | **A$1,500 / claim** | Consultant-side | Per-claim (existing)              |

### 7.2 Per-claim fee composition (re: §3.5 quarterly budget calc)

When the budget calculator subtracts "cost of consultant" each quarter, the
amount is one of:

- A flat A$1,500 ÷ 4 = A$375/quarter (the simplest assumption)
- A percentage of refund (configurable per consulting firm — some firms
  prefer flat, some % of refund, some hybrid)

The per-firm fee structure is a setting the consulting firm configures in
their account; the client-side budget calculator reads that setting and
applies the correct calc.

### 7.3 Revenue model implications

| Pillar                               | Revenue model                                                   | Mix at Y3     |
| ------------------------------------ | --------------------------------------------------------------- | ------------- |
| Consultant wizard (Phase 0, shipped) | A$1,500 per claim × ~5,000–6,500 claims/yr through 80–130 firms | A$7.5–10M/yr  |
| Client-side app webapp seats         | A$500 × N webapp seats (N ≈ 0.6–0.8 × claimant count by Y3)     | A$1.5–3.0M/yr |
| Client-side app mobile seats         | A$250 × M mobile seats (M ≈ 0.3–0.5 × N)                        | A$0.4–1.0M/yr |
| Financier pillar (whitepaper)        | Origination + platform fees from lender panel                   | A$10–14M/yr   |
| **Total Y3 ARR**                     |                                                                 | **A$19–28M**  |

(Compare: the consultant wizard alone caps out at single-digit ARR. The
client-side app multiplies the consultant ARR by ~1.5×. The financier
pillar then doubles the combined total. Each pillar enables the next.)

### 7.4 Adoption levers

Why a claimant would pay A$500/yr for the webapp:

1. **Reduce their consultant fee.** A consultant-only claim costs A$1,500;
   a client-side-prepared claim where the consultant reviews + lodges should
   cost less (consultant takes 60% less time → fee reduces to ~A$900–1,200).
   The user saves A$300–600/yr on consultant fees, while paying A$500/yr for
   the app. Net positive even before considering anything else.
2. **Faster refund finance.** A client-side-app user generates A-band CQS
   scores → qualifies for auto-decision lender financing at the best rates
   → cuts the 8–14 week refund wait to 24–48 hours.
3. **Better R&D planning discipline.** The quarterly cadence + budget
   calculator is genuinely useful product even ignoring the tax/refund
   angle.
4. **Audit defensibility.** Hash-anchored contemporaneous evidence
   substantially reduces clawback risk — particularly relevant post-BBM/UVI.
5. **R&D budget amplification through quarterly refund recycling.** See
   §7.5 for the full worked example — the headline is that a A$500–600K
   committed annual R&D budget becomes ~A$900K of deployed R&D inside the
   same fiscal year. This is the headline claimant value proposition.

### 7.5 R&D budget amplification — the headline claimant value

**The transformation.** Without the platform, a claimant company commits
their annual R&D budget at the start of the year, waits 8–14 weeks after
year-end lodgement for the refund to land, and re-deploys it next FY. The
refund is working capital that arrives **after** the work is done. With
the platform's 1.1 → 1.2 → 1.3 stack, an advance against each quarter's
expected refund arrives within 24–48 hours of quarterly claim sign-off
and **redeploys inside the same fiscal year**.

The result: ~40–50% more R&D activity from the same initial dollar
commitment.

#### Assumptions (the corrected inputs)

| Input                     | Value                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregated turnover band  | < A$20M → 44% refundable offset                                                                                                                                                                |
| Qualifying R&D ratio      | 80% of total spend qualifies (conservative)                                                                                                                                                    |
| **LTV on advance**        | **82.5%** (mid of 80–85% range)                                                                                                                                                                |
| **Advance interest rate** | **16% APR, daily compounded**                                                                                                                                                                  |
| **Advance durations**     | **Q1 ~9 mo, Q2 ~6 mo, Q3 ~3 mo, Q4 ~0 mo** (each tranche outstanding from quarter-end sign-off until ATO refund arrives 8 weeks post-lodgement; lodgement window assumed shortly after FY-end) |
| **Consultant fee**        | **A$12K per quarterly claim** (mid of A$10–15K range) — total A$48K/yr                                                                                                                         |
| Base capital commitment   | A$150K/quarter → **A$600K annual**                                                                                                                                                             |

**Why the durations step down by 3 months each quarter:** the borrower
draws each advance at the END of the quarter (Q1 end = month 3, Q2 end =
month 6, etc.). The ATO refund arrives ~3 months after FY-end lodgement
(month 15 from FY start). So:

- Q1 tranche: drawn at month 3, repaid at month ~12 → ~9 months outstanding
- Q2 tranche: drawn at month 6, repaid at month ~12 → ~6 months outstanding
- Q3 tranche: drawn at month 9, repaid at month ~12 → ~3 months outstanding
- Q4 tranche: drawn at month 12, repaid at month ~12+ → ~0–3 months — typically not worth taking (the refund is days/weeks away)

Daily-compounded 16% APR is operationally equivalent to ~17.35% effective
annual rate. For tranches outstanding less than a year, simple-interest
math approximates it cleanly. Effective interest cost per tranche:

| Tranche                   | Days outstanding | Effective interest rate (daily compounded) |
| ------------------------- | ---------------- | ------------------------------------------ |
| Q1 (~9 months / 273 days) | 273              | **~12.6%**                                 |
| Q2 (~6 months / 182 days) | 182              | **~8.3%**                                  |
| Q3 (~3 months / 91 days)  | 91               | **~4.1%**                                  |
| Q4                        | 0–90             | ~0–4% (typically no advance drawn)         |

#### Quarterly cash flow

Each quarter the borrower:

1. Spends their base allocation **plus the prior quarter's advance**
2. Pays the consultant fee for that quarterly claim
3. Triggers a new advance at Q-end sign-off (82.5% LTV against the
   quarter's expected refund contribution) — except Q4, where it isn't
   worth taking
4. The advance becomes available cash within 24–48 hours

| Q         | Base spend | Prior-Q advance recycled | **Total quarterly spend**    | Qualifying R&D (80%) | Quarter's expected refund (44%) | New advance @ 82.5% LTV          | Days outstanding | Effective interest | Consultant fee |
| --------- | ---------- | ------------------------ | ---------------------------- | -------------------- | ------------------------------- | -------------------------------- | ---------------- | ------------------ | -------------- |
| Q1        | A$150K     | —                        | **A$150.00K**                | A$120.00K            | A$52.80K                        | A$43.56K                         | 273 (~9 mo)      | 12.6%              | A$12K          |
| Q2        | A$150K     | A$43.56K                 | **A$193.56K**                | A$154.85K            | A$68.13K                        | A$56.21K                         | 182 (~6 mo)      | 8.3%               | A$12K          |
| Q3        | A$150K     | A$56.21K                 | **A$206.21K**                | A$164.97K            | A$72.59K                        | A$59.88K                         | 91 (~3 mo)       | 4.1%               | A$12K          |
| Q4        | A$150K     | A$59.88K                 | **A$209.88K**                | A$167.91K            | A$73.88K                        | (none — refund arrives in weeks) | —                | —                  | A$12K          |
| **Total** | A$600K     | A$159.65K                | **A$759.65K deployed in FY** | A$607.73K            | A$267.40K                       | A$159.65K                        | —                | —                  | **A$48K**      |

#### End-of-year reconciliation

The annual R&DTI claim is lodged shortly after FY-end. ~8 weeks later the
ATO pays the **full A$267.40K refund** to the lender. The lender takes
back the cumulative advance principal **plus accumulated interest** and
remits the balance to the borrower.

| Line item                                              | Amount        |
| ------------------------------------------------------ | ------------- |
| Total R&D deployed within FY                           | **A$759.65K** |
| Total qualifying R&D                                   | A$607.73K     |
| Total expected refund (44% × qualifying)               | A$267.40K     |
| Total advance principal drawn (cumulative)             | **A$159.65K** |
| Q1 interest (A$43.56K × 12.6%)                         | A$5.49K       |
| Q2 interest (A$56.21K × 8.3%)                          | A$4.67K       |
| Q3 interest (A$59.88K × 4.1%)                          | A$2.46K       |
| **Total interest cost**                                | **~A$12.62K** |
| **Total consultant fees** (A$12K × 4 quarters)         | **A$48.00K**  |
| Lender takes from ATO refund (principal + interest)    | A$172.27K     |
| **Net refund balance to borrower** (after loan payoff) | **A$95.13K**  |

#### Three numbers that matter

**1. R&D deployed within the FY:** **A$759.65K** from A$600K initial
commitment — a **+26.6% uplift in research capacity inside the same
fiscal year**. With LTV pushed to the top of the 80–85% band (and slightly
more aggressive base commitment to A$165K/quarter), the deployed figure
approaches A$830K. The A$900K marketing claim requires a more
R&D-intensive profile (higher qualifying ratio) — discussed below.

**2. Total all-in financing cost:** **~A$60.6K** (A$12.6K interest + A$48K
consultant) for A$159.65K of additional R&D capacity that wouldn't
otherwise have existed inside the FY. That's a ~38% all-in cost on the
borrowed dollars — substantial in absolute terms, justified by the
opportunity cost of R&D that DOESN'T get done in the FY otherwise. The
interest portion alone is small (~A$13K) because the loan tranches step
down in duration each quarter — only the Q1 advance carries near-full-rate
exposure.

**3. Net refund cash to the borrower after loan payoff:** **~A$95K**,
arriving roughly 3 months after FY-end. This is the surplus over the
advances + interest the lender takes from the ATO refund. The borrower
has already deployed A$160K more R&D than they otherwise could have, AND
they still get A$95K back in cash.

#### Quarterly cadence aligns with BAS — GST credits as a second compounding lever

The quarterly R&DTI claim cadence above coincides with the **Business
Activity Statement (BAS) lodgement cycle** that GST-registered Australian
companies already file every quarter. This is intentional and unlocks a
second refund stream that compounds with the R&DTI advance.

**GST input tax credits on capital and leasing.** When an R&D claimant
spends on:

- **Leased equipment / facilities** (lease payments are GST-inclusive)
- **Capital equipment purchases** (item price + GST)
- **Cloud / software subscriptions** (GST-inclusive)
- **Contractor invoices** (GST-inclusive)

...they pay 10% GST on those inputs. As a GST-registered business, that
GST is **recovered through the quarterly BAS** as an input tax credit.
Net GST refund arrives ~42 days after quarter-end (28 days for BAS
lodgement + 14 days for ATO processing) — meaning it lands roughly 6
weeks into the _next_ quarter, in time to flow into late-quarter spend.

**For a leasing-heavy R&D model, GST credit ≈ 10% of total quarterly
spend, and lease payments ALSO qualify for the full R&DTI offset in-year**
(unlike purchased capital, which is depreciated under Div 40 and produces
slower R&DTI). This is why the spec's marketing examples favour leasing
over purchasing for high-amplification scenarios.

#### Worked example — A$600K base committed, capital items / leasing

Same A$600K base commitment, same 82.5% LTV, same 16% APR, same A$48K
consultant fees. Additional input: spend is 100% on leased capital
equipment + cloud / contractor services (all GST-inclusive). GST credit
~9.09% of spend (1/11 gross-up math) recovered quarterly via BAS.

| Q         | Base spend | Prior-Q R&DTI advance | Prior-Q GST credit | **Total quarterly spend**    | New R&DTI advance (82.5% LTV × 44% × 80% qualifying) | GST credit on this Q's spend (9.09%) |
| --------- | ---------- | --------------------- | ------------------ | ---------------------------- | ---------------------------------------------------- | ------------------------------------ |
| Q1        | A$150K     | —                     | —                  | **A$150.00K**                | A$43.56K                                             | A$13.64K                             |
| Q2        | A$150K     | A$43.56K              | A$13.64K           | **A$207.20K**                | A$60.18K                                             | A$18.84K                             |
| Q3        | A$150K     | A$60.18K              | A$18.84K           | **A$229.02K**                | A$66.51K                                             | A$20.82K                             |
| Q4        | A$150K     | A$66.51K              | A$20.82K           | **A$237.33K**                | (none)                                               | A$21.58K                             |
| **Total** | A$600K     | A$170.25K             | A$53.30K           | **A$823.55K deployed in FY** | A$170.25K cumulative                                 | A$74.88K cumulative                  |

#### Combined refund and financing economics

| Line item                                                      | Amount                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Total R&D deployed within FY                                   | **A$823.55K** (vs A$759.65K without GST layer)                               |
| Additional R&D from GST layer alone                            | **+A$63.90K**                                                                |
| Total qualifying R&D                                           | A$658.84K                                                                    |
| Total expected R&DTI refund                                    | A$289.89K                                                                    |
| Total GST credits recovered via BAS                            | A$74.88K                                                                     |
| **Total ATO refund flow (R&DTI + GST)**                        | **A$364.77K**                                                                |
| R&DTI advance principal drawn (cumulative)                     | A$170.25K                                                                    |
| Total R&DTI interest cost (shortened tranches)                 | ~A$13.50K                                                                    |
| Consultant fees                                                | A$48.00K                                                                     |
| Lender takes from R&DTI refund                                 | A$183.75K                                                                    |
| **Net cash to borrower after loan payoff and consultant fees** | **~A$106.14K (R&DTI) + A$74.88K (GST already received in-year) = A$181.02K** |

#### What this means for the marketing claim

**A$600K base commitment → A$823K deployed in FY** with capital/leasing
mix. That's a **+37% capacity uplift inside the FY**, vs +27% without GST
layering. **The A$900K headline number is achievable** with one of:

- Slightly higher base commitment (A$650K → A$890K deployed)
- Higher LTV at top of band (85% instead of 82.5%)
- Higher qualifying ratio (90% for pure-software claimants where most
  spend is contractor/SaaS — both GST-recoverable)

#### Why BAS cadence alignment matters operationally

A claimant who does quarterly R&DTI sign-offs in the platform is **already
preparing the same numbers they need for BAS**. The platform can:

- Auto-populate BAS-ready GST extracts at each quarterly sign-off
- Show projected GST refund alongside R&DTI advance in the budget
  calculator
- Sequence the cash-flow waterfall: R&DTI advance hits 24–48h after
  sign-off; GST credit hits ~6 weeks later; both available for the next
  quarter's deployment

This integration is a **major adoption lever** — accountants and CFOs
already do this work every quarter; the platform makes it
research-claim-aware and feeds the proceeds directly into the next R&D
cycle.

#### Lease-vs-purchase decision support (a Phase 2 advisory module)

The AI tax advisory module (§3.4) extends to advise on
**lease vs purchase** decisions for R&D capital. The math:

| Treatment                                                                       | R&DTI in-year?                                                | GST recoverable?     | Depreciation?                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------- | ------------------------------------------------ |
| **Lease** (operating lease)                                                     | ✅ Full lease payment qualifies (subject to dominant-purpose) | ✅ Quarterly via BAS | ❌ N/A (lessor owns)                             |
| **Purchase** (capital item, Div 40)                                             | ⚠️ Only the year's depreciation amount qualifies              | ✅ Quarterly via BAS | ⚠️ Spread over effective life (often 3–10 years) |
| **Purchase, immediate expensing** (if eligible under SBE rules <A$20M turnover) | ✅ Full cost qualifies                                        | ✅ Quarterly via BAS | ❌ Already expensed                              |

For R&D equipment that the company doesn't need to own long-term (compute
infrastructure, specialised analytical instruments, biotech reagents),
**leasing produces a meaningfully larger in-year R&D capacity** than
purchasing. The advisory module surfaces this trade-off in the planning
flow — another reason the client-side app is worth paying for.

### 7.6 Labour on-costs — the salary-heavy R&D profile

Most software-driven R&D claimants spend 60–70% of their R&D budget on
**staff salaries plus on-costs**. The platform's math is materially
stronger for these claimants because **labour on-costs are claimable for
R&DTI alongside the base salary**.

#### What counts as labour on-costs

Australian payroll layers ~25–30% in on-costs on top of every dollar of
base salary paid to an R&D employee:

| On-cost                           | Rate (FY2025–26)                      | Notes                                                                                                               |
| --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Superannuation Guarantee          | 12.0% of OTE                          | Stepped up from 11.5% on 1 Jul 2025; 12% is the new statutory rate                                                  |
| Payroll tax                       | 4.75–6.85%                            | State-dependent (VIC 4.85%, NSW 5.45%, etc.); only above the state-specific threshold (VIC ~A$700K, NSW ~A$1.2M, …) |
| Workers' compensation             | 1–3%                                  | Industry-dependent; software/biotech sits at the low end                                                            |
| Annual leave loading              | 17.5% × leave portion (~1.5% of base) | Required under most awards / enterprise agreements                                                                  |
| Long service leave accrual        | 1.5–2%                                | Annualised provision for future LSL liability                                                                       |
| **Typical total on-cost loading** | **~25–30%**                           | Higher for above-threshold payroll-tax-paying employers                                                             |

For R&DTI purposes, **the full labour cost — base + on-costs — qualifies**
as R&D expenditure (subject to time-apportionment and the dominant-purpose
test). A company paying an R&D engineer A$150K base salary actually claims
~A$190K of R&DTI expenditure once on-costs are included.

#### Why this rewards companies that pay well

Higher salaries → higher on-costs (proportional) → higher R&DTI refund.
The Australian R&DTI structurally **subsidises talent investment**:

- Engineer paid A$120K base → A$156K total labour cost → A$68.6K R&DTI
  refund @ 44% (effectively the government pays 36% of total comp)
- Engineer paid A$180K base → A$234K total labour cost → A$103K R&DTI
  refund @ 44% (same 36% effective subsidy)

The R&D-intensity premium structure adds further reward for companies
where R&D spend is a high share of total operating cost — typical of
early-stage / scaling tech companies. The platform's AI tax advisory
(§3.4) surfaces this trade-off when the founder is planning hiring
decisions: "Hiring this senior engineer at A$200K vs a mid-level at
A$140K costs you A$60K more in cash terms but only A$33.6K in net cost
after R&DTI offset" — making the senior hire 44% cheaper than naive
budgeting suggests.

#### The salary-heavy worked example

Most software R&D claimants have spend mix closer to: 70% labour + 30%
non-labour (cloud, contractors, leased compute, software subscriptions).
Re-running the math with this mix:

| Factor                                   | Capital/leasing-heavy (§7.5 above) | Salary-heavy (this section)                              |
| ---------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Spend mix                                | 100% non-labour (GST-eligible)     | 70% labour + 30% non-labour                              |
| Effective qualifying ratio               | 80%                                | **94%** (100% on labour × 70% + 80% on non-labour × 30%) |
| GST credit rate                          | 9.09% of spend                     | 2.73% of spend (only the 30% non-labour)                 |
| R&DTI advance ratio (per A$1 spend)      | 82.5% × 44% × 80% = **29.04%**     | 82.5% × 44% × 94% = **34.13%**                           |
| GST credit (per A$1 spend)               | 9.09%                              | 2.73%                                                    |
| Combined per-quarter recycle into next Q | ~38.1% of prior-Q spend            | ~36.9% of prior-Q spend                                  |

**Quarterly cash flow (A$600K base, 70% labour mix):**

| Q         | Base   | Prior-Q R&DTI advance | Prior-Q GST credit | **Total Q spend**      | R&DTI advance this Q | GST credit this Q   |
| --------- | ------ | --------------------- | ------------------ | ---------------------- | -------------------- | ------------------- |
| Q1        | A$150K | —                     | —                  | **A$150.00K**          | A$51.20K             | A$4.09K             |
| Q2        | A$150K | A$51.20K              | A$4.09K            | **A$205.29K**          | A$70.07K             | A$5.60K             |
| Q3        | A$150K | A$70.07K              | A$5.60K            | **A$225.67K**          | A$77.03K             | A$6.15K             |
| Q4        | A$150K | A$77.03K              | A$6.15K            | **A$233.18K**          | (none)               | A$6.36K             |
| **Total** | A$600K | A$198.30K             | A$15.84K           | **A$814.14K deployed** | A$198.30K cumulative | A$22.20K cumulative |

#### Comparison across profiles

| Profile                                                          | A$600K base → deployed | Total ATO refund (R&DTI + GST)           | Net to borrower after loan payoff + consultant |
| ---------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ---------------------------------------------- |
| R&DTI only (capital-heavy, no GST optimisation)                  | A$759.65K              | A$267.40K                                | ~A$95K                                         |
| **Capital/leasing-heavy** (R&DTI + max GST credit)               | **A$823.55K**          | **A$364.77K**                            | ~A$181K                                        |
| **Salary-heavy** (R&DTI + high qualifying ratio)                 | **A$814.14K**          | **A$359.27K** (A$337K R&DTI + A$22K GST) | ~A$187K                                        |
| **Hybrid optimal** (50% labour + 50% lease/contractor, mid case) | **A$830K+**            | **~A$355K**                              | **~A$200K+**                                   |

#### Two takeaways for marketing

1. **"Pay your R&D team well — the government rewards it."** Higher
   salaries generate proportionally higher R&DTI refunds (constant 44%
   effective subsidy on labour). The platform's advisory module surfaces
   this in every hiring decision the founder makes.

2. **"Lease your compute and equipment — recycle the GST."** For
   capital-light R&D (most software), the marginal A$ of non-labour spend
   recovers GST faster than the marginal A$ of salary, but salary spend
   recovers higher R&DTI ultimately. Both refund streams compound through
   the quarterly BAS + R&DTI cycle.

The CFO understands both arguments instantly. The CTO uses them to
justify both senior-hire decisions AND the cloud-bill / equipment-leasing
choices. **The platform makes both decisions visible at planning time
rather than discovered at year-end.**

#### Reaching the A$900K marketing claim

The earlier "A$600K → A$900K" framing requires more aggressive inputs than
the conservative table above. To hit A$900K of deployed R&D:

| Lever                                  | Required value     | Defensibility                                                            |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| Initial annual commitment              | A$700K (vs A$600K) | Borrower can commit more                                                 |
| LTV                                    | 85% (vs 82.5%)     | Top of stated range                                                      |
| Qualifying ratio                       | 90% (vs 80%)       | Achievable for pure-software claimants where overhead allocation is high |
| Plus: Q4 advance redeployed in late-Q4 | +A$60–80K extra    | Operationally tight; lender approval needed                              |

With these settings, A$700K base × ~1.30 leverage ≈ **A$910K deployed**.
The A$900K figure is achievable for the most R&D-intensive claimants
(typically software/biotech) under favourable assumptions; the A$830K
figure is the more defensible base-case marketing number.

#### Why this isn't possible without Product 1.3

The within-FY compounding only works if each quarter's advance arrives
**before** the next quarter's spend window opens. Without lending:

- Annual claim lodged at FY-end (or up to 10 months after)
- Refund arrives 8–14 weeks after lodgement
- ALL the refund lands in next FY
- Zero within-FY compounding

The claimant deploys A$600K and gets A$211K (or so, accounting for usual
qualifying ratios) refunded next year. Useful, but not transformative.

With Product 1.3, each quarter's advance hits within 24–48 hours of
sign-off, opening the next quarter's spend window with the advance already
in the bank.

#### Sensitivity — when does this break?

| Sensitivity                                                          | Effect on FY deployment                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LTV at low end (80% instead of 82.5%)                                | A$760K → ~A$745K (still +24% uplift)                                                                                                                                                  |
| LTV at high end (85%)                                                | A$760K → A$780K                                                                                                                                                                       |
| Lower qualifying ratio (60% — service businesses with high overhead) | A$760K → ~A$690K (still +15% uplift; thin)                                                                                                                                            |
| Higher interest cost (20% APR instead of 16%)                        | A$760K → ~A$755K (interest is small relative to the leverage)                                                                                                                         |
| Higher consultant fee (A$15K/claim instead of A$12K)                 | A$760K → A$748K                                                                                                                                                                       |
| Non-refundable offset tier (>A$20M turnover, 37.5–46.5%)             | Maths still works but the offset is a tax reduction not cash; the redeployment loop requires the company to have offsetting tax liability each quarter, which most large companies do |
| Refund denied / clawed back                                          | Catastrophic — but this is exactly what contemporaneous-evidence + CQS A-band scoring reduces the probability of                                                                      |

#### Marketing framing

**Headline (conservative, defensible):**

> "With Omniscient, your A$600K R&D budget becomes A$760K of R&D activity
> in the same year — a 27% capacity uplift. We turn next year's refund
> into this year's experiments."

**Headline (aggressive, software-heavy claimants):**

> "A A$700K R&D budget becomes A$900K of R&D activity in the same year —
> with Omniscient turning next year's refund into this year's experiments."

The CTO cares about the planning tools and AI tax advisory; the CFO cares
about which of these two numbers applies to their company. Both signatures
are required for the seat purchase.

---

## 8. Build phasing

Roughly mirrors the financier-pillar phasing in
[`financier-pillar-plan-summary.md`](./financier-pillar-plan-summary.md),
because the two pillars compound.

### Phase 1 — MVP webapp (Months 1–4, ~16 engineer-months)

**Scope:**

- Hypothesis Entry Module (§3.1)
- Planned Experimentation Editor (§3.3)
- Simple AI Tax Advisory (§3.4) — core/supporting classification only;
  defer claimable-amount and depreciation analysis to Phase 2
- Quarterly Budget Calculator (§3.5) — deterministic calc only
- Annual Rollup Dashboard (§3.6) — basic
- Schema migrations + chain event kinds (§4.1)

**Deferred:**

- IP Research Agent (§3.2)
- Mobile app (§3.8)
- Advanced AI tax advisory (claimable amount, depreciation)

**Target audience:** 5–10 design-partner clients of existing
consulting-firm subscribers.

### Phase 2 — IP research + advanced advisory (Months 5–9, ~20 em)

**Scope:**

- IP Research Agent (§3.2) with web-search + paper-search + patent-search
- Claimable-amount AI analysis (§3.4 question 2)
- Depreciation handling (§3.4 question 3)
- Citation corpus validation system (§6.3 mitigation)
- Confidence gating with consultant-review escalation

### Phase 3 — Mobile + polish + launch (Months 10–14, ~16 em)

**Scope:**

- Mobile app companion (§3.8) — iOS + Android
- Quick-capture voice / photo / receipt flows
- Push notification infrastructure
- General launch readiness (onboarding, billing, support)

### Phase 4 — Lending integration (Months 15+, runs in parallel with financier-pillar Phase 3)

**Scope:**

- "Finance my refund" CTA at quarterly budget calc (cross-references the
  financier pillar's borrower-facing surface)
- Direct user flow from quarterly budget into lender application
- Loan-funded budget visualisation in annual rollup

---

## 9. Open decisions / design questions

These are explicit calls that need to be made before or during Phase 1
implementation. Captured for the next planning session.

**Resolved by §0 architecture:** signup is consultant-invited only (no
self-serve at any tier). Open Decision #1 from the prior draft is settled.

| #   | Question                                                                                                                        | Default if not decided                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Does the consultant see client-side planning data live, or only at year-end handoff?                                            | Live (consultant can advise mid-cycle; aligns with the prospective model)                                                                                                                                                                                                |
| 2   | What's the tax-advisory accuracy bar? Hallucination tolerance?                                                                  | Citation-required + confidence-gated; below 0.7 confidence shows "consultant review recommended"                                                                                                                                                                         |
| 3   | Quarterly cadence enforcement — does the system push users to complete Q2 planning by a calendar date?                          | Reminder-only (notifications + email); no hard locks                                                                                                                                                                                                                     |
| 4   | What happens at claim time? Does the consultant still use the existing wizard, or a streamlined "review client's plan" flow?    | Existing wizard — but Step 1's evidence feed is pre-populated; Step 4's narrative uses the client's plan as primary input                                                                                                                                                |
| 5   | Pricing model — annual or monthly?                                                                                              | Annual (matches the R&D fiscal year cadence)                                                                                                                                                                                                                             |
| 6   | Does the AI tax advisory require AFSL or tax-agent registration?                                                                | Legal review required before launch; default assumption is no, but verify                                                                                                                                                                                                |
| 7   | Do we need a separate "ATO debt" check in the budget calculator (the user's refund could be offset against existing ATO debts)? | Yes — surface as a warning if the platform detects ATO debt position                                                                                                                                                                                                     |
| 8   | Should the IP research agent's web search be live (Anthropic web tool) or pre-cached corpus only?                               | Live web tool (more recent prior art coverage) + cache hits for repeat queries                                                                                                                                                                                           |
| 9   | Mobile-first or webapp-first?                                                                                                   | Webapp-first (the planning UI is dense; mobile is companion-quality)                                                                                                                                                                                                     |
| 10  | Does the consultant get a revenue share when their client opens a 1.3 loan?                                                     | TBD — likely yes (preserves the consultant's incentive to push 1.2 adoption, which gates 1.3 volume). The financier-pillar doc currently assumes 0.5% of loan principal as consultant referral commission — confirm this flows to the consultant who invited the client. |

---

## 10. Success metrics

How we'll know the client-side app is working.

**Phase 1 (MVP) target (Month 4 launch):**

- 10–20 design partner companies active
- ≥80% complete at least one hypothesis + experiment cycle
- ≥60% return for Q2 budget planning
- Net Promoter Score from design partners ≥40

**Phase 2 (Month 9) target:**

- 100+ paying webapp seats
- Average chain-event count per active claimant ≥30 events
- ≥70% of active claimants generate A-band CQS scores at claim time
- 50% of design partner consulting firms have ≥3 of their clients on the
  webapp

**Phase 3 (Month 14, full launch) target:**

- 500–1,000 paying webapp seats
- 100–250 mobile seats
- A$0.3–0.5M ARR from client-side seats alone

**Year 3 target (per §7.3):**

- 3,000–5,000 webapp seats (60–80% of in-network claimants)
- 1,000–2,500 mobile seats
- A$1.9–4.0M ARR from client-side seats
- A-band CQS coverage on ≥80% of in-network claims
- Lending pillar GMV correlated with client-side seat count (validates the
  moat hypothesis)

---

## 11. Cross-references

- [`financier-pillar-plan-summary.md`](./financier-pillar-plan-summary.md) —
  the lending pillar that monetises the data this app generates
- [`../plans/2026-05-12-claim-wizard.md`](../plans/2026-05-12-claim-wizard.md) —
  the consultant-side wizard plan (shipped this week)
- [`../plans/2026-05-12-claim-wizard-design.md`](../plans/2026-05-12-claim-wizard-design.md) —
  design decisions for the consultant-side wizard
- [`../retros/2026-05-12-claim-wizard-smoke.md`](../retros/2026-05-12-claim-wizard-smoke.md) —
  consultant-side wizard smoke retro
- [`./parallel-agent-isolation.md`](./parallel-agent-isolation.md) — process
  notes from the wizard build (relevant for the client-side build too)
