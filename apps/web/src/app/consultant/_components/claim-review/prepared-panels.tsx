import type { ReactNode } from 'react';
import {
  amber,
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
} from '../tokens';
import { Diamond, MonoLabel } from '../atoms';
import type {
  PreparedActivity,
  PreparedActivityEvidence,
  PreparedContent,
  PreparedExpenditureLine,
  PreparedHypothesis,
  PreparedNarrativeSection,
} from '../claims-api';
import { ContentCard, KeyVal, Stat } from './primitives';
import { formatAud, truncate } from './utils';

/**
 * Render the REAL AI-prepared content for a wizard step. Dispatches on the
 * UI ordinal (1 Hypotheses · 2 Activities · 3 Apportionment · 4 Evidence ·
 * 5 Narrative) to the matching renderer. Honest states throughout:
 *   - loading → a "preparing" note while the fetch is in flight.
 *   - empty (`prepared:false`) → "still preparing" carrying the live
 *     canAdvance reason; never fabricated content.
 *   - ready → the actual artefacts, with a one-line judgement prompt.
 */
export function PreparedStepContent({
  ordinal,
  label,
  prepared,
  preparedLoading,
  canAdvance,
  approved,
}: {
  ordinal: number;
  label: string;
  prepared: PreparedContent | undefined;
  preparedLoading: boolean;
  canAdvance: { ok: true } | { ok: false; reason: string };
  approved: boolean;
}) {
  if (preparedLoading && !prepared) {
    return (
      <div style={{ fontFamily: fSans, fontSize: 13, color: bone3, padding: '6px 2px' }}>
        Loading the AI-prepared content…
      </div>
    );
  }

  // Resolve the per-step slice + a header line.
  let isPrepared = false;
  let body: ReactNode = null;
  if (prepared) {
    if (ordinal === 1) {
      isPrepared = prepared.step1_hypotheses.prepared;
      body = <HypothesesPanel items={prepared.step1_hypotheses.items} />;
    } else if (ordinal === 2) {
      isPrepared = prepared.step2_activities.prepared;
      body = <ActivitiesPanel items={prepared.step2_activities.items} />;
    } else if (ordinal === 3) {
      isPrepared = prepared.step3_apportionment.prepared;
      body = (
        <ApportionmentPanel
          items={prepared.step3_apportionment.items}
          totalAmount={prepared.step3_apportionment.total_amount}
          totalMapped={prepared.step3_apportionment.total_mapped}
        />
      );
    } else if (ordinal === 4) {
      isPrepared = prepared.step4_evidence.prepared;
      body = <EvidencePanel items={prepared.step4_evidence.items} />;
    } else if (ordinal === 5) {
      isPrepared = prepared.step5_narrative.prepared;
      body = <NarrativePanel items={prepared.step5_narrative.items} />;
    }
  }

  if (!isPrepared) {
    // Nothing authored yet for this step. Be honest: surface the live
    // canAdvance reason if the gate isn't met, else a generic still-preparing.
    return (
      <StillPreparing
        reason={
          !canAdvance.ok
            ? canAdvance.reason
            : 'The AI is still preparing this step. It will appear here once the pipeline finishes.'
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Diamond size={7} color={approved ? sage : amber} />
        <MonoLabel size={9.5} color={approved ? sage : amber}>
          {approved ? `${label} APPROVED` : `${label} PREPARED BY AI — YOUR JUDGEMENT`}
        </MonoLabel>
      </div>
      {body}
    </div>
  );
}

const VERDICT_COLOR: Record<'pass' | 'fail' | 'inconclusive', string> = {
  pass: sage,
  fail: rust,
  inconclusive: bone3,
};

/* ── Step 1 · Hypotheses + IP-search verdicts ── */
export function HypothesesPanel({ items }: { items: PreparedHypothesis[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((h) => (
        <ContentCard key={h.verdict_id}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {h.activity_code && (
                <MonoLabel size={9} color={bone4}>
                  {h.activity_code}
                  {h.activity_title ? ` · ${h.activity_title}` : ''}
                </MonoLabel>
              )}
              <div
                style={{
                  fontFamily: fSerif,
                  fontSize: 16,
                  lineHeight: 1.35,
                  color: bone,
                  marginTop: 4,
                }}
              >
                {h.hypothesis_text}
              </div>
            </div>
            <span
              style={{
                flexShrink: 0,
                fontFamily: fMono,
                fontSize: 9,
                letterSpacing: '0.14em',
                padding: '3px 8px',
                borderRadius: 3,
                border: `1px solid ${VERDICT_COLOR[h.verdict]}`,
                color: VERDICT_COLOR[h.verdict],
              }}
            >
              IP {h.verdict.toUpperCase()}
            </span>
          </div>
          {h.analysis_markdown && (
            <div
              style={{
                marginTop: 8,
                fontFamily: fSans,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: bone3,
                whiteSpace: 'pre-wrap',
              }}
            >
              {truncate(h.analysis_markdown, 480)}
            </div>
          )}
          <div style={{ marginTop: 8, fontFamily: fMono, fontSize: 8.5, color: bone4 }}>
            {h.status === 'approved' ? 'CONSULTANT-APPROVED VERDICT' : 'AI DRAFT VERDICT'}
            {h.draft_verdict && h.draft_verdict !== h.verdict
              ? ` · AI SUGGESTED ${h.draft_verdict.toUpperCase()}`
              : ''}
          </div>
        </ContentCard>
      ))}
    </div>
  );
}

/* ── Step 2 · Proposed Core / Supporting activities (Div 355) ── */
export function ActivitiesPanel({ items }: { items: PreparedActivity[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((a) => (
        <ContentCard key={a.proposed_id}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  fontFamily: fMono,
                  fontSize: 9,
                  letterSpacing: '0.14em',
                  padding: '2px 7px',
                  borderRadius: 3,
                  border: `1px solid ${a.kind === 'core' ? amber : sage}`,
                  color: a.kind === 'core' ? amber : sage,
                }}
              >
                {a.kind === 'core' ? 'CORE' : 'SUPPORTING'}
                {a.statutory_anchor ? ` · ${a.statutory_anchor}` : ''}
              </span>
              <div
                style={{
                  fontFamily: fSerif,
                  fontSize: 17,
                  lineHeight: 1.3,
                  color: bone,
                  marginTop: 6,
                }}
              >
                {a.title}
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              {a.confidence !== null && (
                <MonoLabel size={9} color={bone3}>
                  {Math.round(a.confidence * 100)}% CONF
                </MonoLabel>
              )}
              <div style={{ marginTop: 4 }}>
                <MonoLabel size={8.5} color={a.accepted ? sage : bone4}>
                  {a.accepted
                    ? `ACCEPTED${a.activity_code ? ` · ${a.activity_code}` : ''}`
                    : 'PROPOSED'}
                </MonoLabel>
              </div>
            </div>
          </div>
          {a.hypothesis && <KeyVal label="HYPOTHESIS" value={a.hypothesis} />}
          {a.technical_uncertainty && (
            <KeyVal label="UNCERTAINTY" value={a.technical_uncertainty} />
          )}
          {a.rationale && <KeyVal label="WHY THIS CLUSTER" value={truncate(a.rationale, 360)} />}
        </ContentCard>
      ))}
    </div>
  );
}

/* ── Step 3 · Apportionment (ledger → activities) ── */
export function ApportionmentPanel({
  items,
  totalAmount,
  totalMapped,
}: {
  items: PreparedExpenditureLine[];
  totalAmount: number;
  totalMapped: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          gap: 22,
          padding: '10px 14px',
          background: 'rgba(225,162,58,0.06)',
          border: `1px solid ${amber}`,
          borderRadius: 4,
        }}
      >
        <Stat label="LEDGER TOTAL" value={formatAud(totalAmount)} />
        <Stat label="MAPPED TO ACTIVITIES" value={formatAud(totalMapped)} accent={sage} />
        <Stat
          label="UNMAPPED"
          value={formatAud(Math.max(0, totalAmount - totalMapped))}
          accent={rust}
        />
      </div>
      {items.map((e) => (
        <ContentCard key={e.expenditure_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: fSans, fontSize: 14, color: bone }}>{e.vendor_name}</div>
              <MonoLabel size={9} color={bone4}>
                {e.expenditure_date}
                {e.reference ? ` · ${e.reference}` : ''}
              </MonoLabel>
            </div>
            <div style={{ flexShrink: 0, fontFamily: fMono, fontSize: 13, color: bone2 }}>
              {formatAud(e.total_amount)}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            {e.mapping_kind === null ? (
              <MonoLabel size={9} color={rust}>
                UNMAPPED — NO ACTIVITY ALLOCATION
              </MonoLabel>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {e.allocations.map((al, i) => (
                  <div
                    key={`${al.activity_id}-${i}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: fMono,
                      fontSize: 10,
                      color: bone3,
                    }}
                  >
                    <span>
                      {al.activity_code}
                      {al.activity_title ? ` · ${al.activity_title}` : ''}
                    </span>
                    <span style={{ color: sage }}>{al.percentage}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ContentCard>
      ))}
    </div>
  );
}

/* ── Step 4 · Evidence bound to each activity ── */
export function EvidencePanel({ items }: { items: PreparedActivityEvidence[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((a) => (
        <ContentCard key={a.activity_id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontFamily: fSans, fontSize: 14, color: bone }}>
              <MonoLabel size={9} color={bone4}>
                {a.activity_code}
              </MonoLabel>
              <div style={{ marginTop: 2 }}>{a.activity_title}</div>
            </div>
            <MonoLabel size={9} color={a.artefacts.length > 0 ? sage : rust}>
              {a.artefacts.length} ARTEFACT{a.artefacts.length === 1 ? '' : 'S'}
            </MonoLabel>
          </div>
          {a.artefacts.length === 0 ? (
            <div style={{ marginTop: 8, fontFamily: fSans, fontSize: 12.5, color: bone4 }}>
              No evidence bound to this activity yet.
            </div>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {a.artefacts.map((art) => (
                <div
                  key={art.artefact_id}
                  style={{
                    padding: '7px 10px',
                    background: ink2,
                    border: `1px solid ${rule}`,
                    borderRadius: 3,
                  }}
                >
                  <MonoLabel size={8.5} color={amber}>
                    {(art.artefact_label ?? art.artefact_kind).toUpperCase()}
                  </MonoLabel>
                  {art.link_reason && (
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: fSans,
                        fontSize: 12,
                        lineHeight: 1.45,
                        color: bone3,
                      }}
                    >
                      {truncate(art.link_reason, 240)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ContentCard>
      ))}
    </div>
  );
}

const SECTION_LABEL: Record<string, string> = {
  new_knowledge: 'New knowledge',
  hypothesis: 'Hypothesis',
  uncertainty: 'Technical uncertainty',
  experiments_and_results: 'Experiments & results',
};

/* ── Step 5 · Drafted narrative sections (cited) ── */
export function NarrativePanel({ items }: { items: PreparedNarrativeSection[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((n) => {
        const citationCount = n.segments.reduce((c, s) => c + s.citing_events.length, 0);
        return (
          <ContentCard key={`${n.activity_id}-${n.section_kind}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <MonoLabel size={9} color={bone4}>
                  {n.activity_code} ·{' '}
                  {(SECTION_LABEL[n.section_kind] ?? n.section_kind).toUpperCase()}
                </MonoLabel>
              </div>
              <MonoLabel size={8.5} color={n.status === 'accepted' ? sage : amber}>
                {n.status.toUpperCase()}
                {citationCount > 0 ? ` · ${citationCount} CITED` : ''}
              </MonoLabel>
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {n.segments.map((s, i) => (
                <div key={i}>
                  <div
                    style={{
                      fontFamily: fSerif,
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: bone2,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {s.text}
                  </div>
                  {s.type === 'claim' && s.citing_events.length > 0 && (
                    <MonoLabel size={8} color={sage}>
                      ↳ CITES {s.citing_events.length} EVENT
                      {s.citing_events.length === 1 ? '' : 'S'}
                    </MonoLabel>
                  )}
                </div>
              ))}
            </div>
          </ContentCard>
        );
      })}
    </div>
  );
}

/* ── Step 6 · Review roll-up ── */
export function ReviewRollup({ review }: { review: PreparedContent['step6_review'] }) {
  return (
    <ContentCard>
      <MonoLabel size={9.5} color={bone3}>
        AI-PREPARED CLAIM AT A GLANCE
      </MonoLabel>
      <div
        style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 14,
        }}
      >
        <Stat label="HYPOTHESES" value={String(review.hypothesis_count)} />
        <Stat
          label="ACTIVITIES"
          value={`${review.activities_accepted} / ${review.activity_count}`}
        />
        <Stat
          label="LEDGER MAPPED"
          value={`${review.expenditure_mapped} / ${review.expenditure_count}`}
        />
        <Stat label="EVIDENCE LINKS" value={String(review.evidence_links)} />
        <Stat
          label="NARRATIVE"
          value={`${review.narrative_sections_accepted} / ${review.narrative_sections}`}
        />
      </div>
    </ContentCard>
  );
}

export function StillPreparing({ reason }: { reason: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: ink3,
        border: `1px dashed ${ruleStrong}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Diamond size={6} filled={false} color={bone3} />
      <div>
        <MonoLabel size={10} color={bone3}>
          STILL PREPARING
        </MonoLabel>
        <div style={{ marginTop: 4, fontFamily: fSans, fontSize: 13, color: bone3 }}>{reason}</div>
      </div>
    </div>
  );
}

export function AwaitingPanel({ reason }: { reason: string }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: ink3,
        border: `1px dashed ${ruleStrong}`,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Diamond size={6} filled={false} color={bone3} />
      <div>
        <MonoLabel size={10} color={bone3}>
          AWAITING AI PREPARATION
        </MonoLabel>
        <div style={{ marginTop: 4, fontFamily: fSans, fontSize: 13, color: bone3 }}>{reason}</div>
      </div>
    </div>
  );
}
