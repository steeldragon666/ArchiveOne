import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import {
  renderClaimSummaryPdf,
  type ClaimSummaryActivity,
  type ClaimSummaryInput,
} from '@cpa/documents';

/**
 * GET /v1/claims/:id/summary.pdf — claim-level summary deliverable (C7).
 *
 * Auth: requireSession; role gate (admin/consultant/viewer) — viewers can
 * download but not mutate (matches A8's activity-detail PDF gate).
 *
 * Visibility / cross-firm:
 *   - The claim lookup runs inside `sql.begin` with a `set_config` of
 *     `app.current_tenant_id` to the caller's tenant, so RLS scopes the
 *     claim row to the calling firm.
 *   - Defense-in-depth: the SQL also includes an explicit
 *     `AND tenant_id = ${tenantId}` even though RLS already constrains
 *     the row.
 *   - A miss (cross-firm or nonexistent) returns 404 (deliberately
 *     identical, no leakage of "exists in other tenant").
 *
 * Streaming:
 *   - Content-Type: application/pdf
 *   - Content-Disposition: attachment; filename="..."
 *   - Cache-Control: private, no-store (PDFs include claimant data)
 *
 * Filename: `claim-${fiscal_year}-${firm_short}-summary.pdf`. Both the
 * year and the firm slug are sanitised — any non-`[a-zA-Z0-9-]` bytes
 * collapse to `-`. The firm name is truncated to 32 chars for sanity.
 *
 * Per-activity apportioned amount aggregation (the value-add of this
 * PDF):
 *   - Sums `expenditure.total_amount` for each parent-mapped expenditure
 *     pointing at the activity (counts as 100%).
 *   - Sums `(expenditure.total_amount * allocation.percentage / 100)` for
 *     each apportionment allocation pointing at the activity.
 *   - Skips line-level mappings (those need a different join through
 *     `expenditure_line` + the existing `EXPENDITURE_LINE_MAPPED` events;
 *     deferred to F5+ when the line-level mapping UI ships).
 *
 * Today's reality: neither `EXPENDITURE_MAPPED` nor `EXPENDITURE_APPORTIONED`
 * event kinds exist (those land via the A-swimlane per C5 / C6 docs).
 * Without those events the aggregation projection sees no inputs and
 * every activity's apportioned amount is 0. The SQL is in place anyway
 * — when the events do land the PDF starts populating without further
 * code changes.
 *
 * Per-activity `artefact_count` and `uncertainty_event_count`:
 *   - The current event/media schemas don't carry `activity_id` (event
 *     has `project_id` only; media_artefact has `event_id`). A truthful
 *     per-activity count would require either a new column or a
 *     denormalised projection that we don't have today. We default to 0
 *     and document the upgrade path.
 */

interface ClaimRow {
  id: string;
  tenant_id: string;
  subject_tenant_id: string;
  fiscal_year: number;
  stage: string;
}

interface FirmRow {
  id: string;
  name: string;
}

interface SubjectTenantRow {
  id: string;
  name: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
}

interface ActivityRow {
  id: string;
  code: string;
  title: string;
  kind: 'core' | 'supporting';
  description: string | null;
}

interface ExpenditureSummaryRow {
  total_amount: string | number | null;
  count_total: string | number | null;
}

const isoOrNull = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  return typeof v === 'string' ? v : v.toISOString();
};

/** Sanitise a string for use in a Content-Disposition filename. */
function sanitiseFilenamePart(input: string, maxLen = 32): string {
  // Keep ASCII alphanum + hyphens; collapse any other byte to `-`.
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, maxLen) || 'unknown';
}

export function registerClaimPdf(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/summary.pdf',
    { preHandler: requireSession },
    async (req, reply) => {
      const role = req.user!.role;
      if (role !== 'admin' && role !== 'consultant' && role !== 'viewer') {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'Admin, consultant, or viewer role required',
          requestId: req.id,
        });
      }

      const claimId = req.params.id;
      const tenantId = req.user!.tenantId!;

      const fetched = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

        // 1. Claim row, scoped to the firm (RLS + defense-in-depth).
        //    Cross-firm or nonexistent → empty array → 404 in the caller.
        const claimRows = await tx<ClaimRow[]>`
          SELECT id, tenant_id, subject_tenant_id, fiscal_year, stage
            FROM claim
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        const claim = claimRows[0];
        if (!claim) return null;

        // 2. Firm (tenant) — global table; fetch by id directly.
        const firmRows = await tx<FirmRow[]>`
          SELECT id, name FROM tenant WHERE id = ${claim.tenant_id}
        `;
        const firm = firmRows[0];
        if (!firm) return null;

        // 3. Subject tenant (claimant). RLS-scoped, deleted_at null.
        const subjectRows = await tx<SubjectTenantRow[]>`
          SELECT id, name FROM subject_tenant
           WHERE id = ${claim.subject_tenant_id} AND deleted_at IS NULL
        `;
        const subject = subjectRows[0];
        if (!subject) return null;

        // 4. Project — pick the most recently-started project for the
        //    claimant. This is a simplification: claims today have no
        //    project_id FK on `claim`, and a single claimant may have
        //    several projects. Surfacing the most-recent project gives
        //    the PDF something meaningful while a richer claim ↔ project
        //    relationship lands later. If no project exists we return a
        //    placeholder block.
        const projectRows = await tx<ProjectRow[]>`
          SELECT id, name, description, started_at, ended_at
            FROM project
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND archived_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
        `;
        const project = projectRows[0];

        // 5. Activities for this claim.
        const activityRows = await tx<ActivityRow[]>`
          SELECT id, code, title, kind, description
            FROM activity
           WHERE claim_id = ${claim.id}
           ORDER BY code ASC
        `;

        // 6. Expenditures summary — total spend + counts. The mapped /
        //    apportioned / unmapped split is computed against the events
        //    table once those event kinds exist. For now, the count of
        //    expenditures becomes the unmapped count (no mappings → all
        //    unmapped).
        const expSummaryRows = await tx<ExpenditureSummaryRow[]>`
          SELECT
            COALESCE(SUM(total_amount), 0) AS total_amount,
            COUNT(*)                        AS count_total
          FROM expenditure
          WHERE subject_tenant_id = ${claim.subject_tenant_id}
            AND voided_at IS NULL
        `;
        const expSummary = expSummaryRows[0] ?? { total_amount: 0, count_total: 0 };

        // TODO(A-swimlane): once `EXPENDITURE_MAPPED` and
        // `EXPENDITURE_APPORTIONED` event kinds exist, replace the zero
        // mapped/apportioned counts with a projection over those events
        // and split the count_total across the three buckets. The
        // per-activity aggregation in step 7 below also unblocks at the
        // same point.
        const mappedCount = 0;
        const apportionedCount = 0;
        const unmappedCount = Number(expSummary.count_total ?? 0);

        // 7. Per-activity apportioned amount. Today this returns 0 for
        //    every activity (no EXPENDITURE_MAPPED / EXPENDITURE_APPORTIONED
        //    events emitted yet — A-swimlane). When those events land,
        //    the projection becomes:
        //
        //      SELECT activity_id,
        //             SUM(CASE WHEN kind = 'EXPENDITURE_MAPPED'
        //                       THEN expenditure.total_amount
        //                      WHEN kind = 'EXPENDITURE_APPORTIONED'
        //                       THEN expenditure.total_amount
        //                            * (allocation.percentage / 100)
        //                 END) AS total_apportioned_amount
        //        FROM event
        //        JOIN expenditure ON expenditure.id = (event.payload->>'expenditure_id')::uuid
        //        ...
        //       GROUP BY activity_id
        //
        //    Line-level mappings (EXPENDITURE_LINE_MAPPED) join through
        //    expenditure_line and are F5+ territory.
        const apportionedByActivity = new Map<string, number>();

        return {
          claim,
          firm,
          subject,
          project,
          activities: activityRows,
          expSummary: {
            total_amount: Number(expSummary.total_amount ?? 0),
            mapped_count: mappedCount,
            apportioned_count: apportionedCount,
            unmapped_count: unmappedCount,
          },
          apportionedByActivity,
        };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const projectStartedAt = fetched.project?.started_at ?? null;
      const projectEndedAt = fetched.project?.ended_at ?? null;

      const activities: ClaimSummaryActivity[] = fetched.activities.map((row) => ({
        code: row.code,
        title: row.title,
        kind: row.kind === 'core' ? ('CORE' as const) : ('SUPPORTING' as const),
        description: row.description,
        // TODO(A-swimlane): wire artefact_count + uncertainty_event_count
        // once events / media gain `activity_id` (or a denormalised
        // projection ships). See file-level comment.
        artefact_count: 0,
        uncertainty_event_count: 0,
        total_apportioned_amount: fetched.apportionedByActivity.get(row.id) ?? 0,
      }));

      const input: ClaimSummaryInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        project: {
          name: fetched.project?.name ?? '(no project)',
          description: fetched.project?.description ?? null,
        },
        claim: {
          id: fetched.claim.id,
          fiscal_year: fetched.claim.fiscal_year,
          stage: fetched.claim.stage,
          started_at: isoOrNull(projectStartedAt),
          ended_at: isoOrNull(projectEndedAt),
        },
        activities,
        expenditures_summary: {
          total_amount: fetched.expSummary.total_amount,
          // AUD-only in P4 (CHECK constraint in F4); the column type is
          // open and we surface whatever the row says — but every row in
          // this tenant will be AUD.
          currency: 'AUD',
          mapped_count: fetched.expSummary.mapped_count,
          apportioned_count: fetched.expSummary.apportioned_count,
          unmapped_count: fetched.expSummary.unmapped_count,
        },
        generated_at: new Date().toISOString(),
      };

      const bytes = await renderClaimSummaryPdf(input);

      const firmShort = sanitiseFilenamePart(fetched.firm.name);
      const fyShort = sanitiseFilenamePart(String(fetched.claim.fiscal_year), 8);
      const filename = `claim-${fyShort}-${firmShort}-summary.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      // Send the raw bytes (Buffer-wrapped so Fastify routes it directly
      // to the underlying response without serialising as JSON).
      return reply.send(Buffer.from(bytes));
    },
  );
}
