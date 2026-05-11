/**
 * URL search-param parsers for the /projects surfaces (T-A7).
 *
 * Patterns mirror the existing helpers under
 * `apps/web/src/app/subject-tenants/[id]/_components/filter-tabs.tsx`
 * (which exposes `parseFilter` for `?filter=...`) and the
 * `claims/[claim_id]/_lib/url-params.ts` shape called for in the C4
 * follow-up (commit 1daf474). All three follow the same default-on-junk
 * rule: any unknown / null / empty value falls back to a documented
 * default rather than 400-ing or rendering an empty page, because the
 * URL is shareable and we'd rather degrade gracefully than crash on a
 * stale link.
 *
 * Pure functions — no React, no closures, no fetch — so they're covered
 * by `node:test` in `url-params.test.ts` without jsdom.
 */

/**
 * Status filter for the /projects list strip: "All", "Active",
 * "Archived".
 *
 * Default = 'active' because the consultant lands on the page expecting
 * to see live engagements; archived projects are queryable but stay
 * off-screen until the user explicitly asks for them. Matches the
 * docstring on `project.archived_at` in @cpa/db/schema/project.ts.
 */
export type ProjectListStatus = 'active' | 'archived' | 'all';

const PROJECT_LIST_STATUS_VALUES: ReadonlySet<string> = new Set([
  'active',
  'archived',
  'all',
] satisfies ReadonlyArray<ProjectListStatus>);

/**
 * Parse `?status=...` for the /projects list page. Defaults to 'active'
 * (see above). Accepts the three documented values; anything else
 * (including null / undefined / empty string) falls back to the default.
 */
export function parseProjectListStatus(value: string | null | undefined): ProjectListStatus {
  if (value && PROJECT_LIST_STATUS_VALUES.has(value)) {
    // The Set membership check narrows to the literal union via
    // `ProjectListStatus` — safe to cast.
    return value as ProjectListStatus;
  }
  return 'active';
}

/**
 * Sort order for the /projects list. "name" is alphabetic A→Z (the
 * default for the most common consultant scan), "recent" is by latest
 * activity timestamp DESC, "claim_count" is by number of claims under
 * the project DESC.
 *
 * Default = 'name' — matches the API's `ORDER BY started_at ASC` shape
 * in spirit (a stable, human-readable ordering rather than a recency
 * surprise).
 */
export type ProjectListSort = 'name' | 'recent' | 'claim_count';

const PROJECT_LIST_SORT_VALUES: ReadonlySet<string> = new Set([
  'name',
  'recent',
  'claim_count',
] satisfies ReadonlyArray<ProjectListSort>);

/**
 * Parse `?sort=...` for the /projects list page. Defaults to 'name'.
 * See {@link ProjectListSort}.
 */
export function parseProjectListSort(value: string | null | undefined): ProjectListSort {
  if (value && PROJECT_LIST_SORT_VALUES.has(value)) {
    return value as ProjectListSort;
  }
  return 'name';
}

/**
 * Tab selection for the /projects/[project_id] detail page: "claims",
 * "timeline", "settings".
 *
 * Default = 'claims' — the consultant's first question on landing is
 * "what's been done in this project?" — answered by the claims list.
 * Settings is the rarest interaction (occasional mutation), Timeline is
 * the audit-trail dive when something needs investigating.
 */
export type ProjectTab = 'claims' | 'intake' | 'timeline' | 'settings';

const PROJECT_TAB_VALUES: ReadonlySet<string> = new Set([
  'claims',
  'intake',
  'timeline',
  'settings',
] satisfies ReadonlyArray<ProjectTab>);

/**
 * Parse `?tab=...` for the /projects/[project_id] detail page.
 * Defaults to 'claims'. See {@link ProjectTab}.
 */
export function parseProjectTab(value: string | null | undefined): ProjectTab {
  if (value && PROJECT_TAB_VALUES.has(value)) {
    return value as ProjectTab;
  }
  return 'claims';
}

/**
 * Drift guard: keep the human-readable labels alongside the literal
 * union so a future widening of `ProjectTab` produces a TypeScript
 * error here rather than silently rendering as the raw enum value.
 *
 * Same belt-and-braces shape as `STAGE_LABELS` in
 * `apps/web/src/lib/claim-stage.ts` (extracted in C4 follow-up):
 * `Record<ProjectTab, string>` is the primary defence — TypeScript
 * enforces every member at compile time. The runtime check in tests is
 * documentation more than safety.
 */
export const PROJECT_TAB_LABELS: Record<ProjectTab, string> = {
  claims: 'Claims',
  intake: 'Information intake',
  timeline: 'Timeline',
  settings: 'Settings',
};

export const PROJECT_LIST_STATUS_LABELS: Record<ProjectListStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

export const PROJECT_LIST_SORT_LABELS: Record<ProjectListSort, string> = {
  name: 'Name',
  recent: 'Last activity',
  claim_count: 'Claim count',
};
