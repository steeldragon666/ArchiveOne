import { CLAIM_STAGES_LITERAL, type Claim, type ClaimStage } from '@cpa/schemas';
import { STAGE_LABELS } from '@/lib/claim-stage';
import { daysInStage } from '../_lib/format';

// Re-exported so existing pipeline consumers (`./pipeline-filters`,
// `./pipeline-kanban`, `./pipeline-table`) can keep importing from this
// module unchanged. New cross-route consumers should import directly from
// `@/lib/claim-stage` to avoid pulling in the pipeline module graph.
export { STAGE_LABELS };

/**
 * Pure URL-param parsers for /pipeline. Extracted from pipeline-filters.tsx
 * so they're unit-testable in isolation and re-usable from page.tsx without
 * pulling in the React component module graph.
 *
 * URL is the source of truth for filter state (matches FilterTabs in
 * subject-tenants/[id]/_components/filter-tabs.tsx — shareable links,
 * back-button friendly).
 *
 *   ?stage=engagement&stage=review   → ClaimStage[] (multi)
 *   ?consultant=<uuid>               → user UUID (single, "" = all)
 *   ?fy=2026                         → fiscal_year (single int)
 *   ?sector=biotech                  → free-text contains match (single)
 *   ?view=kanban|table               → view toggle (default = table)
 *   ?sort=col&dir=asc|desc           → table sort (default = last_updated desc)
 */

export type PipelineView = 'kanban' | 'table';

const VIEW_VALUES = new Set<PipelineView>(['kanban', 'table']);

export function parseView(raw: string | null): PipelineView {
  return raw && VIEW_VALUES.has(raw as PipelineView) ? (raw as PipelineView) : 'table';
}

/**
 * Parses repeated `?stage=` params, dropping unknown values. Duplicate
 * values are preserved as-is (the filter UI naturally dedupes on toggle,
 * and downstream consumers should treat the array as a set anyway).
 */
export function parseStages(raw: string[] | undefined): ClaimStage[] {
  if (!raw || raw.length === 0) return [];
  const valid = new Set<string>(CLAIM_STAGES_LITERAL);
  return raw.filter((s): s is ClaimStage => valid.has(s));
}

export function parseFiscalYear(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1900 && n <= 2200 ? n : fallback;
}

/**
 * Returns the Australian R&DTI fiscal year for a given date (defaults to now).
 * The AU FY rolls over on 1 July (e.g., FY 2026 = 1 Jul 2025 - 30 Jun 2026,
 * named by the year it ends). Uses local-time getters because the cutoff
 * is a wall-clock concept, not a UTC concept — `getUTCMonth` would misfire
 * for Sydney users in the ~11-hour window where local-July-1 is still
 * UTC-June-30.
 */
export function currentFiscalYear(now: Date = new Date()): number {
  // Months are 0-indexed: 0 = January, 6 = July.
  return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
}

// --- Table sort URL params -------------------------------------------------

/**
 * Sortable columns in the table view. Kept as a literal so changes here
 * fail typecheck on the consuming `applySorting` switch.
 */
export const SORT_COLUMNS = [
  'claimant',
  'fy',
  'stage',
  'activities',
  'days_in_stage',
  'last_updated',
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortDir = 'asc' | 'desc';

export interface PipelineSort {
  column: SortColumn;
  dir: SortDir;
}

/** Default sort applied when `?sort` is absent or invalid. */
export const DEFAULT_SORT: PipelineSort = { column: 'last_updated', dir: 'desc' };

const SORT_COLUMN_SET = new Set<string>(SORT_COLUMNS);

/**
 * Parse `?sort=col&dir=asc|desc`. Invalid combinations return null so the
 * caller can substitute the default. Both params must be valid for a
 * non-null result; a partial pair is treated as missing.
 */
export function parseSort(rawCol: string | null, rawDir: string | null): PipelineSort | null {
  if (!rawCol || !SORT_COLUMN_SET.has(rawCol)) return null;
  if (rawDir !== 'asc' && rawDir !== 'desc') return null;
  return { column: rawCol as SortColumn, dir: rawDir };
}

/**
 * Sort claims by the given column + direction. Pure: returns a new array
 * (does not mutate input). Numeric/string compares only — no locale
 * collation since the values are either ids/enums or numbers.
 *
 * `subjectTenantNames` lets the caller provide a `subject_tenant_id → name`
 * lookup for the `claimant` column. When omitted, falls back to
 * `subject_tenant_id` so the sort is still deterministic before names are
 * available (matches A2's empty-name stub during pre-A2 development).
 *
 * `now` allows tests to lock the wall clock for `days_in_stage`.
 */
export function applySorting(
  claims: readonly Claim[],
  sort: PipelineSort,
  opts: { subjectTenantNames?: Record<string, string>; now?: Date } = {},
): Claim[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const names = opts.subjectTenantNames ?? {};
  const now = opts.now ?? new Date();
  const result = [...claims];
  result.sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    switch (sort.column) {
      case 'claimant':
        av = (names[a.subject_tenant_id] ?? a.subject_tenant_id).toLowerCase();
        bv = (names[b.subject_tenant_id] ?? b.subject_tenant_id).toLowerCase();
        break;
      case 'fy':
        av = a.fiscal_year;
        bv = b.fiscal_year;
        break;
      case 'stage':
        // Sort by canonical stage order, not alphabetical.
        av = CLAIM_STAGES_LITERAL.indexOf(a.stage);
        bv = CLAIM_STAGES_LITERAL.indexOf(b.stage);
        break;
      case 'activities':
        // TODO(A2): use real activity count once GET /v1/claims returns it.
        av = 0;
        bv = 0;
        break;
      case 'days_in_stage':
        av = daysInStage(a.updated_at, now);
        bv = daysInStage(b.updated_at, now);
        break;
      case 'last_updated':
        av = new Date(a.updated_at).getTime();
        bv = new Date(b.updated_at).getTime();
        break;
    }
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
  return result;
}
