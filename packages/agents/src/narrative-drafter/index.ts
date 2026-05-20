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

// Portal-fields prompt (v1.2.0). Side-effect import registers the prompt
// in the runtime registry so callers can `getPrompt('draft-narrative@1.2.0')`
// without reaching into the package's src/ themselves. The type export
// gives API/UI consumers a strong type for the validated tool output.
import './prompts/draft-narrative@1.2.0.js';
export {
  EMIT_PORTAL_FIELDS_TOOL_NAME,
  type EmitPortalFieldsToolInput,
} from './prompts/draft-narrative@1.2.0.js';
