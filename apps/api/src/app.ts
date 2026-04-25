import Fastify from 'fastify';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createLogger } from '@cpa/observability';
import { healthRoutes } from './routes/health.js';

/**
 * The Fastify app type, widened to FastifyBaseLogger for portability
 * (pino satisfies FastifyBaseLogger structurally). This widening is
 * what lets us return a stable type from buildApp() without leaking
 * pino through the public surface.
 *
 * The Logger generic is widened to `FastifyBaseLogger` (Fastify's own
 * interface) rather than the underlying pino type. Pino satisfies the
 * structural shape, but referencing pino here would leak its type-only
 * dependency from `@cpa/observability` into our public `buildApp`
 * signature — `tsc` rejects that as non-portable. `FastifyBaseLogger`
 * captures everything we use (`info`, `error`, `child`).
 *
 * Tests import this directly: `import { buildApp, type App } from '../app.js';`
 * No barrel — apps don't expose internal types as a package surface.
 */
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  ZodTypeProvider
>;

/**
 * Build the Fastify app instance.
 *
 * Pure factory — does NOT start listening. Tests call this directly and
 * use `app.inject()` for in-process request/response. The bootstrap
 * (`server.ts`) calls `app.listen()` separately.
 *
 * The cast at the end widens Fastify's pino-specific instance type to
 * `App` (which uses `FastifyBaseLogger`). Pino is structurally
 * compatible — Fastify just narrows the generic when you pass
 * `loggerInstance`, which would otherwise leak the pino dependency
 * through our public signature.
 */
export function buildApp(): App {
  const logger = createLogger({ serviceName: 'api' });

  const app = Fastify({
    loggerInstance: logger,
    // Trust X-Forwarded-* only in production where we sit behind a managed
    // load balancer (App Runner / ECS Fargate / Cloudflare). In dev, blanket
    // trust would let an attacker spoof client IPs via X-Forwarded-For.
    trustProxy: process.env.NODE_ENV === 'production',
    // Force-close idle connections at app.close() so SIGTERM doesn't hang
    // on a slow/long-poll request and let the orchestrator SIGKILL us
    // before the trace flush. In-flight requests still get to finish.
    forceCloseConnections: 'idle',
    // Audit-correlation request IDs as v4 UUIDs, matching the @cpa/schemas
    // Uuid contract. Pino's request log line includes reqId automatically.
    // P1's identity layer can swap to ULIDs later without restructuring.
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(healthRoutes);

  // Single error envelope across all routes — { error, message, requestId }.
  // Errors with a numeric `statusCode` use that; everything else 500s.
  // The shape will be formalised in @cpa/schemas in P1; for now this is
  // the convention.
  app.setErrorHandler((err, req, reply) => {
    // The typed-provider chain widens err to `unknown`; treat it as an
    // Error-shaped object with optional statusCode. All thrown values
    // we surface here originate from Fastify or our own routes, both of
    // which produce Error instances, so .name/.message are present.
    const e = err as Error & { statusCode?: number };
    const status = e.statusCode ?? 500;
    if (status >= 500) {
      app.log.error({ err: e, reqId: req.id }, 'request failed');
    } else {
      app.log.warn({ err: e, reqId: req.id }, 'request failed');
    }
    void reply.code(status).send({
      error: e.name || 'InternalServerError',
      message: e.message,
      requestId: req.id,
    });
  });

  // Double-cast through `unknown` is required because of two interacting
  // TypeScript strictness settings in tsconfig.base.json:
  //   1. `loggerInstance: pino.Logger` narrows Fastify's `Logger` generic
  //      to `pino.Logger` (not the wider `FastifyBaseLogger`).
  //   2. `exactOptionalPropertyTypes: true` prevents widening that narrow
  //      back to `FastifyBaseLogger` at the `as App` boundary.
  // We deliberately widen here so callers (incl. tests) consume `App`
  // without leaking pino through the public surface. Verified empirically:
  // direct `app as App` fails with TS2352. See P0 review item I3.
  return app as unknown as App;
}
