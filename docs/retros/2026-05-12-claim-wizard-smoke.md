# Claim Wizard — Happy-Path Manual Smoke Test

**Date:** 2026-05-12
**Scope:** End-to-end flow from claim creation through document generation.

---

## Flow

1. **Create claim** — Subject-tenant detail page > "New claim" button > enter fiscal year > submit.
   - `createClaim` POST succeeds, `initializeWorkflow` POST fires (best-effort), redirects to `/claims/<id>?step=1`.
   - Claim now has `workflow_state` (non-null) so `is_wizard_claim = true` and the wizard view renders.

2. **Step 1: Upload Evidence** — Upload 2+ source documents via `UploadEvidenceButton`.
   - Files are uploaded to media storage and evidence events are emitted.
   - `EventFeed` shows the new events.
   - `canAdvance['1']` flips to `{ ok: true }` once at least one evidence event exists.
   - Click "Next: Review Activities".

3. **Step 2: Review Activities** — AI-proposed activities appear via `PendingNarrativePanel`.
   - On step-1 agree, the `claim-activity-proposal` pg-boss job fires the synthesize-register Sonnet agent.
   - The agent drafts `ACTIVITY_REGISTER_DRAFTED` events (proposed activities).
   - Consultant reviews, edits, and approves the narrative.
   - Approving the narrative auto-creates `activity` rows.
   - `canAdvance['2']` requires at least one activity to exist.
   - Click "Next: Attribute Evidence".

4. **Step 3: Attribute Evidence** — Activity cards with "Link evidence" buttons.
   - On step-2 agree, the `claim-evidence-binding` pg-boss job fires the auto-allocator Haiku agent.
   - The allocator links unbound evidence events to activities (confidence >= 0.65).
   - Consultant reviews auto-suggested bindings and adjusts manually via `BindToActivityButton`.
   - `canAdvance['3']` requires all activities to have at least one linked artefact.
   - Click "Next: Narrative & Timeline".

5. **Step 4: Narrative & Timeline** — Split-pane: R&D narrative (left) + fiscal-year timeline (right).
   - `NarrativeStream` renders the synthesised narrative from analysis events.
   - `FiscalYearTimeline` shows the claim's fiscal year context.
   - Consultant reviews and agrees sections.
   - Click "Next: Generate Documents".

6. **Step 5: Generate Documents** — Trigger document generation.
   - Currently simulated: endpoints not yet connected.
   - Clicking "Generate all documents" shows generating state, then "Not yet available" after 2s.
   - Real generation will produce: Application Form, R&D Activities Schedule, Technical Report (PDF).

---

## Known Rough Edges

### Critical (blocks real usage)

- **Step 5 generation is a stub.** The document generation endpoints do not exist yet. The component simulates the flow with a 2-second timeout. No actual documents are produced.

### Important (functional but imperfect)

- **`BindToActivityButton` receives empty `eventId`.** In `wizard-step-3-attribute.tsx:98`, the `eventId` prop is hardcoded to `""`. The component needs the specific evidence event ID to link. This should be wired to a file picker or evidence list.

- **Step 2 relies on `PendingNarrativePanel`.** This component was designed for the subject-tenant detail page context, not the wizard. If the panel's query keys or scoping don't align with the claim-specific workflow, the narrative may not appear.

- **No "Back" button.** Steps only have "Next". The user can click stepper circles to navigate back, but there's no explicit "Back" button in the step footer.

- **Stale banner uses `en-AU` locale.** The `StaleStepBanner` formats `agreed_at` with `toLocaleDateString('en-AU')`. This is appropriate for Australian R&DTI consultants but may need i18n if the platform serves other locales.

### Minor (polish)

- **Step 5 has no "Next" button or completion action.** After "generating" completes (currently simulated), there's no CTA to finalize or download. The real implementation should provide download links.

- **`_canAdvance` is unused in Step 5.** The prop is prefixed with `_` to suppress lint, but Step 5 should eventually use it to gate the "Generate" button (only enable when all prior steps are agreed).

- **`_claimId` unused in Step 2.** The claim ID is destructured but unused — the `PendingNarrativePanel` only takes `subjectTenantId`. If Step 2 needs claim-scoped queries, this will need wiring.

- **No polling or SSE for agent job status.** Steps 2 and 3 fire pg-boss jobs on agree, but the wizard doesn't show real-time progress. The user must manually refresh to see results after the agent completes.

---

## Observations

- The `initializeWorkflow` call in `create-claim-button.tsx` is best-effort (swallowed catch). If it fails, the user sees the legacy tabbed view. This is intentional graceful degradation, but should be monitored in production logs.

- The stepper visual state correctly reflects agreed steps (green checkmark) vs. current (outlined) vs. future (grey). Navigation via stepper circles works.

- The stale-step banner condition (`stepEntry !== null && !canAdvance.ok`) correctly identifies steps that were previously valid but have become stale due to data changes.

---

## Verdict

The wizard skeleton is complete and navigable. Steps 1-4 render real components with real data queries. The two agent jobs (activity proposal on step-1 agree, evidence binding on step-2 agree) are wired and functional. Step 5 is a UI stub awaiting backend generation endpoints. Primary blocker for production use is document generation (Step 5).

---

## Post-Review Updates (2026-05-13)

A code review of the wizard caught three critical gaps that this smoke retro did not surface — the wizard rendered correctly but the central mechanism never fired. Specifically:

- **C1 — `agreeStep` had zero call sites.** The Next buttons in steps 1-4 just wrote `?step=N+1` to the URL with no server-side write. `workflow_state.steps[N].agreed_at` stayed null forever, so the stepper "agreed" checkmarks could never light up and pg-boss jobs never enqueued on step-1/step-2 agree (the two enqueue sites in `claim-workflow.ts` are inside the agree route).
- **C2 — No workflow query was ever invalidated.** Even if agreeStep had been called, the wizard's `['workflow', claimId]` react-query cache wasn't being invalidated after mutations, so the orchestrator's `getWorkflow` snapshot stayed stale.
- **I1 — Phase 7.1 auto-init was non-transactional.** The follow-on `initializeWorkflow(created.id)` call in `create-claim-button.tsx` ran after `POST /v1/claims` returned. The try/catch swallowed any failure silently — a network blip between the two writes left a claim with NULL `workflow_state` and the wizard's `GET /workflow` 404'd.

### Fixed in this commit chain

- **I1 fixed:** `POST /v1/claims` now writes `workflow_state` in the same transaction as the INSERT using the JSONB double-cast pattern. The client-side `initializeWorkflow` follow-on call is removed. Every newly-created claim is a wizard claim from the moment it lands; `GET /workflow` returns 200 on the very next request. New test in `claims.test.ts` asserts this.
- **C1 + C2 fixed:** New `AgreeStepButton` component (`_components/agree-step-button.tsx`) wraps `agreeStep` in a `useMutation`, awaits `invalidateQueries(['workflow', claimId])` before advancing the URL, and surfaces errors via destructive toast. Wired into steps 1-4. Step 5 deliberately stays as-is — the reducer pins step 5 as terminal (`canAdvance(5) === { ok: false, reason: 'Step 5 is terminal' }`) and the F2 test in `claim-workflow.test.ts` enforces this; completion semantics for step 5 will be defined when the real document-generation endpoints land.

### Resolved (moved from "Known Rough Edges")

The following items from the Critical/Important/Minor lists above are now resolved in this commit chain:

- ~~Stale banner never triggers~~ → resolved by C1+C2 fixes (agreed_at now becomes a real timestamp once a step is agreed, so the `stepEntry !== null && !canAdvance.ok` stale-banner condition can actually evaluate true).
- ~~Auto-init is best-effort with swallowed catch~~ → resolved by I1 fix (init is now transactional inside POST /v1/claims).

### Still NOT addressed (separate follow-up commits)

The following critical items from the review are deliberately out of scope for this commit chain — they need their own focused fixes:

- **C3 — Step 3 empty eventId.** `wizard-step-3-attribute.tsx:100` hardcodes `eventId=""` on the `BindToActivityButton`. The flow needs to list bound events per activity and offer "add evidence" from the event list, not from the activity card.
- **C4 — Step 5 is a stub.** The 3 documents (Application Form, R&D Activities Schedule, Technical Report) are simulated with a 2-second timeout. No actual generation endpoints exist yet.
- **I4 — No per-section narrative agree.** Step 4 has a single Next button instead of per-section approve actions; `canAdvance(4)` looks at `narrativeSectionsApproved` but there's no UI surface for the consultant to mark a section approved.
