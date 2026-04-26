import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, privilegedSql } from '@cpa/db/client';
import { findOrCreateUser, lookupActiveTenant } from './users.js';

const USER_NEW_EXTERNAL_ID = 'microsoft:test-t5-new-oid';
const USER_EXISTING_EXTERNAL_ID = 'microsoft:test-t5-existing-oid';
const USER_EXISTING_ID = '00000000-0000-4000-8000-000000000051';

before(async () => {
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id)
            VALUES (${USER_EXISTING_ID}, 't5-existing@example.com', 'microsoft', ${USER_EXISTING_EXTERNAL_ID})`;
});

after(async () => {
  await sql`DELETE FROM "user" WHERE external_id LIKE 'microsoft:test-t5-%'`;
  await sql.end();
  await privilegedSql.end();
});

test('findOrCreateUser: creates a new user when external_id unseen', async () => {
  const user = await findOrCreateUser({
    primaryIdp: 'microsoft',
    externalId: USER_NEW_EXTERNAL_ID,
    email: 't5-new@example.com',
    displayName: 'New T5 User',
  });
  assert.match(
    user.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'is uuid v4',
  );
  assert.equal(user.email, 't5-new@example.com');
  assert.equal(user.displayName, 'New T5 User');
  assert.equal(user.primaryIdp, 'microsoft');
  assert.equal(user.externalId, USER_NEW_EXTERNAL_ID);
});

test('findOrCreateUser: finds existing user by (primaryIdp, externalId); does NOT update email', async () => {
  const user = await findOrCreateUser({
    primaryIdp: 'microsoft',
    externalId: USER_EXISTING_EXTERNAL_ID,
    email: 'updated-on-login@example.com',
    displayName: 'Existing T5 User',
  });
  assert.equal(user.id, USER_EXISTING_ID);
  assert.equal(
    user.email,
    't5-existing@example.com',
    'email is NOT overwritten on subsequent login',
  );
});

test('findOrCreateUser: concurrent calls for same external_id resolve to same user (race-free)', async () => {
  const RACE_EXTERNAL_ID = 'microsoft:test-t6-race-oid';
  try {
    const [a, b] = await Promise.all([
      findOrCreateUser({
        primaryIdp: 'microsoft',
        externalId: RACE_EXTERNAL_ID,
        email: 'race@example.com',
        displayName: 'Race A',
      }),
      findOrCreateUser({
        primaryIdp: 'microsoft',
        externalId: RACE_EXTERNAL_ID,
        email: 'race@example.com',
        displayName: 'Race B',
      }),
    ]);
    assert.equal(a.id, b.id, 'both calls resolve to same user_id');
  } finally {
    await sql`DELETE FROM "user" WHERE external_id = ${RACE_EXTERNAL_ID}`;
  }
});

test('findOrCreateUser: bumps last_login_at on existing user', async () => {
  // postgres-js may return timestamptz as string OR Date depending on parser
  // registration timing in this workspace; normalise via new Date(...).
  const beforeRows = await sql<{ last_login_at: string | Date | null }[]>`
    SELECT last_login_at FROM "user" WHERE id = ${USER_EXISTING_ID}
  `;
  // Brief delay so timestamps differ
  await new Promise((r) => setTimeout(r, 50));
  await findOrCreateUser({
    primaryIdp: 'microsoft',
    externalId: USER_EXISTING_EXTERNAL_ID,
    email: 't5-existing@example.com',
    displayName: null,
  });
  const afterRows = await sql<{ last_login_at: string | Date | null }[]>`
    SELECT last_login_at FROM "user" WHERE id = ${USER_EXISTING_ID}
  `;
  const beforeMs = beforeRows[0]?.last_login_at
    ? new Date(beforeRows[0].last_login_at).getTime()
    : null;
  const afterMs = afterRows[0]?.last_login_at
    ? new Date(afterRows[0].last_login_at).getTime()
    : null;
  assert.notEqual(beforeMs, afterMs, 'last_login_at advances');
});

test('lookupActiveTenant: returns is_default tenant first; lists all memberships', async () => {
  const TENANT_A = '00000000-0000-4000-8000-000000000a01';
  const TENANT_B = '00000000-0000-4000-8000-000000000b01';
  const USER_T6 = '00000000-0000-4000-8000-000000000061';
  await sql`INSERT INTO tenant (id, name, slug, primary_idp)
            VALUES (${TENANT_A}, 'T6 Firm A', 't6-firm-a', 'mixed'),
                   (${TENANT_B}, 'T6 Firm B', 't6-firm-b', 'mixed')`;
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id)
            VALUES (${USER_T6}, 't6-multi@example.com', 'microsoft', 'microsoft:test-t6-multi')`;
  // Insert tenant_user rows via privilegedSql (RLS-bypass) — same client used by lookupActiveTenant
  await privilegedSql`INSERT INTO tenant_user (id, tenant_id, user_id, role, is_default)
                       VALUES (gen_random_uuid(), ${TENANT_A}, ${USER_T6}, 'consultant', false),
                              (gen_random_uuid(), ${TENANT_B}, ${USER_T6}, 'admin', true)`;
  try {
    const result = await lookupActiveTenant(USER_T6);
    assert.equal(result.activeTenantId, TENANT_B, 'is_default=true wins');
    assert.equal(result.activeRole, 'admin');
    assert.equal(result.availableTenants.length, 2);
    const a = result.availableTenants.find((t) => t.tenantId === TENANT_A);
    const b = result.availableTenants.find((t) => t.tenantId === TENANT_B);
    assert.ok(a && b);
    assert.equal(b?.role, 'admin');
    assert.equal(b?.isDefault, true);
    assert.equal(a?.role, 'consultant');
    assert.equal(a?.isDefault, false);
  } finally {
    await privilegedSql`DELETE FROM tenant_user WHERE user_id = ${USER_T6}`;
    await sql`DELETE FROM "user" WHERE id = ${USER_T6}`;
    await sql`DELETE FROM tenant WHERE id IN (${TENANT_A}, ${TENANT_B})`;
  }
});

test('lookupActiveTenant: returns nulls + empty array for user with no memberships', async () => {
  const FRESH = '00000000-0000-4000-8000-000000000067';
  await sql`INSERT INTO "user" (id, email, primary_idp, external_id)
            VALUES (${FRESH}, 't6-fresh@example.com', 'google', 'google:test-t6-fresh')`;
  try {
    const result = await lookupActiveTenant(FRESH);
    assert.equal(result.activeTenantId, null);
    assert.equal(result.activeRole, null);
    assert.deepEqual(result.availableTenants, []);
  } finally {
    await sql`DELETE FROM "user" WHERE id = ${FRESH}`;
  }
});
