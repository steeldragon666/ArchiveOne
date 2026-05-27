/**
 * Wizard Step 2 — IP-search route barrel.
 *
 * Registers all six endpoints in a single plugin scope so a single
 * `app.register(registerIpSearchRoutes)` call in `app.ts` wires the
 * whole feature. Each sub-file owns one handler; the split is purely
 * organisational — they share `requireSession`, sql, and the agent
 * orchestration helpers in `helpers.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { registerIpSearchQueries } from './queries.js';
import { registerIpSearchRun } from './run.js';
import { registerIpSearchVerdict } from './verdict.js';
import { registerIpSearchApprove } from './approve.js';
import { registerIpSearchOverride } from './override.js';
import { registerIpSearchList } from './list.js';

export function registerIpSearch(app: FastifyInstance): void {
  registerIpSearchQueries(app);
  registerIpSearchRun(app);
  registerIpSearchVerdict(app);
  registerIpSearchApprove(app);
  registerIpSearchOverride(app);
  registerIpSearchList(app);
}
