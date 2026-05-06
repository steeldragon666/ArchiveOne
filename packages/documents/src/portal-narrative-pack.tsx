import React from 'react';
import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';

/**
 * Portal Narrative Content Pack PDF (F.6) — [SKELETON]
 *
 * This is a skeleton implementation. Full narrative content and section
 * rendering are pending a future sprint. The structure, forensic header,
 * title block, and placeholder notice are in place but section content
 * is intentionally minimal.
 *
 * Design tokens (Sprint F, matching other Sprint F PDFs):
 *   - Page background:  cream   #FAF8F3
 *   - Primary text:     ink     #1A1814
 *   - Accent/headings:  patina  #5C7A6B
 *
 * Orientation: portrait A4.
 */

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface PortalNarrativePackInput {
  firm: { name: string; abn: string | null };
  subject_tenant: { name: string; abn: string | null };
  claim: { id: string; fy_year: number };
  generated_at: string; // ISO timestamp
  content_hash_hex: string; // 64 hex chars (sha256)
  generator_version: string; // e.g. "1.0.0"
  // Placeholder — full narrative content TBD in a future sprint
  narrative_sections: Array<{
    section_kind: string;
    heading: string;
    content_placeholder: string;
  }>;
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLOR_CREAM = '#FAF8F3';
const COLOR_INK = '#1A1814';
const COLOR_PATINA = '#5C7A6B';
const COLOR_MUTED = '#666666';
const COLOR_WARNING_BG = '#FFF8E1';
const COLOR_WARNING_BORDER = '#F9A825';

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
  claimMetaRow: { flexDirection: 'row', marginTop: 6 },
  claimMetaLabel: { width: 120, color: COLOR_MUTED, fontSize: 9 },
  claimMetaValue: { flex: 1, fontSize: 9, color: COLOR_INK },

  // Placeholder / skeleton notice.
  skeletonNotice: {
    borderWidth: 1,
    borderColor: COLOR_WARNING_BORDER,
    backgroundColor: COLOR_WARNING_BG,
    padding: 10,
    borderRadius: 2,
    marginBottom: 16,
  },
  skeletonNoticeText: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#7B3F00',
  },

  // Section headings.
  sectionHeading: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 14,
    marginBottom: 4,
    color: COLOR_PATINA,
  },
  sectionContent: {
    fontSize: 9,
    color: COLOR_MUTED,
    lineHeight: 1.5,
    marginBottom: 8,
  },

  // Footer.
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#cccccc',
    paddingTop: 6,
    fontSize: 8,
    color: COLOR_MUTED,
    textAlign: 'center',
  },
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function ForensicHeader(props: { input: PortalNarrativePackInput }): React.ReactElement {
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

function TitleBlock(props: { input: PortalNarrativePackInput }): React.ReactElement {
  const { firm, subject_tenant, claim, generated_at } = props.input;
  const firmLine = firm.abn ? `${firm.name} \u00B7 ABN ${firm.abn}` : firm.name;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} \u00B7 ABN ${subject_tenant.abn}`
    : subject_tenant.name;

  return (
    <View style={styles.titleBlock}>
      <Text style={styles.firmLine}>{firmLine}</Text>
      <Text style={styles.title}>Portal Narrative Content Pack \u2014 FY{claim.fy_year}</Text>
      <Text style={styles.subtitle}>Generated {generated_at}</Text>
      <View style={styles.claimMetaRow}>
        <Text style={styles.claimMetaLabel}>Claimant</Text>
        <Text style={styles.claimMetaValue}>{claimantLine}</Text>
      </View>
      <View style={styles.claimMetaRow}>
        <Text style={styles.claimMetaLabel}>Claim ID</Text>
        <Text style={styles.claimMetaValue}>\u2026{claim.id.slice(-8)}</Text>
      </View>
    </View>
  );
}

function SkeletonNotice(): React.ReactElement {
  return (
    <View style={styles.skeletonNotice}>
      <Text style={styles.skeletonNoticeText}>
        SKELETON \u2014 Full narrative content pending future sprint implementation.
      </Text>
    </View>
  );
}

function NarrativeSections(props: { input: PortalNarrativePackInput }): React.ReactElement {
  const { narrative_sections } = props.input;

  if (narrative_sections.length === 0) {
    return (
      <View>
        <Text style={styles.sectionContent}>No narrative sections defined.</Text>
      </View>
    );
  }

  return (
    <View>
      {narrative_sections.map((section, idx) => (
        <View key={`${section.section_kind}-${idx}`}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          <Text style={styles.sectionContent}>{section.content_placeholder}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Render function
// ---------------------------------------------------------------------------

/** Pure-function renderer. Returns a Uint8Array of the raw PDF bytes. */
export async function renderPortalNarrativePackPdf(
  input: PortalNarrativePackInput,
): Promise<Uint8Array> {
  const { firm, subject_tenant, claim } = input;
  const claimantLine = subject_tenant.abn
    ? `${subject_tenant.name} \u00B7 ABN ${subject_tenant.abn}`
    : subject_tenant.name;
  const footerText = `Portal Narrative Pack \u00B7 Claim FY${claim.fy_year} \u00B7 ${firm.name} \u2192 ${claimantLine}`;

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <ForensicHeader input={input} />
        <TitleBlock input={input} />
        <SkeletonNotice />
        <NarrativeSections input={input} />
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
