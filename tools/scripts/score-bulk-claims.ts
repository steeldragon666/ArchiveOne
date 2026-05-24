#!/usr/bin/env tsx
/**
 * Score the platform's accuracy against the bulk-claims seed ground truth.
 *
 *   pnpm exec tsx --env-file=../../.env score-bulk-claims.ts
 *
 * The seed (seed-bulk-claims.ts) embeds a hidden ground-truth tag on
 * every EXPENDITURE_INGESTED event payload:
 *
 *   payload.rd_band_hint ∈ { 'rd_critical' | 'rd_supporting' | 'non_rd' }
 *
 * and on every note's payload:
 *
 *   payload.rd_band_hint ∈ { 'rd_relevant' | 'non_rd' } (when contaminated)
 *
 * After the platform's mapping engine + Agent A classifier have had a
 * pass at the data, this script reads what they produced and grades it
 * against the hint columns:
 *
 *   Expenditures
 *     - R&D-coverage recall   : of $ that SHOULD be in the claim, how
 *       much got mapped to an activity?
 *     - Mapping precision     : of $ that GOT mapped, how much should
 *       have been (no non-R&D leaks)?
 *     - Contamination leak    : of $ that should NOT be in the claim,
 *       how much got mapped anyway? (0 % is the target.)
 *
 *   Notes
 *     - R&D-classification    : of notes that should be R&D, how many
 *       carry a classification with an eligible kind?
 *     - Contamination caught  : of contaminated (non-R&D) notes, how
 *       many were classified INELIGIBLE?
 *
 * If neither the mapping engine nor Agent A has run yet, the script
 * still works — it reports the un-processed baseline so you can verify
 * the seed loaded correctly before running the agents.
 *
 * Exit code 0 always — this is a reporting tool, not a CI gate. (A
 * future CI step can grep the output and gate on the printed metric.)
 */
import { privilegedSql, sql } from '@cpa/db/client';
import { DOMAINS } from './_bulk-claim-domains.js';

// Mirror the namespace prefix used by seed-bulk-claims.ts.
const TENANT_PREFIX = '00000000-0000-4000-8000-c0a2';

interface ExpenditureRow {
  id: string;
  tenant_id: string;
  total_amount: string;
  ingest_band: 'rd_critical' | 'rd_supporting' | 'non_rd' | null;
  mapping_state: 'mapped' | 'apportioned' | 'unmapped' | 'voided';
  /** Agent A's verdict on the EXPENDITURE_INGESTED event: 'INELIGIBLE'
   *  means "ordinary business", anything else means R&D-related, null
   *  means the classifier hasn't run yet. */
  classification_kind: string | null;
}

interface NoteRow {
  id: string;
  tenant_id: string;
  declared_kind: string;
  rd_band_hint: 'rd_relevant' | 'non_rd' | null;
  classification_kind: string | null;
}

/**
 * Per-claim expenditure totals + outcomes by ground-truth band.
 */
interface ExpBucket {
  n: number;
  amount_aud: number;
}
interface ClaimExpStats {
  by_band: { rd_critical: ExpBucket; rd_supporting: ExpBucket; non_rd: ExpBucket };
  mapped: { n: number; amount_aud: number };
  apportioned: { n: number; amount_aud: number };
  unmapped: { n: number; amount_aud: number };
  /** Of the R&D-band rows, how many landed in mapped/apportioned. */
  rd_recall_n: number;
  rd_recall_total: number;
  rd_recall_amount_caught: number;
  rd_recall_amount_total: number;
  /** Of the mapped/apportioned rows, how many were actually R&D. */
  precision_correct_n: number;
  precision_correct_amount: number;
  precision_mapped_n: number;
  precision_mapped_amount: number;
  /** Of the non-R&D rows, how many got incorrectly mapped (contamination leak). */
  leak_n: number;
  leak_amount: number;
  leak_total_n: number;
  leak_total_amount: number;
  /** Classification-based metrics — populated after eval-bulk-classify-
   *  expenditures.ts has written classification.kind onto each
   *  EXPENDITURE_INGESTED event. The Agent A INELIGIBLE verdict
   *  substitutes for a full mapping pipeline (which would otherwise
   *  require Agent B + a rule generator). */
  classified_n: number;
  classified_n_ineligible: number;
  classified_n_eligible: number;
  /** Of R&D-band rows ($-weighted): how many did Agent A correctly
   *  predict as R&D-eligible (i.e. NOT INELIGIBLE)? */
  cls_recall_rd_correct_n: number;
  cls_recall_rd_correct_amount: number;
  cls_recall_rd_total_n: number;
  cls_recall_rd_total_amount: number;
  /** Of non-R&D-band rows: how many did Agent A correctly flag INELIGIBLE? */
  cls_contam_caught_n: number;
  cls_contam_caught_amount: number;
  cls_contam_leaked_n: number;
  cls_contam_leaked_amount: number;
}

interface ClaimNoteStats {
  total: number;
  rd_relevant: number;
  non_rd_contam: number;
  unhinted: number;
  classified: number;
  classified_eligible_kind: number;
  classified_ineligible: number;
  /** Hint == 'non_rd' AND classification kind == 'INELIGIBLE'. */
  contamination_caught: number;
  /** Hint == 'non_rd' AND classification kind != null AND != 'INELIGIBLE'. */
  contamination_leaked: number;
  /** Hint == 'rd_relevant' AND classification kind == 'INELIGIBLE'. */
  rd_misclassified_as_ineligible: number;
}

interface ClaimReport {
  idx: number;
  tenant_id: string;
  firm: string;
  claimant: string;
  exp: ClaimExpStats;
  notes: ClaimNoteStats;
}

function pct(num: number, denom: number): string {
  if (denom === 0) return ' n/a ';
  return ((num / denom) * 100).toFixed(1).padStart(5) + '%';
}

function aud(n: number): string {
  return '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function loadExpenditures(tenantId: string): Promise<ExpenditureRow[]> {
  return await privilegedSql<ExpenditureRow[]>`
    WITH ingest AS (
      SELECT
        (payload->>'expenditure_id')::uuid AS exp_id,
        payload->>'rd_band_hint'           AS band,
        classification->>'kind'            AS classification_kind
      FROM event
      WHERE tenant_id = ${tenantId}
        AND kind = 'EXPENDITURE_INGESTED'
    ),
    mapped AS (
      SELECT DISTINCT (payload->>'expenditure_id')::uuid AS exp_id
      FROM event
      WHERE tenant_id = ${tenantId}
        AND kind = 'EXPENDITURE_MAPPED'
    ),
    apportioned AS (
      SELECT DISTINCT (payload->>'expenditure_id')::uuid AS exp_id
      FROM event
      WHERE tenant_id = ${tenantId}
        AND kind = 'EXPENDITURE_APPORTIONED'
    ),
    unmapped_by_event AS (
      SELECT DISTINCT ON ((payload->>'expenditure_id')::uuid)
        (payload->>'expenditure_id')::uuid AS exp_id,
        kind
      FROM event
      WHERE tenant_id = ${tenantId}
        AND kind IN ('EXPENDITURE_MAPPED','EXPENDITURE_APPORTIONED','EXPENDITURE_UNMAPPED')
      ORDER BY (payload->>'expenditure_id')::uuid, captured_at DESC, id DESC
    )
    SELECT
      exp.id::text AS id,
      exp.tenant_id::text AS tenant_id,
      exp.total_amount::text AS total_amount,
      i.band AS ingest_band,
      i.classification_kind AS classification_kind,
      CASE
        WHEN exp.voided_at IS NOT NULL THEN 'voided'
        WHEN ubE.kind = 'EXPENDITURE_APPORTIONED' THEN 'apportioned'
        WHEN ubE.kind = 'EXPENDITURE_MAPPED' THEN 'mapped'
        ELSE 'unmapped'
      END AS mapping_state
    FROM expenditure exp
    LEFT JOIN ingest i        ON i.exp_id = exp.id
    LEFT JOIN unmapped_by_event ubE ON ubE.exp_id = exp.id
    WHERE exp.tenant_id = ${tenantId}
    ORDER BY exp.id
  `;
}

async function loadNotes(tenantId: string): Promise<NoteRow[]> {
  // Text events are everything that isn't a file upload, expenditure
  // event, agent state-transition, or sync connector — i.e. the
  // classifier-eligible kinds.
  const eligibleKinds = [
    'HYPOTHESIS',
    'OBSERVATION',
    'EXPERIMENT',
    'ITERATION',
    'NEW_KNOWLEDGE',
    'UNCERTAINTY',
    'TIME_LOG',
    'ASSOCIATE_FLAG',
    'EXPENDITURE_NOTE',
    'SUPPORTING',
    'INELIGIBLE',
    'DESIGN',
  ];
  return await privilegedSql<NoteRow[]>`
    SELECT
      id::text          AS id,
      tenant_id::text   AS tenant_id,
      kind              AS declared_kind,
      payload->>'rd_band_hint' AS rd_band_hint,
      classification->>'kind'  AS classification_kind
    FROM event
    WHERE tenant_id = ${tenantId}
      AND kind = ANY(${eligibleKinds})
  `;
}

function tallyExpenditures(rows: ExpenditureRow[]): ClaimExpStats {
  const stats: ClaimExpStats = {
    by_band: {
      rd_critical: { n: 0, amount_aud: 0 },
      rd_supporting: { n: 0, amount_aud: 0 },
      non_rd: { n: 0, amount_aud: 0 },
    },
    mapped: { n: 0, amount_aud: 0 },
    apportioned: { n: 0, amount_aud: 0 },
    unmapped: { n: 0, amount_aud: 0 },
    rd_recall_n: 0,
    rd_recall_total: 0,
    rd_recall_amount_caught: 0,
    rd_recall_amount_total: 0,
    precision_correct_n: 0,
    precision_correct_amount: 0,
    precision_mapped_n: 0,
    precision_mapped_amount: 0,
    leak_n: 0,
    leak_amount: 0,
    leak_total_n: 0,
    leak_total_amount: 0,
    classified_n: 0,
    classified_n_ineligible: 0,
    classified_n_eligible: 0,
    cls_recall_rd_correct_n: 0,
    cls_recall_rd_correct_amount: 0,
    cls_recall_rd_total_n: 0,
    cls_recall_rd_total_amount: 0,
    cls_contam_caught_n: 0,
    cls_contam_caught_amount: 0,
    cls_contam_leaked_n: 0,
    cls_contam_leaked_amount: 0,
  };

  for (const r of rows) {
    const amount = Number(r.total_amount);
    const band = r.ingest_band;
    const isMapped = r.mapping_state === 'mapped' || r.mapping_state === 'apportioned';

    if (band === 'rd_critical' || band === 'rd_supporting' || band === 'non_rd') {
      stats.by_band[band].n += 1;
      stats.by_band[band].amount_aud += amount;
    }
    if (r.mapping_state === 'mapped') {
      stats.mapped.n += 1;
      stats.mapped.amount_aud += amount;
    } else if (r.mapping_state === 'apportioned') {
      stats.apportioned.n += 1;
      stats.apportioned.amount_aud += amount;
    } else if (r.mapping_state === 'unmapped') {
      stats.unmapped.n += 1;
      stats.unmapped.amount_aud += amount;
    }

    // R&D recall — ground truth = R&D, scoring = was it mapped?
    if (band === 'rd_critical' || band === 'rd_supporting') {
      stats.rd_recall_total += 1;
      stats.rd_recall_amount_total += amount;
      if (isMapped) {
        stats.rd_recall_n += 1;
        stats.rd_recall_amount_caught += amount;
      }
    }

    // Precision — ground truth scored only over mapped rows.
    if (isMapped) {
      stats.precision_mapped_n += 1;
      stats.precision_mapped_amount += amount;
      if (band === 'rd_critical' || band === 'rd_supporting') {
        stats.precision_correct_n += 1;
        stats.precision_correct_amount += amount;
      }
    }

    // Contamination leak — ground truth = non-R&D, scoring = was it
    // wrongly mapped?
    if (band === 'non_rd') {
      stats.leak_total_n += 1;
      stats.leak_total_amount += amount;
      if (isMapped) {
        stats.leak_n += 1;
        stats.leak_amount += amount;
      }
    }

    // Classification-based scoring (Agent A run on the synthesised
    // expenditure text). Independent of the mapping engine — gives a
    // signal even when no EXPENDITURE_MAPPED events exist.
    if (r.classification_kind !== null) {
      stats.classified_n += 1;
      const classifiedRD = r.classification_kind !== 'INELIGIBLE';
      if (classifiedRD) stats.classified_n_eligible += 1;
      else stats.classified_n_ineligible += 1;

      if (band === 'rd_critical' || band === 'rd_supporting') {
        stats.cls_recall_rd_total_n += 1;
        stats.cls_recall_rd_total_amount += amount;
        if (classifiedRD) {
          stats.cls_recall_rd_correct_n += 1;
          stats.cls_recall_rd_correct_amount += amount;
        }
      }
      if (band === 'non_rd') {
        if (!classifiedRD) {
          stats.cls_contam_caught_n += 1;
          stats.cls_contam_caught_amount += amount;
        } else {
          stats.cls_contam_leaked_n += 1;
          stats.cls_contam_leaked_amount += amount;
        }
      }
    }
  }
  return stats;
}

function tallyNotes(rows: NoteRow[]): ClaimNoteStats {
  const stats: ClaimNoteStats = {
    total: rows.length,
    rd_relevant: 0,
    non_rd_contam: 0,
    unhinted: 0,
    classified: 0,
    classified_eligible_kind: 0,
    classified_ineligible: 0,
    contamination_caught: 0,
    contamination_leaked: 0,
    rd_misclassified_as_ineligible: 0,
  };
  for (const r of rows) {
    if (r.rd_band_hint === 'non_rd') stats.non_rd_contam += 1;
    else if (r.rd_band_hint === 'rd_relevant') stats.rd_relevant += 1;
    else stats.unhinted += 1;

    if (r.classification_kind !== null) {
      stats.classified += 1;
      if (r.classification_kind === 'INELIGIBLE') stats.classified_ineligible += 1;
      else stats.classified_eligible_kind += 1;

      if (r.rd_band_hint === 'non_rd') {
        if (r.classification_kind === 'INELIGIBLE') stats.contamination_caught += 1;
        else stats.contamination_leaked += 1;
      }
      if (r.rd_band_hint === 'rd_relevant' && r.classification_kind === 'INELIGIBLE') {
        stats.rd_misclassified_as_ineligible += 1;
      }
    }
  }
  return stats;
}

function tenantIdFor(idx: number): string {
  return `${TENANT_PREFIX}${(idx + 1).toString().padStart(2, '0')}010000`;
}

function renderClaim(r: ClaimReport): void {
  const e = r.exp;
  const n = r.notes;
  const total = e.by_band.rd_critical.n + e.by_band.rd_supporting.n + e.by_band.non_rd.n;
  const totalAmt =
    e.by_band.rd_critical.amount_aud +
    e.by_band.rd_supporting.amount_aud +
    e.by_band.non_rd.amount_aud;
  const mappedAny = e.mapped.n + e.apportioned.n;

  process.stdout.write(
    `\n[${String(r.idx + 1).padStart(2, '0')}] ${r.firm.padEnd(30)} → ${r.claimant}\n`,
  );
  process.stdout.write(`     tenant ${r.tenant_id}\n`);
  process.stdout.write(
    `     EXP  n=${total}  total=${aud(totalAmt)}` +
      `   critical=${e.by_band.rd_critical.n}/${aud(e.by_band.rd_critical.amount_aud)}` +
      `   supporting=${e.by_band.rd_supporting.n}/${aud(e.by_band.rd_supporting.amount_aud)}` +
      `   non-R&D=${e.by_band.non_rd.n}/${aud(e.by_band.non_rd.amount_aud)}\n`,
  );
  process.stdout.write(
    `          mapped=${e.mapped.n}/${aud(e.mapped.amount_aud)}` +
      `   apportioned=${e.apportioned.n}/${aud(e.apportioned.amount_aud)}` +
      `   unmapped=${e.unmapped.n}/${aud(e.unmapped.amount_aud)}\n`,
  );
  // Classification-based metrics — independent of mapping engine.
  if (e.classified_n > 0) {
    process.stdout.write(
      `          Agent A on expenditures: classified=${e.classified_n}   eligible=${e.classified_n_eligible}   INELIGIBLE=${e.classified_n_ineligible}\n`,
    );
    process.stdout.write(
      `          cls recall (R&D $ kept)      ${pct(
        e.cls_recall_rd_correct_amount,
        e.cls_recall_rd_total_amount,
      )}   ($${e.cls_recall_rd_correct_amount.toFixed(0)} of $${e.cls_recall_rd_total_amount.toFixed(0)})\n`,
    );
    process.stdout.write(
      `          cls contamination caught     ${pct(
        e.cls_contam_caught_amount,
        e.cls_contam_caught_amount + e.cls_contam_leaked_amount,
      )}   ($${e.cls_contam_caught_amount.toFixed(0)} of $${(e.cls_contam_caught_amount + e.cls_contam_leaked_amount).toFixed(0)} non-R&D)\n`,
    );
  }
  if (mappedAny === 0) {
    process.stdout.write(
      `          [no mapping events yet — recall/precision/leak undefined; run the mapping engine then re-score]\n`,
    );
  } else {
    process.stdout.write(
      `          recall (R&D $ caught)        ${pct(
        e.rd_recall_amount_caught,
        e.rd_recall_amount_total,
      )}   ($${e.rd_recall_amount_caught.toFixed(0)} of $${e.rd_recall_amount_total.toFixed(0)})\n`,
    );
    process.stdout.write(
      `          precision (mapped $ correct) ${pct(
        e.precision_correct_amount,
        e.precision_mapped_amount,
      )}   ($${e.precision_correct_amount.toFixed(
        0,
      )} of $${e.precision_mapped_amount.toFixed(0)})\n`,
    );
    process.stdout.write(
      `          contamination leak           ${pct(
        e.leak_amount,
        e.leak_total_amount,
      )}   ($${e.leak_amount.toFixed(0)} of $${e.leak_total_amount.toFixed(0)} non-R&D)\n`,
    );
  }

  process.stdout.write(
    `     NOTE n=${n.total}   rd_relevant=${n.rd_relevant}   contamination=${n.non_rd_contam}   unhinted=${n.unhinted}\n`,
  );
  if (n.classified === 0) {
    process.stdout.write(
      `          [no Agent A classifications yet — run reclassify-events.ts then re-score]\n`,
    );
  } else {
    process.stdout.write(
      `          classified=${n.classified}   eligible_kind=${n.classified_eligible_kind}   INELIGIBLE=${n.classified_ineligible}\n`,
    );
    if (n.non_rd_contam > 0) {
      process.stdout.write(
        `          contamination caught         ${pct(
          n.contamination_caught,
          n.non_rd_contam,
        )}   (${n.contamination_caught} of ${n.non_rd_contam} non-R&D notes flagged INELIGIBLE)\n`,
      );
      process.stdout.write(
        `          contamination leaked         ${pct(
          n.contamination_leaked,
          n.non_rd_contam,
        )}   (${n.contamination_leaked} of ${n.non_rd_contam} non-R&D notes assigned an R&D kind)\n`,
      );
    }
    if (n.rd_relevant > 0) {
      process.stdout.write(
        `          R&D misclassified            ${pct(
          n.rd_misclassified_as_ineligible,
          n.rd_relevant,
        )}   (${n.rd_misclassified_as_ineligible} of ${n.rd_relevant} R&D notes wrongly marked INELIGIBLE)\n`,
      );
    }
  }
}

function renderAggregate(reports: ClaimReport[]): void {
  // Roll up across all 10 claims.
  let totalN = 0;
  let totalAmt = 0;
  let rdRecallN = 0;
  let rdRecallTotal = 0;
  let rdRecallAmtCaught = 0;
  let rdRecallAmtTotal = 0;
  let precCorrAmt = 0;
  let precMapAmt = 0;
  let leakAmt = 0;
  let leakTotalAmt = 0;
  let mappedAny = 0;

  let noteTotal = 0;
  let noteContam = 0;
  let noteRdRel = 0;
  let noteClassified = 0;
  let contamCaught = 0;
  let contamLeaked = 0;
  let rdMisclass = 0;

  for (const r of reports) {
    const e = r.exp;
    totalN += e.by_band.rd_critical.n + e.by_band.rd_supporting.n + e.by_band.non_rd.n;
    totalAmt +=
      e.by_band.rd_critical.amount_aud +
      e.by_band.rd_supporting.amount_aud +
      e.by_band.non_rd.amount_aud;
    rdRecallN += e.rd_recall_n;
    rdRecallTotal += e.rd_recall_total;
    rdRecallAmtCaught += e.rd_recall_amount_caught;
    rdRecallAmtTotal += e.rd_recall_amount_total;
    precCorrAmt += e.precision_correct_amount;
    precMapAmt += e.precision_mapped_amount;
    leakAmt += e.leak_amount;
    leakTotalAmt += e.leak_total_amount;
    mappedAny += e.mapped.n + e.apportioned.n;

    const n = r.notes;
    noteTotal += n.total;
    noteContam += n.non_rd_contam;
    noteRdRel += n.rd_relevant;
    noteClassified += n.classified;
    contamCaught += n.contamination_caught;
    contamLeaked += n.contamination_leaked;
    rdMisclass += n.rd_misclassified_as_ineligible;
  }

  process.stdout.write('\n' + '═'.repeat(78) + '\n');
  process.stdout.write('Aggregate — 10 claims\n');
  process.stdout.write('═'.repeat(78) + '\n');
  // Aggregate classification metrics
  let clsClassified = 0;
  let clsRDCorrectAmt = 0;
  let clsRDTotalAmt = 0;
  let clsContamCaughtAmt = 0;
  let clsContamLeakedAmt = 0;
  for (const r of reports) {
    clsClassified += r.exp.classified_n;
    clsRDCorrectAmt += r.exp.cls_recall_rd_correct_amount;
    clsRDTotalAmt += r.exp.cls_recall_rd_total_amount;
    clsContamCaughtAmt += r.exp.cls_contam_caught_amount;
    clsContamLeakedAmt += r.exp.cls_contam_leaked_amount;
  }

  process.stdout.write(`Expenditures   total ${totalN}  ${aud(totalAmt)}\n`);
  if (clsClassified > 0) {
    process.stdout.write(
      `  Agent A on expenditures: ${clsClassified} classified\n` +
        `  cls recall ($)         ${pct(clsRDCorrectAmt, clsRDTotalAmt)}   ${aud(clsRDCorrectAmt)} of ${aud(clsRDTotalAmt)} R&D kept eligible\n` +
        `  cls contamination caught ${pct(clsContamCaughtAmt, clsContamCaughtAmt + clsContamLeakedAmt)}   ${aud(clsContamCaughtAmt)} of ${aud(clsContamCaughtAmt + clsContamLeakedAmt)} non-R&D flagged INELIGIBLE\n`,
    );
  }
  if (mappedAny === 0) {
    process.stdout.write(
      `               no mapping events seeded · scoring inputs ready for the mapping engine\n`,
    );
  } else {
    process.stdout.write(
      `  recall ($)         ${pct(rdRecallAmtCaught, rdRecallAmtTotal)}   (${rdRecallN} of ${rdRecallTotal} R&D expenditures mapped)\n`,
    );
    process.stdout.write(
      `  precision ($)      ${pct(precCorrAmt, precMapAmt)}   ${aud(precMapAmt - precCorrAmt)} non-R&D wrongly mapped\n`,
    );
    process.stdout.write(
      `  contamination leak ${pct(leakAmt, leakTotalAmt)}   ${aud(leakAmt)} of ${aud(leakTotalAmt)} non-R&D got into the claim\n`,
    );
  }
  process.stdout.write(
    `\nNotes          total ${noteTotal}   R&D=${noteRdRel}   contamination=${noteContam}\n`,
  );
  if (noteClassified === 0) {
    process.stdout.write(
      `               no classifications attached · scoring inputs ready for Agent A\n`,
    );
  } else {
    process.stdout.write(
      `  contamination caught   ${pct(contamCaught, noteContam)}   (${contamCaught} of ${noteContam} non-R&D notes flagged INELIGIBLE)\n`,
    );
    process.stdout.write(
      `  contamination leaked   ${pct(contamLeaked, noteContam)}   (${contamLeaked} of ${noteContam} non-R&D notes got an R&D kind)\n`,
    );
    process.stdout.write(
      `  R&D misclassified      ${pct(rdMisclass, noteRdRel)}   (${rdMisclass} of ${noteRdRel} R&D notes wrongly marked INELIGIBLE)\n`,
    );
  }
}

async function main(): Promise<void> {
  process.stdout.write('Bulk-claim accuracy report\n');
  process.stdout.write('─'.repeat(78) + '\n');

  const reports: ClaimReport[] = [];
  for (let i = 0; i < DOMAINS.length; i++) {
    const tenantId = tenantIdFor(i);
    const exp = await loadExpenditures(tenantId);
    if (exp.length === 0) {
      process.stdout.write(
        `\n[${String(i + 1).padStart(2, '0')}] ${DOMAINS[i]!.firm.name} — no rows under ${tenantId} (seed not loaded for this firm)\n`,
      );
      continue;
    }
    const notes = await loadNotes(tenantId);
    reports.push({
      idx: i,
      tenant_id: tenantId,
      firm: DOMAINS[i]!.firm.name,
      claimant: DOMAINS[i]!.claimant.name,
      exp: tallyExpenditures(exp),
      notes: tallyNotes(notes),
    });
  }
  for (const r of reports) renderClaim(r);
  if (reports.length > 0) renderAggregate(reports);
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
