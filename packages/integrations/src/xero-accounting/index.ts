// Xero Accounting integration (T-B1).
//
// Imported via the `@cpa/integrations/xero-accounting` subpath export.
// B1 ships the OAuth scaffolding and a shared HTTP helper; subsequent
// tasks (B2-B12) layer resource-specific list/create methods on top.
export * from './types.js';
export * from './oauth.js';
export { parseXeroDate, xeroAccountingGet, type XeroAccountingClientOptions } from './client.js';
