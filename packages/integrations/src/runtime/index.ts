export * from './types.js';
export * from './oauth.js';
export * from './webhook-verify.js';
export * from './retry.js';
export { tryAcquire } from './rate-limit.js';
export * from './email.js';
export * from './crypto.js';
export * from './time-entry-conflict.js';
export * from './dns-resolver.js';

// Per-provider re-exports — namespaced to avoid type/value name
// collisions across providers (e.g. each Xero module exports its own
// `XeroConnection` type and `buildAuthUrl` function). T-B7 will use
// these aliases when injecting the `XERO_IMPL=stub` branch into route
// handlers; until then the canonical import path remains the subpath
// export `@cpa/integrations/xero-accounting`.
export * as xeroAccounting from '../xero-accounting/index.js';
