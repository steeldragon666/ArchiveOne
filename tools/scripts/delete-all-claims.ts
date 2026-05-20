#!/usr/bin/env tsx
/**
 * Wipe all claims for one tenant.
 *
 * Activities, events, narrative_drafts all stay (they're project-scoped,
 * not claim-scoped). Only direct claim descendants are removed:
 *  - expenditure (claim_id added in migration 0020)
 *  - claim itself (carries workflow_state, agree timestamps)
 *
 * Wrapped in a transaction; partial failure rolls back cleanly.
 */
import { privilegedSql } from '@cpa/db/client';

const TENANT_ID = process.argv[2];
if (!TENANT_ID || !/^[0-9a-f-]{36}$/i.test(TENANT_ID)) {
  console.error('Usage: tsx tools/scripts/delete-all-claims.ts <tenant-uuid>');
  process.exit(1);
}

(async () => {
  // Probe what we're about to delete.
  const probe = await privilegedSql<{ id: string; fiscal_year: number; stage: string }[]>`
    SELECT id::text, fiscal_year, stage
      FROM claim
     WHERE tenant_id = ${TENANT_ID}
     ORDER BY created_at ASC
  `;
  console.log(`Found ${probe.length} claims to delete in tenant ${TENANT_ID}:`);
  for (const c of probe) {
    console.log(`  - ${c.id}  FY${c.fiscal_year}  stage=${c.stage}`);
  }
  if (probe.length === 0) {
    console.log('Nothing to do.');
    await privilegedSql.end();
    return;
  }

  const result = await privilegedSql.begin(async (tx) => {
    const claimIds = probe.map((c) => c.id);

    // 1. expenditure (claim_id)
    const exp = await tx`
      DELETE FROM expenditure WHERE claim_id = ANY(${claimIds}::uuid[])
    `;

    // 2. claim
    const cl = await tx`
      DELETE FROM claim WHERE tenant_id = ${TENANT_ID}
    `;

    return { expenditure: exp.count, claim: cl.count };
  });

  console.log('Deleted row counts:');
  console.log(JSON.stringify(result, null, 2));
  await privilegedSql.end();
})().catch((err) => {
  console.error('Cascade delete failed (rolled back):', err);
  process.exit(3);
});
