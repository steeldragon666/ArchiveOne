import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import type { ExpenditureSource } from '@cpa/db/schema';
import {
  contentHash,
  renderApportionmentReportPdf,
  renderClaimSummaryPdf,
  renderEvidenceIndexPdf,
  renderExecutiveSummaryPdf,
  renderIngestSummaryPdf,
  renderPortalNarrativePackPdf,
  type ApportionmentExpenditure,
  type ApportionmentReportInput,
  type ClaimSummaryActivity,
  type ClaimSummaryInput,
  type EvidenceIndexInput,
  type ExecutiveSummaryInput,
  type IngestSummaryInput,
  type PortalNarrativePackInput,
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

interface ExpenditureRow {
  id: string;
  source: ExpenditureSource;
  source_external_id: string | null;
  vendor_name: string;
  reference: string | null;
  expenditure_date: Date | string;
  total_amount: string | number;
  currency: string;
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

  /**
   * GET /v1/claims/:id/apportionment.pdf — apportionment report (C9).
   *
   * Same auth + cross-firm + streaming model as `summary.pdf` above:
   *   - admin/consultant/viewer can download
   *   - claim lookup runs inside `sql.begin` with `set_config` of
   *     `app.current_tenant_id` so RLS scopes the row; explicit
   *     `AND tenant_id = ${tenantId}` is defense-in-depth
   *   - cross-firm or nonexistent => 404 (identical messages, no leakage)
   *   - Content-Type: application/pdf
   *   - Content-Disposition: attachment; filename="..."
   *   - Cache-Control: private, no-store
   *
   * Filename: `apportionment-${fiscal_year}-${firm_short}.pdf` (per spec).
   *
   * Mapping/apportionment projection (today's reality):
   *   Neither EXPENDITURE_MAPPED nor EXPENDITURE_APPORTIONED event
   *   kinds exist yet (deferred to A-swimlane per C5/C6 docs). Without
   *   those events the projection sees no inputs and EVERY expenditure
   *   resolves to `{ type: 'unmapped' }`. The activity rollup is
   *   therefore empty and the totals reflect 100% unmapped.
   *
   *   The PDF still renders — that's the point of the document. It
   *   shows the pre-A-swimlane baseline so a later implementer can
   *   diff "before vs after events land". When EXPENDITURE_MAPPED /
   *   EXPENDITURE_APPORTIONED events do arrive, the projection
   *   replaces the zero-state branch below and the activity_rollup
   *   gains real entries — without API surface change.
   *
   *   The activity rollup CTE in step 6 is therefore a simple "no
   *   activities, no expenditures contribute" placeholder today; once
   *   events land, it grows into the GROUP BY documented in summary's
   *   step 7 comment.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/apportionment.pdf',
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

        // 4. Project — same most-recent-by-started_at simplification as
        //    summary.pdf. Claims today have no project_id FK.
        const projectRows = await tx<ProjectRow[]>`
          SELECT id, name, description, started_at, ended_at
            FROM project
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND archived_at IS NULL
           ORDER BY started_at DESC
           LIMIT 1
        `;
        const project = projectRows[0];

        // 5. Expenditures — every row scoped to the claim's subject
        //    tenant, voided rows excluded. Sorted by date ASC then id
        //    so the rendered detail table is deterministic across runs
        //    (the secondary id sort breaks ties when several
        //    expenditures share the same date — a common case in
        //    practice e.g. all rows from one Xero sync batch).
        const expenditureRows = await tx<ExpenditureRow[]>`
          SELECT id, source, source_external_id, vendor_name, reference,
                 expenditure_date, total_amount, currency
            FROM expenditure
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND voided_at IS NULL
           ORDER BY expenditure_date ASC, id ASC
        `;

        return { claim, firm, subject, project, expenditureRows };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      // Transform DB rows into the @cpa/documents input shape.
      //
      // Source classification: the four DB sources collapse to three
      // PDF kinds — see `classifyKind` below for the canonical mapping
      // (and the cross-swimlane note documenting `manual` → `RECEIPT`).
      const expenditures: ApportionmentExpenditure[] = fetched.expenditureRows.map((r) => ({
        id: r.id,
        kind: classifyKind(r.source),
        date:
          r.expenditure_date instanceof Date
            ? r.expenditure_date.toISOString()
            : r.expenditure_date,
        payee: r.vendor_name,
        reference: r.reference,
        amount: Number(r.total_amount),
        currency: r.currency,
        // TODO(A-swimlane): replace with a real projection over
        // EXPENDITURE_MAPPED / EXPENDITURE_APPORTIONED events. Today
        // those event kinds don't exist; everything is unmapped. Once
        // they land, this becomes:
        //
        //   const apportioned = apportionedById.get(r.id);
        //   if (apportioned) return { type: 'apportioned', allocations };
        //   const mapped = mappedById.get(r.id);
        //   if (mapped) return { type: 'mapped', activity_code, activity_title };
        //   return { type: 'unmapped' };
        //
        // (Mirrors the projection rules in
        // `apps/web/src/app/claims/[claim_id]/_lib/expenditure-projection.ts`
        // and the row-UI composition order: line > apportionment >
        // parent > unmapped.)
        mapping_state: { type: 'unmapped' as const },
      }));

      // Totals roll up directly from the projected expenditures. With
      // every row unmapped today: total_apportioned === 0, total_unmapped
      // === total_expenditure, and total_unmapped_count === expenditures.
      // length. Once mappings land the same arithmetic produces real
      // numbers without code changes — the projection above is the only
      // place that needs to flip from stubbed-zero to real data.
      const totalExpenditure = expenditures.reduce((acc, e) => acc + e.amount, 0);
      const totalApportioned = expenditures.reduce((acc, e) => {
        if (e.mapping_state.type === 'unmapped') return acc;
        if (e.mapping_state.type === 'mapped') return acc + e.amount;
        return acc + e.mapping_state.allocations.reduce((s, a) => s + a.amount, 0);
      }, 0);
      const totalUnmappedCount = expenditures.filter(
        (e) => e.mapping_state.type === 'unmapped',
      ).length;
      const totalUnmapped = expenditures.reduce(
        (acc, e) => (e.mapping_state.type === 'unmapped' ? acc + e.amount : acc),
        0,
      );

      // Activity rollup — derived from the mapping_state aggregation.
      // Today every expenditure is unmapped so the rollup is empty.
      // When events land, walk the expenditures and accumulate per-
      // activity counts + amounts (one entry per distinct activity
      // code, even if multiple expenditures map there).
      //
      // TODO(C9-followup-kind): when EXPENDITURE_MAPPED events emit, the
      // route should join `activity` (by claim_id + code) to populate
      // `activity_kind` on each mapping_state.mapped /
      // mapping_state.apportioned.allocations entry. Until then, the
      // rollup is empty (no events, no rows), so the placeholder is
      // unreachable in production but rendered correctly in tests with
      // synthetic input. The renderer falls back to '—' (em dash) when
      // kind is undefined rather than silently relabelling SUPPORTING
      // activities as 'Core'.
      const rollupMap = new Map<
        string,
        {
          code: string;
          title: string;
          kind?: 'CORE' | 'SUPPORTING';
          count: number;
          amount: number;
        }
      >();
      // The TODO above will populate this map; today the loop is a
      // no-op because every mapping_state.type === 'unmapped'.
      //
      // `kind` is set conditionally (spread on the literal) so an
      // undefined value doesn't surface as an explicit `kind: undefined`
      // property — the workspace runs `exactOptionalPropertyTypes: true`,
      // which rejects that shape against the optional-`kind?:` rollup
      // entry type.
      for (const e of expenditures) {
        if (e.mapping_state.type === 'mapped') {
          const key = e.mapping_state.activity_code;
          const existing = rollupMap.get(key);
          if (existing) {
            existing.count += 1;
            existing.amount += e.amount;
          } else {
            const kind = e.mapping_state.activity_kind;
            rollupMap.set(key, {
              code: e.mapping_state.activity_code,
              title: e.mapping_state.activity_title,
              // Pass through whatever the upstream mapping carries; the
              // route join (TODO above) will populate this once events
              // land. Today: undefined → renderer shows em-dash.
              ...(kind !== undefined ? { kind } : {}),
              count: 1,
              amount: e.amount,
            });
          }
        } else if (e.mapping_state.type === 'apportioned') {
          for (const alloc of e.mapping_state.allocations) {
            const existing = rollupMap.get(alloc.activity_code);
            if (existing) {
              existing.count += 1;
              existing.amount += alloc.amount;
            } else {
              const kind = alloc.activity_kind;
              rollupMap.set(alloc.activity_code, {
                code: alloc.activity_code,
                title: alloc.activity_title,
                ...(kind !== undefined ? { kind } : {}),
                count: 1,
                amount: alloc.amount,
              });
            }
          }
        }
      }
      const activityRollup = Array.from(rollupMap.values())
        .map((r) => ({
          code: r.code,
          title: r.title,
          // Conditionally include `kind` so undefined doesn't surface as
          // an explicit `kind: undefined` property under
          // exactOptionalPropertyTypes (renderer treats absence and
          // explicit-undefined identically; this keeps the wire shape
          // clean and the type narrow).
          ...(r.kind !== undefined ? { kind: r.kind } : {}),
          expenditure_count: r.count,
          total_amount: r.amount,
        }))
        .sort((a, b) => a.code.localeCompare(b.code));

      const input: ApportionmentReportInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        project: {
          name: fetched.project?.name ?? '(no project)',
          description: fetched.project?.description ?? null,
        },
        claim: {
          fiscal_year: fetched.claim.fiscal_year,
          stage: fetched.claim.stage,
        },
        expenditures,
        activity_rollup: activityRollup,
        totals: {
          total_expenditure: totalExpenditure,
          total_apportioned: totalApportioned,
          total_unmapped: totalUnmapped,
          total_unmapped_count: totalUnmappedCount,
          // AUD-only in P4 (CHECK constraint in F4); the column type is
          // open and we surface whatever the row says — but every row in
          // this tenant will be AUD.
          currency: 'AUD',
        },
        generated_at: new Date().toISOString(),
      };

      const bytes = await renderApportionmentReportPdf(input);

      const firmShort = sanitiseFilenamePart(fetched.firm.name);
      const fyShort = sanitiseFilenamePart(String(fetched.claim.fiscal_year), 8);
      const filename = `apportionment-${fyShort}-${firmShort}.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /v1/claims/:id/ingest-summary.pdf — Ingest Summary (F.3)
  // ---------------------------------------------------------------------------

  /**
   * GET /v1/claims/:id/ingest-summary.pdf
   *
   * Renders the Ingest Summary — forensic audit document capturing the
   * full provenance of the document ingestion pipeline for this claim.
   *
   * Data sources (all within one RLS-scoped tx):
   *   - media_artefact rows for the claim's subject_tenant (source files)
   *   - event rows for classification distribution (event.classification)
   *   - OCR status counts for extraction quality
   *
   * Reconciliation summary and parser-kind inventory are derived from
   * the media_artefact rows (mime_type → parser_kind heuristic, ocr_status
   * counts). No new tables required.
   *
   * Filename: `claim-<claim_id_short>-ingest-summary.pdf`
   */
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/ingest-summary.pdf',
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

        const claimRows = await tx<ClaimRow[]>`
          SELECT id, tenant_id, subject_tenant_id, fiscal_year, stage
            FROM claim
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        const claim = claimRows[0];
        if (!claim) return null;

        const firmRows = await tx<FirmRow[]>`
          SELECT id, name FROM tenant WHERE id = ${claim.tenant_id}
        `;
        const firm = firmRows[0];
        if (!firm) return null;

        const subjectRows = await tx<SubjectTenantRow[]>`
          SELECT id, name FROM subject_tenant
           WHERE id = ${claim.subject_tenant_id} AND deleted_at IS NULL
        `;
        const subject = subjectRows[0];
        if (!subject) return null;

        // Media artefacts for this claim's subject_tenant provide the
        // "source files" list and extraction quality metrics.
        interface MediaRow {
          id: string;
          content_hash: string;
          mime_type: string;
          size_bytes: number | string;
          ocr_status: string;
          uploaded_at: Date | string;
          s3_key: string;
        }
        const mediaRows = await tx<MediaRow[]>`
          SELECT id, content_hash, mime_type, size_bytes, ocr_status, uploaded_at, s3_key
            FROM media_artefact
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
           ORDER BY uploaded_at ASC
        `;

        // Event classification data for this subject_tenant — used to
        // build the classification_distribution section.
        interface ClassEventRow {
          kind: string;
          classification: { confidence: number; rationale: string } | null;
        }
        const classEventRows = await tx<ClassEventRow[]>`
          SELECT kind, classification
            FROM event
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND classification IS NOT NULL
        `;

        return { claim, firm, subject, mediaRows, classEventRows };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const generatedAt = new Date().toISOString();

      // Derive parser_kind from mime_type — a best-effort heuristic
      // until a dedicated ingestion pipeline lands dedicated parser
      // metadata (future sprint). PDFs → 'pdf_parser'; images →
      // 'ocr_image_parser'; everything else → 'generic_parser'.
      function parserKindFromMime(mime: string): string {
        if (mime.startsWith('image/')) return 'ocr_image_parser';
        if (mime === 'application/pdf') return 'pdf_parser';
        return 'generic_parser';
      }

      // Build source_inventory grouped by parser_kind.
      const invMap = new Map<string, { count: number }>();
      for (const m of fetched.mediaRows) {
        const pk = parserKindFromMime(m.mime_type);
        const existing = invMap.get(pk);
        if (existing) {
          existing.count += 1;
        } else {
          invMap.set(pk, { count: 1 });
        }
      }
      const sourceInventory: IngestSummaryInput['source_inventory'] = Array.from(
        invMap.entries(),
      ).map(([parser_kind, v]) => ({
        parser_kind,
        file_count: v.count,
        // Extraction quality: 1.0 for structured (pdf/text); 0.7 for OCR.
        avg_extraction_quality: parser_kind === 'ocr_image_parser' ? 0.7 : 1.0,
      }));

      const totalFiles = fetched.mediaRows.length;
      const ocrFallbackCount = fetched.mediaRows.filter(
        (m) => parserKindFromMime(m.mime_type) === 'ocr_image_parser',
      ).length;
      const structuredCount = totalFiles - ocrFallbackCount;
      const avgQuality =
        totalFiles > 0 ? (structuredCount + ocrFallbackCount * 0.7) / totalFiles : 1.0;

      // Classification distribution — count per event kind + avg confidence.
      const classMap = new Map<string, { total: number; sum: number }>();
      for (const ev of fetched.classEventRows) {
        const conf = ev.classification?.confidence ?? 0;
        const existing = classMap.get(ev.kind);
        if (existing) {
          existing.total += 1;
          existing.sum += conf;
        } else {
          classMap.set(ev.kind, { total: 1, sum: conf });
        }
      }
      const classificationDistribution: IngestSummaryInput['classification_distribution'] =
        Array.from(classMap.entries()).map(([evidence_kind, v]) => ({
          evidence_kind,
          count: v.total,
          avg_confidence: v.total > 0 ? v.sum / v.total : 0,
        }));

      // Source files list — each media_artefact is one source file.
      // The s3_key trailing segment is the SHA-256 (per buildS3Key in
      // media.ts: `tenants/<tid>/subjects/<sid>/<sha256>`).
      const sourceFiles: IngestSummaryInput['source_files'] = fetched.mediaRows.map((m) => {
        const sha256Parts = m.s3_key.split('/');
        const sha256 = sha256Parts[sha256Parts.length - 1] ?? m.content_hash;
        // Filename: infer from s3_key suffix or fall back to content_hash.
        const filename = sha256.slice(0, 12) + '…';
        return {
          filename,
          sha256,
          parser_kind: parserKindFromMime(m.mime_type),
          size_bytes: typeof m.size_bytes === 'string' ? Number(m.size_bytes) : m.size_bytes,
        };
      });

      const input: IngestSummaryInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        claim: {
          id: fetched.claim.id,
          fy_year: fetched.claim.fiscal_year,
        },
        generated_at: generatedAt,
        content_hash_hex: contentHash({
          claim_id: fetched.claim.id,
          generated_at: generatedAt,
          source_files_count: sourceFiles.length,
        }),
        generator_version: '1.0.0',
        source_inventory: sourceInventory,
        extraction_quality: {
          total_files: totalFiles,
          structured_count: structuredCount,
          ocr_fallback_count: ocrFallbackCount,
          avg_quality: avgQuality,
        },
        classification_distribution: classificationDistribution,
        // Reconciliation summary: today's state has no dedicated reconciliation
        // pipeline. Surface empty array — renders as "No reconciliation findings."
        // Once the ingest reconciliation service lands (future sprint), this
        // becomes a sub-query over the reconciliation_finding table.
        reconciliation_summary: [],
        source_files: sourceFiles,
      };

      const bytes = await renderIngestSummaryPdf(input);

      const claimShort = sanitiseFilenamePart(fetched.claim.id.slice(-8), 8);
      const filename = `claim-${claimShort}-ingest-summary.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /v1/claims/:id/executive-summary.pdf — Executive Summary (F.4)
  // ---------------------------------------------------------------------------

  /**
   * GET /v1/claims/:id/executive-summary.pdf
   *
   * Renders the Executive Summary — board-readable 1-2 page overview with
   * claim financials, key uncertainties, and submission readiness.
   *
   * Data sources (all within one RLS-scoped tx):
   *   - claim + firm + subject_tenant (header)
   *   - activity rows (activity overview, core/supporting counts)
   *   - expenditure SUM (eligible_expenditure proxy; tax_offset_estimate
   *     at the 43.5% R&D tax offset rate for eligible entities < $20M
   *     aggregated turnover — Australian RDTI standard rate used as an
   *     approximation until the claim captures an explicit rate field)
   *   - event rows with classification.confidence < 0.7 → key_risks
   *
   * Filename: `claim-<claim_id_short>-executive-summary.pdf`
   */
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/executive-summary.pdf',
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

        const claimRows = await tx<ClaimRow[]>`
          SELECT id, tenant_id, subject_tenant_id, fiscal_year, stage
            FROM claim
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        const claim = claimRows[0];
        if (!claim) return null;

        const firmRows = await tx<FirmRow[]>`
          SELECT id, name FROM tenant WHERE id = ${claim.tenant_id}
        `;
        const firm = firmRows[0];
        if (!firm) return null;

        const subjectRows = await tx<SubjectTenantRow[]>`
          SELECT id, name FROM subject_tenant
           WHERE id = ${claim.subject_tenant_id} AND deleted_at IS NULL
        `;
        const subject = subjectRows[0];
        if (!subject) return null;

        // Activities for this claim.
        const activityRows = await tx<ActivityRow[]>`
          SELECT id, code, title, kind, description
            FROM activity
           WHERE claim_id = ${claim.id}
           ORDER BY code ASC
        `;

        // Hypothesis text for each activity — pulled from events.
        interface HypothesisEventRow {
          payload: { raw_text?: string; activity_id?: string } & Record<string, unknown>;
        }
        const hypothesisRows = await tx<HypothesisEventRow[]>`
          SELECT payload
            FROM event
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND kind = 'HYPOTHESIS'
           ORDER BY captured_at ASC
        `;

        // Build activity_id → first hypothesis text map.
        const hypothesisByActivity = new Map<string, string>();
        for (const ev of hypothesisRows) {
          const actId = typeof ev.payload.activity_id === 'string' ? ev.payload.activity_id : null;
          if (actId && !hypothesisByActivity.has(actId)) {
            const raw = typeof ev.payload.raw_text === 'string' ? ev.payload.raw_text : '';
            hypothesisByActivity.set(actId, raw.slice(0, 200));
          }
        }

        // Expenditure total — proxy for eligible_expenditure.
        const expRows = await tx<{ total_amount: string | number | null }[]>`
          SELECT COALESCE(SUM(total_amount), 0) AS total_amount
            FROM expenditure
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND voided_at IS NULL
        `;
        const totalExpenditure = Number(expRows[0]?.total_amount ?? 0);

        // Low-confidence events → key_risks (confidence < 0.7 with
        // a classification present). Cap at 10 risks for PDF length.
        interface RiskEventRow {
          kind: string;
          payload: { raw_text?: string } & Record<string, unknown>;
          classification: { confidence: number; rationale: string } | null;
        }
        const riskRows = await tx<RiskEventRow[]>`
          SELECT kind, payload, classification
            FROM event
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND classification IS NOT NULL
             AND (classification->>'confidence')::float < 0.7
             AND kind NOT IN ('OVERRIDE', 'INELIGIBLE')
           ORDER BY (classification->>'confidence')::float ASC
           LIMIT 10
        `;

        return {
          claim,
          firm,
          subject,
          activityRows,
          hypothesisByActivity,
          totalExpenditure,
          riskRows,
        };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const generatedAt = new Date().toISOString();

      const coreCount = fetched.activityRows.filter((a) => a.kind === 'core').length;
      const supportingCount = fetched.activityRows.filter((a) => a.kind === 'supporting').length;

      // Australian RDTI: 43.5% offset for entities with aggregated
      // turnover < $20M (refundable offset). Used as default until a
      // dedicated rate field exists on the claim.
      // TODO(claim-rate): once claim gains an `rdti_rate` column, read
      // it here instead of hardcoding 0.435.
      const RDTI_RATE = 0.435;
      const taxOffsetEstimate = fetched.totalExpenditure * RDTI_RATE;

      const activities: ExecutiveSummaryInput['activities'] = fetched.activityRows.map((a) => ({
        code: a.code,
        title: a.title,
        kind: a.kind,
        hypothesis: fetched.hypothesisByActivity.get(a.id) ?? null,
      }));

      const keyRisks: ExecutiveSummaryInput['key_risks'] = fetched.riskRows.map((r) => {
        const conf = r.classification?.confidence ?? 0;
        const severity: 'high' | 'medium' | 'low' =
          conf < 0.4 ? 'high' : conf < 0.6 ? 'medium' : 'low';
        const raw =
          typeof r.payload.raw_text === 'string' ? r.payload.raw_text.slice(0, 160) : r.kind;
        return { description: raw, severity };
      });

      const input: ExecutiveSummaryInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        claim: {
          id: fetched.claim.id,
          fy_year: fetched.claim.fiscal_year,
          eligible_expenditure: fetched.totalExpenditure,
          tax_offset_estimate: taxOffsetEstimate,
          activity_count: fetched.activityRows.length,
          core_activity_count: coreCount,
          supporting_activity_count: supportingCount,
        },
        generated_at: generatedAt,
        content_hash_hex: contentHash({
          claim_id: fetched.claim.id,
          generated_at: generatedAt,
          activity_count: fetched.activityRows.length,
          eligible_expenditure: fetched.totalExpenditure,
        }),
        generator_version: '1.0.0',
        activities,
        key_risks: keyRisks,
        // preparer_notes: no dedicated column today — surface null so the
        // renderer omits the section. TODO: add claim.preparer_notes column.
        preparer_notes: null,
      };

      const bytes = await renderExecutiveSummaryPdf(input);

      const claimShort = sanitiseFilenamePart(fetched.claim.id.slice(-8), 8);
      const filename = `claim-${claimShort}-executive-summary.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /v1/claims/:id/portal-narrative.pdf — Portal Narrative Pack (F.6)
  // ---------------------------------------------------------------------------

  /**
   * GET /v1/claims/:id/portal-narrative.pdf
   *
   * Renders the Portal Narrative Pack — activity-by-activity narrative
   * content formatted for the AusIndustry portal. Each activity contributes
   * one or more sections: hypothesis, technical uncertainty, expected
   * outcome, and conclusion.
   *
   * The underlying renderer is a skeleton (F.6 spec) — it renders the
   * section headings and placeholder content. Once the renderer gains full
   * narrative rendering, the data loaded here will automatically flow
   * through without further route changes.
   *
   * Data sources (all within one RLS-scoped tx):
   *   - claim + firm + subject_tenant (header)
   *   - activity rows with narrative fields
   *
   * Filename: `claim-<claim_id_short>-portal-narrative.pdf`
   */
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/portal-narrative.pdf',
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

        const claimRows = await tx<ClaimRow[]>`
          SELECT id, tenant_id, subject_tenant_id, fiscal_year, stage
            FROM claim
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        const claim = claimRows[0];
        if (!claim) return null;

        const firmRows = await tx<FirmRow[]>`
          SELECT id, name FROM tenant WHERE id = ${claim.tenant_id}
        `;
        const firm = firmRows[0];
        if (!firm) return null;

        const subjectRows = await tx<SubjectTenantRow[]>`
          SELECT id, name FROM subject_tenant
           WHERE id = ${claim.subject_tenant_id} AND deleted_at IS NULL
        `;
        const subject = subjectRows[0];
        if (!subject) return null;

        // Activities with narrative fields for this claim.
        interface NarrativeActivityRow {
          id: string;
          code: string;
          title: string;
          kind: 'core' | 'supporting';
          hypothesis: string | null;
          technical_uncertainty: string | null;
          expected_outcome: string | null;
          actual_outcome: string | null;
        }
        const activityRows = await tx<NarrativeActivityRow[]>`
          SELECT id, code, title, kind,
                 hypothesis, technical_uncertainty, expected_outcome, actual_outcome
            FROM activity
           WHERE claim_id = ${claim.id}
           ORDER BY code ASC
        `;

        return { claim, firm, subject, activityRows };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const generatedAt = new Date().toISOString();

      // Build narrative_sections from the activity rows. Each activity
      // contributes one section per narrative field that is non-null.
      // The Portal Narrative Pack renderer (F.6 skeleton) displays each
      // section's heading + content_placeholder. When the renderer gains
      // full narrative rendering, these strings become the authoritative
      // content for the AusIndustry portal submission.
      const narrativeSections: PortalNarrativePackInput['narrative_sections'] = [];
      for (const a of fetched.activityRows) {
        const tag = `[${a.code}] ${a.title}`;
        if (a.hypothesis) {
          narrativeSections.push({
            section_kind: 'hypothesis',
            heading: `${tag} — Hypothesis`,
            content_placeholder: a.hypothesis.slice(0, 500),
          });
        }
        if (a.technical_uncertainty) {
          narrativeSections.push({
            section_kind: 'technical_uncertainty',
            heading: `${tag} — Technical Uncertainty`,
            content_placeholder: a.technical_uncertainty.slice(0, 500),
          });
        }
        if (a.expected_outcome) {
          narrativeSections.push({
            section_kind: 'expected_outcome',
            heading: `${tag} — Expected Outcome`,
            content_placeholder: a.expected_outcome.slice(0, 500),
          });
        }
        if (a.actual_outcome) {
          narrativeSections.push({
            section_kind: 'conclusion',
            heading: `${tag} — Conclusion`,
            content_placeholder: a.actual_outcome.slice(0, 500),
          });
        }
      }

      const input: PortalNarrativePackInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        claim: {
          id: fetched.claim.id,
          fy_year: fetched.claim.fiscal_year,
        },
        generated_at: generatedAt,
        content_hash_hex: contentHash({
          claim_id: fetched.claim.id,
          generated_at: generatedAt,
          section_count: narrativeSections.length,
        }),
        generator_version: '1.0.0',
        narrative_sections: narrativeSections,
      };

      const bytes = await renderPortalNarrativePackPdf(input);

      const claimShort = sanitiseFilenamePart(fetched.claim.id.slice(-8), 8);
      const filename = `claim-${claimShort}-portal-narrative.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(Buffer.from(bytes));
    },
  );

  // ---------------------------------------------------------------------------
  // GET /v1/claims/:id/evidence-index.pdf — Evidence Index (F.8)
  // ---------------------------------------------------------------------------

  /**
   * GET /v1/claims/:id/evidence-index.pdf
   *
   * Renders the Evidence Index — a tabular index of every evidence item
   * linked to the claim's activities, with hash, source, capture timestamp,
   * and forensic chain position.
   *
   * Data sources (all within one RLS-scoped tx):
   *   - claim + firm + subject_tenant (header)
   *   - media_artefact rows for the claim's subject_tenant (file metadata)
   *   - ARTEFACT_LINKED events → activity_codes (per artefact_id)
   *   - event.classification → evidence_kind + confidence
   *
   * Filename: `claim-<claim_id_short>-evidence-index.pdf`
   */
  app.get<{ Params: { id: string } }>(
    '/v1/claims/:id/evidence-index.pdf',
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

        const claimRows = await tx<ClaimRow[]>`
          SELECT id, tenant_id, subject_tenant_id, fiscal_year, stage
            FROM claim
           WHERE id = ${claimId}
             AND tenant_id = ${tenantId}
        `;
        const claim = claimRows[0];
        if (!claim) return null;

        const firmRows = await tx<FirmRow[]>`
          SELECT id, name FROM tenant WHERE id = ${claim.tenant_id}
        `;
        const firm = firmRows[0];
        if (!firm) return null;

        const subjectRows = await tx<SubjectTenantRow[]>`
          SELECT id, name FROM subject_tenant
           WHERE id = ${claim.subject_tenant_id} AND deleted_at IS NULL
        `;
        const subject = subjectRows[0];
        if (!subject) return null;

        // Media artefacts for this claim's subject_tenant. Each row is one
        // evidence item in the index. Order by uploaded_at ASC so the index
        // is deterministic across runs.
        interface MediaIndexRow {
          id: string;
          content_hash: string;
          mime_type: string;
          size_bytes: number | string;
          uploaded_at: Date | string;
          s3_key: string;
          event_id: string | null;
        }
        const mediaRows = await tx<MediaIndexRow[]>`
          SELECT id, content_hash, mime_type, size_bytes, uploaded_at, s3_key, event_id
            FROM media_artefact
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
           ORDER BY uploaded_at ASC
        `;

        // Activities for this claim (to resolve activity codes from
        // ARTEFACT_LINKED events whose payload.activity_id matches).
        const activityRows = await tx<{ id: string; code: string }[]>`
          SELECT id, code
            FROM activity
           WHERE claim_id = ${claim.id}
        `;

        // ARTEFACT_LINKED events for this subject_tenant — materialise
        // the live link set (LINKED − UNLINKED = alive) to map
        // artefact_id → activity codes. Mirrors activity-pdf.ts artefact
        // fold logic.
        interface LinkRow {
          kind: 'ARTEFACT_LINKED' | 'ARTEFACT_UNLINKED';
          payload: {
            activity_id?: string;
            artefact_kind?: string;
            artefact_id?: string;
          };
        }
        const linkRows = await tx<LinkRow[]>`
          SELECT kind, payload
            FROM event
           WHERE kind IN ('ARTEFACT_LINKED', 'ARTEFACT_UNLINKED')
             AND subject_tenant_id = ${claim.subject_tenant_id}
           ORDER BY captured_at ASC, received_at ASC, id ASC
        `;

        // Classification events: artefact_id → { kind, confidence }.
        // We look for events whose payload carries 'artefact_id' to
        // find classification metadata for evidence items.
        interface ClassArtefactRow {
          kind: string;
          payload: { artefact_id?: string } & Record<string, unknown>;
          classification: { confidence: number } | null;
        }
        const classRows = await tx<ClassArtefactRow[]>`
          SELECT kind, payload, classification
            FROM event
           WHERE subject_tenant_id = ${claim.subject_tenant_id}
             AND classification IS NOT NULL
             AND payload ? 'artefact_id'
        `;

        return {
          claim,
          firm,
          subject,
          mediaRows,
          activityRows,
          linkRows,
          classRows,
        };
      });

      if (fetched == null) {
        return reply.status(404).send({
          error: 'claim_not_found',
          message: 'No claim with that id in this firm',
          requestId: req.id,
        });
      }

      const generatedAt = new Date().toISOString();

      // Build activity id → code map.
      const activityCodeById = new Map<string, string>(
        fetched.activityRows.map((a) => [a.id, a.code]),
      );

      // Materialise live artefact → activity_codes from link events.
      // Key = artefact_id; value = Set<activity_code>.
      const artefactActivities = new Map<string, Set<string>>();
      for (const link of fetched.linkRows) {
        const artefactId = link.payload.artefact_id;
        const activityId = link.payload.activity_id;
        if (!artefactId) continue;

        if (link.kind === 'ARTEFACT_LINKED') {
          if (!artefactActivities.has(artefactId)) {
            artefactActivities.set(artefactId, new Set());
          }
          if (activityId) {
            const code = activityCodeById.get(activityId);
            if (code) artefactActivities.get(artefactId)!.add(code);
          }
        } else {
          // ARTEFACT_UNLINKED — remove the specific activity link.
          if (activityId) {
            const code = activityCodeById.get(activityId);
            if (code) artefactActivities.get(artefactId)?.delete(code);
          }
        }
      }

      // Build artefact_id → { evidence_kind, confidence } from
      // classification events.
      const artefactClass = new Map<string, { kind: string; confidence: number }>();
      for (const ev of fetched.classRows) {
        const artefactId =
          typeof ev.payload.artefact_id === 'string' ? ev.payload.artefact_id : null;
        if (artefactId && !artefactClass.has(artefactId)) {
          artefactClass.set(artefactId, {
            kind: ev.kind,
            confidence: ev.classification?.confidence ?? 0,
          });
        }
      }

      // Build evidence_items from media_artefact rows. The s3_key's
      // trailing segment is the SHA-256 (see buildS3Key in media.ts).
      const evidenceItems: EvidenceIndexInput['evidence_items'] = fetched.mediaRows.map((m) => {
        const sha256Parts = m.s3_key.split('/');
        const sha256 = sha256Parts[sha256Parts.length - 1] ?? m.content_hash;
        const uploadedAt =
          m.uploaded_at instanceof Date
            ? m.uploaded_at.toISOString()
            : new Date(m.uploaded_at).toISOString();

        // Filename: derive from sha256 prefix (no original filename stored
        // in v1 media_artefact schema — TODO: add filename column).
        const filename = sha256.slice(0, 12) + '…';

        // Activity codes from the live link set.
        const activityCodes = Array.from(artefactActivities.get(m.id) ?? []).sort();

        // Classification from events, or derive from mime_type.
        const cls = artefactClass.get(m.id);
        const evidenceKind = cls?.kind ?? (m.mime_type.startsWith('image/') ? 'IMAGE' : 'DOCUMENT');
        const confidence = cls?.confidence ?? 1.0;

        return {
          id: m.id,
          filename,
          evidence_kind: evidenceKind,
          classified_confidence: confidence,
          activity_codes: activityCodes,
          sha256,
          uploaded_at: uploadedAt,
          size_bytes: typeof m.size_bytes === 'string' ? Number(m.size_bytes) : m.size_bytes,
        };
      });

      const input: EvidenceIndexInput = {
        firm: { name: fetched.firm.name, abn: null },
        subject_tenant: { name: fetched.subject.name, abn: null },
        claim: {
          id: fetched.claim.id,
          fy_year: fetched.claim.fiscal_year,
        },
        generated_at: generatedAt,
        content_hash_hex: contentHash({
          claim_id: fetched.claim.id,
          generated_at: generatedAt,
          evidence_count: evidenceItems.length,
        }),
        generator_version: '1.0.0',
        evidence_items: evidenceItems,
      };

      const bytes = await renderEvidenceIndexPdf(input);

      const claimShort = sanitiseFilenamePart(fetched.claim.id.slice(-8), 8);
      const filename = `claim-${claimShort}-evidence-index.pdf`;

      void reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(Buffer.from(bytes));
    },
  );
}

/**
 * Map the DB-level `source` enum to the PDF's `kind` discriminator.
 *
 * Four DB values collapse to three PDF kinds:
 *   - xero_invoice → INVOICE
 *   - xero_bank_tx → BANK_TX
 *   - xero_receipt → RECEIPT
 *   - manual       → RECEIPT (see comment in the `manual` arm below
 *     for the cross-swimlane reconciliation rationale)
 *
 * The regulator-facing document doesn't distinguish "manual vs Xero"
 * origin — that's an audit-trail concern carried by `source` itself,
 * not the document kind. The collapse keeps the PDF column terse.
 *
 * `source` is typed as `ExpenditureSource` (the enum from `@cpa/db`)
 * rather than a loose `string`. When a future migration adds a 5th
 * source value, the typecheck fails at this site and forces an
 * explicit decision.
 */
function classifyKind(source: ExpenditureSource): 'INVOICE' | 'BANK_TX' | 'RECEIPT' {
  switch (source) {
    case 'xero_bank_tx':
      return 'BANK_TX';
    case 'xero_receipt':
      return 'RECEIPT';
    case 'xero_invoice':
      return 'INVOICE';
    case 'manual':
      // 'manual' source maps to 'RECEIPT' kind. This was reconciled
      // across swimlanes during the P4 merge — see
      // docs/decisions/0006-p4-merge-plan.md section 4.1. The
      // rationale: manual entries are user-captured proof (closer to
      // a receipt than a vendor-issued invoice). Both this file and
      // preview-rules.ts must agree.
      return 'RECEIPT';
  }
}
