import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/**
 * Evidence Index PDF (F.8).
 *
 * A forensic, regulator-facing landscape document indexing every evidence
 * item registered against a claim, with classification confidence, activity
 * codes, SHA-256 fingerprints, and file metadata.
 *
 * Design tokens (Sprint F, matching expenditure-schedule.tsx):
 *   - Page background:  cream   #FAF8F3
 *   - Primary text:     ink     #1A1814
 *   - Accent/headings:  patina  #5C7A6B
 *   - Fonts: Helvetica-Bold for headings, Helvetica for body, Courier for SHA chips
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

export type EvidenceIndexInput = {
  firm: { name: string; abn: string | null };
  subject_tenant: { name: string; abn: string | null };
  claim: { id: string; fy_year: number };
  generated_at: string; // ISO timestamp
  content_hash_hex: string; // 64 hex chars (sha256)
  generator_version: string; // e.g. "1.0.0"
  evidence_items: Array<{
    id: string;
    filename: string;
    evidence_kind: string; // e.g. "lab_notebook", "invoice", "timesheet"
    classified_confidence: number; // 0–1
    activity_codes: string[]; // may be empty
    sha256: string; // 64-char hex
    uploaded_at: string; // ISO timestamp
    size_bytes: number;
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

  // Evidence table.
  // Landscape A4 = 842pt wide; minus 80pt padding = 762pt usable.
  // Filename: 28%, Kind: 12%, Confidence: 8%, Activities: 14%,
  // SHA-256: 13%, Uploaded: 11%, Size: 14% = 100%
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
  th: {
    padding: 6,
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: COLOR_PATINA,
  },
  td: { padding: 6, fontSize: 8, color: COLOR_INK },

  // Column widths — must sum to exactly 100%.
  colFilename: { width: '28%' },
  colKind: { width: '12%' },
  colConfidence: { width: '8%' },
  colActivities: { width: '14%' },
  colSha: { width: '13%' },
  colUploaded: { width: '11%' },
  colSize: { width: '14%' },

  // Evidence kind chip.
  chip: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 7,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: COLOR_THEAD_BG,
    color: COLOR_PATINA,
  },

  // SHA-256 chip — Courier (built-in, no registration needed).
  shaChip: {
    fontFamily: 'Courier',
    fontSize: 7,
    color: COLOR_INK,
  },

  // Kind breakdown table.
  breakdownTable: {
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 2,
    marginTop: 4,
  },
  breakdownThead: {
    flexDirection: 'row',
    backgroundColor: COLOR_THEAD_BG,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
  },
  breakdownTrow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLOR_TROW_BORDER,
  },
  breakdownColKind: { width: '70%' },
  breakdownColCount: { width: '30%' },

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
 * Format a file size in human-readable form.
 * < 1024 B   → "${bytes} B"
 * < 1024 KB  → "${(bytes/1024).toFixed(1)} KB"
 * else        → "${(bytes/1024/1024).toFixed(1)} MB"
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Extract just the date portion from an ISO timestamp.
 * E.g. "2025-03-15T09:30:00Z" → "2025-03-15"
 */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ForensicHeader(props: { input: EvidenceIndexInput }): React.ReactElement {
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

function TitleBlock(props: { input: EvidenceIndexInput }): React.ReactElement {
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
        R&amp;D Tax Incentive \u2014 Evidence Index, FY{claim.fy_year}
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

function SummarySection(props: { input: EvidenceIndexInput }): React.ReactElement {
  const { evidence_items: items } = props.input;

  const uniqueKinds = new Set(items.map((i) => i.evidence_kind)).size;

  // Count how many distinct activity codes have at least one evidence item.
  const allActivityCodes = new Set(items.flatMap((i) => i.activity_codes));
  const activitiesWithEvidence = allActivityCodes.size;

  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{items.length}</Text>
        <Text style={styles.summaryLabel}>Total Evidence Items</Text>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{uniqueKinds}</Text>
        <Text style={styles.summaryLabel}>Unique Evidence Kinds</Text>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryValue}>{activitiesWithEvidence}</Text>
        <Text style={styles.summaryLabel}>Activities with Evidence</Text>
      </View>
    </View>
  );
}

function EvidenceTableSection(props: { input: EvidenceIndexInput }): React.ReactElement {
  const { evidence_items: items } = props.input;

  if (items.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Text>No evidence items recorded for this claim.</Text>
      </View>
    );
  }

  return (
    <View style={styles.table}>
      <View style={styles.thead} fixed>
        <Text style={[styles.th, styles.colFilename]}>Filename</Text>
        <Text style={[styles.th, styles.colKind]}>Evidence Kind</Text>
        <Text style={[styles.th, styles.colConfidence]}>Confidence</Text>
        <Text style={[styles.th, styles.colActivities]}>Activity Codes</Text>
        <Text style={[styles.th, styles.colSha]}>SHA-256</Text>
        <Text style={[styles.th, styles.colUploaded]}>Uploaded</Text>
        <Text style={[styles.th, styles.colSize]}>Size</Text>
      </View>
      {items.map((item) => (
        <View key={item.id} style={styles.trow} wrap={false}>
          <Text style={[styles.td, styles.colFilename]}>{item.filename}</Text>
          <View style={[styles.td, styles.colKind]}>
            <Text style={styles.chip}>{item.evidence_kind}</Text>
          </View>
          <Text style={[styles.td, styles.colConfidence]}>
            {item.classified_confidence.toFixed(2)}
          </Text>
          <Text style={[styles.td, styles.colActivities]}>
            {item.activity_codes.length > 0 ? item.activity_codes.join(', ') : '\u2014'}
          </Text>
          <View style={[styles.td, styles.colSha]}>
            <Text style={styles.shaChip}>{item.sha256.slice(0, 12)}\u2026</Text>
          </View>
          <Text style={[styles.td, styles.colUploaded]}>{formatDate(item.uploaded_at)}</Text>
          <Text style={[styles.td, styles.colSize]}>{formatSize(item.size_bytes)}</Text>
        </View>
      ))}
    </View>
  );
}

function KindBreakdownSection(props: { input: EvidenceIndexInput }): React.ReactElement {
  const { evidence_items: items } = props.input;

  if (items.length === 0) return <View />;

  // Count items per kind, sorted descending by count.
  const kindCounts = new Map<string, number>();
  for (const item of items) {
    kindCounts.set(item.evidence_kind, (kindCounts.get(item.evidence_kind) ?? 0) + 1);
  }
  const rows = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <View style={styles.breakdownTable}>
      <View style={styles.breakdownThead}>
        <Text style={[styles.th, styles.breakdownColKind]}>Evidence Kind</Text>
        <Text style={[styles.th, styles.breakdownColCount]}>Count</Text>
      </View>
      {rows.map(([kind, count]) => (
        <View key={kind} style={styles.breakdownTrow}>
          <Text style={[styles.td, styles.breakdownColKind]}>{kind}</Text>
          <Text style={[styles.td, styles.breakdownColCount]}>{count}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/** Pure-function renderer. Returns a Uint8Array of the raw PDF bytes. */
export async function renderEvidenceIndexPdf(input: EvidenceIndexInput): Promise<Uint8Array> {
  const { firm, subject_tenant, claim } = input;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} \u00B7 ABN ${subject_tenant.abn}`
    : subject_tenant.name;
  const footerText = `Evidence Index \u00B7 Claim FY${claim.fy_year} \u00B7 ${firm.name} \u2192 ${claimantLine}`;

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <ForensicHeader input={input} />
        <TitleBlock input={input} />
        <Text style={styles.sectionHeading}>Summary</Text>
        <SummarySection input={input} />
        <Text style={styles.sectionHeading}>Evidence Items</Text>
        <EvidenceTableSection input={input} />
        <Text style={styles.sectionHeading}>Kind Breakdown</Text>
        <KindBreakdownSection input={input} />
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
