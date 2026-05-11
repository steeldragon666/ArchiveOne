/**
 * Auto-allocator domain types.
 *
 * The allocator receives an evidence event and the claim's activity list,
 * and returns the best-matching activity — or signals that no match is
 * confident enough (unallocated).
 *
 * Mirrors the classifier's types.ts structure so the two agents are
 * structurally symmetric and factory.ts follows the same pattern.
 */

import type { ClassifiableKind } from '../classifier/types.js';

export type ActivitySummary = {
  id: string;
  code: string; // e.g. 'CA-01', 'SA-02'
  kind: 'core' | 'supporting';
  title: string;
  hypothesis: string | null;
};

export type AutoAllocatorInput = {
  event_id: string;
  raw_text: string;
  classification: {
    kind: ClassifiableKind;
    confidence: number;
    rationale: string;
    statutory_anchor: string | null;
  };
  activities: ActivitySummary[];
};

export type AutoAllocatorOutputMatched = {
  unallocated: false;
  activity_id: string;
  activity_code: string;
  confidence: number;
  rationale: string;
  model: string;
  prompt_version: string;
  tokens_in: number;
  tokens_out: number;
};

export type AutoAllocatorOutputUnmatched = {
  unallocated: true;
  rationale: string;
  model: string;
  prompt_version: string;
  tokens_in: number;
  tokens_out: number;
};

export type AutoAllocatorOutput = AutoAllocatorOutputMatched | AutoAllocatorOutputUnmatched;

export interface AutoAllocator {
  allocate(input: AutoAllocatorInput): Promise<AutoAllocatorOutput>;
}
