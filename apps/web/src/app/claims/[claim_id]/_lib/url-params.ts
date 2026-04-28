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
 *   ?expenditure_filter=all|unmapped|mapped (only meaningful on the
 *      expenditure tab; ignored elsewhere)
 *
 * Default tab = 'activities' (the working surface for stage 1-2 of the
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

/**
 * Maps a keyboard event `key` to the next active tab, given the current
 * tab. Returns `null` for keys we don't handle so the caller can preserve
 * native browser behaviour (Tab/Shift-Tab focus traversal etc).
 *
 * Implements the WAI-ARIA APG tabs pattern (horizontal orientation):
 *   - ArrowRight / ArrowDown → next tab, wraps last → first
 *   - ArrowLeft  / ArrowUp   → previous tab, wraps first → last
 *   - Home → first tab
 *   - End  → last tab
 *
 * Up/Down are accepted alongside Left/Right because some screen readers
 * suggest the vertical pair when the user can't tell the orientation;
 * accepting both keeps the tablist usable either way.
 *
 * Pure helper so it's unit-testable without a DOM (matches the
 * `node:test` + pure-function pattern used elsewhere in apps/web).
 */
export function nextTabFromKey(key: string, current: ClaimTab): ClaimTab | null {
  const idx = CLAIM_TAB_VALUES.indexOf(current);
  if (idx === -1) return null;
  const len = CLAIM_TAB_VALUES.length;
  // Indexes are always in-bounds (modulo arithmetic + clamped Home/End),
  // but the project uses `noUncheckedIndexedAccess` so the array read is
  // typed `ClaimTab | undefined`. Assertions narrow that back to `ClaimTab`
  // — safe given the bounds reasoning above. The literal-index Home case
  // is folded by TS to the tuple-element literal type without undefined,
  // so it doesn't need an assertion.
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return CLAIM_TAB_VALUES[(idx + 1) % len] as ClaimTab;
    case 'ArrowLeft':
    case 'ArrowUp':
      return CLAIM_TAB_VALUES[(idx - 1 + len) % len] as ClaimTab;
    case 'Home':
      return CLAIM_TAB_VALUES[0];
    case 'End':
      return CLAIM_TAB_VALUES[len - 1] as ClaimTab;
    default:
      return null;
  }
}

// --- Expenditure tab filter (?expenditure_filter=...) --------------------
//
// C5 ships the expenditure-mapping UI. The filter chip strip ("All" /
// "Unmapped" / "Mapped") is URL-driven for the same shareable-link
// reason as `?tab` above. Default = 'unmapped' because the most common
// consultant workflow on this tab is "what's left to map?" — landing
// on the full list is rarely useful.

export const EXPENDITURE_FILTER_VALUES = ['all', 'unmapped', 'mapped'] as const;
export type ExpenditureFilter = (typeof EXPENDITURE_FILTER_VALUES)[number];

/** Default applied when `?expenditure_filter` is absent or invalid. */
export const DEFAULT_EXPENDITURE_FILTER: ExpenditureFilter = 'unmapped';

const EXPENDITURE_FILTER_SET = new Set<ExpenditureFilter>(EXPENDITURE_FILTER_VALUES);

/**
 * Parse `?expenditure_filter=...`. Mirrors the `parseTab` shape: unknown
 * values fall back to the default rather than throwing — a stale link
 * shouldn't 404, just land the user on the most-useful default view.
 */
export function parseExpenditureFilter(raw: string | null | undefined): ExpenditureFilter {
  if (!raw) return DEFAULT_EXPENDITURE_FILTER;
  return EXPENDITURE_FILTER_SET.has(raw as ExpenditureFilter)
    ? (raw as ExpenditureFilter)
    : DEFAULT_EXPENDITURE_FILTER;
}

/**
 * Human-readable labels for each expenditure filter. Single source of
 * truth for the chip strip and any future surface that needs to render
 * a filter name.
 */
export const EXPENDITURE_FILTER_LABELS: Record<ExpenditureFilter, string> = {
  all: 'All',
  unmapped: 'Unmapped',
  mapped: 'Mapped',
};
