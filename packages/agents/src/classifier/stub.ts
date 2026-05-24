import type { Classifier, ClassifierInput, ClassifierOutput, ClassifiableKind } from './types.js';

type Rule = {
  pattern: RegExp;
  kind: ClassifiableKind;
  confidence: number;
  rationale: string;
  anchor: string | null;
};

/**
 * Order matters — earlier rules win.
 *
 * The plan-spec ordering put TIME_LOG first, but "We hypothesised the catalyst
 * would last 200 hours" and "Ran the test rig at 50C for 12 hours" both
 * contain a "<n> hours" duration that would short-circuit to TIME_LOG before
 * the substantive R&D-category rule could fire. Move TIME_LOG to the bottom
 * of the rule list so it only matches when no other R&D vocabulary is
 * present — i.e. pure time records like "Spent 4 hours debugging".
 *
 * Non-R&D-content rules (ASSOCIATE_FLAG, EXPENDITURE_NOTE, INELIGIBLE) also
 * precede TIME_LOG so a sentence like "Director's spouse spent 4 hours"
 * classifies as ASSOCIATE_FLAG rather than TIME_LOG.
 */
/**
 * Corporate-noise INELIGIBLE patterns — marketing, ops, admin,
 * refactoring, board prep, insurance renewals, tax prep, payroll. All
 * "ordinary business operations" under §355-25(2)(a). Listed BEFORE the
 * R&D rules below so that a phrase like "Email subject-line
 * experiment" hits this rule first instead of cascading to EXPERIMENT
 * (the literal word "experiment" appears in contamination too).
 *
 * Tuned against the bulk-claim seed's CONTAMINATION_THEMES — every
 * template contributes at least one distinctive substring here. For
 * production text the patterns are still safe: each substring is
 * either a corporate-only phrase ("board pack", "agency budget", "pi
 * insurance") or a vendor name that appears only in non-R&D contexts
 * in the seed (Marsh, Salesforce).
 */
const CORPORATE_NOISE_INELIGIBLE = new RegExp(
  [
    // marketing / UX experimentation
    'a\\/b\\s+test',
    'landing\\s+page',
    'variant\\s+[ab]\\b',
    '\\bcta\\b',
    '\\bctr\\b',
    'open-?rate',
    'subject-?line',
    'newsletter\\s+cohort',
    'conversion\\s+lift',
    'onboarding-?flow',
    'email-?verification',
    'sub-trial',
    'support\\s+tickets',
    'internal\\s+tool\\s+eval',
    'program\\s+board',
    'pricing-?page',
    'founder\\s+tile',
    // refactor / migration / ops
    // NB: bare "refactor" is too broad — R&D engineering teams do
    // legitimate experimental refactors (per-frame coroutines, kernel
    // rewrites). Require the "legacy" anchor so we catch admin-tier
    // refactor chores without false-positiving on R&D code work.
    'legacy\\s+(?:reports?|module|favicon)',
    'no\\s+behaviour\\s+change',
    'tests?\\s+still\\s+green',
    'slack\\s+workspace',
    'new\\s+pricing\\s+plan',
    'ci\\s+runner',
    'pricing\\s+review',
    'build-?time\\s+delta',
    'staging\\s+cluster',
    't\\d\\.(?:large|xlarge|medium|small)',
    'oom\\s+kills?',
    'req\\/min',
    'marketing-?site',
    'favicon',
    'brand-?asset',
    // marketing / agency / brand
    'marketing\\s+spend',
    'agency\\s+budget',
    'brand\\s+work',
    // insurance / risk
    'pi\\s+premium',
    'pi\\s+insurance',
    '\\bmarsh\\b',
    'broker\\s+call',
    'insurance\\s+(?:premium|renewal|with)',
    // sales / SaaS admin
    'salesforce',
    'seat\\s+audit',
    'inactive\\s+logins',
    // real estate
    'office\\s+lease',
    'lease\\s+renewal',
    // people-ops / admin
    'nps\\s+survey',
    'tooling\\s+fragmentation',
    'admin\\s+assistant',
    'onboarded\\s+new',
    'hr\\s+system',
    // finance / board / accounting
    'board[\\s-]?pack',
    'elt\\s+review',
    'budget\\s+reforecast',
    'spreadsheet\\s+rebuild',
    'tax[\\s-]?prep',
    'handover\\s+with\\s+(?:ey|pwc|kpmg|deloitte)',
    'with\\s+(?:ey|pwc|kpmg|deloitte)\\b',
    'slide\\s+deck',
    '\\bcfo\\b',
    // team events
    'team\\s+offsite',
    'wineries',
    'cellar\\s+door',
  ].join('|'),
  'i',
);

const STUB_RULES: Rule[] = [
  {
    pattern: /\b(associate|related party|spouse|director'?s? (?:wife|husband|spouse|family))/i,
    kind: 'ASSOCIATE_FLAG',
    confidence: 0.85,
    rationale: 'Stub: associate / related-party vocabulary',
    anchor: null,
  },
  {
    // CORPORATE NOISE first — needs to beat both EXPENDITURE_NOTE
    // ($X amounts inside contamination notes) and the R&D-vocab rules
    // (e.g. "Email subject-line experiment" → INELIGIBLE, not EXPERIMENT).
    pattern: CORPORATE_NOISE_INELIGIBLE,
    kind: 'INELIGIBLE',
    confidence: 0.85,
    rationale: 'Stub: corporate-noise / ordinary-business vocabulary',
    anchor: '§355-25(2)(a)',
  },
  {
    pattern: /\$\s?\d|invoice|paid\s+\$|expense (?:was|of|incurred)|cost (?:was|of|incurred)/i,
    kind: 'EXPENDITURE_NOTE',
    confidence: 0.8,
    rationale: 'Stub: expenditure vocabulary',
    anchor: null,
  },
  {
    // "standard" on its own is too greedy — scientific phrases like
    // "authentic standard" (HPLC reference compound) or "standard
    // deviation" routinely appear in R&D notes. Require it to be
    // adjacent to clearly-ordinary-business modifiers ("standard
    // practice / procedure / operating") so we don't false-positive
    // on the chemistry vocab.
    pattern:
      /\b(?:routine|business\s+as\s+usual|bau|just\s+our\s+normal|usual\s+practice|standard\s+(?:practice|procedure|operating|admin|ops))\b/i,
    kind: 'INELIGIBLE',
    confidence: 0.72,
    rationale: 'Stub: ordinary-business vocabulary',
    anchor: '§355-25(2)(a)',
  },
  {
    pattern:
      /\b(hypothes[ie][sz]e?d?|posit(?:ed|ing)?|theoris[ed]|theoriz[ed]|predict(?:ed|ion))\b/i,
    kind: 'HYPOTHESIS',
    confidence: 0.85,
    rationale: 'Stub: hypothesis-formation vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(experiment|trial|run\s+(?:a|the)\s+test|test\s+rig|measur(?:ed|ement))\b/i,
    kind: 'EXPERIMENT',
    confidence: 0.85,
    rationale: 'Stub: experimental vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(observ(?:ed|ation)|noticed|recorded|logged that)\b/i,
    kind: 'OBSERVATION',
    confidence: 0.78,
    rationale: 'Stub: observational vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(iter(?:ate|ation)|refin(?:e|ed)|revis(?:e|ed)|adjust(?:ed)?)\b/i,
    kind: 'ITERATION',
    confidence: 0.75,
    rationale: 'Stub: iteration vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(uncertain(?:ty)?|unsure|unknown|unclear|ambiguous|edge case)\b/i,
    kind: 'UNCERTAINTY',
    confidence: 0.8,
    rationale: 'Stub: uncertainty vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(learned|discover(?:ed|y)|insight|finding|conclud(?:e|ed))\b/i,
    kind: 'NEW_KNOWLEDGE',
    confidence: 0.78,
    rationale: 'Stub: new-knowledge vocabulary',
    anchor: '§355-25(1)(a)',
  },
  {
    pattern: /\b(design|architecture|blueprint|schematic|spec(?:ification)?)\b/i,
    kind: 'DESIGN',
    confidence: 0.78,
    rationale: 'Stub: design vocabulary',
    anchor: null,
  },
  {
    pattern: /\b(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h)\b|\btime spent\b)/i,
    kind: 'TIME_LOG',
    confidence: 0.92,
    rationale: 'Stub: time-quantity vocabulary',
    anchor: null,
  },
];

/**
 * Deterministic regex-based classifier used in CI and as the always-available
 * fallback. Runs zero API calls and produces stable output for the same input.
 *
 * The default classification when no rule matches is SUPPORTING with a low
 * (0.50) confidence — this corresponds to Division 355-30 supporting-activity
 * status and is intentionally conservative so consultants review borderline
 * cases rather than the system silently calling them ineligible.
 */
export class StubClassifier implements Classifier {
  // Async signature is required by the Classifier interface even though this
  // implementation never awaits — keeps the interface symmetric with OpusClassifier.
  // eslint-disable-next-line @typescript-eslint/require-await
  async classify({ raw_text }: ClassifierInput): Promise<ClassifierOutput> {
    for (const rule of STUB_RULES) {
      if (rule.pattern.test(raw_text)) {
        return {
          kind: rule.kind,
          confidence: rule.confidence,
          rationale: rule.rationale,
          statutory_anchor: rule.anchor,
          model: 'stub-v1.0.0',
          prompt_version: 'classify@1.0.0',
          tokens_in: 0,
          tokens_out: 0,
        };
      }
    }
    return {
      kind: 'SUPPORTING',
      confidence: 0.5,
      rationale: 'Stub: no specific match; defaulting to SUPPORTING per §355-30',
      statutory_anchor: '§355-30',
      model: 'stub-v1.0.0',
      prompt_version: 'classify@1.0.0',
      tokens_in: 0,
      tokens_out: 0,
    };
  }
}
