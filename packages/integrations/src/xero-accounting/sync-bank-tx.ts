import { privilegedSql } from '@cpa/db/client';
import { insertEventWithChain } from '@cpa/db';
import { ExpenditureIngestedPayload } from '@cpa/schemas';
import { parseXeroDate } from './client.js';
import { createXeroAccountingGet } from './client-factory.js';

/**
 * Xero Accounting bank-transaction sync (T-B3).
 *
 * Walks every page of the Xero `/BankTransactions` endpoint and upserts
 * each **SPEND** (money-out) row into `expenditure` plus its line items
 * into `expenditure_line`. RECEIVE (money-in) rows are filtered out at
 * the API layer via Xero's `where` query parameter because R&DTI
 * expenditure tracking only cares about money the firm spent, not money
 * it received.
 *
 * **Modes** (per plan, mirrors B2):
 *   - `backfill`: no `If-Modified-Since`. Used for the initial connect-
 *     + import flow — pulls every SPEND bank transaction the connection
 *     has access to. Idempotent: the partial unique index
 *     `(tenant_id, source='xero_bank_tx', source_external_id)` means
 *     re-running an already-completed backfill UPDATEs the matched rows
 *     in place rather than duplicating.
 *   - `incremental`: `If-Modified-Since: <since.toUTCString()>`. Used by
 *     the periodic worker — Xero returns only bank transactions touched
 *     at-or-after `since`. New rows insert + emit
 *     `EXPENDITURE_INGESTED`; touched-but-pre-existing rows UPDATE
 *     without emitting an event (the event already exists in the chain).
 *
 * **Pagination**: Xero's documented hard cap on Accounting endpoints is
 * 100 items per page (the plan said 200, but Xero rejects pageSize >
 * 100 — see https://developer.xero.com/documentation/api/accounting/requests-and-responses).
 * We send `?pageSize=100` explicitly and loop until we get a short page
 * (< 100 results).
 *
 * **SPEND filter**: applied via Xero's `where` syntax —
 * `where=Type=="SPEND"`. Doing the filter in the API request avoids
 * paying for a round-trip that returns RECEIVE rows we'd discard
 * locally. The fixture includes one RECEIVE row so the test suite
 * verifies the local guard rejects it too in case Xero's filter ever
 * misbehaves.
 *
 * **Bank-tx contact semantics**: unlike Invoices (where Contact is
 * always the supplier), a BankTransaction's Contact is the *payee* —
 * which is usually a vendor for SPEND rows but may be a one-off contact
 * (e.g. an ad-hoc cash withdrawal recorded with a placeholder contact).
 * We treat Contact.Name as the vendor_name and rely on the rule engine
 * (F5) plus consultant review to disambiguate downstream.
 *
 * **Upsert semantics** (mirrors B2):
 *   - Match key: `(tenant_id, source='xero_bank_tx', source_external_id=<BankTransactionID>)`
 *     enforced by the F3 partial unique index.
 *   - On hit (existing row): UPDATE all mutable fields (vendor_name,
 *     expenditure_date, total_amount, currency, raw_payload, reference).
 *     Do NOT write a new EXPENDITURE_INGESTED event — the chain already
 *     records the original ingestion.
 *   - On miss (new row): INSERT, then write an EXPENDITURE_INGESTED
 *     event via `insertEventWithChain`.
 *   - `expenditure_line`: full-replace on every upsert — DELETE existing
 *     lines for the expenditure_id, then INSERT the current Xero line
 *     shape. Xero is the source of truth for lines, and partial-update
 *     semantics would risk leaving orphan lines after a Xero-side delete.
 *
 * **Currency**: P4 is AUD-only (the F4 CHECK constraint enforces
 * `currency = 'AUD'`). Non-AUD bank transactions throw a descriptive
 * error before INSERT so the caller (and the operator reading logs) can
 * see which row tripped it. Multi-currency support is tracked for P9.
 *
 * **Subject_tenant resolution**: bank transactions in Xero are not
 * associated with a specific R&D claimant — they're Xero-org-wide. The
 * `connection` input here doesn't carry a `subject_tenant_id` because
 * bank-tx ingestion is a tenant-level activity; the apportionment step
 * (F5, mapping rules) is what associates a line item with a specific
 * subject_tenant + activity. For the EXPENDITURE_INGESTED event we use
 * the tenant_id as the subject_tenant_id stand-in: the tenant has a
 * "self" subject_tenant row created on tenant onboarding (see F1
 * subject_tenant.ts) — we look it up by tenant_id.
 *
 * Privileged SQL — same rationale as the payroll sync workers in
 * `payroll/xero-payroll/*-sync.ts` and the sibling `sync-invoices.ts`.
 * The sync worker runs out-of-band with no request session, so it
 * bypasses RLS via `privilegedSql`. Tests inject a mock `sql_client`
 * mirroring the postgres-js template-tag interface.
 */

export type SqlClient = typeof privilegedSql;
export type ChainInserter = typeof insertEventWithChain;

export interface SyncBankTransactionsConnection {
  /** integration_connection.id — used for trace logging only. */
  id: string;
  /** owning tenant_id — drives RLS, the partial unique key, and the chain. */
  tenant_id: string;
  /** Xero org tenant_id (the `Xero-tenant-id` header value). */
  xero_tenant_id: string;
  /** Decrypted access token (caller decrypts via `decryptToken`). */
  access_token: string;
}

export interface SyncBankTransactionsOptions {
  mode: 'backfill' | 'incremental';
  /** Required if mode='incremental'. Sent as If-Modified-Since header. */
  since?: Date;
  /** Override for tests; defaults to the privileged DB client. */
  sql_client?: SqlClient;
  /** Override for tests; defaults to `insertEventWithChain` from `@cpa/db`. */
  chain_insert?: ChainInserter;
  /** Test override for the API base URL — forwarded to xeroAccountingGet. */
  base_url?: string;
}

export interface SyncBankTransactionsResult {
  /** Number of bank transactions fetched from Xero (paginated total, SPEND only). */
  fetched: number;
  /** Number of new expenditure rows inserted. */
  inserted: number;
  /** Number of existing expenditure rows updated (idempotent re-sync). */
  updated: number;
  /** Number of expenditure_line rows total (sum across inserted+updated). */
  lines: number;
  /** Number of EXPENDITURE_INGESTED events written (= inserted, never on update). */
  events_written: number;
  /**
   * IDs of the newly-inserted expenditure rows (parallel to `inserted` /
   * `events_written` counters). Caller (the Xero sync orchestrator)
   * forwards these to the Agent A classifier trigger — see
   * `apps/api/src/lib/enqueue-classify.ts`. Empty for incremental
   * runs that match only pre-existing rows.
   *
   * Optional in the type so existing test stubs that synthesise a
   * result object don't have to enumerate it; the orchestrator coalesces
   * undefined to `[]`. The real `syncBankTransactions` always sets it.
   */
  inserted_expenditure_ids?: string[];
}

const PAGE_SIZE = 100;

interface XeroBankTransactionContact {
  ContactID?: string;
  Name?: string;
}

interface XeroBankTransactionLineItem {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: string | number;
  LineAmount?: string | number;
  AccountCode?: string;
}

interface XeroBankTransaction {
  BankTransactionID: string;
  // 'SPEND' (money out) and 'RECEIVE' (money in) are the documented
  // values; we type as plain string to allow future Xero additions
  // without a type diff. The runtime guard `bt.Type !== 'SPEND'` handles
  // filtering.
  Type: string;
  Status?: string;
  Date?: string;
  Contact?: XeroBankTransactionContact;
  Reference?: string;
  CurrencyCode?: string;
  Total?: string | number;
  LineItems?: XeroBankTransactionLineItem[];
}

interface XeroBankTransactionsResponse {
  BankTransactions?: XeroBankTransaction[];
}

/**
 * Format a Date as the YYYY-MM-DD string the Postgres `date` column
 * expects. Slicing the ISO string keeps us in UTC, which matches the
 * way Xero emits bank-tx dates (their `/Date(epoch+0000)/` format is
 * UTC absolute millis — see parseXeroDate's docstring).
 */
function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Coerce a numeric amount that may arrive as either a string ("500.00")
 * or a number (500) into the canonical "N.NN" string Postgres NUMERIC
 * accepts and our schema regex enforces. The two-decimal pad matches
 * the storage shape — we don't synthesise precision Xero didn't send,
 * but we DO normalise integers and one-decimal forms.
 */
function toAmountString(v: string | number | undefined): string {
  if (typeof v === 'number') return v.toFixed(2);
  if (typeof v === 'string' && v.length > 0) {
    // Parse-and-reformat so "500" → "500.00", "500.5" → "500.50",
    // "500.50" → "500.50". Falls through unchanged for non-numeric
    // strings, which the DB will reject (correct behaviour).
    const n = Number(v);
    if (Number.isFinite(n)) return n.toFixed(2);
    return v;
  }
  return '0.00';
}

export async function syncBankTransactions(
  connection: SyncBankTransactionsConnection,
  options: SyncBankTransactionsOptions,
): Promise<SyncBankTransactionsResult> {
  const sql = options.sql_client ?? privilegedSql;
  const chainInsert = options.chain_insert ?? insertEventWithChain;

  if (options.mode === 'incremental' && !options.since) {
    throw new Error(
      'syncBankTransactions: mode=incremental requires `since` — pass the last successful sync timestamp',
    );
  }

  const result: SyncBankTransactionsResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    lines: 0,
    events_written: 0,
    inserted_expenditure_ids: [],
  };

  // Resolve the HTTP client once via the factory. Returns the real
  // fetch-based client, or the deterministic stub when XERO_IMPL=stub.
  // See `client-factory.ts` header for the swap rationale.
  const xeroGet = createXeroAccountingGet();

  let page = 1;
  while (true) {
    const query: Record<string, string> = {
      // SPEND-only filter at the API layer — see header comment.
      where: 'Type=="SPEND"',
      page: String(page),
      pageSize: String(PAGE_SIZE),
    };

    const extraHeaders: Record<string, string> = {};
    if (options.mode === 'incremental' && options.since) {
      // Xero documents `If-Modified-Since` as the canonical incremental
      // filter. UTCString is the RFC 7231 IMF-fixdate format servers
      // expect; toISOString would also work but UTCString is the
      // documented form and matches the payroll variant for parity.
      extraHeaders['If-Modified-Since'] = options.since.toUTCString();
    }

    const data = (await xeroGet(
      {
        access_token: connection.access_token,
        xero_tenant_id: connection.xero_tenant_id,
        ...(options.base_url !== undefined ? { base_url: options.base_url } : {}),
      },
      '/BankTransactions',
      query,
      extraHeaders,
    )) as XeroBankTransactionsResponse;

    const bankTxs = data.BankTransactions ?? [];

    for (const bt of bankTxs) {
      // Defensive: belt-and-braces filter in case Xero's `where`
      // parameter ever drops the constraint or surfaces a malformed row.
      // The test suite exercises this branch with a mixed SPEND/RECEIVE
      // fixture even though the production API call is SPEND-filtered.
      if (bt.Type !== 'SPEND') continue;

      result.fetched++;

      const currency = bt.CurrencyCode ?? 'AUD';
      if (currency !== 'AUD') {
        throw new Error(
          `Non-AUD bank transaction unsupported in P4: tenant=${connection.tenant_id} bank-tx=${bt.BankTransactionID} currency=${currency}`,
        );
      }

      const btDate = parseXeroDate(bt.Date);
      if (!btDate) {
        // Xero bank transactions always carry a Date — but be defensive:
        // a malformed wire response shouldn't crash the whole sync. Log
        // via thrown error so the operator can investigate.
        throw new Error(
          `syncBankTransactions: bank transaction ${bt.BankTransactionID} has missing/unparseable Date "${bt.Date}"`,
        );
      }
      const expenditureDate = toDateOnly(btDate);
      const vendorName = bt.Contact?.Name ?? '(unknown vendor)';
      const reference = bt.Reference ?? null;
      const totalAmount = toAmountString(bt.Total);
      const rawPayload = JSON.stringify(bt);

      // Look up the existing expenditure row by the F3 partial unique
      // key. We cannot use ON CONFLICT here because we want to know
      // whether the operation was an INSERT or an UPDATE — this drives
      // the EXPENDITURE_INGESTED event-emission decision.
      const existingRows = (await sql`
        SELECT id FROM expenditure
         WHERE tenant_id = ${connection.tenant_id}
           AND source = 'xero_bank_tx'
           AND source_external_id = ${bt.BankTransactionID}
      `) as Array<{ id: string }>;
      const existing = existingRows[0];

      let expenditureId: string;
      let wasInsert: boolean;
      if (existing) {
        expenditureId = existing.id;
        wasInsert = false;
        await sql`
          UPDATE expenditure
             SET vendor_name = ${vendorName},
                 reference = ${reference},
                 expenditure_date = ${expenditureDate},
                 total_amount = ${totalAmount},
                 currency = ${currency},
                 raw_payload = ${rawPayload}::jsonb
           WHERE id = ${expenditureId}
        `;
        result.updated++;
      } else {
        // We need to know the subject_tenant_id for this tenant — see
        // header comment on subject_tenant resolution. The "self"
        // subject_tenant row exists for every tenant (created during
        // tenant onboarding in P0/P1). We deliberately query for it
        // rather than caching, because the connection input doesn't
        // carry it and threading it through the public signature would
        // mis-shape the call site (one connection covers many
        // subject_tenants in future, but the parent expenditure row
        // carries only the firm's self-tenant).
        const subjectTenantRows = (await sql`
          SELECT id FROM subject_tenant
           WHERE tenant_id = ${connection.tenant_id}
           ORDER BY created_at ASC
           LIMIT 1
        `) as Array<{ id: string }>;
        const subjectTenant = subjectTenantRows[0];
        if (!subjectTenant) {
          throw new Error(
            `syncBankTransactions: tenant ${connection.tenant_id} has no subject_tenant — onboarding incomplete`,
          );
        }

        const insertedRows = (await sql`
          INSERT INTO expenditure (
            tenant_id, subject_tenant_id, source, source_external_id,
            vendor_name, reference, expenditure_date, total_amount, currency,
            raw_payload
          ) VALUES (
            ${connection.tenant_id}, ${subjectTenant.id}, 'xero_bank_tx', ${bt.BankTransactionID},
            ${vendorName}, ${reference}, ${expenditureDate}, ${totalAmount}, ${currency},
            ${rawPayload}::jsonb
          )
          RETURNING id
        `) as Array<{ id: string }>;
        const insertedRow = insertedRows[0];
        if (!insertedRow) {
          throw new Error(
            `syncBankTransactions: INSERT into expenditure returned no row (bank-tx=${bt.BankTransactionID})`,
          );
        }
        expenditureId = insertedRow.id;
        wasInsert = true;
        result.inserted++;

        // EXPENDITURE_INGESTED event — only on insert. Match the
        // ExpenditureIngestedPayload schema in @cpa/schemas/event.ts.
        const lineCount = bt.LineItems?.length ?? 0;
        // Boundary-validate the payload (A1 fix #5 pattern). Programming-error
        // guard: any drift in ExpenditureIngestedPayload's shape fails here
        // instead of landing malformed events on the chain.
        const ingestedPayload = ExpenditureIngestedPayload.parse({
          expenditure_id: expenditureId,
          source: 'xero_bank_tx',
          vendor_name: vendorName,
          line_count: lineCount,
        });
        await chainInsert({
          tenant_id: connection.tenant_id,
          subject_tenant_id: subjectTenant.id,
          kind: 'EXPENDITURE_INGESTED',
          payload: ingestedPayload,
          classification: null,
          captured_at: new Date(),
          // Sync worker — no human captured this. The
          // captured_by_user_id NOT NULL convention used in the request
          // path doesn't apply here; chain.ts canonicalises null
          // user_id and null employee_id together for the hash.
          captured_by_user_id: null,
          override_of_event_id: null,
          override_new_kind: null,
          override_reason: null,
        });
        result.events_written++;
        // Track the new id so the orchestrator can fan out the Agent A
        // classifier trigger (apps/api/src/lib/enqueue-classify.ts).
        // Pushed AFTER the chain insert succeeds so a thrown chain write
        // doesn't leave a phantom id pointing at a row that the next sync
        // run would re-insert. Non-null assertion: the field is always
        // seeded at result init; optional `?` on the type is for stubs.
        result.inserted_expenditure_ids!.push(expenditureId);
      }

      // Lines — full-replace. Delete first (no-op on insert; expected on
      // update), then insert the current Xero shape. The route layer's
      // delete+reinsert pattern (per expenditure_line.ts header) is the
      // sanctioned way to mutate lines.
      if (!wasInsert) {
        await sql`DELETE FROM expenditure_line WHERE expenditure_id = ${expenditureId}`;
      }
      const lines = bt.LineItems ?? [];
      for (const line of lines) {
        await sql`
          INSERT INTO expenditure_line (
            expenditure_id, description, account_code, amount
          ) VALUES (
            ${expenditureId}, ${line.Description ?? ''},
            ${line.AccountCode ?? null}, ${toAmountString(line.LineAmount ?? line.UnitAmount)}
          )
        `;
        result.lines++;
      }
    }

    // Short page → done. Xero's documented contract: a full page of
    // PAGE_SIZE items signals more pages remain; anything less means
    // we've hit the end. (Empty pages also terminate.)
    if (bankTxs.length < PAGE_SIZE) break;
    page++;
  }

  return result;
}
