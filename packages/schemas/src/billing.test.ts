import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlanTierEnum,
  SubscriptionStatusEnum,
  DeliveryKindEnum,
  BillingModeEnum,
  TrialStatusEnum,
} from './billing.js';

// ---------------------------------------------------------------------------
// PlanTierEnum
// ---------------------------------------------------------------------------

test('PlanTierEnum: "standard" parses', () => {
  assert.equal(PlanTierEnum.parse('standard'), 'standard');
});

test('PlanTierEnum: "founding_partner" parses', () => {
  assert.equal(PlanTierEnum.parse('founding_partner'), 'founding_partner');
});

test('PlanTierEnum: unknown value rejects', () => {
  assert.throws(() => PlanTierEnum.parse('enterprise'));
});

// ---------------------------------------------------------------------------
// SubscriptionStatusEnum
// ---------------------------------------------------------------------------

test('SubscriptionStatusEnum: "trialing" parses', () => {
  assert.equal(SubscriptionStatusEnum.parse('trialing'), 'trialing');
});

test('SubscriptionStatusEnum: "active" parses', () => {
  assert.equal(SubscriptionStatusEnum.parse('active'), 'active');
});

test('SubscriptionStatusEnum: "past_due" parses', () => {
  assert.equal(SubscriptionStatusEnum.parse('past_due'), 'past_due');
});

test('SubscriptionStatusEnum: "cancelled" parses', () => {
  assert.equal(SubscriptionStatusEnum.parse('cancelled'), 'cancelled');
});

test('SubscriptionStatusEnum: "incomplete" parses', () => {
  assert.equal(SubscriptionStatusEnum.parse('incomplete'), 'incomplete');
});

test('SubscriptionStatusEnum: unknown value rejects', () => {
  assert.throws(() => SubscriptionStatusEnum.parse('expired'));
});

// ---------------------------------------------------------------------------
// DeliveryKindEnum
// ---------------------------------------------------------------------------

test('DeliveryKindEnum: "quarterly_assurance" parses', () => {
  assert.equal(DeliveryKindEnum.parse('quarterly_assurance'), 'quarterly_assurance');
});

test('DeliveryKindEnum: "annual_claim" parses', () => {
  assert.equal(DeliveryKindEnum.parse('annual_claim'), 'annual_claim');
});

test('DeliveryKindEnum: unknown value rejects', () => {
  assert.throws(() => DeliveryKindEnum.parse('monthly'));
});

// ---------------------------------------------------------------------------
// BillingModeEnum
// ---------------------------------------------------------------------------

test('BillingModeEnum: "trial" parses', () => {
  assert.equal(BillingModeEnum.parse('trial'), 'trial');
});

test('BillingModeEnum: "paid" parses', () => {
  assert.equal(BillingModeEnum.parse('paid'), 'paid');
});

test('BillingModeEnum: "archived" parses', () => {
  assert.equal(BillingModeEnum.parse('archived'), 'archived');
});

test('BillingModeEnum: unknown value rejects', () => {
  assert.throws(() => BillingModeEnum.parse('free'));
});

// ---------------------------------------------------------------------------
// TrialStatusEnum
// ---------------------------------------------------------------------------

test('TrialStatusEnum: "active" parses', () => {
  assert.equal(TrialStatusEnum.parse('active'), 'active');
});

test('TrialStatusEnum: "expired" parses', () => {
  assert.equal(TrialStatusEnum.parse('expired'), 'expired');
});

test('TrialStatusEnum: "converted" parses', () => {
  assert.equal(TrialStatusEnum.parse('converted'), 'converted');
});

test('TrialStatusEnum: unknown value rejects', () => {
  assert.throws(() => TrialStatusEnum.parse('pending'));
});
