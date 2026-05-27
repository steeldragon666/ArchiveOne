// platform-scenes.jsx — ArchiveOne platform/economics explainer scenes.
// 1920x1080, ~90s. Sovereignty, encryption, claimant ownership, export,
// pricing, client app, economics vs liability, founder offer.

// ─── Tweakable economics (read live from window.__platformTweaks) ────────

function getTweaks() {
  const t = (typeof window !== 'undefined' && window.__platformTweaks) || {};
  return {
    perClaim:    t.perClaim    ?? 1500,
    founderPct:  t.founderPct  ?? 50,
    founderSeats:t.founderSeats?? 20,
  };
}

function fmtK(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return '$' + (k % 1 === 0 ? k : k.toFixed(1)) + 'K';
  }
  return '$' + n.toLocaleString();
}
function fmtFull(n) { return '$' + Math.round(n).toLocaleString(); }

// ─── Helpers (local, per-script scope) ───────────────────────────────────

function plerp(a, b, t) { return a + (b - a) * t; }

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

// Shared scene header (same vocabulary as the original video)
function PSceneHeader({ stage, stageLabel, title, lede, localTime, duration, startAt = 0.15, maxWidth = 880 }) {
  return (
    <div style={{ position: 'absolute', left: 200, top: 260, maxWidth }}>
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
        fontSize: 84, lineHeight: 1.0, letterSpacing: '-0.025em',
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

// ─────────────────────────────────────────────────────────────────────────
// SCENE 1 — Cold open: "Your client's file. Your client's keys."
// ─────────────────────────────────────────────────────────────────────────
function PScene1ColdOpen() {
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
        }}>THE PLATFORM · TECHNICAL & COMMERCIAL DETAIL</span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 340,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 158, lineHeight: 0.94, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 1.0, entryDur: 0.8 }),
      }}>
        Your client&rsquo;s file.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 530,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 158, lineHeight: 0.94, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 2.2, entryDur: 0.8 }),
      }}>
        Your client&rsquo;s&nbsp;
        <span style={{ fontStyle: 'italic', color: csAmber, fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
          keys.
        </span>
      </div>

      {/* Right-side floating vault graphic */}
      <PVaultBadge localTime={localTime} startAt={3.0} />

      <div style={{
        position: 'absolute', left: 200, top: 770,
        display: 'flex', alignItems: 'center', gap: 16,
        ...ee(localTime, duration, { start: 4.0 }),
      }}>
        <Diamond size={8} color={csAmber} filled />
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.16em',
          color: csBone2, textTransform: 'uppercase',
        }}>
          SOVEREIGN · ENCRYPTED · OWNED BY THE CLAIMANT
        </span>
      </div>
    </div>
  );
}

function PVaultBadge({ localTime, startAt }) {
  const t = clamp((localTime - startAt) / 0.9, 0, 1);
  const draw = Easing.easeOutCubic(t);
  const opacity = clamp((localTime - startAt) / 0.4, 0, 1);
  return (
    <div style={{
      position: 'absolute', right: 220, top: 380,
      transform: `rotate(-6deg) scale(${0.94 + 0.06 * draw})`,
      opacity: opacity * 0.92,
    }}>
      <svg width="420" height="260" viewBox="0 0 420 260">
        <rect x="6" y="6" width="408" height="248" fill="none"
              stroke={csAmber} strokeWidth="3"
              strokeDasharray={1312}
              strokeDashoffset={1312 * (1 - draw)} />
        <rect x="22" y="22" width="376" height="216" fill="none"
              stroke={csAmber} strokeWidth="1" opacity="0.55" />
        {/* Key glyph */}
        <g transform="translate(80,90)" stroke={csAmber} strokeWidth="2.4" fill="none" opacity={draw}>
          <circle cx="22" cy="40" r="22"/>
          <circle cx="22" cy="40" r="6" fill={csAmber}/>
          <line x1="44" y1="40" x2="180" y2="40"/>
          <line x1="160" y1="40" x2="160" y2="56"/>
          <line x1="140" y1="40" x2="140" y2="60"/>
        </g>
        <text x="210" y="190" textAnchor="middle"
              fill={csAmber} fontFamily={fMono} fontSize="13"
              letterSpacing="0.24em" opacity={draw * 0.85}>
          CLAIMANT HOLDS THE KEY
        </text>
        <text x="210" y="218" textAnchor="middle"
              fill={csAmber} fontFamily={fMono} fontSize="10"
              letterSpacing="0.22em" opacity={draw * 0.6}>
          NO MASTER OVERRIDE · NO SHADOW COPY
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 2 — Title card
// ─────────────────────────────────────────────────────────────────────────
function PScene2Title() {
  const { localTime, duration } = useSprite();
  const burstT = clamp(localTime / 0.6, 0, 1);
  const burstScale = Easing.easeOutBack(burstT);
  const burstGlow = 1 - clamp((localTime - 0.6) / 1.0, 0, 1);

  const word = 'The Platform';
  const letters = word.split('');
  const start = 0.45;
  const perLetter = 0.05;

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
        fontSize: 220, lineHeight: 1, letterSpacing: '-0.04em',
        display: 'flex', color: csBone,
      }}>
        {letters.map((ch, i) => {
          const e = entry(localTime, start + i * perLetter, 0.45, Easing.easeOutCubic);
          return (
            <span key={i} style={{
              opacity: e.opacity,
              transform: `translateY(${e.ty}px)`,
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
        Sovereign infrastructure. Honest economics.
      </div>

      <div style={{
        marginTop: 80,
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: fMono, fontSize: 13, letterSpacing: '0.22em',
        color: csBone3, textTransform: 'uppercase',
        ...ee(localTime, duration, { start: 2.1, entryDur: 0.6, exitDur: 0.6 }),
      }}>
        <span>SOVEREIGNTY</span>
        <Diamond size={6} filled color={csAmber} />
        <span>ENCRYPTION</span>
        <Diamond size={6} filled color={csAmber} />
        <span>OWNERSHIP</span>
        <Diamond size={6} filled color={csAmber} />
        <span>ECONOMICS</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 3 — Sovereign: data has not left Australian soil
// ─────────────────────────────────────────────────────────────────────────
function PScene3Sovereign() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 01" stageLabel="SOVEREIGN"
        title={<>Sovereign <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— in country, end to end.</em></>}
        lede="Stored in Australia. Hosted in Australia. Adjudicated under Australian law. Every byte of evidence — and every key that protects it — physically resides on Australian soil."
        localTime={localTime} duration={duration}/>

      <PSovereignMap localTime={localTime} />
    </div>
  );
}

function PSovereignMap({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  // Stylised Australia outline path
  const auPath = "M 60 130 L 110 110 L 170 100 L 230 95 L 290 92 L 340 96 L 390 110 L 430 140 L 450 175 L 460 215 L 458 250 L 440 285 L 410 315 L 360 335 L 290 345 L 220 348 L 160 340 L 110 320 L 80 290 L 55 250 L 50 210 L 52 170 Z";
  const dots = [
    { x: 380, y: 175, label: 'AZ-1 · SYDNEY',    at: 1.2 },
    { x: 295, y: 290, label: 'AZ-2 · MELBOURNE', at: 1.6 },
  ];
  // Foreign rejected lanes
  const lanes = [
    { at: 2.2, label: 'US-EAST · BLOCKED'      },
    { at: 2.6, label: 'EU-WEST · BLOCKED'      },
    { at: 3.0, label: 'SUBPOENA RISK · NONE'   },
  ];

  return (
    <div style={{
      position: 'absolute', left: 1080, top: 230,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        width: 760, padding: 36,
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: 22,
        }}>
          <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>
            AUSTRALIAN SOVEREIGN ZONE
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.12em' }}>
            COMPUTE · STORAGE · KEY MATERIAL
          </span>
        </div>

        <div style={{ position: 'relative', height: 380 }}>
          <svg width="680" height="380" viewBox="0 0 680 380" style={{ position: 'absolute', left: 20, top: 0, overflow: 'visible' }}>
            {/* outline */}
            <path d={auPath} fill="rgba(225,162,58,0.04)"
                  stroke={csAmber} strokeWidth="1.4"
                  strokeDasharray="2400"
                  strokeDashoffset={2400 * (1 - clamp(localTime / 1.4, 0, 1))}
                  opacity="0.9"/>
            {/* dotted grid inside */}
            <defs>
              <pattern id="auDots" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="0.8" fill={csBone3} opacity="0.5"/>
              </pattern>
              <clipPath id="auClip">
                <path d={auPath}/>
              </clipPath>
            </defs>
            <rect x="0" y="0" width="680" height="380" fill="url(#auDots)" clipPath="url(#auClip)" opacity={clamp((localTime - 1.0) / 0.6, 0, 1)}/>

            {/* dots */}
            {dots.map((d, i) => {
              const lt = clamp((localTime - d.at) / 0.5, 0, 1);
              const r = 5 + 4 * Math.sin(localTime * 3 + i);
              return (
                <g key={i} opacity={lt}>
                  <circle cx={d.x} cy={d.y} r={r + 4} fill="rgba(225,162,58,0.18)"/>
                  <circle cx={d.x} cy={d.y} r="5" fill={csAmber}/>
                  <line x1={d.x} y1={d.y} x2={d.x + 60} y2={d.y - 40}
                        stroke={csAmber} strokeWidth="1" opacity="0.6"/>
                  <text x={d.x + 64} y={d.y - 38}
                        fill={csBone} fontFamily={fMono} fontSize="12"
                        letterSpacing="2">{d.label}</text>
                </g>
              );
            })}
          </svg>
        </div>

        <div style={{
          marginTop: 6, paddingTop: 18, borderTop: `1px solid ${csRule}`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          {lanes.map((l, i) => {
            const lt = clamp((localTime - l.at) / 0.5, 0, 1);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: lt, transform: `translateX(${(1-lt) * -10}px)`,
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="7.5" fill="none" stroke={csAmber} strokeWidth="1.2"/>
                  <line x1="4" y1="14" x2="14" y2="4" stroke={csAmber} strokeWidth="1.4"/>
                </svg>
                <span style={{ fontFamily: fMono, fontSize: 12, color: csBone2, letterSpacing: '0.16em' }}>
                  {l.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{
        marginTop: 18,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.14em',
      }}>
        <span><span style={{ color: csAmber }}>◆</span> IRAP-ALIGNED · ISO 27001</span>
        <span><span style={{ color: csAmber }}>◆</span> CLOUD ACT-IMMUNE</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 4 — Encrypted: per-claim envelope encryption
// ─────────────────────────────────────────────────────────────────────────
function PScene4Encrypted() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 02" stageLabel="ENCRYPTED"
        title={<>Encrypted <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— per claim, per claimant.</em></>}
        lede="Every claim file is wrapped in its own AES-256-GCM data key, sealed under a claimant master key, and rooted in a hardware security module. Even ArchiveOne operators cannot read the contents."
        localTime={localTime} duration={duration}/>

      <PEncryptionStack localTime={localTime} />
    </div>
  );
}

function PEncryptionStack({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  const layers = [
    { at: 1.0, k: 'L1 · DATA KEY',     v: 'AES-256-GCM',        sub: 'unique per claim · rotated per session', code: 'DEK' },
    { at: 1.6, k: 'L2 · MASTER KEY',   v: 'RSA-4096 ENVELOPE',  sub: 'unique per claimant · wraps every DEK',  code: 'KEK' },
    { at: 2.2, k: 'L3 · ROOT (HSM)',   v: 'FIPS 140-2 LEVEL 3', sub: 'air-gapped · split-knowledge custody',   code: 'ROOT' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 1080, top: 230,
      width: 760,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* Source file ribbon */}
      <div style={{
        padding: '14px 20px',
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Diamond size={8} color={csAmber} filled />
          <span style={{ fontFamily: fMono, fontSize: 12, color: csBone, letterSpacing: '0.1em' }}>
            CLAIM FILE · VANTAGE-7
          </span>
        </div>
        <span style={{ fontFamily: fMono, fontSize: 10.5, color: csBone3, letterSpacing: '0.14em' }}>
          47 ARTIFACTS · 312 MB
        </span>
      </div>

      {/* Down arrow */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
        <svg width="14" height="24" viewBox="0 0 14 24">
          <line x1="7" y1="0" x2="7" y2="18" stroke={csAmber} strokeWidth="1" strokeDasharray="3 3"
                strokeDashoffset={-localTime * 20}/>
          <polygon points="2,16 12,16 7,24" fill={csAmber}/>
        </svg>
      </div>

      {/* Three envelope layers */}
      {layers.map((l, i) => {
        const lt = clamp((localTime - l.at) / 0.7, 0, 1);
        const sealT = clamp((localTime - l.at - 0.3) / 0.6, 0, 1);
        return (
          <div key={i} style={{
            opacity: lt, transform: `translateY(${(1-lt)*16}px)`,
            marginBottom: 14,
            border: `1px solid ${csAmber}`,
            background: `rgba(225,162,58,${0.04 + i * 0.02})`,
            borderRadius: 4,
            padding: '18px 22px',
            display: 'grid', gridTemplateColumns: '110px 1fr 180px', gap: 18,
            alignItems: 'center',
          }}>
            <span style={{
              fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em',
            }}>{l.k}</span>
            <div>
              <div style={{ fontFamily: fSerif, fontSize: 26, color: csBone, fontWeight: 400, letterSpacing: '-0.01em' }}>
                {l.v}
              </div>
              <div style={{ fontFamily: fSans, fontSize: 13, color: csBone3, marginTop: 4 }}>
                {l.sub}
              </div>
            </div>
            <div style={{
              fontFamily: fMono, fontSize: 11, color: csBone2,
              textAlign: 'right', letterSpacing: '0.06em',
              opacity: sealT,
            }}>
              <div style={{ color: csBone4, marginBottom: 4, letterSpacing: '0.14em' }}>{l.code}</div>
              <div>0x{settleHash('a91f4c7d2e8b'.slice(0, 8 + i*2), localTime - l.at - 0.3, 0.7)}</div>
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div style={{
        marginTop: 8, paddingTop: 16, borderTop: `1px solid ${csRule}`,
        display: 'flex', justifyContent: 'space-between',
        fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.14em',
      }}>
        <span><span style={{ color: csAmber }}>◆</span> ZERO-KNOWLEDGE TO OPERATORS</span>
        <span><span style={{ color: csAmber }}>◆</span> CLIENT-SIDE KEY GENERATION</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 5 — Owned: the claimant owns the file
// ─────────────────────────────────────────────────────────────────────────
function PScene5Owned() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 03" stageLabel="OWNED"
        title={<>Owned <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— by the claimant.</em></>}
        lede="The file belongs to the claimant company, not the consultancy and not us. The consultant operates the platform under delegation — granular, time-bounded, fully revocable."
        localTime={localTime} duration={duration}/>

      <POwnershipDiagram localTime={localTime} />
    </div>
  );
}

function POwnershipDiagram({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  const rights = [
    { k: 'READ',     claimant: true,  consultant: true,  at: 1.0 },
    { k: 'WRITE',    claimant: true,  consultant: true,  at: 1.3, note: 'within scope of engagement' },
    { k: 'EXPORT',   claimant: true,  consultant: true,  at: 1.6, note: 'sealed bundle · cryptographic chain' },
    { k: 'TRANSFER', claimant: true,  consultant: false, at: 1.9, note: 'move file to another consultancy' },
    { k: 'REVOKE',   claimant: true,  consultant: false, at: 2.2, note: 'cancel access · any time · any party' },
    { k: 'DELETE',   claimant: true,  consultant: false, at: 2.5 },
  ];
  return (
    <div style={{
      position: 'absolute', left: 1080, top: 220,
      width: 760,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* Two-party header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        marginBottom: 18,
      }}>
        <PartyCard label="CLAIMANT" sublabel="OWNER · BENEFICIARY" icon="key" highlight />
        <PartyCard label="CONSULTANT" sublabel="DELEGATE · OPERATOR" icon="loupe" />
      </div>

      {/* The file in the middle */}
      <div style={{
        background: csInk2, border: `1px solid ${csAmber}`, borderRadius: 4,
        padding: '14px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Diamond size={8} color={csAmber} filled />
          <span style={{ fontFamily: fSerif, fontSize: 22, color: csBone, letterSpacing: '-0.01em' }}>
            Claim file
          </span>
          <span style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.16em' }}>
            OWNER · CLAIMANT_PTY_LTD
          </span>
        </div>
        <span style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.18em' }}>
          IMMUTABLE TITLE
        </span>
      </div>

      {/* Permission matrix */}
      <div style={{
        background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4,
        padding: '12px 20px',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '160px 1fr 80px 90px',
          padding: '10px 0', borderBottom: `1px solid ${csRuleStr}`,
          fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.18em',
        }}>
          <span>RIGHT</span><span>SCOPE</span><span style={{ textAlign: 'center' }}>CLAIMANT</span><span style={{ textAlign: 'center' }}>CONSULT.</span>
        </div>
        {rights.map((r, i) => {
          const lt = clamp((localTime - r.at) / 0.45, 0, 1);
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '160px 1fr 80px 90px',
              padding: '11px 0',
              borderBottom: i < rights.length - 1 ? `1px solid ${csRule}` : 'none',
              alignItems: 'center',
              opacity: lt, transform: `translateY(${(1-lt)*8}px)`,
            }}>
              <span style={{ fontFamily: fMono, fontSize: 12, color: csAmber, letterSpacing: '0.14em' }}>
                {r.k}
              </span>
              <span style={{ fontFamily: fSans, fontSize: 13, color: csBone3 }}>
                {r.note || '—'}
              </span>
              <span style={{ textAlign: 'center' }}>
                <PCheck on={r.claimant}/>
              </span>
              <span style={{ textAlign: 'center' }}>
                <PCheck on={r.consultant}/>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PartyCard({ label, sublabel, icon, highlight }) {
  const stroke = highlight ? csAmber : csBone3;
  return (
    <div style={{
      padding: '18px 22px',
      background: highlight ? 'rgba(225,162,58,0.06)' : csInk2,
      border: `1px solid ${highlight ? csAmber : csRuleStr}`,
      borderRadius: 4,
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={stroke} strokeWidth="1.6">
        {icon === 'key' && (
          <g>
            <circle cx="14" cy="20" r="7"/>
            <line x1="21" y1="20" x2="34" y2="20"/>
            <line x1="30" y1="20" x2="30" y2="26"/>
            <line x1="26" y1="20" x2="26" y2="28"/>
          </g>
        )}
        {icon === 'loupe' && (
          <g>
            <circle cx="17" cy="17" r="9"/>
            <line x1="24" y1="24" x2="33" y2="33"/>
          </g>
        )}
      </svg>
      <div>
        <div style={{ fontFamily: fMono, fontSize: 11, color: highlight ? csAmber : csBone2, letterSpacing: '0.22em' }}>
          {label}
        </div>
        <div style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.16em', marginTop: 4 }}>
          {sublabel}
        </div>
      </div>
    </div>
  );
}

function PCheck({ on }) {
  if (on) {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={csAmber} strokeWidth="2" style={{ display: 'inline-block' }}>
        <polyline points="3 9 7 13 15 4"/>
      </svg>
    );
  }
  return (
    <span style={{ display: 'inline-block', width: 14, height: 1, background: csBone4 }}/>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 6 — Exportable: sealed bundle handoff
// ─────────────────────────────────────────────────────────────────────────
function PScene6Export() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 04" stageLabel="EXPORTABLE"
        title={<>Exportable <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— forever portable.</em></>}
        lede="The consultant can package the entire claim — every artifact, every hash, every chain block — into a sealed, signed bundle. Verifiable offline. Independent of ArchiveOne."
        localTime={localTime} duration={duration}/>

      <PExportBundle localTime={localTime} />
    </div>
  );
}

function PExportBundle({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  // Files flying into a package
  const items = [
    { at: 0.8, label: 'evidence/*.bin',          n: '47 files'  },
    { at: 1.1, label: 'manifest.json',           n: 'SHA-256'   },
    { at: 1.4, label: 'chain/blocks_184–192.dat',n: 'sealed'    },
    { at: 1.7, label: 'claim_brief.pdf',         n: 'rendered'  },
    { at: 2.0, label: 'apportionment.xlsx',      n: 'line-item' },
    { at: 2.3, label: 'signatures.asc',          n: 'PGP+TSA'   },
  ];
  // bundle size grows
  const grown = items.filter(it => localTime >= it.at).length;
  const sizeMB = (grown * 52.4).toFixed(1);

  return (
    <div style={{
      position: 'absolute', left: 1080, top: 240,
      width: 760, opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* file stream */}
      <div style={{ marginBottom: 22 }}>
        {items.map((it, i) => {
          const lt = clamp((localTime - it.at) / 0.6, 0, 1);
          const fadeOut = clamp((localTime - it.at - 0.8) / 0.6, 0, 1);
          const opacity = lt * (1 - fadeOut * 0.6);
          return (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 14px',
              background: 'rgba(19,19,22,0.7)', borderLeft: `2px solid ${csAmber}`,
              marginBottom: 5,
              opacity, transform: `translateX(${(1-lt)*40}px)`,
              fontFamily: fMono, fontSize: 11.5, color: csBone, letterSpacing: '0.05em',
            }}>
              <span>{it.label}</span>
              <span style={{ color: csBone3, fontSize: 10.5, letterSpacing: '0.14em' }}>{it.n}</span>
            </div>
          );
        })}
      </div>

      {/* The bundle */}
      <div style={{
        background: csInk2, border: `2px solid ${csAmber}`, borderRadius: 4,
        padding: 32,
        position: 'relative',
        boxShadow: `0 0 ${20 + 10 * Math.sin(localTime*2)}px rgba(225,162,58,0.2)`,
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <div>
            <div style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>
              ARCHIVEONE EXPORT BUNDLE
            </div>
            <div style={{ fontFamily: fSerif, fontSize: 30, color: csBone, marginTop: 8 }}>
              vantage7_FY26.claim
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.14em' }}>SIZE</div>
            <div style={{ fontFamily: fMono, fontSize: 22, color: csBone, marginTop: 4 }}>
              {sizeMB} MB
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: csRule, margin: '20px 0' }}/>
        <div style={{
          fontFamily: fMono, fontSize: 13, color: csBone2,
          wordBreak: 'break-all', letterSpacing: '0.02em',
        }}>
          0x{settleHash('e9c4d2a7b15f08364d92', localTime - 1.0, 1.2)}
        </div>
        <div style={{
          marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14,
        }}>
          {[
            ['PORTABLE',   'opens without ArchiveOne'],
            ['VERIFIABLE', 'cryptographic chain inside'],
            ['PERMANENT',  'no expiry · no DRM'],
          ].map(([k, v]) => (
            <div key={k} style={{
              padding: '10px 14px', border: `1px solid ${csRuleStr}`, borderRadius: 3,
            }}>
              <div style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.16em' }}>{k}</div>
              <div style={{ fontFamily: fSans, fontSize: 12, color: csBone2, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 7 — Pricing: two-line model
// ─────────────────────────────────────────────────────────────────────────
function PScene7Pricing() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 05" stageLabel="PRICING"
        title={<>Honest pricing <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— only when you bill.</em></>}
        lede="30 days free. A founder discount for the first cohort to sign on. Then a single per-claim fee — only when you seal a claim. No annual minimum. No setup fee."
        localTime={localTime} duration={duration} maxWidth={820}/>

      <PPricingPhases localTime={localTime} />
    </div>
  );
}

function PPricingPhases({ localTime }) {
  const e = entry(localTime, 0.5, 0.7);
  const tw = getTweaks();
  const founderClm = Math.round(tw.perClaim * (1 - tw.founderPct/100));
  return (
    <div style={{
      position: 'absolute', left: 200, top: 560, right: 200,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      {/* Phase timeline header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        marginBottom: 26,
        fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.2em',
      }}>
        <span style={{ color: csAmber }}>DAY 0</span>
        <span style={{ flex: 1, height: 1, background: `linear-gradient(to right, ${csAmber}, ${csRuleStr})` }}/>
        <span>DAY 30</span>
        <span style={{ flex: 1, height: 1, background: csRuleStr }}/>
        <span>FIRST 20</span>
        <span style={{ flex: 1, height: 1, background: csRuleStr }}/>
        <span>EVERYONE ELSE</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr 40px 1.1fr', gap: 0, alignItems: 'stretch' }}>
        <PPhaseCard
          phase="PHASE 1"
          eyebrow="TRIAL · 30 DAYS"
          big="Free"
          unit="full platform · no obligation"
          notes={[
            'Evidence capture, chain & assembly',
            'Use the month to scope custom integrations',
            'No card. No commit.',
          ]}
          at={0.8} localTime={localTime}/>

        <PFlowArrow localTime={localTime} startAt={1.2}/>

        <PPhaseCard
          phase="PHASE 2"
          eyebrow={`FOUNDER COHORT · FIRST ${tw.founderSeats}`}
          big={`${fmtFull(founderClm)} /claim`}
          bigSize={40}
          unit={`${tw.founderPct}% off · for the founding year`}
          notes={[
            'Locked-in founder rate · for life',
            'White-label client app included',
            'Direct line to engineering',
          ]}
          accent
          at={1.4} localTime={localTime}/>

        <PFlowArrow localTime={localTime} startAt={1.8}/>

        <PPhaseCard
          phase="PHASE 3"
          eyebrow="SUBSCRIPTION · STANDARD"
          big={`${fmtFull(tw.perClaim)} /claim`}
          bigSize={44}
          unit="per sealed claim · only when you bill"
          notes={[
            'No annual minimum',
            'No setup or onboarding fee',
            'Pay only for sealed claims · settled in arrears',
          ]}
          at={2.0} localTime={localTime}/>
      </div>
    </div>
  );
}

function PPhaseCard({ phase, eyebrow, big, bigSize = 56, unit, notes, at, localTime, accent }) {
  const lt = clamp((localTime - at) / 0.6, 0, 1);
  return (
    <div style={{
      padding: 22,
      background: accent ? 'rgba(225,162,58,0.06)' : csInk2,
      border: `1px solid ${accent ? csAmber : csRuleStr}`,
      borderRadius: 4,
      opacity: lt, transform: `translateY(${(1-lt)*18}px)`,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 14,
      }}>
        <span style={{ fontFamily: fMono, fontSize: 10, color: csBone4, letterSpacing: '0.22em' }}>
          {phase}
        </span>
        <span style={{ fontFamily: fMono, fontSize: 10, color: accent ? csAmber : csBone3, letterSpacing: '0.16em' }}>
          {eyebrow}
        </span>
      </div>
      <div style={{
        fontFamily: fSerif, fontWeight: 300, fontSize: bigSize, lineHeight: 1,
        color: csBone, letterSpacing: '-0.025em', minHeight: 64,
      }}>
        {big}
      </div>
      <div style={{
        fontFamily: fSans, fontSize: 13, color: csBone3, marginTop: 8, marginBottom: 18,
        minHeight: 36,
      }}>
        {unit}
      </div>
      <div style={{ height: 1, background: csRule, marginBottom: 14 }}/>
      {notes.map((n, i) => {
        const strike = typeof n === 'object' && n.strike;
        const text = typeof n === 'object' ? n.text : n;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            fontFamily: fSans, fontSize: 13, color: strike ? csBone4 : csBone2, lineHeight: 1.45,
            marginBottom: 7,
            textDecoration: strike ? 'line-through' : 'none',
          }}>
            {strike ? (
              <span style={{ marginTop: 2, color: csBone4, fontFamily: fMono, fontSize: 12, flexShrink: 0, width: 7 }}>✕</span>
            ) : (
              <Diamond size={5} color={csAmber} filled style={{ marginTop: 7, flexShrink: 0 }}/>
            )}
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

function PFlowArrow({ localTime, startAt }) {
  const lt = clamp((localTime - startAt) / 0.5, 0, 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: lt,
    }}>
      <svg width="32" height="20" viewBox="0 0 32 20">
        <line x1="0" y1="10" x2="24" y2="10" stroke={csAmber} strokeWidth="1" strokeDasharray="3 3"
              strokeDashoffset={-localTime * 18}/>
        <polygon points="22,5 32,10 22,15" fill={csAmber}/>
      </svg>
    </div>
  );
}

function PPriceCard({ eyebrow, big, unit, notes, at, localTime, accent }) {
  const lt = clamp((localTime - at) / 0.6, 0, 1);
  return (
    <div style={{
      padding: 26,
      background: accent ? 'rgba(225,162,58,0.06)' : csInk2,
      border: `1px solid ${accent ? csAmber : csRuleStr}`,
      borderRadius: 4,
      opacity: lt, transform: `translateY(${(1-lt)*18}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: accent ? csAmber : csBone3,
        letterSpacing: '0.18em', marginBottom: 18,
      }}>
        {eyebrow}
      </div>
      <div style={{
        fontFamily: fSerif, fontWeight: 300, fontSize: 64, lineHeight: 1,
        color: csBone, letterSpacing: '-0.025em',
      }}>
        {big}
      </div>
      <div style={{
        fontFamily: fSans, fontSize: 14, color: csBone3, marginTop: 8, marginBottom: 22,
      }}>
        {unit}
      </div>
      <div style={{ height: 1, background: csRule, marginBottom: 18 }}/>
      {notes.map((n, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          fontFamily: fSans, fontSize: 13.5, color: csBone2, lineHeight: 1.45,
          marginBottom: 8,
        }}>
          <Diamond size={5} color={csAmber} filled style={{ marginTop: 7, flexShrink: 0 }}/>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

function PVersusBadge({ localTime, startAt }) {
  const lt = clamp((localTime - startAt) / 0.6, 0, 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: lt,
    }}>
      <div style={{
        width: 56, height: 56,
        border: `1px solid ${csAmber}`, transform: 'rotate(45deg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(225,162,58,0.05)',
      }}>
        <span style={{
          fontFamily: fMono, fontSize: 14, color: csAmber, letterSpacing: '0.18em',
          transform: 'rotate(-45deg)',
        }}>MAX</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 8 — Client App: secondary product to sell down
// ─────────────────────────────────────────────────────────────────────────
function PScene8ClientApp() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 06" stageLabel="CLIENT APP"
        title={<>Client app <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— a second line of revenue.</em></>}
        lede="Optional. White-labelled. Sold by the consultancy directly to its claimant clients. Researchers capture in the moment; the consultancy keeps the margin."
        localTime={localTime} duration={duration}/>

      <PClientAppPhone localTime={localTime} />
      <PClientAppValueProps localTime={localTime} />
    </div>
  );
}

function PClientAppPhone({ localTime }) {
  const e = entry(localTime, 0.6, 0.7);
  const float = Math.sin(localTime * 0.9) * 6;
  return (
    <div style={{
      position: 'absolute', left: 1280, top: 200,
      transform: `translateY(${float - e.ty}px)`,
      opacity: e.opacity,
    }}>
      <div style={{
        width: 380, height: 600,
        background: csInk2, border: `1px solid ${csRuleStr}`,
        borderRadius: 48, padding: 16,
        position: 'relative',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.04)',
      }}>
        <div style={{
          position: 'absolute', top: 22, left: '50%', transform: 'translateX(-50%)',
          width: 96, height: 22, background: '#000', borderRadius: 12,
        }}/>
        <div style={{
          width: '100%', height: '100%',
          background: csInk, borderRadius: 36, overflow: 'hidden',
          position: 'relative', padding: '52px 22px 22px',
        }}>
          <div style={{
            position: 'absolute', top: 16, left: 24, right: 24,
            display: 'flex', justifyContent: 'space-between',
            fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.08em',
          }}>
            <span style={{ color: csBone }}>9:41</span>
            <span>● ● ●</span>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: fMono, fontSize: 9, color: csBone3, letterSpacing: '0.2em' }}>
              POWERED BY ARCHIVEONE
            </div>
            <div style={{
              fontFamily: fSerif, fontSize: 26, color: csBone, fontWeight: 500, marginTop: 4,
              letterSpacing: '-0.01em',
            }}>
              [Your Consultancy]
            </div>
            <div style={{
              fontFamily: fSans, fontSize: 12, color: csBone3, marginTop: 4,
            }}>
              R&amp;D capture · today
            </div>
          </div>

          {/* Today's tile */}
          <div style={{
            background: 'rgba(225,162,58,0.06)', border: `1px solid ${csAmber}`,
            borderRadius: 10, padding: 14, marginBottom: 12,
          }}>
            <div style={{ fontFamily: fMono, fontSize: 9, color: csAmber, letterSpacing: '0.18em' }}>
              ACTIVE PROJECT
            </div>
            <div style={{ fontFamily: fSerif, fontSize: 20, color: csBone, marginTop: 6 }}>
              Vantage-7 alloy
            </div>
            <div style={{ fontFamily: fMono, fontSize: 10, color: csBone3, marginTop: 6, letterSpacing: '0.12em' }}>
              12 ARTIFACTS · TODAY
            </div>
          </div>

          {/* Capture tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['PHOTO',  'whiteboard'],
              ['VOICE',  'standup 0:34'],
              ['SCAN',   'lab page 47'],
              ['CALC',   'n7 quench'],
            ].map(([k, v], i) => {
              const lt = clamp((localTime - 1.0 - i*0.18) / 0.4, 0, 1);
              return (
                <div key={i} style={{
                  background: csInk2, border: `1px solid ${csRuleStr}`,
                  borderRadius: 8, padding: '8px 10px',
                  opacity: lt, transform: `translateY(${(1-lt)*8}px)`,
                }}>
                  <div style={{ fontFamily: fMono, fontSize: 8, color: csAmber, letterSpacing: '0.16em' }}>{k}</div>
                  <div style={{ fontFamily: fSans, fontSize: 11, color: csBone, marginTop: 4 }}>{v}</div>
                </div>
              );
            })}
          </div>

          {/* Capture button */}
          <div style={{
            position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
            width: 72, height: 72, borderRadius: '50%',
            border: `2px solid ${csBone2}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: csAmber,
              boxShadow: `0 0 ${16 + 10 * Math.sin(localTime * 4)}px rgba(225,162,58,0.5)`,
            }}/>
          </div>
        </div>
      </div>

      {/* Brand ribbon (no price) */}
      <div style={{
        position: 'absolute', right: -90, top: 80,
        padding: '10px 18px',
        border: `2px solid ${csAmber}`, background: csInk,
        transform: 'rotate(8deg)',
      }}>
        <div style={{ fontFamily: fMono, fontSize: 10, color: csAmber, letterSpacing: '0.2em' }}>SOLD BY CONSULTANCY</div>
        <div style={{ fontFamily: fSerif, fontSize: 22, color: csBone, lineHeight: 1, marginTop: 4 }}>White-labelled</div>
      </div>
    </div>
  );
}

function PClientAppValueProps({ localTime }) {
  const e = entry(localTime, 1.4, 0.7);
  const props = [
    { at: 1.7, k: 'CONTEMPORANEOUS',  v: 'Researchers capture in the moment — at the bench, the whiteboard, the test rig.' },
    { at: 1.95, k: 'WHITE-LABELLED',  v: 'Your consultancy’s brand on the cover. Your relationship in the foreground.' },
    { at: 2.2,  k: 'STICKY BY DESIGN',v: 'Daily usage by the claimant’s team. Departure cost rises with every capture.' },
    { at: 2.45, k: 'MARGIN OPTIONAL', v: 'Bundle it with your engagement, or resell it standalone — the economics are yours to set.' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 200, top: 700, width: 900,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em', marginBottom: 14,
      }}>
        WHY IT WORKS FOR THE CONSULTANCY
      </div>
      <div style={{ background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4 }}>
        {props.map((p, i) => {
          const lt = clamp((localTime - p.at) / 0.55, 0, 1);
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '210px 1fr',
              padding: '14px 22px',
              borderBottom: i < props.length - 1 ? `1px solid ${csRule}` : 'none',
              opacity: lt, transform: `translateX(${(1-lt)*-20}px)`,
              alignItems: 'baseline', gap: 18,
            }}>
              <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em' }}>
                {p.k}
              </span>
              <span style={{ fontFamily: fSerif, fontSize: 19, color: csBone, lineHeight: 1.35, letterSpacing: '-0.005em' }}>
                {p.v}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PClientAppLedger_DEPRECATED({ localTime }) {
  const e = entry(localTime, 1.4, 0.7);
  // Quick ROI math for a 10-user deployment
  const rows = [
    ['10 USERS',  '× $250/mo',  '= $2,500/mo'],
    ['12 MONTHS', '× $2,500',   '= $30,000/yr per client'],
    ['8 CLIENTS', '× $30,000',  '= $240,000/yr secondary line'],
  ];
  return (
    <div style={{
      position: 'absolute', left: 200, top: 700, width: 900,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em', marginBottom: 14,
      }}>
        CONSULTANCY MARGIN — WORKED EXAMPLE
      </div>
      <div style={{ background: csInk2, border: `1px solid ${csRuleStr}`, borderRadius: 4 }}>
        {rows.map((r, i) => {
          const lt = clamp((localTime - 1.7 - i*0.25) / 0.5, 0, 1);
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '180px 1fr 1fr',
              padding: '14px 22px',
              borderBottom: i < rows.length - 1 ? `1px solid ${csRule}` : 'none',
              opacity: lt, transform: `translateX(${(1-lt)*-20}px)`,
              fontFamily: fMono, fontSize: 16, letterSpacing: '0.06em',
            }}>
              <span style={{ color: csBone3 }}>{r[0]}</span>
              <span style={{ color: csBone2 }}>{r[1]}</span>
              <span style={{ color: i === rows.length - 1 ? csAmber : csBone, textAlign: 'right' }}>{r[2]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 9 — Economics: vs consultant time, vs liability insurance
// ─────────────────────────────────────────────────────────────────────────
function PScene9Economics() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="STAGE 07" stageLabel="ECONOMICS"
        title={<>Run the numbers <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— against the alternatives.</em></>}
        lede="Specialist consultant time. Liability insurance premiums. Disallowed claims. ArchiveOne compresses all three — and is the only product on the market that meaningfully reduces a consultancy's professional indemnity exposure."
        localTime={localTime} duration={duration}/>

      <PEconChart localTime={localTime} />
    </div>
  );
}

function PEconChart({ localTime }) {
  const e = entry(localTime, 0.6, 0.7);
  // Three rows comparing annual cost lines
  const rows = [
    {
      at: 1.0, k: 'SPECIALIST TIME',
      sub: '$850/hr × 280 hrs/yr of evidence chasing per consultant',
      val: 238000, unit: '$238,000', dir: 'returned',
    },
    {
      at: 1.5, k: 'LIABILITY INSURANCE',
      sub: 'PI premiums up 28% YoY · one-strike era · no other product reduces this',
      val: 145000, unit: '+$145,000 / yr', dir: 'rising · only hedge',
    },
    {
      at: 2.0, k: 'DISALLOWED CLAIMS',
      sub: 'One missing record · entire claim disallowed · client loss + clawback',
      val: 425000, unit: '$425,000', dir: 'avoided',
    },
    {
      at: 2.5, k: 'ARCHIVEONE',
      sub: 'Per claim only — only when you bill. No annual minimum. No setup fee.',
      val: 18000, unit: `${fmtFull(getTweaks().perClaim)} × claim`, dir: 'pay as you bill', isCs: true,
    },
  ];
  const maxVal = 500000;
  return (
    <div style={{
      position: 'absolute', left: 200, top: 580, right: 200,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '230px 1fr 200px 180px',
        gap: 22, padding: '0 0 12px',
        borderBottom: `1px solid ${csRuleStr}`,
        fontFamily: fMono, fontSize: 10.5, color: csBone3, letterSpacing: '0.18em',
      }}>
        <span>LINE ITEM</span><span>WHAT IT IS</span><span style={{ textAlign: 'right' }}>ANNUAL</span><span>EFFECT</span>
      </div>
      {rows.map((r, i) => {
        const lt = clamp((localTime - r.at) / 0.6, 0, 1);
        const barT = clamp((localTime - r.at - 0.2) / 0.7, 0, 1);
        const w = (r.val / maxVal) * 100;
        const color = r.isCs ? csAmber : (r.dir.includes('rising') ? '#c46a48' : csSage);
        return (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '230px 1fr 200px 180px',
            gap: 22, padding: '18px 0',
            borderBottom: i < rows.length - 1 ? `1px solid ${csRule}` : 'none',
            alignItems: 'center',
            opacity: lt, transform: `translateY(${(1-lt)*10}px)`,
            background: r.isCs ? 'rgba(225,162,58,0.05)' : 'transparent',
          }}>
            <div>
              <div style={{ fontFamily: fMono, fontSize: 12, color: r.isCs ? csAmber : csBone, letterSpacing: '0.18em' }}>
                {r.k}
              </div>
            </div>
            <div>
              <div style={{ fontFamily: fSans, fontSize: 14, color: csBone2, marginBottom: 8, lineHeight: 1.45 }}>
                {r.sub}
              </div>
              <div style={{
                height: 4, background: csRule, borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${w * barT}%`, height: '100%',
                  background: color, transition: 'width 200ms',
                }}/>
              </div>
            </div>
            <div style={{
              fontFamily: fSerif, fontSize: 34, color: r.isCs ? csAmber : csBone, fontWeight: 300,
              textAlign: 'right', letterSpacing: '-0.02em',
            }}>
              {r.unit}
            </div>
            <div style={{
              fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.16em', textTransform: 'uppercase',
            }}>
              {r.dir}
            </div>
          </div>
        );
      })}

      <div style={{
        marginTop: 24, paddingTop: 18, borderTop: `1px solid ${csRuleStr}`,
      }}>
        <div style={{
          textAlign: 'center', marginBottom: 14,
          fontFamily: fMono, fontSize: 12, color: csAmber, letterSpacing: '0.18em',
        }}>
          <span style={{ marginRight: 10 }}>◆</span>
          STRESS-TESTED · 100% CATCH AT $511M · 22.4% CONTAMINATION · 99.84% R&amp;D RECALL
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontFamily: fMono, fontSize: 11.5, color: csBone3, letterSpacing: '0.14em',
        }}>
          <span><span style={{ color: csAmber }}>◆</span> PI PREMIUMS WILL KEEP RISING</span>
          <span><span style={{ color: csAmber }}>◆</span> THE ONLY MEANINGFUL REDUCTION</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 10 — Founder offer: 50% off, first 20 consultancies
// ─────────────────────────────────────────────────────────────────────────
function PScene10Offer() {
  const { localTime, duration } = useSprite();
  const e = entry(localTime, 0.2, 0.8);
  const tw = getTweaks();
  const founderClm  = Math.round(tw.perClaim  * (1 - tw.founderPct/100));

  // Seats lit up: animate up to ~40% taken
  const targetTaken = Math.max(1, Math.round(tw.founderSeats * 0.4));
  const taken = Math.min(tw.founderSeats, Math.floor(plerp(0, targetTaken, Easing.easeOutCubic(clamp(localTime / 1.6, 0, 1)))));

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* eyebrow */}
      <div style={{
        position: 'absolute', left: 200, top: 270,
        display: 'flex', alignItems: 'center', gap: 18,
        ...ee(localTime, duration, { start: 0.2 }),
      }}>
        <div style={{ width: 64, height: 1, background: csAmber, opacity: 0.7 }}/>
        <span style={{
          fontFamily: fMono, fontSize: 14, letterSpacing: '0.22em', color: csBone3,
        }}>FOUNDER COHORT · LIMITED RELEASE</span>
      </div>

      {/* Headline */}
      <div style={{
        position: 'absolute', left: 200, top: 320, right: 1080,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 140, lineHeight: 0.94, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 0.5, entryDur: 0.8 }),
      }}>
        <span style={{ color: csAmber, fontStyle: 'italic', fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>{tw.founderPct}%</span>
        &nbsp;off.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 480, right: 1080,
        fontFamily: fSerif, fontWeight: 300, color: csBone2,
        fontSize: 60, lineHeight: 1, letterSpacing: '-0.025em',
        ...ee(localTime, duration, { start: 1.2, entryDur: 0.7 }),
      }}>
        First 12 months.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 580, right: 1080,
        fontFamily: fSans, fontSize: 20, color: csBone3, lineHeight: 1.55,
        ...ee(localTime, duration, { start: 1.8, entryDur: 0.6 }),
      }}>
        Reserved for the first&nbsp;
        <span style={{ color: csAmber, fontWeight: 500 }}>{tw.founderSeats} consultancies</span>
        &nbsp;to sign on. Per-claim fee drops to {fmtFull(founderClm)} for the founding year — and stays locked at the founder rate for life. No annual minimum. No setup fee.
      </div>

      <div style={{
        position: 'absolute', left: 200, bottom: 160,
        display: 'flex', alignItems: 'center', gap: 16,
        fontFamily: fMono, fontSize: 13, color: csBone3, letterSpacing: '0.18em',
        ...ee(localTime, duration, { start: 2.6, entryDur: 0.5 }),
      }}>
        <Diamond size={8} color={csAmber} filled />
        FOUNDER STATUS · LOCKED-IN RATE FOR LIFE · DIRECT LINE TO ENGINEERING
      </div>

      {/* Right: slot board */}
      <PSlotBoard localTime={localTime} taken={taken} seats={tw.founderSeats} founderClm={founderClm} fullClm={tw.perClaim}/>
    </div>
  );
}

function PSlotBoard({ localTime, taken, seats = 20, founderClm = 750, fullClm = 1500 }) {
  const e = entry(localTime, 0.4, 0.7);
  return (
    <div style={{
      position: 'absolute', right: 200, top: 240,
      width: 720, padding: 30,
      background: csInk2, border: `1px solid ${csAmber}`, borderRadius: 4,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
      boxShadow: '0 30px 80px rgba(225,162,58,0.08)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 22,
      }}>
        <span style={{ fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.2em' }}>
          FOUNDER SEATS
        </span>
        <span style={{ fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.16em' }}>
          {taken} CLAIMED · {seats - taken} OPEN
        </span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${Math.min(seats, 5)}, 1fr)`, gap: 12,
      }}>
        {Array.from({ length: seats }).map((_, i) => {
          const isTaken = i < taken;
          const justTaken = i === taken - 1 && (localTime % 2 < 1);
          return (
            <div key={i} style={{
              height: 56,
              border: `1px solid ${isTaken ? csAmber : csRuleStr}`,
              background: isTaken ? 'rgba(225,162,58,0.18)' : csInk,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: fMono, fontSize: 13,
              color: isTaken ? csAmber : csBone4,
              letterSpacing: '0.08em',
              transition: 'all 200ms',
              boxShadow: justTaken ? `0 0 18px rgba(225,162,58,0.6)` : 'none',
            }}>
              {String(i + 1).padStart(2, '0')}
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 24, paddingTop: 18, borderTop: `1px solid ${csRule}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <div>
          <div style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.18em' }}>FOUNDER · PER CLAIM</div>
          <div style={{ fontFamily: fSerif, fontSize: 38, color: csBone, marginTop: 6, letterSpacing: '-0.025em' }}>
            {fmtFull(founderClm)}<span style={{ fontFamily: fMono, fontSize: 13, color: csBone3 }}> /claim</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: fMono, fontSize: 10, color: csBone3, letterSpacing: '0.18em' }}>STANDARD · LATER</div>
          <div style={{ fontFamily: fSerif, fontSize: 38, color: csBone4, marginTop: 6, letterSpacing: '-0.025em', textDecoration: 'line-through' }}>
            {fmtFull(fullClm)}<span style={{ fontFamily: fMono, fontSize: 13, color: csBone4 }}> /claim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 11 — Foundation access: claim financing, first
// ─────────────────────────────────────────────────────────────────────────
function PScene11Foundation() {
  const { localTime, duration } = useSprite();
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <PSceneHeader stage="PHASE 2" stageLabel="FOUNDATION ACCESS"
        title={<>Next <em style={{color: csBone2, fontStyle:'italic', fontWeight:300}}>— financing.</em></>}
        lede="The same foundation consultancies get first access to ArchiveOne&rsquo;s streamlined claim financing rail. Loan origination revenue. Deeper client retention. Your per-claim fees become a rounding error."
        localTime={localTime} duration={duration} maxWidth={880}/>

      <PFoundationFlywheel localTime={localTime} />
      <PFoundationPayoff localTime={localTime} />
    </div>
  );
}

function PFoundationFlywheel({ localTime }) {
  const e = entry(localTime, 0.6, 0.7);
  const steps = [
    { at: 1.0, n: '01', k: 'SEAL',         t: 'Claim sealed in ArchiveOne',                d: 'evidence + chain + brief, ready' },
    { at: 1.4, n: '02', k: 'FINANCE',      t: 'Financing offered against rebate',         d: 'one-click, pre-priced, instant' },
    { at: 1.8, n: '03', k: 'ORIGINATE',    t: 'Consultancy earns origination margin',     d: 'a new line of revenue, every claim' },
    { at: 2.2, n: '04', k: 'RETAIN',       t: 'Client locked into the platform',          d: 'too integrated, too simple to leave' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 1080, top: 230,
      width: 760,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em', marginBottom: 18,
      }}>
        THE FOUNDATION FLYWHEEL
      </div>
      {steps.map((s, i) => {
        const lt = clamp((localTime - s.at) / 0.6, 0, 1);
        const last = i === steps.length - 1;
        return (
          <React.Fragment key={i}>
            <div style={{
              display: 'grid', gridTemplateColumns: '60px 1fr 1fr', gap: 18,
              padding: '16px 20px',
              background: csInk2, border: `1px solid ${last ? csAmber : csRuleStr}`,
              borderRadius: 4,
              opacity: lt, transform: `translateX(${(1-lt)*-24}px)`,
              alignItems: 'center',
            }}>
              <div style={{
                fontFamily: fSerif, fontWeight: 300, fontSize: 36, color: csAmber, lineHeight: 1, letterSpacing: '-0.02em',
              }}>
                {s.n}
              </div>
              <div>
                <div style={{ fontFamily: fMono, fontSize: 10, color: csBone4, letterSpacing: '0.18em' }}>
                  {s.k}
                </div>
                <div style={{ fontFamily: fSerif, fontSize: 22, color: csBone, marginTop: 4, letterSpacing: '-0.01em' }}>
                  {s.t}
                </div>
              </div>
              <div style={{
                fontFamily: fSans, fontSize: 13, color: csBone3, lineHeight: 1.45, textAlign: 'right',
                fontStyle: 'italic',
              }}>
                {s.d}
              </div>
            </div>
            {!last && (
              <div style={{
                display: 'flex', justifyContent: 'center', padding: '4px 0',
                opacity: clamp((localTime - s.at - 0.2) / 0.4, 0, 1),
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <line x1="7" y1="0" x2="7" y2="10" stroke={csAmber} strokeWidth="1"/>
                  <polygon points="2,8 12,8 7,14" fill={csAmber}/>
                </svg>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PFoundationPayoff({ localTime }) {
  const e = entry(localTime, 2.6, 0.7);
  // Count up "4 claims"
  const countT = clamp((localTime - 2.8) / 1.0, 0, 1);
  const n = Math.round(plerp(0, 4, Easing.easeOutCubic(countT)));
  return (
    <div style={{
      position: 'absolute', left: 200, top: 700, width: 820,
      opacity: e.opacity, transform: `translateY(${e.ty}px)`,
    }}>
      <div style={{
        fontFamily: fMono, fontSize: 11, color: csAmber, letterSpacing: '0.18em', marginBottom: 18,
      }}>
        THE MATH OF NOT WORRYING ABOUT IT
      </div>
      <div style={{
        background: csInk2, border: `1px solid ${csAmber}`, borderRadius: 4,
        padding: '28px 32px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 24,
          fontFamily: fSerif, fontWeight: 300, color: csBone, lineHeight: 1,
          letterSpacing: '-0.025em', marginBottom: 14,
        }}>
          <span style={{ fontSize: 120, color: csAmber, fontStyle: 'italic', fontVariationSettings: '"opsz" 144, "SOFT" 100' }}>
            {n}
          </span>
          <span style={{ fontSize: 28, color: csBone2 }}>
            financed claims a year
          </span>
        </div>
        <div style={{
          fontFamily: fSans, fontSize: 17, color: csBone2, lineHeight: 1.5,
        }}>
          covers a year of per-claim fees in origination margin alone.
          Everything beyond is pure upside &mdash; before you count retention,
          before you count the client app.
        </div>
        <div style={{
          marginTop: 18, paddingTop: 16, borderTop: `1px solid ${csRule}`,
          display: 'flex', justifyContent: 'space-between',
          fontFamily: fMono, fontSize: 11, color: csBone3, letterSpacing: '0.16em',
        }}>
          <span><span style={{ color: csAmber }}>◆</span> LOAN ORIGINATION REVENUE</span>
          <span><span style={{ color: csAmber }}>◆</span> CLIENT RETENTION UPLIFT</span>
          <span><span style={{ color: csAmber }}>◆</span> FOUNDATION COHORT FIRST</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SCENE 12 — End card
// ─────────────────────────────────────────────────────────────────────────
function PScene11End() {
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
          A PRODUCT OF OMNISCIENT AI PTY LTD · MORNINGTON PENINSULA
        </span>
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 380,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        ...ee(localTime, duration, { start: 0.6, entryDur: 0.9 }),
      }}>
        Be one of the first.
      </div>

      <div style={{
        position: 'absolute', left: 200, top: 580,
        fontFamily: fSerif, fontWeight: 300, color: csBone,
        fontSize: 168, lineHeight: 0.92, letterSpacing: '-0.035em',
        maxWidth: 1500,
        ...ee(localTime, duration, { start: 1.6, entryDur: 0.9 }),
      }}>
        Be on the&nbsp;
        <span style={{
          fontStyle: 'italic', color: csAmber,
          fontVariationSettings: '"opsz" 144, "SOFT" 100',
        }}>
          right side
        </span>
        &nbsp;of the chain.
      </div>

      <div style={{
        position: 'absolute', left: 200, right: 200, bottom: 140,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        borderTop: `1px solid ${csRuleStr}`, paddingTop: 28,
        fontFamily: fMono, fontSize: 13, color: csBone3, letterSpacing: '0.14em',
        ...ee(localTime, duration, { start: 2.6, entryDur: 0.6 }),
      }}>
        <div>
          <div style={{ color: csBone, marginBottom: 6 }}>ARCHIVEONE · FOUNDERS COHORT</div>
          <div>founders@archiveone.ai · +61 3 0000 0000</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: csBone, marginBottom: 6 }}>STAMPED</div>
          <div>2026.05.21 · 14:23 AEST · BLOCK #00184_2B</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────
Object.assign(window, {
  PScene1ColdOpen, PScene2Title, PScene3Sovereign, PScene4Encrypted,
  PScene5Owned, PScene6Export, PScene7Pricing, PScene8ClientApp,
  PScene9Economics, PScene10Offer, PScene11Foundation, PScene11End,
});
