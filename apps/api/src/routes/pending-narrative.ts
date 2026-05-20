import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '@cpa/auth';
import { sql } from '@cpa/db/client';
import { insertEventWithChain, nextActivityCode } from '@cpa/db';
import {
  NarrativeApprovedPayload,
  ActivityReviewedPayload,
  ExpenditureReviewedPayload,
} from '@cpa/schemas';
import {
  makeNarrativeSummarizer,
  type NarrativeSummarizer,
  type NarrativeSummarizerInput,
} from '@cpa/agents';

/**
 * B+C narrative-approval flow endpoints.
 *
 * Surface area:
 *
 *   GET  /v1/subject-tenants/:id/pending-narrative
 *     Returns either { status: 'none' } or a full pending-narrative payload
 *     with AI-generated project narrative + pending proposals. The narrative
 *     is produced by the narrative-summarizer agent (OpusNarrativeSummarizer
 *     in production, StubNarrativeSummarizer in CI / test).
 *
 *   POST /v1/subject-tenants/:id/approve-narrative
 *     Bulk-creates activities and expenditures from all pending proposals,
 *     respecting AUTO_CREATE_CONFIDENCE_THRESHOLD. Low-confidence records
 *     get needs_review=true. Emits one NARRATIVE_APPROVED chain event.
 *
 *   POST /v1/activities/:id/mark-reviewed
 *     Clears needs_review on an activity and emits ACTIVITY_REVIEWED.
 *
 *   POST /v1/expenditures/:id/mark-reviewed
 *     Clears needs_review on an expenditure and emits EXPENDITURE_REVIEWED.
 *
 * Auth: requireSession on all routes.
 * RLS: every query uses sql.begin + set_config('app.current_tenant_id', ...).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProposalActivity = {
  proposed_name: string;
  proposed_kind: 'core' | 'supporting';
  hypothesis_text: string;
  technical_uncertainty: string;
  expected_outcome: string;
  confidence: number;
  rationale: string;
};

type ProposalInvoice = {
  vendor_name: string;
  invoice_date: string;
  amount_aud: number;
  gst_aud: number | null;
  total_aud: number;
  invoice_number: string | null;
  line_items: Array<{ description: string; amount_aud: number }>;
  confidence: number;
};

type PendingEventRow = {
  id: string;
  subject_tenant_id: string;
  captured_at: Date | string;
  extracted_content: {
    activities?: ProposalActivity[];
    invoices?: ProposalInvoice[];
    document_summary?: string;
  } | null;
  // payload may carry filename
  payload: { filename?: string; raw_text?: string; text?: string } | null;
};

type ClaimRow = {
  id: string;
  project_id: string;
  fiscal_year: number;
};

type ExcludedProposal = {
  event_id: string;
  kind: 'activity' | 'invoice';
  index: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isoOf = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

const AUTO_CREATE_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.AUTO_CREATE_CONFIDENCE_THRESHOLD ?? '0.80',
);

/**
 * Load the most recent NARRATIVE_APPROVED chain event for a subject_tenant.
 * Returns the captured_at timestamp, or null if none exists.
 */
async function loadLastApprovalAt(subjectTenantId: string, tenantId: string): Promise<Date | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return await tx<{ captured_at: Date | string }[]>`
      SELECT captured_at
        FROM event
       WHERE tenant_id         = ${tenantId}
         AND subject_tenant_id = ${subjectTenantId}
         AND kind              = 'NARRATIVE_APPROVED'
       ORDER BY captured_at DESC, received_at DESC, id DESC
       LIMIT 1
    `;
  });
  const row = rows[0];
  if (!row) return null;
  return typeof row.captured_at === 'string' ? new Date(row.captured_at) : row.captured_at;
}

/**
 * Load pending extraction events for a subject_tenant.
 *
 * "Pending" = extraction_status = 'complete' AND at least one proposal in
 * extracted_content has NOT yet been confirmed (i.e. no ARTEFACT_LINKED
 * chain event exists whose payload.artefact_id = this event's id AND
 * whose payload.artefact_kind = 'event').
 *
 * If `since` is provided, only events captured_at > since are returned
 * (post-last-approval batch). If null, all pending events are returned.
 */
async function loadPendingEvents(
  subjectTenantId: string,
  tenantId: string,
  since: Date | null,
): Promise<PendingEventRow[]> {
  return await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

    // Load all complete extraction events, optionally filtered to those
    // captured after the last approval.
    // We check for ARTEFACT_LINKED events that reference this event as
    // artefact_kind='event' to determine if ANY proposal was already linked.
    // A document is considered "pending" when it has proposals that have NOT
    // yet been linked.
    type RawRow = {
      id: string;
      subject_tenant_id: string;
      captured_at: Date | string;
      extracted_content: PendingEventRow['extracted_content'];
      payload: PendingEventRow['payload'];
      linked_count: string; // postgres returns bigint as string
    };

    const rows = since
      ? await tx<RawRow[]>`
          SELECT e.id,
                 e.subject_tenant_id,
                 e.captured_at,
                 e.extracted_content,
                 e.payload,
                 (
                   SELECT COUNT(*)
                     FROM event link
                    WHERE link.tenant_id         = ${tenantId}
                      AND link.subject_tenant_id = ${subjectTenantId}
                      AND link.kind              = 'ARTEFACT_LINKED'
                      AND (link.payload ->> 'artefact_kind') = 'event'
                      AND (link.payload ->> 'artefact_id')   = e.id::text
                 ) AS linked_count
            FROM event e
           WHERE e.tenant_id         = ${tenantId}
             AND e.subject_tenant_id = ${subjectTenantId}
             AND e.extraction_status = 'complete'
             AND e.captured_at       > ${since.toISOString()}::timestamptz
           ORDER BY e.captured_at ASC
        `
      : await tx<RawRow[]>`
          SELECT e.id,
                 e.subject_tenant_id,
                 e.captured_at,
                 e.extracted_content,
                 e.payload,
                 (
                   SELECT COUNT(*)
                     FROM event link
                    WHERE link.tenant_id         = ${tenantId}
                      AND link.subject_tenant_id = ${subjectTenantId}
                      AND link.kind              = 'ARTEFACT_LINKED'
                      AND (link.payload ->> 'artefact_kind') = 'event'
                      AND (link.payload ->> 'artefact_id')   = e.id::text
                 ) AS linked_count
            FROM event e
           WHERE e.tenant_id         = ${tenantId}
             AND e.subject_tenant_id = ${subjectTenantId}
             AND e.extraction_status = 'complete'
           ORDER BY e.captured_at ASC
        `;

    // Only return events with at least one un-linked proposal.
    return rows
      .filter((r) => {
        const linked = parseInt(r.linked_count, 10);
        const content = r.extracted_content;
        if (!content) return false;
        const actCount = content.activities?.length ?? 0;
        const invCount = content.invoices?.length ?? 0;
        // If all proposals have been linked already, skip. We use a simple
        // heuristic: if linked_count >= total proposals, consider it done.
        const total = actCount + invCount;
        return total > 0 && linked < total;
      })
      .map((r) => ({
        id: r.id,
        subject_tenant_id: r.subject_tenant_id,
        captured_at: r.captured_at,
        extracted_content: r.extracted_content,
        payload: r.payload,
      }));
  });
}

/**
 * Apply a single proposed activity proposal: insert the activity row
 * and emit ACTIVITY_CREATED + ARTEFACT_LINKED + SUPPORTING chain events.
 *
 * This is the factored helper shared by:
 *  - The existing POST /v1/proposed-activities/:event_id/accept endpoint
 *    (events.ts — which still works unchanged).
 *  - The new POST /v1/subject-tenants/:id/approve-narrative endpoint
 *    (this file).
 *
 * Returns the created activity_id, code, and kind.
 */
export async function applyProposedActivity(
  tenantId: string,
  userId: string,
  eventId: string,
  subjectTenantId: string,
  claimRow: ClaimRow,
  proposal: ProposalActivity,
  activityIndex: number,
  opts: { autoAccepted: boolean; threshold: number },
): Promise<{ activity_id: string; code: string; kind: 'core' | 'supporting' }> {
  const code = await nextActivityCode({
    claim_id: claimRow.id,
    kind: proposal.proposed_kind,
  });

  const activityId = crypto.randomUUID();
  const now = new Date().toISOString();
  const fyLabel = `FY${(claimRow.fiscal_year - 2000).toString().padStart(2, '0')}`;
  const needsReview = proposal.confidence < opts.threshold;

  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await tx`
      INSERT INTO activity (
        id, tenant_id, project_id, claim_id, code, kind,
        title, hypothesis, technical_uncertainty, expected_outcome,
        fy_label, hypothesis_formed_at,
        needs_review, proposal_confidence, proposed_from_event_id
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
        ${now}::timestamptz,
        ${needsReview},
        ${String(proposal.confidence)},
        ${eventId}::uuid
      )
    `;
  });

  // Emit ACTIVITY_CREATED chain event.
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
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
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
    kind: 'ARTEFACT_LINKED',
    payload: {
      _v: 1,
      activity_id: activityId,
      artefact_kind: 'event',
      artefact_id: eventId,
      link_reason: opts.autoAccepted
        ? `Auto-linked from AI document extraction via narrative approval (proposal index ${activityIndex})`
        : `Auto-linked from AI document extraction (proposal index ${activityIndex})`,
    },
    classification: null,
    captured_at: new Date(),
    captured_by_user_id: userId,
    override_of_event_id: null,
    override_new_kind: null,
    override_reason: null,
    idempotency_key: null,
  });

  // Emit SUPPORTING chain event (provenance trail).
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
    kind: 'SUPPORTING',
    payload: {
      _v: 1,
      source: opts.autoAccepted ? 'PROPOSED_ACTIVITY_AUTO_ACCEPTED' : 'proposed_activity_accepted',
      source_event_id: eventId,
      activity_index: activityIndex,
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

  return { activity_id: activityId, code, kind: proposal.proposed_kind };
}

/**
 * Apply a single proposed invoice: insert the expenditure row (and line
 * items) and emit EXPENDITURE_INGESTED + SUPPORTING chain events.
 *
 * Shared by the existing POST /v1/proposed-invoices/:event_id/accept
 * (events.ts — unchanged) and the new approve-narrative endpoint.
 */
export async function applyProposedInvoice(
  tenantId: string,
  userId: string,
  eventId: string,
  subjectTenantId: string,
  claimRow: ClaimRow,
  invoice: ProposalInvoice,
  invoiceIndex: number,
  opts: { autoAccepted: boolean; threshold: number },
): Promise<{ expenditure_id: string; vendor_name: string; total_aud: number }> {
  const expenditureId = crypto.randomUUID();
  const needsReview = invoice.confidence < opts.threshold;

  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

    await tx`
      INSERT INTO expenditure (
        id, tenant_id, subject_tenant_id, claim_id,
        vendor_name, reference,
        expenditure_date,
        total_amount, currency,
        source, ingested_at,
        needs_review, proposal_confidence, proposed_from_event_id
      ) VALUES (
        ${expenditureId}::uuid,
        ${tenantId}::uuid,
        ${subjectTenantId}::uuid,
        ${claimRow.id}::uuid,
        ${invoice.vendor_name},
        ${invoice.invoice_number ?? null},
        ${invoice.invoice_date}::date,
        ${String(invoice.total_aud)},
        'AUD',
        'manual',
        NOW(),
        ${needsReview},
        ${String(invoice.confidence)},
        ${eventId}::uuid
      )
    `;

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
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
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

  // Emit SUPPORTING chain event (provenance trail).
  await insertEventWithChain({
    tenant_id: tenantId,
    subject_tenant_id: subjectTenantId,
    kind: 'SUPPORTING',
    payload: {
      _v: 1,
      source: opts.autoAccepted ? 'PROPOSED_INVOICE_AUTO_ACCEPTED' : 'proposed_invoice_accepted',
      source_event_id: eventId,
      invoice_index: invoiceIndex,
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

  return {
    expenditure_id: expenditureId,
    vendor_name: invoice.vendor_name,
    total_aud: invoice.total_aud,
  };
}

// ---------------------------------------------------------------------------
// Lazy singleton for the narrative summarizer.
// Same pattern as the classifier in events.ts.
// ---------------------------------------------------------------------------

let summarizerInstance: NarrativeSummarizer | null = null;
const getSummarizer = (): NarrativeSummarizer => {
  if (!summarizerInstance) summarizerInstance = makeNarrativeSummarizer();
  return summarizerInstance;
};

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerPendingNarrative(app: FastifyInstance): void {
  // -------------------------------------------------------------------------
  // GET /v1/subject-tenants/:id/pending-narrative
  // Returns pending proposals + AI-generated narrative, or { status: 'none' }
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id/pending-narrative',
    { preHandler: requireSession },
    async (req, reply) => {
      const subjectTenantId = req.params.id;
      const tenantId = req.user!.tenantId!;

      // Verify subject_tenant exists and belongs to this tenant.
      const stRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string; name: string }[]>`
          SELECT id, name
            FROM subject_tenant
           WHERE id        = ${subjectTenantId}
             AND tenant_id = ${tenantId}
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!stRow) {
        return reply.status(404).send({
          error: 'subject_tenant_not_found',
          message: 'No subject tenant with that id in this firm',
          requestId: req.id,
        });
      }

      // Determine the batch window: since last NARRATIVE_APPROVED (or all time).
      const lastApprovalAt = await loadLastApprovalAt(subjectTenantId, tenantId);
      const pendingEvents = await loadPendingEvents(subjectTenantId, tenantId, lastApprovalAt);

      if (pendingEvents.length === 0) {
        return reply.status(200).send({ status: 'none' });
      }

      // Build the narrative-summarizer input from pending events.
      const documentSummaries: NarrativeSummarizerInput['document_summaries'] = [];
      const proposedActivities: NarrativeSummarizerInput['proposed_activities'] = [];
      const proposedInvoices: NarrativeSummarizerInput['proposed_invoices'] = [];

      const documentsOut: Array<{ event_id: string; filename: string; captured_at: string }> = [];
      const activitiesOut: Array<{
        event_id: string;
        index: number;
        name: string;
        kind: 'core' | 'supporting';
        hypothesis: string;
        confidence: number;
      }> = [];
      const invoicesOut: Array<{
        event_id: string;
        index: number;
        vendor: string;
        total_aud: number;
        confidence: number;
      }> = [];

      for (const ev of pendingEvents) {
        const filename = ev.payload?.filename ?? `document-${ev.id.slice(0, 8)}`;
        const content = ev.extracted_content;
        const docSummary = content?.document_summary ?? `Extracted from ${filename}`;

        documentSummaries.push({ filename, summary: docSummary });
        documentsOut.push({
          event_id: ev.id,
          filename,
          captured_at: isoOf(ev.captured_at),
        });

        for (const [idx, act] of (content?.activities ?? []).entries()) {
          proposedActivities.push({
            name: act.proposed_name,
            kind: act.proposed_kind,
            hypothesis: act.hypothesis_text,
            confidence: act.confidence,
          });
          activitiesOut.push({
            event_id: ev.id,
            index: idx,
            name: act.proposed_name,
            kind: act.proposed_kind,
            hypothesis: act.hypothesis_text,
            confidence: act.confidence,
          });
        }

        for (const [idx, inv] of (content?.invoices ?? []).entries()) {
          proposedInvoices.push({
            vendor: inv.vendor_name,
            total_aud: inv.total_aud,
            confidence: inv.confidence,
          });
          invoicesOut.push({
            event_id: ev.id,
            index: idx,
            vendor: inv.vendor_name,
            total_aud: inv.total_aud,
            confidence: inv.confidence,
          });
        }
      }

      // Call the narrative summarizer.
      let summaryResult;
      try {
        summaryResult = await getSummarizer().summarize({
          subject_tenant_name: stRow.name,
          document_summaries: documentSummaries,
          proposed_activities: proposedActivities,
          proposed_invoices: proposedInvoices,
        });
      } catch (err) {
        req.log.error({ err, subjectTenantId, tenantId }, 'narrative-summarizer failed');
        return reply.status(503).send({
          error: 'narrative_summarizer_unavailable',
          message: 'Could not generate narrative summary; retry shortly',
          requestId: req.id,
        });
      }

      return reply.status(200).send({
        status: 'pending',
        narrative: summaryResult.narrative,
        total_aud: summaryResult.total_aud,
        core_count: summaryResult.core_count,
        supporting_count: summaryResult.supporting_count,
        invoice_count: summaryResult.invoice_count,
        document_count: summaryResult.document_count,
        documents: documentsOut,
        activities: activitiesOut,
        invoices: invoicesOut,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/subject-tenants/:id/approve-narrative
  // Bulk-creates activities and expenditures from all pending proposals.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/subject-tenants/:id/approve-narrative',
    { preHandler: requireSession },
    async (req, reply) => {
      const subjectTenantId = req.params.id;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Validate body.
      const body = req.body as {
        excluded_proposals?: Array<{
          event_id: string;
          kind: 'activity' | 'invoice';
          index: number;
        }>;
      } | null;
      const excludedProposals: ExcludedProposal[] = body?.excluded_proposals ?? [];

      // Build exclusion lookup for O(1) checks.
      const excludeSet = new Set(
        excludedProposals.map((e) => `${e.event_id}:${e.kind}:${e.index}`),
      );

      // Verify subject_tenant exists.
      const stRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT id
            FROM subject_tenant
           WHERE id        = ${subjectTenantId}
             AND tenant_id = ${tenantId}
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!stRow) {
        return reply.status(404).send({
          error: 'subject_tenant_not_found',
          message: 'No subject tenant with that id in this firm',
          requestId: req.id,
        });
      }

      // Load active claim for this subject tenant.
      const claimRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<ClaimRow[]>`
          SELECT c.id, c.project_id, c.fiscal_year
            FROM claim c
           WHERE c.subject_tenant_id = ${subjectTenantId}
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

      // Determine the batch window.
      const lastApprovalAt = await loadLastApprovalAt(subjectTenantId, tenantId);
      const pendingEvents = await loadPendingEvents(subjectTenantId, tenantId, lastApprovalAt);

      if (pendingEvents.length === 0) {
        return reply.status(200).send({
          activities_created: 0,
          invoices_created: 0,
          excluded_count: 0,
          total_aud: 0,
        });
      }

      const threshold = AUTO_CREATE_CONFIDENCE_THRESHOLD;

      let activitiesCreated = 0;
      let invoicesCreated = 0;
      let excludedCount = 0;
      let totalAud = 0;

      // Process each pending event's proposals.
      for (const ev of pendingEvents) {
        const content = ev.extracted_content;
        if (!content) continue;

        // Activities.
        for (const [idx, proposal] of (content.activities ?? []).entries()) {
          const key = `${ev.id}:activity:${idx}`;
          if (excludeSet.has(key)) {
            excludedCount++;
            continue;
          }
          try {
            await applyProposedActivity(
              tenantId,
              userId,
              ev.id,
              subjectTenantId,
              claimRow,
              proposal,
              idx,
              { autoAccepted: true, threshold },
            );
            activitiesCreated++;
          } catch (err) {
            req.log.error(
              { err, event_id: ev.id, activity_index: idx },
              'approve-narrative: activity creation failed — skipping',
            );
            // Non-fatal: log and continue processing other proposals.
          }
        }

        // Invoices.
        for (const [idx, invoice] of (content.invoices ?? []).entries()) {
          const key = `${ev.id}:invoice:${idx}`;
          if (excludeSet.has(key)) {
            excludedCount++;
            continue;
          }
          try {
            const result = await applyProposedInvoice(
              tenantId,
              userId,
              ev.id,
              subjectTenantId,
              claimRow,
              invoice,
              idx,
              { autoAccepted: true, threshold },
            );
            invoicesCreated++;
            totalAud += result.total_aud;
          } catch (err) {
            req.log.error(
              { err, event_id: ev.id, invoice_index: idx },
              'approve-narrative: invoice creation failed — skipping',
            );
          }
        }
      }

      // Emit the single NARRATIVE_APPROVED chain event.
      const approvedPayload = NarrativeApprovedPayload.parse({
        _v: 1,
        activities_created: activitiesCreated,
        invoices_created: invoicesCreated,
        total_aud: totalAud,
        excluded_count: excludedCount,
        threshold,
      });

      try {
        await insertEventWithChain({
          tenant_id: tenantId,
          subject_tenant_id: subjectTenantId,
          kind: 'NARRATIVE_APPROVED',
          payload: approvedPayload,
          classification: null,
          captured_at: new Date(),
          captured_by_user_id: userId,
          override_of_event_id: null,
          override_new_kind: null,
          override_reason: null,
          idempotency_key: null,
        });
      } catch (err) {
        // Chain emit failure: log but do NOT fail the response.
        // The activities/expenditures were already created; the chain
        // event is important for the audit trail but we shouldn't
        // undo the creations just because the event insertion failed.
        req.log.error(
          { err, subjectTenantId, tenantId },
          'NARRATIVE_APPROVED chain emit failed — activities/invoices were created',
        );
      }

      return reply.status(200).send({
        activities_created: activitiesCreated,
        invoices_created: invoicesCreated,
        excluded_count: excludedCount,
        total_aud: totalAud,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/activities/:id/mark-reviewed
  // Clears the needs_review flag on an activity and emits ACTIVITY_REVIEWED.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/activities/:id/mark-reviewed',
    { preHandler: requireSession },
    async (req, reply) => {
      const activityId = req.params.id;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Load activity + its current state under RLS.
      const activityRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            needs_review: boolean;
            proposal_confidence: string | null;
          }[]
        >`
          SELECT a.id,
                 p.subject_tenant_id,
                 a.needs_review,
                 a.proposal_confidence
            FROM activity a
            JOIN project p ON p.id = a.project_id
           WHERE a.id        = ${activityId}
             AND a.tenant_id = ${tenantId}
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!activityRow) {
        return reply.status(404).send({
          error: 'activity_not_found',
          message: 'No activity with that id in this firm',
          requestId: req.id,
        });
      }

      // Update needs_review = false.
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          UPDATE activity
             SET needs_review = false,
                 updated_at   = NOW()
           WHERE id        = ${activityId}
             AND tenant_id = ${tenantId}
        `;
      });

      // Emit ACTIVITY_REVIEWED chain event.
      const previousConfidence =
        activityRow.proposal_confidence !== null
          ? parseFloat(activityRow.proposal_confidence)
          : null;

      const reviewedPayload = ActivityReviewedPayload.parse({
        _v: 1,
        activity_id: activityId,
        reviewed_by_user_id: userId,
        previously_confidence: previousConfidence,
      });

      await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: activityRow.subject_tenant_id,
        kind: 'ACTIVITY_REVIEWED',
        payload: reviewedPayload,
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(200).send({
        activity_id: activityId,
        needs_review: false,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /v1/expenditures/:id/mark-reviewed
  // Clears the needs_review flag on an expenditure and emits
  // EXPENDITURE_REVIEWED.
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/expenditures/:id/mark-reviewed',
    { preHandler: requireSession },
    async (req, reply) => {
      const expenditureId = req.params.id;
      const tenantId = req.user!.tenantId!;
      const userId = req.user!.id;

      // Load expenditure under RLS.
      const expRow = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        const rows = await tx<
          {
            id: string;
            subject_tenant_id: string;
            needs_review: boolean;
            proposal_confidence: string | null;
          }[]
        >`
          SELECT id,
                 subject_tenant_id,
                 needs_review,
                 proposal_confidence
            FROM expenditure
           WHERE id        = ${expenditureId}
             AND tenant_id = ${tenantId}
           LIMIT 1
        `;
        return rows[0] ?? null;
      });

      if (!expRow) {
        return reply.status(404).send({
          error: 'expenditure_not_found',
          message: 'No expenditure with that id in this firm',
          requestId: req.id,
        });
      }

      // Update needs_review = false.
      // Note: expenditure table has no updated_at column — only needs_review is patched.
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        await tx`
          UPDATE expenditure
             SET needs_review = false
           WHERE id        = ${expenditureId}
             AND tenant_id = ${tenantId}
        `;
      });

      // Emit EXPENDITURE_REVIEWED chain event.
      const previousConfidence =
        expRow.proposal_confidence !== null ? parseFloat(expRow.proposal_confidence) : null;

      const reviewedPayload = ExpenditureReviewedPayload.parse({
        _v: 1,
        expenditure_id: expenditureId,
        reviewed_by_user_id: userId,
        previously_confidence: previousConfidence,
      });

      await insertEventWithChain({
        tenant_id: tenantId,
        subject_tenant_id: expRow.subject_tenant_id,
        kind: 'EXPENDITURE_REVIEWED',
        payload: reviewedPayload,
        classification: null,
        captured_at: new Date(),
        captured_by_user_id: userId,
        override_of_event_id: null,
        override_new_kind: null,
        override_reason: null,
        idempotency_key: null,
      });

      return reply.status(200).send({
        expenditure_id: expenditureId,
        needs_review: false,
      });
    },
  );
}
