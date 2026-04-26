import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePkce, generateState, generateNonce } from './oidc.js';

test('generatePkce: returns verifier 43-128 chars and S256 challenge', () => {
  const { verifier, challenge, method } = generatePkce();
  assert.equal(method, 'S256');
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
});

test('generatePkce: each call produces a new verifier', () => {
  const a = generatePkce();
  const b = generatePkce();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});

test('generateState: returns 43+ chars of url-safe entropy', () => {
  const s = generateState();
  assert.ok(s.length >= 43);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
});

test('generateState: collisions extremely unlikely (1000 calls all unique)', () => {
  const set = new Set<string>();
  for (let i = 0; i < 1000; i++) set.add(generateState());
  assert.equal(set.size, 1000);
});

test('generateNonce: returns 43+ chars of url-safe entropy and is unique', () => {
  const a = generateNonce();
  const b = generateNonce();
  assert.ok(a.length >= 43);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});
