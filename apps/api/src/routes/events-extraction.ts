import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { getBoss } from '../lib/pg-boss-client.js';
import { DOCUMENT_EXTRACT_QUEUE } from '../jobs/document-extract.js';

/**
 * Register the document-extraction routes:
 *   - GET  /v1/events/:id/extraction     — fetch extraction status / result
 *   - POST /v1/events/:id/extract-content — manually trigger an extraction
 *
 * Auth: requireSession. RLS scopes both lookups to the firm's tenant.
 */
export function registerEventsExtraction(app: FastifyInstance): void {
  // -----------------------------------------------------------------------
  // GET /v1/events/:id/extraction
  // Returns extracted_content if status='complete', else { status, error? }.
  // -----------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/events/:id/extraction',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            extraction_status: string | null;
            extracted_content: unknown;
          }[]
        >`
          SELECT id, extraction_status, extracted_content
            FROM event
           WHERE id        = ${id}
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

      if (row.extraction_status === 'complete') {
        return reply.status(200).send({
          status: 'complete',
          result: row.extracted_content,
        });
      }

      return reply.status(200).send({
        status: row.extraction_status ?? 'not_started',
        result: null,
        error:
          row.extraction_status === 'failed'
            ? (((row.extracted_content as Record<string, unknown>)?.reason as string | undefined) ??
              'Extraction failed')
            : undefined,
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /v1/events/:id/extract-content
  // Manually trigger extraction for one event. Returns { queued: true }.
  // -----------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/events/:id/extract-content',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      // 1. Verify event exists and is visible.
      const row = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            payload: unknown;
          }[]
        >`
          SELECT id, subject_tenant_id, payload
            FROM event
           WHERE id        = ${id}
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

      // 2. Enqueue job and mark pending.
      try {
        const boss = await getBoss();
        await boss.send(DOCUMENT_EXTRACT_QUEUE, {
          event_id: id,
          tenant_id: tenantId,
          subject_tenant_id: row.subject_tenant_id,
        });
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
          await tx`
            UPDATE event
               SET extraction_status = 'pending'
             WHERE id        = ${id}
               AND tenant_id = ${tenantId}
          `;
        });
      } catch (e) {
        req.log.error({ err: e, event_id: id }, 'document-extract enqueue failed');
        return reply.status(503).send({
          error: 'extraction_unavailable',
          message: 'Could not enqueue extraction job; retry shortly',
          requestId: req.id,
        });
      }

      return reply.status(202).send({ queued: true });
    },
  );
}
