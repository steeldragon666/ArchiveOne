import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { ReactNode } from 'react';

/**
 * Shared layout for all P4-generated PDFs.
 *
 * - Header: title + claimant name + fiscal year
 * - Body: caller-provided children
 * - Footer: page number, generated-at timestamp, content hash (truncated)
 *
 * The content hash links the PDF back to its source data — auditors can
 * verify reproducibility by recomputing `contentHash(inputData)` and
 * comparing the prefix shown on every page.
 *
 * Page size A4 (matches AusIndustry portal expectations and KPMG
 * letterhead conventions).
 *
 * TODO(P4-followup): a `ReportDocumentLayout` for the report-style PDFs
 * — A8's `activity-application.tsx`, C7's `claim-summary.tsx`, and C9's
 * `apportionment-report.tsx` each maintain their own `<Document><Page>`
 * tree. The sibling JSDoc on `claim-summary.tsx` documented C7 as the
 * second instance and predicted that "if a sibling PDF type lands later
 * that *also* needs the C7 footer ('Page X of Y · …'), we can promote a
 * `ClaimDocumentLayout` then." C9 IS that third instance — and the C9
 * spec made the call explicit:
 *
 *   "Three is the inflection point. If you factor early (before
 *    instance 3), you abstract the wrong shape. If you factor late
 *    (instance 4+), the duplication compounds."
 *
 * After implementing C9 and putting all three side-by-side, the
 * extraction was DEFERRED. The reasoning:
 *
 *   C7 and C9 share substantial structure — single centered "Page X of
 *   Y · {context}" footer, two-line "{firm} · ABN" + "{title}" +
 *   "Generated …" header, plain-grey palette (#cccccc / #666666).
 *
 *   A8 diverges meaningfully:
 *     - footer is a THREE-CELL flex row (attribution / page / time),
 *       not a single centered line
 *     - palette is slate/zinc (#cbd5e1 / #64748b / #0f172a), not plain
 *       grey — A8's body has chips and tables that lean on those
 *       specific tints
 *     - header splits firm name and ABN into two lines, not a single
 *       "{name} · ABN {abn}" join
 *
 *   Forcing A8 into a shared layout would require either (a) changing
 *   A8's visual output to match C7/C9's footer style (regressing A8's
 *   tests, which the C9 spec explicitly forbids — "ensuring no
 *   behaviour change"), or (b) adding a `footerVariant: 'compact' |
 *   'three-cell'` + `palette: 'slate' | 'grey'` prop set that
 *   re-introduces all the per-caller configuration the abstraction was
 *   meant to remove. At that point the "shared layout" is providing
 *   only `<Document><Page size="A4" style={...}>` — three lines that
 *   each caller inlines without strain.
 *
 *   So the duplication that actually exists across all three is small
 *   (the outer `<Document><Page>` wrap + page-bottom padding for the
 *   fixed footer). The duplication that LOOKS large (header + footer
 *   structure) is actually two clusters: A8 alone, and C7+C9 together.
 *   Two-caller abstractions in this codebase are premature.
 *
 * The trigger for revisiting:
 *   - a fourth report-style PDF whose footer is structurally similar
 *     to C7/C9's (single centered line) — at that point C7+C9+the new
 *     caller form a 3-caller cluster and can share a `ReportDocumentLayout`
 *     with the same "two-line firm+ABN, doc title, generated_at" header
 *     and "single centered Page X of Y" footer
 *   - OR a refactor that reconciles A8's slate/zinc palette with
 *     C7/C9's grey one (e.g. a design-tokens pass on packages/ui-tokens),
 *     at which point the 3-cell vs single-line footer becomes the only
 *     remaining divergence and can be modelled as a slot.
 */
export type DocumentLayoutProps = {
  title: string;
  claimantName: string;
  fiscalYear: number;
  contentHashHex: string;
  generatedAt: Date;
  children: ReactNode;
};

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },
  header: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 8,
  },
  title: { fontSize: 16, fontWeight: 'bold' },
  subtitle: { fontSize: 10, color: '#666666', marginTop: 4 },
  content: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#cccccc',
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: '#666666',
  },
});

export function DocumentLayout(props: DocumentLayoutProps) {
  const hashShort = props.contentHashHex.slice(0, 12);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{props.title}</Text>
          <Text style={styles.subtitle}>
            {props.claimantName} · FY{props.fiscalYear}
          </Text>
        </View>
        <View style={styles.content}>{props.children}</View>
        <View style={styles.footer} fixed>
          <Text>Generated {props.generatedAt.toISOString()}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text>Content hash: {hashShort}…</Text>
        </View>
      </Page>
    </Document>
  );
}
