/**
 * Historical rejection corpus entry from regulatory_event rows where
 * classification_kind IN ('aat_decision','art_decision') and severity
 * indicates rejection.
 *
 * STUB: returns empty array until D.8 creates the regulatory_event table
 * and the follow-up session populates the backfill.
 */
export interface HistoricalRejection {
  event_id: string;
  title: string;
  content: string;
  classification_kind: string;
  published_at: string;
}

/**
 * Load historical rejection corpus for similarity comparison.
 *
 * Returns an empty array until D.8 creates the regulatory_event and
 * regulatory_source tables. The follow-up session that implements D.8
 * will light up this query.
 *
 * @param _tenantId - Tenant scope (unused until D.8)
 */
export function loadHistoricalRejections(_tenantId: string): Promise<HistoricalRejection[]> {
  // STUB: regulatory_event table does not exist yet (D.8).
  // When D.8 lands, replace with:
  //   const rows = await executor`
  //     SELECT id AS event_id, raw_title AS title, raw_content AS content,
  //            classification_kind, published_at
  //     FROM regulatory_event
  //     WHERE classification_kind IN ('aat_decision', 'art_decision')
  //       AND classification_severity IN ('high', 'medium')
  //   `;
  //   return rows as HistoricalRejection[];
  void _tenantId; // suppress unused warning
  return Promise.resolve([]);
}
