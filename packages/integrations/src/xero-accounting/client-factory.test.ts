import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createXeroAccountingGet, type XeroAccountingGet } from './client-factory.js';
import { xeroAccountingGet, type XeroAccountingClientOptions } from './client.js';
import { xeroAccountingGetStub } from './stub-client.js';

/**
 * B7 client-factory tests.
 *
 * The factory inspects `process.env.XERO_IMPL` and returns either the
 * real `xeroAccountingGet` or the deterministic `xeroAccountingGetStub`.
 * Tests below mutate `process.env.XERO_IMPL` and assert the right
 * implementation comes back, plus exercise the stub's fixture-load and
 * since= filter behaviour.
 */

const TENANT_ID = '00000000-0000-4000-8000-0000000000b7';
const opts = (): XeroAccountingClientOptions => ({
  access_token: 'fake-stub-token',
  xero_tenant_id: TENANT_ID,
});

const ORIGINAL_XERO_IMPL = process.env.XERO_IMPL;

beforeEach(() => {
  // Reset to baseline before each test — most tests set the value
  // explicitly, but this guards against env state leaking from a prior
  // test (or from the parent shell).
  delete process.env.XERO_IMPL;
});

after(() => {
  // Restore the original env so a non-test consumer of this process
  // sees the same XERO_IMPL it started with.
  if (ORIGINAL_XERO_IMPL === undefined) {
    delete process.env.XERO_IMPL;
  } else {
    process.env.XERO_IMPL = ORIGINAL_XERO_IMPL;
  }
});

// -- factory selection ----------------------------------------------------

test('createXeroAccountingGet: returns the real client when XERO_IMPL is unset', () => {
  delete process.env.XERO_IMPL;
  const fn = createXeroAccountingGet();
  // Strict reference equality — the factory should hand back the real
  // function object, not a wrapper.
  assert.equal(fn, xeroAccountingGet);
});

test('createXeroAccountingGet: returns the real client for non-"stub" values', () => {
  process.env.XERO_IMPL = 'real';
  const fn1 = createXeroAccountingGet();
  assert.equal(fn1, xeroAccountingGet);

  process.env.XERO_IMPL = '';
  const fn2 = createXeroAccountingGet();
  assert.equal(fn2, xeroAccountingGet);

  process.env.XERO_IMPL = 'STUB'; // case-sensitive — only lowercase 'stub' triggers
  const fn3 = createXeroAccountingGet();
  assert.equal(fn3, xeroAccountingGet);
});

test('createXeroAccountingGet: returns the stub when XERO_IMPL=stub', () => {
  process.env.XERO_IMPL = 'stub';
  const fn = createXeroAccountingGet();
  assert.equal(fn, xeroAccountingGetStub);
});

test('createXeroAccountingGet: re-reads env on every call (no module-load capture)', () => {
  // First call: stub.
  process.env.XERO_IMPL = 'stub';
  const fn1 = createXeroAccountingGet();
  assert.equal(fn1, xeroAccountingGetStub);

  // Mutate env, call again — should now return real.
  delete process.env.XERO_IMPL;
  const fn2 = createXeroAccountingGet();
  assert.equal(fn2, xeroAccountingGet);
});

// -- stub returns parsed fixture content ---------------------------------

test('stub: /Invoices returns the invoices fixture (3 ACCPAY rows)', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet: XeroAccountingGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/Invoices')) as {
    Invoices: Array<{ InvoiceID: string; Type: string; Status: string }>;
  };
  assert.ok(Array.isArray(data.Invoices));
  assert.equal(data.Invoices.length, 3, 'fixture has 3 invoices');
  assert.ok(data.Invoices.every((i) => i.Type === 'ACCPAY'));
  // At least one PAID and one AUTHORISED — required by the spec.
  assert.ok(data.Invoices.some((i) => i.Status === 'PAID'));
  assert.ok(data.Invoices.some((i) => i.Status === 'AUTHORISED'));
});

test('stub: /BankTransactions returns the bank-tx fixture (3 SPEND rows)', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/BankTransactions')) as {
    BankTransactions: Array<{ BankTransactionID: string; Type: string }>;
  };
  assert.ok(Array.isArray(data.BankTransactions));
  assert.equal(data.BankTransactions.length, 3);
  assert.ok(data.BankTransactions.every((b) => b.Type === 'SPEND'));
});

test('stub: /Receipts returns AUTHORISED receipts with AU email shapes', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/Receipts')) as {
    Receipts: Array<{ ReceiptID: string; Status: string; User?: { Email?: string } }>;
  };
  assert.ok(Array.isArray(data.Receipts));
  assert.ok(data.Receipts.length >= 2, 'at least 2 receipts');
  assert.ok(data.Receipts.every((r) => r.Status === 'AUTHORISED'));
  // AU email shape — a reasonable proxy for plausibility.
  assert.ok(
    data.Receipts.every((r) => r.User?.Email?.endsWith('.com.au') === true),
    'reimbursee emails use AU domain shape',
  );
});

test('stub: /Contacts returns at least 5 ACTIVE contacts', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/Contacts')) as {
    Contacts: Array<{ ContactID: string; ContactStatus: string }>;
  };
  assert.ok(Array.isArray(data.Contacts));
  assert.ok(data.Contacts.length >= 5, 'at least 5 contacts');
  assert.ok(data.Contacts.every((c) => c.ContactStatus === 'ACTIVE'));
});

test('stub: /Accounts returns ~10 chart-of-accounts entries spanning types', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/Accounts')) as {
    Accounts: Array<{ AccountID: string; Type: string }>;
  };
  assert.ok(Array.isArray(data.Accounts));
  assert.ok(data.Accounts.length >= 10, 'at least 10 accounts');
  // Spans EXPENSE / REVENUE / ASSET / LIABILITY — the four canonical
  // accounting categories the F5 mapping-rule UI surfaces.
  const types = new Set(data.Accounts.map((a) => a.Type));
  assert.ok(types.has('EXPENSE'));
  assert.ok(types.has('REVENUE'));
  assert.ok(types.has('ASSET'));
  assert.ok(types.has('LIABILITY'));
});

// -- stub: since= filter (incremental sync) ------------------------------

test('stub: since= filter drops rows whose UpdatedDateUTC <= since', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();

  // Invoices fixture UpdatedDateUTC values (from invoices.json):
  //   1641000000000 (2022-01-01T05:20:00Z)
  //   1641100000000 (2022-01-02T09:06:40Z)
  //   1641200000000 (2022-01-03T12:53:20Z)
  // Pick `since` strictly between #2 and #3 — only #3 should remain.
  const since = new Date(1641150000000); // 2022-01-02T22:00:00.000Z
  const data = (await xeroGet(opts(), '/Invoices', undefined, {
    'If-Modified-Since': since.toUTCString(),
  })) as {
    Invoices: Array<{ InvoiceID: string; UpdatedDateUTC: string }>;
  };
  assert.equal(data.Invoices.length, 1, 'only one invoice newer than since');
  // Specifically the third fixture row (UpdatedDateUTC = 1641200000000).
  assert.equal(data.Invoices[0]?.InvoiceID, 'f3f3f3f3-3333-4333-8333-f3f3f3f3f3f3');
});

test('stub: since= in the distant future returns empty', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  // Year 2100 — well past any fixture UpdatedDateUTC.
  const since = new Date('2100-01-01T00:00:00.000Z');
  const data = (await xeroGet(opts(), '/Invoices', undefined, {
    'If-Modified-Since': since.toUTCString(),
  })) as { Invoices: unknown[] };
  assert.equal(data.Invoices.length, 0);
});

test('stub: since= in the distant past returns all rows', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const since = new Date('1970-01-01T00:00:00.000Z');
  const data = (await xeroGet(opts(), '/Invoices', undefined, {
    'If-Modified-Since': since.toUTCString(),
  })) as { Invoices: unknown[] };
  assert.equal(data.Invoices.length, 3);
});

test('stub: no since= header returns all rows', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  const data = (await xeroGet(opts(), '/Invoices')) as { Invoices: unknown[] };
  assert.equal(data.Invoices.length, 3);
});

// -- stub: unknown path is loud --------------------------------------------

test('stub: unknown path throws (avoid silent empty responses)', async () => {
  process.env.XERO_IMPL = 'stub';
  const xeroGet = createXeroAccountingGet();
  await assert.rejects(xeroGet(opts(), '/PurchaseOrders'), /unknown path "\/PurchaseOrders"/);
});
