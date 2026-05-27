import Link from 'next/link';

// ---------------------------------------------------------------------------
// Explainers — 4 animated HTML files exported from the Claude design project.
// Each is a self-contained React-on-Babel-standalone scene sequence; we
// embed them via <iframe> so we don't have to port ~1500 lines of JSX
// into the Next.js component tree. Files live under
//   apps/web/public/marketing/explainers/
// ---------------------------------------------------------------------------

const HERO_EXPLAINER = '/marketing/explainers/archiveone-explainer.html';
const WIZARD_EXPLAINER = '/marketing/explainers/wizard-explainer.html';
const CLAIMANT_MOBILE = '/marketing/explainers/claimant-mobile.html';

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const primitives: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Evidence chain',
    body: 'Every R&D artefact — voice notes from the lab, Xero invoices, lab notebook PDFs, calculations, photos — lands in a forensic chain ledger, hash-stamped (SHA-256) at the moment of capture. AusIndustry reviewers see provenance, not interpretation.',
  },
  {
    title: 'Activity register',
    body: 'The platform clusters captured evidence into core and supporting activity proposals mapped to Division 355 of the ITAA 1997. Consultants review and approve; the system handles the §355-25(1)(a) experimentation-vocabulary work.',
  },
  {
    title: 'Narrative drafting',
    body: 'Multi-cycle narrative generation with citation-only summaries. Prior-year content is referenced by content_hash + segment_indices — never re-paraphrased — so a five-year claim history reads as one coherent program of research.',
  },
];

const surfaces: ReadonlyArray<{ title: string; body: string; tag?: string }> = [
  {
    title: 'Engagement letters',
    tag: 'Wizard step 01',
    body: 'Send, sign, countersign, and auto-expire the engagement letter inside the wizard. Mobile-first signing for the claimant; tokenised public links so a claimant who never logs in can still complete the letter; reminder + auto-expire daemon runs daily.',
  },
  {
    title: 'IP search',
    tag: 'Wizard step 02',
    body: 'Per-hypothesis prior-art search against patent, journal, and trade-press corpora. The agent emits verdicts (novel / overlapping / known) with citations; the wizard renders a PDF report that anchors the technical-uncertainty argument.',
  },
  {
    title: 'Expenditure mapping',
    body: 'Connect Xero or upload statements. The dedicated expenditure classifier applies Division 355-25(2)(a) ordinary-business exclusions against vendor + line-item descriptions, mapping the eligible dollars into apportioned activity buckets.',
  },
  {
    title: 'Claim pack export',
    body: 'Generates the AusIndustry application + ATO R&D Schedule with full audit trail. Every claimed activity carries its evidence-chain anchor; every dollar carries its mapping rationale.',
  },
];

const workflow: ReadonlyArray<readonly [string, string, string]> = [
  [
    '01',
    'Evidence intake',
    'Collect records as work happens, then preserve the source, timestamp, and context.',
  ],
  [
    '02',
    'Claim shaping',
    'Map records into activities, technical uncertainty, experiments, and expenditure support.',
  ],
  [
    '03',
    'Review pack',
    'Export narrative drafts, evidence indexes, schedules, and consultant review trails.',
  ],
];

const pilotSteps: ReadonlyArray<string> = [
  'Submit firm details — automatic eligibility screen',
  'Workspace and 30-day trial provisioned immediately',
  'Add your first claimant and R&D project',
  'Upload evidence — the platform classifies and drafts the activity register',
];

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

function Mark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3 w-3 rotate-45 border border-[#d8b15f] bg-[#d8b15f]/20 ${className}`}
      aria-hidden="true"
    />
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8d8476]">
      <span className="h-px w-10 bg-[#d8b15f]" />
      {children}
    </div>
  );
}

function ExplainerFrame({
  src,
  title,
  className,
}: {
  src: string;
  title: string;
  className: string;
}) {
  return (
    <div className={`overflow-hidden border border-[#f7f1e4]/14 bg-[#0a0a0a] ${className}`}>
      <iframe
        src={src}
        title={title}
        loading="lazy"
        // sandbox without allow-same-origin keeps the iframe content
        // boxed off from the host page; allow-scripts is required for
        // the React-on-Babel-standalone bootstrap.
        sandbox="allow-scripts"
        className="block h-full w-full border-0"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketingHomePage() {
  return (
    <main className="min-h-screen bg-[#10130f] text-[#f7f1e4]">
      {/* HERO — full-screen animated explainer. The iframe occupies 100vh;
          a thin top-bar overlays the brand + a single primary CTA so visitors
          can act without scrolling. The animation auto-plays in the iframe. */}
      <section className="relative h-screen w-full">
        <iframe
          src={HERO_EXPLAINER}
          title="ArchiveOne — Animated Explainer"
          sandbox="allow-scripts"
          className="absolute inset-0 h-full w-full border-0"
        />
        <nav className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto flex max-w-[1420px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            className="pointer-events-auto flex items-center gap-3 rounded-sm bg-[#0a0a0a]/55 px-3 py-2 backdrop-blur-sm"
          >
            <Mark className="shadow-[0_0_22px_rgba(216,177,95,0.55)]" />
            <span className="font-display text-2xl font-semibold tracking-tight">ArchiveOne</span>
          </Link>
          <div className="pointer-events-auto flex items-center gap-3">
            <Link
              href="/login"
              className="hidden border border-[#f7f1e4]/30 bg-[#0a0a0a]/55 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#f7f1e4] backdrop-blur-sm transition hover:border-[#d8b15f] hover:text-[#d8b15f] sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-[#d8b15f] px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#10130f] transition hover:bg-[#f0c96f]"
            >
              Start your trial
            </Link>
          </div>
        </nav>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex flex-col items-center gap-2 text-[#cfc5b3]">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#8d8476]">
            Scroll for the platform
          </span>
          <span className="h-4 w-px bg-[#d8b15f]" />
        </div>
      </section>

      {/* PRIMITIVES — the three foundations the platform is built on. */}
      <section
        id="primitives"
        className="border-y border-[#f7f1e4]/10 bg-[#f3ebdd] text-[#181a16]"
      >
        <div className="mx-auto max-w-[1420px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <SectionLabel>Three primitives</SectionLabel>
              <h2 className="mt-6 max-w-xl font-display text-5xl font-light leading-tight tracking-tight md:text-6xl">
                Evidence first, narrative second, claim pack last.
              </h2>
              <p className="mt-8 max-w-md font-body text-base leading-7 text-[#5f5a50]">
                Three foundations that make every claim defensible by construction. Add evidence
                contemporaneously; the rest of the platform composes on top.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-1">
              {primitives.map(({ title, body }) => (
                <article key={title} className="border border-[#181a16]/15 bg-white p-6">
                  <Mark />
                  <h3 className="mt-6 font-display text-3xl font-light">{title}</h3>
                  <p className="mt-4 font-body text-sm leading-7 text-[#5f5a50]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* VIDEO 02 — wizard explainer. Sized to a comfortable 16:9 viewport
          within the page; iframe plays a multi-scene animation of the
          consultant wizard. */}
      <section className="border-b border-[#f7f1e4]/10 bg-[#10130f]">
        <div className="mx-auto max-w-[1420px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <SectionLabel>Inside the wizard</SectionLabel>
              <h2 className="mt-6 font-display text-5xl font-light leading-tight tracking-tight md:text-6xl">
                Six steps from engagement letter to AusIndustry submission.
              </h2>
            </div>
            <p className="max-w-2xl font-body text-base leading-8 text-[#cfc5b3] md:text-lg md:leading-9">
              The consultant workspace walks each claim through the same six gates — engagement,
              hypotheses, activities, apportionment, evidence, review. Every gate writes to the
              evidence chain; nothing skips review.
            </p>
          </div>
          <ExplainerFrame
            src={WIZARD_EXPLAINER}
            title="ArchiveOne — Claim Wizard & Workflow Explainer"
            className="mt-12 aspect-video w-full shadow-[0_32px_120px_rgba(0,0,0,0.45)]"
          />
        </div>
      </section>

      {/* SURFACES — the shipped surfaces. Two of these (Engagement letters,
          IP search) were finalised this week — flagged with a "Wizard step"
          tag so the just-merged work shows. */}
      <section id="surfaces" className="border-b border-[#f7f1e4]/10 bg-[#161a14]">
        <div className="mx-auto max-w-[1420px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <SectionLabel>What ships in the box</SectionLabel>
              <h2 className="mt-6 max-w-xl font-display text-5xl font-light leading-tight tracking-tight md:text-6xl">
                Surfaces consultants already use.
              </h2>
              <p className="mt-8 max-w-md font-body text-base leading-7 text-[#cfc5b3]">
                Built for the work consulting firms already do. The platform shapes raw lab activity
                into an AusIndustry-ready submission without asking the consultant to change how
                they advise their clients.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {surfaces.map(({ title, body, tag }) => (
                <article
                  key={title}
                  className="flex flex-col border border-[#f7f1e4]/14 bg-[#0d100c] p-6"
                >
                  <div className="flex items-center justify-between">
                    <Mark />
                    {tag && (
                      <span className="border border-[#d8b15f]/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#d8b15f]">
                        {tag}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-6 font-display text-3xl font-light text-[#f7f1e4]">{title}</h3>
                  <p className="mt-4 font-body text-sm leading-7 text-[#bcb2a0]">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* VIDEO 03 — claimant mobile. The 9:16 framing matches the actual
          phone form factor of the capture app. */}
      <section className="border-b border-[#f7f1e4]/10 bg-[#10130f]">
        <div className="mx-auto max-w-[1420px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <SectionLabel>Claimant capture, in the field</SectionLabel>
              <h2 className="mt-6 font-display text-5xl font-light leading-tight tracking-tight md:text-6xl">
                Evidence enters the chain at the moment of capture.
              </h2>
              <p className="mt-8 max-w-2xl font-body text-base leading-8 text-[#cfc5b3] md:text-lg md:leading-9">
                The claimant mobile app is the field side of the chain. Voice notes, photos,
                timestamps, GPS context — captured on a phone, hashed locally, forwarded into the
                consultant workspace where the activity register and narrative drafter take over.
                Engagement letters can be signed first-launch, before any evidence is captured.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="bg-[#d8b15f] px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#10130f] transition hover:bg-[#f0c96f]"
                >
                  Start your trial
                </Link>
                <Link
                  href="#pilot"
                  className="border border-[#f7f1e4]/20 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#f7f1e4] transition hover:border-[#d8b15f] hover:text-[#d8b15f]"
                >
                  Pilot details ↓
                </Link>
              </div>
            </div>
            <ExplainerFrame
              src={CLAIMANT_MOBILE}
              title="ArchiveOne — Claimant mobile app"
              className="mx-auto aspect-[9/16] w-full max-w-[420px] shadow-[0_32px_120px_rgba(0,0,0,0.45)]"
            />
          </div>
        </div>
      </section>

      {/* WORKFLOW — the same 3-line story we tell elsewhere. */}
      <section id="workflow" className="border-b border-[#f7f1e4]/10">
        <div className="mx-auto max-w-[1420px] px-5 py-24 sm:px-8 lg:px-12">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <SectionLabel>Workflow</SectionLabel>
              <h2 className="mt-6 max-w-4xl font-display text-5xl font-light leading-tight tracking-tight md:text-7xl">
                From first record to final claim pack.
              </h2>
            </div>
            <Link
              href="/signup"
              className="w-fit border border-[#f7f1e4]/25 px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#f7f1e4] transition hover:border-[#d8b15f] hover:text-[#d8b15f]"
            >
              Apply for access
            </Link>
          </div>
          <div className="mt-12 divide-y divide-[#f7f1e4]/10 border-y border-[#f7f1e4]/10">
            {workflow.map(([step, title, body]) => (
              <article
                key={step}
                className="grid gap-4 py-6 md:grid-cols-[110px_0.65fr_1fr] md:items-center"
              >
                <span className="font-mono text-2xl text-[#d8b15f]">{step}</span>
                <h3 className="font-display text-3xl font-light text-[#f7f1e4]">{title}</h3>
                <p className="font-body text-sm leading-7 text-[#cfc5b3]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* PILOT — same intake copy + CTA as before. */}
      <section id="pilot" className="bg-[#161a14]">
        <div className="mx-auto grid max-w-[1420px] gap-10 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:px-12">
          <div>
            <SectionLabel>Pilot intake</SectionLabel>
            <h2 className="mt-6 max-w-4xl font-display text-5xl font-light leading-tight tracking-tight md:text-7xl">
              Stand up your firm&rsquo;s first claim before lunch.
            </h2>
          </div>
          <div className="border border-[#f7f1e4]/16 bg-[#0d100c] p-6">
            <p className="font-body text-base leading-8 text-[#cfc5b3]">
              Self-serve workspace provisioning for qualifying R&amp;DTI consulting firms. No
              procurement cycle, no implementation week — submit your firm details and the system
              provisions the workspace, primes a fiscal-year claim, and walks you through the first
              evidence intake.
            </p>
            <div className="mt-8 grid gap-3">
              {pilotSteps.map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-4 border border-[#f7f1e4]/10 bg-[#161a14] p-4"
                >
                  <span className="font-mono text-sm text-[#d8b15f]">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="font-body text-sm text-[#cfc5b3]">{item}</span>
                </div>
              ))}
            </div>
            <Link
              href="/signup"
              className="mt-8 inline-flex bg-[#d8b15f] px-5 py-4 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#10130f] transition hover:bg-[#f0c96f]"
            >
              Request founder workspace
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
