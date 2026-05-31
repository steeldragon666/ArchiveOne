import {
  amber,
  amberSoft,
  bone,
  bone2,
  bone3,
  bone4,
  fMono,
  fSans,
  fSerif,
  ink2,
  ink3,
  rule,
  ruleStrong,
  sage,
} from '../tokens';
import { Check, Diamond, MonoLabel } from '../atoms';
import { ConflictError } from '@/lib/api';
import { useAgreeStep, useReopenStep } from '@/lib/hooks/use-claim-workflow';
import type { PreparedContent, SealResult, FinanceResult, WorkflowStepKey } from '../claims-api';
import {
  REVIEW_ORDINAL,
  STEP_DEFS,
  type ClaimLifecycle,
  type FinalizeAction,
  type StepDef,
} from './types';
import { ErrorText } from './primitives';
import { formatTs, ghostBtn, primaryBtn } from './utils';
import { PreparedStepContent, ReviewRollup, AwaitingPanel } from './prepared-panels';
import {
  FinalizeRow,
  FinalizeButton,
  SealedState,
  FinancingState,
  conflictReasonFor,
} from './finalize';

/* ───────────────────────────── Step rail ───────────────────────────── */

export function StepRail({
  activeOrdinal,
  approvedKeys,
  allApproved,
  onSelect,
}: {
  activeOrdinal: number;
  approvedKeys: Set<WorkflowStepKey>;
  allApproved: boolean;
  onSelect: (ordinal: number) => void;
}) {
  // A step is reachable if it's step 1, OR the previous step is approved.
  const isUnlocked = (ordinal: number): boolean => {
    if (ordinal === 1) return true;
    const prev = STEP_DEFS[ordinal - 2];
    if (!prev) return allApproved; // Review (ordinal 6) unlocks when all approved
    return approvedKeys.has(prev.key);
  };

  const labels: { ordinal: number; label: string; key?: WorkflowStepKey }[] = [
    ...STEP_DEFS.map((s) => ({ ordinal: s.ordinal, label: s.label, key: s.key })),
    { ordinal: REVIEW_ORDINAL, label: 'REVIEW' },
  ];

  const approvedCount = approvedKeys.size;

  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
        padding: '18px 22px',
        marginBottom: 18,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <MonoLabel size={10} color={bone3}>
          WIZARD · STEP {String(activeOrdinal).padStart(2, '0')} / 06
        </MonoLabel>
        <MonoLabel size={10} color={bone3}>
          {approvedCount} OF 5 STEPS APPROVED
        </MonoLabel>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {labels.map((l) => {
          const approved = l.key ? approvedKeys.has(l.key) : allApproved;
          const active = l.ordinal === activeOrdinal;
          return (
            <div
              key={l.ordinal}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: approved ? amber : active ? amberSoft : rule,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          marginTop: 12,
          gap: 12,
        }}
      >
        {labels.map((l) => {
          const approved = l.key ? approvedKeys.has(l.key) : allApproved;
          const active = l.ordinal === activeOrdinal;
          const unlocked = isUnlocked(l.ordinal);
          return (
            <button
              key={l.ordinal}
              type="button"
              disabled={!unlocked}
              onClick={() => unlocked && onSelect(l.ordinal)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: unlocked ? 'pointer' : 'not-allowed',
                padding: 0,
                textAlign: 'left',
                opacity: unlocked ? 1 : 0.45,
              }}
            >
              <div
                style={{
                  fontFamily: fMono,
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: active ? amber : approved ? bone2 : bone4,
                }}
              >
                {approved && <Check size={11} color={amber} />}
                {String(l.ordinal).padStart(2, '0')} · {l.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── Wizard step ─────────────────────────── */

export function WizardStep({
  claimId,
  def,
  approvedKeys,
  canAdvance,
  agreedAt,
  prepared,
  preparedLoading,
  readOnly,
  onApproved,
}: {
  claimId: string;
  def: StepDef;
  approvedKeys: Set<WorkflowStepKey>;
  canAdvance: { ok: true } | { ok: false; reason: string };
  agreedAt: string | null;
  /** The AI-prepared content for ALL steps (undefined while loading). */
  prepared: PreparedContent | undefined;
  preparedLoading: boolean;
  /** Sealed claims are immutable — approvals + reopen are locked. */
  readOnly: boolean;
  onApproved: () => void;
}) {
  const agree = useAgreeStep(claimId);
  const reopen = useReopenStep(claimId);

  // This step is reachable only if the prior step is approved (or it's
  // step 1). The rail already gates selection, but we belt-and-suspender it.
  const priorApproved = def.ordinal === 1 || approvedKeys.has(STEP_DEFS[def.ordinal - 2]!.key);

  const approved = agreedAt !== null;
  const conflictReason = agree.error instanceof ConflictError ? agree.error.message : null;

  return (
    <div style={{ background: ink2, border: `1px solid ${ruleStrong}`, borderRadius: 4 }}>
      <div style={{ padding: '18px 22px', borderBottom: `1px solid ${rule}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <MonoLabel size={11}>
            STEP {String(def.ordinal).padStart(2, '0')} · {def.label}
          </MonoLabel>
          {approved && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={13} color={sage} />
              <MonoLabel size={9.5} color={sage}>
                APPROVED
              </MonoLabel>
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: fSerif,
            fontWeight: 400,
            fontSize: 24,
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            color: bone,
            margin: '10px 0 0',
          }}
        >
          {def.question}
        </div>
        <div style={{ fontFamily: fSans, fontSize: 13.5, color: bone3, marginTop: 8 }}>
          {def.prepares}
        </div>
      </div>

      {/* Prepared-content surface.
          The AI-prepared artefact for each step comes from
          GET /v1/claims/:id/prepared (produced by the claim-activity-proposal,
          claim-evidence-binding, IP-search and narrative-drafter pipeline
          jobs). We render the REAL content here. When a step's `prepared`
          flag is false we show an honest "still preparing" state carrying the
          live canAdvance reason — never fabricated content. */}
      <div style={{ padding: '20px 22px' }}>
        {!priorApproved ? (
          <Locked reason={`Approve step ${def.ordinal - 1} first to unlock this step.`} />
        ) : (
          <PreparedStepContent
            ordinal={def.ordinal}
            label={def.label}
            prepared={prepared}
            preparedLoading={preparedLoading}
            canAdvance={canAdvance}
            approved={approved}
          />
        )}
      </div>

      {/* Footer — the per-step Approve action. */}
      <div
        style={{
          padding: '16px 22px',
          borderTop: `1px solid ${ruleStrong}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ fontFamily: fMono, fontSize: 10, color: bone4, letterSpacing: '0.08em' }}>
          {readOnly
            ? `SEALED — READ ONLY${agreedAt ? ` · APPROVED ${formatTs(agreedAt)}` : ''}`
            : approved && agreedAt
              ? `APPROVED ${formatTs(agreedAt)}`
              : 'CONSULTANT JUDGEMENT REQUIRED — APPROVE TO UNLOCK THE NEXT STEP'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {conflictReason && <ErrorText>{conflictReason}</ErrorText>}
          {agree.error && !conflictReason && <ErrorText>Approve failed. Try again.</ErrorText>}
          {readOnly ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Diamond size={6} color={amber} />
              <MonoLabel size={9.5} color={amber}>
                LOCKED ON CHAIN
              </MonoLabel>
            </span>
          ) : approved ? (
            <button
              type="button"
              onClick={() => reopen.mutate(def.key)}
              disabled={reopen.isPending}
              style={ghostBtn(reopen.isPending)}
            >
              {reopen.isPending ? 'REOPENING…' : 'REOPEN'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => agree.mutate(def.key, { onSuccess: onApproved })}
              disabled={!priorApproved || !canAdvance.ok || agree.isPending}
              style={primaryBtn(!priorApproved || !canAdvance.ok || agree.isPending)}
            >
              {agree.isPending ? 'APPROVING…' : `APPROVE ${def.label}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Review step ─────────────────────────── */

export function ReviewStep({
  allApproved,
  approvedCount,
  lifecycle,
  review,
  sealResult,
  financeResult,
  seal,
  finance,
}: {
  allApproved: boolean;
  approvedCount: number;
  lifecycle: ClaimLifecycle;
  review: PreparedContent['step6_review'] | null;
  sealResult: SealResult | null;
  financeResult: FinanceResult | null;
  seal: FinalizeAction & { onSeal: () => void };
  finance: FinalizeAction & { onFinance: () => void };
}) {
  const sealed = lifecycle === 'sealed' || lifecycle === 'financing';
  const financed = lifecycle === 'financing';

  return (
    <div style={{ background: ink2, border: `1px solid ${ruleStrong}`, borderRadius: 4 }}>
      <div style={{ padding: '18px 22px', borderBottom: `1px solid ${rule}` }}>
        <MonoLabel size={11}>STEP 06 · REVIEW</MonoLabel>
        <div
          style={{
            fontFamily: fSerif,
            fontWeight: 400,
            fontSize: 24,
            color: bone,
            margin: '10px 0 0',
          }}
        >
          Anything to flag before sign-off?
        </div>
        <div style={{ fontFamily: fSans, fontSize: 13.5, color: bone3, marginTop: 8 }}>
          Final check. Once every step is approved the claim is sealed onto the evidence chain, then
          its refund is submitted to financing.
        </div>
      </div>

      <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Roll-up of what the AI prepared across the five judged steps. */}
        {review && <ReviewRollup review={review} />}

        {!allApproved && (
          <AwaitingPanel
            reason={`${approvedCount} of 5 steps approved — approve the remaining ${5 - approvedCount} to unlock sealing.`}
          />
        )}

        {/* Terminal action 1 — SEAL. */}
        <FinalizeRow
          ordinal="A"
          title="Seal onto the evidence chain"
          body="Writes an immutable, audit-ready block. Available once all steps are approved."
        >
          {sealed && sealResult ? (
            <SealedState result={sealResult} />
          ) : (
            <FinalizeButton
              label="SEAL CLAIM"
              pendingLabel="SEALING…"
              enabled={allApproved}
              disabledHint="Approve all steps first"
              pending={seal.pending}
              error={seal.error}
              conflictReason={conflictReasonFor(seal.error, 'not_approved')}
              onClick={seal.onSeal}
            />
          )}
        </FinalizeRow>

        {/* Terminal action 2 — FINANCE. */}
        <FinalizeRow
          ordinal="B"
          title="Finance the refund"
          body="Submits the sealed claim to the financing rail. Available once the claim is sealed."
        >
          {financed && financeResult ? (
            <FinancingState result={financeResult} />
          ) : (
            <FinalizeButton
              label="FINANCE THE REFUND"
              pendingLabel="SUBMITTING…"
              enabled={sealed}
              disabledHint="Seal the claim first"
              pending={finance.pending}
              error={finance.error}
              conflictReason={conflictReasonFor(finance.error, 'not_sealed')}
              onClick={finance.onFinance}
            />
          )}
        </FinalizeRow>
      </div>
    </div>
  );
}

export function Locked({ reason }: { reason: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: ink3,
        border: `1px solid ${rule}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Diamond size={6} filled={false} color={bone4} />
      <div style={{ fontFamily: fSans, fontSize: 13, color: bone3 }}>{reason}</div>
    </div>
  );
}
