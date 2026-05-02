/**
 * Public surface of the narrative-drafter (Agent C) module.
 *
 * Re-exports the streaming orchestrator + types so consumers in
 * `apps/api` can import via the package boundary
 * (`@cpa/agents/narrative-drafter`) rather than reaching into the
 * package's `src/`. Mirrors the synthesizer-register/index.ts pattern.
 */

export {
  streamNarrativeDraft,
  _setStreamingClientForTests,
  type ActivityContext,
  type ProjectContext,
  type CompressedEvent,
  type StreamNarrativeDraftInput,
  type StreamEvent,
} from './stream.js';
export { SECTION_KINDS, type SectionKind } from './types.js';
export type { NarrativeSegment } from './validate.js';
