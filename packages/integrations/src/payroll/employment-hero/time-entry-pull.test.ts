import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { pullTimesheets } from './time-entry-pull.js';
import type { SqlClient } from './employee-sync.js';

const ORG_ID = 'org-eh-ts';
const TENANT_ID = '00000000-0000-4000-8000-000000000bA1';
const SUBJECT_ID = '00000000-0000-4000-8000-000000000bA2';

/**
 * pullTimesheets issues two query shapes per timesheet:
 *   1. SELECT id FROM subject_tenant_employee … → returns a row when the
 *      employee is known, empty when unmatched.
 *   2. INSERT … ON CONFLICT … RETURNING (xmax = 0) AS inserted → returns
 *      `[{ inserted: true }]` for new rows, `[{ inserted: false }]` for
 *      conflict-driven updates.
 *
 * The stub looks at the rendered SQL string to route each call to the
 * appropriate canned response.
 */
type StubConfig = {
  /** Map of EH employee_id → local subject_tenant_employee.id. Missing keys → unmatched. */
  employee_lookup: Record<string, string>;
  /** Map of EH timesheet id → whether the upsert should report inserted=true. */
  upsert_inserted: Record<string, boolean>;
};

type CapturedQuery = { sql: string; params: unknown[] };

function makeSqlStub(cfg: StubConfig): { sql: SqlClient; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const rendered = strings.join('?');
    queries.push({ sql: rendered, params: values });
    if (rendered.includes('SELECT id FROM subject_tenant_employee')) {
      // params: [subject_tenant_id, payroll_external_id]
      const ehId = values[1] as string;
      const localId = cfg.employee_lookup[ehId];
      return Promise.resolve(localId ? [{ id: localId }] : []);
    }
    if (rendered.includes('INSERT INTO time_entry')) {
      // The 'employment_hero' source is a string literal in the SQL, so the
      // tagged-template values are: [tenant_id, subject_tenant_id, employee_id,
      // external_id (= t.id), start_time, end_time, duration_minutes, is_rd, notes].
      const externalId = values[3] as string;
      const inserted = cfg.upsert_inserted[externalId] ?? true;
      return Promise.resolve([{ inserted }]);
    }
    return Promise.resolve([]);
  }) as unknown as SqlClient;
  return { sql: fn, queries };
}

beforeEach(() => {
  nock.cleanAll();
});

after(() => {
  nock.cleanAll();
});

test('pullTimesheets: 3 new timesheets → inserted=3, updated=0, skipped=0', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, {
      data: [
        {
          id: 'ts-1',
          employee_id: 'eh-emp-1',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
        {
          id: 'ts-2',
          employee_id: 'eh-emp-1',
          date: '2026-04-26',
          start_time: '2026-04-26T09:00:00Z',
          end_time: '2026-04-26T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
        {
          id: 'ts-3',
          employee_id: 'eh-emp-2',
          date: '2026-04-25',
          start_time: '2026-04-25T10:00:00Z',
          end_time: '2026-04-25T16:00:00Z',
          duration_minutes: 360,
          status: 'submitted',
          notes: 'lab work',
        },
      ],
    });

  const { sql, queries } = makeSqlStub({
    employee_lookup: {
      'eh-emp-1': 'local-emp-1',
      'eh-emp-2': 'local-emp-2',
    },
    upsert_inserted: { 'ts-1': true, 'ts-2': true, 'ts-3': true },
  });

  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 3);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped_unmatched, 0);
  // 3 SELECTs + 3 INSERTs = 6 queries total.
  assert.equal(queries.length, 6);
});

test('pullTimesheets: existing row → updated=1', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, {
      data: [
        {
          id: 'ts-existing',
          employee_id: 'eh-emp-1',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
      ],
    });

  const { sql } = makeSqlStub({
    employee_lookup: { 'eh-emp-1': 'local-emp-1' },
    upsert_inserted: { 'ts-existing': false },
  });

  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped_unmatched, 0);
});

test('pullTimesheets: unknown employee → skipped_unmatched=1, no INSERT issued', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, {
      data: [
        {
          id: 'ts-orphan',
          employee_id: 'eh-emp-orphan',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
      ],
    });

  const { sql, queries } = makeSqlStub({
    employee_lookup: {}, // empty — orphan
    upsert_inserted: {},
  });

  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped_unmatched, 1);
  // Only the SELECT — no INSERT for the orphan.
  assert.equal(queries.length, 1);
  assert.ok(queries[0]?.sql.includes('SELECT id FROM subject_tenant_employee'));
});

test('pullTimesheets: pagination — visits both pages', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, {
      data: [
        {
          id: 'ts-p1-1',
          employee_id: 'eh-emp-1',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
      ],
      meta: { next_cursor: 'cur-p2' },
    });
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .query({ cursor: 'cur-p2' })
    .reply(200, {
      data: [
        {
          id: 'ts-p2-1',
          employee_id: 'eh-emp-1',
          date: '2026-04-26',
          start_time: '2026-04-26T09:00:00Z',
          end_time: '2026-04-26T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
      ],
    });

  const { sql } = makeSqlStub({
    employee_lookup: { 'eh-emp-1': 'local-emp-1' },
    upsert_inserted: { 'ts-p1-1': true, 'ts-p2-1': true },
  });

  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 2);
});

test('pullTimesheets: mixed — 1 new + 1 existing + 1 orphan', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, {
      data: [
        {
          id: 'ts-new',
          employee_id: 'eh-emp-1',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
        {
          id: 'ts-existing',
          employee_id: 'eh-emp-1',
          date: '2026-04-26',
          start_time: '2026-04-26T09:00:00Z',
          end_time: '2026-04-26T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
        {
          id: 'ts-orphan',
          employee_id: 'eh-emp-missing',
          date: '2026-04-25',
          start_time: '2026-04-25T09:00:00Z',
          end_time: '2026-04-25T17:00:00Z',
          duration_minutes: 480,
          status: 'approved',
        },
      ],
    });

  const { sql } = makeSqlStub({
    employee_lookup: { 'eh-emp-1': 'local-emp-1' },
    upsert_inserted: { 'ts-new': true, 'ts-existing': false },
  });

  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped_unmatched, 1);
});

test('pullTimesheets: empty page → all counts zero', async () => {
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .reply(200, { data: [] });

  const { sql, queries } = makeSqlStub({ employee_lookup: {}, upsert_inserted: {} });
  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    sql_client: sql,
  });

  assert.equal(result.inserted, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped_unmatched, 0);
  assert.equal(queries.length, 0);
});

test('pullTimesheets: forwards changed_since + date filters to EH', async () => {
  const since = new Date('2026-04-20T00:00:00Z');
  const from = new Date('2026-04-01T00:00:00Z');
  const to = new Date('2026-04-30T23:59:59Z');
  nock('https://api.employmenthero.com')
    .get(`/api/v1/organisations/${ORG_ID}/timesheets`)
    .query({
      updated_after: since.toISOString(),
      from_date: '2026-04-01',
      to_date: '2026-04-30',
    })
    .reply(200, { data: [] });

  const { sql } = makeSqlStub({ employee_lookup: {}, upsert_inserted: {} });
  const result = await pullTimesheets({
    access_token: 'fake',
    organisation_id: ORG_ID,
    tenant_id: TENANT_ID,
    subject_tenant_id: SUBJECT_ID,
    changed_since: since,
    from_date: from,
    to_date: to,
    sql_client: sql,
  });
  assert.equal(result.inserted, 0);
});
