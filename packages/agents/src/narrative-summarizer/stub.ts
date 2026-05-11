import type {
  NarrativeSummarizer,
  NarrativeSummarizerInput,
  NarrativeSummarizerOutput,
} from './types.js';

/**
 * Stub narrative summarizer for use in tests and CI environments.
 *
 * Returns a deterministic result derived from the input so tests can
 * exercise the narrative-approval flow without an API key. The stub
 * narrative is deliberately templated so it's obviously not real prose.
 */
export class StubNarrativeSummarizer implements NarrativeSummarizer {
  // eslint-disable-next-line @typescript-eslint/require-await
  async summarize(input: NarrativeSummarizerInput): Promise<NarrativeSummarizerOutput> {
    const coreCount = input.proposed_activities.filter((a) => a.kind === 'core').length;
    const supportingCount = input.proposed_activities.filter((a) => a.kind === 'supporting').length;
    const invoiceCount = input.proposed_invoices.length;
    const documentCount = input.document_summaries.length;
    const totalAud = input.proposed_invoices.reduce((sum, inv) => sum + inv.total_aud, 0);

    const activityNames = input.proposed_activities
      .slice(0, 2)
      .map((a) => a.name)
      .join('; ');

    const narrative =
      `Across ${documentCount} document${documentCount !== 1 ? 's' : ''}, this R&D effort for ` +
      `${input.subject_tenant_name} proposes ${coreCount} core activit${coreCount !== 1 ? 'ies' : 'y'} ` +
      `and ${supportingCount} supporting activit${supportingCount !== 1 ? 'ies' : 'y'}` +
      (activityNames ? ` including ${activityNames}` : '') +
      `. Technical uncertainties are subject to R&DTI review under §355-25 ITAA 1997. ` +
      `Proposed expenditure of $${totalAud.toFixed(2)} AUD covers ${invoiceCount} vendor invoice${invoiceCount !== 1 ? 's' : ''}.`;

    return {
      narrative,
      total_aud: totalAud,
      core_count: coreCount,
      supporting_count: supportingCount,
      invoice_count: invoiceCount,
      document_count: documentCount,
    };
  }
}
