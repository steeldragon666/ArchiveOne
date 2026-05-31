'use client';

/**
 * Claim review wizard — the consultant's per-step APPROVAL surface.
 *
 * Per docs/product/workflow.md (LOCKED): the claimant captures evidence and
 * triggers "Prepare claim"; the AI prepares the claim; the consultant
 * renders judgement by approving it step-by-step. The consultant approves,
 * they do not author.
 *
 * IA position: Clients → Client → CLAIMS list → **Claim** (this view).
 *
 * Gating model (the real wiring):
 *   - GET /v1/claims/:id/workflow returns { workflow_state, derived } where
 *     `derived.canAdvance['N']` is computed LIVE from claim data per step,
 *     and `workflow_state.steps['N']` records who approved step N and when.
 *   - A step's Approve action is enabled iff its canAdvance gate is ok.
 *   - Step N+1 unlocks only once step N is approved (steps['N'] !== null).
 *     NO "approve all" — judgement is per-step by design.
 *   - The engagement letter gates the entire wizard: until the client's
 *     engagement is signed + countersigned, every step renders locked
 *     behind the ENGAGEMENT REQUIRED overlay (Wizard Step 1's backing
 *     feature, already wired via <EngagementPanel> + isEngagementUnblocked).
 *
 * Step model — the 6 spec steps map onto the backend's 5 agree-able
 * workflow steps + the terminal Review:
 *
 *   Spec step (UI)        backend canAdvance gate (claim-workflow.ts)
 *   ───────────────────   ─────────────────────────────────────────────
 *   1 Hypotheses          step 1 — ≥1 classified evidence event
 *   2 Activities          step 2 — every proposed activity agreed/rejected
 *   3 Apportionment       step 3 — every agreed activity has bound evidence
 *   4 Evidence            step 4 — narrative sections approved (*)
 *   5 Narrative           step 5 — terminal (no further advance)
 *   6 Review              all five steps approved → seal → finance
 *
 *   (*) The backend's 5-step machine predates the 6-label product spec, so
 *   gates 4/5 don't line up 1:1 with the Evidence/Narrative labels. The
 *   gating is still REAL — it reads canAdvance/steps from the API — but the
 *   underlying advance condition for a given label is whatever the backend
 *   computes. See the README note in the PR; a backend re-label to 6 steps
 *   would tighten this.
 *
 * Prepared content (the REAL AI-authored artefact per step) now comes from
 * GET /v1/claims/:id/prepared (via useClaimPrepared). Each step renders the
 * actual hypotheses / activities / apportionment / evidence / narrative the
 * pipeline produced. We never fabricate: where a step's `prepared` flag is
 * false, the step renders an honest "still preparing" state with the live
 * canAdvance reason — not invented content.
 */

import { useMemo, useState } from 'react';
import type { Claim } from '@cpa/schemas';
import { amber, bone, bone2, bone3, fMono, fSans, fSerif, ink2, ruleStrong } from './tokens';
import { Diamond, MonoLabel, StatusPill } from './atoms';
import { EngagementPanel, isEngagementUnblocked } from './engagement-panel';
import { useClaimEngagement } from '@/lib/hooks/use-claim-engagement';
import {
  useClaimWorkflow,
  useFinanceClaim,
  useInitializeWorkflow,
  useSealClaim,
} from '@/lib/hooks/use-claim-workflow';
import { useClaimPrepared } from '@/lib/hooks/use-claim-prepared';
import type { FinanceResult, SealResult, WorkflowStepKey } from './claims-api';
import {
  LIFECYCLE_PILL,
  REVIEW_ORDINAL,
  STEP_DEFS,
  type ClaimLifecycle,
} from './claim-review/types';
import { CenteredNote, ErrorText } from './claim-review/primitives';
import { fyLabel, primaryBtn } from './claim-review/utils';
import { ReviewStep, StepRail, WizardStep } from './claim-review/step-rail';

interface ClaimReviewViewProps {
  claim: Claim;
  clientName: string;
  /** Back to this client's claims list. */
  onBack: () => void;
}

export function ClaimReviewView({ claim, clientName, onBack }: ClaimReviewViewProps) {
  const claimId = claim.id;
  const fy = fyLabel(claim.fiscal_year);

  // Engagement gate — until signed/countersigned the whole wizard is locked.
  const { data: engagement } = useClaimEngagement(claimId);
  const downstreamUnlocked = isEngagementUnblocked(engagement?.status);

  // Per-step state machine + live canAdvance gates.
  const { data: workflow, isLoading, error, notInitialized } = useClaimWorkflow(claimId);
  const initialize = useInitializeWorkflow(claimId);

  // The REAL AI-prepared content the consultant judges, per step.
  const { data: prepared, isLoading: preparedLoading } = useClaimPrepared(
    notInitialized ? null : claimId,
  );

  const approvedKeys = useMemo(() => {
    const set = new Set<WorkflowStepKey>();
    if (workflow) {
      (['1', '2', '3', '4', '5'] as WorkflowStepKey[]).forEach((k) => {
        if (workflow.workflow_state.steps[k]) set.add(k);
      });
    }
    return set;
  }, [workflow]);

  const allApproved = approvedKeys.size === STEP_DEFS.length;

  // ── Finalize actions (seal → finance). The hooks bubble 404
  // (NotFoundError) so we render an honest "not available yet" state instead
  // of crashing if the endpoints aren't deployed.
  const seal = useSealClaim(claimId);
  const finance = useFinanceClaim(claimId);
  // Live POST results captured this session.
  const [sealLive, setSealLive] = useState<SealResult | null>(null);
  const [financeLive, setFinanceLive] = useState<FinanceResult | null>(null);

  // The seal/finance markers are persisted on workflow_state (claim-finalize
  // writes sealed_at / seal_block_id / financing), so the lifecycle READS
  // BACK across sessions — a reopened sealed claim renders sealed without a
  // fresh POST. Prefer the persisted marker; fall back to this session's
  // live POST result.
  const persisted = workflow?.workflow_state;
  const sealResult: SealResult | null =
    sealLive ??
    (persisted?.sealed_at
      ? { ok: true, sealed_at: persisted.sealed_at, block_id: persisted.seal_block_id ?? '' }
      : null);
  const financeResult: FinanceResult | null =
    financeLive ?? (persisted?.financing ? { ok: true, financing: persisted.financing } : null);

  const sealed = sealResult !== null;
  const financed = financeResult !== null;

  const lifecycle: ClaimLifecycle = financed
    ? 'financing'
    : sealed
      ? 'sealed'
      : allApproved
        ? 'approved'
        : 'drafting';

  // Once sealed, the claim is immutable — the per-step wizard goes
  // read-only (approvals + reopen are locked).
  const wizardReadOnly = sealed;

  const onSeal = () => seal.mutate(undefined, { onSuccess: (res) => setSealLive(res) });
  const onFinance = () => finance.mutate(undefined, { onSuccess: (res) => setFinanceLive(res) });

  // The active step the consultant is reviewing. Until they manually pick a
  // step (selectedOrdinal), we derive it: the lowest not-yet-approved step,
  // or the terminal Review step once all five are approved. This keeps the
  // wizard auto-advancing as approvals land without an effect/state sync.
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(null);
  const derivedOrdinal = (() => {
    const firstUnapproved = STEP_DEFS.find((s) => !approvedKeys.has(s.key));
    return firstUnapproved ? firstUnapproved.ordinal : REVIEW_ORDINAL;
  })();
  const activeOrdinal = selectedOrdinal ?? derivedOrdinal;
  const setActiveOrdinal = setSelectedOrdinal;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 28 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 22,
        }}
      >
        <div>
          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: fMono,
              fontSize: 10,
              letterSpacing: '0.16em',
              color: bone3,
              marginBottom: 12,
            }}
          >
            ← {clientName.toUpperCase()} · CLAIMS
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <MonoLabel size={10} color={amber}>
              {fy}
            </MonoLabel>
            <span style={{ width: 24, height: 1, background: ruleStrong }} />
            <MonoLabel size={10} color={bone3}>
              {clientName.toUpperCase()}
            </MonoLabel>
            <StatusPill kind={LIFECYCLE_PILL[lifecycle]} />
          </div>
          <h1
            style={{
              fontFamily: fSerif,
              fontWeight: 300,
              fontSize: 34,
              lineHeight: 1,
              letterSpacing: '-0.025em',
              color: bone,
              margin: '14px 0 0',
            }}
          >
            {clientName} — {fy} R&amp;DTI claim
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {sealed && sealResult && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Diamond size={7} color={amber} />
              <MonoLabel size={9.5} color={amber}>
                SEALED · {sealResult.block_id.slice(0, 10)}
              </MonoLabel>
            </span>
          )}
        </div>
      </div>

      {/* Step 1 backing feature — Engagement Letter panel. */}
      <EngagementPanel claimId={claimId} claimantName={clientName} fiscalYearLabel={fy} />

      {/* Step rail (6 spec steps: 5 approve-able + terminal Review). */}
      <StepRail
        activeOrdinal={activeOrdinal}
        approvedKeys={approvedKeys}
        allApproved={allApproved}
        onSelect={setActiveOrdinal}
      />

      {/* Workflow body, gated behind the engagement overlay. */}
      <div style={{ position: 'relative' }}>
        <div
          style={{
            opacity: downstreamUnlocked ? 1 : 0.35,
            pointerEvents: downstreamUnlocked ? 'auto' : 'none',
            filter: downstreamUnlocked ? 'none' : 'grayscale(0.4)',
            transition: 'opacity 120ms ease, filter 120ms ease',
          }}
          aria-hidden={!downstreamUnlocked}
        >
          {isLoading && <CenteredNote>Loading the prepared claim…</CenteredNote>}

          {!isLoading && notInitialized && (
            <NotInitializedPanel
              pending={initialize.isPending}
              error={initialize.error}
              onPrepare={() => initialize.mutate()}
            />
          )}

          {!isLoading && error && !notInitialized && (
            <CenteredNote tone="error">
              Couldn&rsquo;t load the claim workflow. {error.message}
            </CenteredNote>
          )}

          {!isLoading && workflow && (
            <>
              {activeOrdinal <= STEP_DEFS.length ? (
                <WizardStep
                  claimId={claimId}
                  def={STEP_DEFS[activeOrdinal - 1]!}
                  approvedKeys={approvedKeys}
                  canAdvance={workflow.derived.canAdvance[STEP_DEFS[activeOrdinal - 1]!.key]}
                  agreedAt={
                    workflow.workflow_state.steps[STEP_DEFS[activeOrdinal - 1]!.key]?.agreed_at ??
                    null
                  }
                  prepared={prepared}
                  preparedLoading={preparedLoading}
                  readOnly={wizardReadOnly}
                  // Drop the manual pin on approve so the wizard auto-advances
                  // to the next unapproved step (derivedOrdinal takes over).
                  onApproved={() => setSelectedOrdinal(null)}
                />
              ) : (
                <ReviewStep
                  allApproved={allApproved}
                  approvedCount={approvedKeys.size}
                  lifecycle={lifecycle}
                  review={prepared?.step6_review ?? null}
                  sealResult={sealResult}
                  financeResult={financeResult}
                  seal={{
                    onSeal,
                    pending: seal.isPending,
                    error: seal.error,
                  }}
                  finance={{
                    onFinance,
                    pending: finance.isPending,
                    error: finance.error,
                  }}
                />
              )}
            </>
          )}
        </div>
        {!downstreamUnlocked && <EngagementRequiredOverlay />}
      </div>
    </div>
  );
}

function NotInitializedPanel({
  pending,
  error,
  onPrepare,
}: {
  pending: boolean;
  error: Error | null;
  onPrepare: () => void;
}) {
  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
        padding: '24px',
      }}
    >
      <MonoLabel size={10} color={amber}>
        CLAIM NOT YET PREPARED
      </MonoLabel>
      <div
        style={{
          marginTop: 10,
          fontFamily: fSans,
          fontSize: 14,
          color: bone2,
          lineHeight: 1.5,
          maxWidth: 540,
        }}
      >
        This claim has no workflow yet. Trigger &ldquo;Prepare claim&rdquo; to start the AI
        preparation pipeline — it will classify evidence, draft activities, apportion the ledger and
        draft the narrative for your per-step approval.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <button type="button" onClick={onPrepare} disabled={pending} style={primaryBtn(pending)}>
          {pending ? 'PREPARING…' : 'PREPARE CLAIM'}
        </button>
        {error && <ErrorText>{error.message}</ErrorText>}
      </div>
    </div>
  );
}

function EngagementRequiredOverlay() {
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          padding: '14px 22px',
          background: ink2,
          border: `1px solid ${ruleStrong}`,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
          pointerEvents: 'auto',
        }}
      >
        <Diamond size={7} />
        <div>
          <MonoLabel size={10} color={amber} tracking="0.18em">
            ENGAGEMENT REQUIRED
          </MonoLabel>
          <div style={{ marginTop: 4, fontFamily: fSans, fontSize: 12.5, color: bone3 }}>
            Send and countersign the engagement letter to unlock the per-step approval wizard.
          </div>
        </div>
      </div>
    </div>
  );
}
