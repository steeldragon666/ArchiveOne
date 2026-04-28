import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runXeroAccountingSyncForAllConnections,
  registerXeroAccountingSyncJob,
  XERO_ACCOUNTING_SYNC_JOB_NAME,
  XERO_ACCOUNTING_SYNC_CADENCE,
  type XeroAccountingSyncDeps,
  type PgBossLike,
} from './xero-accounting-sync.js';

const CONN_A = '00000000-0000-4000-8000-000000000b61';
const CONN_B = '00000000-0000-4000-8000-000000000b62';
const TENANT_A = '00000000-0000-4000-8000-000000000ba1';
const TENANT_B = '00000000-0000-4000-8000-000000000ba2';
const FUTURE_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000); // +1h

/**
 * The orchestrator emits these template-tag SQL calls per connection
 * (assuming success path):
 *   SELECT integration_connection            (× 1, top of run)
 *   SELECT pg_try_advisory_lock              (× 1, per connection)
 *   UPDATE sync_state='syncing'              (× 1, per connection)
 *   UPDATE sync_state='idle' (or 'failed')   (× 1, per connection)
 *   SELECT pg_advisory_unlock                (× 1, per connection)
 *
 * The stub routes by SQL substring + returns canned rows. `lock_results`
 * lets a test set the boolean returned by pg_try_advisory_lock per call
 * so the lock-held branch is exercisable. `update_calls` records every
 * UPDATE so the success/fail transitions can be asserted.
 */
type ConnectionRow = {
  id: string;
  tenant_id: string;
  access_token_encrypted: string;
  external_account_id: string | null;
  last_synced_at: Date | null;
  expires_at: Date | null;
};

type StubConfig = {
  connections: ConnectionRow[];
  /** Sequential booleans returned by pg_try_advisory_lock; defaults to true. */
  lock_results?: boolean[];
};

function makeSqlStub(cfg: StubConfig): {
  sql: NonNullable<XeroAccountingSyncDeps['sql_client']>;
  update_calls: Array<{ sql: string; params: unknown[]; conn_id?: string }>;
  lock_calls: number;
  unlock_calls: number;
} {
  const update_calls: Array<{ sql: string; params: unknown[]; conn_id?: string }> = [];
  let lockIdx = 0;
  let lockCalls = 0;
  let unlockCalls = 0;
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const rendered = strings.join('?');
    if (rendered.includes('pg_try_advisory_lock')) {
      const acquired = cfg.lock_results?.[lockIdx] ?? true;
      lockIdx += 1;
      lockCalls += 1;
      return Promise.resolve([{ acquired }]);
    }
    if (rendered.includes('pg_advisory_unlock')) {
      unlockCalls += 1;
      return Promise.resolve([{ pg_advisory_unlock: true }]);
    }
    if (rendered.includes('UPDATE integration_connection')) {
      // Conn id is the LAST param (WHERE id = $N at the tail).
      const conn_id = values[values.length - 1];
      update_calls.push({
        sql: rendered,
        params: values,
        conn_id: typeof conn_id === 'string' ? conn_id : undefined,
      });
      return Promise.resolve([]);
    }
    if (rendered.includes('FROM integration_connection')) {
      return Promise.resolve(cfg.connections);
    }
    return Promise.resolve([]);
  }) as unknown as NonNullable<XeroAccountingSyncDeps['sql_client']>;
  return {
    sql: fn,
    update_calls,
    get lock_calls(): number {
      return lockCalls;
    },
    get unlock_calls(): number {
      return unlockCalls;
    },
  };
}

const baseDeps = (
  cfg: StubConfig,
  overrides: Partial<XeroAccountingSyncDeps> = {},
): {
  deps: XeroAccountingSyncDeps;
  update_calls: Array<{ sql: string; params: unknown[]; conn_id?: string }>;
  stub: ReturnType<typeof makeSqlStub>;
} => {
  const stub = makeSqlStub(cfg);
  const deps: XeroAccountingSyncDeps = {
    sql_client: stub.sql,
    decrypt: () => 'decrypted-access-token',
    get_encryption_key: () => 'fake-key',
    sync_invoices: () =>
      Promise.resolve({ fetched: 0, inserted: 0, updated: 0, lines: 0, events_written: 0 }),
    sync_bank_transactions: () =>
      Promise.resolve({ fetched: 0, inserted: 0, updated: 0, lines: 0, events_written: 0 }),
    sync_receipts: () =>
      Promise.resolve({
        fetched: 0,
        inserted: 0,
        updated: 0,
        lines: 0,
        events_written: 0,
        reimbursee_matched: 0,
      }),
    sync_contacts: () => Promise.resolve({ fetched: 0, inserted: 0, updated: 0 }),
    sync_accounts: () => Promise.resolve({ fetched: 0, inserted: 0, updated: 0 }),
    ...overrides,
  };
  return { deps, update_calls: stub.update_calls, stub };
};

const baseConn = (id: string, tenant: string, last_synced_at: Date | null): ConnectionRow => ({
  id,
  tenant_id: tenant,
  access_token_encrypted: 'enc.blob',
  external_account_id: 'xero-org-' + id.slice(-4),
  last_synced_at,
  expires_at: FUTURE_EXPIRES_AT,
});

test('XERO_ACCOUNTING_SYNC_CADENCE is "*/15 * * * *" (every 15 minutes)', () => {
  assert.equal(XERO_ACCOUNTING_SYNC_CADENCE, '*/15 * * * *');
  assert.equal(XERO_ACCOUNTING_SYNC_JOB_NAME, 'xero-accounting-sync');
});

test('runs all 5 sync functions in sequence per connection (success path)', async () => {
  const calls: string[] = [];
  const { deps, update_calls } = baseDeps(
    { connections: [baseConn(CONN_A, TENANT_A, null)] },
    {
      sync_invoices: () => {
        calls.push('invoices');
        return Promise.resolve({
          fetched: 1,
          inserted: 1,
          updated: 0,
          lines: 1,
          events_written: 1,
        });
      },
      sync_bank_transactions: () => {
        calls.push('bank_tx');
        return Promise.resolve({
          fetched: 2,
          inserted: 2,
          updated: 0,
          lines: 2,
          events_written: 2,
        });
      },
      sync_receipts: () => {
        calls.push('receipts');
        return Promise.resolve({
          fetched: 3,
          inserted: 3,
          updated: 0,
          lines: 3,
          events_written: 3,
          reimbursee_matched: 1,
        });
      },
      sync_contacts: () => {
        calls.push('contacts');
        return Promise.resolve({ fetched: 4, inserted: 4, updated: 0 });
      },
      sync_accounts: () => {
        calls.push('accounts');
        return Promise.resolve({ fetched: 5, inserted: 5, updated: 0 });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.deepEqual(calls, ['invoices', 'bank_tx', 'receipts', 'contacts', 'accounts']);
  assert.equal(result.matched, 1);
  assert.equal(result.ran, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 0);
  const r0 = result.per_connection[0]!;
  assert.equal(r0.invoices?.inserted, 1);
  assert.equal(r0.bank_transactions?.inserted, 2);
  assert.equal(r0.receipts?.inserted, 3);
  assert.equal(r0.contacts?.inserted, 4);
  assert.equal(r0.accounts?.inserted, 5);

  // 2 UPDATEs: 'syncing' then 'idle' with last_synced_at.
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[0]!.sql.includes("sync_state = 'syncing'"));
  assert.ok(update_calls[1]!.sql.includes("sync_state = 'idle'"));
  assert.ok(update_calls[1]!.sql.includes('last_synced_at = NOW()'));
});

test('skips connection when advisory lock is held by another worker', async () => {
  let invoicesCalled = false;
  const { deps, update_calls, stub } = baseDeps(
    {
      connections: [baseConn(CONN_A, TENANT_A, null)],
      lock_results: [false],
    },
    {
      sync_invoices: () => {
        invoicesCalled = true;
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(invoicesCalled, false);
  assert.equal(result.matched, 1);
  assert.equal(result.ran, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.per_connection[0]!.ran, false);
  assert.equal(result.per_connection[0]!.skipped_reason, 'lock_held');
  // No UPDATE issued — we skipped before the syncing transition. No
  // unlock either (lock was never acquired).
  assert.equal(update_calls.length, 0);
  assert.equal(stub.unlock_calls, 0);
  // Lock attempt was made.
  assert.equal(stub.lock_calls, 1);
});

test('uses backfill mode on first run (no last_synced_at)', async () => {
  let observedMode: string | undefined;
  let observedSince: Date | undefined;
  const { deps } = baseDeps(
    { connections: [baseConn(CONN_A, TENANT_A, null)] },
    {
      sync_invoices: (_conn, opts) => {
        observedMode = opts.mode;
        observedSince = opts.since;
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(observedMode, 'backfill');
  assert.equal(observedSince, undefined);
  assert.equal(result.per_connection[0]!.mode, 'backfill');
});

test('uses incremental mode with since=last_synced_at on subsequent runs', async () => {
  const previousSync = new Date('2026-04-25T00:00:00Z');
  const observed: Array<{ mode: string; since: Date | undefined }> = [];
  const captureMode =
    <T>(rv: T) =>
    (_c: unknown, opts: { mode: string; since?: Date }) => {
      observed.push({ mode: opts.mode, since: opts.since });
      return Promise.resolve(rv);
    };
  const { deps } = baseDeps(
    { connections: [baseConn(CONN_A, TENANT_A, previousSync)] },
    {
      sync_invoices: captureMode({
        fetched: 0,
        inserted: 0,
        updated: 0,
        lines: 0,
        events_written: 0,
      }),
      sync_bank_transactions: captureMode({
        fetched: 0,
        inserted: 0,
        updated: 0,
        lines: 0,
        events_written: 0,
      }),
      sync_receipts: captureMode({
        fetched: 0,
        inserted: 0,
        updated: 0,
        lines: 0,
        events_written: 0,
        reimbursee_matched: 0,
      }),
      sync_contacts: captureMode({ fetched: 0, inserted: 0, updated: 0 }),
      sync_accounts: captureMode({ fetched: 0, inserted: 0, updated: 0 }),
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(observed.length, 5);
  for (const o of observed) {
    assert.equal(o.mode, 'incremental');
    assert.equal(o.since?.toISOString(), previousSync.toISOString());
  }
  assert.equal(result.per_connection[0]!.mode, 'incremental');
});

test('updates last_synced_at only after all 5 syncs succeed', async () => {
  // Simulate the 3rd sync (receipts) throwing. last_synced_at must NOT
  // be updated; sync_state must be 'failed' with last_error set; the
  // 4th + 5th syncs must NOT run.
  let contactsCalled = false;
  let accountsCalled = false;
  const { deps, update_calls } = baseDeps(
    { connections: [baseConn(CONN_A, TENANT_A, null)] },
    {
      sync_receipts: () => Promise.reject(new Error('xero 503 throttle')),
      sync_contacts: () => {
        contactsCalled = true;
        return Promise.resolve({ fetched: 0, inserted: 0, updated: 0 });
      },
      sync_accounts: () => {
        accountsCalled = true;
        return Promise.resolve({ fetched: 0, inserted: 0, updated: 0 });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(contactsCalled, false);
  assert.equal(accountsCalled, false);
  assert.equal(result.failed, 1);
  assert.equal(result.ran, 0);
  assert.equal(result.per_connection[0]!.error, 'xero 503 throttle');

  // 2 UPDATEs: 'syncing' then 'failed' (NOT 'idle' / NOT last_synced_at).
  assert.equal(update_calls.length, 2);
  assert.ok(update_calls[0]!.sql.includes("sync_state = 'syncing'"));
  assert.ok(update_calls[1]!.sql.includes("sync_state = 'failed'"));
  assert.ok(!update_calls[1]!.sql.includes('last_synced_at = NOW()'));
  assert.equal(update_calls[1]!.params[0], 'xero 503 throttle');
});

test('processes multiple connections in sequence (matched=2, ran=2)', async () => {
  const callOrder: string[] = [];
  const { deps, update_calls } = baseDeps(
    {
      connections: [baseConn(CONN_A, TENANT_A, null), baseConn(CONN_B, TENANT_B, null)],
    },
    {
      sync_invoices: (conn) => {
        callOrder.push(`invoices:${conn.id}`);
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
      sync_accounts: (conn) => {
        callOrder.push(`accounts:${conn.id}`);
        return Promise.resolve({ fetched: 0, inserted: 0, updated: 0 });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(result.matched, 2);
  assert.equal(result.ran, 2);
  assert.equal(result.failed, 0);
  // CONN_A invoices runs before CONN_A accounts; CONN_A accounts (the
  // 5th sync) runs before CONN_B invoices (per-connection sequential).
  assert.deepEqual(callOrder, [
    `invoices:${CONN_A}`,
    `accounts:${CONN_A}`,
    `invoices:${CONN_B}`,
    `accounts:${CONN_B}`,
  ]);
  // 2 UPDATEs per connection × 2 connections = 4.
  assert.equal(update_calls.length, 4);
  // Both connections finished with 'idle'.
  const idleUpdates = update_calls.filter((c) => c.sql.includes("sync_state = 'idle'"));
  assert.equal(idleUpdates.length, 2);
});

test('exits gracefully with matched=0/ran=0 when no connections match', async () => {
  let invoicesCalled = false;
  const { deps, update_calls, stub } = baseDeps(
    { connections: [] },
    {
      sync_invoices: () => {
        invoicesCalled = true;
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(invoicesCalled, false);
  assert.equal(result.matched, 0);
  assert.equal(result.ran, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.per_connection, []);
  assert.equal(update_calls.length, 0);
  assert.equal(stub.lock_calls, 0);
  assert.equal(stub.unlock_calls, 0);
});

test('expired access token → sync_state=failed, no sync calls', async () => {
  let invoicesCalled = false;
  const expired = new Date(Date.now() - 60_000);
  const { deps, update_calls } = baseDeps(
    {
      connections: [
        {
          id: CONN_A,
          tenant_id: TENANT_A,
          access_token_encrypted: 'enc.blob',
          external_account_id: 'xero-org-foo',
          last_synced_at: null,
          expires_at: expired,
        },
      ],
    },
    {
      sync_invoices: () => {
        invoicesCalled = true;
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(invoicesCalled, false);
  assert.equal(result.failed, 1);
  assert.match(result.per_connection[0]!.error ?? '', /access token expired/);
  // Single UPDATE — straight to 'failed' (no 'syncing' step).
  assert.equal(update_calls.length, 1);
  assert.ok(update_calls[0]!.sql.includes("sync_state = 'failed'"));
});

test('missing external_account_id → sync_state=failed without calling sync functions', async () => {
  let invoicesCalled = false;
  const { deps, update_calls } = baseDeps(
    {
      connections: [
        {
          id: CONN_A,
          tenant_id: TENANT_A,
          access_token_encrypted: 'enc.blob',
          external_account_id: null,
          last_synced_at: null,
          expires_at: FUTURE_EXPIRES_AT,
        },
      ],
    },
    {
      sync_invoices: () => {
        invoicesCalled = true;
        return Promise.resolve({
          fetched: 0,
          inserted: 0,
          updated: 0,
          lines: 0,
          events_written: 0,
        });
      },
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(invoicesCalled, false);
  assert.equal(result.failed, 1);
  assert.match(result.per_connection[0]!.error ?? '', /xero_tenant_id/);
  // Single UPDATE — straight to 'failed'.
  assert.equal(update_calls.length, 1);
  assert.ok(update_calls[0]!.sql.includes("sync_state = 'failed'"));
});

test('registerXeroAccountingSyncJob wires schedule + work with the right cron', async () => {
  const calls: Array<{ kind: 'schedule' | 'work'; name: string; cron?: string }> = [];
  const boss: PgBossLike = {
    schedule: (name, cron): Promise<void> => {
      calls.push({ kind: 'schedule', name, cron });
      return Promise.resolve();
    },
    work: <T>(name: string, _handler: (job: { data: T }) => unknown): Promise<string> => {
      calls.push({ kind: 'work', name });
      return Promise.resolve('worker-id-stub');
    },
  };

  await registerXeroAccountingSyncJob(boss);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    kind: 'schedule',
    name: 'xero-accounting-sync',
    cron: '*/15 * * * *',
  });
  assert.equal(calls[1]!.kind, 'work');
  assert.equal(calls[1]!.name, 'xero-accounting-sync');
});

test('advisory lock is released after sync (try/finally)', async () => {
  // Even when the per-connection sync THROWS internally (caught by the
  // try/catch in runOneConnection — produces an error-tagged result),
  // the orchestrator's outer try/finally must still unlock.
  const { deps, stub } = baseDeps(
    { connections: [baseConn(CONN_A, TENANT_A, null)] },
    {
      sync_invoices: () => Promise.reject(new Error('boom')),
    },
  );

  const result = await runXeroAccountingSyncForAllConnections(deps);
  assert.equal(result.failed, 1);
  // Lock acquired (1) and released (1).
  assert.equal(stub.lock_calls, 1);
  assert.equal(stub.unlock_calls, 1);
});
