import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '@cpa/db/client';
import { findOrCreateUser } from './users.js';

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
  assert.equal(user.email, 't5-existing@example.com', 'email is NOT overwritten on subsequent login');
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
