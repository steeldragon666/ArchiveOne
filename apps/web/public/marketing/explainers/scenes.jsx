// scenes.jsx — ArchiveOne animated explainer scenes.
// 1920x1080, ~72s. Each scene is a <Sprite start end> with its own visuals.
// Persistent broadcast chrome (top brand, timestamp, bottom scene marker).

// ─── Helpers ─────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

// Type-in: returns substring of `text` based on localTime, char-per-sec rate.
function typewrite(text, localTime, rate = 40, startAt = 0) {
  if (localTime < startAt) return '';
  const n = Math.floor((localTime - startAt) * rate);
  return text.slice(0, Math.max(0, Math.min(text.length, n)));
}

// Random-ish hex stream that "settles" to final hash by time t.
function settleHash(finalHex, localTime, settleAt = 1.2) {
  const tt = clamp(localTime / settleAt, 0, 1);
  const len = finalHex.length;
  const seedChars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) {
    if (i / len <= tt) out += finalHex[i];
    else out += seedChars[(Math.floor(localTime * 90 + i * 7)) % 16];
  }
  return out;
}

// Fade/slide-in helper for one element. Returns {opacity, translateY}.
function entry(localTime, start, dur = 0.5, ease = Easing.easeOutCubic) {
  if (localTime < start) return { opacity: 0, ty: 14 };
  const t = ease(clamp((localTime - start) / dur, 0, 1));
  return { opacity: t, ty: (1 - t) * 14 };
}

// Fade-out near end of sprite
function exit(localTime, duration, dur = 0.5, ease = Easing.easeInCubic) {
  const start = Math.max(0, duration - dur);
  if (localTime < start) return { opacity: 1, ty: 0 };
  const t = ease(clamp((localTime - start) / dur, 0, 1));
  return { opacity: 1 - t, ty: -t * 10 };
}

// Combined entry + exit transform style
function ee(localTime, duration, opts = {}) {
  const e = entry(localTime, opts.start ?? 0, opts.entryDur ?? 0.5);
  const x = exit(localTime, duration, opts.exitDur ?? 0.5);
  return {
    opacity: Math.min(e.opacity, x.opacity),
    transform: `translateY(${e.ty + x.ty}px)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 1 — Cold open: "The new reality"
// ─────────────────────────────────────────────────────────────────────────
function Scene1ColdOpen() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* eyebrow */}
      <div style={{
        position: 'absolute', left: 200, top: 280,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.4 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em',
          color: csBone3, textTransform: 'uppercase',
        }}>THE NEW REALITY · FY26 R&DTI</span>
      </div>

      {/* Headline */}
      <div style={{
        position: 'absolute', left: 200, top: 340,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 1.0, entryDur: 0.8 }),
      }}>
        One missing record.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 540,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 2.4, entryDur: 0.8 }),
      }}>
        An entire claim,&nbsp;
        <span style={{ fontStyle: 'italic', color: csAmber, fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
          gone.
        </span>
      </div>

      {/* Disallowed stamp (rotated, draws on) */}
      <DisallowedStamp localTime={localTime} startAt={3.6} />

      {/* small mono caption bottom-center */}
      <div style={{
        position: 'absolute', left: 200, top: 770,
        display: 'flex', alignItems: 'center', gap: 16,
        ...ee(localTime, duration, { start: 4.4 }),
      }}>
        <Diamond size={8} color={csAmber} filled />
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.16em',
          color: csBone2, textTransform: 'uppercase',
        }}>
          ONE-STRIKE EXAMINATION · BURDEN HAS SHIFTED · CONSULTANTS PERSONALLY EXPOSED
        </span>
      </div>

      {/* Receding ticker strip */}
      <ColdOpenTicker localTime={localTime} />
    </div>
  );
}

function DisallowedStamp({ localTime, startAt }) {
  const t = clamp((localTime - startAt) / 0.9, 0, 1);
  const draw = Easing.easeOutCubic(t);
  const opacity = clamp((localTime - startAt) / 0.4, 0, 1);
  const rot = -8;
  return (
    <div style={{
      position: 'absolute', right: 220, top: 380,
      transform: `rotate(${rot}deg) scale(${0.94 + 0.06 * draw})`,
      opacity: opacity * 0.9,
    }}>
      <svg width="420" height="220" viewBox="0 0 420 220">
        <rect x="6" y="6" width="408" height="208" fill="none"
              stroke={csAmber} strokeWidth="3"
              strokeDasharray={1232}
              strokeDashoffset={1232 * (1 - draw)} />
        <rect x="22" y="22" width="376" height="176" fill="none"
              stroke={csAmber} strokeWidth="1" opacity="0.55" />
        <text x="210" y="100" textAnchor="middle"
              fill={csAmber} fontFamily={fSerif} fontWeight="600" fontSize="56"
              letterSpacing="0.04em" opacity={draw}>
          DISALLOWED
        </text>
        <text x="210" y="150" textAnchor="middle"
              fill={csAmber} fontFamily={fMono} fontSize="14"
              letterSpacing="0.24em" opacity={draw * 0.85}>
          NO CONTEMPORANEOUS RECORD
        </text>
        <text x="210" y="180" textAnchor="middle"
              fill={csAmber} fontFamily={fMono} fontSize="11"
              letterSpacing="0.22em" opacity={draw * 0.6}>
          REF · TA 2026/03 · S.355–25 ITAA 1997
        </text>
      </svg>
    </div>
  );
}

function ColdOpenTicker({ localTime }) {
  const opacity = clamp((localTime - 5) / 0.5, 0, 1);
  const phrases = [
    'AAT · BODY BY MICHAEL · APPLIED',
    'AAT · GQHC · APPLIED',
    'FCA · ARISTOCRAT · DOCTRINE',
    'ATO · TAXPAYER ALERT TA 2026/03',
    '80% of consultant time lost to evidence chasing',
    'Hypothesis must precede experiment — s.355',
    'One missing record → entire claim disallowed',
  ];
  const x = -localTime * 80;
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: 880,
      borderTop: `1px solid ${csRuleStr}`, borderBottom: `1px solid ${csRuleStr}`,
      padding: '14px 0', overflow: 'hidden', whiteSpace: 'nowrap',
      opacity, fontFamily: fMono, fontSize: 13, color: csBone3,
      letterSpacing: '0.16em',
    }}>
      <div style={{ display: 'inline-block', transform: `translateX(${x}px)`, paddingLeft: '100%' }}>
        {phrases.concat(phrases).concat(phrases).map((p, i) => (
          <span key={i} style={{ marginRight: 80 }}>
            <span style={{ color: csAmber, marginRight: 14 }}>◆</span>{p}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 2 — Title card
// ─────────────────────────────────────────────────────────────────────────
function Scene2Title() {
  const { localTime, duration } = useSprite();

  // Diamond burst at center, then word-mark assembles
  const burstT = clamp(localTime / 0.6, 0, 1);
  const burstScale = Easing.easeOutBack(burstT);
  const burstGlow = 1 - clamp((localTime - 0.6) / 1.0, 0, 1);

  const word = 'ArchiveOne';
  const letters = word.split('');
  const start = 0.45;
  const perLetter = 0.06;

  return (
    <div style={{ position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center' }}>
      {/* diamond burst */}
      <div style={{
        position: 'absolute', top: 290,
        width: 28, height: 28,
        background: csAmber, transform: `rotate(45deg) scale(${burstScale})`,
        boxShadow: `0 0 ${40 + burstGlow * 80}px ${10 + burstGlow * 30}px rgba(225,162,58,${0.4 + burstGlow * 0.4})`,
      }}/>

      {/* word-mark */}
      <div style={{
        marginTop: 60,
        fontFamily: fSerif, fontWeight: 300,
        fontSize: 240, lineHeight: 1, letterSpacing: '-0.04em',
        display: 'flex', color: csBone,
      }}>
        {letters.map((ch, i) => {
          const e = entry(localTime, start + i * perLetter, 0.45, Easing.easeOutCubic);
          return (
            <span key={i} style={{
              opacity: e.opacity,
              transform: `translateY(${e.ty}px)`,
              display: 'inline-block',
            }}>{ch}</span>
          );
        })}
      </div>

      {/* tagline */}
      <div style={{
        marginTop: 32,
        fontFamily: fSerif, fontStyle: 'italic', fontWeight: 300,
        fontSize: 44, color: csBone2, letterSpacing: '-0.015em',
        textAlign: 'center',
        ...ee(localTime, duration, { start: 1.45, entryDur: 0.7, exitDur: 0.6 }),
      }}>
        R&amp;D Tax, reimagined for the&nbsp;
        <span style={{ color: csAmber }}>one-strike</span> era.
      </div>

      {/* mono caption */}
      <div style={{
        marginTop: 80,
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: fMono, fontSize: 13, letterSpacing: '0.22em',
        color: csBone3, textTransform: 'uppercase',
        ...ee(localTime, duration, { start: 2.0, entryDur: 0.6, exitDur: 0.6 }),
      }}>
        <span>OMNISCIENT AI</span>
        <Diamond size={6} filled color={csAmber} />
        <span>SOVEREIGN R&amp;DTI PLATFORM</span>
        <Diamond size={6} filled color={csAmber} />
        <span>EST. 2026</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 3 — Capture: in the moment of the work
// ─────────────────────────────────────────────────────────────────────────
function Scene3Capture() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 01" stageLabel="CAPTURE"
                   title={<>Capture <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— in the moment of the work.</em></>}
                   lede="Researchers shoot the whiteboard, voice-note the result, snap the calculation. No fields. No structure. No friction."
                   localTime={localTime} duration={duration}/>

      {/* Phone frame on right */}
      <PhoneRig localTime={localTime} />

      {/* Capture cards floating in from left */}
      <CaptureStream localTime={localTime} />
    </div>
  );
}

function SceneHeader({ stage, stageLabel, title, lede, localTime, duration, startAt = 0.15 }) {
  return (
    <div style={{ position: 'absolute', left: 200, top: 260, maxWidth: 880 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 18,
        marginBottom: 32,
        ...ee(localTime, duration, { start: startAt }),
      }}>
        <Diamond size={10} color={csAmber} filled />
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csAmber }}>
          {stage}
        </span>
        <span style={{ width: 36, height: 1, background: csRuleStr }}/>
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3 }}>
          {stageLabel}
        </span>
      </div>
      <div style={{
        fontFamily: fSerif, fontWeight: 300,
        fontSize: 88, lineHeight: 1.0, letterSpacing: '-0.025em',
        color: csBone,
        ...ee(localTime, duration, { start: startAt + 0.25, entryDur: 0.7 }),
      }}>
        {title}
      </div>
      {lede && (
        <div style={{
          marginTop: 26,
          fontFamily: fSans, fontSize: 22, lineHeight: 1.5,
          color: csBone2, maxWidth: 720,
          ...ee(localTime, duration, { start: startAt + 0.6, entryDur: 0.6 }),
        }}>
          {lede}
        </div>
      )}
    </div>
  );
}

function PhoneRig({ localTime }) {
  const x = 1280, y = 200;
  // gentle float
  const float = Math.sin(localTime * 0.9) * 6;
  const e = entry(localTime, 0.5, 0.7, Easing.easeOutCubic);
  // What's "on screen" depends on time
  const stages = [
    { at: 0.9,  label: 'PHOTO · WHITEBOARD',   icon: 'whiteboard' },
    { at: 2.4,  label: 'VOICE NOTE · 0:34',    icon: 'voice'      },
    { at: 4.0,  label: 'PHOTO · LAB BOOK',     icon: 'labbook'    },
    { at: 5.4,  label: 'SCRIBBLE · CALC',      icon: 'scribble'   },
  ];
  // Find latest stage
  let active = -1;
  for (let i = 0; i < stages.length; i++) {
    if (localTime >= stages[i].at) active = i;
  }
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      transform: `translateY(${float - e.ty}px)`,
      opacity: e.opacity,
    }}>
      {/* phone body */}
      <div style={{
        width: 440, height: 680,
        background: csInk2, border: `1px solid ${csRuleStr}`,
        borderRadius: 56, padding: 18,
        position: 'relative',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)',
      }}>
        {/* notch */}
        <div style={{
          position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)',
          width: 110, height: 24, background: '#000', borderRadius: 14,
        }}/>
        {/* screen */}
        <div style={{
          width: '100%', height: '100%',
          background: csInk, borderRadius: 42, overflow: 'hidden',
          position: 'relative', padding: '60px 20px 20px',
        }}>
          {/* status bar */}
          <div style={{
            position: 'absolute', top: 18, left: 26, right: 26,
            display: 'flex', justifyContent: 'space-between',
            fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.08em',
          }}>
            <span style={{ color: csBone }}>14:23</span>
            <span>● ● ●</span>
          </div>

          {/* App header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 14,
            fontFamily: fSerif, fontSize: 22, color: csBone, fontWeight: 500,
          }}>
            <Diamond size={8} color={csAmber} filled />
            ArchiveOne
          </div>
          <div style={{
            fontFamily: fMono, fontSize: 10, letterSpacing: '0.18em',
            color: csBone3, marginBottom: 18,
          }}>
            CAPTURE · PROJECT: VANTAGE-7
          </div>

          {/* Capture button */}
          <div style={{
            position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)',
          }}>
            <div style={{
              width: 88, height: 88, borderRadius: '50%',
              border: `2px solid ${csBone2}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: 70, height: 70, borderRadius: '50%',
                background: csAmber,
                boxShadow: `0 0 ${20 + 10 * Math.sin(localTime * 4)}px rgba(225,162,58,0.5)`,
              }}/>
            </div>
            <div style={{
              marginTop: 10, textAlign: 'center',
              fontFamily: fMono, fontSize: 9, letterSpacing: '0.2em',
              color: csBone3,
            }}>STAMP TO CHAIN</div>
          </div>

          {/* Stack of recent captures */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {stages.map((s, i) => {
              if (i > active) return null;
              const at = s.at;
              const ago = localTime - at;
              const e2 = entry(localTime, at, 0.35, Easing.easeOutCubic);
              return (
                <div key={i} style={{
                  background: csInk2, border: `1px solid ${csRuleStr}`,
                  borderRadius: 12, padding: '10px 12px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  opacity: e2.opacity,
                  transform: `translateY(${e2.ty}px)`,
                }}>
                  <CaptureThumb kind={s.icon} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: fMono, fontSize: 9.5, letterSpacing: '0.14em', color: csBone3 }}>
                      {s.label}
                    </div>
                    <div style={{ fontFamily: fMono, fontSize: 9, color: csBone4, marginTop: 2 }}>
                      14:23:{String(7 + i * 14).padStart(2,'0')} · STAMPED
                    </div>
                  </div>
                  <Diamond size={6} color={csAmber} filled />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptureThumb({ kind }) {
  const sz = 40;
  const sty = { width: sz, height: sz, borderRadius: 8, background: csInk3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${csRule}` };
  if (kind === 'whiteboard') return (
    <div style={sty}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={csAmber} strokeWidth="1.2">
        <rect x="3" y="5" width="16" height="11"/>
        <path d="M6 8 L10 11 L14 9 L17 13" />
      </svg>
    </div>
  );
  if (kind === 'voice') return (
    <div style={sty}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={csAmber} strokeWidth="1.4" strokeLinecap="round">
        <line x1="5"  y1="11" x2="5"  y2="11"/>
        <line x1="8"  y1="7"  x2="8"  y2="15"/>
        <line x1="11" y1="4"  x2="11" y2="18"/>
        <line x1="14" y1="8"  x2="14" y2="14"/>
        <line x1="17" y1="10" x2="17" y2="12"/>
      </svg>
    </div>
  );
  if (kind === 'labbook') return (
    <div style={sty}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={csAmber} strokeWidth="1.2">
        <rect x="5" y="3" width="12" height="16"/>
        <line x1="7" y1="7" x2="15" y2="7"/>
        <line x1="7" y1="10" x2="15" y2="10"/>
        <line x1="7" y1="13" x2="13" y2="13"/>
      </svg>
    </div>
  );
  return ( // scribble
    <div style={sty}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={csAmber} strokeWidth="1.2" strokeLinecap="round">
        <path d="M4 16 Q 7 4, 10 12 T 16 8 T 19 14" />
      </svg>
    </div>
  );
}

function CaptureStream({ localTime }) {
  // Floating capture artifacts on left side that drift up
  const items = [
    { at: 1.2,  label: 'whiteboard.jpg',   sub: '14:23:07', y: 880 },
    { at: 2.8,  label: 'standup.m4a',      sub: '14:25:21', y: 880 },
    { at: 4.2,  label: 'lab_book_p47.jpg', sub: '14:31:09', y: 880 },
    { at: 5.6,  label: 'calc_n7.png',      sub: '14:38:44', y: 880 },
  ];
  return (
    <React.Fragment>
      {items.map((it, i) => {
        const localT = localTime - it.at;
        if (localT < 0) return null;
        const e = entry(localTime, it.at, 0.5, Easing.easeOutCubic);
        const rise = Math.min(localT, 2.5);
        const ty = -rise * 60;
        const fade = clamp(1 - (localT - 1.5) / 1.0, 0, 1);
        return (
          <div key={i} style={{
            position: 'absolute', left: 220 + i * 70, top: it.y + ty,
            padding: '12px 18px',
            background: 'rgba(19,19,22,0.85)', border: `1px solid ${csRuleStr}`,
            borderRadius: 4, backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: e.opacity * fade,
            transform: `translateY(${e.ty}px)`,
          }}>
            <Diamond size={7} color={csAmber} filled />
            <div>
              <div style={{ fontFamily: fMono, fontSize: 11.5, color: csBone, letterSpacing: '0.05em' }}>
                {it.label}
              </div>
              <div style={{ fontFamily: fMono, fontSize: 9.5, color: csBone3, letterSpacing: '0.1em', marginTop: 2 }}>
                {it.sub} · HASHED
              </div>
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 4 — Stamp: immutable chain
// ─────────────────────────────────────────────────────────────────────────
function Scene4Stamp() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 02" stageLabel="STAMP"
        title={<>Stamp <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— immutable, by design.</em></>}
        lede="Hashed, encrypted, and committed to the chain at the moment of capture. Contemporaneity is cryptographically demonstrated — not asserted."
        localTime={localTime} duration={duration}/>

      <ChainVisualization localTime={localTime} />
    </div>
  );
}

function ChainVisualization({ localTime }) {
  // Big visual: artifact card on left -> hash stream in middle -> chain of blocks on right
  const baseX = 1080;
  const baseY = 230;
  const e = entry(localTime, 0.5, 0.7);

  // Artifact "in"
  return (
    <div style={{
      position: 'absolute', left: baseX, top: baseY,
      opacity: e.opacity,
      transform: `translateY(${e.ty}px)`,
    }}>
      {/* Source artifact */}
      <div style={{
        position: 'absolute', left: 0, top: 100,
        width: 200, height: 240,
        background: csInk2, border: `1px solid ${csRuleStr}`,
        borderRadius: 4, padding: 16,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.16em' }}>SOURCE</div>
          <div style={{ fontFamily: fMono, fontSize: 12, color: csBone, marginTop: 6 }}>whiteboard_n7.jpg</div>
        </div>
        <div style={{
          flex: 1, margin: '10px 0',
          background: 'repeating-linear-gradient(135deg, #232026 0 8px, #1a181d 8px 16px)',
          borderRadius: 2,
        }}/>
        <div style={{ fontFamily: fMono, fontSize: 9.5, color: csBone3, letterSpacing: '0.1em' }}>
          14:23:07 · 4.2MB
        </div>
      </div>

      {/* Arrow / hash flow */}
      <svg style={{ position: 'absolute', left: 200, top: 200, pointerEvents: 'none' }} width="280" height="60">
        <line x1="0" y1="30" x2="280" y2="30" stroke={csAmber} strokeWidth="1" strokeDasharray="4 4"
              strokeDashoffset={-localTime * 30} opacity="0.7"/>
        <polygon points="270,24 280,30 270,36" fill={csAmber}/>
      </svg>

      {/* Hash result */}
      <div style={{
        position: 'absolute', left: 220, top: 110,
        width: 320,
        padding: 16, background: csInk2, border: `1px solid ${csRuleStr}`,
        borderRadius: 4,
      }}>
        <div style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.16em' }}>
          SHA-256
        </div>
        <div style={{
          fontFamily: fMono, fontSize: 14, color: csBone, marginTop: 8,
          wordBreak: 'break-all', lineHeight: 1.5,
        }}>
          0x{settleHash('7f3ac4e19b2d8f6a05e1c4b3', localTime - 0.4, 1.4)}
        </div>
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${csRule}`,
          fontFamily: fMono, fontSize: 9.5, color: csBone3, letterSpacing: '0.1em',
        }}>
          DETERMINISTIC · ONE-WAY · CONTEMPORANEOUS
        </div>
      </div>

      {/* Block chain */}
      <BlockChain localTime={localTime} x={300} y={400} />
    </div>
  );
}

function BlockChain({ localTime, x, y }) {
  const blocks = [
    { id: '184_2A', label: 'WHITEBOARD',  at: 2.0 },
    { id: '184_2B', label: 'VOICE NOTE',  at: 2.7 },
    { id: '184_2C', label: 'LAB BOOK',    at: 3.4 },
    { id: '184_2D', label: 'CALCULATION', at: 4.1 },
    { id: '184_2E', label: 'STANDUP',     at: 4.8 },
  ];
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 6 }}>
      {blocks.map((b, i) => {
        const e = entry(localTime, b.at, 0.45, Easing.easeOutBack);
        const t = clamp((localTime - b.at) / 0.6, 0, 1);
        const glow = (1 - clamp((localTime - b.at) / 1.2, 0, 1));
        return (
          <React.Fragment key={i}>
            <div style={{
              width: 90, height: 90,
              border: `1px solid ${csAmber}`,
              background: 'rgba(225,162,58,0.05)',
              borderRadius: 4,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              opacity: e.opacity,
              transform: `scale(${0.7 + 0.3 * Easing.easeOutBack(t)})`,
              boxShadow: `0 0 ${10 + glow * 20}px ${glow * 8}px rgba(225,162,58,${0.2 + glow * 0.3})`,
            }}>
              <div style={{ fontFamily: fMono, fontSize: 9.5, color: csAmber, letterSpacing: '0.1em' }}>
                #{b.id}
              </div>
              <div style={{ fontFamily: fMono, fontSize: 8, color: csBone3, marginTop: 6, letterSpacing: '0.12em' }}>
                {b.label}
              </div>
              <div style={{ marginTop: 8, width: 22, height: 1, background: csAmber, opacity: 0.5 }}/>
            </div>
            {i < blocks.length - 1 && (
              <div style={{
                width: 14, height: 1, background: csAmber,
                opacity: clamp((localTime - b.at - 0.3) / 0.4, 0, 1) * 0.5,
              }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 5 — Assemble: chaos → brief
// ─────────────────────────────────────────────────────────────────────────
function Scene5Assemble() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 03" stageLabel="ASSEMBLE"
        title={<>Assemble <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— chaos into a brief.</em></>}
        lede="A specialised engine — trained on Division 355, AusIndustry guidance, and current case law — structures the captured material into a defensible claim narrative."
        localTime={localTime} duration={duration}/>

      <AssemblyDoc localTime={localTime} />
      <FloatingArtifacts localTime={localTime} />
    </div>
  );
}

function AssemblyDoc({ localTime }) {
  const e = entry(localTime, 0.6, 0.8);
  const sections = [
    { at: 1.4, k: 'HYPOTHESIS',   v: 'The novel alloy can sustain >800°C without phase separation.' },
    { at: 2.2, k: 'TECHNICAL UNCERTAINTY', v: 'No published evidence for grain-boundary behaviour at this composition.' },
    { at: 3.0, k: 'SYSTEMATIC PROGRESSION', v: 'Iterative furnace runs N4–N7, post-cycle metallography, EBSD.' },
    { at: 3.8, k: 'CORE ACTIVITY',v: 'Synthesis & characterisation of Vantage-7 specimen series.' },
    { at: 4.6, k: 'SUPPORTING',   v: 'Fixturing design; environmental conditioning; data pipeline.' },
    { at: 5.4, k: 'EVIDENCE',     v: '47 artifacts · whiteboard, voice, lab-book, calc — all chain-anchored.' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 1100, top: 220,
      width: 700, height: 760,
      background: csInk2, border: `1px solid ${csRuleStr}`,
      borderRadius: 4, padding: 36,
      opacity: e.opacity,
      transform: `translateY(${e.ty}px)`,
      boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
    }}>
      {/* doc header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>
          CLAIM BRIEF · VANTAGE-7
        </span>
        <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.14em' }}>
          DRAFT · CONSULTANT REVIEW
        </span>
      </div>
      <div style={{
        fontFamily: fSerif, fontSize: 30, color: csBone, fontWeight: 400,
        letterSpacing: '-0.01em', marginBottom: 24,
      }}>
        Hi-temp alloy phase-stability program
      </div>
      <div style={{ height: 1, background: csRule, marginBottom: 22 }}/>

      {sections.map((s, i) => {
        const se = entry(localTime, s.at, 0.5, Easing.easeOutCubic);
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '170px 1fr', gap: 16,
            padding: '13px 0',
            borderBottom: `1px solid ${csRule}`,
            opacity: se.opacity, transform: `translateY(${se.ty}px)`,
          }}>
            <div style={{ fontFamily: fMono, fontSize: 10.5, color: csAmber, letterSpacing: '0.16em', paddingTop: 3 }}>
              {s.k}
            </div>
            <div style={{
              fontFamily: fSans, fontSize: 14.5, color: csBone2, lineHeight: 1.5,
            }}>
              {s.v}
              <span style={{ marginLeft: 8 }}>
                <Diamond size={5} color={csAmber} filled style={{ verticalAlign: 'middle' }}/>
                <span style={{
                  fontFamily: fMono, fontSize: 9.5, color: csBone4,
                  marginLeft: 6, letterSpacing: '0.12em',
                }}>SRC · #{(184 + i * 3).toString(16).toUpperCase()}_2{String.fromCharCode(65 + i)}</span>
              </span>
            </div>
          </div>
        );
      })}

      <div style={{
        marginTop: 24, display: 'flex', justifyContent: 'space-between',
        fontFamily: fMono, fontSize: 10.5, color: csBone3, letterSpacing: '0.14em',
      }}>
        <span><span style={{ color: csAmber }}>◆</span> DIVISION 355 · ITAA 1997</span>
        <span><span style={{ color: csAmber }}>◆</span> NO HALLUCINATED HYPOTHESIS</span>
      </div>
    </div>
  );
}

function FloatingArtifacts({ localTime }) {
  // Tiny artifact tiles drifting from left toward the doc
  const tiles = [
    { x: 220, y: 580, at: 0.4,  label: 'wb_n7' },
    { x: 320, y: 720, at: 0.6,  label: 'voice_0:34' },
    { x: 440, y: 620, at: 0.8,  label: 'lab_p47' },
    { x: 540, y: 760, at: 1.0,  label: 'calc_n7' },
    { x: 200, y: 820, at: 1.2,  label: 'standup' },
    { x: 360, y: 540, at: 1.4,  label: 'photo_a' },
    { x: 500, y: 480, at: 1.6,  label: 'photo_b' },
    { x: 640, y: 700, at: 1.8,  label: 'memo_3' },
    { x: 760, y: 600, at: 2.0,  label: 'plot_x' },
    { x: 900, y: 760, at: 2.2,  label: 'plot_y' },
  ];
  return (
    <React.Fragment>
      {tiles.map((t, i) => {
        const localT = localTime - t.at;
        if (localT < 0) return null;
        // After hold, fly toward doc and disappear
        const flyT = clamp((localT - 1.0) / 1.4, 0, 1);
        const targetX = 1180, targetY = 280 + i * 20;
        const x = lerp(t.x, targetX, Easing.easeInCubic(flyT));
        const y = lerp(t.y, targetY, Easing.easeInCubic(flyT));
        const opacity = clamp(localT / 0.4, 0, 1) * (1 - flyT);
        const scale = 1 - flyT * 0.6;
        return (
          <div key={i} style={{
            position: 'absolute', left: x, top: y,
            transform: `scale(${scale})`, opacity,
            padding: '6px 10px',
            background: 'rgba(19,19,22,0.92)',
            border: `1px solid ${csRuleStr}`,
            borderRadius: 3,
            fontFamily: fMono, fontSize: 11, color: csBone2, letterSpacing: '0.05em',
            display: 'flex', alignItems: 'center', gap: 8,
            pointerEvents: 'none',
          }}>
            <Diamond size={5} filled color={csAmber}/>
            {t.label}
          </div>
        );
      })}
    </React.Fragment>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 6 — Apportion: ledger × activities
// ─────────────────────────────────────────────────────────────────────────
function Scene6Apportion() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 04" stageLabel="APPORTION"
        title={<>Apportion <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— by date, by line.</em></>}
        lede="Xero and MYOB feed the evidence window. Every transaction is date-matched to an activity. Wages, contractors, overhead — each justified, each traceable."
        localTime={localTime} duration={duration}/>

      <ApportionRig localTime={localTime} />
    </div>
  );
}

function ApportionRig({ localTime }) {
  const e = entry(localTime, 0.5, 0.6);
  // Ledger lines on left, activity bars on right, connecting lines between
  const ledger = [
    { at: 1.0,  date: '14 OCT',  vendor: 'PAYROLL · CORE TEAM',     amt: '$48,200', cat: 'WAGES',       row: 0 },
    { at: 1.4,  date: '22 OCT',  vendor: 'BLUESCOPE LABS',          amt: '$11,750', cat: 'CONTRACTOR',  row: 1 },
    { at: 1.8,  date: '03 NOV',  vendor: 'CSIRO · TEST SUITE',      amt: '$ 6,400', cat: 'CONTRACTOR',  row: 1 },
    { at: 2.2,  date: '12 NOV',  vendor: 'PAYROLL · CORE TEAM',     amt: '$48,200', cat: 'WAGES',       row: 0 },
    { at: 2.6,  date: '28 NOV',  vendor: 'AGILENT · METROLOGY',     amt: '$ 9,150', cat: 'OVERHEAD',    row: 2 },
    { at: 3.0,  date: '04 DEC',  vendor: 'PAYROLL · CORE TEAM',     amt: '$48,200', cat: 'WAGES',       row: 0 },
    { at: 3.4,  date: '15 DEC',  vendor: 'AWS · COMPUTE',           amt: '$ 4,820', cat: 'OVERHEAD',    row: 2 },
  ];
  const activities = [
    { label: 'CORE · Vantage-7 synthesis',       color: csAmber,    row: 0 },
    { label: 'SUPPORTING · External lab work',   color: csSage,     row: 1 },
    { label: 'SUPPORTING · Compute & metrology', color: csBone2,    row: 2 },
  ];
  const ledgerX = 200, ledgerY = 540;
  const activityX = 1180, activityY = 540;
  return (
    <div style={{
      position: 'absolute', inset: 0, opacity: e.opacity,
    }}>
      {/* Ledger */}
      <div style={{
        position: 'absolute', left: ledgerX, top: ledgerY,
        width: 520, padding: 24,
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 14,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>XERO · LEDGER</span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.12em' }}>FY26 · WINDOW</span>
        </div>
        {ledger.map((l, i) => {
          const se = entry(localTime, l.at, 0.4);
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '70px 1fr 90px',
              gap: 14, padding: '8px 0',
              borderBottom: i < ledger.length - 1 ? `1px solid ${csRule}` : 'none',
              opacity: se.opacity, transform: `translateY(${se.ty}px)`,
              fontFamily: fMono, fontSize: 12,
            }}>
              <span style={{ color: csBone3, letterSpacing: '0.08em' }}>{l.date}</span>
              <span style={{ color: csBone, letterSpacing: '0.02em' }}>{l.vendor}</span>
              <span style={{ color: csAmber, textAlign: 'right' }}>{l.amt}</span>
            </div>
          );
        })}
      </div>

      {/* Activities */}
      <div style={{
        position: 'absolute', left: activityX, top: activityY,
        width: 540, padding: 24,
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 14,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>ACTIVITY MAP</span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.12em' }}>BY DATE & SOURCE</span>
        </div>
        {activities.map((a, i) => {
          const se = entry(localTime, 0.8 + i * 0.2, 0.5);
          // Count matched ledger items
          const matched = ledger.filter(l => l.row === a.row && localTime >= l.at + 0.5).length;
          const total = ledger.filter(l => l.row === a.row).length;
          const totalAmt = ledger
            .filter(l => l.row === a.row && localTime >= l.at + 0.5)
            .reduce((s, l) => s + parseFloat(l.amt.replace(/[$,\s]/g, '')), 0);
          return (
            <div key={i} style={{
              padding: '14px 0',
              borderBottom: i < activities.length - 1 ? `1px solid ${csRule}` : 'none',
              opacity: se.opacity, transform: `translateY(${se.ty}px)`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Diamond size={8} color={a.color} filled />
                <span style={{ fontFamily: fSans, fontSize: 16, color: csBone, fontWeight: 500 }}>
                  {a.label}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginLeft: 18 }}>
                <div style={{
                  flex: 1, height: 4, background: csRule, borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${total ? (matched/total)*100 : 0}%`,
                    height: '100%', background: a.color,
                    transition: 'width 200ms',
                  }}/>
                </div>
                <span style={{
                  fontFamily: fMono, fontSize: 12, color: csBone,
                  width: 130, textAlign: 'right', letterSpacing: '0.04em',
                }}>
                  ${totalAmt.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${csRuleStr}`,
          display: 'flex', justifyContent: 'space-between',
          fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.12em',
        }}>
          <span>LINE-ITEM TRACEABILITY</span>
          <span style={{ color: csAmber }}>NO FLAT %</span>
        </div>
      </div>

      {/* Connecting lines from ledger → activities */}
      <ApportionLines localTime={localTime} ledger={ledger} activities={activities} />
    </div>
  );
}

function ApportionLines({ localTime, ledger, activities }) {
  // Approximate y of each ledger row and each activity row
  const ledgerLeftX = 720;   // right edge of ledger card
  const ledgerY0 = 540 + 24 + 14 + 14; // top of first row, very approximate
  const rowH = 28;

  const actX = 1180 + 18;
  const actY0 = 540 + 24 + 14 + 14 + 16;
  const actRowH = 60;

  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="1920" height="1080">
      {ledger.map((l, i) => {
        const t = localTime - l.at - 0.4;
        const draw = clamp(t / 0.5, 0, 1);
        if (draw <= 0) return null;
        const a = activities.find(x => x.row === l.row);
        if (!a) return null;
        const sy = ledgerY0 + i * rowH + 8;
        const ey = actY0 + a.row * actRowH + 8;
        const cx1 = ledgerLeftX + (actX - ledgerLeftX) * 0.35;
        const cx2 = ledgerLeftX + (actX - ledgerLeftX) * 0.65;
        const d = `M ${ledgerLeftX} ${sy} C ${cx1} ${sy}, ${cx2} ${ey}, ${actX} ${ey}`;
        // length-ish for dash trick
        const len = 700;
        return (
          <path key={i} d={d}
            stroke={a.color} strokeWidth="1"
            opacity={0.55 * draw}
            fill="none"
            strokeDasharray={len}
            strokeDashoffset={len * (1 - draw)} />
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 7 — Watch: daily signal scan
// ─────────────────────────────────────────────────────────────────────────
function Scene7Watch() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 05" stageLabel="WATCH"
        title={<>Watch <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— the program, daily.</em></>}
        lede="ATO alerts, AusIndustry guidance, AAT and Federal Court decisions — ingested every morning, ranked by exposure across your live book."
        localTime={localTime} duration={duration}/>

      <SignalFeed localTime={localTime} />
    </div>
  );
}

function SignalFeed({ localTime }) {
  const signals = [
    { at: 0.6, src: 'ATO',          tag: 'TAXPAYER ALERT', code: 'TA 2026/03', title: 'Software development eligibility — new evidence standard', exposure: 3, when: '14:01 AEST' },
    { at: 1.2, src: 'AUSINDUSTRY',  tag: 'GUIDANCE',       code: 'GN 26-04',   title: 'Updated guidance — supporting activities determination',     exposure: 1, when: '09:42 AEST' },
    { at: 1.8, src: 'AAT',          tag: 'DECISION',       code: '[2026] AATA 412', title: 'Body by Michael — duty-of-care doctrine extended',     exposure: 2, when: '08:15 AEST' },
    { at: 2.4, src: 'FCA',          tag: 'JUDGMENT',       code: '[2026] FCA 287',  title: 'GQHC v. Innovation — apportionment standard',          exposure: 0, when: '07:50 AEST' },
    { at: 3.0, src: 'AUSINDUSTRY',  tag: 'ANNOUNCEMENT',   code: '—',          title: 'Examination targeting — biotech & clean energy uplift',     exposure: 5, when: '06:30 AEST' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 200, top: 580, right: 200,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '120px 180px 1fr 120px 100px',
        gap: 18, padding: '12px 18px',
        borderBottom: `1px solid ${csRuleStr}`,
        fontFamily: fMono, fontSize: 10.5, color: csBone3, letterSpacing: '0.18em',
      }}>
        <span>SOURCE</span><span>REFERENCE</span><span>HEADLINE</span><span>EXPOSURE</span><span>INGESTED</span>
      </div>
      {signals.map((s, i) => {
        const e = entry(localTime, s.at, 0.5);
        const isHot = s.exposure >= 3;
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '120px 180px 1fr 120px 100px',
            gap: 18, padding: '18px 18px',
            borderBottom: `1px solid ${csRule}`,
            opacity: e.opacity, transform: `translateY(${e.ty}px)`,
            background: isHot ? 'rgba(225,162,58,0.04)' : 'transparent',
            alignItems: 'center',
          }}>
            <span style={{ fontFamily: fMono, fontSize: 12, color: csAmber, letterSpacing: '0.16em' }}>
              {s.src}
            </span>
            <div>
              <div style={{ fontFamily: fMono, fontSize: 9.5, color: csBone4, letterSpacing: '0.14em' }}>
                {s.tag}
              </div>
              <div style={{ fontFamily: fMono, fontSize: 11.5, color: csBone2, marginTop: 3 }}>
                {s.code}
              </div>
            </div>
            <span style={{ fontFamily: fSerif, fontSize: 22, color: csBone, letterSpacing: '-0.01em' }}>
              {s.title}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.exposure > 0 ? (
                <React.Fragment>
                  <div style={{
                    padding: '4px 10px',
                    border: `1px solid ${isHot ? csAmber : csRuleStr}`,
                    background: isHot ? 'rgba(225,162,58,0.1)' : 'transparent',
                    fontFamily: fMono, fontSize: 11,
                    color: isHot ? csAmber : csBone2,
                    letterSpacing: '0.1em',
                  }}>
                    {s.exposure} CLAIM{s.exposure>1?'S':''}
                  </div>
                </React.Fragment>
              ) : (
                <span style={{ fontFamily: fMono, fontSize: 11, color: csBone4, letterSpacing: '0.1em' }}>—</span>
              )}
            </div>
            <span style={{ fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.08em' }}>
              {s.when}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 8 — Seal: block locks
// ─────────────────────────────────────────────────────────────────────────
function Scene8Seal() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <SceneHeader stage="STAGE 06" stageLabel="SEAL"
        title={<>Seal <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— the chain locks.</em></>}
        lede="The consultant reviews, edits, signs off. At sign-off the claim file is sealed as a single cryptographic block. From this moment forward, it cannot be quietly edited."
        localTime={localTime} duration={duration}/>

      <SealVisual localTime={localTime} />
    </div>
  );
}

function SealVisual({ localTime }) {
  const e = entry(localTime, 0.4, 0.6);
  // Big block sigil that rotates + locks
  const rotT = clamp(localTime / 2.0, 0, 1);
  const rot = lerp(-15, 0, Easing.easeOutBack(rotT));
  const lockT = clamp((localTime - 1.5) / 0.7, 0, 1);
  const stampT = clamp((localTime - 2.5) / 0.5, 0, 1);

  return (
    <div style={{
      position: 'absolute', left: 1080, top: 240,
      opacity: e.opacity,
    }}>
      {/* Big seal */}
      <div style={{
        position: 'relative', width: 640, height: 640,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* outer ring */}
        <svg width="640" height="640" viewBox="0 0 640 640" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="320" cy="320" r="300" fill="none" stroke={csAmber} strokeWidth="1" opacity="0.4"/>
          <circle cx="320" cy="320" r="280" fill="none" stroke={csAmber} strokeWidth="1" opacity="0.2" strokeDasharray="4 8"/>
          {/* tick marks */}
          {Array.from({length: 60}).map((_, i) => {
            const a = (i / 60) * Math.PI * 2;
            const r1 = 300, r2 = i % 5 === 0 ? 286 : 292;
            const x1 = 320 + Math.cos(a) * r1;
            const y1 = 320 + Math.sin(a) * r1;
            const x2 = 320 + Math.cos(a) * r2;
            const y2 = 320 + Math.sin(a) * r2;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={csAmber} strokeWidth="1" opacity="0.5"/>;
          })}
          {/* hash text around ring (decorative) */}
          <defs>
            <path id="ringPath" d="M 320 320 m -260 0 a 260 260 0 1 1 520 0 a 260 260 0 1 1 -520 0"/>
          </defs>
          <text fill={csBone3} fontFamily={fMono} fontSize="11" letterSpacing="8" opacity="0.7">
            <textPath href="#ringPath" startOffset={`${(localTime * 5) % 100}%`}>
              · BLOCK 00184_2A · IMMUTABLE · DEFENSIBLE · SEALED · 2026.05.21 · 14:23 AEST · OMNISCIENT AI · SOVEREIGN R&amp;DTI · CHAIN-ANCHORED ·
            </textPath>
          </text>
        </svg>

        {/* inner diamond */}
        <div style={{
          width: 280, height: 280,
          background: 'rgba(225,162,58,0.04)',
          border: `1px solid ${csAmber}`,
          transform: `rotate(${45 + rot}deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            transform: `rotate(${-45 - rot}deg)`,
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.22em' }}>
              SEALED
            </div>
            <div style={{
              fontFamily: fSerif, fontSize: 72, color: csBone, fontWeight: 300,
              marginTop: 14, letterSpacing: '-0.02em',
            }}>
              #00184_2A
            </div>
            <div style={{
              fontFamily: fMono, fontSize: 10, color: csBone3,
              marginTop: 14, letterSpacing: '0.18em',
            }}>
              IMMUTABLE · DEFENSIBLE
            </div>
            {/* "lock" animation */}
            <div style={{
              marginTop: 22,
              opacity: lockT,
              transform: `scale(${0.7 + 0.3 * lockT})`,
            }}>
              <svg width="36" height="44" viewBox="0 0 36 44" fill="none">
                <rect x="6" y="20" width="24" height="20" stroke={csAmber} strokeWidth="1.6"/>
                <path d="M11 20 V 13 a 7 7 0 0 1 14 0 V 20" stroke={csAmber} strokeWidth="1.6"/>
                <circle cx="18" cy="30" r="2" fill={csAmber}/>
              </svg>
            </div>
          </div>
        </div>

        {/* "stamped" mark */}
        <div style={{
          position: 'absolute', right: -40, bottom: 60,
          border: `2px solid ${csAmber}`, padding: '8px 18px',
          transform: `rotate(-12deg) scale(${stampT})`,
          opacity: stampT,
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.2em',
          color: csAmber,
        }}>
          STAMPED
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 9 — The payoff: 85–95%
// ─────────────────────────────────────────────────────────────────────────
function Scene9Stat() {
  const { localTime, duration } = useSprite();
  const e = entry(localTime, 0.2, 0.8);

  // Number counts up
  const countT = clamp(localTime / 1.4, 0, 1);
  const num = Math.round(lerp(0, 85, Easing.easeOutCubic(countT)));

  // "–95%" reveals
  const showHigh = clamp((localTime - 1.4) / 0.6, 0, 1);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* eyebrow */}
      <div style={{
        position: 'absolute', left: 200, top: 290,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.1 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3 }}>
          THE PAYOFF — INDEPENDENT VALIDATION IN PROGRESS
        </span>
      </div>

      {/* Giant number */}
      <div style={{
        position: 'absolute', left: 200, top: 330,
        fontFamily: fSerif, fontWeight: 300,
        fontSize: 480, lineHeight: 0.82, letterSpacing: '-0.05em',
        color: csBone,
        display: 'flex', alignItems: 'baseline',
        ...ee(localTime, duration, { start: 0.2, entryDur: 0.8 }),
      }}>
        <span>{num}</span>
        <span style={{
          color: csAmber, fontStyle: 'italic', fontVariationSettings: '"opsz" 144, "SOFT" 100',
          opacity: showHigh, transform: `translateY(${(1 - showHigh) * 30}px)`, display: 'inline-block',
        }}>
          –95
        </span>
        <span style={{
          fontSize: 280, color: csAmber, marginLeft: 12,
        }}>%</span>
      </div>

      {/* copy */}
      <div style={{
        position: 'absolute', left: 200, top: 850, right: 200,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60,
        ...ee(localTime, duration, { start: 1.6, entryDur: 0.6 }),
      }}>
        <div style={{
          fontFamily: fSerif, fontSize: 56, fontWeight: 300, lineHeight: 1.05,
          color: csBone, letterSpacing: '-0.02em',
        }}>
          Of consultant time, returned.
        </div>
        <div style={{
          fontFamily: fSans, fontSize: 20, lineHeight: 1.55, color: csBone2,
        }}>
          ArchiveOne does the assembly. The consultant does the judgement.
          Quality does not depreciate — it improves. Every claim fully evidenced,
          every hypothesis prior-supported, every line of apportionment traceable.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 10 — End card
// ─────────────────────────────────────────────────────────────────────────
function Scene10End() {
  const { localTime, duration } = useSprite();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* eyebrow */}
      <div style={{
        position: 'absolute', left: 200, top: 320,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.2 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{ fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3 }}>
          A PRODUCT OF OMNISCIENT AI PTY LTD · MORNINGTON PENINSULA
        </span>
      </div>

      {/* Headline */}
      <div style={{
        position: 'absolute', left: 200, top: 380,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 0.6, entryDur: 0.9 }),
      }}>
        The first of its kind.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 580,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        maxWidth: 1500,
        ...ee(localTime, duration, { start: 1.6, entryDur: 0.9 }),
      }}>
        Built for the Australia&nbsp;
        <span style={{
          fontStyle: 'italic', color: csAmber,
          fontVariationSettings: '"opsz" 144, "SOFT" 100',
        }}>
          that is coming.
        </span>
      </div>

      {/* Sig row */}
      <div style={{
        position: 'absolute', left: 200, right: 200, bottom: 140,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        borderTop: `1px solid ${csRuleStr}`, paddingTop: 28,
        fontFamily: fMono, fontSize: 13, color: csBone3, letterSpacing: '0.14em',
        ...ee(localTime, duration, { start: 2.6, entryDur: 0.6 }),
      }}>
        <div>
          <div style={{ color: csBone, marginBottom: 6 }}>ARCHIVEONE</div>
          <div>SOVEREIGN INFRASTRUCTURE · BUILT IN AUSTRALIA</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: csBone, marginBottom: 6 }}>STAMPED</div>
          <div>2026.05.21 · 14:23 AEST · BLOCK #00184_2A</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Chrome manager — picks per-scene chrome state from current time
// ─────────────────────────────────────────────────────────────────────────
function ChromeManager({ scenes }) {
  const t = useTime();
  let active = null;
  for (const s of scenes) {
    if (t >= s.start && t <= s.end) { active = s; break; }
  }
  if (!active) return null;
  return (
    <CSChrome
      stage={active.stage}
      title={active.stageLabel}
      block={active.block || '#00184_2A'}
      hash={active.hash || '0x7f3a…c4e1'}
      showBrand={active.showBrand !== false}
      showScene={active.showScene !== false}
    />
  );
}

Object.assign(window, {
  Scene1ColdOpen, Scene2Title, Scene3Capture, Scene4Stamp, Scene5Assemble,
  Scene6Apportion, Scene7Watch, Scene8Seal, Scene9Stat, Scene10End,
  ChromeManager, CSBackdrop,
});
