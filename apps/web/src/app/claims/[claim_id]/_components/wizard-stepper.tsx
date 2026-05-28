'use client';

import type { WorkflowState } from '@cpa/schemas';

const STEP_LABELS = [
  'Upload Evidence',
  'Review Activities',
  'Attribute Evidence',
  'Narrative & Timeline',
  'Generate Documents',
] as const;

/**
 * WizardStepper — 5-pill progress bar for the claim wizard.
 *
 * NAVIGATION POLICY (W4): clicking any step's button always fires
 * `onJumpTo(stepNum)`, including for unreached future steps. This is
 * deliberate — the wizard supports free preview navigation so consultants
 * can peek ahead at upcoming work without committing. The server-side
 * `canAdvance` gating remains the source of truth for what can be agreed;
 * the stepper is purely view-state.
 *
 * If a stricter "locked future steps" policy is needed later, add a
 * `lockedFrom` prop and gate the button's `onClick` here — but server-side
 * gating still applies regardless.
 */
export function WizardStepper({
  state,
  currentStep,
  onJumpTo,
}: {
  state: WorkflowState;
  currentStep: 1 | 2 | 3 | 4 | 5;
  onJumpTo?: (step: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <ol className="flex items-center justify-between gap-2" data-testid="wizard-stepper">
      {STEP_LABELS.map((label, i) => {
        const stepNum = (i + 1) as 1 | 2 | 3 | 4 | 5;
        const stepKey = String(stepNum) as '1' | '2' | '3' | '4' | '5';
        const agreed = state.steps[stepKey] != null;
        const isCurrent = stepNum === currentStep;
        return (
          <li key={stepNum} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJumpTo?.(stepNum)}
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium',
                agreed
                  ? 'border-[hsl(var(--brand-green))] bg-[hsl(var(--brand-green))] text-white'
                  : isCurrent
                    ? 'border-[hsl(var(--brand-ink))] bg-[hsl(var(--brand-paper))]'
                    : 'border-[hsl(var(--brand-line))] bg-card text-[hsl(var(--brand-ink-subtle))]',
                // W2: when a step is BOTH agreed AND current, the isCurrent
                // styling is otherwise swallowed by the agreed styling — add
                // a focus ring so sighted users still see the "you are here"
                // cue on top of the green pill.
                agreed && isCurrent ? 'ring-2 ring-[hsl(var(--brand-ink))] ring-offset-2' : '',
              ].join(' ')}
              data-testid={`wizard-stepper-${stepNum}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {agreed ? '\u2713' : stepNum}
            </button>
            <span className="text-sm">{label}</span>
            {i < 4 ? <span className="flex-1 border-t border-[hsl(var(--brand-line))]" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
