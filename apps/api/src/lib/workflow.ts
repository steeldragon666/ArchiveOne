/**
 * Pure-function gating logic for the claim wizard. Computes "can the
 * consultant advance from step N to N+1?" from a snapshot of underlying
 * data — no DB access here; the caller (the route handler) loads the
 * snapshot once and asks per step.
 *
 * Per Q5.b (revision flow), this is always computed live from current
 * data, so editing a prior step's data (e.g. adding new evidence) can
 * cause `canAdvance` on a later step to flip from ok=true back to
 * ok=false with a reason — the wizard surfaces this as a "data changed
 * since you last agreed" banner.
 */
import type { WorkflowState } from '@cpa/schemas';

/**
 * Lookup table from the numeric step type used by the wizard to the
 * literal string keys used in `WorkflowState.steps`. Keeps the literal-
 * key precision intact — if the step union ever drifts (e.g. someone
 * widens to `number`), this conversion fails at compile time rather
 * than producing a `WorkflowState` with an unexpected key that fails
 * the strict zod validator at the persistence boundary.
 */
const STEP_KEY: Record<1 | 2 | 3 | 4 | 5, '1' | '2' | '3' | '4' | '5'> = {
  1: '1',
  2: '2',
  3: '3',
  4: '4',
  5: '5',
};

/**
 * Narrative drafter produces four sections (Hypothesis / Experiment /
 * Evaluation / Outcome) per draft-narrative@1.1.0. Step 4 requires every
 * section to be approved before advance.
 */
const REQUIRED_NARRATIVE_SECTIONS = 4;

export type WorkflowSnapshot = {
  eventsClassified: number;
  proposedActivitiesPending: number;
  proposedActivitiesTotal: number;
  agreedActivitiesTotal: number;
  agreedActivitiesWithoutBinding: number;
  narrativeSectionsApproved: number;
};

export type CanAdvanceResult = { ok: true } | { ok: false; reason: string };

export function canAdvance(step: 1 | 2 | 3 | 4 | 5, snap: WorkflowSnapshot): CanAdvanceResult {
  switch (step) {
    case 1:
      return snap.eventsClassified > 0
        ? { ok: true }
        : { ok: false, reason: 'Upload at least one piece of evidence to advance.' };
    case 2:
      return snap.proposedActivitiesPending === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `${snap.proposedActivitiesPending} proposed activit${snap.proposedActivitiesPending === 1 ? 'y' : 'ies'} still pending — Agree or Reject each one.`,
          };
    case 3:
      return snap.agreedActivitiesWithoutBinding === 0
        ? { ok: true }
        : {
            ok: false,
            reason: `${snap.agreedActivitiesWithoutBinding} agreed activit${snap.agreedActivitiesWithoutBinding === 1 ? 'y has' : 'ies have'} no bound evidence yet.`,
          };
    case 4:
      return snap.narrativeSectionsApproved >= REQUIRED_NARRATIVE_SECTIONS
        ? { ok: true }
        : {
            ok: false,
            reason: `${snap.narrativeSectionsApproved} of ${REQUIRED_NARRATIVE_SECTIONS} narrative sections approved — approve the remaining ${REQUIRED_NARRATIVE_SECTIONS - snap.narrativeSectionsApproved} to advance.`,
          };
    case 5:
      return { ok: false, reason: 'Step 5 is terminal — no further advance.' };
    default: {
      const _exhaustive: never = step;
      throw new Error(`canAdvance: unhandled step ${_exhaustive as number}`);
    }
  }
}

export function initialWorkflowState(initializedAt: string): WorkflowState {
  return {
    initialized_at: initializedAt,
    steps: { '1': null, '2': null, '3': null, '4': null, '5': null },
  };
}

/**
 * Pure reducer. Returns a new state with the named step recorded as
 * agreed at `now` by `userId`. Input `state` is not mutated.
 *
 * Re-agreeing an already-agreed step overwrites the prior entry.
 * This is intentional: per Q5.b, the wizard surfaces a "data changed
 * since last agreed" banner and the consultant clicks Agree again to
 * refresh the timestamp. Historical agree-events are recorded in the
 * append-only audit-log chain — not here.
 */
export function applyAgree(
  state: WorkflowState,
  step: 1 | 2 | 3 | 4 | 5,
  userId: string,
  now: string,
): WorkflowState {
  return {
    ...state,
    steps: {
      ...state.steps,
      [STEP_KEY[step]]: { agreed_at: now, agreed_by: userId },
    },
  };
}

export function applyReopen(state: WorkflowState, step: 1 | 2 | 3 | 4 | 5): WorkflowState {
  // No cascade per Q5.b — downstream steps keep their agreed_at; UI shows
  // a soft "data changed since" warning instead.
  return {
    ...state,
    steps: { ...state.steps, [STEP_KEY[step]]: null },
  };
}
