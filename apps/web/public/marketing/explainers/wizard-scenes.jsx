// wizard-scenes.jsx — ArchiveOne claim-wizard / workflow explainer.
// Year one is the deposit; year two compounds. Data dump → trusted advisor.
// 1920x1080, ~90s.

// ─── Tweakable demo values (read live from window.__wizardTweaks) ────────

function getWTweaks() {
  const t = (typeof window !== 'undefined' && window.__wizardTweaks) || {};
  return {
    clientName:   t.clientName   ?? 'Vantage Industries',
    yearsHistory: t.yearsHistory ?? 6,
    factsTarget:  t.factsTarget  ?? 18420,
  };
}

// ─── Helpers (local scope) ───────────────────────────────────────────────

function wlerp(a, b, t) { return a + (b - a) * t; }

function entry(localTime, start, dur = 0.5, ease = Easing.easeOutCubic) {
  if (localTime < start) return { opacity: 0, ty: 14 };
  const t = ease(clamp((localTime - start) / dur, 0, 1));
  return { opacity: t, ty: (1 - t) * 14 };
}

function exit(localTime, duration, dur = 0.5, ease = Easing.easeInCubic) {
  const start = Math.max(0, duration - dur);
  if (localTime < start) return { opacity: 1, ty: 0 };
  const t = ease(clamp((localTime - start) / dur, 0, 1));
  return { opacity: 1 - t, ty: -t * 10 };
}

function ee(localTime, duration, opts = {}) {
  const e = entry(localTime, opts.start ?? 0, opts.entryDur ?? 0.5);
  const x = exit(localTime, duration, opts.exitDur ?? 0.5);
  return {
    opacity: Math.min(e.opacity, x.opacity),
    transform: `translateY(${e.ty + x.ty}px)`,
  };
}

function WSceneHeader({ stage, stageLabel, title, lede, localTime, duration, startAt = 0.15, maxWidth = 880 }) {
  return (
    <div style={{ position: 'absolute', left: 200, top: 260, maxWidth }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18, marginBottom: 32,
        ...ee(localTime, duration, { start: startAt }),
      }}>
        <Diamond size={10} color={csAmber} filled />
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csAmber }}>{stage}</span>
        <span style={{ width: 36, height: 1, background: csRuleStr }}/>
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3 }}>{stageLabel}</span>
      </div>
      <div style={{
        fontFamily: fSerif, fontWeight: 300,
        fontSize: 82, lineHeight: 1.0, letterSpacing: '-0.025em',
        color: csBone,
        ...ee(localTime, duration, { start: startAt + 0.25, entryDur: 0.7 }),
      }}>{title}</div>
      {lede && (
        <div style={{
          marginTop: 26, fontFamily: fSans, fontSize: 22, lineHeight: 1.5,
          color: csBone2, maxWidth: 720,
          ...ee(localTime, duration, { start: startAt + 0.6, entryDur: 0.6 }),
        }}>{lede}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 1 — Cold open: "Year one is the deposit."
// ─────────────────────────────────────────────────────────────────────────
function WScene1ColdOpen() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute', left: 200, top: 280,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.4 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em',
          color: csBone3, textTransform: 'uppercase',
        }}>HOW THE PLATFORM COMPOUNDS · FY25/26 → FY26/27</span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 340,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 158, lineHeight: 0.94, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 1.0, entryDur: 0.8 }),
      }}>
        Year one is the&nbsp;
        <span style={{ fontStyle: 'italic', color: csAmber, fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
          deposit.
        </span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 530,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 158, lineHeight: 0.94, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 2.2, entryDur: 0.8 }),
      }}>
        Year two pays&nbsp;
        <span style={{ fontStyle: 'italic', color: csAmber, fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
          interest.
        </span>
      </div>

      <WTimelineArrow localTime={localTime} startAt={3.4}/>

      <div style={{
        position: 'absolute', left: 200, top: 770,
        display: 'flex', alignItems: 'center', gap: 16,
        ...ee(localTime, duration, { start: 4.2 }),
      }}>
        <Diamond size={8} color={csAmber} filled />
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.16em',
          color: csBone2, textTransform: 'uppercase',
        }}>
          FROM DATA DUMP · TO TRUSTED ADVISOR
        </span>
      </div>
    </div>
  );
}

function WTimelineArrow({ localTime, startAt }) {
  const t = clamp((localTime - startAt) / 1.2, 0, 1);
  const draw = Easing.easeOutCubic(t);
  const opacity = clamp((localTime - startAt) / 0.4, 0, 1);
  const labels = [
    { x: 60,  y: 60, k: 'FY25/26', s: 'INGEST'    },
    { x: 220, y: 60, k: 'FY26/27', s: 'ADVISE'    },
    { x: 380, y: 60, k: 'FY27/28+',s: 'COMPOUND'  },
  ];
  return (
    <div style={{
      position: 'absolute', right: 200, top: 700,
      opacity: opacity * 0.95,
    }}>
      <svg width="540" height="220" viewBox="0 0 540 220">
        {/* horizontal line */}
        <line x1="20" y1="120" x2="500" y2="120"
              stroke={csAmber} strokeWidth="1"
              strokeDasharray="520"
              strokeDashoffset={520 * (1 - draw)}/>
        <polygon points="500,114 514,120 500,126" fill={csAmber} opacity={draw}/>
        {labels.map((lab, i) => {
          const lt = clamp((draw * 3) - i, 0, 1);
          const x = 60 + i * 160;
          return (
            <g key={i} opacity={lt}>
              <line x1={x} y1="110" x2={x} y2="130" stroke={csAmber} strokeWidth="1.4"/>
              <circle cx={x} cy="120" r="6" fill={csAmber}/>
              <text x={x} y="80" textAnchor="middle"
                    fill={csBone} fontFamily={fMono} fontSize="14"
                    letterSpacing="2">{lab.k}</text>
              <text x={x} y="158" textAnchor="middle"
                    fill={csBone3} fontFamily={fMono} fontSize="11"
                    letterSpacing="3">{lab.s}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 2 — Title
// ─────────────────────────────────────────────────────────────────────────
function WScene2Title() {
  const { localTime, duration } = useSprite();
  const burstT = clamp(localTime / 0.6, 0, 1);
  const burstScale = Easing.easeOutBack(burstT);
  const burstGlow = 1 - clamp((localTime - 0.6) / 1.0, 0, 1);

  const word = 'The Claim Wizard';
  const letters = word.split('');
  const start = 0.45;
  const perLetter = 0.045;

  return (
    <div style={{ position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        position: 'absolute', top: 250,
        width: 24, height: 24,
        background: csAmber, transform: `rotate(45deg) scale(${burstScale})`,
        boxShadow: `0 0 ${40 + burstGlow * 80}px ${10 + burstGlow * 30}px rgba(225,162,58,${0.4 + burstGlow * 0.4})`,
      }}/>

      <div style={{
        position: 'absolute', top: 300,
        fontFamily: fMono, fontSize: 14, letterSpacing: '0.32em',
        color: csBone3, textTransform: 'uppercase',
        ...ee(localTime, duration, { start: 1.4, entryDur: 0.5, exitDur: 0.5 }),
      }}>
        ArchiveOne
      </div>

      <div style={{
        marginTop: 80,
        fontFamily: fSerif, fontWeight: 300,
        fontSize: 200, lineHeight: 1, letterSpacing: '-0.04em',
        display: 'flex', color: csBone, flexWrap: 'nowrap',
      }}>
        {letters.map((ch, i) => {
          const e = entry(localTime, start + i * perLetter, 0.45, Easing.easeOutCubic);
          return (
            <span key={i} style={{
              opacity: e.opacity, transform: `translateY(${e.ty}px)`,
              display: 'inline-block',
            }}>{ch === ' ' ? '\u00A0' : ch}</span>
          );
        })}
      </div>

      <div style={{
        marginTop: 28,
        fontFamily: fSerif, fontStyle: 'italic', fontWeight: 300,
        fontSize: 42, color: csBone2, letterSpacing: '-0.015em',
        textAlign: 'center',
        ...ee(localTime, duration, { start: 1.55, entryDur: 0.7, exitDur: 0.6 }),
      }}>
        From data dump to trusted advisor.
      </div>

      <div style={{
        marginTop: 80,
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: fMono, fontSize: 13, letterSpacing: '0.22em',
        color: csBone3, textTransform: 'uppercase',
        ...ee(localTime, duration, { start: 2.1, entryDur: 0.6, exitDur: 0.6 }),
      }}>
        <span>INGEST</span>
        <Diamond size={6} filled color={csAmber} />
        <span>LEARN</span>
        <Diamond size={6} filled color={csAmber} />
        <span>ADVISE</span>
        <Diamond size={6} filled color={csAmber} />
        <span>COMPOUND</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 3 — The wizard today (FY25/26 — consultant-driven)
// ─────────────────────────────────────────────────────────────────────────
function WScene3Wizard() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 01" stageLabel="THE WIZARD · FY25/26"
        title={<>A guided <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— claim, step by step.</em></>}
        lede="The consultant works through a six-step wizard for each claimant. The wizard asks the right questions in the right order. The work becomes a conversation."
        localTime={localTime} duration={duration}/>

      <WWizardPanel localTime={localTime}/>
    </div>
  );
}

function WWizardPanel({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  const steps = [
    { at: 0.9, k: 'PROFILE',       q: 'What does the business do, and where does it sit on the innovation curve?', a: 'Hi-temp alloys · ARL-3 maturity · 47 staff · FY25 turnover $18.2M' },
    { at: 1.6, k: 'HYPOTHESES',    q: 'What did you set out to learn, and why was the answer unknown?',            a: 'Phase stability of Vantage-7 above 800 °C · no published data at this composition' },
    { at: 2.3, k: 'ACTIVITIES',    q: 'Which work is Core? Which is Supporting?',                                  a: '4 Core · 7 Supporting · provisional classification applied' },
    { at: 3.0, k: 'EVIDENCE',      q: 'Where did the work happen, and what proves it?',                            a: '47 chain-anchored artifacts · 6 contemporaneous voice notes' },
    { at: 3.7, k: 'APPORTIONMENT', q: 'How does the ledger map to the activities?',                                a: 'Xero feed reconciled · $238K wages · $42K contractor · $14K overhead' },
    { at: 4.4, k: 'REVIEW',        q: 'Anything to flag before sign-off?',                                         a: '2 weak hypotheses · suggested follow-ups drafted · awaiting consultant' },
  ];
  // active step
  let activeIdx = 0;
  for (let i = 0; i < steps.length; i++) if (localTime >= steps[i].at) activeIdx = i;
  const active = steps[activeIdx];
  return (
    <div style={{
      position: 'absolute', left: 1080, top: 220, width: 760,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* Side-by-side: rail of 6 + active card */}
      <div style={{
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        padding: 28,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 22,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>
            CLAIM WIZARD · VANTAGE-7
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.14em' }}>
            STEP {String(activeIdx + 1).padStart(2,'0')} / 06
          </span>
        </div>

        {/* progress rail */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 26 }}>
          {steps.map((s, i) => {
            const done = i < activeIdx;
            const cur = i === activeIdx;
            return (
              <div key={i} style={{
                flex: 1, height: 3,
                background: done ? csAmber : (cur ? csAmberSft : csRule),
                borderRadius: 2,
                opacity: cur && Math.floor(localTime * 3) % 2 ? 0.6 : 1,
              }}/>
            );
          })}
        </div>

        {/* current question */}
        <div style={{
          fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em', marginBottom: 12,
        }}>
          {active.k}
        </div>
        <div style={{
          fontFamily: fSerif, fontSize: 28, color: csBone, fontWeight: 400,
          lineHeight: 1.2, letterSpacing: '-0.01em', marginBottom: 22,
          minHeight: 100,
        }}>
          {active.q}
        </div>

        {/* answer captured */}
        <div style={{
          padding: '16px 18px',
          background: 'rgba(225,162,58,0.06)', border: `1px solid ${csAmber}`,
          borderRadius: 4,
        }}>
          <div style={{
            fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.18em', marginBottom: 8,
          }}>
            CAPTURED
          </div>
          <div style={{
            fontFamily: fSans, fontSize: 15, color: csBone, lineHeight: 1.5,
          }}>
            {active.a}
          </div>
        </div>

        {/* completed steps below */}
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${csRule}` }}>
          {steps.map((s, i) => {
            if (i >= activeIdx) return null;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '140px 1fr 20px',
                gap: 14, padding: '7px 0',
                fontFamily: fMono, fontSize: 11.5, color: csBone3,
              }}>
                <span style={{ color: csBone4, letterSpacing: '0.16em' }}>{s.k}</span>
                <span style={{ color: csBone2, fontFamily: fSans, fontSize: 12.5 }}>
                  {s.a.length > 60 ? s.a.slice(0, 58) + '…' : s.a}
                </span>
                <PCheck on/>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PCheck({ on }) {
  if (!on) return null;
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke={csAmber} strokeWidth="2">
      <polyline points="3 9 7 13 15 4"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 4 — Year one is a data dump
// ─────────────────────────────────────────────────────────────────────────
function WScene4DataDump() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 02" stageLabel="THIS YEAR · INGEST"
        title={<>This year, <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>the work is upload.</em></>}
        lede="Forty-five days from June 30. Claimants will dump a year of evidence on their consultant and pray it's compliant. ArchiveOne absorbs the dump in one pass — ledgers, payroll, calendars, drives, prior claims, all of it."
        localTime={localTime} duration={duration}/>

      <WDataDumpVisual localTime={localTime}/>
    </div>
  );
}

function WDataDumpVisual({ localTime }) {
  const sources = [
    { at: 0.6, k: 'XERO',          v: `${getWTweaks().yearsHistory} yrs of GL · 84,200 lines`,  i: 'ledger' },
    { at: 0.9, k: 'MYOB',          v: 'payroll · 47 staff · 312 wks', i: 'wage'   },
    { at: 1.2, k: 'OUTLOOK',       v: 'calendars · 14,800 events',   i: 'cal'    },
    { at: 1.5, k: 'GOOGLE DRIVE',  v: '2,140 design docs · 9.2 GB',  i: 'drive'  },
    { at: 1.8, k: 'JIRA / LINEAR', v: '46 projects · 18,400 tickets', i: 'ticket' },
    { at: 2.1, k: 'PRIOR CLAIMS',  v: 'FY20–FY25 · 18 sealed claims', i: 'prior'  },
    { at: 2.4, k: 'EMAIL',         v: '4 mailboxes · key threads',   i: 'mail'   },
    { at: 2.7, k: 'BOARD PACKS',   v: 'quarterly · 5 yrs',           i: 'board'  },
  ];
  const e = entry(localTime, 0.4, 0.6);
  return (
    <div style={{
      position: 'absolute', left: 1060, top: 220, width: 780,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* sources */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 30 }}>
        {sources.map((s, i) => {
          const lt = clamp((localTime - s.at) / 0.5, 0, 1);
          return (
            <div key={i} style={{
              padding: '12px 16px',
              background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
              display: 'flex', alignItems: 'center', gap: 14,
              opacity: lt, transform: `translateX(${(1-lt)*16}px)`,
            }}>
              <Diamond size={7} color={csAmber} filled />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fMono, fontSize: 10.5, color: csAmber, letterSpacing: '0.18em' }}>
                  {s.k}
                </div>
                <div style={{ fontFamily: fSans, fontSize: 12, color: csBone2, marginTop: 3 }}>
                  {s.v}
                </div>
              </div>
              <span style={{
                fontFamily: fMono, fontSize: 9, color: csBone4, letterSpacing: '0.16em',
              }}>
                INGESTED
              </span>
            </div>
          );
        })}
      </div>

      {/* falling lines into vault */}
      <WIngestFunnel localTime={localTime}/>

      {/* the vessel */}
      <div style={{
        padding: '24px 28px',
        background: 'rgba(225,162,58,0.06)', border: `1px solid ${csAmber}`,
        borderRadius: 4,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 12,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>
            CLIENT MEMORY · {getWTweaks().clientName.toUpperCase()}
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.14em' }}>
            ENCRYPTED · SOVEREIGN
          </span>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18,
        }}>
          {[
            ['142 GB', 'INDEXED'],
            [getWTweaks().factsTarget.toLocaleString(), 'FACTS LEARNED'],
            [`${getWTweaks().yearsHistory} YRS`,  'OF HISTORY'],
          ].map(([n, k], i) => {
            const lt = clamp((localTime - 2.4 - i*0.15) / 0.6, 0, 1);
            return (
              <div key={i} style={{ opacity: lt }}>
                <div style={{ fontFamily: fSerif, fontSize: 36, color: csBone, fontWeight: 300, lineHeight: 1, letterSpacing: '-0.02em' }}>
                  {n}
                </div>
                <div style={{ fontFamily: fMono, fontSize: 9.5, color: csBone3, letterSpacing: '0.18em', marginTop: 6 }}>
                  {k}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WIngestFunnel({ localTime }) {
  return (
    <svg width="780" height="40" viewBox="0 0 780 40" style={{ display: 'block', marginBottom: 4 }}>
      {Array.from({ length: 14 }).map((_, i) => {
        const x = 60 + i * 50;
        const phase = (localTime * 2 + i * 0.3) % 1;
        const y = phase * 40;
        const opacity = phase < 0.9 ? 0.7 : (1 - phase) * 7;
        return (
          <line key={i} x1={x} y1={y} x2={x} y2={y + 12}
                stroke={csAmber} strokeWidth="1" opacity={opacity * 0.7}/>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 5 — Learning layer
// ─────────────────────────────────────────────────────────────────────────
function WScene5Learning() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 03" stageLabel="LEARN"
        title={<>While it works, <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>the model learns.</em></>}
        lede="Every artifact, every transaction, every email thread becomes a fact about your client. The model assembles a private graph of their business — their cycles, their costs, their people, their posture — and embeds it into the mobile app agent. Accessible only to your client."
        localTime={localTime} duration={duration}/>

      <WKnowledgeGraph localTime={localTime}/>
    </div>
  );
}

function WKnowledgeGraph({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  // Central node + 7 surrounding
  const center = { x: 380, y: 280, k: 'VANTAGE\nINDUSTRIES', big: true };
  const nodes = [
    { at: 0.8, x: 120,  y: 100, k: 'BUSINESS PROFILE',   sub: 'ARL-3 · hi-temp alloys' },
    { at: 1.0, x: 380,  y: 70,  k: 'R&D CYCLE',          sub: 'design → exec → review' },
    { at: 1.2, x: 640,  y: 100, k: 'COST STRUCTURE',     sub: '64% wages · 22% contractor' },
    { at: 1.4, x: 660,  y: 340, k: 'TEAM & ROLES',       sub: '47 staff · 11 in R&D' },
    { at: 1.6, x: 540,  y: 500, k: 'PIPELINE',           sub: 'Vantage-7 · Lyra · Borealis' },
    { at: 1.8, x: 220,  y: 500, k: 'HISTORICAL CLAIMS',  sub: '5 yrs · 92% chain cov.' },
    { at: 2.0, x: 100,  y: 340, k: 'COMPLIANCE POSTURE', sub: '2 prior reviews · passed' },
  ];

  // counter
  const tw = getWTweaks();
  const factsT = clamp(localTime / 4.0, 0, 1);
  const facts = Math.floor(wlerp(0, tw.factsTarget, Easing.easeOutCubic(factsT)));

  return (
    <div style={{
      position: 'absolute', left: 1060, top: 220, width: 780,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        position: 'relative', height: 600,
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        padding: 24,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 18,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>
            CLIENT KNOWLEDGE GRAPH
          </span>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csBone, letterSpacing: '0.14em' }}>
            <span style={{ color: csAmber }}>{facts.toLocaleString()}</span>
            <span style={{ color: csBone3 }}> FACTS LEARNED</span>
          </span>
        </div>

        <svg width="730" height="540" viewBox="0 0 730 540" style={{ position: 'absolute', left: 24, top: 50, overflow: 'visible' }}>
          {/* edges */}
          {nodes.map((n, i) => {
            const lt = clamp((localTime - n.at - 0.2) / 0.6, 0, 1);
            return (
              <line key={'e'+i}
                    x1={center.x} y1={center.y} x2={n.x} y2={n.y}
                    stroke={csAmber} strokeWidth="1" opacity={0.4 * lt}
                    strokeDasharray="600"
                    strokeDashoffset={600 * (1 - lt)}/>
            );
          })}
          {/* center node */}
          <g>
            <circle cx={center.x} cy={center.y} r="56"
                    fill="rgba(225,162,58,0.1)"
                    stroke={csAmber} strokeWidth="1.4"/>
            <circle cx={center.x} cy={center.y} r="74"
                    fill="none" stroke={csAmber} strokeWidth="1" opacity="0.25"
                    strokeDasharray="3 5"/>
            <text x={center.x} y={center.y - 4} textAnchor="middle"
                  fill={csBone} fontFamily={fSerif} fontSize="16" fontWeight="500">
              {tw.clientName.split(' ')[0].toUpperCase()}
            </text>
            <text x={center.x} y={center.y + 14} textAnchor="middle"
                  fill={csBone3} fontFamily={fMono} fontSize="10" letterSpacing="2">
              {(tw.clientName.split(' ').slice(1).join(' ') || 'CLIENT').toUpperCase()}
            </text>
          </g>
          {/* outer nodes */}
          {nodes.map((n, i) => {
            const lt = clamp((localTime - n.at) / 0.5, 0, 1);
            const pulse = 1 + 0.06 * Math.sin(localTime * 2 + i);
            return (
              <g key={i} opacity={lt} transform={`translate(${n.x},${n.y}) scale(${0.7 + 0.3 * lt})`}>
                <circle cx="0" cy="0" r={20 * pulse} fill="rgba(225,162,58,0.08)" stroke={csAmber} strokeWidth="1"/>
                <circle cx="0" cy="0" r="4" fill={csAmber}/>
                <text x="0" y="-32" textAnchor="middle"
                      fill={csBone} fontFamily={fMono} fontSize="11" letterSpacing="1.5">
                  {n.k}
                </text>
                <text x="0" y="42" textAnchor="middle"
                      fill={csBone3} fontFamily={fSans} fontStyle="italic" fontSize="11">
                  {n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 6 — The inflection: June 30 → July 1
// ─────────────────────────────────────────────────────────────────────────
function WScene6Understanding() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 04" stageLabel="INFLECTION · JUNE 30 → JULY 1"
        title={<>June 30 <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— the old way ends.</em></>}
        lede="For decades the same ritual: year-end evidence dump, a frantic six-week assembly, a prayer the file holds. This is the last June you do it that way. From July 1, contemporaneous evidence becomes the standard."
        localTime={localTime} duration={duration} maxWidth={820}/>

      <WInflectionPanel localTime={localTime}/>
    </div>
  );
}

function WInflectionPanel({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  return (
    <div style={{
      position: 'absolute', left: 200, top: 620, right: 200,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: 0, alignItems: 'stretch',
      }}>
        <WInflectionSide
          eyebrow="BEFORE · UNTIL JUNE 30"
          headline="Year-end dump"
          lines={[
            'Twelve months of receipts arrive in one week',
            'Memory and reconstruction — not evidence',
            'Hypotheses written after the fact',
            'One missing record → entire claim disallowed',
          ]}
          tone="muted"
          at={0.8} localTime={localTime}
        />

        <WInflectionAxis localTime={localTime}/>

        <WInflectionSide
          eyebrow="FROM JULY 1 · FY26/27"
          headline="Contemporaneous, by default"
          lines={[
            'Researchers capture on mobile, in the moment',
            'Every artifact hashed, chained, time-stamped',
            'Hypothesis logged before the experiment runs',
            'June 30 next year: nothing to reconstruct',
          ]}
          tone="amber"
          at={1.4} localTime={localTime}
        />
      </div>
    </div>
  );
}

function WInflectionSide({ eyebrow, headline, lines, tone, at, localTime }) {
  const lt = clamp((localTime - at) / 0.7, 0, 1);
  const isAmber = tone === 'amber';
  return (
    <div style={{
      padding: 28,
      background: isAmber ? 'rgba(225,162,58,0.06)' : csInk2,
      border: `1px solid ${isAmber ? csAmber : csRuleStr}`,
      borderRadius: 4,
      opacity: lt, transform: `translateY(${(1-lt)*18}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: isAmber ? csAmber : csBone3,
        letterSpacing: '0.2em', marginBottom: 16,
      }}>
        {eyebrow}
      </div>
      <div style={{
        fontFamily: fSerif, fontWeight: 300, fontSize: 38, color: isAmber ? csBone : csBone2,
        lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: 22,
      }}>
        {headline}
      </div>
      <div style={{ height: 1, background: csRule, marginBottom: 18 }}/>
      {lines.map((l, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          fontFamily: fSans, fontSize: 14.5, color: isAmber ? csBone2 : csBone3, lineHeight: 1.5,
          marginBottom: 10,
        }}>
          <Diamond size={5} color={isAmber ? csAmber : csBone4} filled style={{ marginTop: 7, flexShrink: 0 }}/>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}

function WInflectionAxis({ localTime }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '0 18px',
    }}>
      <div style={{
        width: 1, height: 28,
        background: `linear-gradient(to bottom, transparent, ${csRuleStr})`,
      }}/>
      <div style={{
        width: 80, height: 80, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          border: `1px solid ${csAmber}`, transform: 'rotate(45deg)',
          background: 'rgba(225,162,58,0.08)',
          boxShadow: `0 0 ${16 + 10 * Math.sin(localTime*2)}px rgba(225,162,58,0.3)`,
        }}/>
        <span style={{
          position: 'relative',
          fontFamily: fMono, fontSize: 11, color: csAmber,
          letterSpacing: '0.18em', textAlign: 'center', lineHeight: 1.2,
        }}>
          JUL<br/>01
        </span>
      </div>
      <div style={{
        width: 1, height: 28,
        background: `linear-gradient(to top, transparent, ${csRuleStr})`,
      }}/>
      <div style={{
        marginTop: 10,
        fontFamily: fMono, fontSize: 9, color: csBone3, letterSpacing: '0.22em',
        textAlign: 'center', width: 120,
      }}>
        FY26/27<br/>BEGINS
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 7 — FY26/27: the mobile app arrives, context already loaded
// ─────────────────────────────────────────────────────────────────────────
function WScene7Mobile() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 05" stageLabel="FY26/27 · MOBILE ARRIVES"
        title={<>From July 1, <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>your team gets the app.</em></>}
        lede="Shipped to the claimant's researchers on day one of the new financial year. The app already knows the business — the projects, the rhythm, the eligibility patterns. Capture stops being a chore; it becomes a conversation with someone who's already up to speed."
        localTime={localTime} duration={duration}/>

      <WContextPhone localTime={localTime}/>
    </div>
  );
}

function WContextPhone({ localTime }) {
  const e = entry(localTime, 0.6, 0.7);
  const float = Math.sin(localTime * 0.9) * 6;
  // chat messages between app and researcher
  const msgs = [
    { at: 1.0, who: 'app',  txt: 'Morning Priya. Vantage-7 furnace run N12 — same protocol as N7?', delay: 0.4 },
    { at: 2.2, who: 'user', txt: 'Yes — new alloy ratio though, B+8%.',                              delay: 0.4 },
    { at: 3.0, who: 'app',  txt: 'Logged as Core · hypothesis branch from N7. Snap the post-cycle plate when you can.', delay: 0.4 },
    { at: 4.2, who: 'user', txt: '📷',                                                              delay: 0.3 },
    { at: 4.7, who: 'app',  txt: 'Sealed. That closes evidence gap #3 on this claim.',              delay: 0.4 },
  ];
  return (
    <div style={{
      position: 'absolute', left: 960, top: 200,
      transform: `translateY(${float - e.ty}px)`,
      opacity: e.opacity,
    }}>
      <div style={{
        width: 420, height: 700,
        background: csInk2, border: `1px solid ${csRuleStr}`,
        borderRadius: 52, padding: 16,
        position: 'relative',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)',
      }}>
        <div style={{
          position: 'absolute', top: 22, left: '50%', transform: 'translateX(-50%)',
          width: 100, height: 24, background: '#000', borderRadius: 14,
        }}/>
        <div style={{
          width: '100%', height: '100%',
          background: csInk, borderRadius: 40, overflow: 'hidden',
          position: 'relative', padding: '54px 18px 18px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            position: 'absolute', top: 18, left: 24, right: 24,
            display: 'flex', justifyContent: 'space-between',
            fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.08em',
          }}>
            <span style={{ color: csBone }}>9:08</span>
            <span>● ● ●</span>
          </div>

          {/* App header */}
          <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${csRule}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Diamond size={7} color={csAmber} filled />
              <span style={{ fontFamily: fSerif, fontSize: 18, color: csBone, fontWeight: 500 }}>
                ArchiveOne
              </span>
              <span style={{ fontFamily: fMono, fontSize: 8, color: csBone3, letterSpacing: '0.2em', marginLeft: 'auto' }}>
                FY26/27
              </span>
            </div>
            <div style={{ fontFamily: fMono, fontSize: 9.5, color: csBone3, marginTop: 6, letterSpacing: '0.14em' }}>
              CONTEXT · VANTAGE-7 · ACTIVE HYPOTHESIS
            </div>
          </div>

          {/* messages */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
            {msgs.map((m, i) => {
              const lt = clamp((localTime - m.at) / m.delay, 0, 1);
              const isApp = m.who === 'app';
              return (
                <div key={i} style={{
                  alignSelf: isApp ? 'flex-start' : 'flex-end',
                  maxWidth: '82%',
                  padding: '10px 14px',
                  background: isApp ? csInk2 : 'rgba(225,162,58,0.18)',
                  border: `1px solid ${isApp ? csRuleStr : csAmber}`,
                  borderRadius: isApp ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
                  opacity: lt, transform: `translateY(${(1-lt)*10}px)`,
                  fontFamily: fSans, fontSize: 13, color: isApp ? csBone : csBone, lineHeight: 1.4,
                }}>
                  {isApp && (
                    <div style={{ fontFamily: fMono, fontSize: 8.5, color: csAmber, letterSpacing: '0.18em', marginBottom: 4 }}>
                      ARCHIVEONE
                    </div>
                  )}
                  {m.txt}
                </div>
              );
            })}
          </div>

          {/* input bar */}
          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: csInk2, border: `1px solid ${csRuleStr}`,
            borderRadius: 18,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontFamily: fMono, fontSize: 10, color: csBone4, letterSpacing: '0.16em' }}>
              SPEAK · PHOTO · TYPE
            </span>
            <div style={{
              marginLeft: 'auto',
              width: 28, height: 28, borderRadius: '50%',
              background: csAmber,
              boxShadow: `0 0 ${10 + 6 * Math.sin(localTime * 4)}px rgba(225,162,58,0.5)`,
            }}/>
          </div>
        </div>
      </div>

      {/* Side caption */}
      <div style={{
        position: 'absolute', left: 460, top: 70,
        width: 420,
      }}>
        <div style={{
          fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em', marginBottom: 12,
        }}>
          NOT A BLIND TOOL
        </div>
        <div style={{
          fontFamily: fSerif, fontWeight: 300, fontSize: 38, color: csBone,
          lineHeight: 1.1, letterSpacing: '-0.02em',
        }}>
          The app opens to a researcher who is already known, on a project that is already understood.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 8 — Trusted advisor (proactive advice)
// ─────────────────────────────────────────────────────────────────────────
function WScene8Advisor() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 06" stageLabel="ADVISE"
        title={<>Trusted advisor <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— up to speed, every page.</em></>}
        lede="Not a chatbot. A second seat at the table — fluent in the claimant&rsquo;s history, current spend, board commitments and audit posture. Proactive, not reactive."
        localTime={localTime} duration={duration}/>

      <WAdvisorPanel localTime={localTime}/>
    </div>
  );
}

function WAdvisorPanel({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  const advices = [
    {
      at: 0.9, tag: 'FORECAST',
      title: 'H1 trajectory suggests $2.4M eligible.',
      sub: 'Up from $1.8M last year. Driven by Vantage-7 expansion and the Lyra kick-off.',
    },
    {
      at: 1.8, tag: 'OPPORTUNITY',
      title: 'Project Lyra qualifies if you formalise the hypothesis this week.',
      sub: 'I&rsquo;ve drafted it from the design doc. 12 mins of partner review needed.',
    },
    {
      at: 2.7, tag: 'RISK',
      title: 'Three activities are at risk for evidence gaps.',
      sub: 'Two need contemporaneous capture. One needs the contractor invoice apportioned to Core. All actionable today.',
    },
    {
      at: 3.6, tag: 'POSTURE',
      title: 'You are ahead of last year on chain coverage by 11pts.',
      sub: 'Audit-readiness sits at 94%. The remaining 6% is one missing standup recording from Aug 14.',
    },
  ];
  return (
    <div style={{
      position: 'absolute', left: 1060, top: 220, width: 780,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        padding: 26,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 22, paddingBottom: 16, borderBottom: `1px solid ${csRule}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Diamond size={9} color={csAmber} filled />
            <span style={{ fontFamily: fSerif, fontSize: 22, color: csBone, fontWeight: 500 }}>
              ArchiveOne · Advisor brief
            </span>
          </div>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.16em' }}>
            MON · 09:02 AEST
          </span>
        </div>

        {advices.map((a, i) => {
          const lt = clamp((localTime - a.at) / 0.6, 0, 1);
          return (
            <div key={i} style={{
              padding: '16px 0',
              borderBottom: i < advices.length - 1 ? `1px solid ${csRule}` : 'none',
              opacity: lt, transform: `translateY(${(1-lt)*12}px)`,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8,
              }}>
                <span style={{
                  padding: '3px 10px',
                  border: `1px solid ${csAmber}`, background: 'rgba(225,162,58,0.08)',
                  fontFamily: fMono, fontSize: 9.5, color: csAmber, letterSpacing: '0.18em',
                }}>
                  {a.tag}
                </span>
              </div>
              <div style={{
                fontFamily: fSerif, fontSize: 22, color: csBone, lineHeight: 1.3, letterSpacing: '-0.01em',
              }}>
                {a.title}
              </div>
              <div style={{
                fontFamily: fSans, fontSize: 14, color: csBone3, lineHeight: 1.5, marginTop: 6,
              }} dangerouslySetInnerHTML={{ __html: a.sub }}/>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 9 — Stickiness (depth-of-context over time)
// ─────────────────────────────────────────────────────────────────────────
function WScene9Sticky() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 07" stageLabel="COMPOUND"
        title={<>Why leaving <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>stops making sense.</em></>}
        lede="Every quarter, the model knows more. The institutional memory it holds is the same memory that would walk out the door with a senior partner. The replacement cost is years."
        localTime={localTime} duration={duration}/>

      <WDepthChart localTime={localTime}/>
    </div>
  );
}

function WDepthChart({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  // Plot points across 4 years
  const years = [
    { x: 0,    y: 12, k: 'FY25/26', l: 'Foundational facts', v: 'business profile · ledger · prior claims' },
    { x: 0.33, y: 32, k: 'FY26/27', l: 'Patterns + advice',  v: 'rhythm · cost shape · evidence habits' },
    { x: 0.66, y: 62, k: 'FY27/28', l: 'Predictive',          v: 'forecast · proactive risk · audit-tested' },
    { x: 1.0,  y: 92, k: 'FY28/29', l: 'Embedded advisor',    v: 'second seat · institutional memory' },
  ];
  const w = 760, h = 380;
  const padL = 60, padR = 30, padT = 30, padB = 50;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const drawT = clamp((localTime - 0.8) / 2.5, 0, 1);
  // Path
  const pts = years.map(y => ({
    px: padL + y.x * plotW,
    py: padT + plotH * (1 - y.y/100),
  }));
  // Build smooth curve
  let pathD = `M ${pts[0].px} ${padT + plotH}`;
  pts.forEach((p, i) => {
    if (i === 0) pathD += ` L ${p.px} ${p.py}`;
    else {
      const prev = pts[i-1];
      const cx1 = prev.px + (p.px - prev.px) * 0.5;
      const cy1 = prev.py;
      const cx2 = prev.px + (p.px - prev.px) * 0.5;
      const cy2 = p.py;
      pathD += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p.px} ${p.py}`;
    }
  });
  pathD += ` L ${pts[pts.length-1].px} ${padT + plotH} Z`;

  return (
    <div style={{
      position: 'absolute', left: 1060, top: 220, width: 780,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        padding: 24,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 6,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>
            DEPTH OF CLIENT CONTEXT
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.14em' }}>
            COMPOUNDING · NON-TRANSFERRABLE
          </span>
        </div>

        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
          {/* y-axis gridlines */}
          {[0, 25, 50, 75, 100].map(g => {
            const y = padT + plotH * (1 - g/100);
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={w - padR} y2={y}
                      stroke={csRule} strokeWidth="1"/>
                <text x={padL - 10} y={y + 4} textAnchor="end"
                      fill={csBone4} fontFamily={fMono} fontSize="9" letterSpacing="1">
                  {g}%
                </text>
              </g>
            );
          })}
          {/* filled area */}
          <defs>
            <clipPath id="depthClip">
              <rect x={padL} y={padT} width={plotW * drawT} height={plotH}/>
            </clipPath>
            <linearGradient id="depthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={csAmber} stopOpacity="0.4"/>
              <stop offset="100%" stopColor={csAmber} stopOpacity="0.05"/>
            </linearGradient>
          </defs>
          <path d={pathD} fill="url(#depthGrad)" clipPath="url(#depthClip)"/>
          {/* curve line */}
          <path d={pathD.split(' Z')[0]}
                fill="none" stroke={csAmber} strokeWidth="2"
                clipPath="url(#depthClip)"/>
          {/* points */}
          {pts.map((p, i) => {
            const ptT = clamp((drawT - i*0.22) * 3, 0, 1);
            if (ptT <= 0) return null;
            return (
              <g key={i}>
                <circle cx={p.px} cy={p.py} r="6" fill={csInk} stroke={csAmber} strokeWidth="2" opacity={ptT}/>
                <circle cx={p.px} cy={p.py} r="2.5" fill={csAmber} opacity={ptT}/>
                <text x={p.px} y={padT + plotH + 22} textAnchor="middle"
                      fill={csBone} fontFamily={fMono} fontSize="11" letterSpacing="1.5" opacity={ptT}>
                  {years[i].k}
                </text>
              </g>
            );
          })}
        </svg>

        {/* legend rows below */}
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {years.map((y, i) => {
            const lt = clamp((drawT - i*0.22) * 3, 0, 1);
            return (
              <div key={i} style={{ opacity: lt }}>
                <div style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.16em' }}>{y.l}</div>
                <div style={{ fontFamily: fSans, fontSize: 11.5, color: csBone3, marginTop: 4, lineHeight: 1.4 }}>{y.v}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 10 — Disproportionate value to cost
// ─────────────────────────────────────────────────────────────────────────
function WScene10Value() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <WSceneHeader stage="STAGE 08" stageLabel="DISPROPORTIONATE"
        title={<>Cost on one side. <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>Value on the other.</em></>}
        lede="By year two, the platform fee is the smallest line on every page that mentions it. The stack on the right is what it produces against it."
        localTime={localTime} duration={duration}/>

      <WValueStack localTime={localTime}/>
    </div>
  );
}

function WValueStack({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  // Cost on the left; sources of value on the right (no fabricated dollar totals).
  const items = [
    { at: 1.2, k: 'TIME RETURNED',     share: 18, v: 'Consultant judgement, not evidence assembly' },
    { at: 1.6, k: 'CLAIM QUALITY',     share: 28, v: 'Constantly updated logic — every ATO alert, AAT decision and AusIndustry guidance, ingested daily' },
    { at: 2.0, k: 'ADVISOR EFFECT',    share: 14, v: 'Proactive forecast & posture, not reactive triage' },
    { at: 2.4, k: 'FINANCING MARGIN',  share: 18, v: 'A new pathway for streamlining and originating finance for clients' },
    { at: 2.8, k: 'CLAIMANT RETENTION',share: 22, v: 'Daily app usage by the claimant&rsquo;s team \u2014 stickiness, not seat licensing' },
  ];
  const totalShare = items.reduce((s, x) => s + x.share, 0);
  const stackMaxH = 460;

  return (
    <div style={{
      position: 'absolute', left: 1060, top: 230, right: 200, bottom: 200,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
      display: 'flex', alignItems: 'flex-end', gap: 60,
    }}>
      {/* COST bar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.18em', marginBottom: 8,
        }}>YEAR 2 COST</div>
        <div style={{
          width: 120, height: 60,
          background: 'rgba(225,162,58,0.15)', border: `1px solid ${csAmber}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fSerif, fontSize: 22, color: csAmber, fontWeight: 400, letterSpacing: '-0.02em',
        }}>
          per claim
        </div>
        <div style={{
          fontFamily: fMono, fontSize: 9, color: csBone4, letterSpacing: '0.16em', marginTop: 8, textAlign: 'center', width: 120,
        }}>ONLY WHEN<br/>YOU BILL</div>
      </div>

      {/* VALUE stack */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{
          fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.18em',
          textAlign: 'center', marginBottom: 8,
        }}>SOURCES OF VALUE</div>
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4 }}>
          {items.map((it, i) => {
            const lt = clamp((localTime - it.at) / 0.6, 0, 1);
            const h = (it.share / totalShare) * stackMaxH * lt;
            return (
              <div key={i} style={{
                height: h,
                background: i % 2 === 0 ? 'rgba(225,162,58,0.18)' : 'rgba(225,162,58,0.10)',
                borderLeft: `2px solid ${csAmber}`,
                padding: '0 20px',
                display: 'flex', alignItems: 'center', gap: 20,
                opacity: lt, overflow: 'hidden',
              }}>
                <div style={{
                  fontFamily: fMono, fontSize: 10.5, color: csAmber, letterSpacing: '0.18em',
                  minWidth: 200,
                }}>
                  {it.k}
                </div>
                <div style={{
                  fontFamily: fSerif, fontSize: 18, color: csBone, fontWeight: 400,
                  letterSpacing: '-0.005em', lineHeight: 1.3, flex: 1,
                }} dangerouslySetInnerHTML={{ __html: it.v }}/>
              </div>
            );
          })}
        </div>
        <div style={{
          marginTop: 12, paddingTop: 14, borderTop: `1px solid ${csAmber}`,
          display: 'flex', alignItems: 'flex-start', gap: 14,
        }}>
          <Diamond size={8} color={csAmber} filled style={{ marginTop: 6, flexShrink: 0 }}/>
          <div style={{
            fontFamily: fSerif, fontSize: 20, color: csBone, lineHeight: 1.35,
            letterSpacing: '-0.005em', fontStyle: 'italic', fontWeight: 300,
          }}>
            All of it rests on one foundation: immutable evidence, immune from rejection by AusIndustry and the ATO.
          </div>
        </div>
      </div>
    </div>
  );
}

function WValueStack_DEPRECATED({ localTime }) {
  return null;
  // legacy stack used fabricated dollar totals
  // eslint-disable-next-line
  const e = entry(localTime, 0.5, 0.7);
  // Cost bar tiny; value stack big and animated up
  const items = [
    { at: 1.2, k: 'TIME RETURNED',     v: '$238,000', share: 28 },
    { at: 1.6, k: 'CLAIM QUALITY',     v: '$425,000', share: 50, sub: 'losses avoided' },
    { at: 2.0, k: 'ADVISOR EFFECT',    v: '$ 90,000', share: 12, sub: 'forecast & posture' },
    { at: 2.4, k: 'FINANCING MARGIN',  v: '$120,000', share: 16, sub: 'origination · year 2+' },
    { at: 2.8, k: 'CLIENT APP RESALE', v: '$240,000', share: 28, sub: '$250/mo · per user' },
  ];
  // total height share scaled into px
  const totalShare = items.reduce((s, x) => s + x.share, 0);
  const stackMaxH = 460;

  return (
    <div style={{
      position: 'absolute', left: 1060, top: 230, right: 200, bottom: 200,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
      display: 'flex', alignItems: 'flex-end', gap: 60,
    }}>
      {/* COST bar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.18em', marginBottom: 8,
        }}>YEAR 2 COST</div>
        <div style={{
          width: 120, height: 60,
          background: 'rgba(225,162,58,0.15)', border: `1px solid ${csAmber}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: fSerif, fontSize: 22, color: csAmber, fontWeight: 400, letterSpacing: '-0.02em',
        }}>
          $60K
        </div>
        <div style={{
          fontFamily: fMono, fontSize: 9, color: csBone4, letterSpacing: '0.16em', marginTop: 8,
        }}>PLATFORM FEE</div>
      </div>

      {/* VALUE stack */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <div style={{
          fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.18em',
          textAlign: 'center', marginBottom: 8,
        }}>YEAR 2 VALUE</div>
        <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4 }}>
          {items.map((it, i) => {
            const lt = clamp((localTime - it.at) / 0.6, 0, 1);
            const h = (it.share / totalShare) * stackMaxH * lt;
            return (
              <div key={i} style={{
                height: h,
                background: i % 2 === 0 ? 'rgba(225,162,58,0.18)' : 'rgba(225,162,58,0.10)',
                borderLeft: `2px solid ${csAmber}`,
                padding: '0 18px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                opacity: lt, overflow: 'hidden',
              }}>
                <div>
                  <div style={{ fontFamily: fMono, fontSize: 10.5, color: csAmber, letterSpacing: '0.18em' }}>
                    {it.k}
                  </div>
                  {it.sub && (
                    <div style={{ fontFamily: fSans, fontSize: 11, color: csBone3, marginTop: 2, fontStyle: 'italic' }}>
                      {it.sub}
                    </div>
                  )}
                </div>
                <div style={{
                  fontFamily: fSerif, fontSize: 22, color: csBone, fontWeight: 400, letterSpacing: '-0.015em',
                }}>
                  {it.v}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${csAmber}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>TOTAL</span>
          <span style={{ fontFamily: fSerif, fontSize: 36, color: csBone, fontWeight: 300, letterSpacing: '-0.025em' }}>
            $1.11M
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 11 — The choice (rhetorical punch)
// ──────────────────────────────────────────────────────────────────────
function WScene11Choice() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute', left: 200, top: 280,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.2 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em',
          color: csBone3, textTransform: 'uppercase',
        }}>APPLY NOW TO BE ONE OF 20 CONSULTANCIES WITH PLATFORM ACCESS</span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 340, right: 200,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 140, lineHeight: 0.96, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 0.7, entryDur: 0.9 }),
      }}>
        Do you want to be
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 510, right: 200,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 140, lineHeight: 0.96, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 1.6, entryDur: 0.9 }),
      }}>
        the consultancy&nbsp;<span style={{
          fontStyle: 'italic', color: csAmber,
          fontVariationSettings: '"opsz" 144, "SOFT" 100',
        }}>without</span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 680, right: 200,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 140, lineHeight: 0.96, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 2.6, entryDur: 0.9 }),
      }}>
        the immutable evidence?
      </div>

      {/* Bottom stamp row */}
      <div style={{
        position: 'absolute', left: 200, right: 200, bottom: 200,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        ...ee(localTime, duration, { start: 3.6, entryDur: 0.6 }),
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          fontFamily: fMono, fontSize: 13, color: csBone3, letterSpacing: '0.18em',
        }}>
          <Diamond size={8} color={csAmber} filled />
          JUNE 30, 2026 · LAST YEAR-END WITHOUT THE CHAIN
        </div>
        <div style={{
          fontFamily: fMono, fontSize: 13, color: csAmber, letterSpacing: '0.18em',
        }}>
          FOUNDER SEATS OPEN
        </div>
      </div>
    </div>
  );
}

// SCENE 12 — End card
// ─────────────────────────────────────────────────────────────────────────
function WScene11End() {
  const { localTime, duration } = useSprite();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{
        position: 'absolute', left: 200, top: 320,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.2 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3 }}>
          THE ONLY DIGITAL PRODUCT DESIGNED FOR AUSTRALIAN R&amp;DTI
        </span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 380,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 0.6, entryDur: 0.9 }),
      }}>
        Year one, the deposit.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 580,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        maxWidth: 1500,
        ...ee(localTime, duration, { start: 1.6, entryDur: 0.9 }),
      }}>
        Every year after,&nbsp;
        <span style={{ fontStyle: 'italic', color: csAmber, fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
          compounds.
        </span>
      </div>

      <div style={{
        position: 'absolute', left: 200, right: 200, bottom: 140,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        borderTop: `1px solid ${csRuleStr}`, paddingTop: 28,
        fontFamily: fMono, fontSize: 13, color: csBone3, letterSpacing: '0.14em',
        ...ee(localTime, duration, { start: 2.6, entryDur: 0.6 }),
      }}>
        <div>
          <div style={{ color: csBone, marginBottom: 6 }}>ARCHIVEONE · CLAIM WIZARD</div>
          <div>FY25/26 INGEST · FY26/27 ADVISE · FY27/28 COMPOUND</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: csBone, marginBottom: 6 }}>STAMPED</div>
          <div>2026.05.21 · 14:23 AEST · BLOCK #00184_2C</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  WScene1ColdOpen, WScene2Title, WScene3Wizard, WScene4DataDump,
  WScene5Learning, WScene6Understanding, WScene7Mobile, WScene8Advisor,
  WScene9Sticky, WScene10Value, WScene11Choice, WScene11End,
});
