#!/usr/bin/env tsx
/**
 * Seeds 10 distinct test scenarios into the local dev Postgres so the
 * consultant portal, wizard, expenditure mapping, and narrative views
 * can be exercised end-to-end against realistic rows.
 *
 *   pnpm exec tsx --env-file=../../.env seed-test-cases.ts
 *
 * One firm tenant, one consultant user, one subject_tenant (claimant
 * company), one project, one FY26 claim, two activities (CORE +
 * SUPPORTING). All ten cases attach to that one claim.
 *
 * The script is idempotent — it wipes any prior run's rows (scoped to
 * the `c0a1*` UUID namespace) before reseeding.
 *
 * Chain integrity: every event has a fixture-provided captured_at, but
 * `insertEventWithChain` picks each new event's parent by "latest
 * captured_at to date" and `verifyChain` walks in captured_at ASC.
 * Inserting events in random order produces a chain whose hashes don't
 * verify on the ASC walk. Fix: collect every PendingEvent across all
 * cases, sort by captured_at globally, THEN insert.
 *
 * See tools/test-fixtures/README.md for what each case represents.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertEventWithChain, verifyChain } from '@cpa/db';
import { privilegedSql, sql } from '@cpa/db/client';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-fixtures');

// All UUIDs use the c0a1 prefix (mnemonic: "claim-0 A-1") so cleanup
// can target the namespace. UUIDs are pure hex per RFC 4122.
const TENANT_ID = '00000000-0000-4000-8000-c0a100000001';
const USER_ID = '00000000-0000-4000-8000-c0a100000010';
const SUBJECT_ID = '00000000-0000-4000-8000-c0a100000021';
const PROJECT_ID = '00000000-0000-4000-8000-c0a100000031';
const CLAIM_ID = '00000000-0000-4000-8000-c0a100000041';
const ACTIVITY_CORE = '00000000-0000-4000-8000-c0a100000051';
const ACTIVITY_SUPP = '00000000-0000-4000-8000-c0a100000052';

const EXP_08_BLUESCOPE = '00000000-0000-4000-8000-c0a100000081';
const EXP_10_CSIRO = '00000000-0000-4000-8000-c0a100000082';
const EXP_10_AWS = '00000000-0000-4000-8000-c0a100000083';
const EXP_10_AGILENT = '00000000-0000-4000-8000-c0a100000084';

const FY = 'FY26';
const FISCAL_YEAR = 2026;

interface PendingEvent {
  case_n: number;
  case_label: string;
  kind: string;
  payload: Record<string, unknown>;
  classification: Record<string, unknown> | null;
  captured_at: Date;
  /** When set, also stamp the resulting event row's extracted_content + extraction_status. */
  extracted_content?: Record<string, unknown>;
}

interface CaseSummary {
  n: number;
  label: string;
  event_kinds: string[];
  expenditure_ids: string[];
  note?: string;
}

const PENDING: PendingEvent[] = [];
const PENDING_EXPENDITURES: Array<{
  case_n: number;
  id: string;
  source: 'xero_invoice' | 'xero_bank_tx' | 'xero_receipt' | 'manual';
  source_external_id: string | null;
  vendor_name: string;
  reference: string;
  expenditure_date: string;
  total_amount: string;
  currency: string;
  raw_payload: Record<string, unknown> | null;
}> = [];
const SUMMARIES: CaseSummary[] = [];

// ─── Cleanup + base seed ────────────────────────────────────────────

async function cleanup(): Promise<void> {
  await privilegedSql`DELETE FROM event WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM expenditure WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM activity WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM claim WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM project WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM subject_tenant WHERE tenant_id = ${TENANT_ID}`;
  await privilegedSql`DELETE FROM tenant_user WHERE tenant_id = ${TENANT_ID}`;
  await sql`DELETE FROM "user" WHERE id = ${USER_ID}`;
  await sql`DELETE FROM tenant WHERE id = ${TENANT_ID}`;
}

async function seedBase(): Promise<void> {
  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp)
    VALUES (${TENANT_ID}, 'Pemberton & Cole (test)', 'pemberton-cole-test', 'mixed')
  `;
  await sql`
    INSERT INTO "user" (id, email, primary_idp, external_id, display_name)
    VALUES (${USER_ID}, 'anna.pemberton+test@example.com', 'microsoft', 'ms:pemberton-test', 'Anna Pemberton')
  `;
  await privilegedSql`
    INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
    VALUES (gen_random_uuid(), ${TENANT_ID}, ${USER_ID}, 'admin', true)
  `;
  await privilegedSql`
    INSERT INTO subject_tenant (id, tenant_id, name, kind)
    VALUES (${SUBJECT_ID}, ${TENANT_ID}, 'Vantage Industries Pty Ltd', 'claimant')
  `;
  await privilegedSql`
    INSERT INTO project (id, tenant_id, subject_tenant_id, name, description, started_at)
    VALUES (${PROJECT_ID}, ${TENANT_ID}, ${SUBJECT_ID},
      'Hi-temp alloy R&D — FY26',
      'Phase-stability program for B-substituted gamma-prime alloys above 800 °C.',
      '2025-07-01T00:00:00Z'::timestamptz)
  `;
  await privilegedSql`
    INSERT INTO claim (id, tenant_id, subject_tenant_id, project_id, fiscal_year, stage)
    VALUES (${CLAIM_ID}, ${TENANT_ID}, ${SUBJECT_ID}, ${PROJECT_ID}, ${FISCAL_YEAR}, 'engagement')
  `;
  await privilegedSql`
    INSERT INTO activity (
      id, tenant_id, project_id, claim_id, kind, code, title,
      fy_label, hypothesis_formed_at,
      hypothesis, technical_uncertainty, expected_outcome
    )
    VALUES
      (${ACTIVITY_CORE}, ${TENANT_ID}, ${PROJECT_ID}, ${CLAIM_ID}, 'core', 'CA-001',
       'Vantage-7 phase-stability program', ${FY}, '2026-04-01T00:00:00Z'::timestamptz,
       'B+8% composition holds γ′ phase stability at 830 °C / 200 K/s / 60 s',
       'No prior art for B-substituted γ′ above 800 °C; quench-rate sensitivity unknown',
       'Confirm γ′ stability for the 60 s window; advance to casting trial branch'),
      (${ACTIVITY_SUPP}, ${TENANT_ID}, ${PROJECT_ID}, ${CLAIM_ID}, 'supporting', 'SA-001',
       'Heat-flow and metrology support', ${FY}, '2026-04-01T00:00:00Z'::timestamptz,
       'External lab + compute + metrology support the core activity',
       'n/a (supporting)',
       'n/a (supporting)')
  `;
}

// ─── Helpers ────────────────────────────────────────────────────────

async function loadFixture<T = unknown>(name: string): Promise<T> {
  const buf = await readFile(path.join(FIXTURES, name), 'utf8');
  if (name.endsWith('.json')) return JSON.parse(buf) as T;
  return buf as unknown as T;
}

function queueEvent(spec: PendingEvent): void {
  PENDING.push(spec);
}

function fakeContentHash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

// ─── Cases (collect-only — every case queues PendingEvents/expenditures) ──

async function case01_hypothesisText(): Promise<void> {
  const text = await loadFixture<string>('01-hypothesis.txt');
  queueEvent({
    case_n: 1,
    case_label: 'HYPOTHESIS · paste text',
    kind: 'HYPOTHESIS',
    payload: { raw_text: text, source: 'consultant-paste', activity_id: ACTIVITY_CORE },
    captured_at: new Date('2026-04-12T08:30:00Z'),
    classification: {
      kind: 'HYPOTHESIS',
      confidence: 0.96,
      rationale: 'Explicit pre-experiment hypothesis statement.',
      statutory_anchor: 's.355-25(1)(a)',
      model: 'haiku-4.5',
      prompt_version: 'classify@1.4.0',
      tokens_in: 412,
      tokens_out: 38,
    },
  });
}

async function case02_observationText(): Promise<void> {
  const text = await loadFixture<string>('02-observation.txt');
  queueEvent({
    case_n: 2,
    case_label: 'OBSERVATION · paste text',
    kind: 'OBSERVATION',
    payload: { raw_text: text, source: 'consultant-paste', activity_id: ACTIVITY_CORE },
    captured_at: new Date('2026-05-19T15:14:02Z'),
    classification: {
      kind: 'OBSERVATION',
      confidence: 0.92,
      rationale: 'Post-cycle quench observation, lab notebook entry.',
      statutory_anchor: 's.355-25(1)(c)',
      model: 'haiku-4.5',
      prompt_version: 'classify@1.4.0',
      tokens_in: 467,
      tokens_out: 41,
    },
  });
}

async function case03_timeLog(): Promise<void> {
  const text = await loadFixture<string>('03-time-log.txt');
  queueEvent({
    case_n: 3,
    case_label: 'TIME_LOG · paste text',
    kind: 'TIME_LOG',
    payload: {
      raw_text: text,
      source: 'consultant-paste',
      hours: 32.5,
      activity_id: ACTIVITY_CORE,
      week_ending: '2026-05-22',
    },
    captured_at: new Date('2026-05-22T17:00:00Z'),
    classification: {
      kind: 'TIME_LOG',
      confidence: 0.99,
      rationale: 'Per-day breakdown with hours per session; one project.',
      statutory_anchor: 's.355-25(2)(b)',
      model: 'haiku-4.5',
      prompt_version: 'classify@1.4.0',
      tokens_in: 384,
      tokens_out: 32,
    },
  });
}

interface UploadFixture {
  filename: string;
  mime: string;
  size_bytes: number;
  sha256_hex: string;
  extracted_content: Record<string, unknown>;
  captured_at: string;
}

async function queueUpload(
  fixtureName: string,
  caseN: number,
  label: string,
): Promise<{ filename: string; sizeKB: number }> {
  const fx = await loadFixture<UploadFixture>(fixtureName);
  queueEvent({
    case_n: caseN,
    case_label: label,
    kind: 'EVIDENCE_UPLOADED',
    payload: {
      filename: fx.filename,
      mime: fx.mime,
      size_bytes: fx.size_bytes,
      sha256_hex: fx.sha256_hex,
      source: 'consultant-upload',
      activity_id: ACTIVITY_CORE,
    },
    captured_at: new Date(fx.captured_at),
    classification: null,
    extracted_content: fx.extracted_content,
  });
  return { filename: fx.filename, sizeKB: fx.size_bytes / 1024 };
}

async function case04_whiteboardImage(): Promise<{ filename: string; sizeKB: number }> {
  return queueUpload('04-whiteboard-photo.json', 4, 'EVIDENCE_UPLOADED · image (whiteboard)');
}
async function case05_labNotebookPdf(): Promise<{ filename: string; sizeKB: number }> {
  return queueUpload('05-lab-notebook.json', 5, 'EVIDENCE_UPLOADED · PDF (lab notebook)');
}
async function case06_narrativeDocx(): Promise<{ filename: string; sizeKB: number }> {
  return queueUpload('06-narrative-draft.json', 6, 'EVIDENCE_UPLOADED · DOCX (narrative draft)');
}
async function case07_calculationsXlsx(): Promise<{ filename: string; sizeKB: number }> {
  return queueUpload('07-calculations.json', 7, 'EVIDENCE_UPLOADED · XLSX (calculations)');
}
async function case09_voiceTranscript(): Promise<{ filename: string; sizeKB: number }> {
  return queueUpload('09-voice-transcript.json', 9, 'EVIDENCE_UPLOADED · voice transcript');
}

interface XeroFixture {
  source: 'xero_invoice' | 'xero_bank_tx' | 'xero_receipt' | 'manual';
  source_external_id: string;
  vendor_name: string;
  reference: string;
  expenditure_date: string;
  total_amount: string;
  currency: string;
  raw_payload: Record<string, unknown>;
  map_to_activity_kind: 'core' | 'supporting';
  map_rationale: string;
}

async function case08_xeroInvoiceMapped(): Promise<void> {
  const fx = await loadFixture<XeroFixture>('08-xero-invoice.json');
  PENDING_EXPENDITURES.push({
    case_n: 8,
    id: EXP_08_BLUESCOPE,
    source: fx.source,
    source_external_id: fx.source_external_id,
    vendor_name: fx.vendor_name,
    reference: fx.reference,
    expenditure_date: fx.expenditure_date,
    total_amount: fx.total_amount,
    currency: fx.currency,
    raw_payload: fx.raw_payload,
  });
  const targetActivity = fx.map_to_activity_kind === 'core' ? ACTIVITY_CORE : ACTIVITY_SUPP;
  const targetCode = fx.map_to_activity_kind === 'core' ? 'CA-001' : 'SA-001';
  const targetTitle =
    fx.map_to_activity_kind === 'core'
      ? 'Vantage-7 phase-stability program'
      : 'Heat-flow and metrology support';

  queueEvent({
    case_n: 8,
    case_label: 'EXPENDITURE · Xero invoice + mapped to SA-001',
    kind: 'EXPENDITURE_INGESTED',
    payload: {
      expenditure_id: EXP_08_BLUESCOPE,
      source: fx.source,
      vendor_name: fx.vendor_name,
      total_amount: fx.total_amount,
      currency: fx.currency,
    },
    captured_at: new Date(`${fx.expenditure_date}T22:00:00Z`),
    classification: null,
  });
  queueEvent({
    case_n: 8,
    case_label: 'EXPENDITURE · Xero invoice + mapped to SA-001',
    kind: 'EXPENDITURE_MAPPED',
    payload: {
      expenditure_id: EXP_08_BLUESCOPE,
      activity_id: targetActivity,
      activity_code: targetCode,
      activity_title: targetTitle,
      rationale: fx.map_rationale,
    },
    captured_at: new Date(`${fx.expenditure_date}T22:05:00Z`),
    classification: null,
  });
}

interface MultiActivityFixture {
  expenditures: Array<{
    source: 'xero_invoice' | 'xero_bank_tx' | 'xero_receipt' | 'manual';
    vendor: string;
    reference: string;
    expenditure_date: string;
    total_amount: string;
    currency: string;
    map_to?: 'core' | 'supporting';
    apportion?: Array<{ kind: 'core' | 'supporting'; percentage: number }>;
  }>;
  activity_register_proposal: {
    summary: string;
    proposed_activities: Array<{
      kind: 'core' | 'supporting';
      title: string;
      rationale: string;
      confidence: number;
    }>;
    unclustered_event_ids: string[];
  };
  narrative_draft: {
    summary: string;
    sections: Array<{
      section_kind: string;
      version: number;
      segments_summary: string;
    }>;
  };
}

async function case10_multiActivityClaim(): Promise<{
  expCount: number;
  narrativeSectionCount: number;
}> {
  const fx = await loadFixture<MultiActivityFixture>('10-multi-activity-claim.json');
  const expIds = [EXP_10_CSIRO, EXP_10_AWS, EXP_10_AGILENT];

  for (let i = 0; i < fx.expenditures.length; i++) {
    const e = fx.expenditures[i]!;
    const expId = expIds[i]!;
    PENDING_EXPENDITURES.push({
      case_n: 10,
      id: expId,
      source: e.source,
      source_external_id: null,
      vendor_name: e.vendor,
      reference: e.reference,
      expenditure_date: e.expenditure_date,
      total_amount: e.total_amount,
      currency: e.currency,
      raw_payload: null,
    });
    queueEvent({
      case_n: 10,
      case_label: 'MULTI-ACTIVITY · 3 expenditures + register + narrative',
      kind: 'EXPENDITURE_INGESTED',
      payload: {
        expenditure_id: expId,
        source: e.source,
        vendor_name: e.vendor,
        total_amount: e.total_amount,
        currency: e.currency,
      },
      captured_at: new Date(`${e.expenditure_date}T22:00:00Z`),
      classification: null,
    });
    if (e.map_to) {
      const activityId = e.map_to === 'core' ? ACTIVITY_CORE : ACTIVITY_SUPP;
      const code = e.map_to === 'core' ? 'CA-001' : 'SA-001';
      const title =
        e.map_to === 'core'
          ? 'Vantage-7 phase-stability program'
          : 'Heat-flow and metrology support';
      queueEvent({
        case_n: 10,
        case_label: 'MULTI-ACTIVITY · 3 expenditures + register + narrative',
        kind: 'EXPENDITURE_MAPPED',
        payload: {
          expenditure_id: expId,
          activity_id: activityId,
          activity_code: code,
          activity_title: title,
        },
        captured_at: new Date(`${e.expenditure_date}T22:05:00Z`),
        classification: null,
      });
    } else if (e.apportion) {
      const allocations = e.apportion.map((a) => ({
        activity_id: a.kind === 'core' ? ACTIVITY_CORE : ACTIVITY_SUPP,
        activity_code: a.kind === 'core' ? 'CA-001' : 'SA-001',
        activity_title:
          a.kind === 'core'
            ? 'Vantage-7 phase-stability program'
            : 'Heat-flow and metrology support',
        percentage: a.percentage,
      }));
      queueEvent({
        case_n: 10,
        case_label: 'MULTI-ACTIVITY · 3 expenditures + register + narrative',
        kind: 'EXPENDITURE_APPORTIONED',
        payload: {
          expenditure_id: expId,
          allocations,
          mapped_by_user_id: USER_ID,
        },
        captured_at: new Date(`${e.expenditure_date}T22:10:00Z`),
        classification: null,
      });
    }
  }

  queueEvent({
    case_n: 10,
    case_label: 'MULTI-ACTIVITY · 3 expenditures + register + narrative',
    kind: 'ACTIVITY_REGISTER_DRAFTED',
    payload: {
      claim_id: CLAIM_ID,
      proposed_activities: fx.activity_register_proposal.proposed_activities.map((a) => ({
        kind: a.kind,
        title: a.title,
        confidence: a.confidence,
      })),
      unclustered_event_ids: fx.activity_register_proposal.unclustered_event_ids,
      summary: fx.activity_register_proposal.summary,
    },
    captured_at: new Date('2026-05-30T22:30:00Z'),
    classification: null,
  });

  for (let i = 0; i < fx.narrative_draft.sections.length; i++) {
    const sec = fx.narrative_draft.sections[i]!;
    const fakeDraftId = `00000000-0000-4000-8000-${(i + 0xc0a1d000).toString(16).padStart(12, '0')}`;
    const contentHash = fakeContentHash(
      `${sec.section_kind}|${sec.version}|${sec.segments_summary}`,
    );
    queueEvent({
      case_n: 10,
      case_label: 'MULTI-ACTIVITY · 3 expenditures + register + narrative',
      kind: 'NARRATIVE_DRAFTED',
      payload: {
        activity_id: ACTIVITY_CORE,
        narrative_draft_id: fakeDraftId,
        section_kind: sec.section_kind,
        version: sec.version,
        content_hash: contentHash,
        segments_summary: sec.segments_summary,
      },
      // Stagger each section by one minute so the global sort keeps them
      // in section order even though they share a base instant.
      captured_at: new Date(2026, 4, 30, 22, 45 + i, 0),
      classification: null,
    });
  }

  return {
    expCount: fx.expenditures.length,
    narrativeSectionCount: fx.narrative_draft.sections.length,
  };
}

// ─── Flush stage — insert expenditures first, then sorted chain events ──

async function flushExpenditures(): Promise<void> {
  for (const e of PENDING_EXPENDITURES) {
    if (e.raw_payload) {
      await privilegedSql`
        INSERT INTO expenditure (
          id, tenant_id, subject_tenant_id, claim_id,
          source, source_external_id, vendor_name, reference,
          expenditure_date, total_amount, currency, raw_payload
        )
        VALUES (
          ${e.id}, ${TENANT_ID}, ${SUBJECT_ID}, ${CLAIM_ID},
          ${e.source}, ${e.source_external_id}, ${e.vendor_name}, ${e.reference},
          ${e.expenditure_date}::date, ${e.total_amount}::numeric, ${e.currency},
          ${JSON.stringify(e.raw_payload)}::text::jsonb
        )
      `;
    } else {
      await privilegedSql`
        INSERT INTO expenditure (
          id, tenant_id, subject_tenant_id, claim_id,
          source, vendor_name, reference,
          expenditure_date, total_amount, currency
        )
        VALUES (
          ${e.id}, ${TENANT_ID}, ${SUBJECT_ID}, ${CLAIM_ID},
          ${e.source}, ${e.vendor_name}, ${e.reference},
          ${e.expenditure_date}::date, ${e.total_amount}::numeric, ${e.currency}
        )
      `;
    }
  }
}

async function flushChainEvents(): Promise<void> {
  PENDING.sort((a, b) => a.captured_at.getTime() - b.captured_at.getTime());

  for (const ev of PENDING) {
    const inserted = await insertEventWithChain({
      tenant_id: TENANT_ID,
      subject_tenant_id: SUBJECT_ID,
      project_id: PROJECT_ID,
      kind: ev.kind,
      payload: ev.payload,
      classification: ev.classification,
      captured_at: ev.captured_at,
      captured_by_user_id: USER_ID,
      captured_by_employee_id: null,
      override_of_event_id: null,
      override_new_kind: null,
      override_reason: null,
    });
    if (ev.extracted_content) {
      await privilegedSql`
        UPDATE event
           SET extracted_content = ${JSON.stringify(ev.extracted_content)}::text::jsonb,
               extraction_status = 'complete'
         WHERE id = ${inserted.id}
      `;
    }
  }
}

function buildSummaries(): void {
  const byCase = new Map<number, CaseSummary>();
  for (const ev of PENDING) {
    let s = byCase.get(ev.case_n);
    if (!s) {
      s = { n: ev.case_n, label: ev.case_label, event_kinds: [], expenditure_ids: [] };
      byCase.set(ev.case_n, s);
    }
    s.event_kinds.push(ev.kind);
  }
  for (const e of PENDING_EXPENDITURES) {
    const s = byCase.get(e.case_n);
    if (s) s.expenditure_ids.push(e.id);
  }
  for (const s of [...byCase.values()].sort((a, b) => a.n - b.n)) {
    SUMMARIES.push(s);
  }
}

// ─── main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write('Cleaning prior c0a1* fixtures…\n');
  await cleanup();
  process.stdout.write('Seeding base tenant / user / project / claim / activities…\n');
  await seedBase();

  process.stdout.write('Collecting ten test cases:\n');
  await case01_hypothesisText();
  await case02_observationText();
  await case03_timeLog();
  const f04 = await case04_whiteboardImage();
  const f05 = await case05_labNotebookPdf();
  const f06 = await case06_narrativeDocx();
  const f07 = await case07_calculationsXlsx();
  await case08_xeroInvoiceMapped();
  const f09 = await case09_voiceTranscript();
  const f10 = await case10_multiActivityClaim();

  process.stdout.write(`Inserting ${PENDING_EXPENDITURES.length} expenditures…\n`);
  await flushExpenditures();
  process.stdout.write(`Inserting ${PENDING.length} chain events (sorted by captured_at)…\n`);
  await flushChainEvents();

  buildSummaries();

  // Verify chain integrity end-to-end.
  const verify = await verifyChain(SUBJECT_ID);
  if (!verify.verified) {
    throw new Error(
      `Chain verify failed at index ${verify.first_break_at} (event_count=${verify.event_count}). ` +
        `Head hash: ${verify.head_hash ?? 'null'}`,
    );
  }

  process.stdout.write('\nSummary:\n');
  process.stdout.write('─'.repeat(78) + '\n');
  for (const r of SUMMARIES) {
    const kinds = r.event_kinds.join(' · ');
    process.stdout.write(
      `  ${String(r.n).padStart(2, '0')}. ${r.label}\n` +
        `      ${r.event_kinds.length} event(s): ${kinds}\n` +
        (r.expenditure_ids.length > 0 ? `      ${r.expenditure_ids.length} expenditure(s)\n` : ''),
    );
  }
  // Per-case file/size annotations.
  const notes: Array<[number, string]> = [
    [4, `${f04.filename} · ${f04.sizeKB.toFixed(1)} KB`],
    [5, `${f05.filename} · ${f05.sizeKB.toFixed(1)} KB`],
    [6, `${f06.filename} · ${f06.sizeKB.toFixed(1)} KB`],
    [7, `${f07.filename} · ${f07.sizeKB.toFixed(1)} KB`],
    [9, `${f09.filename} · ${f09.sizeKB.toFixed(1)} KB`],
    [10, `${f10.expCount} expenditures · ${f10.narrativeSectionCount} narrative sections`],
  ];
  for (const [n, note] of notes) {
    process.stdout.write(`      (case ${String(n).padStart(2, '0')}) ${note}\n`);
  }
  process.stdout.write('─'.repeat(78) + '\n');

  process.stdout.write('\nChain integrity: ');
  process.stdout.write(
    `verified=${verify.verified} · ${verify.event_count} events · head=${verify.head_hash?.slice(0, 16)}…\n`,
  );

  process.stdout.write('\nIDs for the consultant portal:\n');
  process.stdout.write(`  tenant_id   ${TENANT_ID}\n`);
  process.stdout.write(`  user_id     ${USER_ID}\n`);
  process.stdout.write(`  claim_id    ${CLAIM_ID}\n`);
  process.stdout.write(`  core act    ${ACTIVITY_CORE}\n`);
  process.stdout.write(`  supp act    ${ACTIVITY_SUPP}\n`);
  process.stdout.write('\nVisit /claims/' + CLAIM_ID + ' once a session cookie is minted.\n');
}

main()
  .then(async () => {
    await sql.end();
    await privilegedSql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    process.stderr.write(
      `\nFAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    try {
      await sql.end();
      await privilegedSql.end();
    } catch {
      // best-effort
    }
    process.exit(2);
  });
