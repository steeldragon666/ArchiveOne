import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/**
 * Expenditure Schedule PDF (F.7).
 *
 * A forensic, regulator-facing landscape document listing every expenditure
 * line registered against a claim, with amounts, R&D eligibility percentages,
 * and invoice references.
 *
 * Design tokens (Sprint F, matching activity-register.tsx):
 *   - Page background:  cream   #FAF8F3
 *   - Primary text:     ink     #1A1814
 *   - Accent/headings:  patina  #5C7A6B
 *   - Fonts: Helvetica-Bold for headings, Helvetica for body
 *
 * Forensic header (every page, fixed):
 *   Claim: {id} | FY{year} | Generated: {iso} | Hash: {hex[:12]}… | v{ver}
 *
 * Orientation: landscape (A4) — the table has many columns.
 * Standalone <Document><Page> — no DocumentLayout wrapper.
 */

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type ExpenditureScheduleInput = {
  firm: { name: string; abn: string | null };
  subject_tenant: { name: string; abn: string | null };
  claim: { id: string; fy_year: number };
  generated_at: string; // ISO timestamp
  content_hash_hex: string; // 64 hex chars (sha256)
  generator_version: string; // e.g. "1.0.0"
  expenditure_lines: Array<{
    id: string;
    description: string;
    category: string; // e.g. "labour", "contractor", "materials"
    amount: number;
    rd_percent: number; // 0–100
    rd_amount: number; // computed: amount * rd_percent / 100
    activity_code: string | null;
    invoice_ref: string | null;
    period: string | null; // e.g. "2025-Q1"
  }>;
};

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLOR_CREAM = '#FAF8F3';
const COLOR_INK = '#1A1814';
const COLOR_PATINA = '#5C7A6B';
const COLOR_MUTED = '#666666';
const COLOR_BORDER = '#cccccc';
const COLOR_THEAD_BG = '#EEF2EF';
const COLOR_TROW_BORDER = '#e0e8e4';
const COLOR_TROW_TOTALS_BG = '#EEF2EF';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    backgroundColor: COLOR_CREAM,
    color: COLOR_INK,
  },

  // Forensic header (fixed, top of every page).
  forensicHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: COLOR_PATINA,
    paddingHorizontal: 40,
    paddingVertical: 5,
    flexDirection: 'row',
  },
  forensicHeaderText: {
    fontSize: 7,
    color: '#FFFFFF',
    fontFamily: 'Helvetica',
    flex: 1,
  },

  // Title / cover block.
  titleBlock: {
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_PATINA,
    paddingBottom: 8,
  },
  firmLine: { fontSize: 9, color: COLOR_MUTED },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    marginTop: 4,
    color: COLOR_PATINA,
  },
  subtitle: { fontSize: 9, color: COLOR_MUTED, marginTop: 4 },

  // Claim identity sub-block inside the title block.
  claimMetaRow: { flexDirection: 'row', marginTop: 6 },
  claimMetaLabel: { width: 120, color: COLOR_MUTED, fontSize: 9 },
  claimMetaValue: { flex: 1, fontSize: 9, color: COLOR_INK },

  // Section headings.
  sectionHeading: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 14,
    marginBottom: 6,
    color: COLOR_PATINA,
  },

  // Summary counts row.
  summaryRow: { flexDirection: 'row', marginBottom: 8, gap: 12 },
  summaryBox: {
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 4,
    padding: 8,
    flex: 1,
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: COLOR_PATINA,
  },
  summaryLabel: { fontSize: 8, color: COLOR_MUTED, marginTop: 2 },

  // Expenditure table.
  // Landscape A4 = 842pt wide; minus 80pt padding = 762pt usable.
  // Description: 24%, Category: 10%, Activity: 10%, Period: 9%,
  // Amount: 12%, R&D%: 7%, R&D Amount: 12%, Invoice: 16%  = 100%
  table: { borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 2 },
  thead: {
    flexDirection: 'row',
    backgroundColor: COLOR_THEAD_BG,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
  },
  trow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLOR_TROW_BORDER,
  },
  trowTotals: {
    flexDirection: 'row',
    backgroundColor: COLOR_TROW_TOTALS_BG,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
  th: {
    padding: 6,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: COLOR_PATINA,
  },
  td: { padding: 6, fontSize: 8, color: COLOR_INK },
  tdBold: { padding: 6, fontSize: 8, color: COLOR_INK, fontFamily: 'Helvetica-Bold' },

  // Column widths.
  colDescription: { width: '24%' },
  colCategory: { width: '10%' },
  colActivity: { width: '10%' },
  colPeriod: { width: '9%' },
  colAmount: { width: '12%' },
  colRdPct: { width: '7%' },
  colRdAmount: { width: '12%' },
  colInvoice: { width: '16%' },

  // Category chip.
  chip: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: COLOR_THEAD_BG,
    color: COLOR_PATINA,
  },

  // Per-page footer.
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
    paddingTop: 6,
    fontSize: 8,
    color: COLOR_MUTED,
    textAlign: 'center',
  },

  // Empty state box.
  emptyBox: {
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 10,
    borderRadius: 2,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format amount as AUD currency using en-AU locale.
 * E.g. 1500000 → "$1,500,000.00"
 */
function formatAUD(n: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

/**
 * Format a percentage value as a rounded integer with % sign.
 * E.g. 80 → "80%"
 */
function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ForensicHeader(props: { input: ExpenditureScheduleInput }): React.ReactElement {
  const { claim, generated_at, content_hash_hex, generator_version } = props.input;
  const hashChip = `${content_hash_hex.slice(0, 12)}\u2026`;
  const text =
    `Claim: ${claim.id} | FY${claim.fy_year} | ` +
    `Generated: ${generated_at} | Hash: ${hashChip} | v${generator_version}`;
  return (
    <View style={styles.forensicHeader} fixed>
      <Text style={styles.forensicHeaderText}>{text}</Text>
    </View>
  );
}

function TitleBlock(props: { input: ExpenditureScheduleInput }): React.ReactElement {
  const { firm, subject_tenant, claim, generated_at } = props.input;
  const firmLine = firm.abn ? `${firm.name} \u00B7 ABN ${firm.abn}` : firm.name;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} \u00B7 ABN ${subject_tenant.abn}`
    : subject_tenant.name;
  const shortId = claim.id.slice(-8);

  return (
    <View style={styles.titleBlock}>
      <Text style={styles.firmLine}>{firmLine}</Text>
      <Text style={styles.title}>
        R&amp;D Tax Incentive \u2014 Expenditure Schedule, FY{claim.fy_year}
      </Text>
      <Text style={styles.subtitle}>Generated {generated_at}</Text>
      <View style={styles.claimMetaRow}>
        <Text style={styles.claimMetaLabel}>Claimant</Text>
        <Text style={styles.claimMetaValue}>{claimantLine}</Text>
      </View>
      <View style={styles.claimMetaRow}>
        <Text style={styles.claimMetaLabel}>Claim ID</Text>
        <Text style={styles.claimMetaValue}>\u2026{shortId}</Text>
      </View>
    </View>
  );
}

function SummarySection(props: { input: ExpenditureScheduleInput }): React.ReactElement {
  const { expenditure_lines: lines } = props.input;
  const totalExpenditure = lines.reduce((s, l) => s + l.amount, 0);
  const totalRdAmount = lines.reduce((s, l) => s + l.rd_amount, 0);
  const avgRdPct =
    lines.length > 0 ? lines.reduce((s, l) => s + l.rd_percent, 0) / lines.length : 0;

  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{formatAUD(totalExpenditure)}</Text>
        <Text style={styles.summaryLabel}>Total Expenditure (AUD)</Text>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{formatAUD(totalRdAmount)}</Text>
        <Text style={styles.summaryLabel}>Total R&amp;D Eligible (AUD)</Text>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{formatPct(avgRdPct)}</Text>
        <Text style={styles.summaryLabel}>Average R&amp;D%</Text>
      </View>
    </View>
  );
}

function ExpenditureTableSection(props: { input: ExpenditureScheduleInput }): React.ReactElement {
  const { expenditure_lines: lines } = props.input;

  if (lines.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text>No expenditure lines recorded for this claim.</Text>
      </View>
    );
  }

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const totalRdAmount = lines.reduce((s, l) => s + l.rd_amount, 0);

  return (
    <View style={styles.table}>
      <View style={styles.thead} fixed>
        <Text style={[styles.th, styles.colDescription]}>Description</Text>
        <Text style={[styles.th, styles.colCategory]}>Category</Text>
        <Text style={[styles.th, styles.colActivity]}>Activity</Text>
        <Text style={[styles.th, styles.colPeriod]}>Period</Text>
        <Text style={[styles.th, styles.colAmount]}>Amount (AUD)</Text>
        <Text style={[styles.th, styles.colRdPct]}>R&amp;D%</Text>
        <Text style={[styles.th, styles.colRdAmount]}>R&amp;D Amount (AUD)</Text>
        <Text style={[styles.th, styles.colInvoice]}>Invoice Ref</Text>
      </View>
      {lines.map((l) => (
        <View key={l.id} style={styles.trow} wrap={false}>
          <Text style={[styles.td, styles.colDescription]}>{l.description}</Text>
          <View style={[styles.td, styles.colCategory]}>
            <Text style={styles.chip}>{l.category}</Text>
          </View>
          <Text style={[styles.td, styles.colActivity]}>{l.activity_code ?? '\u2014'}</Text>
          <Text style={[styles.td, styles.colPeriod]}>{l.period ?? '\u2014'}</Text>
          <Text style={[styles.td, styles.colAmount]}>{formatAUD(l.amount)}</Text>
          <Text style={[styles.td, styles.colRdPct]}>{formatPct(l.rd_percent)}</Text>
          <Text style={[styles.td, styles.colRdAmount]}>{formatAUD(l.rd_amount)}</Text>
          <Text style={[styles.td, styles.colInvoice]}>{l.invoice_ref ?? '\u2014'}</Text>
        </View>
      ))}
      {/* Totals footer row */}
      <View style={styles.trowTotals} wrap={false}>
        <Text style={[styles.tdBold, styles.colDescription]}>Totals</Text>
        <Text style={[styles.tdBold, styles.colCategory]}></Text>
        <Text style={[styles.tdBold, styles.colActivity]}></Text>
        <Text style={[styles.tdBold, styles.colPeriod]}></Text>
        <Text style={[styles.tdBold, styles.colAmount]}>{formatAUD(totalAmount)}</Text>
        <Text style={[styles.tdBold, styles.colRdPct]}></Text>
        <Text style={[styles.tdBold, styles.colRdAmount]}>{formatAUD(totalRdAmount)}</Text>
        <Text style={[styles.tdBold, styles.colInvoice]}></Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/** Pure-function renderer. Returns a Uint8Array of the raw PDF bytes. */
export async function renderExpenditureSchedulePdf(
  input: ExpenditureScheduleInput,
): Promise<Uint8Array> {
  const { firm, subject_tenant, claim } = input;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} \u00B7 ABN ${subject_tenant.abn}`
    : subject_tenant.name;
  const footerText = `Expenditure Schedule \u00B7 Claim FY${claim.fy_year} \u00B7 ${firm.name} \u2192 ${claimantLine}`;

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <ForensicHeader input={input} />
        <TitleBlock input={input} />
        <Text style={styles.sectionHeading}>Expenditure Schedule</Text>
        <SummarySection input={input} />
        <ExpenditureTableSection input={input} />
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages} \u00B7 ${footerText}`
          }
        />
      </Page>
    </Document>
  );

  // @react-pdf/renderer v4: pdf().toBuffer() returns an AsyncGenerator.
  // Collect all chunks into a single Buffer then return as Uint8Array.
  const stream = await pdf(doc).toBuffer();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buf = Buffer.concat(chunks);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
