#!/usr/bin/env tsx
/**
 * Full reset of a tenant's working data — true "start fresh."
 *
 * Wipes (leaf-first to respect FKs):
 *   - narrative_draft_version
 *   - narrative_draft
 *   - event              (all evidence + ARTEFACT_LINKED chain events)
 *   - media_artefact     (uploaded files metadata)
 *   - expenditure
 *   - activity
 *   - claim              (with workflow_state, agree timestamps)
 *
 * Keeps:
 *   - subject_tenant     (client firms)
 *   - project            (R&D project shells)
 *   - tenant / user / firm_member (no-op here)
 *
 * Note: there is no `artefact_link` table — bindings are chain events.
 *
 * Wrapped in a transaction; partial failure rolls back.
 *
 * NOT for production. Dev/test only.
 */
import { privilegedSql } from '@cpa/db/client';

const TENANT_ID = process.argv[2];
if (!TENANT_ID || !/^[0-9a-f-]{36}$/i.test(TENANT_ID)) {
  console.error('Usage: tsx tools/scripts/reset-tenant-data.ts <tenant-uuid>');
  process.exit(1);
}

(async () => {
  // Probe what we're about to wipe.
  const probe = await privilegedSql<{ table_name: string; n: number }[]>`
    SELECT 'claim' AS table_name, COUNT(*)::int AS n FROM claim WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'activity', COUNT(*)::int FROM activity WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'event', COUNT(*)::int FROM event WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'media_artefact', COUNT(*)::int FROM media_artefact WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'narrative_draft', COUNT(*)::int FROM narrative_draft WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'narrative_draft_version', COUNT(*)::int FROM narrative_draft_version WHERE tenant_id = ${TENANT_ID}
    UNION ALL SELECT 'expenditure', COUNT(*)::int FROM expenditure WHERE tenant_id = ${TENANT_ID}
  `;
  console.log(`Pre-wipe row counts in tenant ${TENANT_ID}:`);
  for (const r of probe) console.log(`  ${r.table_name.padEnd(25)} ${r.n}`);

  const result = await privilegedSql.begin(async (tx) => {
    // 1. narrative_draft_version → narrative_draft (tenant-scoped)
    const ndv = await tx`DELETE FROM narrative_draft_version WHERE tenant_id = ${TENANT_ID}`;
    const nd = await tx`DELETE FROM narrative_draft WHERE tenant_id = ${TENANT_ID}`;
    // 2. event (chain rows incl. ARTEFACT_LINKED, classification, etc.)
    const ev = await tx`DELETE FROM event WHERE tenant_id = ${TENANT_ID}`;
    // 3. media_artefact (uploaded files; event payloads may reference these in jsonb, no FK)
    const ma = await tx`DELETE FROM media_artefact WHERE tenant_id = ${TENANT_ID}`;
    // 4. expenditure
    const ex = await tx`DELETE FROM expenditure WHERE tenant_id = ${TENANT_ID}`;
    // 5. activity
    const ac = await tx`DELETE FROM activity WHERE tenant_id = ${TENANT_ID}`;
    // 6. claim
    const cl = await tx`DELETE FROM claim WHERE tenant_id = ${TENANT_ID}`;

    return {
      narrative_draft_version: ndv.count,
      narrative_draft: nd.count,
      event: ev.count,
      media_artefact: ma.count,
      expenditure: ex.count,
      activity: ac.count,
      claim: cl.count,
    };
  });

  console.log('Deleted row counts:');
  console.log(JSON.stringify(result, null, 2));
  console.log('Preserved: subject_tenant, project, tenant, user, firm_member');
  await privilegedSql.end();
})().catch((err) => {
  console.error('Reset failed (rolled back):', err);
  process.exit(3);
});
