/**
 * Expenditure mapping stub — types, fixture data, and pure helpers.
 *
 * C5 ships UI only: the controller decided that mapping persistence is
 * event-sourced (planned `EXPENDITURE_MAPPED` event posted via
 * `POST /v1/expenditures/:id/map`, landing in A-swimlane), and current-
 * mapping state is projected from that event stream. Until those land,
 * the tab reads from this in-memory fixture so the user flow (list →
 * pick activity → optimistic update → toast) is exercisable.
 *
 * The fixture intentionally spans all three Xero kinds (INVOICE,
 * BANK_TX, RECEIPT) and pre-populates a couple of mapped rows so the
 * "Mapped" filter has something to show on first load. Re-map flows are
 * meaningful because the activity UUIDs match those returned by the
 * `listActivities` stub in `./api.ts`.
 *
 * Pure helpers (filterExpenditures, applyMappingOptimistic,
 * formatAmount) live alongside the fixture so they can be unit-tested
 * without pulling the React tree (matches the workspace convention —
 * see pipeline/_lib/format.ts).
 */
import type { ExpenditureFilter } from './url-params';

/**
 * Kind chip taxonomy for the row's "where did this expenditure come
 * from?" badge. Mirrors the wire-format `ExpenditureSource` enum
 * (`xero_invoice` / `xero_bank_tx` / `xero_receipt` / `manual` — see
 * `packages/schemas/src/expenditure.ts`) but the UI shows the upstream
 * kind, not the storage discriminator. `manual` is excluded because
 * C5's surface is "what came in from Xero?" — manual entries follow a
 * different review path (P4 plan §"manual expenditure").
 */
export const EXPENDITURE_KINDS = ['INVOICE', 'BANK_TX', 'RECEIPT'] as const;
export type ExpenditureKind = (typeof EXPENDITURE_KINDS)[number];

/**
 * Snapshot of the activity an expenditure is currently mapped to.
 * Denormalised intentionally — the row only needs to render
 * "→ {code} {title}" and doesn't follow the link to the activity, so
 * paying for a re-fetch would be wasteful. `mapped_at` lets the row
 * show "mapped 3 mins ago" if we want it later.
 *
 * In production this is the projection output of the latest
 * EXPENDITURE_MAPPED event for the expenditure (see
 * `expenditure-projection.ts`).
 */
export interface ExpenditureMapping {
  activity_id: string;
  activity_code: string;
  activity_title: string;
  mapped_at: string;
}

/**
 * Single row in the expenditure list. The shape composes the relevant
 * `expenditure` columns (id, expenditure_date, total_amount, currency,
 * reference) with the joined-in `vendor_name` (the row's payee) and the
 * projected current_mapping (undefined when unmapped).
 *
 * `kind` is the upstream Xero source type (see EXPENDITURE_KINDS).
 * `subject_tenant_id` is intentionally omitted from the row shape — the
 * tab is already scoped to one claim, which is scoped to one
 * subject_tenant.
 */
export interface ExpenditureRow {
  id: string;
  kind: ExpenditureKind;
  /** ISO date in YYYY-MM-DD form (matches `expenditure.expenditure_date`). */
  date: string;
  payee: string;
  /** N.NN string (matches `expenditure.total_amount`; postgres NUMERIC(12,2)). */
  amount: string;
  currency: string;
  reference: string | null;
  /** Undefined when the row has never been mapped. */
  current_mapping?: ExpenditureMapping;
}

// ---------------------------------------------------------------------------
// Deterministic UUIDs — referenced by both the expenditure fixture and the
// activity fixture in `./api.ts` so the picker UX shows real-looking
// "→ CA-001 Foo" mappings out of the box. Keep these in sync if you reorder
// or rename activities in `./api.ts`.
// ---------------------------------------------------------------------------

// IDs are fixture-shaped placeholder strings. TypeScript treats them as
// string (the `Uuid` type alias from `@cpa/schemas` is `z.string()` —
// see `packages/schemas/src/primitives.ts`); the strict v4 regex only
// runs at the API boundary. We use only hex chars in the trailing slot
// so a future server-side validation step can't reject the fixture
// out of hand. The "ca0n" / "5a0n" suffixes are intentionally readable
// — they signal "this is the C5 activity stub" at a glance.
export const STUB_ACTIVITY_IDS = {
  CA_001: '00000000-0000-0000-0000-0000000ca001',
  CA_002: '00000000-0000-0000-0000-0000000ca002',
  CA_003: '00000000-0000-0000-0000-0000000ca003',
  SA_001: '00000000-0000-0000-0000-00000005a001',
  SA_002: '00000000-0000-0000-0000-00000005a002',
} as const;

/**
 * Stub expenditure fixture. Mixes all three kinds, two pre-mapped rows
 * (so the "Mapped" filter has something to show on first load), AUD and
 * USD currencies (so the formatter is exercised on a non-AUD row), and
 * dates spread across recent days (so the desc sort is visible).
 *
 * IDs are deterministic so the same fixture survives re-renders and
 * tests can assert on them without snapshot brittleness.
 */
export const STUB_EXPENDITURES: ReadonlyArray<ExpenditureRow> = [
  {
    id: '00000000-0000-0000-0000-0000000000e1',
    kind: 'INVOICE',
    date: '2026-04-25',
    payee: 'AWS Australia Pty Ltd',
    amount: '4823.50',
    currency: 'AUD',
    reference: 'INV-AWS-2026-04',
  },
  {
    id: '00000000-0000-0000-0000-0000000000e2',
    kind: 'BANK_TX',
    date: '2026-04-24',
    payee: 'GitHub, Inc.',
    amount: '210.00',
    currency: 'USD',
    reference: 'Subscription — Enterprise plan',
    current_mapping: {
      activity_id: STUB_ACTIVITY_IDS.CA_001,
      activity_code: 'CA-001',
      activity_title: 'Adaptive scaffolding algorithm',
      mapped_at: '2026-04-26T09:14:00.000Z',
    },
  },
  {
    id: '00000000-0000-0000-0000-0000000000e3',
    kind: 'RECEIPT',
    date: '2026-04-22',
    payee: 'Officeworks',
    amount: '142.85',
    currency: 'AUD',
    reference: 'Lab consumables — pipette tips, gloves',
  },
  {
    id: '00000000-0000-0000-0000-0000000000e4',
    kind: 'INVOICE',
    date: '2026-04-21',
    payee: 'Aon Risk Services',
    amount: '1280.00',
    currency: 'AUD',
    reference: 'Professional indemnity FY26 Q4',
  },
  {
    id: '00000000-0000-0000-0000-0000000000e5',
    kind: 'BANK_TX',
    date: '2026-04-19',
    payee: 'CSIRO Publishing',
    amount: '95.00',
    currency: 'AUD',
    reference: 'Journal access — quarterly',
    current_mapping: {
      activity_id: STUB_ACTIVITY_IDS.SA_001,
      activity_code: 'SA-001',
      activity_title: 'Literature review and prior-art search',
      mapped_at: '2026-04-20T11:02:00.000Z',
    },
  },
  {
    id: '00000000-0000-0000-0000-0000000000e6',
    kind: 'INVOICE',
    date: '2026-04-18',
    payee: 'Linear Pty Ltd',
    amount: '380.00',
    currency: 'AUD',
    reference: 'INV-LIN-1284',
  },
  {
    id: '00000000-0000-0000-0000-0000000000e7',
    kind: 'RECEIPT',
    date: '2026-04-15',
    payee: 'Bunnings Warehouse',
    amount: '67.40',
    currency: 'AUD',
    reference: 'Workshop hardware',
  },
];

/**
 * Filter rows by the chip-strip selection. Pure for testability —
 * unmapped = no `current_mapping`, mapped = has one, all = passthrough.
 *
 * Caller is responsible for any other ordering (the fixture is already
 * sorted date-desc; if listExpenditures grows other ordering, do it
 * before this).
 */
export function filterExpenditures(
  rows: ReadonlyArray<ExpenditureRow>,
  filter: ExpenditureFilter,
): ExpenditureRow[] {
  switch (filter) {
    case 'all':
      return rows.slice();
    case 'unmapped':
      return rows.filter((r) => !r.current_mapping);
    case 'mapped':
      return rows.filter((r) => Boolean(r.current_mapping));
  }
}

/**
 * Reducer for the optimistic mapping update. Returns a NEW array with
 * the matching row's `current_mapping` replaced (or set, if previously
 * unmapped). Pure — no mutation of the input — so the caller can
 * snapshot the previous state and revert on stub failure.
 *
 * If `expenditure_id` doesn't match any row, returns the input slice
 * unchanged (defensive — avoids a silent no-op being mistaken for a
 * successful mapping by the caller).
 */
export function applyMappingOptimistic(
  rows: ReadonlyArray<ExpenditureRow>,
  expenditure_id: string,
  mapping: ExpenditureMapping,
): ExpenditureRow[] {
  return rows.map((r) => (r.id === expenditure_id ? { ...r, current_mapping: mapping } : r));
}

/**
 * Format an N.NN amount string + ISO 4217 currency code into a
 * human-readable label. Uses Intl.NumberFormat (en-AU locale — the user
 * base is Australian R&D consultants), which handles negatives,
 * thousand separators, and currency-specific symbol placement
 * automatically.
 *
 * Falls back to "{amount} {currency}" if the amount can't be parsed —
 * a malformed stub fixture shouldn't crash the row, just degrade
 * gracefully.
 */
export function formatAmount(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    // Intl throws RangeError on an unknown currency code — fall back
    // to the plain amount + code so the row stays renderable.
    return `${amount} ${currency}`;
  }
}
