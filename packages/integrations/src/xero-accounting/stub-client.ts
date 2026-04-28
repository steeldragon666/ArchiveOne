import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseXeroDate, type XeroAccountingClientOptions } from './client.js';

/**
 * Xero Accounting stub client (T-B7).
 *
 * Drop-in stand-in for `xeroAccountingGet` that returns deterministic
 * fixture data instead of hitting Xero's real API. Activated via the
 * `XERO_IMPL=stub` env var (see `client-factory.ts`); used for local
 * end-to-end work and CI runs that have no Xero credentials.
 *
 * **Shape parity**: each fixture mirrors the Xero AccountingApi v2 wire
 * format — PascalCase keys, Microsoft JSON Date strings, the same
 * top-level wrapper objects (`{ Invoices: [] }`, `{ BankTransactions: [] }`,
 * `{ Receipts: [] }`, `{ Contacts: [] }`, `{ Accounts: [] }`). The B2-B5
 * sync functions consume this shape unchanged, so swapping the real
 * client for the stub at the factory layer is invisible to them.
 *
 * **`since=` semantics**: when the caller passes
 * `If-Modified-Since: <UTCString>` (incremental sync), the stub filters
 * fixtures by `UpdatedDateUTC > since`. This matches what the real
 * Xero endpoint does and lets B6's incremental-mode tests behave
 * identically under stub. Rows without `UpdatedDateUTC` are returned
 * unfiltered (defensive — the fixture authors include the field, but
 * a missing one shouldn't drop the row silently).
 *
 * **Pagination**: the stub does NOT paginate. The fixture set is small
 * (<100 rows per resource) and the real client only paginates when a
 * full PAGE_SIZE page is returned. The stub returns every fixture in
 * one response and `< PAGE_SIZE` triggers the sync's loop-termination
 * branch. The page=1, page=2 wire calls are not modelled — every
 * `?page=N` request returns the same fixture content; the sync loop
 * then sees a short page and exits. (For B7 this is fine because the
 * fixtures are deliberately under 100 entries each.)
 *
 * **No tenant gating**: the stub does NOT validate `xero_tenant_id` or
 * `access_token`. Determinism trumps fidelity here — the stub's job is
 * to produce stable, predictable test data, not to simulate Xero's
 * auth surface. The real OAuth + token-refresh flow (B1) is exercised
 * by its own dedicated test suite.
 *
 * **No write surface**: the real Xero accounting integration is read-
 * only at the B-swimlane scope (B2-B6 only call GET endpoints). A
 * future write-path stub would need to record mutations and surface
 * them on subsequent reads; for now, this stub is GET-only and throws
 * on any non-`/Invoices`, `/BankTransactions`, `/Receipts`, `/Contacts`,
 * `/Accounts` path so an unexpected new endpoint surfaces loudly
 * instead of silently returning empty.
 */

interface FixtureRow {
  /** Optional Microsoft-JSON-Date string used for the since= filter. */
  UpdatedDateUTC?: string;
}

interface InvoicesFixture {
  Invoices: FixtureRow[];
}
interface BankTransactionsFixture {
  BankTransactions: FixtureRow[];
}
interface ReceiptsFixture {
  Receipts: FixtureRow[];
}
interface ContactsFixture {
  Contacts: FixtureRow[];
}
interface AccountsFixture {
  Accounts: FixtureRow[];
}

/**
 * Resolve a fixture file path relative to this module. Works the same
 * way whether the module runs from `src/` (under tsx) or `dist/` (under
 * node) — `import.meta.url` is the runtime URL of the .ts/.js file, and
 * the post-build step copies the `fixtures/` directory next to the
 * compiled output.
 */
function fixturePath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'fixtures', name);
}

function loadFixture<T>(name: string): T {
  const raw = readFileSync(fixturePath(name), 'utf8');
  return JSON.parse(raw) as T;
}

/**
 * Filter a list of fixture rows by their `UpdatedDateUTC` field. Returns
 * only rows where `UpdatedDateUTC > since`. Rows whose `UpdatedDateUTC`
 * is missing or unparseable are kept (defensive — see header).
 */
function filterBySince<T extends FixtureRow>(rows: T[], since: Date): T[] {
  return rows.filter((row) => {
    if (!row.UpdatedDateUTC) return true;
    const updated = parseXeroDate(row.UpdatedDateUTC);
    if (!updated) return true;
    return updated.getTime() > since.getTime();
  });
}

/**
 * Parse the `If-Modified-Since` header into a Date, or return null if
 * the header is absent / unparseable. The header value is RFC 7231
 * IMF-fixdate (matches `Date.toUTCString()`); JS's `new Date(string)`
 * parses it natively.
 */
function parseSinceHeader(extraHeaders: Record<string, string> | undefined): Date | null {
  if (!extraHeaders) return null;
  // Header lookup is case-insensitive in practice; the sync code passes
  // the exact key 'If-Modified-Since', but we walk the entries to be
  // defensive.
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key.toLowerCase() === 'if-modified-since') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/**
 * Stub implementation of `xeroAccountingGet`. Same signature as the
 * real client so the factory can swap them transparently.
 *
 * The `opts` argument is accepted but ignored — the stub does not
 * model auth or tenant gating (see header). The `query` argument is
 * inspected only to satisfy callers that pass a `where` clause; the
 * stub does NOT apply Xero's `where` filter — the calling sync code
 * already has a defensive client-side filter for the same predicate
 * (see e.g. sync-invoices.ts's `if (inv.Type !== 'ACCPAY') continue`),
 * so the fixture-vs-filter divergence is harmless.
 */
// Returns a Promise (matching `xeroAccountingGet`'s signature) but does
// no async work — the fixture read is synchronous. Use a non-async
// function + Promise.resolve so eslint's `require-await` is satisfied
// without disabling the rule.
export function xeroAccountingGetStub(
  // Argument retained for signature parity. Stub deliberately ignores it.
  _opts: XeroAccountingClientOptions,
  path: string,
  // Argument retained for signature parity. Stub deliberately ignores it.
  _query?: Record<string, string>,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const since = parseSinceHeader(extraHeaders);

  switch (path) {
    case '/Invoices': {
      const fx = loadFixture<InvoicesFixture>('invoices.json');
      const rows = since ? filterBySince(fx.Invoices, since) : fx.Invoices;
      return Promise.resolve({ Invoices: rows });
    }
    case '/BankTransactions': {
      const fx = loadFixture<BankTransactionsFixture>('bank-transactions.json');
      const rows = since ? filterBySince(fx.BankTransactions, since) : fx.BankTransactions;
      return Promise.resolve({ BankTransactions: rows });
    }
    case '/Receipts': {
      const fx = loadFixture<ReceiptsFixture>('receipts.json');
      const rows = since ? filterBySince(fx.Receipts, since) : fx.Receipts;
      return Promise.resolve({ Receipts: rows });
    }
    case '/Contacts': {
      const fx = loadFixture<ContactsFixture>('contacts.json');
      const rows = since ? filterBySince(fx.Contacts, since) : fx.Contacts;
      return Promise.resolve({ Contacts: rows });
    }
    case '/Accounts': {
      const fx = loadFixture<AccountsFixture>('accounts.json');
      const rows = since ? filterBySince(fx.Accounts, since) : fx.Accounts;
      return Promise.resolve({ Accounts: rows });
    }
    default:
      // Surface unknown paths loudly — see header. Reject (rather than
      // throw synchronously) so callers' `await` propagates the failure
      // through the same code path as a real-client error.
      return Promise.reject(
        new Error(
          `xeroAccountingGetStub: unknown path "${path}" — extend stub-client.ts when adding new Xero endpoints`,
        ),
      );
  }
}
