import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialDay23ReminderEmail } from './trial-day-23-reminder.js';

test('trialDay23ReminderEmail: returns correct subject', () => {
  const result = trialDay23ReminderEmail({
    name: 'Alice',
    firmName: 'Acme R&D',
    daysRemaining: 7,
    upgradeUrl: 'https://app.example.com/billing/upgrade',
  });
  assert.ok(result.subject.includes('7'), 'subject must mention days remaining');
  assert.ok(result.subject.toLowerCase().includes('trial'), 'subject must mention trial');
});

test('trialDay23ReminderEmail: HTML contains name and firm name', () => {
  const result = trialDay23ReminderEmail({
    name: 'Bob',
    firmName: 'Beta Corp',
    daysRemaining: 7,
    upgradeUrl: 'https://app.example.com/billing/upgrade',
  });
  assert.ok(result.html.includes('Bob'), 'HTML must include name');
  assert.ok(result.html.includes('Beta Corp'), 'HTML must include firm name');
});

test('trialDay23ReminderEmail: HTML contains upgrade URL', () => {
  const upgradeUrl = 'https://app.example.com/billing/upgrade?ref=email';
  const result = trialDay23ReminderEmail({
    name: 'Carol',
    firmName: 'Gamma Ltd',
    daysRemaining: 7,
    upgradeUrl,
  });
  assert.ok(result.html.includes(upgradeUrl), 'HTML must include upgrade URL');
  assert.ok(result.text.includes(upgradeUrl), 'text must include upgrade URL');
});

test('trialDay23ReminderEmail: plain text contains days remaining', () => {
  const result = trialDay23ReminderEmail({
    name: 'Dave',
    firmName: 'Delta Pty',
    daysRemaining: 7,
    upgradeUrl: 'https://app.example.com/billing/upgrade',
  });
  assert.ok(result.text.includes('7'), 'text must include days remaining');
});

test('trialDay23ReminderEmail: escapes special chars in name', () => {
  const result = trialDay23ReminderEmail({
    name: '<script>alert(1)</script>',
    firmName: 'Safe Corp',
    daysRemaining: 7,
    upgradeUrl: 'https://app.example.com/billing/upgrade',
  });
  assert.ok(!result.html.includes('<script>'), 'HTML must escape script tags');
});
