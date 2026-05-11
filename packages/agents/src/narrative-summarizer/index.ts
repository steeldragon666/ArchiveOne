/**
 * Public surface of the narrative-summarizer module.
 *
 * Re-exports types + factory so consumers in `apps/api` can import via
 * the package boundary (`@cpa/agents`) rather than reaching into `src/`.
 * Mirrors the document-analyzer/index.ts pattern.
 */

export { makeNarrativeSummarizer } from './factory.js';
export type {
  NarrativeSummarizer,
  NarrativeSummarizerInput,
  NarrativeSummarizerOutput,
} from './types.js';
