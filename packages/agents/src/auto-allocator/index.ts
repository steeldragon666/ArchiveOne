/**
 * Public surface of the auto-allocator module.
 *
 * Re-exports types + factory so consumers in `apps/api` can import via
 * the package boundary (`@cpa/agents`) rather than reaching into `src/`.
 * Mirrors the classifier/index.ts pattern.
 */

export { makeAutoAllocator } from './factory.js';
export type {
  AutoAllocator,
  AutoAllocatorInput,
  AutoAllocatorOutput,
  AutoAllocatorOutputMatched,
  AutoAllocatorOutputUnmatched,
  ActivitySummary,
} from './types.js';
