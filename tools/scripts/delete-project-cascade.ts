#!/usr/bin/env tsx
/**
 * Cascading delete of a project and all its descendants.
 *
 * Used for dev/test cleanup. NOT for production — this hard-deletes
 * audit-relevant chain events; do NOT run against any tenant whose data
 * matters for R&DTI compliance.
 *
 * Order is leaf-first to satisfy FK constraints even if ON DELETE CASCADE
 * isn't declared at the schema level. The whole thing is wrapped in
 * sql.begin so a partial failure rolls back cleanly.
 */
import { privilegedSql } from '@cpa/db/client';

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID || !/^[0-9a-f-]{36}$/i.test(PROJECT_ID)) {
  console.error('Usage: tsx tools/scripts/delete-project-cascade.ts <project-uuid>');
  process.exit(1);
}

(async () => {
  // Resolve the project name + parent for the audit trail before we nuke.
  const probe = await privilegedSql<{ id: string; name: string; tenant_id: string }[]>`
    SELECT id::text, name, tenant_id::text
      FROM project
     WHERE id = ${PROJECT_ID}
  `;
  if (probe.length === 0) {
    console.error(`No project found with id=${PROJECT_ID}`);
    process.exit(2);
  }
  console.log(
    `Deleting project: ${probe[0]!.name} (${probe[0]!.id}) in tenant ${probe[0]!.tenant_id}`,
  );

  const result = await privilegedSql.begin(async (tx) => {
    // Activities for this project (we'll need their ids for narrative_draft + artefact_link)
    const activities = await tx<{ id: string }[]>`
      SELECT id::text FROM activity WHERE project_id = ${PROJECT_ID}
    `;
    const activityIds = activities.map((a) => a.id);

    // Claims for this project
    const claims = await tx<{ id: string }[]>`
      SELECT id::text FROM claim WHERE project_id = ${PROJECT_ID}
    `;
    const claimIds = claims.map((c) => c.id);

    console.log(`  Found ${activityIds.length} activities, ${claimIds.length} claims`);

    // 1. narrative_draft_version -> narrative_draft (per activity)
    let nDraftVersions = 0;
    let nDrafts = 0;
    if (activityIds.length > 0) {
      const ndv = await tx`
        DELETE FROM narrative_draft_version
         WHERE narrative_draft_id IN (
           SELECT id FROM narrative_draft WHERE activity_id = ANY(${activityIds}::uuid[])
         )
      `;
      nDraftVersions = ndv.count;
      const nd = await tx`
        DELETE FROM narrative_draft WHERE activity_id = ANY(${activityIds}::uuid[])
      `;
      nDrafts = nd.count;
    }

    // 2. artefact_link (references both event and activity)
    let nLinks = 0;
    if (activityIds.length > 0) {
      const link = await tx`
        DELETE FROM artefact_link WHERE activity_id = ANY(${activityIds}::uuid[])
      `;
      nLinks = link.count;
    }

    // 3. event (chain rows for this project)
    const evt = await tx`
      DELETE FROM event WHERE project_id = ${PROJECT_ID}
    `;
    const nEvents = evt.count;

    // 4. expenditure (per claim — claim_id was added in migration 0020)
    let nExpenditures = 0;
    if (claimIds.length > 0) {
      const exp = await tx`
        DELETE FROM expenditure WHERE claim_id = ANY(${claimIds}::uuid[])
      `;
      nExpenditures = exp.count;
    }

    // 5. claim
    const cl = await tx`
      DELETE FROM claim WHERE project_id = ${PROJECT_ID}
    `;
    const nClaims = cl.count;

    // 6. activity
    const act = await tx`
      DELETE FROM activity WHERE project_id = ${PROJECT_ID}
    `;
    const nActivities = act.count;

    // 7. project
    const proj = await tx`
      DELETE FROM project WHERE id = ${PROJECT_ID}
    `;
    const nProjects = proj.count;

    return {
      narrative_draft_version: nDraftVersions,
      narrative_draft: nDrafts,
      artefact_link: nLinks,
      event: nEvents,
      expenditure: nExpenditures,
      claim: nClaims,
      activity: nActivities,
      project: nProjects,
    };
  });

  console.log('Deleted row counts:');
  console.log(JSON.stringify(result, null, 2));
  await privilegedSql.end();
})().catch((err) => {
  console.error('Cascade delete failed (rolled back):', err);
  process.exit(3);
});
