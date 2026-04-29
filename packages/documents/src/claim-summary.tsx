import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/**
 * Claim summary PDF (C7). Stand-alone <Document><Page> rather than a reuse
 * of `DocumentLayout` from `pdf-base.tsx`, by deliberate divergence:
 *
 * `DocumentLayout` is hard-coded for content-hashed evidence documents —
 * it requires a `contentHashHex` prop and bakes it into the page footer
 * ("Content hash: abc123…"). C7's claim summary is a higher-level
 * deliverable: it aggregates *across* events and expenditures rather than
 * carrying an event-chain anchor of its own. Wedging C7 into
 * `DocumentLayout` would mean either:
 *   1. fabricating a content hash (lying in the footer), or
 *   2. adding a `footer={…}` slot prop that breaks the existing single-
 *      footer assumption used by content-hashed callers.
 *
 * Either feels worse than a small standalone Page tree. If a sibling PDF
 * type lands later that *also* needs the C7 footer ("Page X of Y · Claim
 * FY{year} · {firm.name}"), we can promote a `ClaimDocumentLayout` then.
 *
 * Layout sections (1-indexed, ordering matches the input shape):
 *   1. Header — firm name + ABN, "R&D Tax Incentive — Claim Summary,
 *      FY{year}", generated-at timestamp.
 *   2. Claim metadata box — project name + description, claim FY + stage
 *      + window dates.
 *   3. Activities table — one row per activity (Code, Title, Kind,
 *      Artefacts, Uncertainty events, Apportioned amount). Footer row
 *      with the column total. Empty-state line if zero activities.
 *   4. Expenditures summary box — total spend in currency, three counts
 *      (mapped / apportioned / unmapped), text-only "X of Y allocated"
 *      progress indicator.
 *   5. Footer (every page) — "Page X of Y · Claim FY{year} · {firm.name}".
 *
 * Page size A4 — matches AusIndustry portal expectations and the existing
 * pdf-base footprint.
 */

export type ClaimSummaryActivity = {
  code: string;
  title: string;
  kind: 'CORE' | 'SUPPORTING';
  description: string | null;
  artefact_count: number;
  uncertainty_event_count: number;
  /** Sum across this activity's allocations, in claim currency. */
  total_apportioned_amount: number;
};

export type ClaimSummaryInput = {
  firm: { name: string; abn: string | null };
  subject_tenant: { name: string; abn: string | null };
  project: { name: string; description: string | null };
  claim: {
    id: string;
    fiscal_year: number;
    stage: string;
    started_at: string | null;
    ended_at: string | null;
  };
  activities: ReadonlyArray<ClaimSummaryActivity>;
  expenditures_summary: {
    total_amount: number;
    currency: string;
    mapped_count: number;
    apportioned_count: number;
    unmapped_count: number;
  };
  generated_at: string;
};

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10, paddingBottom: 60 },
  header: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 8,
  },
  firmLine: { fontSize: 9, color: '#666666' },
  title: { fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  subtitle: { fontSize: 9, color: '#666666', marginTop: 4 },
  sectionHeading: { fontSize: 11, fontWeight: 'bold', marginTop: 14, marginBottom: 6 },
  metaBox: {
    borderWidth: 1,
    borderColor: '#cccccc',
    padding: 10,
    borderRadius: 2,
  },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 110, color: '#666666' },
  metaValue: { flex: 1 },
  // Activities table.
  table: { borderWidth: 1, borderColor: '#cccccc', borderRadius: 2 },
  thead: {
    flexDirection: 'row',
    backgroundColor: '#f3f3f3',
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
  },
  trow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eeeeee' },
  tfoot: {
    flexDirection: 'row',
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderTopColor: '#cccccc',
  },
  th: { padding: 6, fontWeight: 'bold', fontSize: 9 },
  td: { padding: 6, fontSize: 9 },
  // Column widths sum to 100 in flex units.
  colCode: { width: '12%' },
  colTitle: { width: '34%' },
  colKind: { width: '12%' },
  colArtefacts: { width: '10%', textAlign: 'right' },
  colUncertainty: { width: '12%', textAlign: 'right' },
  colAmount: { width: '20%', textAlign: 'right' },
  // Expenditure summary.
  expBox: {
    borderWidth: 1,
    borderColor: '#cccccc',
    padding: 10,
    borderRadius: 2,
  },
  expRow: { flexDirection: 'row', marginBottom: 4 },
  expLabel: { width: 160, color: '#666666' },
  expValue: { flex: 1 },
  // Per-page footer.
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#cccccc',
    paddingTop: 6,
    fontSize: 8,
    color: '#666666',
    textAlign: 'center',
  },
});

/** Format an ISO timestamp as YYYY-MM-DD. Falls back to '—' for null. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // Slice instead of new Date so we don't introduce timezone shifts in the
  // PDF — auditor reads the calendar date, not the rendered local date.
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return d;
}

/** Format amount as fixed-2 with thousand separators + currency suffix. */
function formatMoney(amount: number, currency: string): string {
  // Intl.NumberFormat is available in @react-pdf/renderer's Node runtime.
  // Locale fixed to en-AU for the AusIndustry-facing PDF.
  const f = new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${f.format(amount)} ${currency}`;
}

function HeaderBlock(props: { input: ClaimSummaryInput }): React.ReactElement {
  const { firm, claim, generated_at } = props.input;
  const abnLine = firm.abn ? `${firm.name} · ABN ${firm.abn}` : firm.name;
  return (
    <View style={styles.header}>
      <Text style={styles.firmLine}>{abnLine}</Text>
      <Text style={styles.title}>R&amp;D Tax Incentive — Claim Summary, FY{claim.fiscal_year}</Text>
      <Text style={styles.subtitle}>Generated {generated_at}</Text>
    </View>
  );
}

function ClaimMetadataBox(props: { input: ClaimSummaryInput }): React.ReactElement {
  const { project, subject_tenant, claim } = props.input;
  return (
    <View>
      <Text style={styles.sectionHeading}>Claim</Text>
      <View style={styles.metaBox}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Claimant</Text>
          <Text style={styles.metaValue}>
            {subject_tenant.abn
              ? `${subject_tenant.name} · ABN ${subject_tenant.abn}`
              : subject_tenant.name}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Project</Text>
          <Text style={styles.metaValue}>{project.name}</Text>
        </View>
        {project.description ? (
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Description</Text>
            <Text style={styles.metaValue}>{project.description}</Text>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Fiscal year</Text>
          <Text style={styles.metaValue}>FY{claim.fiscal_year}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Stage</Text>
          <Text style={styles.metaValue}>{claim.stage}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Window</Text>
          <Text style={styles.metaValue}>
            {formatDate(claim.started_at)} — {formatDate(claim.ended_at)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ActivitiesTable(props: { input: ClaimSummaryInput }): React.ReactElement {
  const { activities, expenditures_summary } = props.input;
  const currency = expenditures_summary.currency;

  if (activities.length === 0) {
    return (
      <View>
        <Text style={styles.sectionHeading}>Activities</Text>
        <View style={styles.metaBox}>
          <Text>No activities registered for this claim.</Text>
        </View>
      </View>
    );
  }

  const totalApportioned = activities.reduce((acc, a) => acc + a.total_apportioned_amount, 0);

  return (
    <View>
      <Text style={styles.sectionHeading}>Activities ({activities.length})</Text>
      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.colCode]}>Code</Text>
          <Text style={[styles.th, styles.colTitle]}>Title</Text>
          <Text style={[styles.th, styles.colKind]}>Kind</Text>
          <Text style={[styles.th, styles.colArtefacts]}>Artefacts</Text>
          <Text style={[styles.th, styles.colUncertainty]}>Uncertainty</Text>
          <Text style={[styles.th, styles.colAmount]}>Apportioned</Text>
        </View>
        {activities.map((a) => (
          <View key={a.code} style={styles.trow} wrap={false}>
            <Text style={[styles.td, styles.colCode]}>{a.code}</Text>
            <Text style={[styles.td, styles.colTitle]}>{a.title}</Text>
            <Text style={[styles.td, styles.colKind]}>
              {a.kind === 'CORE' ? 'Core' : 'Supporting'}
            </Text>
            <Text style={[styles.td, styles.colArtefacts]}>{a.artefact_count}</Text>
            <Text style={[styles.td, styles.colUncertainty]}>{a.uncertainty_event_count}</Text>
            <Text style={[styles.td, styles.colAmount]}>
              {formatMoney(a.total_apportioned_amount, currency)}
            </Text>
          </View>
        ))}
        <View style={styles.tfoot}>
          <Text style={[styles.td, styles.colCode]}>Total</Text>
          <Text style={[styles.td, styles.colTitle]}> </Text>
          <Text style={[styles.td, styles.colKind]}> </Text>
          <Text style={[styles.td, styles.colArtefacts]}> </Text>
          <Text style={[styles.td, styles.colUncertainty]}> </Text>
          <Text style={[styles.td, styles.colAmount]}>
            {formatMoney(totalApportioned, currency)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ExpendituresSummaryBox(props: { input: ClaimSummaryInput }): React.ReactElement {
  const s = props.input.expenditures_summary;
  const allocated = s.mapped_count + s.apportioned_count;
  const total = allocated + s.unmapped_count;
  const progress = total > 0 ? `${allocated} of ${total} allocated` : 'No expenditures yet';
  return (
    <View>
      <Text style={styles.sectionHeading}>Expenditures</Text>
      <View style={styles.expBox}>
        <View style={styles.expRow}>
          <Text style={styles.expLabel}>Total spend</Text>
          <Text style={styles.expValue}>{formatMoney(s.total_amount, s.currency)}</Text>
        </View>
        <View style={styles.expRow}>
          <Text style={styles.expLabel}>Parent-mapped</Text>
          <Text style={styles.expValue}>{s.mapped_count}</Text>
        </View>
        <View style={styles.expRow}>
          <Text style={styles.expLabel}>Apportioned</Text>
          <Text style={styles.expValue}>{s.apportioned_count}</Text>
        </View>
        <View style={styles.expRow}>
          <Text style={styles.expLabel}>Unmapped</Text>
          <Text style={styles.expValue}>{s.unmapped_count}</Text>
        </View>
        <View style={styles.expRow}>
          <Text style={styles.expLabel}>Progress</Text>
          <Text style={styles.expValue}>{progress}</Text>
        </View>
      </View>
    </View>
  );
}

/** Pure-function renderer. Returns a Uint8Array of the raw PDF bytes. */
export async function renderClaimSummaryPdf(input: ClaimSummaryInput): Promise<Uint8Array> {
  const footerText = `Claim FY${input.claim.fiscal_year} · ${input.firm.name}`;

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderBlock input={input} />
        <ClaimMetadataBox input={input} />
        <ActivitiesTable input={input} />
        <ExpendituresSummaryBox input={input} />
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages} · ${footerText}`
          }
        />
      </Page>
    </Document>
  );

  // @react-pdf/renderer's pdf().toBuffer() returns a Node Readable in v4.
  // We collect it into a Uint8Array so the API layer can stream/send the
  // bytes without depending on Node's stream types.
  const stream = await pdf(doc).toBuffer();
  // toBuffer's typings call it Buffer | NodeJS.ReadableStream — we hit the
  // stream branch in v4. Read it into a single Uint8Array.
  if (stream instanceof Uint8Array) {
    return new Uint8Array(stream);
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}
