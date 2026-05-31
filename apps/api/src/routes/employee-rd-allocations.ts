import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { CreateEmployeeRdAllocationBody, type EmployeeRdAllocation } from '@cpa/schemas';

/**
 * Per-employee R&D % allocation — REST surface. Table created by migration 0097.
 *
 *   GET    /v1/claims/:claim_id/employee-rd-allocations
 *   POST   /v1/claims/:claim_id/employee-rd-allocations
 *   DELETE /v1/employee-rd-allocations/:id
 *
 * Server enforces the "claim-wide OR per-activity, not both" rule that the
 * schema can't express (the SQL UNIQUE allows multiple per-activity rows
 * alongside one claim-wide row for the same employee, but our application
 * semantics say either form is exclusive). The POST handler checks for an
 * existing row of the opposite form before insert.
 */

interface RawRow {
  id: string;
  tenant_id: string;
  claim_id: string;
  employee_id: string;
  activity_id: string | null;
  rd_percentage: number;
  basis_note: string | null;
  created_at: string;
  created_by_user_id: string;
  updated_at: string;
}

function toApi(r: RawRow): EmployeeRdAllocation {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    claim_id: r.claim_id,
    employee_id: r.employee_id,
    activity_id: r.activity_id,
    rd_percentage: r.rd_percentage,
    basis_note: r.basis_note,
    created_at: r.created_at,
    created_by_user_id: r.created_by_user_id,
    updated_at: r.updated_at,
  };
}

export function registerEmployeeRdAllocations(app: FastifyInstance): void {
  // ---------------------------------------------------------------------
  // GET /v1/claims/:claim_id/employee-rd-allocations
  // ---------------------------------------------------------------------
  app.get<{ Params: { claim_id: string } }>(
    '/v1/claims/:claim_id/employee-rd-allocations',
    {
      preHandler: requireSession,
      schema: { params: z.object({ claim_id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { claim_id } = req.params;
      const tenantId = req.user!.tenantId!;
      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<RawRow[]>`
          SELECT id::text, tenant_id::text, claim_id::text,
                 employee_id::text, activity_id::text, rd_percentage,
                 basis_note, created_at::text, created_by_user_id::text,
                 updated_at::text
            FROM employee_rd_allocation
           WHERE claim_id = ${claim_id}
           ORDER BY employee_id ASC, activity_id NULLS FIRST, id ASC
        `;
        return reply.send({ allocations: rows.map(toApi) });
      });
    },
  );

  // ---------------------------------------------------------------------
  // POST /v1/claims/:claim_id/employee-rd-allocations
  //
  // Enforces the "claim-wide OR per-activity, never both" rule at the
  // application layer (the SQL UNIQUE allows both rows to coexist for the
  // same (employee, claim) pair).
  // ---------------------------------------------------------------------
  app.post<{ Params: { claim_id: string } }>(
    '/v1/claims/:claim_id/employee-rd-allocations',
    {
      preHandler: requireSession,
      schema: { params: z.object({ claim_id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }
      const parsed = CreateEmployeeRdAllocationBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'invalid_body',
          message: 'Body must match CreateEmployeeRdAllocationBody',
          issues: parsed.error.issues,
          requestId: req.id,
        });
      }
      const body = parsed.data;
      const { claim_id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;
      const activityId = body.activity_id ?? null;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Mutex check: if the caller posts a claim-wide row (activity_id
        // NULL), reject when any per-activity row already exists for this
        // (employee, claim). Conversely, posting a per-activity row when
        // a claim-wide row exists is also rejected. The matching rule is
        // documented in the Zod JSDoc.
        const opposite = await tx<{ id: string }[]>`
          SELECT id::text FROM employee_rd_allocation
           WHERE claim_id = ${claim_id}
             AND employee_id = ${body.employee_id}
             AND ${activityId === null ? sql`activity_id IS NOT NULL` : sql`activity_id IS NULL`}
           LIMIT 1
        `;
        if (opposite.length > 0) {
          return reply.status(409).send({
            error: 'conflict',
            message:
              activityId === null
                ? 'Per-activity allocations already exist for this employee on this claim — delete them before adding a claim-wide row.'
                : 'A claim-wide allocation already exists for this employee on this claim — delete it before adding per-activity rows.',
            requestId: req.id,
          });
        }

        const inserted = await tx<RawRow[]>`
          INSERT INTO employee_rd_allocation (
            tenant_id, claim_id, employee_id, activity_id,
            rd_percentage, basis_note, created_by_user_id
          ) VALUES (
            ${tenantId}, ${claim_id}, ${body.employee_id}, ${activityId},
            ${body.rd_percentage}, ${body.basis_note ?? null}, ${userId}
          )
          RETURNING id::text, tenant_id::text, claim_id::text,
                    employee_id::text, activity_id::text, rd_percentage,
                    basis_note, created_at::text, created_by_user_id::text,
                    updated_at::text
        `;
        const row = inserted[0];
        if (!row) {
          throw new Error('employee_rd_allocation INSERT returned no row');
        }
        return reply.status(201).send({ allocation: toApi(row) });
      });
    },
  );

  // ---------------------------------------------------------------------
  // DELETE /v1/employee-rd-allocations/:id
  // ---------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/employee-rd-allocations/:id',
    {
      preHandler: requireSession,
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;
      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const deleted = await tx<{ id: string }[]>`
          DELETE FROM employee_rd_allocation
           WHERE id = ${id}
           RETURNING id::text
        `;
        if (deleted.length === 0) {
          return reply.status(404).send({
            error: 'not_found',
            message: 'Allocation not found in this firm',
            requestId: req.id,
          });
        }
        return reply.status(204).send();
      });
    },
  );
}
