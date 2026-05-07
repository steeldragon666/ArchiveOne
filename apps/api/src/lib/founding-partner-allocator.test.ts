import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql, privilegedSql } from '@cpa/db/client';
import { tryClaimFoundingPartnerSlot } from './founding-partner-allocator.js';

/**
 * Founding-partner slot allocator — P9.1.8.
 *
 * Test namespace: 000000098xxx
 * Two test tenants:
 *   TENANT_A — primary requester
 *   TENANT_B — concurrent requester (concurrency test only)
 */

const TENANT_A = '00000000-0000-4000-8000-000000098001';
const TENANT_B = '00000000-0000-4000-8000-000000098002';

// Fixed UUIDs for ad-hoc test slots (inserted / deleted per test).
const SLOT_SINGLE = '00000000-0000-4000-8000-000000098011';
const SLOT_LAST = '00000000-0000-4000-8000-000000098012';

const ALL_TENANTS = [TENANT_A, TENANT_B];
const ALL_SLOTS = [SLOT_SINGLE, SLOT_LAST];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const cleanup = async (): Promise<void> => {
  await privilegedSql`DELETE FROM founding_partner_slots WHERE id = ANY(${ALL_SLOTS})`;
  await privilegedSql`DELETE FROM founding_partner_slots WHERE claimed_by_tenant_id = ANY(${ALL_TENANTS})`;
  await sql`DELETE FROM tenant WHERE id = ANY(${ALL_TENANTS})`;
};

before(async () => {
  await cleanup();

  await sql`
    INSERT INTO tenant (id, name, slug, primary_idp)
    VALUES
      (${TENANT_A}, 'FP Test Tenant A', 'fp-test-a-p9181', 'mixed'),
      (${TENANT_B}, 'FP Test Tenant B', 'fp-test-b-p9181', 'mixed')
  `;
});

after(async () => {
  await cleanup();
  await sql.end();
  await privilegedSql.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('founding-partner-allocator: claim succeeds when slot available', async () => {
  await privilegedSql`INSERT INTO founding_partner_slots (id) VALUES (${SLOT_SINGLE})`;
  try {
    const claimed = await tryClaimFoundingPartnerSlot(TENANT_A);
    assert.equal(claimed, true, 'should return true when an unclaimed slot exists');

    // Verify the slot is now claimed.
    const rows = await privilegedSql<{ claimed_by_tenant_id: string }[]>`
      SELECT claimed_by_tenant_id FROM founding_partner_slots WHERE id = ${SLOT_SINGLE}
    `;
    assert.equal(rows[0]?.claimed_by_tenant_id, TENANT_A);
  } finally {
    await privilegedSql`DELETE FROM founding_partner_slots WHERE id = ${SLOT_SINGLE}`;
  }
});

test('founding-partner-allocator: claim returns false when no slot available', async () => {
  // Ensure no unclaimed slots for these tenants exist.
  const claimed = await tryClaimFoundingPartnerSlot(TENANT_A);
  assert.equal(claimed, false, 'should return false when no unclaimed slot exists');
});

test('founding-partner-allocator: two concurrent claims on last slot — exactly one wins', async () => {
  // Insert exactly one unclaimed slot.
  await privilegedSql`INSERT INTO founding_partner_slots (id) VALUES (${SLOT_LAST})`;
  try {
    // Fire both claims simultaneously.
    const [resultA, resultB] = await Promise.all([
      tryClaimFoundingPartnerSlot(TENANT_A),
      tryClaimFoundingPartnerSlot(TENANT_B),
    ]);

    const winners = [resultA, resultB].filter(Boolean);
    assert.equal(winners.length, 1, 'exactly one of two concurrent claims should succeed');

    // The claimed slot must be owned by exactly one tenant.
    const rows = await privilegedSql<{ claimed_by_tenant_id: string }[]>`
      SELECT claimed_by_tenant_id FROM founding_partner_slots WHERE id = ${SLOT_LAST}
    `;
    const owner = rows[0]?.claimed_by_tenant_id;
    assert.ok(
      owner === TENANT_A || owner === TENANT_B,
      `slot must be owned by A or B; got ${owner}`,
    );
  } finally {
    await privilegedSql`DELETE FROM founding_partner_slots WHERE id = ${SLOT_LAST}`;
  }
});
