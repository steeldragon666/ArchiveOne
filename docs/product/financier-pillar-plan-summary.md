# Financier Pillar — Plan Summary

**Source:** Omniscient AI Whitepaper v1.0 (April 2026), "Software-Defined
Origination — The embedded finance opportunity in Australian R&D Tax
Incentive lending." 71 pages.

**Companion doc:** [`client-side-app-spec.md`](./client-side-app-spec.md)
specs Product 1.2 (client-side app). THIS doc covers Product 1.3 (financier
loan module). The product architecture is gated 1.1 → 1.2 → 1.3 — see
§0 of the client-side spec for the full gating logic.

## The gate (one-paragraph version)

Product 1.3 (this doc) is **only accessible to claimants on Product 1.2**.
Product 1.2 is **only accessible to claimants invited by a consultant on
Product 1.1**. There is no self-serve borrower path. A panel lender on the
platform cannot acquire a borrower outside the platform's invitation flow.
This gate is the entire defensibility argument — it's why a Big-4 bank
can't go around the platform direct to claimants, and why a competitor
fintech can't replicate the channel even with A$50–100M of capital.

## Why borrowers want this — the demand-side argument

The whitepaper's lender-facing argument is well-developed (channel
ownership, deal flow, underwriting cost). The **borrower-facing** argument
is equally important: without lending, borrowers wait 8–14 weeks (after
year-end lodgement) for their refund and can't compound it inside the FY.
With quarterly advances at 80–85% LTV, 16% APR daily-compounded, each
quarter's advance redeploys within 24–48 hours of sign-off,
**amplifying a A$600K committed R&D budget into ~A$760K of deployed R&D
in the same fiscal year** — a +27% capacity uplift. For
R&D-intensive software claimants with higher qualifying ratios, the
upper-bound figure approaches A$900K.

**Tranche durations are short by design.** Each quarter's advance is
outstanding only until the ATO refund arrives ~3 months post-FY-end
lodgement:

| Tranche    | Outstanding | Effective interest  |
| ---------- | ----------- | ------------------- |
| Q1 advance | ~9 months   | ~12.6%              |
| Q2 advance | ~6 months   | ~8.3%               |
| Q3 advance | ~3 months   | ~4.1%               |
| Q4 advance | 0–3 months  | typically not drawn |

For a A$600K-base borrower, total interest cost is ~A$13K across the year
(short tranche durations keep it low) plus A$48K in consultant fees,
delivering A$160K of additional R&D capacity inside the FY plus A$95K of
surplus refund cash after loan payoff.

The full worked example with quarterly cash flows is in
[`client-side-app-spec.md §7.5`](./client-side-app-spec.md). The headline
framing for borrower acquisition:

> "Your A$600K R&D budget becomes A$760K of R&D activity in the same year
> — A$900K for software-intensive R&D. We turn next year's refund into
> this year's experiments."

This is what closes the CFO. The seat-fee economics (A$500/yr webapp) are
trivial compared to the additional deployed R&D the quarterly advance
cycle enables. **Borrower demand for Product 1.3 is what drives lender
volume on the panel** — without compelling borrower economics, the lender
side of the platform doesn't fill its capacity.

---

## The thesis in one line

> AU R&DTI advance lending is bottlenecked by deal flow + underwriting cost
> (not capital). The platform that owns the consulting workflow + planning
> data becomes the underwriting layer for the entire credit category.

The lending pillar is what monetises the data the consultant-side wizard
and the client-side planning app generate. Without lending, that data sits
unused at fair-value zero. With lending, it generates A$10–16M ARR by Year
3 at 80%+ gross margin and supports a A$84–150M exit valuation on the
financier pillar alone.

---

## Market sizing (anchor numbers to remember)

| Metric                           | Value                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R&DTI claimants FY22-23          | **13,134**                                                                                                                                                                               |
| Aggregate refundable offset paid | **A$2.3B**                                                                                                                                                                               |
| Median claim size (notional)     | A$280K                                                                                                                                                                                   |
| Upper-quartile claim             | A$540K                                                                                                                                                                                   |
| Current advance-lending GMV      | A$550–850M (~50% by dollars, <20% by claimants)                                                                                                                                          |
| Forecast GMV 2030                | A$1.5–2.5B                                                                                                                                                                               |
| **The gap**                      | **4,000–5,500 claimants/yr in the A$200–700K band, <10% penetration** — too small for direct lenders to underwrite economically, large enough to matter on platform-mediated origination |

## Who's in the market today

- **Radium Capital** — A$925M+ cumulative; saturated on the consultant-referral channel; will hit defensive consolidation pressure as we scale
- **Fundsquire** — A$200M cumulative across AU+UK+US, ~40-50% AU. **Our intended Founding Partner.**
- **Tractor Ventures** — A$60–80M; broader RBF business; intended Premium Partner
- **Tail of others** — Banjo, Apricity, ScotPac, Optipay

**Why incumbents can't build this themselves:** building consulting-firm SaaS is a different operational discipline from lending (ACV sales vs single-loan transactions, NRR vs loss rate, CS+product vs credit+ops); consulting firms perceive captive lenders as conflicts and prefer panels; and the calibration data for an underwriting score takes 24–36 months — by which time we're 3 years ahead.

---

## What the platform actually sells to lenders

### Three structural advantages

1. **Channel ownership.** By Year 3 we address 38–50% of the entire R&DTI claimant base via the consulting-firm install base (80–130 firms × 5,000–6,500 claimants/yr).
2. **Pre-qualified 240-field deal package.** Replaces 7–14 days of manual document collection with a 12-minute assembly. Lender effort per loan drops from 11–17h to 30 min (auto) / 4h (manual).
3. **Compliance-graded claims by default.** Hash-anchored, time-stamped, hypothesis-articulated, BBM/UVI-defensible — structural property of how the platform operates, not a feature.

### The 14× compression

| Stage                 | Direct lender | Platform-mediated |
| --------------------- | ------------- | ----------------- |
| Wall-clock cycle      | 21–28 days    | 24–48 hours       |
| Borrower effort       | 8–14 hours    | 12 minutes        |
| Lender effort         | 11–17 hours   | 30 min – 4 hours  |
| First-time-right rate | ~60%          | ~95%              |

For a 300-loan/year panel lender, that's **4,500 lender-team hours saved/yr** (2.5 FTE) plus zero CAC — uplift A$2.3M+ on top of A$180K platform fee = **13× ROI on the platform fee**.

---

## The Claim Quality Score (CQS) — central IP

0–100 composite. Six weighted components:

| Component                | Weight  | Signal                                             |
| ------------------------ | ------- | -------------------------------------------------- |
| Advisor track record     | **25%** | TPB register + AAT/ART history + platform-internal |
| Evidence chain integrity | **20%** | Hash-anchor presence + coverage (OpenTimestamps)   |
| BBM/UVI defensibility    | **15%** | Fine-tuned classifier on AAT/ART corpus            |
| Hypothesis articulation  | **15%** | Continuous-scale quality classifier                |
| Contemporaneous docs     | **15%** | File metadata + content analysis                   |
| Sector benchmark         | **10%** | Expenditure ratios vs ATO Transparency Report      |

**Score bands:** A (80–100) auto-decision, B (60–79) standard, C (40–59) conditional, D (0–39) decline.

**Validation targets:** AUROC ≥0.78 against clawback events, calibration slope 0.9–1.1, Cohen's κ ≥0.65 on subjective components.

**Why it's non-replicable:** calibrated against our evidence vault (hash-anchored, time-stamped, no external access). An entrant needs 24–36 months and A$5–10M to replicate.

---

## Pricing — what we charge lenders

Three layers stacked per partner:

### Layer 1: Annual platform fee (by tier)

| Tier           | Fee                                  | Setup Y1                     | Marketplace position | Term  |
| -------------- | ------------------------------------ | ---------------------------- | -------------------- | ----- |
| **Founding**   | A$360K (Y1 A$270K with 25% discount) | A$60K (waived for inaugural) | First default        | 36 mo |
| **Premium**    | A$180K                               | A$45K                        | Top-3 algorithmic    | 24 mo |
| **Standard**   | A$84K                                | A$30K                        | Algorithmic          | 12 mo |
| **Specialist** | A$48K                                | A$18K                        | Sector filter        | 12 mo |

### Layer 2: Origination fee on every loan funded

- Founding 1.5% / Premium 2.0% / Standard 2.5% / Specialist 2.0%
- Three structural variants: A flat-at-funding (default), B trail commission (Founding+Premium), C NIM share (Founding only)

### Layer 3: Modular add-ons (annual)

White-label widget (A$60–84K), exclusive sector (A$120K), custom decisioning (A$60K), loss benchmarking (A$36K), claim-quality analytics (A$24K), QPR (A$18K), marketing co-invest (A$48K match), bespoke API (A$60K+A$24K/yr).

### Consultant referral commission (cost to us, lever for adoption)

0.5% of loan principal paid to the consulting firm. Roughly offsets ~46% of a Tier 2 firm's subscription — turns the SaaS from cost-centre to partial revenue source for the consultant. This is the lever that drives consulting-firm install base growth.

---

## Year-3 economics (the headline numbers)

| Line                                       | Value                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Panel composition                          | 1 Founding + 2 Premium + 1–2 Standard + 1–2 Specialist                           |
| Total loans/yr through platform            | 1,200–1,500                                                                      |
| Average loan size                          | A$650K                                                                           |
| GMV through platform                       | **A$780–975M**                                                                   |
| Net revenue to platform (financier pillar) | **A$10.6–14.0M**                                                                 |
| Operating cost                             | A$1.1M (A$300K infra + A$600K CS/partner mgmt 3-4 FTE + A$220K compliance/legal) |
| Gross margin                               | **80%+**                                                                         |
| Strategic value at exit (7–10× ARR)        | **A$84–150M** from financier pillar alone                                        |

The 7–10× ARR multiple is the conservative end of the embedded-finance precedent set. Comparable: **NAB–Plenti** 2024 partnership implied ~12× ARR on Plenti's then-A$25M ARR.

---

## Build path — the 18-month plan + a Phase 4 option

| Phase       | Months | Scope                                                                | Engineer-months | Cash budget |
| ----------- | ------ | -------------------------------------------------------------------- | --------------- | ----------- |
| **Phase 1** | 1–3    | Single-lender Fundsquire referral pilot (NCCP referrer-exempt model) | 12              | A$320K      |
| **Phase 2** | 4–9    | Three-lender panel + full Lender API + sequential marketplace mode   | 24              | A$540K      |
| **Phase 3** | 10–18  | Auction marketplace + grants finance product + white-label widget    | 18              | A$420K      |
| **Total**   | 18 mo  |                                                                      | **54 em**       | **A$1.28M** |
| **Phase 4** | 19+    | Direct lending + SPV warehouse (conditional on GMV > A$70–140M/yr)   | —               | separate    |

**Critical-path dependencies (must start Month 1):**

1. Fiskil CDR Representative sponsorship (60–90 days)
2. Fundsquire partnership negotiation (30–60 days) + integration (30 days)
3. FrankieOne KYC/AML setup (30 days)
4. Credit Representative appointment under Fundsquire's ACL (60–90 days, needed before Phase 3 marketplace)

---

## Compliance posture (the moat that costs A$5–10M and 18 months to replicate)

Layered by phase:

| Regulation                      | Phase 1             | Phase 2         | Phase 3       | Phase 4    |
| ------------------------------- | ------------------- | --------------- | ------------- | ---------- |
| NCCP referrer exemption         | Active              | Active          | Superseded    | n/a        |
| Credit Rep under Fundsquire ACL | —                   | Applying        | Operative     | Own ACL    |
| AML/CTF reporting entity        | No (lender is)      | No              | Joint program | Yes (own)  |
| Privacy Act + APP               | PbD embedded        | Audited         | Continuous    | Continuous |
| CDR Representative (via Fiskil) | Active              | Active          | Active        | Active     |
| Code Determination 2024         | Disclosure auto-gen | Same            | Same          | Same       |
| DDO (RG 274)                    | Lender's            | Lender's        | Joint TMD     | Own TMD    |
| AFCA                            | Voluntary           | Voluntary       | Voluntary     | Required   |
| IRAP-Protected                  | Working towards     | Working towards | Achieved      | Maintained |

**Two AU digital-infra primitives we ride that didn't exist 3 years ago:** Director ID register (operative Nov 2021) + CDR Banking (fully operative 2022) + myGovID (mature) — these are what let the 12-minute deal-package assembly work at all.

---

## Why now — the regulatory window converging in 2026

Three forcing functions:

1. **SERD + Ambitious Australia reforms** (effective 17 March 2026) restructure R&DTI thresholds — minimum R&D expenditure rises A$20K → A$150K. Displaces ~18.8% of the FY22-23 claimant base. The post-SERD compliance burden in the A$150K–A$1M expenditure range is materially higher under new rules.
2. **AML/CTF Tranche-1 reforms** (effective 31 March 2026) extend reporting-entity status to legal practitioners and accountants — raises cost of compliant credit ops.
3. **Tax Practitioners Code Determination 2024** transition closes 1 August 2026 — every R&DTI tax agent must have implemented QMS, supervised-services policies, and client-disclosure docs. Smaller firms most at risk, most likely to adopt platform tooling that bakes compliance in.

**The window:** 12–18 months before a Big-4 bank (most likely NAB, Plenti precedent), an existing specialist lender (Radium under defensive pressure), or a horizontal platform (Stripe Capital AU adaptation) moves to occupy the same structural position. After the window, the install base + CQS calibration data + compliance stack are sufficient to make the position defensible against a A$50–100M competitor investment.

---

## Connection back to the existing platform + client-side vision

| Our build phase today                                                     | Lending pillar phase                        | What it unlocks                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Phase 0 — consultant wizard (just shipped)                                | Pre-build                                   | Compliance-graded claims start accumulating in the evidence vault                                         |
| Client-side planning + advisory webapp + mobile (Phase 1 from vision doc) | Lending Phase 1 (single-lender pilot)       | Hypothesis + plan inputs as contemporaneous evidence; client willingness-to-pay at refund crystallisation |
| Scale client-side (vision Phase 1 maturity)                               | Lending Phase 2 (three-lender panel)        | 240-field deal package complete; CQS calibration v1                                                       |
| Loan origination + scoring (vision Phase 2)                               | Lending Phase 3 (marketplace + grants + WL) | CQS multi-cohort validation; lender choice; widget on lender sites                                        |
| —                                                                         | Lending Phase 4 (own ACL + SPV)             | Direct lending where panel pricing is uneconomic                                                          |

The seat pricing from the existing vision doc ($500 webapp, $250 mobile, $1500/claim) is the **client + consultant side revenue**. This whitepaper's lending pillar (A$10–16M Y3) is the **financier side revenue**. Both run on the same underlying chain-event data model. Both deepen the other's moat.

---

## The 90-day plan from the whitepaper

If we're executing on the financier pillar starting now:

**Weeks 1–2 — Partnership conversations**

- Open Fundsquire formal partnership conversation (existing partnership manager engagement)
- Initiate Tractor Ventures discussion
- Circulate Founding Partner term sheet (Fundsquire) + Premium Partner term sheet (Tractor)
- Engage external counsel for term sheet review

**Weeks 1–4 — Compliance + infra prep**

- Engage Fiskil for CDR Representative sponsorship (60–90 day onboarding)
- Engage FrankieOne for KYC/AML stack (30 day setup)
- Privacy Impact Assessment with counsel
- Legal opinion on NCCP referrer exemption for Phase 1
- Annature OEM agreement for e-signature

**Weeks 4–8 — Engineering Phase 1 build**

- Hire two additional engineers to reach 4-engineer Phase 1 team
- Build "Finance my refund" CTA in claim editor
- Build deal package assembly engine
- Lender API v0 (Fundsquire-specific)
- Sandbox integration testing with Fundsquire credit ops

**Weeks 8–12 — Pilot launch**

- Soft launch with 5–10 Tier 2 consulting firms as design partners
- Transmit first 20 loan applications to Fundsquire
- Iterate on conversion funnel
- Refine consultant referral dashboard
- Brief Lender Advisory Forum on Phase 2 scope

**Day-90 target:** 15–25 applications/month, ~50% conversion, annualised ~A$0.9M origination run-rate from single-lender configuration — enough to validate unit economics and fund Phase 2.

---

## Open decisions / gates for us to make

1. **Are we executing this financier pillar now, or holding it?** The whitepaper assumes execution starts now to capture the 12–18 month window. The wizard is shipped; the client-side planning app (vision doc) is the next major build. The lending pillar could:
   - Run in parallel with client-side build (more capital, more parallel risk)
   - Run sequentially after client-side reaches scale (cleaner but loses the window)
2. **Founding Partner commitment.** Are we comfortable signing Fundsquire as Founding Partner with a 36-month minimum term + 25% Y1 discount + waived setup? This locks them into first-default placement during the 12-month Founding Period.
3. **Funding the build.** A$1.28M over 18 months + 54 engineer-months. Self-funded vs raised? At what valuation?
4. **CQS calibration data strategy.** The whitepaper calls for Datasets A/B/C — we have Dataset A (pilot, just starting); Dataset B (public AAT/ART corpus, requires legal annotation work); Dataset C (post-launch lender outcomes, needs Phase 1 running). What's our concrete plan to assemble each?
5. **Compliance investment timing.** IRAP-Protected by Year 2 is a real ~A$200K compliance programme. Do we book that cost in Year 1 or Year 2?
6. **Phase 4 direct lending — committed or optionality?** The whitepaper treats it as conditional on GMV; we should explicitly decide whether to plan around it or treat it as pure upside.

---

## Source files referenced

- Omniscient AI Whitepaper v1.0 (April 2026) — `~/Downloads/Omniscient Whitepaper.pdf`
- Financier Integration Specification v1.0 (referenced, NDA-only)
- Claim Quality Score Methodology v1.0 (referenced, NDA-only)
- Financier Pricing Model (Excel, referenced)
- Fundsquire Founding Partner Term Sheet, draft (referenced)
