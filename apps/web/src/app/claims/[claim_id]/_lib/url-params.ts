/**
 * Pure URL-param parsers for /claims/[claim_id]. Extracted from
 * claim-tabs.tsx so they're unit-testable in isolation and re-usable from
 * page.tsx without pulling in the React component module graph.
 *
 * Mirrors the established C1 pattern in
 * `apps/web/src/app/pipeline/_components/url-params.ts` — URL is the
 * source of truth for view state (shareable links, back-button
 * friendly).
 *
 *   ?tab=activities|evidence|expenditure|documents|timeline
 *
 * Default = 'activities' (the working surface for stage 1-2 of the
 * pipeline; everything downstream is wired in C5+).
 */

export const CLAIM_TAB_VALUES = [
  'activities',
  'evidence',
  'expenditure',
  'documents',
  'timeline',
] as const;
export type ClaimTab = (typeof CLAIM_TAB_VALUES)[number];

/** Default tab applied when `?tab` is absent or invalid. */
export const DEFAULT_CLAIM_TAB: ClaimTab = 'activities';

const TAB_VALUES = new Set<ClaimTab>(CLAIM_TAB_VALUES);

/**
 * Parse `?tab=...`. Unknown values fall back to the default rather than
 * throwing — a stale link from an old build (or a user typo) shouldn't
 * 404; just land them on the activities tab.
 */
export function parseTab(raw: string | null | undefined): ClaimTab {
  if (!raw) return DEFAULT_CLAIM_TAB;
  return TAB_VALUES.has(raw as ClaimTab) ? (raw as ClaimTab) : DEFAULT_CLAIM_TAB;
}

/**
 * Human-readable labels for each tab. Single source of truth for the
 * tab-strip and any future surface (breadcrumbs, page titles) that
 * needs to render a tab name.
 */
export const TAB_LABELS: Record<ClaimTab, string> = {
  activities: 'Activities',
  evidence: 'Evidence',
  expenditure: 'Expenditure',
  documents: 'Documents',
  timeline: 'Timeline',
};
