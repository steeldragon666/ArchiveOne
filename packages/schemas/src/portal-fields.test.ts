import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CorePortalFieldsSchema,
  SupportingPortalFieldsSchema,
  PortalFieldCharacterLimits,
  OutcomeUnknownMethodEnum,
  EvidenceKeptCategoryEnum,
} from './portal-fields.js';

// ---------------------------------------------------------------------------
// CorePortalFieldsSchema
// ---------------------------------------------------------------------------

test('CorePortalFieldsSchema: accepts valid 13-field object', () => {
  const valid = {
    activity_name: 'Test core activity',
    description: 'a'.repeat(200),
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a'.repeat(500),
    why_competent_professional_couldnt_know: 'a'.repeat(500),
    hypothesis: 'a'.repeat(500),
    experiment: 'a'.repeat(500),
    evaluation: 'a'.repeat(500),
    conclusions: 'a'.repeat(500),
    evidence_kept_categories: ['hypothesis_design', 'results_evaluation'],
    new_knowledge_purpose: 'a'.repeat(500),
    expenditure_estimate_aud: 250000,
    related_supporting_activity_ids: [],
  };
  assert.doesNotThrow(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: rejects content exceeding 4000 chars', () => {
  const valid = {
    activity_name: 'X',
    description: 'a'.repeat(4001),
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a',
    why_competent_professional_couldnt_know: 'a',
    hypothesis: 'a',
    experiment: 'a',
    evaluation: 'a',
    conclusions: 'a',
    evidence_kept_categories: ['hypothesis_design'],
    new_knowledge_purpose: 'a',
    expenditure_estimate_aud: 0,
    related_supporting_activity_ids: [],
  };
  assert.throws(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: rejects activity_name exceeding 200 chars', () => {
  const valid = {
    activity_name: 'a'.repeat(201),
    description: 'a',
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a',
    why_competent_professional_couldnt_know: 'a',
    hypothesis: 'a',
    experiment: 'a',
    evaluation: 'a',
    conclusions: 'a',
    evidence_kept_categories: ['hypothesis_design'],
    new_knowledge_purpose: 'a',
    expenditure_estimate_aud: 0,
    related_supporting_activity_ids: [],
  };
  assert.throws(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: requires at least one outcome_unknown_method', () => {
  const valid = {
    activity_name: 'X',
    description: 'a',
    outcome_unknown_methods: [],
    sources_investigated: 'a',
    why_competent_professional_couldnt_know: 'a',
    hypothesis: 'a',
    experiment: 'a',
    evaluation: 'a',
    conclusions: 'a',
    evidence_kept_categories: ['hypothesis_design'],
    new_knowledge_purpose: 'a',
    expenditure_estimate_aud: 0,
    related_supporting_activity_ids: [],
  };
  assert.throws(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: requires at least one evidence_kept_category', () => {
  const valid = {
    activity_name: 'X',
    description: 'a',
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a',
    why_competent_professional_couldnt_know: 'a',
    hypothesis: 'a',
    experiment: 'a',
    evaluation: 'a',
    conclusions: 'a',
    evidence_kept_categories: [],
    new_knowledge_purpose: 'a',
    expenditure_estimate_aud: 0,
    related_supporting_activity_ids: [],
  };
  assert.throws(() => CorePortalFieldsSchema.parse(valid));
});

test('CorePortalFieldsSchema: rejects negative expenditure', () => {
  const valid = {
    activity_name: 'X',
    description: 'a',
    outcome_unknown_methods: ['no_applicable_literature'],
    sources_investigated: 'a',
    why_competent_professional_couldnt_know: 'a',
    hypothesis: 'a',
    experiment: 'a',
    evaluation: 'a',
    conclusions: 'a',
    evidence_kept_categories: ['hypothesis_design'],
    new_knowledge_purpose: 'a',
    expenditure_estimate_aud: -1,
    related_supporting_activity_ids: [],
  };
  assert.throws(() => CorePortalFieldsSchema.parse(valid));
});

// ---------------------------------------------------------------------------
// SupportingPortalFieldsSchema
// ---------------------------------------------------------------------------

test('SupportingPortalFieldsSchema: accepts valid 9-field object', () => {
  const valid = {
    activity_name: 'Test supporting activity',
    description: 'a'.repeat(200),
    supports_core_activity_ids: ['00000000-0000-4000-8000-000000000001'],
    how_supports_core_rd: 'a'.repeat(500),
    who_performed_work: 'r_and_d_company_only',
    dates_conducted: { start: '2024-07-01', end: '2025-06-30' },
    expenditure_estimate_aud: 100000,
    produces_good_or_service: false,
    dominant_purpose: { is_dominant_purpose: true, explanation: 'a'.repeat(200) },
    evidence_kept: 'a'.repeat(200),
  };
  assert.doesNotThrow(() => SupportingPortalFieldsSchema.parse(valid));
});

test('SupportingPortalFieldsSchema: requires at least one core activity ref', () => {
  const invalid = {
    activity_name: 'X',
    description: 'a',
    supports_core_activity_ids: [],
    how_supports_core_rd: 'a',
    who_performed_work: 'r_and_d_company_only',
    dates_conducted: { start: '2024-07-01', end: '2025-06-30' },
    expenditure_estimate_aud: 0,
    produces_good_or_service: false,
    dominant_purpose: { is_dominant_purpose: true, explanation: 'a' },
    evidence_kept: 'a',
  };
  assert.throws(() => SupportingPortalFieldsSchema.parse(invalid));
});

test('SupportingPortalFieldsSchema: dominant_purpose.is_dominant_purpose must be true', () => {
  const invalid = {
    activity_name: 'X',
    description: 'a',
    supports_core_activity_ids: ['00000000-0000-4000-8000-000000000001'],
    how_supports_core_rd: 'a',
    who_performed_work: 'r_and_d_company_only',
    dates_conducted: { start: '2024-07-01', end: '2025-06-30' },
    expenditure_estimate_aud: 0,
    produces_good_or_service: false,
    dominant_purpose: { is_dominant_purpose: false, explanation: 'a' },
    evidence_kept: 'a',
  };
  assert.throws(() => SupportingPortalFieldsSchema.parse(invalid));
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

test('OutcomeUnknownMethodEnum: accepts all valid values', () => {
  const values = [
    'no_applicable_literature',
    'expert_advice',
    'no_adaptable_solutions',
    'other',
    'did_not_investigate',
  ];
  for (const v of values) {
    assert.doesNotThrow(() => OutcomeUnknownMethodEnum.parse(v));
  }
});

test('EvidenceKeptCategoryEnum: accepts all valid values', () => {
  const values = [
    'hypothesis_design',
    'results_evaluation',
    'experiment_revisions',
    'knowledge_searches',
    'systematic_progression',
    'other',
    'no_records_kept',
  ];
  for (const v of values) {
    assert.doesNotThrow(() => EvidenceKeptCategoryEnum.parse(v));
  }
});

// ---------------------------------------------------------------------------
// PortalFieldCharacterLimits
// ---------------------------------------------------------------------------

test('PortalFieldCharacterLimits: all core narrative fields cap at 4000', () => {
  for (const [key, limit] of Object.entries(PortalFieldCharacterLimits.core)) {
    assert.ok(limit <= 4000, `core.${key} exceeds 4000`);
  }
});

test('PortalFieldCharacterLimits: all supporting narrative fields cap at 4000', () => {
  for (const [key, limit] of Object.entries(PortalFieldCharacterLimits.supporting)) {
    assert.ok(limit <= 4000, `supporting.${key} exceeds 4000`);
  }
});
