import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { activity } from './activity.js';
import { claim } from './claim.js';
import { tenant } from './tenant.js';
import { user } from './user.js';

/**
 * Wizard Step 2 — IP-search prior-art tables.
 *
 * Mirrors `packages/db/migrations/0086_ip_search.sql`. Three tables:
 *
 *   ipSearchRun     — one row per external search API call
 *                     (hypothesis, database, query) with the raw response
 *                     blob and a hex-sha256 hypothesis hash for cache
 *                     lookups via `ip_search_run_cache_idx`.
 *   ipSearchHit     — denormalised hits from a run (title / abstract /
 *                     url / LLM relevance score). FK-cascades on its
 *                     parent run; inherits tenant scope through it.
 *   ipSearchVerdict — one row per (activity, hypothesis_text) carrying
 *                     the analyst-approved pass/fail verdict, the LLM's
 *                     draft + reasoning, and an optional PDF evidence
 *                     pointer (rendered by the task-07 pg-boss job).
 *
 * **RLS** (hand-authored in 0086):
 *   - ip_search_run / ip_search_verdict:
 *       tenant_id = current_setting('app.current_tenant_id', true)::uuid
 *   - ip_search_hit: inherits via EXISTS join to its parent run.
 *
 * **pdf_evidence_id** is a plain `uuid` here (no FK) because the
 * `evidence` table referenced in the design doc does not yet exist —
 * see 0086_ip_search.sql §"DEVIATION FROM TASK SPEC". A follow-up
 * migration (alongside task 07's evidence-table work) will add the FK.
 *
 * **Naming**: camelCase TS / snake_case SQL — matches every other
 * schema file in this package.
 */

export const IP_SEARCH_DATABASE_NAMES = [
  'ip_australia',
  'semantic_scholar',
  'pubmed',
  'arxiv',
] as const;
export type IpSearchDatabaseName = (typeof IP_SEARCH_DATABASE_NAMES)[number];

export const IP_SEARCH_QUERY_SOURCES = ['llm', 'analyst_edit'] as const;
export type IpSearchQuerySource = (typeof IP_SEARCH_QUERY_SOURCES)[number];

export const IP_SEARCH_VERDICTS = ['pass', 'fail', 'inconclusive'] as const;
export type IpSearchVerdict = (typeof IP_SEARCH_VERDICTS)[number];

export const ipSearchRun = pgTable(
  'ip_search_run',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claim.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activity.id, { onDelete: 'cascade' }),
    hypothesisText: text('hypothesis_text').notNull(),
    /** Hex sha256(hypothesisText). Application-side hash; no CHECK. */
    hypothesisHash: text('hypothesis_hash').notNull(),
    databaseName: text('database_name', { enum: IP_SEARCH_DATABASE_NAMES }).notNull(),
    query: text('query').notNull(),
    querySource: text('query_source', { enum: IP_SEARCH_QUERY_SOURCES }).notNull(),
    rawResponse: jsonb('raw_response'),
    resultCount: integer('result_count').notNull().default(0),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    ranByUserId: uuid('ran_by_user_id').references(() => user.id),
  },
  (t) => ({
    // Cache lookup: most-recent row by (hypothesis, db, query).
    cacheIdx: index('ip_search_run_cache_idx').on(
      t.hypothesisHash,
      t.databaseName,
      t.query,
      t.ranAt.desc(),
    ),
  }),
);

export const ipSearchHit = pgTable(
  'ip_search_hit',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    searchRunId: uuid('search_run_id')
      .notNull()
      .references(() => ipSearchRun.id, { onDelete: 'cascade' }),
    /** Patent number / DOI / arxiv id — whatever the source uses. */
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    abstract: text('abstract'),
    publishedAt: date('published_at'),
    /** LLM-assigned 0..1. */
    relevanceScore: numeric('relevance_score'),
    url: text('url'),
  },
  (t) => ({
    runIdx: index('ip_search_hit_run_idx').on(t.searchRunId),
  }),
);

export const ipSearchVerdict = pgTable(
  'ip_search_verdict',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claim.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activity.id, { onDelete: 'cascade' }),
    hypothesisText: text('hypothesis_text').notNull(),
    /** Final verdict — consultant-approved (may override draft). */
    verdict: text('verdict', { enum: IP_SEARCH_VERDICTS }).notNull(),
    /** LLM-suggested verdict before consultant review. Nullable. */
    draftVerdict: text('draft_verdict', { enum: IP_SEARCH_VERDICTS }),
    /** Markdown reasoning citing search hits. Authored by the LLM, may be edited. */
    analysisMarkdown: text('analysis_markdown').notNull(),
    approvedByUserId: uuid('approved_by_user_id').references(() => user.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /**
     * Points at the rendered PDF evidence row once task-07 runs. No FK
     * yet — see 0086_ip_search.sql §"DEVIATION FROM TASK SPEC".
     */
    pdfEvidenceId: uuid('pdf_evidence_id'),
  },
  (t) => ({
    // SQL: CONSTRAINT one_verdict_per_hypothesis UNIQUE (activity_id, hypothesis_text)
    oneVerdictPerHypothesis: uniqueIndex('one_verdict_per_hypothesis').on(
      t.activityId,
      t.hypothesisText,
    ),
  }),
);
