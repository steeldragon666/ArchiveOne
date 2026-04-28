/**
 * Xero Accounting integration shapes (T-B1).
 *
 * Xero exposes a single Accounting API at `/api.xro/2.0/<resource>`. This
 * module covers the read/write surface used by the Expenditure swimlane:
 * Invoices (bills), Contacts (suppliers), and Accounts (chart-of-accounts
 * settings). Subsequent tasks (B2+) layer the actual client methods on
 * top of the OAuth scaffolding established here.
 *
 * Design notes — same plumbing as `payroll/xero-payroll`, different
 * domain. Re-stating the relevant Xero quirks for code-search-friendliness:
 *
 *   1. **PKCE OAuth 2.0**: Xero is the only provider in this codebase
 *      that requires PKCE (RFC 7636) — even confidential clients must
 *      include a `code_challenge` on authorize and `code_verifier` on
 *      token exchange. `client_secret` is *optional* for public clients
 *      but supported for confidential ones (this codebase's case).
 *
 *   2. **Tenant-id header**: After OAuth, the access token is not bound
 *      to a specific organisation — the user may have authorized
 *      multiple Xero orgs (tenants). The flow is: exchange code → call
 *      `GET https://api.xero.com/connections` → discover an array of
 *      `{ tenantId, tenantName, tenantType }` → pick one → pass on every
 *      API call as the `Xero-tenant-id` header. We persist the chosen
 *      tenant_id onto `integration_connection.external_account_id` and
 *      surface it through the client as `xero_tenant_id`.
 *
 *   3. **`/Date(epoch+0000)/` wire format**: Xero Accounting returns dates
 *      as Microsoft JSON Date strings — `/Date(1234567890000+0000)/` —
 *      where the inner number is unix milliseconds. Some endpoints
 *      return plain ISO 8601 instead. Subsequent tasks will share a
 *      `parseXeroDate` helper across the payroll + accounting clients;
 *      for B1 we only need the OAuth scaffolding.
 *
 *   4. **Naming convention**: Xero's wire format is **PascalCase**.
 *      Internal codebase types remain snake_case; sync helpers translate.
 *
 *   5. **Provider key**: stored on `integration_connection.provider` as
 *      `xero_accounting` (distinct from the `xero_payroll` rows the
 *      payroll integration writes — same Xero account can connect both
 *      simultaneously without overwriting tokens).
 */

export type XeroAccountingAuthConfig = {
  client_id: string;
  /** Optional with PKCE — public clients omit. */
  client_secret?: string;
  redirect_uri: string;
};

/**
 * Xero OAuth + API endpoints. Xero splits the OAuth surface: authorize
 * lives on the identity host (`login.xero.com` / `identity.xero.com`),
 * while the API root is `api.xero.com`. The Accounting API lives at
 * `/api.xro/2.0/` (vs Payroll AU's `/payroll.xro/1.0/`).
 */
export const XERO_OAUTH_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
export const XERO_OAUTH_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

/**
 * Minimum scopes for the Expenditure swimlane v1:
 *   - `offline_access` — required for a refresh_token.
 *   - `accounting.transactions` — Invoices/Bills, BankTransactions, etc.
 *   - `accounting.contacts` — Contacts (suppliers/customers).
 *   - `accounting.settings` — Accounts (chart-of-accounts), tax rates.
 *
 * Xero's scope model is per-resource — each domain has its own scope.
 * Read-only variants exist (e.g. `accounting.transactions.read`); the
 * plan calls for the read+write scopes because B-series tasks need to
 * push transactions back into Xero (categorisation, reconciliation).
 */
export const XERO_ACCOUNTING_SCOPES = [
  'accounting.transactions',
  'accounting.contacts',
  'accounting.settings',
  'offline_access',
] as const;

/**
 * Provider key written to `integration_connection.provider`. Matches the
 * F4 schema decision — distinct from `xero_payroll` so a single Xero
 * account can power both swimlanes without overwriting credentials.
 */
export const XERO_ACCOUNTING_PROVIDER = 'xero_accounting' as const;
