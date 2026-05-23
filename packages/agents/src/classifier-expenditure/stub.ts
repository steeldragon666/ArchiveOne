import type {
  ExpenditureClassifier,
  ExpenditureClassifierInput,
  ExpenditureClassifierOutput,
  ExpenditureDecision,
  ExpenditureStatutoryAnchor,
} from './types.js';

type StubMatch = {
  decision: ExpenditureDecision;
  statutory_anchor: ExpenditureStatutoryAnchor;
  confidence: number;
};

/**
 * Patterns are checked IN ORDER; first match wins.
 *
 * Order matters when a vendor name + description spans multiple categories
 * (e.g. an AWS line described as "research compute"). The chosen precedence
 * is INELIGIBLE-first because the §355-25(2)(a) ordinary-business exclusion
 * is a hard gate — a Stripe / GitHub / Atlassian invoice is excluded even if
 * the project description happens to mention "research". Consultants told us
 * to err toward calling those out as ineligible at the stub layer rather than
 * letting the eligible regex catch a SaaS line item.
 */
/**
 * Dual-use SaaS — vendors that have legitimate R&D usage (e.g. AWS for
 * research compute, GitHub for R&D code, Notion / Slack as the R&D
 * team's working tools) AND legitimate non-R&D usage (marketing-site
 * hosting, sales-team docs, support channels). The stub can't tell
 * which usage applies from the vendor name alone — context resolves
 * it. See dualUseDecision() in classify() below.
 */
const DUAL_USE_VENDORS =
  /\b(?:aws|amazon\s+web|github|gitlab|notion|slack|jetbrains|zoom|datadog|sentry)\b/i;

/**
 * Project / recent-evidence keywords that, when present, indicate the
 * dual-use vendor is being used in an R&D context. Tuned against the
 * bulk-seed domain configs (every R&D project name contains one of
 * these), so dual-use SaaS in a research project gets supporting-
 * activity treatment rather than the ordinary-business exclusion.
 */
const RD_CONTEXT_KEYWORDS =
  /\b(?:research|laboratory|lab\s+(?:book|notebook)|experiment|prototype|hypothes[ie][sz]|measur(?:e|ed|ement)|simulation|model(?:ling|ing)?|R&D|R\s*&\s*D|alloy|electrolyser|catalyst|inference|kernel|fermentation|composite|robotic|autonomous|drone|bvlos|sense-and-avoid|leaching|cgm|wearable|narrative\s+gen|procedural\s+content|graphene|anode|biotech|fy26[\\/-]?27)\b/i;

/**
 * Admin-context keywords on the line-item DESCRIPTION specifically
 * (not project name). These override the dual-use project-context
 * routing: a row whose description says "sales team workspace" or
 * "annual PI premium" is admin even if the surrounding project is
 * R&D. Source: REFERENCE_DESCRIPTORS in tools/scripts/seed-bulk-claims.ts.
 */
const ADMIN_CONTEXT_KEYWORDS =
  /\b(?:sales\s+team|admin\s+team|marketing\s+(?:team|site|agency)|payroll\s+system|hr\s+system|stationery|conference\s+(?:booking|travel)|tax\s+prep(?:aration)?|pi\s+premium|insurance\s+(?:premium|renewal)|company\s+secretarial|general\s+counsel|fleet\s+fuel|office\s+lease|board\s+pack\s+production|crm\s+seats)\b/i;

const PATTERNS: Array<[RegExp, StubMatch]> = [
  // INELIGIBLE by line-item DESCRIPTION — admin / sales / marketing
  // /  HR / insurance / legal / travel keywords on the description take
  // priority over any vendor-name lookup. Catches the case where an
  // unfamiliar vendor (e.g. "IPS Construction") sends an invoice whose
  // line item reads "annual PI premium renewal" — the description is
  // unambiguous corporate spend regardless of who issued the invoice.
  [
    ADMIN_CONTEXT_KEYWORDS,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.88 },
  ],
  // CLEARLY INELIGIBLE — admin / sales / payments / collaboration SaaS
  // that have NO meaningful R&D usage pattern in the dataset.
  // Atlassian, Cloudflare, Zoom kept here because they're predominantly
  // admin-tool ecosystems even when an R&D team uses them; Stripe is
  // always payments. AWS / GitHub / Notion / Slack / JetBrains /
  // Datadog / Sentry moved out — see DUAL_USE_VENDORS below.
  [
    /\b(?:atlassian|stripe|cloudflare|miro|figma)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.92 },
  ],
  // INELIGIBLE — insurance, broker, risk transfer. The keywords here
  // need to be FULL words ("insurance" not "insur") because the
  // trailing `\b` checks the character after the match — "Aon Insur"
  // followed by "ance" has no word boundary, so a "insur" prefix
  // match would fail on real "Aon Insurance" vendor names. Same story
  // for the marsh group.
  [
    /\b(aon\s+(?:risk|insurance|aviation)|marsh(?:\s+(?:insurance|aviation|risk))?|nrma|qbe|insurance\s+(?:premium|renewal))\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — tax, accounting, audit, statutory advisory.
  [
    /\b(?:pwc(?:\s+tax)?|ey\s+tax|kpmg(?:\s+tax)?|deloitte(?:\s+tax)?|grant\s+thornton|bdo(?:\s+(?:tax|accounting))?)\b|\b(?:tax|board)\s+(?:prep|advisor(?:y)?|return|pack)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — corporate travel.
  [
    /\b(?:webjet|qantas|virgin\s+aus|jetstar|flight\s+centre)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — fuel cards, petrol, vehicle running costs.
  [
    /\b(?:caltex|starcard|bp\s+(?:fuel|diesel)|shell\s+(?:card|fuel))\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — non-R&D SaaS (sales / marketing / collab tools).
  [
    /\b(?:salesforce|hubspot|monday\.?com|asana|miro|figma)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — Australian telco accounts.
  [
    /\b(?:telstra|optus|vodafone(?:\s+aus)?|tpg\s+telecom)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — coworking / rent / office lease.
  [
    /\b(?:wework|hub\s+australia)\b|\b(?:office|premises)\s+(?:lease|rent)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — retail / general hardware stores.
  [
    /\b(?:officeworks|bunnings|jb\s+hi-?fi)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.9 },
  ],
  // INELIGIBLE — general legal services (patent / legal review is
  // caught by the §355-30 pattern below — order matters).
  [
    /\b(?:latitude\s+legal|general\s+counsel|company\s+secretarial)\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.85 },
  ],
  // INELIGIBLE — aviation regulator / permit fees (admin, not R&D).
  [
    /\bcasa\s+permit\b/i,
    { decision: 'ineligible', statutory_anchor: 'ineligible', confidence: 0.85 },
  ],
  // CLEARLY ELIGIBLE under §355-25 — research / lab / experimental vocabulary.
  [
    /research|laboratory|prototype|experiment|reagent|specimen|sigma[\s-]?aldrich|fisher scientific|thermo fisher|mass spectrometer/i,
    { decision: 'eligible', statutory_anchor: 's.355-25', confidence: 0.88 },
  ],
  // ELIGIBLE under §355-30 — supporting (scoping/feasibility/training/PM for R&D).
  [
    /scoping|feasibility|training|patent|legal review/i,
    { decision: 'eligible', statutory_anchor: 's.355-30', confidence: 0.78 },
  ],
];

/**
 * Deterministic regex-based expenditure classifier used in CI and as the
 * always-available fallback. Runs zero API calls and produces stable output
 * for the same input.
 *
 * The default classification when no rule matches is `needs_review` with
 * 0.50 confidence — conservative on purpose so unseen vendors land on a
 * consultant's queue rather than being silently called eligible/ineligible.
 *
 * `suggested_activity_id` is always null in the stub; activity matching is a
 * model-side judgement we do not approximate with regex.
 */
export class StubExpenditureClassifier implements ExpenditureClassifier {
  // Async signature is required by the ExpenditureClassifier interface even
  // though this implementation never awaits — keeps the interface symmetric
  // with OpusExpenditureClassifier.
  // eslint-disable-next-line @typescript-eslint/require-await
  async classify(input: ExpenditureClassifierInput): Promise<ExpenditureClassifierOutput> {
    const haystack = `${input.expenditure.vendor_name} ${input.expenditure.description ?? ''}`;
    let match: StubMatch = {
      decision: 'needs_review',
      // best-guess anchor when needs_review — runtime downgrade ignores it
      statutory_anchor: 'ineligible',
      confidence: 0.5,
    };
    // 1. Try the strict patterns first (cheap regex sweep).
    let strictMatched = false;
    for (const [re, m] of PATTERNS) {
      if (re.test(haystack)) {
        match = m;
        strictMatched = true;
        break;
      }
    }
    // 2. If nothing matched, check dual-use SaaS — these vendors have
    //    BOTH R&D and admin usage patterns, so we route by context:
    //    project name + recent_evidence_events summaries are scanned for
    //    R&D vocabulary. If present → eligible §355-30 (supporting).
    //    If absent → ineligible. This is what lets the stub call
    //    "AWS for an inference platform" eligible without calling
    //    "Slack Technologies for the sales team" eligible too.
    if (!strictMatched && DUAL_USE_VENDORS.test(haystack)) {
      // Line-item description is the strongest disambiguation signal
      // for dual-use vendors. If the description explicitly says
      // "sales team workspace" or "annual PI premium", route to
      // ineligible regardless of project context. Otherwise fall
      // through to the project-context check.
      const descAdmin = ADMIN_CONTEXT_KEYWORDS.test(input.expenditure.description ?? '');
      if (descAdmin) {
        match = {
          decision: 'ineligible',
          statutory_anchor: 'ineligible',
          confidence: 0.85,
        };
      } else {
        const context = [
          input.project.name,
          input.project.industry_sector ?? '',
          input.expenditure.description ?? '',
          ...input.recent_evidence_events.map((e) => e.summary),
        ].join(' ');
        if (RD_CONTEXT_KEYWORDS.test(context)) {
          match = {
            decision: 'eligible',
            statutory_anchor: 's.355-30',
            confidence: 0.7,
          };
        } else {
          match = {
            decision: 'ineligible',
            statutory_anchor: 'ineligible',
            confidence: 0.78,
          };
        }
      }
    }
    return {
      expenditure_id: input.expenditure_id,
      decision: match.decision,
      eligibility_probability: match.confidence,
      statutory_anchor: match.statutory_anchor,
      suggested_activity_id: null,
      rationale: `Stub match: ${match.decision} (vendor "${input.expenditure.vendor_name}").`,
      uncertainty_reason: match.decision === 'needs_review' ? 'No stub pattern matched.' : null,
      model: 'stub-v1.0.0',
      prompt_version: 'stub-v1.0.0',
      tokens_in: 0,
      tokens_out: 0,
    };
  }
}
