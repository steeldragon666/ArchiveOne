# Consultant Workspace Wiring — Reconciliation & Recovery Plan

**Date:** 2026-05-28
**Status:** Investigation complete — awaiting approval before building resumes
**Trigger:** "none of the features you built to wire up the interface work at all"

## Executive summary

Of the **13 original wiring tasks** (D1-D5, W1-W5, V1, X1-X4), **only 3 shipped** (D2, D3, D4). Nine never landed in source; one (B0, drop banner) shipped **prematurely**. The live consultant workspace therefore shows a mix of hardcoded fiction (claims table, "Anna Pemberton", wizard ledger/rollups/evidence) and empty real panels (KPI/watch/chain) with **no banner** indicating it's a demo.

Two compounding root causes:
1. **The wiring swarm stalled silently.** Most dispatched agents died at the worktree/commit step (worktrees stuck at `6da7fa5`, zero commits). They were reported "running" and never reconciled against merged PRs.
2. **Banner dropped early.** PR #116 removed the "fictional data" banner claiming "workspace is now functionally wired" — but B0's own spec required all wiring to land first.

Deploy layer is also stale: VPS runs `40dfb28`, main is `888e309`.

## Verified status of every task

Evidence = grep of `apps/web/src/app/consultant/_components/` + `apps/api/src/routes/consultant/` + `apps/web/src/lib/hooks/` on `main` (commit 888e309).

| Task | Surface | Status | Evidence |
|------|---------|--------|----------|
| **D1** Claims feed | dashboard ClaimsPanel | ❌ **NOT shipped** | `const CLAIMS = [Vantage…]` line 317; no `useConsultantClaims` hook; no `claims.ts` route. (Orphan `dist/consultant-claims.js` from a lost agent build.) |
| **D2** Watch panel | dashboard WatchPanel | ✅ shipped (#79) | `useConsultantSignals` line 521 |
| **D3** Chain panel | dashboard ChainPanel | ✅ shipped (#80) | `useConsultantRecentChainBlocks` line 658 — returns empty (no `audit_chain_block` table) |
| **D4** KPI strip | dashboard KPIs | ✅ shipped (#81) | `useConsultantKpis` line 260 — computes 0 with no claim data |
| **D5** Header + greeting | dashboard header / page.tsx | ❌ **NOT shipped** | `DEMO_USER = { name: 'Anna Pemberton' }` page.tsx line 32; buttons have no handlers |
| **W1** Claim route + hook | wizard identity | ❌ **NOT shipped** | wizard uses `DEMO_CLAIM_ID`; no `useConsultantClaim`; no `/v1/consultant/claims/:id` |
| **W2** Ledger | wizard ledger | ❌ **NOT shipped** | `const LEDGER` line 313; no `useClaimLedger`; no ledger endpoint |
| **W3** Rollups | wizard rollups | ❌ **NOT shipped** | `const ROLLUPS` line 366 |
| **W4** Evidence stream | wizard evidence | ❌ **NOT shipped** | `const EVIDENCE` line 541; no `useClaimEvidence`; no evidence endpoint |
| **W5** Step actions | wizard advance/hold/seal | ❌ **NOT shipped** | no action bar, no `/advance`/`/hold`/`/seal` endpoints |
| **V1** Full watch page | watch-view.tsx | ❌ **NOT shipped** | `watch-view.tsx` has 0 hooks, `const SIGNALS` fixtures |
| **X1** User chip + sign-out | topbar.tsx | ❌ **NOT shipped** | `topbar.tsx` 0 hooks; `user` prop fed by DEMO_USER |
| **X2** Topbar search | topbar.tsx | ⏸️ deferred by design | (was always parking-lot) |
| **X3** LIVE clock | topbar.tsx | ❓ **unverified** | needs a direct look at the clock tick + connectivity dot |
| **X4** Chain footer | sidebar.tsx | ❌ **NOT shipped** | `sidebar.tsx` 0 hooks |
| **B0** Drop banner | layout | ⚠️ **shipped EARLY** (#116) | banner gone while D1/D5/W1-W5/V1/X1-X4 incomplete |

### Net: 3 shipped (D2/D3/D4), 9 missing (D1, D5, W1-W5, V1, X1, X4), 1 deferred (X2), 1 unverified (X3), 1 premature (B0).

## Features that DID ship (not part of original wiring — don't redo these)

These are the *new* features built later in the session and are genuinely wired:
- **Engagement letter** (wizard Step 1): API #102, UI #104, panel uses `useClaimEngagement`/`useSendEngagement`/`useCountersignEngagement` ✅
- **IP search** (wizard Step 2): API+UI #110, PDF #108, uses `useClaimVerdicts` ✅
- **Onboarding flow** (agency→client→evidence/accounting): #123 ✅
- **Founder notification + magic-link login**: #121, #122 ✅ (auth, not workspace)

## What each missing task needs (dependency-ordered)

### Foundation (unblocks the rest)
- **D5/X1 — real user identity.** New `useWhoami` hook → `GET /v1/auth/whoami` (verify it exists; signup/session likely already expose it). Drop `DEMO_USER`; feed TopBar from the session. **This is the single highest-visibility fix** — kills "Anna Pemberton".

### Dashboard
- **D1 — claims feed.** `GET /v1/consultant/claims?fy=&status=` (RLS-scoped) + `useConsultantClaims` + wire ClaimsPanel (delete `const CLAIMS`). Needs a stage-label helper. **Second highest-visibility** — kills the Vantage/Borealis fiction.

### Wizard (W1 unblocks W2-W5)
- **W1 — claim route + `useConsultantClaim`.** Real `/consultant/claim/[id]/wizard` route; `GET /v1/consultant/claims/:id`. Replaces `DEMO_CLAIM_ID`.
- **W2 — ledger.** `GET/POST/PATCH /v1/consultant/claims/:id/ledger` + `useClaimLedger`.
- **W3 — rollups.** Piggyback on W2's ledger response (`rollups` field).
- **W4 — evidence stream.** `GET /v1/consultant/claims/:id/evidence` + `useClaimEvidence`.
- **W5 — step actions.** `POST …/advance|hold|seal` + mutations + confirmation modal.

### Chrome
- **X3 — LIVE clock.** Verify/fix the second-tick + connectivity dot. (Smallest task; verify first.)
- **X4 — sidebar chain footer.** `GET /v1/consultant/chain/status` + `useConsultantChainStatus`.
- **V1 — full watch page.** Reuse `useConsultantSignals` with wider window + detail.

### Last
- **B0 (re-decide).** Either restore the banner until everything lands, OR keep it off and accept the gap closes incrementally.

## Recommended recovery sequence

1. **Restore the banner** (tiny PR) — stop the live site presenting fiction as real. *Or* the user may prefer to leave it off and race the wiring.
2. **D5/X1 user identity** — highest visibility, smallest real-data dependency.
3. **D1 claims feed** — second highest visibility.
4. **W1 → W2/W3 → W4 → W5** — wizard spine, in dependency order.
5. **X3, X4, V1** — chrome polish.
6. **Re-drop banner** once 2-5 are verified live.

## Process change (so this doesn't recur)

- **No fire-and-forget swarms for must-ship work.** Build in small batches; after each, run `gh pr list --state merged` and diff against the dispatched set. A task isn't "done" until its PR is merged AND the component is re-grepped to confirm the hook replaced the const.
- **Verify live, not just merged.** After deploy, `curl` the endpoint + load the page before claiming a panel works.

## Deploy note

Independent of the wiring: the VPS is on `40dfb28` and needs a redeploy to even pick up D2/D3/D4 + the engagement/IP-search/onboarding features already on main. Empty panels there are partly because the seed tenant ("ArchiveOne Demo") has no claims/signals data — wiring D1 won't make rows appear; it'll show a correct empty state until real claims exist.
