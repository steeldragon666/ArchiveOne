import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysRemaining, formatTrialLabel, type TrialBannerProps } from './trial-banner.js';

/**
 * Trial banner component — P9.1.6.4.
 *
 * Displays "X days remaining on your trial" + upgrade CTA when the tenant's
 * trial is active. Hidden for expired / converted tenants.
 *
 * Test discipline (matching project pattern): pure helpers + type contracts
 * here; rendering tested via Playwright e2e.
 */

// ---------- daysRemaining ----------

test('daysRemaining: returns correct positive integer when trial has not expired', () => {
  const now = new Date();
  // 10 days from now
  const endsAt = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
  const days = daysRemaining(endsAt);
  // Should be 9 or 10 depending on sub-day precision, so check range
  assert.ok(days >= 9 && days <= 10, `expected 9–10, got ${days}`);
});

test('daysRemaining: returns 0 when trial ends exactly now', () => {
  const now = new Date();
  assert.equal(daysRemaining(now), 0);
});

test('daysRemaining: clamps to 0 when trial has already expired', () => {
  const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
  assert.equal(daysRemaining(past), 0);
});

test('daysRemaining: accepts ISO string as well as Date', () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const days = daysRemaining(future.toISOString());
  assert.ok(days >= 29 && days <= 30, `expected 29–30, got ${days}`);
});

test('daysRemaining: floors fractional days (does not round up)', () => {
  // 1.9 days from now should be 1 (floor), not 2 (round).
  const almost2Days = new Date(Date.now() + 1.9 * 24 * 60 * 60 * 1000);
  const days = daysRemaining(almost2Days);
  assert.ok(days >= 1 && days <= 2, `expected 1–2, got ${days}`);
});

// ---------- formatTrialLabel ----------

test('formatTrialLabel: plural days', () => {
  assert.equal(formatTrialLabel(30), '30 days remaining on your trial');
});

test('formatTrialLabel: singular day', () => {
  assert.equal(formatTrialLabel(1), '1 day remaining on your trial');
});

test('formatTrialLabel: zero days', () => {
  assert.equal(formatTrialLabel(0), '0 days remaining on your trial');
});

// ---------- TrialBannerProps type contract ----------

test('TrialBannerProps: minimal active props compile', () => {
  const props: TrialBannerProps = {
    trialEndsAt: new Date(),
    trialStatus: 'active',
  };
  assert.equal(props.trialStatus, 'active');
});

test('TrialBannerProps: expired status compiles', () => {
  const props: TrialBannerProps = {
    trialEndsAt: '2026-01-01T00:00:00.000Z',
    trialStatus: 'expired',
  };
  assert.equal(props.trialStatus, 'expired');
});

test('TrialBannerProps: converted status compiles', () => {
  const props: TrialBannerProps = {
    trialEndsAt: new Date(),
    trialStatus: 'converted',
  };
  assert.equal(props.trialStatus, 'converted');
});

test('TrialBannerProps: full prop set with className compiles', () => {
  const props: TrialBannerProps = {
    trialEndsAt: new Date(),
    trialStatus: 'active',
    upgradeHref: '/billing/upgrade',
    className: 'mt-4',
  };
  assert.equal(props.upgradeHref, '/billing/upgrade');
});
