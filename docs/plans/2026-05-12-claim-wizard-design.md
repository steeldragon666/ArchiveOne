# Claim Preparation Wizard — Design

**Status:** Approved 2026-05-12  
**Owner:** Aaron Newson  
**Type:** UX architecture + backend state machine

---

## Problem

The R&DTI preparation features all exist as scattered components — upload-evidence
on subject-tenant pages, proposed-activity cards in pending-narrative panels,
analysis-timeline on claim pages, narrative-stream on activity pages, portal-fields
on activity pages, document generators in their own routes — but there is no
**logical flow** binding them into a sequence a consultant can follow.

The consultant needs a guided journey:

1. **Upload evidence** (documents land, AI classifies them)
2. **Agree to AI-proposed activities** (Agree button per card)
3. **Attribute evidence to each activity** (visual binding)
4. **Review narrative + visual timeline side-by-side**
5. **Generate all submission documents**

This design defines how those steps are presented, persisted, and how the
consultant moves between them.

---

## Decisions

| # | Question | Choice |
|---|---|---|
| Q1 | UX paradigm | **Multi-step wizard** (Step N of 5, Next-to-advance) |
| Q2 | Step boundaries | **5 explicit steps** (Upload / Activities / Attribution / Narrative+Timeline / Generate) |
| Q3 | Entry point | **Wizard-on-create only** — new claims run the wizard; existing claims keep their current tabbed view |
| Q4 | Agree granularity | **Hybrid** — per-item Agree/Reject buttons AND "Agree to all remaining" shortcut |
| Q5 | Revision flow | **Always re-editable** with "Last agreed at" badges + soft warning on downstream steps; no cascade auto-invalidation |
| — | Implementation pattern | **Approach 3 (hybrid)** — `claim.workflow_state` jsonb for audit timestamps; derived `canAdvance` computed live from data |

---

## Architecture

```
/claims/[claim_id]   ← wizard for claims that have workflow_state non-null
                     ← legacy tabbed view for claims with workflow_state = NULL

  WizardStepper        ●────○────○────○────○   "Step 2 of 5"
  WizardStep[N]        <active step component>
                       [Per-item Agree/Reject]
                       [Agree to all remaining]   [Next →]
```

### Routing

- Page: `apps/web/src/app/claims/[claim_id]/page.tsx`
- Switches between wizard and legacy tabbed view based on `claim.workflow_state !== null`
- Step number lives in URL: `?step=2` (defaults to lowest unagreed step)
- Sharable URLs ("I'm stuck on step 3 — here's the link")

### Component tree

```
ClaimWizardPage
├── WizardStepper                    (new — 5-dot progress + Last-agreed-at badges)
├── WizardStep1_UploadEvidence       (new shell)
│   ├── UploadEvidenceButton         (exists)
│   └── EventFeed                    (exists, in subject-tenants/_components)
├── WizardStep2_ReviewActivities     (new shell)
│   ├── PendingNarrativePanel        (exists)
│   └── ActivityProposalCard × N     (new — wraps existing ProposedActivityCard with AgreeRejectButtons)
├── WizardStep3_AttributeEvidence    (new shell)
│   ├── ActivityEvidenceList × N     (new)
│   └── BindToActivityButton         (exists)
├── WizardStep4_ReviewNarrative      (new shell — split-pane)
│   ├── NarrativeStream              (exists, in claims/[claim_id]/_components)
│   └── FiscalYearTimeline           (exists)
└── WizardStep5_GenerateDocuments    (new shell)
    └── DocumentGenerationList       (new — calls existing portal-fields + claim-pdf routes)
```

**New components total: 7.** Everything else is composition over existing parts.

---

## State model

### Schema — migration 0081

```sql
ALTER TABLE claim
  ADD COLUMN workflow_state jsonb;  -- nullable; NULL = legacy claim
```

`workflow_state` shape:

```jsonc
{
  "initialized_at": "2026-05-12T03:00:00Z",
  "steps": {
    "1": { "agreed_at": "2026-05-12T03:15:00Z", "agreed_by": "<user_uuid>" },
    "2": { "agreed_at": "2026-05-12T03:45:00Z", "agreed_by": "<user_uuid>" },
    "3": null,
    "4": null,
    "5": null
  }
}
```

### Derived state (live, not stored)

`canAdvance(stepN, claim, data) → boolean | string` — pure function that
inspects current data and returns true (advance-able), or a reason string
("no evidence uploaded yet", "2 activities still pending"). Computed on
every GET `/v1/claims/:id/workflow`.

| Step | Advance condition |
|---|---|
| 1 | ≥1 evidence event with non-`pending` classification |
| 2 | every `proposed_activity` for the claim has `status != 'pending'` (agreed or rejected) |
| 3 | every agreed activity has ≥1 bound event |
| 4 | every narrative section has `status = 'approved'` |
| 5 | (no further advance — just generates docs) |

### Soft revision (Q5.b)

When a consultant edits a prior step:
1. Underlying data changes (new event, rejected activity, etc.)
2. `canAdvance` for a later step may flip to a reason string
3. Wizard UI shows yellow banner on the affected step: "Last agreed at X;
   data changed since — review and re-Agree."
4. `workflow_state.steps[N].agreed_at` stays as historical record
5. Consultant clicks Agree again → `agreed_at` updates, banner clears

**No cascade.** Editing step 1 does NOT auto-clear step 4's `agreed_at`.
The consultant decides whether the downstream is still valid.

---

## Server API

New file: `apps/api/src/routes/claim-workflow.ts`

```
POST   /v1/claims/:id/workflow/initialize         → set workflow_state.initialized_at;
                                                    called on claim creation by wizard path
POST   /v1/claims/:id/workflow/step/:n/agree      → writes agreed_at; enqueues AI for step n+1
POST   /v1/claims/:id/workflow/step/:n/reopen     → clears agreed_at (soft un-agree)
GET    /v1/claims/:id/workflow                    → returns { state, derived: { canAdvance: {1..5} } }
```

**RLS:** All routes use existing `requireSession` + tenant-scoped `sql.begin()` —
no new RLS rules needed. The `claim` table already has tenant isolation.

**Concurrent edits:** Optimistic locking via `updated_at` — wizard reads
`workflow_state` with the row's `updated_at`; PATCH includes `if_match: updated_at`;
server returns 409 if it doesn't match.

---

## AI trigger mapping

| Transition | Agent | Trigger | Behaviour |
|---|---|---|---|
| Step 1 upload | `classifier` (Haiku) | pg-boss job (already wired by `events` route) | Per-event classification |
| Step 1 → 2 advance | `synthesize-register` (Sonnet) | **NEW** pg-boss job `claim-activity-proposal` | Produces `proposed_activity` rows |
| Step 2 → 3 advance | `auto-allocator` (Haiku) | **NEW** pg-boss job `claim-evidence-binding` | Pre-suggests artefact_link rows per activity |
| Step 3 → 4 advance | `draft-narrative@1.1.0` (Sonnet stream) | existing `/v1/activities/:id/narrative` route | Streams 4 narrative sections |
| Step 5 generate | `draft-narrative@1.2.0` (portal-fields) + `claim-pdf` route | parallel API calls | One per activity + claim PDF |

The AI agents already exist; the wizard wires step transitions to enqueue
the right jobs. The two new pg-boss jobs reuse existing agent code.

---

## Error handling

Per-step failure surface:

| Failure | Surface | Recovery |
|---|---|---|
| Upload fails | Toast + per-file error chip in feed | Retry per file; other files proceed |
| Classifier fails | Red badge "Classification failed" on the event | Manual classify dropdown |
| Synthesize-register fails | Step 2 banner + "Re-run AI" button | Manual create-activity path via existing `<CreateActivityButton />` |
| Auto-allocator fails | Step 3 just shows no suggestions | Manual `<BindToActivityButton />` works either way |
| Narrative drafter fails | Per-section error + "Regenerate this section" | Manual textarea edit |
| Document generator fails | Red ✗ per generator with Retry | Each runs independently |
| Concurrent edit (409) | Toast "another user advanced this step" + refetch | Auto-refresh |
| Stale step (data changed since Agreed) | Yellow banner per Q5.b | Re-Agree to clear |

**Generic:** All step buttons use `useMutation.isPending` to prevent
double-submit. API responses include `requestId` for log correlation.

---

## Testing

| Layer | What | Where |
|---|---|---|
| Unit | `canAdvance(step, claim, data)` pure function — 5 steps × happy/sad fixtures | `apps/api/src/lib/workflow.test.ts` (new) |
| Unit | Reducer-style `applyAgree(state, n, user)` | Same file |
| Schema | Zod `WorkflowState` round-trip | `packages/schemas/src/claim-workflow.ts` (new) |
| Migration | 0081 applies + legacy claims have NULL workflow_state | `packages/db/src/migrations.test.ts` (existing harness) |
| Route | POST `/agree` — auth + preconditions + AI trigger (nock-mocked) | `apps/api/src/routes/claim-workflow.test.ts` (new) |
| Route | GET `/workflow` — derived `canAdvance` matches fixture data | Same |
| Component (light) | `<WizardStepper />` renders 5 dots, marks completed correctly | `wizard-stepper.test.tsx` |
| E2E | Full happy path | Playwright — **deferred** to a follow-up commit |

---

## Out of scope (deferred)

- **Playwright E2E** of the full 5-step happy path — too flaky vs LLM mocks; lands in a follow-up
- **Multi-consultant collaboration** (real-time presence, "Alice is reviewing step 2") — current model is one consultant at a time with optimistic-lock 409s
- **Step-skipping** (jump from step 1 to step 5 without intermediate Agrees) — explicitly NOT supported; the linear sequence is the point
- **Wizard for legacy claims** — Q3.c excluded this. A follow-up migration can backfill `workflow_state` for existing claims if needed.
- **Partner review approval** — a possible step 4.5 ("Partner sign-off") deferred until that role is well-defined in the platform

---

## Migration impact

- **0081**: `ALTER TABLE claim ADD COLUMN workflow_state jsonb` — nullable, default NULL — backward-compatible
- **No app-code behavior change for legacy claims** (NULL workflow_state → tabbed view, same as today)
- **New claims** created via the wizard flow auto-initialize `workflow_state`

---

## Implementation sequence (to be detailed by writing-plans)

Rough sequence (writing-plans skill produces the detailed task breakdown):

1. Migration 0081 + Zod schema + `canAdvance` pure function + unit tests
2. Claim-workflow API routes + route tests (nock-mocked AI)
3. New pg-boss jobs for `claim-activity-proposal` and `claim-evidence-binding`
4. `ClaimWizardPage` + `WizardStepper` + step 1 (Upload Evidence) — first vertical slice
5. Step 2 (Review Activities) — wraps existing `<ProposedActivityCard />` with Agree/Reject
6. Step 3 (Attribute Evidence)
7. Step 4 (Narrative + Timeline split-pane)
8. Step 5 (Generate Documents)
9. Wire `?step=N` URL routing + sharable links
10. Wire claim-creation to call `/workflow/initialize`
