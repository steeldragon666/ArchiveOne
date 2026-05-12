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
      [String(step)]: { agreed_at: now, agreed_by: userId },
    },
  };
}

export function applyReopen(state: WorkflowState, step: 1 | 2 | 3 | 4 | 5): WorkflowState {
  // No cascade per Q5.b — downstream steps keep their agreed_at; UI shows
  // a soft "data changed since" warning instead.
  return {
    ...state,
    steps: { ...state.steps, [String(step)]: null },
  };
}
