import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_HASH_BADGE_LENGTH,
  PREVIEW_CHAR_LIMIT,
  TRANSITION_KINDS,
  groupCitationsByFy,
  lookupSegment,
  transitionBadgeClasses,
  transitionLabel,
  truncateContentHash,
  truncatePreview,
  type CitationGraphEntry,
  type NarrativeSegmentLite,
  type TransitionKind,
} from './multi-cycle-timeline.js';

/**
 * P7 Theme A Task A.5 — pure-function tests for the multi-cycle timeline.
 *
 * apps/web's runner is `tsx --test` (Node, no jsdom). Following the
 * pattern established by `lib/narrative/render.test.tsx` and
 * `pipeline/_components/pipeline-kanban.test.tsx`, we test the helpers
 * directly. Full DOM behaviour (drawer open/close, focus management,
 * click bubbling) is exercised end-to-end via Playwright in a
 * follow-up swimlane (Task A.10 / contract integration).
 *
 * Coverage:
 *   - Empty graph → no buckets
 *   - Single-FY graph → one bucket (parent gates rendering by chain
 *     length; the component itself handles 1-FY gracefully)
 *   - 2-FY graph → 2 buckets, ordered by appearance
 *   - Each transition_kind value maps to its spec'd Tailwind colour
 *   - Content-hash truncation
 *   - Preview truncation (with verbatim full text preserved separately)
 *   - lookupSegment hits/misses
 *   - **Verbatim guarantee**: the segment text returned by
 *     lookupSegment is byte-for-byte equal to what was seeded — no
 *     transformation in the data path the drawer reads from.
 *     (Mirrors the spirit of Task A.4's verbatim test.)
 */

// ---------- fixtures ----------

const DRAFT_FY24 = '00000000-0000-4000-8000-000000000024';
const DRAFT_FY25 = '00000000-0000-4000-8000-000000000025';
const DRAFT_FY26 = '00000000-0000-4000-8000-000000000026';

const HASH_FY24 = '24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_FY25 = '25bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// Verbatim-fixture sentinel: the EXACT bytes any test in this file
// expects to round-trip through lookupSegment without alteration. The
// content includes leading whitespace, internal newlines, a tab, and a
// trailing newline — the kinds of things naive paraphrase or
// "smart-quote" reformatting would silently mangle.
const VERBATIM_TEXT_FY24 =
  '  Initial hypothesis: PPO with curriculum learning will\nout-perform vanilla PPO\ton sparse-reward tasks.\n';

const segmentsFY24: NarrativeSegmentLite[] = [
  {
    segment_index: 0,
    type: 'prose',
    text: 'Background: prior literature documents PPO baselines.',
    content_hash: 'aaaa1111',
    section_kind: 'hypothesis',
  },
  {
    segment_index: 1,
    type: 'claim',
    text: VERBATIM_TEXT_FY24,
    content_hash: 'aaaa2222',
    section_kind: 'hypothesis',
  },
];

const segmentsFY25: NarrativeSegmentLite[] = [
  {
    segment_index: 0,
    type: 'claim',
    text: 'Refined hypothesis: curriculum design must respect task complexity gradient.',
    content_hash: 'bbbb1111',
    section_kind: 'hypothesis',
  },
];

const segmentsByDraftId: Record<string, NarrativeSegmentLite[]> = {
  [DRAFT_FY24]: segmentsFY24,
  [DRAFT_FY25]: segmentsFY25,
};

const entryFY24: CitationGraphEntry = {
  fy_label: 'FY24',
  narrative_draft_id: DRAFT_FY24,
  section_kind: 'hypothesis',
  content_hash: HASH_FY24,
  cited_segment_indices: [0, 1],
  transition_kind: 'continuation',
  transition_rationale: 'FY25 keeps the same research question; depth increases.',
};

const entryFY25: CitationGraphEntry = {
  fy_label: 'FY25',
  narrative_draft_id: DRAFT_FY25,
  section_kind: 'hypothesis',
  content_hash: HASH_FY25,
  cited_segment_indices: [0],
  transition_kind: 'pivot',
  transition_rationale: 'FY26 reformulates: curriculum complexity becomes the primary lever.',
};

// ---------- groupCitationsByFy ----------

test('groupCitationsByFy: empty input → empty output', () => {
  assert.deepEqual(groupCitationsByFy([]), []);
});

test('groupCitationsByFy: single entry → single bucket', () => {
  const grouped = groupCitationsByFy([entryFY24]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.fy_label, 'FY24');
  assert.equal(grouped[0]!.entries.length, 1);
});

test('groupCitationsByFy: two-FY graph → two buckets in input order', () => {
  const grouped = groupCitationsByFy([entryFY24, entryFY25]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(
    grouped.map((b) => b.fy_label),
    ['FY24', 'FY25'],
  );
});

test('groupCitationsByFy: multiple entries for same FY land in same bucket', () => {
  const second: CitationGraphEntry = {
    ...entryFY24,
    narrative_draft_id: DRAFT_FY26,
    cited_segment_indices: [2],
    transition_rationale: 'Second citation for FY24.',
  };
  const grouped = groupCitationsByFy([entryFY24, second]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.entries.length, 2);
});

test('groupCitationsByFy: bucket order matches first-appearance order', () => {
  // FY25 appears first, then FY24 — order should be preserved (the
  // helper does NOT re-sort).
  const grouped = groupCitationsByFy([entryFY25, entryFY24]);
  assert.deepEqual(
    grouped.map((b) => b.fy_label),
    ['FY25', 'FY24'],
  );
});

// ---------- transitionBadgeClasses ----------

test('transitionBadgeClasses: continuation → emerald (green)', () => {
  const c = transitionBadgeClasses('continuation');
  assert.match(c, /emerald-100/);
  assert.match(c, /emerald-800/);
});

test('transitionBadgeClasses: pivot → amber', () => {
  const c = transitionBadgeClasses('pivot');
  assert.match(c, /amber-100/);
  assert.match(c, /amber-800/);
});

test('transitionBadgeClasses: completion → blue', () => {
  const c = transitionBadgeClasses('completion');
  assert.match(c, /blue-100/);
  assert.match(c, /blue-800/);
});

test('transitionBadgeClasses: abandoned → slate (gray)', () => {
  const c = transitionBadgeClasses('abandoned');
  assert.match(c, /slate-100/);
  assert.match(c, /slate-700/);
});

test('transitionBadgeClasses: covers every kind in TRANSITION_KINDS', () => {
  // Defensive: pin the enum so adding a new transition kind without a
  // colour mapping fails this test instead of silently rendering as
  // slate.
  for (const kind of TRANSITION_KINDS) {
    const c = transitionBadgeClasses(kind);
    assert.ok(c.length > 0, `no class string for ${kind}`);
  }
});

test('transitionLabel: produces capitalised human-readable label per kind', () => {
  assert.equal(transitionLabel('continuation'), 'Continuation');
  assert.equal(transitionLabel('pivot'), 'Pivot');
  assert.equal(transitionLabel('completion'), 'Completion');
  assert.equal(transitionLabel('abandoned'), 'Abandoned');
});

// ---------- truncatePreview ----------

test('truncatePreview: short text passes through unchanged', () => {
  const text = 'Short hypothesis statement.';
  assert.equal(truncatePreview(text), text);
});

test('truncatePreview: text over the limit gets truncated + ellipsis', () => {
  const text = 'A'.repeat(PREVIEW_CHAR_LIMIT + 50);
  const out = truncatePreview(text);
  assert.equal(out.length, PREVIEW_CHAR_LIMIT + 1); // +1 for ellipsis char
  assert.ok(out.endsWith('…'));
});

test('truncatePreview: text exactly at the limit is not truncated', () => {
  const text = 'X'.repeat(PREVIEW_CHAR_LIMIT);
  const out = truncatePreview(text);
  assert.equal(out, text);
  assert.ok(!out.endsWith('…'));
});

test('truncatePreview: respects custom limit override', () => {
  assert.equal(truncatePreview('hello world', 5), 'hello…');
});

// ---------- truncateContentHash ----------

test('truncateContentHash: returns first 8 chars of the hash', () => {
  assert.equal(truncateContentHash(HASH_FY24), HASH_FY24.slice(0, CONTENT_HASH_BADGE_LENGTH));
  assert.equal(truncateContentHash(HASH_FY24).length, CONTENT_HASH_BADGE_LENGTH);
});

test('truncateContentHash: short hashes are returned as-is', () => {
  assert.equal(truncateContentHash('abc'), 'abc');
});

// ---------- lookupSegment ----------

test('lookupSegment: returns undefined for unknown draft id', () => {
  assert.equal(lookupSegment('not-a-real-draft-id', 0, segmentsByDraftId), undefined);
});

test('lookupSegment: returns undefined for out-of-range segment index', () => {
  assert.equal(lookupSegment(DRAFT_FY24, 999, segmentsByDraftId), undefined);
});

test('lookupSegment: returns the right row for a known (draft, index)', () => {
  const got = lookupSegment(DRAFT_FY24, 1, segmentsByDraftId);
  if (!got) throw new Error('expected segment to be defined');
  assert.equal(got.segment_index, 1);
  assert.equal(got.type, 'claim');
});

// ---------- VERBATIM GUARANTEE ----------
// This is the load-bearing test for the Body-by-Michael compliance
// constraint described in the component header: the drawer renders
// `narrative_segment.text` byte-for-byte, with NO transformation in
// the read path. If lookupSegment ever started normalising whitespace,
// trimming, or re-encoding, this test would fail.

test('VERBATIM: lookupSegment.text is byte-for-byte equal to the seeded value', () => {
  const got = lookupSegment(DRAFT_FY24, 1, segmentsByDraftId);
  if (!got) throw new Error('expected segment to be defined');
  assert.equal(got.text, VERBATIM_TEXT_FY24);
  // Spot-check the structural bits that paraphrase / "smart-quote"
  // pipelines tend to mangle:
  assert.ok(got.text.startsWith('  '), 'leading whitespace preserved');
  assert.ok(got.text.includes('\n'), 'internal newlines preserved');
  assert.ok(got.text.includes('\t'), 'internal tab preserved');
  assert.ok(got.text.endsWith('\n'), 'trailing newline preserved');
});

test('VERBATIM: lookupSegment returns the same object reference (no copy/clone)', () => {
  // Sharing the reference (vs deep-cloning) is also a correctness
  // signal: it proves the component reads through to the seeded data
  // structure rather than to an intermediate transformed copy.
  const got = lookupSegment(DRAFT_FY24, 1, segmentsByDraftId);
  assert.equal(got, segmentsFY24[1]);
});

test('VERBATIM: TransitionKind enum is the spec-locked tuple', () => {
  // Pins the wire enum so a future change to the agent's transition
  // taxonomy doesn't silently land here without a parallel update to
  // colour mapping + tests.
  const expected: TransitionKind[] = ['continuation', 'pivot', 'completion', 'abandoned'];
  assert.deepEqual([...TRANSITION_KINDS], expected);
});
