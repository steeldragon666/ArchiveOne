// Centralised mock data — Australian R&D Tax Incentive (R&DTI) context.
// Income year FY24-25 (year ending 30 June 2025). AUD throughout.

export function fmtAUD(n: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  const { compact = false, decimals = 0 } = opts;
  if (compact) {
    if (n >= 1_000_000) return 'A$' + (n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2) + 'M';
    if (n >= 1_000) return 'A$' + (n / 1_000).toFixed(0) + 'k';
  }
  return (
    'A$' +
    n.toLocaleString('en-AU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
}

export const COMPANY = {
  name: 'Quanta Research Pty Ltd',
  abn: '47 102 837 991',
  aggTurnover: 14_200_000,
  fy: 'FY24-25',
  fyEnd: '30 June 2025',
  registrationDeadline: '30 April 2026',
};

export type ProjectStatus = 'active' | 'review' | 'draft';
export type ProjectColor = 'primary' | 'secondary' | 'tertiary' | 'warn';

export interface Project {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  coreActivities: number;
  supportingActivities: number;
  contemporaneousEvidence: number;
  coreSpend: number;
  supportSpend: number;
  confidence: number;
  aiNote: string;
  owners: string[];
  color: ProjectColor;
}

export const PROJECTS: Project[] = [
  {
    id: 'p-neural-core',
    code: 'RD-001',
    name: 'Neural Core v2 — Edge Inference',
    status: 'active',
    coreActivities: 2,
    supportingActivities: 4,
    contemporaneousEvidence: 152,
    coreSpend: 412_000,
    supportSpend: 188_000,
    confidence: 96,
    aiNote: 'Strong systematic progression of work; hypotheses and outcomes are well documented.',
    owners: ['Maya Chen', 'Daniel Park'],
    color: 'primary',
  },
  {
    id: 'p-data-pipeline',
    code: 'RD-002',
    name: 'Petabyte-scale Streaming Ingestion',
    status: 'active',
    coreActivities: 1,
    supportingActivities: 3,
    contemporaneousEvidence: 89,
    coreSpend: 198_000,
    supportSpend: 76_000,
    confidence: 88,
    aiNote: 'Sharding latency uncertainty meets s.355-25 test. Confirm supporting activity scope.',
    owners: ['Priya Natarajan'],
    color: 'secondary',
  },
  {
    id: 'p-cryo-cooling',
    code: 'RD-003',
    name: 'Adaptive Cooling Loop for ML Compute',
    status: 'review',
    coreActivities: 1,
    supportingActivities: 2,
    contemporaneousEvidence: 47,
    coreSpend: 84_000,
    supportSpend: 21_000,
    confidence: 71,
    aiNote:
      'Some experimental records missing. Three engineers flagged for time-allocation review.',
    owners: ['Wei Zhang'],
    color: 'tertiary',
  },
  {
    id: 'p-fed-learning',
    code: 'RD-004',
    name: 'Federated Learning Privacy Layer',
    status: 'draft',
    coreActivities: 1,
    supportingActivities: 1,
    contemporaneousEvidence: 12,
    coreSpend: 38_000,
    supportSpend: 9_000,
    confidence: 54,
    aiNote: 'Early-stage. Recommend logging hypothesis and intended experiments now.',
    owners: ['Ayesha Khan'],
    color: 'warn',
  },
];

export const TOTAL_CORE = PROJECTS.reduce((s, p) => s + p.coreSpend, 0);
export const TOTAL_SUPPORT = PROJECTS.reduce((s, p) => s + p.supportSpend, 0);
export const TOTAL_NOTIONAL = TOTAL_CORE + TOTAL_SUPPORT;
export const REFUNDABLE_OFFSET = Math.round(TOTAL_NOTIONAL * 0.435);
export const COMPANY_TAX = Math.round(TOTAL_NOTIONAL * 0.25);
export const NET_BENEFIT = REFUNDABLE_OFFSET - COMPANY_TAX;

export interface ExpenditureCategory {
  id: string;
  label: string;
  amount: number;
  pct: number;
}

export const EXPENDITURE_CATEGORIES: ExpenditureCategory[] = [
  { id: 'salary', label: 'Salary & wages', amount: 412_000, pct: 47 },
  { id: 'contractor', label: 'Contractor expenditure', amount: 168_000, pct: 19 },
  { id: 'overhead', label: 'Apportioned overheads', amount: 122_000, pct: 14 },
  { id: 'cloud', label: 'Cloud compute', amount: 98_000, pct: 11 },
  { id: 'materials', label: 'Materials & consumables', amount: 54_000, pct: 6 },
  { id: 'depreciation', label: 'R&D asset depreciation', amount: 30_000, pct: 3 },
];

export interface Engineer {
  id: string;
  name: string;
  role: string;
  rdPct: number;
  hours: number;
  salary: number;
  aiNote: string;
}

export const ENGINEERS: Engineer[] = [
  {
    id: 'e1',
    name: 'Maya Chen',
    role: 'Principal ML Engineer',
    rdPct: 82,
    hours: 1640,
    salary: 215_000,
    aiNote: 'Pull-request signature matches core experimental work.',
  },
  {
    id: 'e2',
    name: 'Daniel Park',
    role: 'Senior ML Engineer',
    rdPct: 74,
    hours: 1480,
    salary: 175_000,
    aiNote: 'Hypothesis log entries strong; some admin time should be excluded.',
  },
  {
    id: 'e3',
    name: 'Priya Natarajan',
    role: 'Data Platform Lead',
    rdPct: 61,
    hours: 1220,
    salary: 198_000,
    aiNote: 'Mixed BAU + R&D. Time-tracking suggests 61% R&D split.',
  },
  {
    id: 'e4',
    name: 'Wei Zhang',
    role: 'Systems Engineer',
    rdPct: 48,
    hours: 960,
    salary: 162_000,
    aiNote: 'Cooling-loop experiments documented; supporting activity classification.',
  },
  {
    id: 'e5',
    name: 'Ayesha Khan',
    role: 'Research Engineer',
    rdPct: 92,
    hours: 1840,
    salary: 156_000,
    aiNote: 'Strong R&D signal across Jira and commits.',
  },
  {
    id: 'e6',
    name: 'Tomás Rivera',
    role: 'DevOps Engineer',
    rdPct: 22,
    hours: 440,
    salary: 148_000,
    aiNote: 'Mostly BAU. Cloud-compute work attributable to RD-002.',
  },
  {
    id: 'e7',
    name: 'Ines Laurent',
    role: 'ML Researcher',
    rdPct: 88,
    hours: 1760,
    salary: 168_000,
    aiNote: 'Eligible. Confirm publication-vs-experimentation split.',
  },
];

export type EvidenceKind =
  | 'hypothesis'
  | 'expenditure'
  | 'evidence'
  | 'experiment'
  | 'consolidation';

export interface EvidenceItem {
  id: string;
  date: string;
  monthLabel: string;
  year: string;
  kind: EvidenceKind;
  icon: string;
  color: 'primary' | 'warn' | 'success' | 'secondary';
  title: string;
  subtitle: string;
  body?: string;
  tags?: Array<{ icon: string; label: string }>;
  people?: string[];
  amount?: number;
  stats?: Array<{ value: string; label: string }>;
  confidence: number;
}

export const EVIDENCE_TIMELINE: EvidenceItem[] = [
  {
    id: 'ev-1',
    date: '2024-07-12',
    monthLabel: 'JUL',
    year: '2024',
    kind: 'hypothesis',
    icon: 'psychology',
    color: 'primary',
    title: 'Hypothesis logged — Neural Core v2',
    subtitle: "AI agent detected novel R&D activity in repository 'core-engine'",
    body: 'Hypothesis: pruning attention heads by 40% will yield <5% accuracy loss for edge devices. Systematic progression of work commences. Mapped to s.355-25 ITAA 1997 core activity test.',
    tags: [
      { icon: 'code', label: 'PR #482' },
      { icon: 'description', label: 'Tech spec v1.0' },
    ],
    confidence: 94,
  },
  {
    id: 'ev-2',
    date: '2024-08-28',
    monthLabel: 'AUG',
    year: '2024',
    kind: 'expenditure',
    icon: 'payments',
    color: 'warn',
    title: 'Expenditure mapping — Q1 cloud compute',
    subtitle: 'AWS GPU instances attributed to Neural Core v2 hypothesis testing',
    amount: 42_850,
    confidence: 98,
  },
  {
    id: 'ev-3',
    date: '2024-09-15',
    monthLabel: 'SEP',
    year: '2024',
    kind: 'evidence',
    icon: 'attachment',
    color: 'success',
    title: 'Engineering log — Jira ticket R&D-992',
    subtitle: 'Parallel processing bottlenecks — technical uncertainty captured',
    body: '"The team encountered significant latency spikes during the sharding phase. AI agent logs indicate this as a technical uncertainty requiring three weeks of unplanned iteration…"',
    people: ['Maya Chen', 'Daniel Park'],
    confidence: 91,
  },
  {
    id: 'ev-4',
    date: '2024-11-04',
    monthLabel: 'NOV',
    year: '2024',
    kind: 'experiment',
    icon: 'science',
    color: 'primary',
    title: 'Experimental result — pruning trial 7B',
    subtitle: 'Accuracy delta −3.8% on ImageNet-1k subset; latency improved 2.4×',
    body: 'Result outside prior knowledge of competent professional. Activity continues — supporting activity "kernel rewrite" triggered.',
    confidence: 97,
  },
  {
    id: 'ev-5',
    date: '2025-02-22',
    monthLabel: 'FEB',
    year: '2025',
    kind: 'evidence',
    icon: 'groups',
    color: 'secondary',
    title: 'Team time allocation — Q3 timesheet review',
    subtitle: 'AI reconciled 1,484 timesheet entries against project tags',
    confidence: 86,
  },
  {
    id: 'ev-6',
    date: '2025-03-31',
    monthLabel: 'MAR',
    year: '2025',
    kind: 'consolidation',
    icon: 'auto_awesome',
    color: 'primary',
    title: 'AI milestone consolidation',
    subtitle: 'Automated grouping of 152 evidence items for FY year-end',
    stats: [
      { value: '152', label: 'Docs linked' },
      { value: '14', label: 'Commits' },
      { value: 'A$284k', label: 'Total value' },
    ],
    confidence: 95,
  },
];

export interface AIMessage {
  role: 'agent' | 'user' | 'agent-streaming';
  time: string;
  content: string;
  actions?: Array<{ label: string; action: string }>;
  citations?: Array<{ kind: string; label: string; confidence: number }>;
}

export const AI_MESSAGES: AIMessage[] = [
  {
    role: 'agent',
    time: '09:42',
    content:
      "I've finished sweeping FY24-25 evidence. Total notional deduction is tracking at A$1.04M — that's a A$192k net cash benefit after the 43.5% refundable offset and base-rate company tax.",
    actions: [{ label: 'Show the calculation', action: 'explain-offset' }],
  },
  {
    role: 'user',
    time: '09:43',
    content: "What's blocking us from submitting today?",
  },
  {
    role: 'agent',
    time: '09:43',
    content:
      "Three items. RD-003 needs three timesheet allocations confirmed by Wei Zhang. RD-004 is missing a hypothesis log — I've drafted one for review. And the AusIndustry registration narrative for RD-001 is awaiting your sign-off.",
    citations: [
      { kind: 'evidence', label: 'Wei Zhang — Mar timesheet', confidence: 71 },
      { kind: 'draft', label: 'Draft hypothesis: Federated Privacy Layer', confidence: 84 },
    ],
  },
];

export const QUICK_PROMPTS = [
  "Why is RD-003's confidence at 71%?",
  'Generate the technical narrative for RD-001.',
  "What's eligible under s.355-25 here?",
  'Compare core vs supporting spend across projects.',
];

export interface NarrativeSection {
  heading: string;
  body: string;
  citations: string[];
  confidence: number;
}

export const NARRATIVE_DRAFT = {
  project: 'RD-001 — Neural Core v2 — Edge Inference',
  sections: [
    {
      heading: '1. New knowledge sought (s.355-25(1)(b))',
      body: 'Quanta Research undertook a systematic progression of work to determine whether transformer attention mechanisms could be pruned by ≥40% on edge hardware while preserving inference accuracy within a 5 percentage-point band. At commencement, no published technique addressed this combination of parameters for the Tegra-class targets in scope. The competent professional could not, on the basis of current knowledge or experience, deduce the outcome in advance.',
      citations: ['PR #482', 'Tech spec v1.0', 'Lit review — Aug 2024'],
      confidence: 96,
    },
    {
      heading: '2. Hypothesis',
      body: 'Structured magnitude-based pruning of attention heads, combined with a re-distilled feed-forward stack, would yield ≥2× inference latency improvement at ≤5pp accuracy loss on a representative ImageNet-1k subset, on Tegra-class hardware with ≤8GB VRAM.',
      citations: ['Hypothesis log v1.0'],
      confidence: 94,
    },
    {
      heading: '3. Experiments conducted',
      body: 'Twenty-three experimental runs were completed between August 2024 and February 2025. Each run varied pruning ratio, distillation temperature and the kernel-fusion strategy. Outcomes were recorded against a control configuration, with telemetry captured for both accuracy and end-to-end latency.',
      citations: ['Jira R&D-992', 'Experimental results — pruning 7A–7M', 'Telemetry export Q3'],
      confidence: 97,
    },
    {
      heading: '4. Evaluation of results',
      body: 'The leading configuration achieved −3.8% accuracy delta and a 2.4× latency improvement, satisfying the hypothesis. A residual instability under batch-size 1 inference was identified as an unresolved technical uncertainty and progressed into FY25-26 as a continuation activity.',
      citations: ['Result memo — Nov 2024', 'Telemetry export Q4'],
      confidence: 92,
    },
  ] satisfies NarrativeSection[],
};

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'allocation', label: 'Activity Allocation', icon: 'assignment_ind' },
  { id: 'timeline', label: 'Evidence & Timeline', icon: 'timeline' },
  { id: 'submit', label: 'Submit Claim', icon: 'send' },
  { id: 'narrative', label: 'Narrative', icon: 'history_edu' },
];
