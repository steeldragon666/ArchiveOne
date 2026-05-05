import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';

/**
 * P7 Theme D Section 4.5.7 — Compliance API routes.
 *
 * Eight endpoints under `/v1/compliance/...`:
 *
 *   POST   /v1/compliance/beneficial-ownership
 *   GET    /v1/compliance/beneficial-ownership/:subject_tenant_id/:fy
 *   POST   /v1/compliance/knowledge-search
 *   POST   /v1/compliance/facilities
 *   POST   /v1/compliance/forecast
 *   POST   /v1/compliance/multi-entity-scan
 *   GET    /v1/compliance/form-completeness/:subject_tenant_id/:fy
 *   GET    /v1/compliance/at-risk-summary/:subject_tenant_id/:fy
 *
 * Auth + RLS:
 *   - All routes require a session (`requireSession`).
 *   - Tenant isolation is via the `app.current_tenant_id` GUC set inside
 *     each `sql.begin` for defence-in-depth (connection pool reuse can
 *     leave the GUC unset on next checkout).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ATO General Interest Charge rate (FY24-25 placeholder: 11.22% p.a.) */
const ATO_GIC_RATE = 0.1122;

/** Narrative character-count thresholds per 15 Aug 2025 form spec. */
const NARRATIVE_THRESHOLDS: Record<string, { min: number; max: number }> = {
  hypothesis: { min: 200, max: 3000 },
  experiment: { min: 200, max: 5000 },
  result: { min: 100, max: 3000 },
  conclusion: { min: 100, max: 2000 },
};

// ---------------------------------------------------------------------------
// Zod schemas — input contracts
// ---------------------------------------------------------------------------

const OWNER_KINDS = ['individual', 'company', 'trust', 'partnership', 'other'] as const;

const BeneficialOwnershipInput = z
  .object({
    subject_tenant_id: z.string().uuid(),
    fy_label: z.string().min(1).max(20),
    owner_kind: z.enum(OWNER_KINDS),
    owner_name: z.string().min(1).max(500),
    owner_country: z.string().max(100).optional(),
    ownership_pct: z.number().min(0).max(100),
    is_associate: z.boolean(),
    is_foreign_related: z.boolean(),
  })
  .strict();

const KnowledgeSearchInput = z
  .object({
    subject_tenant_id: z.string().uuid(),
    activity_id: z.string().uuid(),
    search_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date (YYYY-MM-DD)'),
    search_query: z.string().min(1).max(2000),
    sources_consulted: z.array(z.string().min(1).max(500)),
    finding_summary: z.string().min(1).max(10000),
  })
  .strict();

const FacilityInput = z
  .object({
    subject_tenant_id: z.string().uuid(),
    fy_label: z.string().min(1).max(20),
    facility_name: z.string().min(1).max(500),
    address: z.string().min(1).max(1000),
    is_owned: z.boolean(),
    used_for_activity_ids: z.array(z.string().uuid()),
  })
  .strict();

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
const FORECAST_OFFSETS = [1, 2, 3] as const;

const ForecastInput = z
  .object({
    subject_tenant_id: z.string().uuid(),
    base_fy_label: z.string().min(1).max(20),
    forecast_year_offset: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    projected_spend_aud: z.number().min(0),
    projected_headcount: z.number().int().min(0),
    confidence: z.enum(CONFIDENCE_LEVELS),
  })
  .strict();

const MultiEntityScanInput = z
  .object({
    subject_tenant_id: z.string().uuid(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerCompliance(app: FastifyInstance): void {
  // -------------------------------------------------------------------
  // 1. POST /v1/compliance/beneficial-ownership
  // -------------------------------------------------------------------
  app.post(
    '/v1/compliance/beneficial-ownership',
    { preHandler: requireSession },
    async (req, reply) => {
      const parsed = BeneficialOwnershipInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          requestId: req.id,
        });
      }

      const tenantId = req.user!.tenantId!;
      const body = parsed.data;
      const id = crypto.randomUUID();

      const inserted = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx`
        INSERT INTO beneficial_ownership (
          id, tenant_id, subject_tenant_id, fy_label, owner_kind,
          owner_name, owner_country, ownership_pct, is_associate, is_foreign_related
        )
        VALUES (
          ${id}, ${tenantId}, ${body.subject_tenant_id}, ${body.fy_label},
          ${body.owner_kind}, ${body.owner_name}, ${body.owner_country ?? null},
          ${body.ownership_pct}, ${body.is_associate}, ${body.is_foreign_related}
        )
        RETURNING *
      `;
        return rows[0];
      });

      if (!inserted) {
        return reply.status(500).send({ error: 'insert_failed', requestId: req.id });
      }

      return reply.status(201).send(inserted);
    },
  );

  // -------------------------------------------------------------------
  // 2. GET /v1/compliance/beneficial-ownership/:subject_tenant_id/:fy
  // -------------------------------------------------------------------
  app.get<{ Params: { subject_tenant_id: string; fy: string } }>(
    '/v1/compliance/beneficial-ownership/:subject_tenant_id/:fy',
    { preHandler: requireSession },
    async (req, reply) => {
      const { subject_tenant_id, fy } = req.params;
      if (!z.string().uuid().safeParse(subject_tenant_id).success) {
        return reply.status(400).send({ error: 'invalid subject_tenant_id', requestId: req.id });
      }

      const tenantId = req.user!.tenantId!;

      const rows = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return await tx`
          SELECT id, tenant_id, subject_tenant_id, fy_label, owner_kind,
                 owner_name, owner_country, ownership_pct, is_associate,
                 is_foreign_related, ta_2023_4_flag, ta_2023_5_flag,
                 created_at, updated_at
            FROM beneficial_ownership
           WHERE subject_tenant_id = ${subject_tenant_id}
             AND fy_label = ${fy}
             AND tenant_id = ${tenantId}
           ORDER BY created_at ASC
        `;
      });

      return { rows };
    },
  );

  // -------------------------------------------------------------------
  // 3. POST /v1/compliance/knowledge-search
  // -------------------------------------------------------------------
  app.post(
    '/v1/compliance/knowledge-search',
    { preHandler: requireSession },
    async (req, reply) => {
      const parsed = KnowledgeSearchInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          requestId: req.id,
        });
      }

      const tenantId = req.user!.tenantId!;
      const body = parsed.data;
      const id = crypto.randomUUID();

      const inserted = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx`
        INSERT INTO knowledge_search_record (
          id, tenant_id, subject_tenant_id, activity_id, search_date,
          search_query, sources_consulted, finding_summary
        )
        VALUES (
          ${id}, ${tenantId}, ${body.subject_tenant_id}, ${body.activity_id},
          ${body.search_date}::date, ${body.search_query},
          ${JSON.stringify(body.sources_consulted)}::text::jsonb,
          ${body.finding_summary}
        )
        RETURNING *
      `;
        return rows[0];
      });

      if (!inserted) {
        return reply.status(500).send({ error: 'insert_failed', requestId: req.id });
      }

      return reply.status(201).send(inserted);
    },
  );

  // -------------------------------------------------------------------
  // 4. POST /v1/compliance/facilities
  // -------------------------------------------------------------------
  app.post('/v1/compliance/facilities', { preHandler: requireSession }, async (req, reply) => {
    const parsed = FacilityInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
        requestId: req.id,
      });
    }

    const tenantId = req.user!.tenantId!;
    const body = parsed.data;
    const id = crypto.randomUUID();

    const inserted = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx`
        INSERT INTO r_and_d_facility (
          id, tenant_id, subject_tenant_id, fy_label, facility_name,
          address, is_owned, used_for_activity_ids
        )
        VALUES (
          ${id}, ${tenantId}, ${body.subject_tenant_id}, ${body.fy_label},
          ${body.facility_name}, ${body.address}, ${body.is_owned},
          ${JSON.stringify(body.used_for_activity_ids)}::text::jsonb
        )
        RETURNING *
      `;
      return rows[0];
    });

    if (!inserted) {
      return reply.status(500).send({ error: 'insert_failed', requestId: req.id });
    }

    return reply.status(201).send(inserted);
  });

  // -------------------------------------------------------------------
  // 5. POST /v1/compliance/forecast
  //    ON CONFLICT on the UNIQUE constraint → UPDATE
  // -------------------------------------------------------------------
  app.post('/v1/compliance/forecast', { preHandler: requireSession }, async (req, reply) => {
    const parsed = ForecastInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
        requestId: req.id,
      });
    }

    const tenantId = req.user!.tenantId!;
    const body = parsed.data;
    const id = crypto.randomUUID();

    const upserted = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const rows = await tx`
        INSERT INTO rd_forecast (
          id, tenant_id, subject_tenant_id, base_fy_label,
          forecast_year_offset, projected_spend_aud, projected_headcount, confidence
        )
        VALUES (
          ${id}, ${tenantId}, ${body.subject_tenant_id}, ${body.base_fy_label},
          ${body.forecast_year_offset}, ${body.projected_spend_aud},
          ${body.projected_headcount}, ${body.confidence}
        )
        ON CONFLICT (tenant_id, subject_tenant_id, base_fy_label, forecast_year_offset)
        DO UPDATE SET
          projected_spend_aud = EXCLUDED.projected_spend_aud,
          projected_headcount = EXCLUDED.projected_headcount,
          confidence = EXCLUDED.confidence,
          updated_at = NOW()
        RETURNING *
      `;
      return rows[0];
    });

    if (!upserted) {
      return reply.status(500).send({ error: 'upsert_failed', requestId: req.id });
    }

    return reply.status(201).send(upserted);
  });

  // -------------------------------------------------------------------
  // 6. POST /v1/compliance/multi-entity-scan (STUB)
  //    Future: enqueue via pg-boss for the multi-entity-similarity agent (D.3)
  // -------------------------------------------------------------------
  app.post(
    '/v1/compliance/multi-entity-scan',
    { preHandler: requireSession },
    async (req, reply) => {
      const parsed = MultiEntityScanInput.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          requestId: req.id,
        });
      }

      // STUB — in the future this will use pg-boss to enqueue the job.
      return reply.status(202).send({
        status: 'queued',
        message: 'Multi-entity similarity scan queued',
      });
    },
  );

  // -------------------------------------------------------------------
  // 7. GET /v1/compliance/form-completeness/:subject_tenant_id/:fy
  //    Cross-checks multiple tables for form submission readiness.
  // -------------------------------------------------------------------
  app.get<{ Params: { subject_tenant_id: string; fy: string } }>(
    '/v1/compliance/form-completeness/:subject_tenant_id/:fy',
    { preHandler: requireSession },
    async (req, reply) => {
      const { subject_tenant_id, fy } = req.params;
      if (!z.string().uuid().safeParse(subject_tenant_id).success) {
        return reply.status(400).send({ error: 'invalid subject_tenant_id', requestId: req.id });
      }

      const tenantId = req.user!.tenantId!;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // (a) All activities for this subject+fy
        const activities = await tx<{ id: string }[]>`
          SELECT id FROM activity
           WHERE subject_tenant_id = ${subject_tenant_id}
             AND fy_label = ${fy}
             AND tenant_id = ${tenantId}
        `;
        const activityIds = activities.map((a) => a.id);

        // (a) Activities with at least 1 knowledge_search_record
        let activitiesWithSearch: string[] = [];
        if (activityIds.length > 0) {
          const searchRows = await tx<{ activity_id: string }[]>`
            SELECT DISTINCT activity_id
              FROM knowledge_search_record
             WHERE activity_id = ANY(${activityIds})
               AND tenant_id = ${tenantId}
          `;
          activitiesWithSearch = searchRows.map((r) => r.activity_id);
        }
        const missingSearchActivityIds = activityIds.filter(
          (id) => !activitiesWithSearch.includes(id),
        );

        // (b) Beneficial ownership populated for the FY
        const boRows = await tx<{ count: string }[]>`
          SELECT COUNT(*)::text AS count
            FROM beneficial_ownership
           WHERE subject_tenant_id = ${subject_tenant_id}
             AND fy_label = ${fy}
             AND tenant_id = ${tenantId}
        `;
        const boCount = parseInt(boRows[0]?.count ?? '0', 10);

        // (c) rd_forecast populated for offsets 1, 2, 3
        const forecastRows = await tx<{ forecast_year_offset: number }[]>`
          SELECT forecast_year_offset
            FROM rd_forecast
           WHERE subject_tenant_id = ${subject_tenant_id}
             AND base_fy_label = ${fy}
             AND tenant_id = ${tenantId}
        `;
        const existingOffsets = forecastRows.map((r) => r.forecast_year_offset);
        const missingOffsets = FORECAST_OFFSETS.filter((o) => !existingOffsets.includes(o));

        // (d) r_and_d_facility populated (at least 1 row)
        const facilityRows = await tx<{ count: string }[]>`
          SELECT COUNT(*)::text AS count
            FROM r_and_d_facility
           WHERE subject_tenant_id = ${subject_tenant_id}
             AND fy_label = ${fy}
             AND tenant_id = ${tenantId}
        `;
        const facilityCount = parseInt(facilityRows[0]?.count ?? '0', 10);

        // (e) Narrative char counts within thresholds
        interface NarrativeRow {
          activity_id: string;
          section_kind: string;
          content: string | null;
        }
        const narrativeWarnings: {
          activity_id: string;
          field: string;
          current_length: number;
          min_required: number;
          max_allowed: number;
        }[] = [];

        if (activityIds.length > 0) {
          const narrativeRows = await tx<NarrativeRow[]>`
            SELECT activity_id, section_kind, content
              FROM narrative_draft
             WHERE activity_id = ANY(${activityIds})
               AND tenant_id = ${tenantId}
          `;

          for (const row of narrativeRows) {
            const threshold = NARRATIVE_THRESHOLDS[row.section_kind];
            if (!threshold) continue;
            const length = (row.content ?? '').length;
            if (length < threshold.min || length > threshold.max) {
              narrativeWarnings.push({
                activity_id: row.activity_id,
                field: row.section_kind,
                current_length: length,
                min_required: threshold.min,
                max_allowed: threshold.max,
              });
            }
          }
        }

        const knowledgeSearchComplete =
          missingSearchActivityIds.length === 0 && activityIds.length > 0;
        const beneficialOwnershipComplete = boCount >= 1;
        const forecastComplete = missingOffsets.length === 0;
        const facilitiesComplete = facilityCount >= 1;
        const narrativesComplete = narrativeWarnings.length === 0 && activityIds.length > 0;

        const complete =
          knowledgeSearchComplete &&
          beneficialOwnershipComplete &&
          forecastComplete &&
          facilitiesComplete &&
          narrativesComplete;

        return {
          complete,
          checks: {
            knowledge_search: {
              complete: knowledgeSearchComplete,
              missing_activity_ids: missingSearchActivityIds,
            },
            beneficial_ownership: {
              complete: beneficialOwnershipComplete,
              count: boCount,
            },
            forecast: {
              complete: forecastComplete,
              missing_offsets: missingOffsets,
            },
            facilities: {
              complete: facilitiesComplete,
              count: facilityCount,
            },
            narratives: {
              complete: narrativesComplete,
              warnings: narrativeWarnings,
            },
          },
        };
      });

      return result;
    },
  );

  // -------------------------------------------------------------------
  // 8. GET /v1/compliance/at-risk-summary/:subject_tenant_id/:fy
  //    Returns risk summary per activity with GIC-based clawback estimate.
  // -------------------------------------------------------------------
  app.get<{ Params: { subject_tenant_id: string; fy: string } }>(
    '/v1/compliance/at-risk-summary/:subject_tenant_id/:fy',
    { preHandler: requireSession },
    async (req, reply) => {
      const { subject_tenant_id, fy } = req.params;
      if (!z.string().uuid().safeParse(subject_tenant_id).success) {
        return reply.status(400).send({ error: 'invalid subject_tenant_id', requestId: req.id });
      }

      const tenantId = req.user!.tenantId!;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Activities with their expenditure totals for the subject+fy
        interface ActivityExpRow {
          activity_id: string;
          title: string;
          claimed_amount: string;
        }

        const activityRows = await tx<ActivityExpRow[]>`
          SELECT
            a.id AS activity_id,
            a.title,
            COALESCE(SUM(e.amount_aud), 0)::text AS claimed_amount
          FROM activity a
          LEFT JOIN expenditure e
            ON e.activity_id = a.id
            AND e.tenant_id = ${tenantId}
          WHERE a.subject_tenant_id = ${subject_tenant_id}
            AND a.fy_label = ${fy}
            AND a.tenant_id = ${tenantId}
          GROUP BY a.id, a.title
          ORDER BY a.title ASC
        `;

        let totalClaimed = 0;
        let totalAtRisk = 0;

        const activities = activityRows.map((row) => {
          const claimed = parseFloat(row.claimed_amount);
          const atRisk = claimed; // conservative: entire claimed amount at risk
          const clawback4yr = claimed * ATO_GIC_RATE * 4;

          totalClaimed += claimed;
          totalAtRisk += atRisk;

          return {
            activity_id: row.activity_id,
            title: row.title,
            claimed_amount: claimed,
            at_risk_amount: atRisk,
            clawback_4yr: Math.round(clawback4yr * 100) / 100,
          };
        });

        return {
          subject_tenant_id,
          fy_label: fy,
          total_claimed: totalClaimed,
          total_at_risk: totalAtRisk,
          activities,
        };
      });

      return result;
    },
  );
}

// ─── Internal exports for testing ─────────────────────────────────────
export const _internals = {
  BeneficialOwnershipInput,
  KnowledgeSearchInput,
  FacilityInput,
  ForecastInput,
  MultiEntityScanInput,
  ATO_GIC_RATE,
  NARRATIVE_THRESHOLDS,
  OWNER_KINDS,
  CONFIDENCE_LEVELS,
  FORECAST_OFFSETS,
};
