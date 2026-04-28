import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Long-lived R&D undertaking grouping activities across one or more
 * fiscal-year claims. Mirrors the storage shape in
 * `packages/db/src/schema/project.ts` (per design doc §"Core tables").
 *
 * Snake_case JSON keys to match the rest of the wire format. Timestamps
 * are ISO-8601 with offset (audit-anchor convention).
 *
 * `archived_at` is the soft-delete marker — archived projects stay
 * queryable for prior-year claims but are filtered from default active
 * lists.
 */
export const Project = z.object({
  id: Uuid,
  tenant_id: Uuid,
  subject_tenant_id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  started_at: Iso8601,
  ended_at: Iso8601.nullable(),
  archived_at: Iso8601.nullable(),
  created_at: Iso8601,
  updated_at: Iso8601,
});
export type Project = z.infer<typeof Project>;

/**
 * POST /v1/projects body. `description` and `ended_at` are optional —
 * a freshly-created project may have no end date and only a one-line
 * title until the consultant fleshes it out.
 *
 * `tenant_id` is derived from the session, not the body.
 */
export const CreateProjectBody = z.object({
  subject_tenant_id: Uuid,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  started_at: Iso8601,
  ended_at: Iso8601.optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;
