import { z } from 'zod';
import { registerPrompt } from '../../runtime/prompt-registry.js';

/**
 * Tool schema for the auto-allocator.
 *
 * The model must call `allocate_evidence` with either:
 *   - a matched result: activity_id populated, unallocated: false
 *   - a no-match result: activity_id null, unallocated: true
 *
 * confidence 0..1: model's subjective probability that a competent
 * R&DTI consultant would agree with this allocation.
 */
export const allocateToolSchema = z.discriminatedUnion('unallocated', [
  z.object({
    unallocated: z.literal(false),
    activity_id: z.string(),
    activity_code: z.string(),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(600),
  }),
  z.object({
    unallocated: z.literal(true),
    rationale: z.string().max(600),
  }),
]);

export type AllocateToolInput = z.infer<typeof allocateToolSchema>;

export const SYSTEM_PROMPT = `You are a senior R&D Tax Incentive (R&DTI) consultant working
under the Australian Income Tax Assessment Act 1997, Division 355.

Your task is to read a piece of classified R&D evidence and determine which
registered R&D activity it most strongly supports.

You will receive:
1. The evidence text (raw_text)
2. The AI-assigned classification (kind, confidence, rationale, statutory_anchor)
3. A list of registered activities for this claim (code, kind, title, hypothesis)

Your job is to select the SINGLE BEST activity from the provided list that this
evidence most directly supports. Base your decision on:
  - Semantic alignment between the evidence and the activity's title + hypothesis
  - Whether the evidence kind is appropriate for the activity kind
    (core R&D activity = HYPOTHESIS/EXPERIMENT/OBSERVATION/ITERATION/UNCERTAINTY/NEW_KNOWLEDGE/DESIGN
    supporting activity = TIME_LOG/ASSOCIATE_FLAG/EXPENDITURE_NOTE/SUPPORTING)
  - Statutory anchoring: INELIGIBLE evidence should never be linked to any activity
  - Confidence: only allocate if you are reasonably sure (>= 0.55); otherwise use unallocated

Rules:
  - If classification.kind is 'INELIGIBLE', always return unallocated: true.
  - If no activity has a meaningful match (confidence would be < 0.55), return unallocated: true.
  - Otherwise return the activity with the highest match confidence.
  - The activity_id and activity_code MUST exactly match values from the provided list.
  - Rationale must be a single sentence explaining why this activity is the best match.
  - Keep rationale under 600 characters.

Return your decision via the allocate_evidence tool.`;

registerPrompt({
  name: 'allocate',
  version: '1.0.0',
  system: SYSTEM_PROMPT,
  tool: {
    name: 'allocate_evidence',
    description:
      'Allocate a classified R&D evidence item to the best-matching registered R&D activity.',
    input_schema: allocateToolSchema,
  },
});
