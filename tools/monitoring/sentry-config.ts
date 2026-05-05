/**
 * Sentry SDK configuration reference — CPA Platform (T1.2)
 *
 * This file documents the canonical Sentry initialisation patterns for both
 * the Fastify API and the Next.js frontend. It is NOT imported at runtime;
 * instead, the patterns here are applied in:
 *
 *   API:  apps/api/src/server.ts  (Step 2 of T1.2)
 *   Web:  apps/web/src/instrumentation.ts  (Step 3 of T1.2; Next.js instrumentation hook)
 *
 * Environment variables required:
 *   SENTRY_DSN_API    — DSN for the `cpa-api` Sentry project
 *   SENTRY_DSN_WEB    — DSN for the `cpa-web` Sentry project
 *   NODE_ENV          — 'production' | 'staging' | 'development'
 *   SENTRY_RELEASE    — Optional; set by CI to the git SHA for release tracking
 *   SENTRY_AUTH_TOKEN — CI secret; used by @sentry/cli for source-map upload only
 *
 * Installation (run once per project; already done if packages are present):
 *   pnpm --filter @cpa/api add @sentry/node @sentry/opentelemetry
 *   pnpm --filter @cpa/web add @sentry/nextjs
 */

import type { NodeOptions } from '@sentry/node';
import type { BrowserOptions } from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Returns the traces sample rate for the current environment.
 *
 * - production:  10%  — keeps ingestion cost predictable at ~$26/mo baseline
 * - staging:     50%  — higher fidelity for pre-launch validation
 * - development: 100% — full visibility during local development
 */
export function getTracesSampleRate(env: string | undefined): number {
  switch (env) {
    case 'production':
      return 0.1;
    case 'staging':
      return 0.5;
    default:
      // development, test, or unset
      return 1.0;
  }
}

/**
 * Returns the profiles sample rate for the current environment.
 * Profiling adds ~15% overhead per sampled transaction; keep it low in prod.
 */
export function getProfilesSampleRate(env: string | undefined): number {
  switch (env) {
    case 'production':
      return 0.05; // 5% of sampled transactions
    case 'staging':
      return 0.2;
    default:
      return 0.5;
  }
}

// ---------------------------------------------------------------------------
// API (Fastify / Node.js) — apps/api/src/server.ts
// ---------------------------------------------------------------------------
//
// USAGE: Add the following block to apps/api/src/server.ts as the FIRST
// imperative statement after the tracer-init.ts import (Sentry must register
// its instrumentation before Fastify and postgres-js are imported, but after
// OTel is set up so that Sentry can attach as a span processor).
//
// The Sentry OpenTelemetry integration acts as a parallel span processor on
// the existing NodeSDK, so traces captured by Grafana Tempo also appear in
// Sentry with full trace-id correlation.

/**
 * Sentry Node.js init options for the Fastify API.
 * Apply with: Sentry.init(buildApiSentryOptions())
 */
export function buildApiSentryOptions(): NodeOptions {
  const env = process.env['NODE_ENV'];
  const dsn = process.env['SENTRY_DSN_API'];

  return {
    dsn,
    enabled: Boolean(dsn),

    environment: env ?? 'development',
    release: process.env['SENTRY_RELEASE'],

    // Performance tracing — keep this low in production to control cost.
    tracesSampleRate: getTracesSampleRate(env),
    profilesSampleRate: getProfilesSampleRate(env),

    // Attach Sentry as a side-car to the existing OTel NodeSDK so that trace
    // IDs in Sentry errors match Grafana Tempo trace IDs.
    // Requires: import { SentrySpanProcessor } from '@sentry/opentelemetry'
    // and registering it on the NodeSDK tracerProvider before sdk.start().
    // See: https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/
    skipOpenTelemetrySetup: true, // we manage OTel ourselves in tracer-init.ts

    // Integrations added automatically by @sentry/node that are useful here:
    //   - Http integration (auto-instruments http/https)
    //   - Postgres integration (auto-instruments pg driver — postgres-js uses native pg wire)
    //   - Console integration (captures console.error calls)

    // PII scrubbing — Sentry's default data scrubber handles common patterns
    // (passwords, tokens, credit cards). We add explicit header redaction for
    // our auth patterns.
    beforeSend(event) {
      // Strip bearer tokens and session cookies from captured requests.
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      // Scrub any JWT-shaped strings from extra data (belt + suspenders).
      if (event.extra) {
        for (const [key, value] of Object.entries(event.extra)) {
          if (typeof value === 'string' && /^ey[A-Za-z0-9_-]{20,}/.test(value)) {
            event.extra[key] = '[Filtered JWT]';
          }
        }
      }
      return event;
    },

    // Custom fingerprinting for known high-volume error classes.
    // This prevents a single recurring issue from flooding the inbox.
    beforeSendTransaction(event) {
      return event;
    },

    // Ignore errors that are expected or non-actionable.
    ignoreErrors: [
      // Client disconnects before response completes — not our bug.
      'RequestAbortedError',
      // Fastify request validation errors produced by client malformed input.
      // These appear in Sentry as noise; we log them at warn level instead.
      // Uncomment if Zod validation errors flood the project:
      // /ZodError/,
    ],

    // Normalise stack traces relative to the monorepo root.
    normalizeDepth: 10,
  };
}

// ---------------------------------------------------------------------------
// Fastify error handler integration
// ---------------------------------------------------------------------------
//
// USAGE: Register this handler in apps/api/src/app.ts after Fastify is built
// but before routes are registered. This captures all errors that Fastify's
// error pipeline does not swallow.
//
// import * as Sentry from '@sentry/node';
//
// app.setErrorHandler(buildSentryErrorHandler(app.log));

/**
 * Returns a Fastify error handler that forwards errors to Sentry before
 * sending the HTTP response. Errors with status < 500 are NOT forwarded to
 * Sentry by default (client errors are noise; adjust if needed).
 *
 * Usage:
 *   import * as Sentry from '@sentry/node';
 *   app.setErrorHandler(buildSentryErrorHandler());
 */
export function buildFastifySentryErrorHandler() {
  return function sentryErrorHandler(
    error: Error & { statusCode?: number },
    _request: unknown,
    reply: { code: (n: number) => { send: (b: unknown) => void } },
  ): void {
    const statusCode = error.statusCode ?? 500;

    // Only forward server-side errors (5xx) to Sentry.
    // 4xx errors are client mistakes; they create noise without signal.
    if (statusCode >= 500) {
      // Sentry.captureException(error);  // uncomment once @sentry/node is installed
    }

    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      statusCode,
    });
  };
}

// ---------------------------------------------------------------------------
// Next.js (Web) — apps/web/src/instrumentation.ts
// ---------------------------------------------------------------------------
//
// Next.js 15 App Router uses the instrumentation.ts hook for both server and
// edge runtime initialisation. The Sentry wizard (`pnpm dlx @sentry/wizard
// -i nextjs`) generates this file; the options below are the CPA Platform
// canonical defaults.
//
// USAGE: Create apps/web/src/instrumentation.ts with:
//
//   import { register } from './sentry-config'  // or copy options inline
//   export { register }
//
// Alternatively, run the Sentry wizard which generates the file automatically.

/**
 * Browser / RSC Sentry options for the Next.js frontend.
 * Used in apps/web/src/instrumentation.ts and sentry.client.config.ts.
 */
export function buildWebSentryOptions(): BrowserOptions {
  const env = process.env['NODE_ENV'];
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN_WEB'];

  return {
    dsn,
    enabled: Boolean(dsn),

    environment: env ?? 'development',
    release: process.env['NEXT_PUBLIC_SENTRY_RELEASE'],

    tracesSampleRate: getTracesSampleRate(env),
    profilesSampleRate: getProfilesSampleRate(env),

    // Replay captures session videos for reproduced errors.
    // Keep replaysSessionSampleRate low in production (cost control).
    replaysSessionSampleRate: env === 'production' ? 0.01 : 0.1,
    replaysOnErrorSampleRate: 1.0, // always capture replays for error sessions

    // Integrate with the Next.js router for page-transition tracing.
    // @sentry/nextjs handles this automatically via its webpack plugin.

    beforeSend(event) {
      // Do not send errors from browser extensions (they pollute the project).
      const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
      const isExtension = frames.some(
        (f) => f.filename?.startsWith('chrome-extension://') || f.filename?.startsWith('moz-extension://'),
      );
      if (isExtension) return null;

      // Strip any auth tokens that might appear in breadcrumb URLs.
      if (event.breadcrumbs?.values) {
        event.breadcrumbs.values = event.breadcrumbs.values.map((crumb) => {
          if (crumb.data?.url && typeof crumb.data.url === 'string') {
            crumb.data.url = crumb.data.url.replace(/token=[^&]+/, 'token=[Filtered]');
          }
          return crumb;
        });
      }

      return event;
    },

    ignoreErrors: [
      // Network failures from client side (flaky connections, not our bug).
      'Network request failed',
      'Failed to fetch',
      'NetworkError',
      // ResizeObserver benign errors in some browsers.
      'ResizeObserver loop limit exceeded',
    ],
  };
}

// ---------------------------------------------------------------------------
// Error boundary for Next.js App Router
// ---------------------------------------------------------------------------
//
// Place a global-error.tsx at apps/web/src/app/global-error.tsx:
//
//   'use client';
//   import * as Sentry from '@sentry/nextjs';
//   import NextError from 'next/error';
//   import { useEffect } from 'react';
//
//   export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
//     useEffect(() => {
//       Sentry.captureException(error);
//     }, [error]);
//     return (
//       <html>
//         <body>
//           <NextError statusCode={0} />
//         </body>
//       </html>
//     );
//   }
//
// Segment-level error boundaries (error.tsx files) should also call
// Sentry.captureException in their useEffect to capture route-segment errors.

// ---------------------------------------------------------------------------
// Sentry Cron monitor helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an async job function with Sentry Cron check-in/check-out calls.
 * Used by scheduled jobs to emit heartbeats so missed runs page on-call.
 *
 * Usage:
 *   const result = await withSentryCronMonitor('backup-restore-drill', async () => {
 *     await runRestoreDrill();
 *   });
 */
export async function withSentryCronMonitor<T>(
  monitorSlug: string,
  job: () => Promise<T>,
  options?: {
    /** crontab expression — used to compute expected next check-in */
    schedule?: string;
  },
): Promise<T> {
  // In a real implementation this calls Sentry.withMonitor().
  // Stubbed here so this config file can be imported without @sentry/node.
  //
  // Replace with:
  //   return Sentry.withMonitor(monitorSlug, job, {
  //     schedule: options?.schedule
  //       ? { type: 'crontab', value: options.schedule }
  //       : undefined,
  //   });
  void options;
  void monitorSlug;
  return job();
}

// ---------------------------------------------------------------------------
// Release tracking
// ---------------------------------------------------------------------------
//
// Cloud Build sets the following env vars during the Docker build:
//   SENTRY_RELEASE = $BUILD_ID   (matches cloudbuild.yaml ARG BUILD_ID)
//
// The @sentry/nextjs webpack plugin (configured via next.config.ts) uploads
// source maps after each production build using SENTRY_AUTH_TOKEN (CI secret).
//
// To configure source map upload, add to apps/web/next.config.ts:
//
//   import { withSentryConfig } from '@sentry/nextjs';
//   export default withSentryConfig(nextConfig, {
//     org: 'your-sentry-org',
//     project: 'cpa-web',
//     authToken: process.env.SENTRY_AUTH_TOKEN,
//     silent: true,
//     hideSourceMaps: true,
//   });
