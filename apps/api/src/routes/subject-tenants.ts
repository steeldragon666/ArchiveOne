import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { verifyChain, insertEventWithChain } from '@cpa/db';
import { sql } from '@cpa/db/client';
// crypto is built-in; no package import needed — randomUUID lives on globalThis in Node 18+.
import {
  createSubjectTenantBody,
  listSubjectTenantsQuery,
  updateSubjectTenantBody,
  SubjectTenantArchivedPayload,
  SubjectTenantUpdatedPayload,
  type SubjectTenant,
} from '@cpa/schemas';

interface RawSubjectTenantRow {
  id: string;
  tenant_id: string;
  name: string;
  kind: 'claimant' | 'financier';
  created_at: Date | string;
  updated_at: Date | string;
  // Migration 0098 — multi-entity fields. Optional on the raw row because
  // older SELECTs don't pick them up; toApi supplies the documented
  // defaults so the wire shape stays consistent for all callers.
  entity_kind?: 'standalone' | 'head_company' | 'r_and_d_entity' | 'associate_entity';
  head_company_id?: string | null;
  aggregated_turnover_aud?: string | null;
  aggregated_turnover_fy_label?: string | null;
}

const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

const toApi = (r: RawSubjectTenantRow): SubjectTenant => ({
  id: r.id,
  tenant_id: r.tenant_id,
  name: r.name,
  kind: r.kind,
  created_at: isoOf(r.created_at),
  updated_at: isoOf(r.updated_at),
  // Migration 0098 defaults — match the SQL NOT NULL default for
  // entity_kind; the three turnover columns are nullable by design.
  entity_kind: r.entity_kind ?? 'standalone',
  head_company_id: r.head_company_id ?? null,
  aggregated_turnover_aud: r.aggregated_turnover_aud ?? null,
  aggregated_turnover_fy_label: r.aggregated_turnover_fy_label ?? null,
});

/**
 * Register the subject-tenant routes (list / create / detail / chain-status).
 *
 * Auth: requireSession (any tenant_user with an active firm). Admin/consultant
 * gating happens per-route where mutations are involved (create).
 *
 * RLS: every query runs inside `sql.begin` with `set_config('app.current_tenant_id',
 * tenantId, true)` so the SELECTs are tenant-scoped. We don't rely on the
 * session middleware's `set_config` because postgres-js connection pooling
 * makes session-scoped GUCs unreliable across pool checkouts.
 */
export function registerSubjectTenants(app: FastifyInstance): void {
  app.get('/v1/subject-tenants', { preHandler: requireSession }, async (req, reply) => {
    const parsed = listSubjectTenantsQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_query',
        message: 'Query must match { kind?: "claimant" | "financier" }',
        requestId: req.id,
      });
    }
    const { kind } = parsed.data;
    const tenantId = req.user!.tenantId!;

    return await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

      const rows = kind
        ? await tx<RawSubjectTenantRow[]>`
            SELECT id, tenant_id, name, kind, created_at, updated_at,
                   entity_kind, head_company_id, aggregated_turnover_aud,
                   aggregated_turnover_fy_label
              FROM subject_tenant
             WHERE kind = ${kind}
               AND deleted_at IS NULL
             ORDER BY created_at ASC
          `
        : await tx<RawSubjectTenantRow[]>`
            SELECT id, tenant_id, name, kind, created_at, updated_at,
                   entity_kind, head_company_id, aggregated_turnover_aud,
                   aggregated_turnover_fy_label
              FROM subject_tenant
             WHERE deleted_at IS NULL
             ORDER BY created_at ASC
          `;

      return { subject_tenants: rows.map(toApi) };
    });
  });

  app.post('/v1/subject-tenants', { preHandler: requireSession }, async (req, reply) => {
    // role gating: read-only viewers can't create claimants. Admin and
    // consultant both can — admins get implicit access to all claimants
    // anyway (see subject_tenant_user.ts default-access semantics), and
    // consultants need to be able to onboard a new claimant they're
    // assigned to.
    const role = req.user!.role;
    if (role !== 'admin' && role !== 'consultant') {
      return reply.status(403).send({
        error: 'forbidden',
        message: 'Admin or consultant role required',
        requestId: req.id,
      });
    }

    const parsed = createSubjectTenantBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_body',
        message: 'Body must be { name: string (1..200), kind?: "claimant"|"financier" }',
        requestId: req.id,
      });
    }

    const { name, kind } = parsed.data;
    const tenantId = req.user!.tenantId!;
    const userId = req.user!.id;

    type CreatedRow = {
      id: string;
      tenant_id: string;
      name: string;
      kind: 'claimant' | 'financier';
      created_at: Date | string;
      updated_at: Date | string;
    };
    // Capture the result inside the tx but send the reply AFTER sql.begin
    // resolves. Sending from inside the transaction flushes the response
    // before COMMIT, so a caller that immediately reads back the new row or
    // its ACL row (subject_tenant_user) races the commit and sees nothing.
    const result = await sql.begin<{ kind: 'dup' } | { kind: 'ok'; row: CreatedRow }>(
      async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // Duplicate-name check within firm (the schema doesn't enforce a
        // (tenant_id, name) unique index — see subject_tenant.ts — so we
        // enforce in app code under transaction). RLS already restricts the
        // SELECT to the active firm, so the check is implicitly per-firm.
        const dupes = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE name = ${name} AND deleted_at IS NULL
        `;
        if (dupes[0]) {
          return { kind: 'dup' as const };
        }

        const newId = crypto.randomUUID();
        const inserted = await tx<CreatedRow[]>`
          INSERT INTO subject_tenant (id, tenant_id, name, kind)
          VALUES (${newId}, ${tenantId}, ${name}, ${kind})
          RETURNING id, tenant_id, name, kind, created_at, updated_at
        `;
        if (!inserted[0]) {
          throw new Error('POST /v1/subject-tenants: INSERT returned no row');
        }

        // ACL row: the creator gets 'lead' role on this claimant. The
        // subject_tenant_user.role enum is ('lead' | 'observer') — the plan-
        // spec mentions 'owner' but the schema (T7, db/schema/subject_tenant_user.ts)
        // doesn't include that value, so 'lead' is the schema-correct
        // equivalent (primary consultant on the claimant, full access).
        await tx`
          INSERT INTO subject_tenant_user (id, subject_tenant_id, user_id, role)
          VALUES (${crypto.randomUUID()}, ${newId}, ${userId}, 'lead')
        `;

        return { kind: 'ok' as const, row: inserted[0] };
      },
    );

    if (result.kind === 'dup') {
      return reply.status(409).send({
        error: 'duplicate_name',
        message: `A subject_tenant with name "${name}" already exists in this firm`,
        requestId: req.id,
      });
    }
    return reply.status(201).send({ subject_tenant: toApi(result.row) });
  });

  app.get<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      return await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        const rows = await tx<RawSubjectTenantRow[]>`
          SELECT id, tenant_id, name, kind, created_at, updated_at,
                 entity_kind, head_company_id, aggregated_turnover_aud,
                 aggregated_turnover_fy_label
            FROM subject_tenant
           WHERE id = ${id} AND deleted_at IS NULL
        `;
        if (!rows[0]) {
          return reply.status(404).send({
            error: 'subject_tenant_not_found',
            message: 'No subject_tenant with that id in this firm',
            requestId: req.id,
          });
        }

        // Aggregates: total events on this chain + the chain head hash
        // (latest event ordered by captured_at, received_at, id — same key
        // the chain helper uses). RLS confines both to the active firm.
        const counts = await tx<{ event_count: string }[]>`
          SELECT COUNT(*)::text AS event_count
            FROM event
           WHERE subject_tenant_id = ${id}
        `;
        const heads = await tx<{ hash: string }[]>`
          SELECT hash FROM event
           WHERE subject_tenant_id = ${id}
           ORDER BY captured_at DESC, received_at DESC, id DESC
           LIMIT 1
        `;

        return {
          subject_tenant: toApi(rows[0]),
          event_count: Number(counts[0]?.event_count ?? '0'),
          head_hash: heads[0]?.hash ?? null,
        };
      });
    },
  );

  // -----------------------------------------------------------------------
  // PATCH /v1/subject-tenants/:id — partial update + emit SUBJECT_TENANT_UPDATED.
  // -----------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id',
    { preHandler: requireSession },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin or consultant role required',
          requestId: req.id,
        });
      }

      const parsed = updateSubjectTenantBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_body',
          message: 'Body must be a partial update of { name?, kind? } with no extra keys',
          requestId: req.id,
        });
      }
      const patch = parsed.data;
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      const patchKeys = Object.keys(patch) as Array<keyof typeof patch>;

      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const before = await tx<RawSubjectTenantRow[]>`
          SELECT id, tenant_id, name, kind, created_at, updated_at,
                 entity_kind, head_company_id, aggregated_turnover_aud,
                 aggregated_turnover_fy_label
            FROM subject_tenant
           WHERE id = ${id} AND deleted_at IS NULL
        `;
        const prev = before[0];
        if (!prev) return { kind: 'not_found' as const };
        if (patchKeys.length === 0) {
          return { kind: 'noop' as const, row: prev };
        }

        const setName = patch.name !== undefined ? tx`name = ${patch.name},` : tx``;
        const setKind = patch.kind !== undefined ? tx`kind = ${patch.kind},` : tx``;
        // Migration 0098 — multi-entity fields editable via PATCH.
        const setEntityKind =
          patch.entity_kind !== undefined ? tx`entity_kind = ${patch.entity_kind},` : tx``;
        const setHeadCompanyId =
          patch.head_company_id !== undefined
            ? tx`head_company_id = ${patch.head_company_id},`
            : tx``;
        const setTurnoverAud =
          patch.aggregated_turnover_aud !== undefined
            ? tx`aggregated_turnover_aud = ${patch.aggregated_turnover_aud},`
            : tx``;
        const setTurnoverFy =
          patch.aggregated_turnover_fy_label !== undefined
            ? tx`aggregated_turnover_fy_label = ${patch.aggregated_turnover_fy_label},`
            : tx``;

        const updated = await tx<RawSubjectTenantRow[]>`
          UPDATE subject_tenant
             SET ${setName}
                 ${setKind}
                 ${setEntityKind}
                 ${setHeadCompanyId}
                 ${setTurnoverAud}
                 ${setTurnoverFy}
                 updated_at = NOW()
           WHERE id = ${id} AND deleted_at IS NULL
           RETURNING id, tenant_id, name, kind, created_at, updated_at,
                     entity_kind, head_company_id, aggregated_turnover_aud,
                     aggregated_turnover_fy_label
        `;
        const row = updated[0];
        if (!row) {
          throw new Error('PATCH /v1/subject-tenants/:id: UPDATE returned no row');
        }
        return { kind: 'updated' as const, prev, row };
      });

      if (result.kind === 'not_found') {
        return reply.status(404).send({
          error: 'subject_tenant_not_found',
          message: 'No subject_tenant with that id in this firm',
          requestId: req.id,
        });
      }
      if (result.kind === 'noop') {
        return reply.status(200).send({ subject_tenant: toApi(result.row) });
      }

      // Build {from, to} diff and emit chain event only when something changed.
      const fieldsChanged: Record<string, { from: unknown; to: unknown }> = {};
      if (patch.name !== undefined && result.prev.name !== result.row.name) {
        fieldsChanged['name'] = { from: result.prev.name, to: result.row.name };
      }
      if (patch.kind !== undefined && result.prev.kind !== result.row.kind) {
        fieldsChanged['kind'] = { from: result.prev.kind, to: result.row.kind };
      }
      if (patch.entity_kind !== undefined && result.prev.entity_kind !== result.row.entity_kind) {
        fieldsChanged['entity_kind'] = {
          from: result.prev.entity_kind ?? null,
          to: result.row.entity_kind ?? null,
        };
      }
      if (
        patch.head_company_id !== undefined &&
        (result.prev.head_company_id ?? null) !== (result.row.head_company_id ?? null)
      ) {
        fieldsChanged['head_company_id'] = {
          from: result.prev.head_company_id ?? null,
          to: result.row.head_company_id ?? null,
        };
      }
      if (
        patch.aggregated_turnover_aud !== undefined &&
        (result.prev.aggregated_turnover_aud ?? null) !==
          (result.row.aggregated_turnover_aud ?? null)
      ) {
        fieldsChanged['aggregated_turnover_aud'] = {
          from: result.prev.aggregated_turnover_aud ?? null,
          to: result.row.aggregated_turnover_aud ?? null,
        };
      }
      if (
        patch.aggregated_turnover_fy_label !== undefined &&
        (result.prev.aggregated_turnover_fy_label ?? null) !==
          (result.row.aggregated_turnover_fy_label ?? null)
      ) {
        fieldsChanged['aggregated_turnover_fy_label'] = {
          from: result.prev.aggregated_turnover_fy_label ?? null,
          to: result.row.aggregated_turnover_fy_label ?? null,
        };
      }

      if (Object.keys(fieldsChanged).length > 0) {
        const payload = SubjectTenantUpdatedPayload.parse({
          subject_tenant_id: result.row.id,
          fields_changed: fieldsChanged,
        });
        await insertEventWithChain({
          tenant_id: tenantId,
          subject_tenant_id: result.row.id,
          project_id: null,
          kind: 'SUBJECT_TENANT_UPDATED',
          payload,
          classification: null,
          captured_at: new Date(),
          captured_by_user_id: userId,
          override_of_event_id: null,
          override_new_kind: null,
          override_reason: null,
        });
      }

      return reply.status(200).send({ subject_tenant: toApi(result.row) });
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /v1/subject-tenants/:id — soft-delete + emit SUBJECT_TENANT_ARCHIVED.
  // -----------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id',
    { preHandler: requireSession },
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
      const userId = req.user!.id;

      // Idempotent soft-delete: if already deleted return 204 without re-emitting.
      const result = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          UPDATE subject_tenant
             SET deleted_at = NOW(),
                 updated_at = NOW()
           WHERE id = ${id} AND deleted_at IS NULL
           RETURNING id
        `;
        if (rows[0]) return { kind: 'deleted' as const };
        // Not found or already deleted — disambiguate.
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant WHERE id = ${id}
        `;
        if (!existing[0]) return { kind: 'not_found' as const };
        return { kind: 'noop' as const };
      });

      if (result.kind === 'not_found') {
        return reply.status(404).send({
          error: 'subject_tenant_not_found',
          message: 'No subject_tenant with that id in this firm',
          requestId: req.id,
        });
      }

      if (result.kind === 'deleted') {
        const payload = SubjectTenantArchivedPayload.parse({
          subject_tenant_id: id,
          archived_by_user_id: userId,
        });
        await insertEventWithChain({
          tenant_id: tenantId,
          subject_tenant_id: id,
          project_id: null,
          kind: 'SUBJECT_TENANT_ARCHIVED',
          payload,
          classification: null,
          captured_at: new Date(),
          captured_by_user_id: userId,
          override_of_event_id: null,
          override_new_kind: null,
          override_reason: null,
        });
      }

      // 204 for both first-delete and idempotent re-delete.
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id/chain-status',
    { preHandler: requireSession },
    async (req, reply) => {
      const { id } = req.params;
      const tenantId = req.user!.tenantId!;

      // First confirm the subject is visible under RLS (returns 404 for
      // unknown OR cross-firm). This guards against verifyChain quietly
      // returning verified=true/event_count=0 if the GUC weren't set on
      // its connection — we'd rather surface a 404 than a misleading
      // "clean chain" response.
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM subject_tenant
           WHERE id = ${id} AND deleted_at IS NULL
        `;
        return rows[0] != null;
      });
      if (!visible) {
        return reply.status(404).send({
          error: 'subject_tenant_not_found',
          message: 'No subject_tenant with that id in this firm',
          requestId: req.id,
        });
      }

      // verifyChain runs via privilegedSql (RLS-bypass) — auth boundary is
      // the 404 visibility check above, not the GUC. No further set_config
      // needed.
      const status = await verifyChain(id);
      return status;
    },
  );
}
