import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import nock from 'nock';
import {
  syncBankTransactions,
  type SqlClient,
  type ChainInserter,
  type SyncBankTransactionsConnection,
} from './sync-bank-tx.js';

/**
 * B3 sync-bank-tx tests.
 *
 * Approach: pure-function-style tests with mocked DB. The real DB tests
 * (insert chain extension, RLS) are exercised in CI via the @cpa/db
 * integration suite — Docker isn't running on the Windows author
 * workstation, and pure-function tests give faster feedback regardless.
 *
 * The SQL stub mirrors the postgres-js template-tag interface (see the
 * sibling `sync-invoices.test.ts` for the same pattern). Each call
 * captures the joined SQL string + parameter list, plus an optional
 * row-set the test pre-loads to simulate SELECT/RETURNING results.
 */

const TENANT_ID = '00000000-0000-4000-8000-0000000000a1';
const SUBJECT_TENANT_ID = '00000000-0000-4000-8000-0000000000a2';
const CONNECTION_ID = '00000000-0000-4000-8000-0000000000a3';
const XERO_TENANT_ID = '11111111-2222-3333-4444-555555555555';

const XERO_API_HOST = 'https://api.xero.com';
const XERO_API_PATH = '/api.xro/2.0';

// Resolve the fixture file relative to this test (tests/fixtures/...
// at the repo root). __dirname is unavailable in ESM so derive from
// import.meta.url.
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  here,
  '../../../../tests/fixtures/xero-accounting/bank-tx-sample.json',
);
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  BankTransactions: Array<{ BankTransactionID: string; Type: string; LineItems: unknown[] }>;
};

// Sanity: the fixture has the shape the suite assumes.
const FIXTURE_SPEND = FIXTURE.BankTransactions.filter((t) => t.Type === 'SPEND');
const FIXTURE_RECEIVE = FIXTURE.BankTransactions.filter((t) => t.Type === 'RECEIVE');
assert.equal(FIXTURE_SPEND.length, 3, 'fixture must have exactly 3 SPEND transactions');
assert.equal(FIXTURE_RECEIVE.length, 1, 'fixture must have exactly 1 RECEIVE transaction');

/**
 * Stable, deterministic UUID-v4-shaped ids for test fixtures. The
 * EXPENDITURE_INGESTED payload is now Zod-parsed at the boundary
 * (B2 follow-up — A1 fix #5 pattern), and `Uuid` rejects anything
 * that isn't a v4. The third group must start with `4`, the fourth
 * with `8|9|a|b`. Pad-from-the-end so `expUuid(0)` and `expUuid(99)`
 * both yield distinct, valid UUIDs.
 */
function expUuid(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

// -- SQL stub --------------------------------------------------------------
//
// Each call to `sql` is captured. The stub is "smart": it returns rows
// only for read-shaped queries (SELECT * / INSERT ... RETURNING). Per-row
// FIFO queues are scoped by call kind:
//   - `existing`: returns the next pre-queued row-set on a
//     `SELECT id FROM expenditure WHERE ...` query.
//   - `subjectTenant`: returns the next pre-queued row-set on a
//     `SELECT id FROM subject_tenant ...` query.
//   - `inserted`: returns the next pre-queued row-set on an
//     `INSERT INTO expenditure ... RETURNING` query.
// All other queries (UPDATE, DELETE, INSERT line) return `[]` and don't
// consume any queue. This keeps the test scaffolding simple — tests
// pre-load only the values that *matter* for the path they exercise.

type CapturedQuery = { sql: string; params: unknown[] };

interface SqlStub {
  sql: SqlClient;
  queries: CapturedQuery[];
  /** Queue a SELECT-existing-expenditure row-set (FIFO across bank txs). */
  enqueueExisting: (rows: Array<{ id: string }>) => void;
  /** Queue a SELECT subject_tenant row-set. */
  enqueueSubjectTenant: (rows: Array<{ id: string }>) => void;
  /** Queue an INSERT...RETURNING row-set for the new expenditure. */
  enqueueInsertedExpenditure: (rows: Array<{ id: string }>) => void;
}

function makeSqlStub(): SqlStub {
  const queries: CapturedQuery[] = [];
  const existingQ: Array<Array<{ id: string }>> = [];
  const subjectQ: Array<Array<{ id: string }>> = [];
  const insertedQ: Array<Array<{ id: string }>> = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const sqlText = strings.join('?');
    queries.push({ sql: sqlText, params: values });
    if (sqlText.includes('SELECT id FROM expenditure')) {
      return Promise.resolve(existingQ.shift() ?? []);
    }
    if (sqlText.includes('SELECT id FROM subject_tenant')) {
      return Promise.resolve(subjectQ.shift() ?? []);
    }
    if (sqlText.includes('INSERT INTO expenditure (') && sqlText.includes('RETURNING id')) {
      return Promise.resolve(insertedQ.shift() ?? []);
    }
    return Promise.resolve([]);
  }) as unknown as SqlClient;
  return {
    sql: fn,
    queries,
    enqueueExisting: (rows) => {
      existingQ.push(rows);
    },
    enqueueSubjectTenant: (rows) => {
      subjectQ.push(rows);
    },
    enqueueInsertedExpenditure: (rows) => {
      insertedQ.push(rows);
    },
  };
}

// -- chain stub ------------------------------------------------------------

interface ChainStub {
  insert: ChainInserter;
  calls: Array<{
    tenant_id: string;
    subject_tenant_id: string;
    kind: string;
    payload: unknown;
    captured_by_user_id: string | null;
  }>;
}

function makeChainStub(): ChainStub {
  const calls: ChainStub['calls'] = [];
  // Function returns a Promise but performs no async work — wrapped via
  // Promise.resolve to satisfy the lint rule and the ChainInserter type.
  const insert = ((input: Parameters<ChainInserter>[0]) => {
    calls.push({
      tenant_id: input.tenant_id,
      subject_tenant_id: input.subject_tenant_id,
      kind: input.kind,
      payload: input.payload,
      captured_by_user_id: input.captured_by_user_id,
    });
    return Promise.resolve({
      id: '00000000-0000-4000-8000-eeeeeeeeeeee',
      prev_hash: null,
      hash: 'fakehash',
    });
  }) as ChainInserter;
  return { insert, calls };
}

const conn = (): SyncBankTransactionsConnection => ({
  id: CONNECTION_ID,
  tenant_id: TENANT_ID,
  xero_tenant_id: XERO_TENANT_ID,
  access_token: 'fake-access-token',
});

/**
 * Pre-load row-sets for an INSERT-path bank transaction. The sync
 * function:
 *   1. SELECTs `expenditure` by (tenant, source, source_external_id)
 *      — when treating as NEW, return [].
 *   2. SELECTs `subject_tenant` by tenant_id — return [{ id }].
 *   3. INSERTs into expenditure RETURNING id — return [{ id }].
 */
function queueNewBankTxRows(stub: SqlStub, expenditureId: string): void {
  stub.enqueueExisting([]); // 1. SELECT existing expenditure → empty.
  stub.enqueueSubjectTenant([{ id: SUBJECT_TENANT_ID }]); // 2. SELECT subject_tenant.
  stub.enqueueInsertedExpenditure([{ id: expenditureId }]); // 3. INSERT RETURNING id.
}

function queueExistingBankTxRows(stub: SqlStub, expenditureId: string): void {
  // SELECT existing expenditure → match (UPDATE path; no INSERT/no
  // subject_tenant lookup needed).
  stub.enqueueExisting([{ id: expenditureId }]);
}

beforeEach(() => {
  // Hermetic guard: this suite uses nock at the network layer. Under
  // XERO_IMPL=stub the factory hands sync code the in-process stub which
  // bypasses fetch entirely, so nock matchers never fire and every test
  // fails. Unset the env var before every test so the suite runs
  // identically regardless of whether the developer has XERO_IMPL=stub
  // exported in their shell. (`client-factory.test.ts` deliberately
  // exercises the env var; do NOT add this guard there.)
  delete process.env.XERO_IMPL;
  nock.cleanAll();
});

after(() => {
  nock.cleanAll();
});

// -------------------------------------------------------------------------
// 1. Backfill mode: paginated fetch (mock 2 pages), all SPEND rows mapped.
// -------------------------------------------------------------------------

test('backfill: paginates until short page; all SPEND rows persisted', async () => {
  // Page 1: 100 SPEND rows → triggers page=2 follow-up.
  const page1BankTxs = Array.from({ length: 100 }, (_, i) => ({
    BankTransactionID: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    Type: 'SPEND',
    Status: 'AUTHORISED',
    Date: '/Date(1640995200000+0000)/',
    Contact: { Name: `Vendor ${i}` },
    Reference: `BT-${i}`,
    CurrencyCode: 'AUD',
    Total: '100.00',
    LineItems: [
      { LineItemID: `line-${i}`, Description: 'Item', LineAmount: '100.00', AccountCode: '400' },
    ],
  }));

  // Page 2: short page (< 100), terminates.
  const page2BankTxs = FIXTURE_SPEND;

  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: page1BankTxs });

  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '2', pageSize: '100' })
    .reply(200, { BankTransactions: page2BankTxs });

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();
  // 100 page-1 + 3 page-2 = 103 SPEND rows; all new.
  for (let i = 0; i < 100; i++) {
    queueNewBankTxRows(sqlStub, expUuid(i));
  }
  for (let i = 0; i < 3; i++) {
    queueNewBankTxRows(sqlStub, expUuid(100 + i));
  }

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(result.fetched, 103);
  assert.equal(result.inserted, 103);
  assert.equal(result.updated, 0);
  // page1: 100 bank-txs × 1 line. page2: AWS 2 + Officeworks 2 + Coffee 1 = 5 lines.
  assert.equal(result.lines, 100 + 5);
  assert.equal(result.events_written, 103);
  assert.equal(chainStub.calls.length, 103);
  assert.ok(chainStub.calls.every((c) => c.kind === 'EXPENDITURE_INGESTED'));
});

// -------------------------------------------------------------------------
// 2. Incremental mode: If-Modified-Since header set correctly.
// -------------------------------------------------------------------------

test('incremental: sets If-Modified-Since header and forwards `since` correctly', async () => {
  let capturedIfModified: string | undefined;
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .matchHeader('if-modified-since', (val: string | string[]) => {
      capturedIfModified = Array.isArray(val) ? val[0] : val;
      return true;
    })
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: FIXTURE_SPEND });

  const sqlStub = makeSqlStub();
  for (let i = 0; i < FIXTURE_SPEND.length; i++) {
    queueNewBankTxRows(sqlStub, expUuid(i));
  }
  const chainStub = makeChainStub();

  const since = new Date('2026-04-20T00:00:00Z');
  const result = await syncBankTransactions(conn(), {
    mode: 'incremental',
    since,
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(capturedIfModified, since.toUTCString());
  assert.equal(result.fetched, 3);
  assert.equal(result.inserted, 3);
});

test('incremental: throws if `since` is missing', async () => {
  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();
  await assert.rejects(
    syncBankTransactions(conn(), {
      mode: 'incremental',
      sql_client: sqlStub.sql,
      chain_insert: chainStub.insert,
    }),
    /requires `since`/,
  );
});

// -------------------------------------------------------------------------
// 3. RECEIVE rows filtered out — neither persisted nor counted.
// -------------------------------------------------------------------------

test('RECEIVE rows are filtered out (defensive guard) — only SPEND persisted', async () => {
  // Even if the API filter ever drops, the local `bt.Type !== 'SPEND'`
  // guard keeps RECEIVE bank txs out of expenditure. This test sends the
  // FULL fixture (incl. the RECEIVE row) and asserts only 3 are persisted.
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: FIXTURE.BankTransactions });

  const sqlStub = makeSqlStub();
  for (let i = 0; i < 3; i++) {
    queueNewBankTxRows(sqlStub, expUuid(i));
  }
  const chainStub = makeChainStub();

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(result.fetched, 3, 'RECEIVE must not count toward fetched');
  assert.equal(result.inserted, 3);
  assert.equal(result.events_written, 3);
  // No EXPENDITURE_INGESTED for the RECEIVE row.
  assert.ok(
    chainStub.calls.every((c) => {
      const p = c.payload as { vendor_name: string };
      return p.vendor_name !== 'Customer Pty Ltd';
    }),
    'RECEIVE-side contact must not appear in any event payload',
  );
});

// -------------------------------------------------------------------------
// 4. Idempotency: re-syncing matches existing rows → 0 new events.
// -------------------------------------------------------------------------

test('idempotency: existing rows UPDATE without writing EXPENDITURE_INGESTED', async () => {
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: FIXTURE_SPEND });

  const sqlStub = makeSqlStub();
  // Pre-queue: each bank tx's SELECT returns an existing row (UPDATE path).
  for (let i = 0; i < 3; i++) {
    queueExistingBankTxRows(sqlStub, `existing-exp-${i}`);
  }
  const chainStub = makeChainStub();

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(result.fetched, 3);
  assert.equal(result.inserted, 0, 'no new inserts on re-sync');
  assert.equal(result.updated, 3, '3 UPDATEs');
  assert.equal(result.events_written, 0, 'no chain events on re-sync');
  assert.equal(chainStub.calls.length, 0);

  // Expect: 3 SELECTs + 3 UPDATEs + (3 DELETE + 5 INSERT lines) = 14 queries.
  // Lines: AWS 2 + Officeworks 2 + Coffee 1 = 5 line INSERTs.
  const updates = sqlStub.queries.filter((q) => q.sql.includes('UPDATE expenditure'));
  assert.equal(updates.length, 3);
  const deletes = sqlStub.queries.filter((q) => q.sql.includes('DELETE FROM expenditure_line'));
  assert.equal(deletes.length, 3, 'lines are full-replaced on update');
});

// -------------------------------------------------------------------------
// 5. Non-AUD bank transaction throws a descriptive error.
// -------------------------------------------------------------------------

test('non-AUD bank transaction throws descriptive error before INSERT', async () => {
  const usdBankTx = {
    BankTransactionID: 'usd-bank-tx-1',
    Type: 'SPEND',
    Status: 'AUTHORISED',
    Date: '/Date(1640995200000+0000)/',
    Contact: { Name: 'US Vendor' },
    CurrencyCode: 'USD',
    Total: '100.00',
    LineItems: [],
  };
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: [usdBankTx] });

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();

  await assert.rejects(
    syncBankTransactions(conn(), {
      mode: 'backfill',
      sql_client: sqlStub.sql,
      chain_insert: chainStub.insert,
    }),
    /Non-AUD bank transaction unsupported in P4: tenant=.* bank-tx=usd-bank-tx-1 currency=USD/,
  );
});

// -------------------------------------------------------------------------
// 6. Empty page completes cleanly with 0 inserts.
// -------------------------------------------------------------------------

test('empty response → 0 inserts, 0 events, 0 lines, no DB calls', async () => {
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: [] });

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.deepEqual(result, {
    fetched: 0,
    inserted: 0,
    updated: 0,
    lines: 0,
    events_written: 0,
    inserted_expenditure_ids: [],
  });
  assert.equal(sqlStub.queries.length, 0);
  assert.equal(chainStub.calls.length, 0);
});

test('BankTransactions field omitted entirely → treated as empty page', async () => {
  // Defensive: Xero may return `{}` rather than `{ BankTransactions: [] }`
  // for a 304 / no-content branch (the response we treat as "no changes").
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, {});

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });
  assert.equal(result.fetched, 0);
});

// -------------------------------------------------------------------------
// 7. EXPENDITURE_INGESTED event payload shape matches the schema.
// -------------------------------------------------------------------------

test('EXPENDITURE_INGESTED payload matches ExpenditureIngestedPayload', async () => {
  // Only one fixture bank tx — easier to assert on the exact payload.
  const bt = FIXTURE_SPEND[0]!;
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: [bt] });

  const sqlStub = makeSqlStub();
  const onlyExpId = expUuid(0);
  queueNewBankTxRows(sqlStub, onlyExpId);
  const chainStub = makeChainStub();

  await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(chainStub.calls.length, 1);
  const call = chainStub.calls[0]!;
  assert.equal(call.kind, 'EXPENDITURE_INGESTED');
  assert.equal(call.tenant_id, TENANT_ID);
  assert.equal(call.subject_tenant_id, SUBJECT_TENANT_ID);
  // Sync worker — no human captured.
  assert.equal(call.captured_by_user_id, null);
  assert.deepEqual(call.payload, {
    expenditure_id: onlyExpId,
    source: 'xero_bank_tx',
    vendor_name: 'AWS Australia',
    line_count: 2, // EC2 + S3
  });
});

// -------------------------------------------------------------------------
// 8. SPEND filter applied via the `where` query parameter.
// -------------------------------------------------------------------------

test('uses Xero `where` parameter to filter SPEND at the API layer', async () => {
  let capturedQuery: URLSearchParams | undefined;
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query(true)
    .reply(200, function (uri: string) {
      const u = new URL(`${XERO_API_HOST}${uri}`);
      capturedQuery = u.searchParams;
      return { BankTransactions: [] };
    });

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();
  await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.ok(capturedQuery, 'query captured');
  assert.equal(capturedQuery.get('where'), 'Type=="SPEND"');
  assert.equal(capturedQuery.get('page'), '1');
  assert.equal(capturedQuery.get('pageSize'), '100');
});

// -------------------------------------------------------------------------
// 9. Lines are full-replaced on UPDATE (no orphan lines from prior sync).
// -------------------------------------------------------------------------

test('lines are full-replaced on UPDATE: DELETE then INSERTs', async () => {
  const bt = FIXTURE_SPEND[0]!; // AWS, 2 lines
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: [bt] });

  const sqlStub = makeSqlStub();
  queueExistingBankTxRows(sqlStub, 'existing-aws');
  const chainStub = makeChainStub();

  const result = await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(result.updated, 1);
  assert.equal(result.lines, 2);

  // Order: SELECT, UPDATE, DELETE, INSERT line, INSERT line.
  assert.equal(sqlStub.queries.length, 5);
  assert.ok(sqlStub.queries[0]?.sql.includes('SELECT id FROM expenditure'));
  assert.ok(sqlStub.queries[1]?.sql.includes('UPDATE expenditure'));
  assert.ok(sqlStub.queries[2]?.sql.includes('DELETE FROM expenditure_line'));
  assert.ok(sqlStub.queries[3]?.sql.includes('INSERT INTO expenditure_line'));
  assert.ok(sqlStub.queries[4]?.sql.includes('INSERT INTO expenditure_line'));
});

// -------------------------------------------------------------------------
// 10. Source-external-id matching uses the Xero BankTransactionID verbatim.
// -------------------------------------------------------------------------

test('source_external_id is the Xero BankTransactionID (forwarded as-is)', async () => {
  const bt = FIXTURE_SPEND[1]!; // Officeworks, BankTransactionID '22222222-...'
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, { BankTransactions: [bt] });

  const sqlStub = makeSqlStub();
  queueNewBankTxRows(sqlStub, expUuid(1));
  const chainStub = makeChainStub();
  await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  // SELECT params: [tenant_id, source_external_id]
  const selectQ = sqlStub.queries[0]!;
  assert.ok(selectQ.sql.includes('SELECT id FROM expenditure'));
  assert.equal(selectQ.params[0], TENANT_ID);
  assert.equal(selectQ.params[1], '22222222-2222-4222-8222-222222222222');

  // INSERT params include the same ID at position [3] (after tenant_id,
  // subject_tenant_id are positional in the values clause).
  const insertQ = sqlStub.queries.find((q) => q.sql.includes('INSERT INTO expenditure'));
  assert.ok(insertQ);
  assert.equal(insertQ.params[0], TENANT_ID);
  assert.equal(insertQ.params[1], SUBJECT_TENANT_ID);
  assert.equal(insertQ.params[2], '22222222-2222-4222-8222-222222222222');
});

// -------------------------------------------------------------------------
// 11. Backfill sends NO If-Modified-Since header.
// -------------------------------------------------------------------------

test('backfill: no If-Modified-Since header is sent', async () => {
  let sawIfModified = false;
  nock(XERO_API_HOST)
    .get(`${XERO_API_PATH}/BankTransactions`)
    .query({ where: 'Type=="SPEND"', page: '1', pageSize: '100' })
    .reply(200, function () {
      // `this.req.headers` exists on the nock `this` context; fall back
      // to a header-matcher style by checking the request rather than
      // the matchHeader negation (nock has no matchHeader.absent helper).
      const headers = (this as unknown as { req: { headers: Record<string, string> } }).req.headers;
      sawIfModified = 'if-modified-since' in headers;
      return { BankTransactions: [] };
    });

  const sqlStub = makeSqlStub();
  const chainStub = makeChainStub();
  await syncBankTransactions(conn(), {
    mode: 'backfill',
    sql_client: sqlStub.sql,
    chain_insert: chainStub.insert,
  });

  assert.equal(sawIfModified, false, 'backfill must not send If-Modified-Since');
});
