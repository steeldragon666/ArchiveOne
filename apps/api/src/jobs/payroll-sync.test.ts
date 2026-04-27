import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncEmploymentHero, type PayrollSyncDeps } from './payroll-sync.js';

const CONNECTION_ID = '00000000-0000-4000-8000-000000000bb1';
const TENANT_ID = '00000000-0000-4000-8000-000000000bb2';
const SUBJECT_ID = '00000000-0000-4000-8000-000000000bb3';
const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000bb4';

/**
 * The orchestrator chains five SQL operations:
 *   SELECT integration_connection
 *   UPDATE sync_state='syncing'        (or branch to fail-fast)
 *   SELECT subject_tenant
 *   SELECT tenant_user (admin)
 *   UPDATE sync_state='idle' / 'failed'
 *
 * The stub routes by SQL substring and returns canned rows so we can
 * exercise the success and failure branches without real Postgres.
 *
 * `update_calls` records every UPDATE issued so the test can assert
 * that 'syncing' → 'idle' (or 'failed') transitions actually fire.
 */
type StubRows = {
  integration_connection?: Array<{
    tenant_id: string;
    access_token_encrypted: string;
    external_account_id: string | null;
    last_synced_at: Date | null;
  }>;
  subject_tenant?: Array<{ id: string }>;
  tenant_user?: Array<{ user_id: string }>;
};

function makeSqlStub(rows: StubRows): {
  sql: PayrollSyncDeps['sql_client'];
  update_calls: Array<{ sql: string; params: unknown[] }>;
} {
  const update_calls: Array<{ sql: string; params: unknown[] }> = [];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const rendered = strings.join('?');
    if (rendered.includes('UPDATE integration_connection')) {
      update_calls.push({ sql: rendered, params: values });
      return Promise.resolve([]);
    }
    if (rendered.includes('FROM integration_connection')) {
      return Promise.resolve(rows.integration_connection ?? []);
    }
    if (rendered.includes('FROM subject_tenant')) {
      return Promise.resolve(rows.subject_tenant ?? []);
    }
    if (rendered.includes('FROM tenant_user')) {
      return Promise.resolve(rows.tenant_user ?? []);
    }
    return Promise.resolve([]);
  }) as unknown as PayrollSyncDeps['sql_client'];
  return { sql: fn, update_calls };
}

const baseDeps = (
  rows: StubRows,
  overrides: Partial<PayrollSyncDeps> = {},
): { deps: PayrollSyncDeps; update_calls: Array<{ sql: string; params: unknown[] }> } => {
  const { sql, update_calls } = makeSqlStub(rows);
  const deps: PayrollSyncDeps = {
    sql_client: sql,
    decrypt: () => 'decrypted-access-token',
    get_encryption_key: () => 'fake-key',
    sync_employees: () => Promise.resolve({ upserted: 0, deactivated: 0 }),
    pull_timesheets: () =>
      Promise.resolve({ inserted: 0, updated: 0, skipped_unmatched: 0 }),
    ...overrides,
  };
  return { deps, update_calls };
};

test('syncEmploymentHero: success path → idle + last_synced_at + counts surfaced', async () => {
  const { deps, update_calls } = baseDeps(
    {
      integration_connection: [
        {
          tenant_id: TENANT_ID,
          access_token_encrypted: 'enc.blob',
          external_account_id: 'eh-org-001',
          last_synced_at: null,
        },
      ],
      subject_tenant: [{ id: SUBJECT_ID }],
      tenant_user: [{ user_id: ADMIN_USER_ID }],
    },
    {
      sync_employees: () => Promise.resolve({ upserted: 5, deactivated: 1 }),
      pull_timesheets: () =>
        Promise.resolve({ inserted: 12, updated: 3, skipped_unmatched: 2 }),
    },
  );

  const result = await syncEmploymentHero(CONNECTION_ID, deps);

  assert.equal(result.tenant_id, TENANT_ID);
  assert.equal(result.provider, 'employment_hero');
  assert.equal(result.employees.upserted, 5);
  assert.equal(result.employees.deactivated, 1);
  assert.equal(result.timesheets.inserted, 12);
  assert.equal(result.timesheets.updated, 3);
  assert.equal(result.timesheets.skipped_unmatched, 2);
  assert.equal(result.error, undefined);

  // 2 UPDATEs: 'syncing' followed by 'idle' (with last_synced_at).
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[0]?.sql.includes("sync_state = 'syncing'"));
  assert.ok(update_calls[1]?.sql.includes("sync_state = 'idle'"));
  assert.ok(update_calls[1]?.sql.includes('last_synced_at = NOW()'));
});

test('syncEmploymentHero: forwards changed_since when last_synced_at is set', async () => {
  const previousSync = new Date('2026-04-25T00:00:00Z');
  let observedChangedSince: Date | undefined;
  const { deps } = baseDeps(
    {
      integration_connection: [
        {
          tenant_id: TENANT_ID,
          access_token_encrypted: 'enc.blob',
          external_account_id: 'eh-org-001',
          last_synced_at: previousSync,
        },
      ],
      subject_tenant: [{ id: SUBJECT_ID }],
      tenant_user: [{ user_id: ADMIN_USER_ID }],
    },
    {
      sync_employees: (opts) => {
        observedChangedSince = opts.changed_since;
        return Promise.resolve({ upserted: 0, deactivated: 0 });
      },
    },
  );

  await syncEmploymentHero(CONNECTION_ID, deps);
  assert.equal(observedChangedSince?.toISOString(), previousSync.toISOString());
});

test('syncEmploymentHero: decrypt failure → sync_state=failed + last_error set', async () => {
  const { deps, update_calls } = baseDeps(
    {
      integration_connection: [
        {
          tenant_id: TENANT_ID,
          access_token_encrypted: 'enc.blob',
          external_account_id: 'eh-org-001',
          last_synced_at: null,
        },
      ],
      subject_tenant: [{ id: SUBJECT_ID }],
      tenant_user: [{ user_id: ADMIN_USER_ID }],
    },
    {
      decrypt: () => {
        throw new Error('malformed encrypted token');
      },
    },
  );

  const result = await syncEmploymentHero(CONNECTION_ID, deps);

  assert.equal(result.error, 'malformed encrypted token');
  assert.equal(result.employees.upserted, 0);
  assert.equal(result.timesheets.inserted, 0);

  // 'syncing' then 'failed'.
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[0]?.sql.includes("sync_state = 'syncing'"));
  assert.ok(update_calls[1]?.sql.includes("sync_state = 'failed'"));
  assert.ok(update_calls[1]?.sql.includes('last_error'));
  assert.equal(update_calls[1]?.params[0], 'malformed encrypted token');
});

test('syncEmploymentHero: no subject_tenant → sync fails with descriptive error', async () => {
  const { deps, update_calls } = baseDeps({
    integration_connection: [
      {
        tenant_id: TENANT_ID,
        access_token_encrypted: 'enc.blob',
        external_account_id: 'eh-org-001',
        last_synced_at: null,
      },
    ],
    subject_tenant: [], // none
    tenant_user: [{ user_id: ADMIN_USER_ID }],
  });

  const result = await syncEmploymentHero(CONNECTION_ID, deps);
  assert.equal(result.error, 'no subject_tenant for this connection');
  // 'syncing' then 'failed'.
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[1]?.sql.includes("sync_state = 'failed'"));
});

test('syncEmploymentHero: no admin user → sync fails', async () => {
  const { deps, update_calls } = baseDeps({
    integration_connection: [
      {
        tenant_id: TENANT_ID,
        access_token_encrypted: 'enc.blob',
        external_account_id: 'eh-org-001',
        last_synced_at: null,
      },
    ],
    subject_tenant: [{ id: SUBJECT_ID }],
    tenant_user: [], // none
  });

  const result = await syncEmploymentHero(CONNECTION_ID, deps);
  assert.equal(result.error, 'no admin user for this connection');
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[1]?.sql.includes("sync_state = 'failed'"));
});

test('syncEmploymentHero: missing connection row → throws', async () => {
  const { deps } = baseDeps({ integration_connection: [] });
  await assert.rejects(
    syncEmploymentHero(CONNECTION_ID, deps),
    /integration_connection not found or failed/,
  );
});

test('syncEmploymentHero: missing external_account_id → fails fast without calling sub-functions', async () => {
  let employeesCalled = false;
  let timesheetsCalled = false;
  const { deps, update_calls } = baseDeps(
    {
      integration_connection: [
        {
          tenant_id: TENANT_ID,
          access_token_encrypted: 'enc.blob',
          external_account_id: null,
          last_synced_at: null,
        },
      ],
    },
    {
      sync_employees: () => {
        employeesCalled = true;
        return Promise.resolve({ upserted: 0, deactivated: 0 });
      },
      pull_timesheets: () => {
        timesheetsCalled = true;
        return Promise.resolve({ inserted: 0, updated: 0, skipped_unmatched: 0 });
      },
    },
  );

  const result = await syncEmploymentHero(CONNECTION_ID, deps);
  assert.match(result.error ?? '', /external_account_id/);
  assert.equal(employeesCalled, false);
  assert.equal(timesheetsCalled, false);
  // Single UPDATE flipping straight to 'failed' (no 'syncing' step).
  assert.equal(update_calls.length, 1);
  assert.ok(update_calls[0]?.sql.includes("sync_state = 'failed'"));
});

test('syncEmploymentHero: pulls call sub-functions with correct shared opts', async () => {
  let observedSyncOpts: Parameters<NonNullable<PayrollSyncDeps['sync_employees']>>[0] | null = null;
  let observedPullOpts: Parameters<NonNullable<PayrollSyncDeps['pull_timesheets']>>[0] | null = null;
  const { deps } = baseDeps(
    {
      integration_connection: [
        {
          tenant_id: TENANT_ID,
          access_token_encrypted: 'enc.blob',
          external_account_id: 'eh-org-001',
          last_synced_at: null,
        },
      ],
      subject_tenant: [{ id: SUBJECT_ID }],
      tenant_user: [{ user_id: ADMIN_USER_ID }],
    },
    {
      sync_employees: (opts) => {
        observedSyncOpts = opts;
        return Promise.resolve({ upserted: 0, deactivated: 0 });
      },
      pull_timesheets: (opts) => {
        observedPullOpts = opts;
        return Promise.resolve({ inserted: 0, updated: 0, skipped_unmatched: 0 });
      },
    },
  );

  await syncEmploymentHero(CONNECTION_ID, deps);
  assert.ok(observedSyncOpts);
  assert.ok(observedPullOpts);
  assert.equal(observedSyncOpts.access_token, 'decrypted-access-token');
  assert.equal(observedSyncOpts.organisation_id, 'eh-org-001');
  assert.equal(observedSyncOpts.tenant_id, TENANT_ID);
  assert.equal(observedSyncOpts.subject_tenant_id, SUBJECT_ID);
  assert.equal(observedSyncOpts.invited_by_user_id, ADMIN_USER_ID);
  assert.equal(observedPullOpts.access_token, 'decrypted-access-token');
  assert.equal(observedPullOpts.organisation_id, 'eh-org-001');
});
