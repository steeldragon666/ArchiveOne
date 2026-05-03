import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  MultiCycleSummaryOutput,
  multiCycleSummarizeToolSchema,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from './multi-cycle-summarize@1.0.0.js';
import { getPrompt, listPrompts } from '../../runtime/prompt-registry.js';
import { MULTI_CYCLE_TRANSITION_KINDS } from '../types.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const okCitation = (overrides: Record<string, unknown> = {}) => ({
  fy_label: 'FY24',
  narrative_draft_id: randomUUID(),
  section_kind: 'hypothesis' as const,
  content_hash: 'abc123def456',
  cited_segment_indices: [0, 1],
  transition_kind: 'continuation' as const,
  transition_rationale:
    'Selected continuation because the FY25 hypothesis section re-states the same uncertainty and the data are an extension of the FY24 series.',
  ...overrides,
});

const okToolPayload = (overrides: Record<string, unknown> = {}) => ({
  proposed_id: randomUUID(),
  fy_labels: ['FY24', 'FY25'],
  citation_graph: [okCitation()],
  total_fys_covered: 2,
  earliest_hypothesis_formed_at: new Date().toISOString(),
  ...overrides,
});

const okFullOutput = (overrides: Record<string, unknown> = {}) => ({
  ...okToolPayload(),
  prompt_version: '1.0.0' as const,
  model: 'claude-sonnet-4-5',
  idempotency_key: 'idem-key-1',
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Registry / system-prompt sanity                                     */
/* ------------------------------------------------------------------ */

test('multi-cycle-summarize@1.0.0 is registered in the prompt registry', () => {
  const keys = listPrompts();
  assert.ok(
    keys.includes('multi-cycle-summarize@1.0.0'),
    `expected listPrompts() to include 'multi-cycle-summarize@1.0.0', got ${JSON.stringify(keys)}`,
  );
  const p = getPrompt('multi-cycle-summarize@1.0.0');
  assert.equal(p.name, 'multi-cycle-summarize');
  assert.equal(p.version, '1.0.0');
  assert.equal(p.tool.name, 'multi_cycle_summarize');
  assert.equal(typeof p.tool.description, 'string');
  assert.ok(p.tool.description.length > 0);
  assert.equal(p.system, SYSTEM_PROMPT);
});

test('PROMPT_VERSION matches the registered version', () => {
  assert.equal(PROMPT_VERSION, '1.0.0');
});

test('system prompt explicitly forbids paraphrase', () => {
  // Defence-in-depth: catch refactors that strip the no-paraphrase
  // language. The whole architectural point of this prompt is that the
  // model emits citations, NOT prose.
  assert.match(SYSTEM_PROMPT, /citation graph/i);
  assert.match(SYSTEM_PROMPT, /not a summari[sz]er/i);
  assert.match(SYSTEM_PROMPT, /paraphras/i);
  // The prompt must call out the four transition classifications by name.
  for (const kind of MULTI_CYCLE_TRANSITION_KINDS) {
    assert.match(SYSTEM_PROMPT, new RegExp(kind));
  }
});

/* ------------------------------------------------------------------ */
/* Body-by-Michael — schema cannot leak prior-year prose                */
/* ------------------------------------------------------------------ */

test('multi-cycle-summarize output schema has no fields capable of carrying prior-year prose', () => {
  const shape = MultiCycleSummaryOutput.shape;
  // Whitelist of fields that may be ZodStrings, all constrained:
  //   - `transition_rationale` is nested in citation_graph entries (not at
  //     the top level the iteration walks), capped at 500 chars, and
  //     scoped to "why this transition classification".
  //   - `prompt_version` is z.literal('1.0.0') (not a ZodString instance,
  //     listed defensively in case future authors loosen the schema).
  //   - `model` and `idempotency_key` are runtime-stamped metadata.
  //   - `proposed_id` is z.string().uuid() — format-constrained UUID,
  //     not a free-text leakage surface.
  //   - `earliest_hypothesis_formed_at` is z.string().datetime() —
  //     format-constrained RFC 3339 timestamp, not a free-text leakage
  //     surface.
  const allowedTextFields = [
    'transition_rationale',
    'prompt_version',
    'model',
    'idempotency_key',
    'proposed_id',
    'earliest_hypothesis_formed_at',
  ];
  for (const field of Object.keys(shape)) {
    if (
      (shape as Record<string, unknown>)[field] instanceof z.ZodString &&
      !allowedTextFields.includes(field)
    ) {
      assert.fail(
        `Field ${field} is a free-text string — could leak prior-year prose. Constrain or remove.`,
      );
    }
  }
});

test('multi-cycle-summarize tool schema rejects paraphrased content even if model emits it', () => {
  const malicious = {
    proposed_id: randomUUID(),
    fy_labels: ['FY24', 'FY25'],
    citation_graph: [
      {
        fy_label: 'FY24',
        narrative_draft_id: randomUUID(),
        section_kind: 'hypothesis',
        content_hash: 'abc',
        cited_segment_indices: [0],
        transition_kind: 'continuation',
        transition_rationale: 'In FY24, the team hypothesized that...' /* PARAPHRASE */,
        // attempting to inject extra prose field at the citation level
        additional_summary: 'Long paraphrased summary of prior year',
      },
    ],
    total_fys_covered: 2,
    earliest_hypothesis_formed_at: new Date().toISOString(),
    prompt_version: '1.0.0',
    model: 'claude-sonnet-4-5',
    idempotency_key: 'k1',
  };
  // Strict mode: extra fields rejected.
  assert.throws(() => MultiCycleSummaryOutput.parse(malicious));
});

test('output schema rejects an extra free-text field at the top level', () => {
  const malicious = {
    ...okFullOutput(),
    summary: 'Long paraphrased summary of prior year FYs',
  };
  assert.throws(() => MultiCycleSummaryOutput.parse(malicious));
});

test('output schema rejects an extra `body` field', () => {
  const malicious = {
    ...okFullOutput(),
    body: 'Verbatim copy of prior-year prose',
  };
  assert.throws(() => MultiCycleSummaryOutput.parse(malicious));
});

/* ------------------------------------------------------------------ */
/* Output schema happy-path + structural constraints                   */
/* ------------------------------------------------------------------ */

test('full output schema parses a valid payload', () => {
  const parsed = MultiCycleSummaryOutput.parse(okFullOutput());
  assert.equal(parsed.prompt_version, '1.0.0');
  assert.equal(parsed.fy_labels.length, 2);
  assert.equal(parsed.citation_graph.length, 1);
  assert.equal(parsed.citation_graph[0].transition_kind, 'continuation');
});

test('output schema rejects prompt_version other than the literal "1.0.0"', () => {
  const result = MultiCycleSummaryOutput.safeParse({
    ...okFullOutput(),
    prompt_version: '2.0.0',
  });
  assert.equal(result.success, false);
});

test('output schema rejects an invalid UUID in proposed_id', () => {
  const result = MultiCycleSummaryOutput.safeParse({
    ...okFullOutput(),
    proposed_id: 'not-a-uuid',
  });
  assert.equal(result.success, false);
});

test('output schema rejects a non-RFC3339 earliest_hypothesis_formed_at', () => {
  const result = MultiCycleSummaryOutput.safeParse({
    ...okFullOutput(),
    earliest_hypothesis_formed_at: 'yesterday',
  });
  assert.equal(result.success, false);
});

/* ------------------------------------------------------------------ */
/* Tool schema (model-facing) — runtime-stamped fields are absent       */
/* ------------------------------------------------------------------ */

test('tool schema does NOT advertise runtime-stamped metadata fields', () => {
  // Defence-in-depth: the runtime stamps `prompt_version`, `model`, and
  // `idempotency_key` after the model returns. The TOOL schema must NOT
  // declare them — otherwise the model could fabricate them.
  const shape = (multiCycleSummarizeToolSchema as unknown as { shape: Record<string, unknown> })
    .shape;
  for (const forbidden of ['prompt_version', 'model', 'idempotency_key']) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(shape, forbidden),
      false,
      `tool schema must not declare ${forbidden} (runtime-stamped)`,
    );
  }
});

test('tool schema parses a valid tool payload', () => {
  const parsed = multiCycleSummarizeToolSchema.parse(okToolPayload());
  assert.equal(parsed.fy_labels.length, 2);
  assert.equal(parsed.citation_graph.length, 1);
});

test('tool schema rejects extra top-level fields (strict)', () => {
  const result = multiCycleSummarizeToolSchema.safeParse({
    ...okToolPayload(),
    paraphrase: 'forbidden free-text leak',
  });
  assert.equal(result.success, false);
});

/* ------------------------------------------------------------------ */
/* Citation entry constraints                                          */
/* ------------------------------------------------------------------ */

test('citation entry rejects an unknown transition_kind', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ transition_kind: 'mutation' })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects an unknown section_kind', () => {
  // narrative_draft.section_kind enum is closed: hypothesis | new_knowledge
  // | uncertainty | experiments_and_results.
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ section_kind: 'design' })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry accepts each valid section_kind', () => {
  for (const sk of [
    'hypothesis',
    'new_knowledge',
    'uncertainty',
    'experiments_and_results',
  ] as const) {
    const ok = MultiCycleSummaryOutput.safeParse(
      okFullOutput({ citation_graph: [okCitation({ section_kind: sk })] }),
    );
    assert.equal(ok.success, true, `expected section_kind=${sk} to parse`);
  }
});

test('citation entry accepts each valid transition_kind', () => {
  for (const tk of MULTI_CYCLE_TRANSITION_KINDS) {
    const ok = MultiCycleSummaryOutput.safeParse(
      okFullOutput({ citation_graph: [okCitation({ transition_kind: tk })] }),
    );
    assert.equal(ok.success, true, `expected transition_kind=${tk} to parse`);
  }
});

test('citation entry rejects empty cited_segment_indices', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ cited_segment_indices: [] })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects negative segment indices', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ cited_segment_indices: [-1] })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects non-integer segment indices', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ cited_segment_indices: [0.5] })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects a transition_rationale shorter than 20 chars', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ transition_rationale: 'too short' })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects a transition_rationale longer than 500 chars', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({
      citation_graph: [okCitation({ transition_rationale: 'a'.repeat(501) })],
    }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects an invalid UUID in narrative_draft_id', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({ citation_graph: [okCitation({ narrative_draft_id: 'not-a-uuid' })] }),
  );
  assert.equal(result.success, false);
});

test('citation entry rejects an extra field at the citation level (strict)', () => {
  const result = MultiCycleSummaryOutput.safeParse(
    okFullOutput({
      citation_graph: [
        {
          ...okCitation(),
          additional_summary: 'paraphrased prior-year prose',
        },
      ],
    }),
  );
  assert.equal(result.success, false);
});
