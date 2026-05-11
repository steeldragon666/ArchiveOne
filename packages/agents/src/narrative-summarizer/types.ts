import { z } from 'zod';

/**
 * Input to the narrative-summarizer agent.
 *
 * Collects the extracted proposals from one or more pending document uploads
 * for a single subject_tenant. The summarizer synthesises these into a
 * 2-3 sentence project narrative a tax consultant can use in front of a partner,
 * plus aggregate counts for the PendingNarrativePanel UI.
 */
export type NarrativeSummarizerInput = {
  subject_tenant_name: string;
  document_summaries: Array<{ filename: string; summary: string }>;
  proposed_activities: Array<{
    name: string;
    kind: 'core' | 'supporting';
    hypothesis: string;
    confidence: number;
  }>;
  proposed_invoices: Array<{
    vendor: string;
    total_aud: number;
    confidence: number;
  }>;
};

/**
 * Structured output from the narrative-summarizer agent.
 *
 * `narrative` is the 2-3 sentence paragraph suitable for a tax-consultant
 * review UI. The counts are pre-computed by the agent for display purposes
 * (saves the caller from re-aggregating the input arrays).
 */
export const NarrativeSummarizerOutputSchema = z.object({
  narrative: z
    .string()
    .min(50)
    .max(1500)
    .describe('2-3 sentences, tax-consultant register, R&DTI §355-25 ITAA 1997'),
  total_aud: z.number().nonnegative().describe('Sum of all proposed invoice amounts'),
  core_count: z.number().int().nonnegative().describe('Count of proposed core R&D activities'),
  supporting_count: z
    .number()
    .int()
    .nonnegative()
    .describe('Count of proposed supporting R&D activities'),
  invoice_count: z.number().int().nonnegative().describe('Total number of proposed invoices'),
  document_count: z.number().int().nonnegative().describe('Total number of documents analysed'),
});

export type NarrativeSummarizerOutput = z.infer<typeof NarrativeSummarizerOutputSchema>;

/**
 * Interface every NarrativeSummarizer implementation must satisfy.
 *
 * Pattern: mirrors DocumentAnalyzer. The `summarize` method is async and
 * must return the output shape regardless of implementation (opus or stub).
 */
export interface NarrativeSummarizer {
  summarize(input: NarrativeSummarizerInput): Promise<NarrativeSummarizerOutput>;
}
