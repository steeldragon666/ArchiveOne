'use client';
/**
 * Per-hypothesis card for Wizard Step 2 — IP search.
 *
 * Linear flow:
 *
 *   [Generate search queries]
 *     ↓ (queries appear; consultant ticks/unticks)
 *   [Run selected searches]
 *     ↓ (hits appear, grouped by database)
 *   [Draft verdict]
 *     ↓ (LLM draft appears)
 *   [Approve verdict]  /  [Override] → modal with reasoning
 *
 * Each step is its own button — the card disables later buttons until
 * the prerequisite step has been completed for THIS hypothesis. The
 * card is self-contained; state (queries, hits, verdict) lives in
 * useState here. The list of approved verdicts is fed in as a prop so
 * the parent can render a "claim-wide" summary above the cards.
 */

import { useMemo, useState } from 'react';
import {
  useGenerateQueries,
  useRunSearches,
  useDraftVerdict,
  useApproveVerdict,
  useOverrideVerdict,
  type GeneratedQueries,
  type IpSearchDatabase,
  type IpSearchRunResult,
  type IpSearchVerdictRow,
  type IpSearchVerdictValue,
} from '@/lib/hooks/use-ip-search';
import {
  amber,
  amberSoft,
  bone,
  bone2,
  bone3,
  bone4,
  fMono,
  fSans,
  fSerif,
  ink2,
  ink3,
  rule,
  ruleStrong,
  rust,
  sage,
} from './tokens';

interface HypothesisCardProps {
  claimId: string;
  activityId: string;
  hypothesisText: string;
  /** Existing verdict for this hypothesis (rendered from list endpoint). */
  existingVerdict: IpSearchVerdictRow | null;
}

const DATABASE_LABELS: Record<IpSearchDatabase, string> = {
  ip_australia: 'IP AUSTRALIA',
  semantic_scholar: 'SEMANTIC SCHOLAR',
  pubmed: 'PUBMED',
  arxiv: 'ARXIV',
};

const VERDICT_COLOR: Record<IpSearchVerdictValue, string> = {
  pass: sage,
  fail: rust,
  inconclusive: amberSoft,
};

export function HypothesisCard({
  claimId,
  activityId,
  hypothesisText,
  existingVerdict,
}: HypothesisCardProps) {
  // Stage-local state.
  const [queries, setQueries] = useState<GeneratedQueries | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [runResults, setRunResults] = useState<IpSearchRunResult[] | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  const generateMut = useGenerateQueries();
  const runMut = useRunSearches();
  const draftMut = useDraftVerdict();
  const approveMut = useApproveVerdict();
  const overrideMut = useOverrideVerdict();

  // The draft response is rendered if newly produced this session;
  // otherwise we fall back to `existingVerdict` from the list endpoint.
  const draftedThisSession = draftMut.data;
  const displayedVerdict = draftedThisSession ?? existingVerdict;

  const selectionKey = (database: IpSearchDatabase, query: string): string =>
    `${database}::${query}`;

  const handleGenerate = async (): Promise<void> => {
    const res = await generateMut.mutateAsync({ claimId, activityId, hypothesisText });
    setQueries(res.queries);
    // Default to all queries ticked — analyst can untick as needed.
    const initial: Record<string, boolean> = {};
    for (const db of Object.keys(res.queries) as IpSearchDatabase[]) {
      for (const q of res.queries[db]) {
        initial[selectionKey(db, q)] = true;
      }
    }
    setSelected(initial);
  };

  const handleRun = async (): Promise<void> => {
    if (!queries) return;
    const filtered: GeneratedQueries = {
      ip_australia: queries.ip_australia.filter((q) => selected[selectionKey('ip_australia', q)]),
      semantic_scholar: queries.semantic_scholar.filter(
        (q) => selected[selectionKey('semantic_scholar', q)],
      ),
      pubmed: queries.pubmed.filter((q) => selected[selectionKey('pubmed', q)]),
      arxiv: queries.arxiv.filter((q) => selected[selectionKey('arxiv', q)]),
    };
    const res = await runMut.mutateAsync({
      claimId,
      activityId,
      hypothesisText,
      queries: filtered,
    });
    setRunResults(res.runs);
  };

  const handleDraftVerdict = async (): Promise<void> => {
    await draftMut.mutateAsync({ claimId, activityId, hypothesisText });
  };

  const handleApprove = async (): Promise<void> => {
    const vId = displayedVerdict?.id;
    if (!vId) return;
    await approveMut.mutateAsync({ verdictId: vId, claimId });
  };

  const totalHits = useMemo(() => {
    if (!runResults) return 0;
    return runResults.reduce((acc, r) => acc + r.hits.length, 0);
  }, [runResults]);

  const approved = existingVerdict?.status === 'approved';

  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
        padding: 22,
        marginBottom: 14,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: fMono,
              fontSize: 10,
              color: amber,
              letterSpacing: '0.16em',
              marginBottom: 6,
            }}
          >
            HYPOTHESIS
          </div>
          <div
            style={{
              fontFamily: fSerif,
              fontSize: 17,
              color: bone,
              lineHeight: 1.4,
              maxWidth: 700,
            }}
          >
            {hypothesisText}
          </div>
        </div>
        {displayedVerdict && <VerdictBadge value={displayedVerdict.verdict} approved={approved} />}
      </div>

      {/* Step 1: generate */}
      <Section title="01 · GENERATE QUERIES">
        {queries === null ? (
          <button
            onClick={() => {
              void handleGenerate();
            }}
            disabled={generateMut.isPending}
            style={primaryButton}
          >
            {generateMut.isPending ? 'GENERATING…' : 'GENERATE SEARCH QUERIES'}
          </button>
        ) : (
          <>
            {(Object.keys(queries) as IpSearchDatabase[]).map((db) => (
              <div key={db} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontFamily: fMono,
                    fontSize: 10,
                    color: bone3,
                    letterSpacing: '0.14em',
                    marginBottom: 6,
                  }}
                >
                  {DATABASE_LABELS[db]}
                </div>
                {queries[db].map((q) => {
                  const key = selectionKey(db, q);
                  return (
                    <label
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 10,
                        padding: '4px 0',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected[key] ?? false}
                        onChange={(e) =>
                          setSelected((prev) => ({ ...prev, [key]: e.target.checked }))
                        }
                        style={{ marginTop: 4 }}
                      />
                      <span style={{ fontFamily: fSans, fontSize: 13, color: bone2 }}>{q}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </>
        )}
        {generateMut.isError && <ErrorText>Failed to generate queries. Try again.</ErrorText>}
      </Section>

      {/* Step 2: run */}
      {queries !== null && (
        <Section title="02 · RUN SEARCHES">
          {runResults === null ? (
            <button
              onClick={() => {
                void handleRun();
              }}
              disabled={runMut.isPending}
              style={primaryButton}
            >
              {runMut.isPending ? 'SEARCHING…' : 'RUN SELECTED SEARCHES'}
            </button>
          ) : (
            <div>
              <div style={{ fontFamily: fSans, fontSize: 14, color: bone2, marginBottom: 8 }}>
                Found <strong style={{ color: amber }}>{totalHits}</strong> hits across{' '}
                {runResults.filter((r) => r.source !== 'error').length} successful queries.
              </div>
              <RunResultsSummary runs={runResults} />
            </div>
          )}
          {runMut.isError && <ErrorText>Run failed. Try again.</ErrorText>}
        </Section>
      )}

      {/* Step 3: verdict */}
      {runResults !== null && displayedVerdict === null && (
        <Section title="03 · DRAFT VERDICT">
          <button
            onClick={() => {
              void handleDraftVerdict();
            }}
            disabled={draftMut.isPending}
            style={primaryButton}
          >
            {draftMut.isPending ? 'DRAFTING…' : 'DRAFT VERDICT'}
          </button>
          {draftMut.isError && <ErrorText>Verdict drafting failed.</ErrorText>}
        </Section>
      )}

      {displayedVerdict && (
        <Section title={approved ? '03 · APPROVED VERDICT' : '03 · DRAFT VERDICT'}>
          <div
            style={{
              fontFamily: fSans,
              fontSize: 13.5,
              color: bone2,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              padding: '10px 0',
            }}
          >
            {displayedVerdict.analysisMarkdown}
          </div>
          {!approved && (
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                onClick={() => {
                  void handleApprove();
                }}
                disabled={approveMut.isPending}
                style={primaryButton}
              >
                {approveMut.isPending ? 'APPROVING…' : 'APPROVE VERDICT'}
              </button>
              <button onClick={() => setShowOverride(true)} style={secondaryButton}>
                OVERRIDE
              </button>
            </div>
          )}
        </Section>
      )}

      {/* Override modal */}
      {showOverride && displayedVerdict && (
        <OverrideModal
          claimId={claimId}
          verdictId={displayedVerdict.id}
          currentVerdict={displayedVerdict.verdict}
          onClose={() => setShowOverride(false)}
          onSubmit={async (verdict, reasoning) => {
            await overrideMut.mutateAsync({
              verdictId: displayedVerdict.id,
              claimId,
              verdict,
              reasoningMarkdown: reasoning,
            });
            setShowOverride(false);
          }}
          isPending={overrideMut.isPending}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${rule}`, marginTop: 18, paddingTop: 14 }}>
      <div
        style={{
          fontFamily: fMono,
          fontSize: 10,
          color: bone3,
          letterSpacing: '0.18em',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function VerdictBadge({ value, approved }: { value: IpSearchVerdictValue; approved: boolean }) {
  return (
    <div
      style={{
        padding: '6px 12px',
        border: `1px solid ${VERDICT_COLOR[value]}`,
        borderRadius: 3,
        fontFamily: fMono,
        fontSize: 10,
        color: VERDICT_COLOR[value],
        letterSpacing: '0.18em',
      }}
    >
      {approved ? '' : 'DRAFT · '}
      {value.toUpperCase()}
    </div>
  );
}

function RunResultsSummary({ runs }: { runs: IpSearchRunResult[] }) {
  // Group by database.
  const byDb = new Map<IpSearchDatabase, IpSearchRunResult[]>();
  for (const r of runs) {
    const list = byDb.get(r.database) ?? [];
    list.push(r);
    byDb.set(r.database, list);
  }
  return (
    <div>
      {Array.from(byDb.entries()).map(([db, list]) => {
        const total = list.reduce((acc, r) => acc + r.hits.length, 0);
        const cached = list.filter((r) => r.source === 'cache').length;
        const errored = list.filter((r) => r.source === 'error').length;
        return (
          <div
            key={db}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              fontFamily: fSans,
              fontSize: 13,
              color: bone2,
            }}
          >
            <span
              style={{ fontFamily: fMono, fontSize: 10, color: bone3, letterSpacing: '0.14em' }}
            >
              {DATABASE_LABELS[db]}
            </span>
            <span>
              {total} hits
              {cached > 0 ? ` (${cached} cached)` : ''}
              {errored > 0 ? ` · ${errored} errored` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface OverrideModalProps {
  claimId: string;
  verdictId: string;
  currentVerdict: IpSearchVerdictValue;
  onClose: () => void;
  onSubmit: (verdict: IpSearchVerdictValue, reasoning: string) => Promise<void>;
  isPending: boolean;
}

function OverrideModal({ currentVerdict, onClose, onSubmit, isPending }: OverrideModalProps) {
  const [verdict, setVerdict] = useState<IpSearchVerdictValue>(currentVerdict);
  const [reasoning, setReasoning] = useState('');
  // 30-char floor mirrors the API's OverrideBody zod schema.
  const canSubmit = reasoning.trim().length >= 30 && !isPending;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: ink3,
          border: `1px solid ${ruleStrong}`,
          borderRadius: 4,
          padding: 28,
          width: 560,
          maxWidth: '92vw',
        }}
      >
        <div
          style={{
            fontFamily: fMono,
            fontSize: 10,
            color: amber,
            letterSpacing: '0.18em',
            marginBottom: 14,
          }}
        >
          OVERRIDE VERDICT
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontFamily: fMono,
              fontSize: 10,
              color: bone3,
              letterSpacing: '0.14em',
              marginBottom: 6,
            }}
          >
            VERDICT
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['pass', 'fail', 'inconclusive'] as IpSearchVerdictValue[]).map((v) => (
              <button
                key={v}
                onClick={() => setVerdict(v)}
                style={{
                  padding: '8px 14px',
                  background: verdict === v ? amber : 'transparent',
                  color: verdict === v ? '#0b0b0d' : bone2,
                  border: `1px solid ${verdict === v ? amber : ruleStrong}`,
                  borderRadius: 3,
                  fontFamily: fMono,
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  cursor: 'pointer',
                }}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontFamily: fMono,
              fontSize: 10,
              color: bone3,
              letterSpacing: '0.14em',
              marginBottom: 6,
            }}
          >
            REASONING (30+ CHARS REQUIRED)
          </div>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows={6}
            style={{
              width: '100%',
              background: ink2,
              border: `1px solid ${ruleStrong}`,
              borderRadius: 3,
              padding: 10,
              color: bone,
              fontFamily: fSans,
              fontSize: 13,
              resize: 'vertical',
            }}
            placeholder="Explain why the LLM's draft verdict is wrong, citing the specific hits or evidence that change the conclusion…"
          />
          <div style={{ fontFamily: fMono, fontSize: 10, color: bone4, marginTop: 4 }}>
            {reasoning.trim().length} / 30 chars min
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={secondaryButton}>
            CANCEL
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => {
              void onSubmit(verdict, reasoning);
            }}
            style={{
              ...primaryButton,
              opacity: canSubmit ? 1 : 0.4,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {isPending ? 'OVERRIDING…' : 'SUBMIT OVERRIDE'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: fMono,
        fontSize: 11,
        color: rust,
        letterSpacing: '0.08em',
        marginTop: 8,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared button styles
// ---------------------------------------------------------------------------

const primaryButton: React.CSSProperties = {
  padding: '9px 14px',
  background: amber,
  color: '#0b0b0d',
  border: 'none',
  borderRadius: 3,
  fontFamily: fMono,
  fontSize: 11,
  letterSpacing: '0.16em',
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryButton: React.CSSProperties = {
  padding: '9px 14px',
  background: 'transparent',
  color: bone2,
  border: `1px solid ${ruleStrong}`,
  borderRadius: 3,
  fontFamily: fMono,
  fontSize: 11,
  letterSpacing: '0.16em',
  cursor: 'pointer',
};
