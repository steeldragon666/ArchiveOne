# Xero accounting stub fixtures

These JSON files are the deterministic data the Xero accounting **stub
client** (`stub-client.ts`) returns when the integration runs with
`XERO_IMPL=stub`.

## Why JSON?

JSON files are the easiest format to inspect, diff, and amend. They are
loaded at runtime via `readFileSync` from a path resolved relative to
`import.meta.url` so the stub works the same way under `tsx` (dev / tests)
and `node dist/...` (production-like build).

A `postbuild` step copies these JSONs to `dist/xero-accounting/fixtures/`
so the published artifact is self-contained — see
`packages/integrations/package.json` `build` script.

## What shapes do these mirror?

The shapes mirror the **Xero AccountingApi v2** wire format
(`https://api.xero.com/api.xro/2.0/<resource>`). For canonical types see
the upstream `@xero-node` package; we hand-pick the subset of fields the
B2-B6 sync code consumes, with the documented Xero quirks preserved:

- Microsoft JSON Date format on date fields: `/Date(1234567890000+0000)/`.
  The stub keeps these strings verbatim so `parseXeroDate` exercises the
  same branch under stub as under the real API.
- PascalCase property names — Xero's wire convention.
- `UpdatedDateUTC` on every row, used by the stub's `since=` filter
  (incremental-sync mode). When `since` is set, the stub returns only
  rows whose `UpdatedDateUTC > since`.

## Determinism

UUIDs / Xero IDs are **hand-picked**, not generated. The fixtures are
intended to remain bit-stable so tests that diff against expected output
stay green. If you amend a fixture, run the test suite — divergence is
intentional and the test snapshots / assertions should be updated too.

## Files

- `invoices.json` — 3 ACCPAY (bills) covering AUTHORISED + PAID statuses,
  varied dates, line items, contact references.
- `bank-transactions.json` — 3 SPEND transactions with line items.
- `receipts.json` — 2 AUTHORISED receipts referencing AU email addresses
  (`*@stub-firm.com.au`) for the reimbursee mapping path.
- `contacts.json` — 6 ACTIVE contacts representing common AU SME
  vendors (AWS, Officeworks, Telstra, Cab Co, Conference Catering,
  Coffee Shop Co).
- `accounts.json` — 10 chart-of-accounts entries spanning REVENUE,
  EXPENSE, ASSET, LIABILITY, BANK types — representative of an AU SME's
  default Xero chart.

## Adding new fixture rows

1. Pick a new deterministic UUID (don't `randomUUID()` it).
2. Set `UpdatedDateUTC` to a millis epoch matching your scenario — older
   timestamps are returned in incremental mode against an early `since`,
   newer ones get filtered out.
3. Run `pnpm --filter @cpa/integrations test src/xero-accounting/client-factory.test.ts`
   to confirm the stub still parses and the since-filter still behaves.
