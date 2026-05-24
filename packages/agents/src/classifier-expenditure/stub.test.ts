import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StubExpenditureClassifier } from './stub.js';
import type { ExpenditureClassifierInput } from './types.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function makeInput(overrides: {
  vendor_name: string;
  description?: string | null;
  expenditure_id?: string;
}): ExpenditureClassifierInput {
  return {
    expenditure_id: overrides.expenditure_id ?? VALID_UUID,
    expenditure: {
      vendor_name: overrides.vendor_name,
      description: overrides.description ?? null,
      total_amount: '1000.00',
      currency: 'AUD',
      expenditure_date: '2025-07-01',
      source: 'xero_invoice',
      kind: 'INVOICE',
    },
    project: {
      name: 'Project Foo',
      industry_sector: 'biotech',
      fiscal_year: 2026,
    },
    existing_activities: [],
    recent_evidence_events: [],
  };
}

const c = new StubExpenditureClassifier();

const cases: Array<{
  name: string;
  vendor_name: string;
  description?: string;
  expected_decision: 'eligible' | 'ineligible' | 'needs_review';
  expected_anchor: 's.355-25' | 's.355-30' | 'ineligible';
  expected_confidence: number;
}> = [
  {
    // AWS is now DUAL-USE in the stub: it gets routed via project +
    // recent-evidence context. The default test project ("Project Foo"
    // / "biotech") matches RD_CONTEXT_KEYWORDS, so AWS in this fixture
    // resolves to eligible §355-30 (supporting compute for R&D).
    // A non-R&D-shaped project would resolve it to ineligible — see
    // the dual-use tests further down.
    name: 'AWS in a biotech project → eligible §355-30 (dual-use, context: R&D)',
    vendor_name: 'Amazon Web Services',
    description: 'AWS monthly subscription',
    expected_decision: 'eligible',
    expected_anchor: 's.355-30',
    expected_confidence: 0.7,
  },
  {
    name: 'Atlassian → ineligible',
    vendor_name: 'Atlassian Pty Ltd',
    description: 'Jira Cloud',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.92,
  },
  {
    // GitHub same story as AWS — dual-use, eligible in an R&D project.
    name: 'GitHub in a biotech project → eligible §355-30 (dual-use, context: R&D)',
    vendor_name: 'GitHub Inc.',
    description: 'Team plan',
    expected_decision: 'eligible',
    expected_anchor: 's.355-30',
    expected_confidence: 0.7,
  },
  {
    name: 'Stripe → ineligible',
    vendor_name: 'Stripe Australia',
    description: 'Payment processing fees',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.92,
  },
  {
    name: 'Sigma-Aldrich reagents → eligible §355-25',
    vendor_name: 'Sigma-Aldrich',
    description: 'Reagents for hypothesis-test batch experiments',
    expected_decision: 'eligible',
    expected_anchor: 's.355-25',
    expected_confidence: 0.88,
  },
  {
    name: 'Prototype materials → eligible §355-25',
    vendor_name: 'ABC Engineering',
    description: 'Prototype machining materials',
    expected_decision: 'eligible',
    expected_anchor: 's.355-25',
    expected_confidence: 0.88,
  },
  {
    name: 'Research consumables → eligible §355-25',
    vendor_name: 'Generic Vendor',
    description: 'Research laboratory supplies',
    expected_decision: 'eligible',
    expected_anchor: 's.355-25',
    expected_confidence: 0.88,
  },
  {
    name: 'Feasibility scoping → eligible §355-30',
    vendor_name: 'Generic Consulting',
    description: 'Feasibility study and scoping for the new R&D workstream',
    expected_decision: 'eligible',
    expected_anchor: 's.355-30',
    expected_confidence: 0.78,
  },
  {
    name: 'Training → eligible §355-30',
    vendor_name: 'Training Provider',
    // NB: avoid the word "research" in description — it matches §355-25
    // first per the documented precedence in stub.ts.
    description: 'Training of engineering staff on the experimental methodology',
    expected_decision: 'eligible',
    // "experimental" matches §355-25 ahead of "training" → check the doc
    // ordering: §355-25 wins. This test pins the precedence.
    expected_anchor: 's.355-25',
    expected_confidence: 0.88,
  },
  {
    name: 'Pure training (no R&D vocabulary) → eligible §355-30',
    vendor_name: 'Training Provider',
    description: 'On-site training session for the team',
    expected_decision: 'eligible',
    expected_anchor: 's.355-30',
    expected_confidence: 0.78,
  },
  {
    name: 'Patent legal review → eligible §355-30',
    vendor_name: 'Law Firm LLP',
    description: 'Patent legal review',
    expected_decision: 'eligible',
    expected_anchor: 's.355-30',
    expected_confidence: 0.78,
  },
  // — broader semantic patterns added in the contamination-handling pass —
  {
    // "Annual PI premium" hits ADMIN_CONTEXT_KEYWORDS (description-
    // level admin override) before the vendor-specific insurance
    // pattern can match, so the confidence is 0.88 not 0.9. Outcome
    // (ineligible) is unchanged — and the admin path actually
    // catches this BETTER (matches "Annual PI premium" issued by
    // any vendor name, not just the canonical insurance vendors).
    name: 'Aon Risk Services → ineligible (insurance)',
    vendor_name: 'Aon Risk Services',
    description: 'Annual PI premium',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.88,
  },
  {
    name: 'PwC Tax → ineligible (tax / accounting)',
    vendor_name: 'PwC Tax Advisory',
    description: 'FY26 statutory return',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.9,
  },
  {
    name: 'Webjet → ineligible (corporate travel)',
    vendor_name: 'Webjet Corporate',
    description: 'Conference flights',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.9,
  },
  {
    // "Fleet fuel" hits ADMIN_CONTEXT_KEYWORDS first → 0.88.
    name: 'Caltex StarCard → ineligible (fuel)',
    vendor_name: 'Caltex StarCard',
    description: 'Fleet fuel',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.88,
  },
  {
    // "CRM seats" hits ADMIN_CONTEXT_KEYWORDS first → 0.88.
    name: 'Salesforce → ineligible (sales SaaS)',
    vendor_name: 'Salesforce Australia',
    description: 'CRM seats',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.88,
  },
  {
    name: 'Telstra → ineligible (telco)',
    vendor_name: 'Telstra Corporate',
    description: 'Office line + mobile fleet',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.9,
  },
  {
    name: 'WeWork → ineligible (coworking)',
    vendor_name: 'WeWork Melbourne',
    description: 'May office rent',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.9,
  },
  {
    // "Stationery" hits ADMIN_CONTEXT_KEYWORDS first → 0.88.
    name: 'Officeworks → ineligible (retail)',
    vendor_name: 'Officeworks',
    description: 'Stationery and printer paper',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.88,
  },
  {
    name: 'CASA permit → ineligible (regulator fee)',
    vendor_name: 'CASA Permit Fees',
    description: 'BVLOS permit application',
    expected_decision: 'ineligible',
    expected_anchor: 'ineligible',
    expected_confidence: 0.85,
  },
];

for (const tc of cases) {
  test(`StubExpenditureClassifier: ${tc.name}`, async () => {
    const out = await c.classify(
      makeInput({ vendor_name: tc.vendor_name, description: tc.description ?? null }),
    );
    assert.equal(out.decision, tc.expected_decision);
    assert.equal(out.statutory_anchor, tc.expected_anchor);
    assert.equal(out.eligibility_probability, tc.expected_confidence);
    assert.equal(out.suggested_activity_id, null);
    assert.equal(out.model, 'stub-v1.0.0');
    assert.equal(out.prompt_version, 'stub-v1.0.0');
    assert.equal(out.tokens_in, 0);
    assert.equal(out.tokens_out, 0);
    assert.equal(out.uncertainty_reason, null);
  });
}

test('unmatched vendor → needs_review 0.50 with uncertainty_reason populated', async () => {
  const out = await c.classify(
    makeInput({ vendor_name: 'Random Vendor', description: 'unrelated line item' }),
  );
  assert.equal(out.decision, 'needs_review');
  assert.equal(out.eligibility_probability, 0.5);
  assert.equal(out.suggested_activity_id, null);
  assert.equal(typeof out.uncertainty_reason, 'string');
  assert.ok(out.uncertainty_reason && out.uncertainty_reason.length > 0);
});

test('unmatched with null description still produces a deterministic result', async () => {
  const out = await c.classify(makeInput({ vendor_name: 'Random Vendor', description: null }));
  assert.equal(out.decision, 'needs_review');
});

test('determinism: same input twice → same output', async () => {
  const input = makeInput({ vendor_name: 'Sigma-Aldrich', description: 'reagents' });
  const a = await c.classify(input);
  const b = await c.classify(input);
  assert.deepEqual(a, b);
});

// — Dual-use SaaS context routing —
// AWS, GitHub, Notion, Slack, JetBrains, Zoom, Datadog, Sentry are
// vendors with BOTH R&D and admin usage patterns. The stub uses the
// project / recent-evidence context to decide which branch applies.

test('dual-use: Slack in a sales-team project → ineligible (no R&D context)', async () => {
  const out = await c.classify({
    expenditure_id: VALID_UUID,
    expenditure: {
      vendor_name: 'Slack Technologies',
      description: 'monthly subscription',
      total_amount: '1000.00',
      currency: 'AUD',
      expenditure_date: '2025-07-01',
      source: 'xero_invoice',
      kind: 'INVOICE',
    },
    project: {
      // No R&D keywords here — the dual-use branch falls through to
      // ineligible.
      name: 'Sales operations FY26',
      industry_sector: 'sales',
      fiscal_year: 2026,
    },
    existing_activities: [],
    recent_evidence_events: [],
  });
  assert.equal(out.decision, 'ineligible');
  assert.equal(out.statutory_anchor, 'ineligible');
  assert.equal(out.eligibility_probability, 0.78);
});

test('dual-use: Notion in a research project → eligible §355-30', async () => {
  const out = await c.classify({
    expenditure_id: VALID_UUID,
    expenditure: {
      vendor_name: 'Notion Labs',
      description: 'team plan',
      total_amount: '500.00',
      currency: 'AUD',
      expenditure_date: '2025-07-01',
      source: 'xero_invoice',
      kind: 'INVOICE',
    },
    project: {
      name: 'Hi-temp alloy phase-stability research program',
      industry_sector: 'materials',
      fiscal_year: 2026,
    },
    existing_activities: [],
    recent_evidence_events: [],
  });
  assert.equal(out.decision, 'eligible');
  assert.equal(out.statutory_anchor, 's.355-30');
  assert.equal(out.eligibility_probability, 0.7);
});

test('dual-use: GitHub eligible via recent_evidence even when project is generic', async () => {
  const out = await c.classify({
    expenditure_id: VALID_UUID,
    expenditure: {
      vendor_name: 'GitHub Inc.',
      description: 'team plan',
      total_amount: '500.00',
      currency: 'AUD',
      expenditure_date: '2025-07-01',
      source: 'xero_invoice',
      kind: 'INVOICE',
    },
    project: {
      // Generic project name with no R&D keywords.
      name: 'Q4 program',
      industry_sector: null,
      fiscal_year: 2026,
    },
    existing_activities: [],
    recent_evidence_events: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'HYPOTHESIS',
        captured_at: '2025-06-15T10:00:00Z',
        summary: 'We hypothesise that the new kernel improves inference latency by 30%',
      },
    ],
  });
  assert.equal(out.decision, 'eligible');
  assert.equal(out.statutory_anchor, 's.355-30');
  assert.equal(out.eligibility_probability, 0.7);
});

test('expenditure_id is echoed exactly', async () => {
  const customId = '99999999-9999-4999-8999-999999999999';
  const out = await c.classify(makeInput({ vendor_name: 'AWS', expenditure_id: customId }));
  assert.equal(out.expenditure_id, customId);
});

test('rationale includes the vendor name for traceability', async () => {
  const out = await c.classify(makeInput({ vendor_name: 'Atlassian Pty Ltd' }));
  assert.match(out.rationale, /Atlassian Pty Ltd/);
});

test('stub completes in well under 50ms (no accidental I/O introduced)', async () => {
  const start = performance.now();
  await c.classify(makeInput({ vendor_name: 'AWS' }));
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 50, `expected <50ms, got ${elapsed.toFixed(2)}ms`);
});
