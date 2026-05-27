/**
 * Wizard Step 2 — IP-search route tests.
 *
 * Covers all six endpoints:
 *   1. POST /v1/claims/:id/activities/:aid/ip-search/queries
 *   2. POST /v1/claims/:id/activities/:aid/ip-search/run
 *   3. POST /v1/claims/:id/activities/:aid/ip-search/verdict
 *   4. POST /v1/ip-search/verdicts/:id/approve
 *   5. POST /v1/ip-search/verdicts/:id/override
 *   6. GET  /v1/claims/:id/ip-search/verdicts
 *
 * Test strategy
 * -------------
 * - Real postgres (RLS GUC enforces tenant scope; integration is the
 *   point of the test).
 * - Anthropic client is replaced via _setIpSearchAnthropicClientForTests
 *   so we don't hit api.anthropic.com.
 * - Integration callers (the four external APIs) are replaced via
 *   _setIntegrationCallerForTests so we don't hit IP Australia / PubMed.
 *
 * Tenant isolation is asserted in every endpoint's "cross-tenant" test
 * (a USER_A session must NEVER see TENANT_B rows).
 */
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '@cpa/auth';
import { sql, privilegedSql } from '@cpa/db/client';
import { buildApp } from '../../app.js';
import { _setIpSearchAnthropicClientForTests } from './helpers.js';
import { _setIntegrationCallerForTests } from './run.js';

const SESSION_SECRET = process.env['SESSION_JWT_SECRET'] ?? 'dev-only-32-bytes-of-entropy-pad!';

// Namespace 0e9000... for IP-search route tests — separate from the
// RLS-only suite's 0f1d00... range.
const TENANT_A = '00000000-0000-4000-8000-00000e900001';
const TENANT_B = '00000000-0000-4000-8000-00000e900002';
const USER_A = '00000000-0000-4000-8000-00000e900010';
const USER_B = '00000000-0000-4000-8000-00000e900011';
const SUBJECT_A = '00000000-0000-4000-8000-00000e900020';
const SUBJECT_B = '00000000-0000-4000-8000-00000e900021';
const PROJECT_A = '00000000-0000-4000-8000-00000e900030';
const PROJECT_B = '00000000-0000-4000-8000-00000e900031';
const CLAIM_A = '00000000-0000-4000-8000-00000e900040';
const CLAIM_B = '00000000-0000-4000-8000-00000e900041';
const ACTIVITY_A = '00000000-0000-4000-8000-00000e900050';
const ACTIVITY_B = '00000000-0000-4000-8000-00000e900051';

const FY = 2026;
const HYPOTHESIS =
  'We sought to determine whether a novel cryogenic process could improve yield by 15%';

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM ip_search_verdict WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM ip_search_hit WHERE search_run_id IN (SELECT id FROM ip_search_run WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}))`;
  await privilegedSql`DELETE FROM ip_search_run WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  // Agent calls produce llm_token_usage rows under (tenant_id, claim_id);
  // those FK-restrict on tenant so we must clear them before the
  // tenant DELETE below.
  await privilegedSql`DELETE FROM llm_token_usage WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM project WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`;
  await privilegedSql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
};

before(async () => {
  await cleanup();
  await privilegedSql`
    INSERT INTO tenant (id, name, slug, primary_idp)
    VALUES (${TENANT_A}, 'IP Search Firm A', 'ipsearch-route-a', 'mixed'),
           (${TENANT_B}, 'IP Search Firm B', 'ipsearch-route-b', 'mixed')
  `;
  await privilegedSql`
    INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
    VALUES (${USER_A}, 'ipsearch-route-a@example.com', 'microsoft', 'ms:ipsearch-route-a', 'IPS A'),
           (${USER_B}, 'ipsearch-route-b@example.com', 'microsoft', 'ms:ipsearch-route-b', 'IPS B')
  `;
  await privilegedSql`
    INSERT INTO tenant_user (id, tenant_id, user_id, role)
    VALUES (gen_random_uuid(), ${TENANT_A}, ${USER_A}, 'consultant'),
           (gen_random_uuid(), ${TENANT_B}, ${USER_B}, 'consultant')
  `;
  await privilegedSql`
    INSERT INTO subject_tenant (id, tenant_id, name)
    VALUES (${SUBJECT_A}, ${TENANT_A}, 'Claimant A'),
           (${SUBJECT_B}, ${TENANT_B}, 'Claimant B')
  `;
  await privilegedSql`
    INSERT INTO project (id, tenant_id, subject_tenant_id, name, started_at)
    VALUES (${PROJECT_A}, ${TENANT_A}, ${SUBJECT_A}, 'Project A', '2025-07-01T00:00:00Z'),
           (${PROJECT_B}, ${TENANT_B}, ${SUBJECT_B}, 'Project B', '2025-07-01T00:00:00Z')
  `;
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, fiscal_year, stage)
    VALUES (${CLAIM_A}, ${TENANT_A}, ${SUBJECT_A}, ${FY}, 'engagement'),
           (${CLAIM_B}, ${TENANT_B}, ${SUBJECT_B}, ${FY}, 'engagement')
  `;
  await privilegedSql`
    INSERT INTO activity (id, tenant_id, project_id, claim_id, code, kind, title, fy_label, hypothesis_formed_at)
    VALUES (${ACTIVITY_A}, ${TENANT_A}, ${PROJECT_A}, ${CLAIM_A}, 'CA-01', 'core', 'IP search Activity A', 'FY26', '2025-08-01T00:00:00Z'),
           (${ACTIVITY_B}, ${TENANT_B}, ${PROJECT_B}, ${CLAIM_B}, 'CA-01', 'core', 'IP search Activity B', 'FY26', '2025-08-01T00:00:00Z')
  `;
});

after(async () => {
  _setIpSearchAnthropicClientForTests(null);
  _setIntegrationCallerForTests(null);
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

beforeEach(async () => {
  // Reset DB state for verdict/hit/run rows so each test sees the
  // baseline schema.
  await privilegedSql`DELETE FROM ip_search_verdict WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  await privilegedSql`DELETE FROM ip_search_hit WHERE search_run_id IN (SELECT id FROM ip_search_run WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}))`;
  await privilegedSql`DELETE FROM ip_search_run WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  _setIpSearchAnthropicClientForTests(null);
  _setIntegrationCallerForTests(null);
});

const jwtFor = (userId: string, email: string, tenantId: string, slug: string): Promise<string> =>
  signSession(
    {
      sub: userId,
      email,
      primaryIdp: 'microsoft',
      activeTenantId: tenantId,
      activeRole: 'consultant',
      availableTenants: [{ tenantId, name: slug, slug, role: 'consultant' }],
    },
    SESSION_SECRET,
    { ttlSeconds: 3600 },
  );

const cookieA = (): Promise<string> =>
  jwtFor(USER_A, 'ipsearch-route-a@example.com', TENANT_A, 'ipsearch-route-a');
const _cookieB = (): Promise<string> =>
  jwtFor(USER_B, 'ipsearch-route-b@example.com', TENANT_B, 'ipsearch-route-b');

// ---------------------------------------------------------------------------
// Anthropic mocks
// ---------------------------------------------------------------------------

const mockQueryClient = {
  messages: {
    create: () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_search_queries',
          id: 'tu_test',
          input: {
            ip_australia: ['cryogenic process AND yield'],
            semantic_scholar: ['cryogenic yield improvement'],
            pubmed: ['cryogenic separation yield'],
            arxiv: ['cryogenic yield optimization'],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  },
} as unknown as Parameters<typeof _setIpSearchAnthropicClientForTests>[0];

const mockVerdictClient = {
  messages: {
    create: () => ({
      content: [
        {
          type: 'tool_use',
          name: 'emit_verdict',
          id: 'tu_test',
          input: {
            verdict: 'pass',
            analysis_markdown:
              'No prior art was found across IP Australia, Semantic Scholar, PubMed, or arXiv for the queries generated from this hypothesis. Therefore, this hypothesis is **PASS** for R&DTI core-activity eligibility.',
          },
        },
      ],
      usage: { input_tokens: 200, output_tokens: 100 },
    }),
  },
} as unknown as Parameters<typeof _setIpSearchAnthropicClientForTests>[0];

// ---------------------------------------------------------------------------
// 1. POST /queries
// ---------------------------------------------------------------------------

test('POST /ip-search/queries: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/queries`,
    payload: { hypothesisText: HYPOTHESIS },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /ip-search/queries: happy path returns per-database queries', async () => {
  _setIpSearchAnthropicClientForTests(mockQueryClient);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/queries`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = res.json<{ queries: Record<string, string[]> }>();
  assert.deepEqual(body.queries.ip_australia, ['cryogenic process AND yield']);
  assert.equal(body.queries.semantic_scholar.length, 1);
  assert.equal(body.queries.pubmed.length, 1);
  assert.equal(body.queries.arxiv.length, 1);
  await app.close();
});

test('POST /ip-search/queries: cross-tenant claim returns 404 (not 200)', async () => {
  _setIpSearchAnthropicClientForTests(mockQueryClient);
  const app = buildApp();
  // USER_A session, TENANT_B's claim/activity → 404.
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_B}/activities/${ACTIVITY_B}/ip-search/queries`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// 2. POST /run — including cache verification
// ---------------------------------------------------------------------------

test('POST /ip-search/run: 401 without session', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/run`,
    payload: {
      hypothesisText: HYPOTHESIS,
      queries: { ip_australia: ['q'], semantic_scholar: [], pubmed: [], arxiv: [] },
    },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /ip-search/run: happy path persists runs + hits, returns hits', async () => {
  let callCount = 0;
  _setIntegrationCallerForTests((database, query) => {
    callCount += 1;
    return Promise.resolve({
      hits: [
        {
          externalId: `${database}-1`,
          title: `${database} hit for ${query}`,
          abstract: 'abstract',
          publishedAt: '2024-01-15',
          url: `https://example.invalid/${database}/1`,
          relevanceScore: 0.85,
        },
      ],
      rawResponse: { results: [{ id: `${database}-1` }] },
    });
  });
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/run`,
    payload: {
      hypothesisText: HYPOTHESIS,
      queries: {
        ip_australia: ['cryogenic'],
        semantic_scholar: [],
        pubmed: ['yield'],
        arxiv: [],
      },
    },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = res.json<{
    runs: Array<{
      database: string;
      query: string;
      source: 'cache' | 'fresh' | 'error';
      runId: string | null;
      hits: Array<{ externalId: string }>;
    }>;
  }>();
  assert.equal(body.runs.length, 2);
  assert.equal(
    body.runs.every((r) => r.source === 'fresh'),
    true,
  );
  assert.equal(callCount, 2, 'integration called once per (database, query) pair');
  // DB rows persisted under TENANT_A.
  const runs = await privilegedSql<{ id: string; tenant_id: string }[]>`
    SELECT id::text AS id, tenant_id::text AS tenant_id
      FROM ip_search_run
     WHERE tenant_id = ${TENANT_A}
  `;
  assert.equal(runs.length, 2);
  await app.close();
});

test('POST /ip-search/run: cache hit on identical (hypothesis, db, query) within 30 days', async () => {
  let callCount = 0;
  _setIntegrationCallerForTests((database, _query) => {
    callCount += 1;
    return Promise.resolve({
      hits: [
        {
          externalId: `${database}-cached`,
          title: 'cached hit',
          abstract: null,
          publishedAt: null,
          url: null,
          relevanceScore: null,
        },
      ],
      rawResponse: {},
    });
  });
  const app = buildApp();
  // First call — fresh.
  const first = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/run`,
    payload: {
      hypothesisText: HYPOTHESIS,
      queries: { ip_australia: ['q1'], semantic_scholar: [], pubmed: [], arxiv: [] },
    },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(callCount, 1);

  // Second call — must use the cache.
  const second = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/run`,
    payload: {
      hypothesisText: HYPOTHESIS,
      queries: { ip_australia: ['q1'], semantic_scholar: [], pubmed: [], arxiv: [] },
    },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(second.statusCode, 200);
  const body = second.json<{ runs: Array<{ source: string; hits: Array<unknown> }> }>();
  assert.equal(body.runs[0]?.source, 'cache');
  assert.equal(body.runs[0]?.hits.length, 1);
  assert.equal(callCount, 1, 'integration must NOT be called on cache hit');
  await app.close();
});

test('POST /ip-search/run: cross-tenant claim returns 404', async () => {
  _setIntegrationCallerForTests(() => Promise.resolve({ hits: [], rawResponse: {} }));
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_B}/activities/${ACTIVITY_B}/ip-search/run`,
    payload: {
      hypothesisText: HYPOTHESIS,
      queries: { ip_australia: ['q'], semantic_scholar: [], pubmed: [], arxiv: [] },
    },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// 3. POST /verdict
// ---------------------------------------------------------------------------

test('POST /ip-search/verdict: happy path inserts verdict with draft populated', async () => {
  _setIpSearchAnthropicClientForTests(mockVerdictClient);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/verdict`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 201, res.payload);
  const body = res.json<{
    id: string;
    verdict: string;
    draftVerdict: string;
    analysisMarkdown: string;
  }>();
  assert.equal(body.verdict, 'pass');
  assert.equal(body.draftVerdict, 'pass');
  assert.ok(body.analysisMarkdown.length > 50);
  await app.close();
});

test('POST /ip-search/verdict: duplicate hypothesis returns 409', async () => {
  _setIpSearchAnthropicClientForTests(mockVerdictClient);
  const app = buildApp();
  const first = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/verdict`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(first.statusCode, 201);
  const second = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_A}/activities/${ACTIVITY_A}/ip-search/verdict`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(second.statusCode, 409);
  await app.close();
});

test('POST /ip-search/verdict: cross-tenant claim returns 404', async () => {
  _setIpSearchAnthropicClientForTests(mockVerdictClient);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/claims/${CLAIM_B}/activities/${ACTIVITY_B}/ip-search/verdict`,
    payload: { hypothesisText: HYPOTHESIS },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// 4. POST /approve
// ---------------------------------------------------------------------------

async function seedDraftVerdict(
  tenantId: string,
  claimId: string,
  activityId: string,
): Promise<string> {
  const rows = await privilegedSql<{ id: string }[]>`
    INSERT INTO ip_search_verdict (tenant_id, claim_id, activity_id, hypothesis_text, verdict, draft_verdict, analysis_markdown)
    VALUES (${tenantId}, ${claimId}, ${activityId}, ${HYPOTHESIS}, 'pass', 'pass', 'draft analysis text long enough.')
    RETURNING id::text AS id
  `;
  return rows[0]!.id;
}

test('POST /approve: sets approved_by + approved_at', async () => {
  const verdictId = await seedDraftVerdict(TENANT_A, CLAIM_A, ACTIVITY_A);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/ip-search/verdicts/${verdictId}/approve`,
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = res.json<{ approved_at: string | null }>();
  assert.ok(body.approved_at, 'approved_at should be populated');
  await app.close();
});

test('POST /approve: cross-tenant verdict returns 404', async () => {
  const verdictId = await seedDraftVerdict(TENANT_B, CLAIM_B, ACTIVITY_B);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/ip-search/verdicts/${verdictId}/approve`,
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// 5. POST /override
// ---------------------------------------------------------------------------

test('POST /override: changes verdict + replaces analysis with reasoning', async () => {
  const verdictId = await seedDraftVerdict(TENANT_A, CLAIM_A, ACTIVITY_A);
  const app = buildApp();
  const reasoning =
    'After reviewing the hits I disagree with the LLM — patent X anticipates the core claim, so FAIL is correct.';
  const res = await app.inject({
    method: 'POST',
    url: `/v1/ip-search/verdicts/${verdictId}/override`,
    payload: { verdict: 'fail', reasoningMarkdown: reasoning },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 200, res.payload);
  const body = res.json<{ verdict: string; draft_verdict: string; analysis_markdown: string }>();
  assert.equal(body.verdict, 'fail');
  // Draft verdict preserved on the row for audit.
  assert.equal(body.draft_verdict, 'pass');
  assert.equal(body.analysis_markdown, reasoning);
  await app.close();
});

test('POST /override: rejects short reasoning (<30 chars)', async () => {
  const verdictId = await seedDraftVerdict(TENANT_A, CLAIM_A, ACTIVITY_A);
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: `/v1/ip-search/verdicts/${verdictId}/override`,
    payload: { verdict: 'fail', reasoningMarkdown: 'too short' },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /override: cross-tenant verdict returns 404', async () => {
  const verdictId = await seedDraftVerdict(TENANT_B, CLAIM_B, ACTIVITY_B);
  const app = buildApp();
  const reasoning = 'Cross-tenant override attempt — must be blocked by RLS / 404.';
  const res = await app.inject({
    method: 'POST',
    url: `/v1/ip-search/verdicts/${verdictId}/override`,
    payload: { verdict: 'fail', reasoningMarkdown: reasoning },
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------
// 6. GET /claims/:id/ip-search/verdicts
// ---------------------------------------------------------------------------

test('GET /claims/:id/ip-search/verdicts: lists verdicts with status', async () => {
  await seedDraftVerdict(TENANT_A, CLAIM_A, ACTIVITY_A);
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_A}/ip-search/verdicts`,
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ verdicts: Array<{ status: string; hypothesisText: string }> }>();
  assert.equal(body.verdicts.length, 1);
  assert.equal(body.verdicts[0]?.status, 'draft');
  assert.equal(body.verdicts[0]?.hypothesisText, HYPOTHESIS);
  await app.close();
});

test('GET /claims/:id/ip-search/verdicts: RLS hides cross-tenant verdicts', async () => {
  await seedDraftVerdict(TENANT_B, CLAIM_B, ACTIVITY_B);
  const app = buildApp();
  // USER_A session asking for CLAIM_B → 404 (claim not visible).
  const res = await app.inject({
    method: 'GET',
    url: `/v1/claims/${CLAIM_B}/ip-search/verdicts`,
    cookies: { cpa_session: await cookieA() },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});
