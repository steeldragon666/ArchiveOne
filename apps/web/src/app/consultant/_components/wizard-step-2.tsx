'use client';
/**
 * Wizard Step 2 panel — IP search across hypotheses.
 *
 * Renders one {@link HypothesisCard} per hypothesis. The list of
 * hypotheses comes from the consultant (passed in via prop) — the page
 * route is responsible for assembling them, typically from the
 * activities under the claim.
 *
 * The verdict list endpoint feeds back "already-approved / already-
 * drafted" state so a re-visit of the wizard doesn't make consultants
 * re-do work that's already saved.
 */
import { useClaimVerdicts } from '@/lib/hooks/use-ip-search';
import { HypothesisCard } from './hypothesis-card';
import { amber, bone, bone3, fMono, fSerif } from './tokens';

export interface WizardStep2Hypothesis {
  activityId: string;
  hypothesisText: string;
}

interface WizardStep2Props {
  claimId: string;
  hypotheses: WizardStep2Hypothesis[];
}

export function WizardStep2({ claimId, hypotheses }: WizardStep2Props) {
  const verdictsQuery = useClaimVerdicts(claimId);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: fMono,
            fontSize: 10,
            color: amber,
            letterSpacing: '0.18em',
            marginBottom: 8,
          }}
        >
          STEP 02 · IP SEARCH
        </div>
        <div
          style={{
            fontFamily: fSerif,
            fontSize: 24,
            color: bone,
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            marginBottom: 8,
          }}
        >
          Search prior art for each hypothesis.
        </div>
        <div style={{ fontFamily: fMono, fontSize: 11, color: bone3, letterSpacing: '0.12em' }}>
          {hypotheses.length} HYPOTHES{hypotheses.length === 1 ? 'IS' : 'ES'} ·{' '}
          {verdictsQuery.data
            ? `${verdictsQuery.data.verdicts.filter((v) => v.status === 'approved').length} APPROVED`
            : 'LOADING…'}
        </div>
      </div>

      {hypotheses.length === 0 && (
        <div
          style={{
            fontFamily: 'var(--font-geist), system-ui',
            fontSize: 14,
            color: bone3,
            padding: 24,
          }}
        >
          No hypotheses to search yet — return to Step 1 to define them.
        </div>
      )}

      {hypotheses.map((h) => {
        const existing =
          verdictsQuery.data?.verdicts.find(
            (v) => v.activityId === h.activityId && v.hypothesisText === h.hypothesisText,
          ) ?? null;
        return (
          <HypothesisCard
            key={`${h.activityId}:${h.hypothesisText}`}
            claimId={claimId}
            activityId={h.activityId}
            hypothesisText={h.hypothesisText}
            existingVerdict={existing}
          />
        );
      })}
    </div>
  );
}
