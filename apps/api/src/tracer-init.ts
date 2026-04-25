/**
 * OTel SDK initialiser — must be imported FIRST in any executable entrypoint.
 *
 * ESM evaluates dependency leaves before the importing module's body, so
 * importing this file from server.ts causes startTracing() to run BEFORE
 * server.ts imports app.ts (which imports fastify, pino, postgres). That
 * ordering lets getNodeAutoInstrumentations() patch those modules at
 * load-time rather than after-the-fact — for the CJS modules in the graph.
 *
 * RESIDUAL ISSUE (P1 follow-up):
 * @opentelemetry/instrumentation uses require-in-the-middle, which only
 * intercepts CommonJS require() calls. Because apps/api is "type":"module"
 * and statically imports fastify/pino, those modules' ESM records are
 * linked at graph-build time — before any patching can occur. The diag
 * messages "Module fastify has been loaded before
 * @opentelemetry/instrumentation-fastify" persist as a result.
 *
 * The proper full fix is to launch the API process with
 *   node --import @opentelemetry/instrumentation/hook.mjs ./dist/server.js
 * (or the equivalent NODE_OPTIONS env var). That registers the OTel
 * loader hook BEFORE the entrypoint module's static graph is linked.
 * Tracked as I1-residual; addressed in a follow-up scope-expansion task
 * once the package.json `start` script and Dockerfile are touched.
 *
 * Surfaced by P0 final-review item I1.
 */
import { startTracing } from '@cpa/observability';

// Explicit type annotation avoids TS2742 (inferred NodeSDK type is non-portable
// because @opentelemetry/sdk-node is only reachable transitively via
// @cpa/observability's node_modules). ReturnType keeps apps/api decoupled from
// OTel's internal types.
export const sdk: ReturnType<typeof startTracing> = startTracing({
  serviceName: 'api',
  serviceVersion: '0.0.0',
});
