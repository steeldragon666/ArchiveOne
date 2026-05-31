import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { insertEventWithChain, nextActivityCode } from '@cpa/db';
import { sql } from '@cpa/db/client';

/**
 * Register the "accept proposal" routes which materialise the AI document
 * extractor's suggestions:
 *   - POST /v1/proposed-activities/:event_id/accept  — create an activity
 *   - POST /v1/proposed-invoices/:event_id/accept    — create an expenditure
 *
 * Both routes are gated by extraction_status='complete' and locate the
 * most-recent open claim for the event's subject_tenant (claims in stage
 * 'submitted' or 'audit_defence' are excluded).
 */
export function registerEventsProposed(app: FastifyInstance): void {
  // -----------------------------------------------------------------------
  // POST /v1/proposed-activities/:event_id/accept
  // Accept one activity proposal from extracted_content. Creates the activity
  // via the existing POST /v1/activities logic.
  // -----------------------------------------------------------------------
  app.post<{ Params: { event_id: string } }>(
    '/v1/proposed-activities/:event_id/accept',
    { preHandler: requireSession },
    async (req, reply) => {
      const { event_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const body = req.body as { activity_index: number; claim_id?: string };

      if (typeof body.activity_index !== 'number' || !Number.isInteger(body.activity_index)) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must include { activity_index: number }',
          requestId: req.id,
        });
      }

      // 1. Load event + extracted content under RLS.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${event_id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      if (row.extraction_status !== 'complete') {
        return reply.status(422).send({
          error: 'extraction_incomplete',
          message: 'Document extraction not yet complete for this event',
          requestId: req.id,
        });
      }

      const content = row.extracted_content as {
        activities?: unknown[];
        invoices?: unknown[];
      } | null;
      const proposals = content?.activities ?? [];

      if (body.activity_index < 0 || body.activity_index >= proposals.length) {
        return reply.status(400).send({
          error: 'invalid_index',
          message: `activity_index ${body.activity_index} out of range (${proposals.length} proposals)`,
          requestId: req.id,
        });
      }

      const proposal = proposals[body.activity_index] as {
        proposed_name: string;
        proposed_kind: 'core' | 'supporting';
        hypothesis_text: string;
        technical_uncertainty: string;
        expected_outcome: string;
        confidence: number;
        rationale: string;
      };

      // 2. Find the active claim for this subject_tenant.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; project_id: string; fiscal_year: number }[]>`
          SELECT c.id, c.project_id, c.fiscal_year
            FROM claim c
           WHERE c.subject_tenant_id = ${row.subject_tenant_id}
             AND c.tenant_id         = ${tenantId}
             AND c.stage NOT IN ('submitted', 'audit_defence')
           ORDER BY c.fiscal_year DESC
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!claimRow) {
        return reply.status(422).send({
          error: 'no_active_claim',
          message: 'No active claim found for this subject tenant — create a claim first',
          requestId: req.id,
        });
      }

      // 3. Generate activity code + insert activity + emit chain events.
      // fy_label: derived from claim.fiscal_year exactly as activities.ts does
      // (e.g. fiscal_year=2025 → 'FY25'). hypothesis_formed_at must be an
      // explicit timestamp — the column has no DEFAULT by design (migration 0037).
      const insertChain = insertEventWithChain;

      const code = await nextActivityCode({
        claim_id: claimRow.id,
        kind: proposal.proposed_kind,
      });

      const activityId = crypto.randomUUID();
      const now = new Date().toISOString();
      const fyLabel = `FY${(claimRow.fiscal_year - 2000).toString().padStart(2, '0')}`;
      const hypothesisFormedAt = now;

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          INSERT INTO activity (
            id, tenant_id, project_id, claim_id, code, kind,
            title, hypothesis, technical_uncertainty, expected_outcome,
            fy_label, hypothesis_formed_at
          ) VALUES (
            ${activityId}::uuid,
            ${tenantId}::uuid,
            ${claimRow.project_id}::uuid,
            ${claimRow.id}::uuid,
            ${code},
            ${proposal.proposed_kind},
            ${proposal.proposed_name},
            ${proposal.hypothesis_text},
            ${proposal.technical_uncertainty},
            ${proposal.expected_outcome},
            ${fyLabel},
            ${hypothesisFormedAt}::timestamptz
          )
        `;
      });

      // Emit ACTIVITY_CREATED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'ACTIVITY_CREATED',
        payload: {
          _v: 1,
          activity_id: activityId,
          code,
          kind: proposal.proposed_kind,
          title: proposal.proposed_name,
          project_id: claimRow.project_id,
          claim_id: claimRow.id,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit ARTEFACT_LINKED chain event to link source document.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'ARTEFACT_LINKED',
        payload: {
          _v: 1,
          activity_id: activityId,
          artefact_kind: 'event',
          artefact_id: event_id,
          link_reason: `Auto-linked from AI document extraction (proposal index ${body.activity_index})`,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit PROPOSED_ACTIVITY_ACCEPTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'SUPPORTING',
        payload: {
          _v: 1,
          source: 'proposed_activity_accepted',
          source_event_id: event_id,
          activity_index: body.activity_index,
          activity_id: activityId,
          activity_code: code,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(201).send({
        activity_id: activityId,
        code,
        kind: proposal.proposed_kind,
        title: proposal.proposed_name,
        claim_id: claimRow.id,
        created_at: now,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/proposed-invoices/:event_id/accept
  // Accept one invoice proposal from extracted_content. Creates an expenditure.
  // -----------------------------------------------------------------------
  app.post<{ Params: { event_id: string } }>(
    '/v1/proposed-invoices/:event_id/accept',
    { preHandler: requireSession },
    async (req, reply) => {
      const { event_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const body = req.body as { invoice_index: number; project_id?: string };

      if (typeof body.invoice_index !== 'number' || !Number.isInteger(body.invoice_index)) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must include { invoice_index: number }',
          requestId: req.id,
        });
      }

      // 1. Load event + extracted content under RLS.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${event_id}
             AND tenant_id = ${tenantId}
        `;
        return rows[0] ?? null;
      });

      if (!row) {
        return reply.status(404).send({
          error: 'event_not_found',
          message: 'No event with that id in this firm',
          requestId: req.id,
        });
      }

      if (row.extraction_status !== 'complete') {
        return reply.status(422).send({
          error: 'extraction_incomplete',
          message: 'Document extraction not yet complete for this event',
          requestId: req.id,
        });
      }

      const content = row.extracted_content as {
        invoices?: unknown[];
      } | null;
      const proposals = content?.invoices ?? [];

      if (body.invoice_index < 0 || body.invoice_index >= proposals.length) {
        return reply.status(400).send({
          error: 'invalid_index',
          message: `invoice_index ${body.invoice_index} out of range (${proposals.length} proposals)`,
          requestId: req.id,
        });
      }

      const invoice = proposals[body.invoice_index] as {
        vendor_name: string;
        invoice_date: string;
        amount_aud: number;
        gst_aud: number | null;
        total_aud: number;
        invoice_number: string | null;
        line_items: Array<{ description: string; amount_aud: number }>;
      };

      // 2. Find the active claim.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; project_id: string }[]>`
          SELECT c.id, c.project_id
            FROM claim c
           WHERE c.subject_tenant_id = ${row.subject_tenant_id}
             AND c.tenant_id         = ${tenantId}
             AND c.stage NOT IN ('submitted', 'audit_defence')
           ORDER BY c.fiscal_year DESC
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!claimRow) {
        return reply.status(422).send({
          error: 'no_active_claim',
          message: 'No active claim found — create a claim first',
          requestId: req.id,
        });
      }

      // 3. Insert expenditure + line items.
      const insertChain = insertEventWithChain;
      const expenditureId = crypto.randomUUID();

      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        await tx`
          INSERT INTO expenditure (
            id, tenant_id, subject_tenant_id, claim_id,
            vendor_name, reference,
            expenditure_date,
            total_amount, currency,
            source, ingested_at
          ) VALUES (
            ${expenditureId}::uuid,
            ${tenantId}::uuid,
            ${row.subject_tenant_id}::uuid,
            ${claimRow.id}::uuid,
            ${invoice.vendor_name},
            ${invoice.invoice_number ?? null},
            ${invoice.invoice_date}::date,
            ${String(invoice.total_aud)},
            'AUD',
            'manual',
            NOW()
          )
        `;

        // Insert line items if present.
        for (const [idx, li] of (invoice.line_items ?? []).entries()) {
          await tx`
            INSERT INTO expenditure_line (
              id, expenditure_id,
              line_number, description, amount
            ) VALUES (
              ${crypto.randomUUID()}::uuid,
              ${expenditureId}::uuid,
              ${idx + 1},
              ${li.description},
              ${String(li.amount_aud)}
            )
          `;
        }
      });

      // Emit EXPENDITURE_INGESTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'EXPENDITURE_INGESTED',
        payload: {
          _v: 1,
          expenditure_id: expenditureId,
          source: 'manual',
          vendor_name: invoice.vendor_name,
          line_count: invoice.line_items?.length ?? 0,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      // Emit PROPOSED_INVOICE_ACCEPTED chain event.
      await insertChain({
        tenant_id: tenantId,
        subject_tenant_id: row.subject_tenant_id,
        kind: 'SUPPORTING',
        payload: {
          _v: 1,
          source: 'proposed_invoice_accepted',
          source_event_id: event_id,
          invoice_index: body.invoice_index,
          expenditure_id: expenditureId,
          vendor_name: invoice.vendor_name,
          total_aud: invoice.total_aud,
        },
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(201).send({
        expenditure_id: expenditureId,
        vendor_name: invoice.vendor_name,
        total_aud: invoice.total_aud,
        claim_id: claimRow.id,
      });
    },
  );
}
