import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/**
 * Ingest Summary PDF (F.3).
 *
 * A forensic audit document that captures the full provenance of the
 * document ingestion pipeline for a single R&D tax claim. It answers:
 *   1. What source documents were ingested and how many?
 *   2. How well did the extraction pipeline perform?
 *   3. How are the extracted evidence fragments classified?
 *   4. What reconciliation findings arose when cross-checking F.2?
 *   5. What are the exact source files with their hashes (provenance)?
 *
 * Design tokens (Sprint F):
 *   - Page background:  cream   #FAF8F3
 *   - Primary text:     ink     #1A1814
 *   - Accent/headings:  patina  #5C7A6B
 *   - Fonts: Helvetica-Bold for headings, Helvetica for body (custom
 *     font registration deferred until font files land in the repo — see
 *     task spec note on Fraunces / Inter Tight).
 *
 * Forensic header (every page, fixed):
 *   Claim: {id} | FY{year} | Generated: {iso} | Hash: {hex[:12]}… | v{ver}
 */

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type IngestSummaryInput = {
  firm: { name: string; abn: string | null };
  subject_tenant: { name: string; abn: string | null };
  claim: {
    id: string;
    fy_year: number;
  };
  generated_at: string; // ISO timestamp
  content_hash_hex: string;
  generator_version: string; // e.g. "1.0.0"

  // Section 1: Source documents inventory — flat array per parser kind
  source_inventory: Array<{
    parser_kind: string;
    file_count: number;
    avg_extraction_quality: number; // 0–1
  }>;

  // Section 2: Extraction quality
  extraction_quality: {
    total_files: number;
    structured_count: number;
    ocr_fallback_count: number;
    avg_quality: number; // 0–1
  };

  // Section 3: Classification distribution
  classification_distribution: Array<{
    evidence_kind: string;
    count: number;
    avg_confidence: number; // 0–1
  }>;

  // Section 4: Reconciliation summary — flat array with per-row severity
  reconciliation_summary: Array<{
    kind: string;
    severity: 'high' | 'medium' | 'low';
    count: number;
  }>;

  // Section 5: Source files list (forensic provenance)
  source_files: Array<{
    filename: string;
    sha256: string;
    parser_kind: string;
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
const COLOR_THEAD_BG = '#EEF2EF'; // light tint of patina for table headers
const COLOR_TROW_BORDER = '#e0e8e4';
const COLOR_SEVERITY_HIGH = '#b91c1c';
const COLOR_SEVERITY_MEDIUM = '#b45309';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    paddingTop: 56,
    paddingBottom: 60,
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

  // Title block.
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

  // Section headings.
  sectionHeading: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 14,
    marginBottom: 6,
    color: COLOR_PATINA,
  },

  // Generic meta key-value box.
  metaBox: {
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    padding: 10,
    borderRadius: 2,
  },
  metaRow: { flexDirection: 'row', marginBottom: 4 },
  metaLabel: { width: 180, color: COLOR_MUTED },
  metaValue: { flex: 1, color: COLOR_INK },

  // Shared table styles.
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
    fontSize: 9,
    color: COLOR_PATINA,
  },
  td: { padding: 6, fontSize: 9, color: COLOR_INK },

  // Source inventory table columns.
  invColKind: { width: '30%' },
  invColCount: { width: '20%', textAlign: 'right' },
  invColBar: { width: '50%' },

  // Classification distribution columns.
  classColKind: { width: '55%' },
  classColCount: { width: '20%', textAlign: 'right' },
  classColConf: { width: '25%', textAlign: 'right' },

  // Reconciliation by-kind columns.
  reconColSeverity: { width: '25%' },
  reconColKind: { width: '55%' },
  reconColCount: { width: '20%', textAlign: 'right' },

  // Source files columns.
  filesColName: { width: '32%' },
  filesColParser: { width: '14%' },
  filesColHash: { width: '30%' },
  filesColSize: { width: '24%', textAlign: 'right' },

  // Monospace chip for hash values.
  hashChip: { fontFamily: 'Courier', fontSize: 8, color: COLOR_MUTED },

  // Severity chips.
  severityHigh: { color: COLOR_SEVERITY_HIGH, fontFamily: 'Helvetica-Bold' },
  severityMedium: { color: COLOR_SEVERITY_MEDIUM, fontFamily: 'Helvetica-Bold' },
  severityLow: { color: COLOR_MUTED },

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

  // Quality bar row.
  qualityBarRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'center' },
  qualityBarLabel: { width: 220, color: COLOR_MUTED },
  qualityBarValue: { flex: 1 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render an ASCII progress bar for a 0–1 quality value.
 * 20 characters wide: filled with '█', empty with '░'.
 * E.g. 0.85 → "█████████████████░░░"
 */
function qualityBar(value: number, width = 20): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

/** Format size_bytes as e.g. "12,345 bytes". */
function formatSizeBytes(sizeBytes: number): string {
  return `${sizeBytes.toLocaleString('en-AU')} bytes`;
}

/** Format an avg_confidence (0–1) as e.g. "0.85". */
function formatConfidence(value: number): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ForensicHeader(props: { input: IngestSummaryInput }): React.ReactElement {
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

function TitleBlock(props: { input: IngestSummaryInput }): React.ReactElement {
  const { firm, claim, generated_at } = props.input;
  const abnLine = firm.abn ? `${firm.name} · ABN ${firm.abn}` : firm.name;
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.firmLine}>{abnLine}</Text>
      <Text style={styles.title}>R&amp;D Tax Incentive — Ingest Summary, FY{claim.fy_year}</Text>
      <Text style={styles.subtitle}>Generated {generated_at}</Text>
    </View>
  );
}

function SourceInventorySection(props: { input: IngestSummaryInput }): React.ReactElement {
  const inv = props.input.source_inventory;
  return (
    <View>
      <Text style={styles.sectionHeading}>1. Source Inventory</Text>
      {inv.length === 0 ? (
        <View style={styles.metaBox}>
          <Text>No documents ingested.</Text>
        </View>
      ) : (
        <View style={styles.table}>
          <View style={styles.thead} fixed>
            <Text style={[styles.th, styles.invColKind]}>Parser kind</Text>
            <Text style={[styles.th, styles.invColCount]}>Files</Text>
            <Text style={[styles.th, styles.invColBar]}>Avg extraction quality</Text>
          </View>
          {inv.map((row) => (
            <View key={row.parser_kind} style={styles.trow} wrap={false}>
              <Text style={[styles.td, styles.invColKind]}>{row.parser_kind}</Text>
              <Text style={[styles.td, styles.invColCount]}>{row.file_count}</Text>
              <Text style={[styles.td, styles.invColBar, styles.hashChip]}>
                {qualityBar(row.avg_extraction_quality)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ExtractionQualitySection(props: { input: IngestSummaryInput }): React.ReactElement {
  const eq = props.input.extraction_quality;
  const structuredPct =
    eq.total_files > 0 ? ((eq.structured_count / eq.total_files) * 100).toFixed(1) : '0.0';
  return (
    <View>
      <Text style={styles.sectionHeading}>2. Extraction Quality</Text>
      <View style={styles.metaBox}>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Structured documents</Text>
          <Text style={styles.metaValue}>
            {eq.structured_count} / {eq.total_files} ({structuredPct}%)
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>OCR fallback count</Text>
          <Text style={styles.metaValue}>{eq.ocr_fallback_count}</Text>
        </View>
        <View style={styles.qualityBarRow}>
          <Text style={styles.qualityBarLabel}>Overall avg quality</Text>
          <Text style={[styles.qualityBarValue, styles.hashChip]}>
            {qualityBar(eq.avg_quality)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ClassificationDistributionSection(props: {
  input: IngestSummaryInput;
}): React.ReactElement {
  const dist = props.input.classification_distribution;
  if (dist.length === 0) {
    return (
      <View>
        <Text style={styles.sectionHeading}>3. Classification Distribution</Text>
        <View style={styles.metaBox}>
          <Text>No classifications recorded.</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.sectionHeading}>3. Classification Distribution</Text>
      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.classColKind]}>Evidence kind</Text>
          <Text style={[styles.th, styles.classColCount]}>Count</Text>
          <Text style={[styles.th, styles.classColConf]}>Avg confidence</Text>
        </View>
        {dist.map((row) => (
          <View key={row.evidence_kind} style={styles.trow} wrap={false}>
            <Text style={[styles.td, styles.classColKind]}>{row.evidence_kind}</Text>
            <Text style={[styles.td, styles.classColCount]}>{row.count}</Text>
            <Text style={[styles.td, styles.classColConf]}>
              {formatConfidence(row.avg_confidence)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReconciliationSummarySection(props: { input: IngestSummaryInput }): React.ReactElement {
  const rows = props.input.reconciliation_summary;

  if (rows.length === 0) {
    return (
      <View>
        <Text style={styles.sectionHeading}>4. Reconciliation Summary</Text>
        <View style={styles.metaBox}>
          <Text>No reconciliation findings.</Text>
        </View>
      </View>
    );
  }

  // Group by severity: high → medium → low
  const severityOrder: Array<'high' | 'medium' | 'low'> = ['high', 'medium', 'low'];
  const sorted = [...rows].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  return (
    <View>
      <Text style={styles.sectionHeading}>4. Reconciliation Summary</Text>
      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.reconColSeverity]}>Severity</Text>
          <Text style={[styles.th, styles.reconColKind]}>Kind</Text>
          <Text style={[styles.th, styles.reconColCount]}>Count</Text>
        </View>
        {sorted.map((row, idx) => {
          const severityStyle =
            row.severity === 'high'
              ? styles.severityHigh
              : row.severity === 'medium'
                ? styles.severityMedium
                : styles.severityLow;
          return (
            <View key={`${row.severity}-${row.kind}-${idx}`} style={styles.trow} wrap={false}>
              <Text style={[styles.td, styles.reconColSeverity, severityStyle]}>
                {row.severity}
              </Text>
              <Text style={[styles.td, styles.reconColKind]}>{row.kind}</Text>
              <Text style={[styles.td, styles.reconColCount]}>{row.count}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SourceFilesSection(props: { input: IngestSummaryInput }): React.ReactElement {
  const files = props.input.source_files;

  if (files.length === 0) {
    return (
      <View>
        <Text style={styles.sectionHeading}>5. Source Files (Forensic Provenance)</Text>
        <View style={styles.metaBox}>
          <Text>No source files recorded.</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.sectionHeading}>
        5. Source Files (Forensic Provenance) — {files.length} file
        {files.length === 1 ? '' : 's'}
      </Text>
      <View style={styles.table}>
        <View style={styles.thead} fixed>
          <Text style={[styles.th, styles.filesColName]}>Filename</Text>
          <Text style={[styles.th, styles.filesColParser]}>Parser</Text>
          <Text style={[styles.th, styles.filesColHash]}>SHA-256</Text>
          <Text style={[styles.th, styles.filesColSize]}>Size</Text>
        </View>
        {files.map((f) => (
          <View key={`${f.filename}-${f.sha256}`} style={styles.trow} wrap={false}>
            <Text style={[styles.td, styles.filesColName]}>{f.filename}</Text>
            <Text style={[styles.td, styles.filesColParser]}>{f.parser_kind}</Text>
            <Text style={[styles.td, styles.filesColHash, styles.hashChip]}>{f.sha256}</Text>
            <Text style={[styles.td, styles.filesColSize]}>{formatSizeBytes(f.size_bytes)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/** Pure-function renderer. Returns a Uint8Array of the raw PDF bytes. */
export async function renderIngestSummaryPdf(input: IngestSummaryInput): Promise<Uint8Array> {
  const { firm, claim, subject_tenant } = input;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} · ABN ${subject_tenant.abn}`
    : subject_tenant.name;

  const footerText = `Ingest Summary · Claim FY${claim.fy_year} · ${firm.name} → ${claimantLine}`;

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ForensicHeader input={input} />
        <TitleBlock input={input} />
        <SourceInventorySection input={input} />
        <ExtractionQualitySection input={input} />
        <ClassificationDistributionSection input={input} />
        <ReconciliationSummarySection input={input} />
        <SourceFilesSection input={input} />
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
