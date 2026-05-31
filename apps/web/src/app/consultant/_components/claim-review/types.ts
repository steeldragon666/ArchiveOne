import type { StatusKind } from '../atoms';
import type { WorkflowStepKey } from '../claims-api';

/**
 * UI lifecycle a claim moves through in this view:
 *   drafting  → approving the six wizard steps (not all approved yet)
 *   approved  → all six approved, ready to SEAL
 *   sealed    → sealed onto the chain (block written); ready to FINANCE
 *   financing → refund submitted to the financing rail
 *
 * Seal/finance are not yet readable via any GET (the Claim row carries no
 * seal/finance columns), so the sealed/financing states are tracked LIVE
 * from the POST results within this session. When the consultant reopens
 * the claim later, the badge derives only from workflow_state (drafting /
 * approved) — an honest reflection of what the API exposes today.
 */
export type ClaimLifecycle = 'drafting' | 'approved' | 'sealed' | 'financing';

export const LIFECYCLE_PILL: Record<ClaimLifecycle, StatusKind> = {
  drafting: 'review',
  approved: 'approved',
  sealed: 'sealed',
  financing: 'financing',
};

export interface StepDef {
  /** Backend workflow step this UI step approves (1..5). */
  key: WorkflowStepKey;
  /** 1-based UI ordinal. */
  ordinal: number;
  label: string;
  /** The judgement question shown in the step header. */
  question: string;
  /** Short note on what the AI prepares for this step. */
  prepares: string;
}

export const STEP_DEFS: StepDef[] = [
  {
    key: '1',
    ordinal: 1,
    label: 'HYPOTHESES',
    question: 'What did the company set out to learn?',
    prepares:
      'The AI classified captured evidence and ran an IP / prior-art search per hypothesis.',
  },
  {
    key: '2',
    ordinal: 2,
    label: 'ACTIVITIES',
    question: 'Which work is Core? Which is Supporting?',
    prepares: 'The AI drafted Core vs Supporting activities against Division 355.',
  },
  {
    key: '3',
    ordinal: 3,
    label: 'APPORTIONMENT',
    question: 'How does the ledger map to the activities?',
    prepares: 'The AI apportioned the connected accounting ledger onto the activities.',
  },
  {
    key: '4',
    ordinal: 4,
    label: 'EVIDENCE',
    question: 'What artefacts prove each activity?',
    prepares: 'The AI bound captured artefacts to the activities they evidence.',
  },
  {
    key: '5',
    ordinal: 5,
    label: 'NARRATIVE',
    question: 'Does the cited technical narrative hold up?',
    prepares: 'The AI drafted the cited technical narrative for each activity.',
  },
];

export const REVIEW_ORDINAL = 6;

export interface FinalizeAction {
  pending: boolean;
  error: Error | null;
}
