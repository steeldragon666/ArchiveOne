// chrome.jsx — persistent broadcast chrome that overlays every scene.
// Top-left brand stamp, top-right rolling timestamp, bottom scene marker,
// bottom-right chain block. Subtly different per scene.

const csInk      = '#0b0b0d';
const csInk2     = '#131316';
const csInk3     = '#1c1c20';
const csBone     = '#f0ebe2';
const csBone2    = '#cdc7bd';
const csBone3    = '#8a857c';
const csBone4    = '#5d594f';
const csAmber    = '#e1a23a';
const csAmberSft = '#b88a3d';
const csSage     = '#7a9685';
const csRule     = 'rgba(240,235,226,.10)';
const csRuleStr  = 'rgba(240,235,226,.22)';

const fSerif = '"Fraunces", "Times New Roman", serif';
const fSans  = '"Geist", ui-sans-serif, system-ui, sans-serif';
const fMono  = '"JetBrains Mono", ui-monospace, monospace';

// ── Background: subtle vignetted grid + scanline noise ─────────────────────
function CSBackdrop() {
  const time = useTime();
  // grid breathes very subtly
  const opacity = 0.42 + 0.06 * Math.sin(time * 0.6);
  return (
    <div style={{ position: 'absolute', inset: 0, background: csInk, overflow: 'hidden' }}>
      {/* grid */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage:
          'linear-gradient(to right, rgba(240,235,226,.045) 1px, transparent 1px),' +
          'linear-gradient(to bottom, rgba(240,235,226,.045) 1px, transparent 1px)',
        backgroundSize: '96px 96px',
        WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 50%, #000 30%, transparent 95%)',
        maskImage:       'radial-gradient(ellipse 90% 70% at 50% 50%, #000 30%, transparent 95%)',
        opacity,
      }}/>
      {/* faint amber wash */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 50% 35% at 50% 100%, rgba(225,162,58,0.07), transparent 70%)',
      }}/>
    </div>
  );
}

// ── Brand mark, top-left ───────────────────────────────────────────────────
function CSBrand({ x = 64, y = 56 }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      display: 'flex', alignItems: 'center', gap: 14,
      color: csBone, fontFamily: fSerif, fontWeight: 600,
      fontSize: 28, letterSpacing: '-0.01em',
    }}>
      <span style={{
        width: 12, height: 12, background: csAmber, transform: 'rotate(45deg)',
        boxShadow: '0 0 18px rgba(225,162,58,0.55)',
      }}/>
      <span>ArchiveOne</span>
    </div>
  );
}

// ── Rolling timestamp pill, top-right ──────────────────────────────────────
function CSTimestamp({ x, y = 60 }) {
  const t = useTime();
  // simulated wall clock starting 14:23:07
  const baseSec = 14 * 3600 + 23 * 60 + 7;
  const totalSec = Math.floor(baseSec + t);
  const hh = String(Math.floor(totalSec / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(totalSec / 60) % 60).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const cs = String(Math.floor((t * 100) % 100)).padStart(2, '0');
  return (
    <div style={{
      position: 'absolute', right: x ?? 64, top: y,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px',
      border: `1px solid ${csRuleStr}`,
      borderRadius: 999,
      color: csBone2, fontFamily: fMono, fontSize: 12, letterSpacing: '0.08em',
      background: 'rgba(11,11,13,0.55)', backdropFilter: 'blur(8px)',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: csAmber,
        boxShadow: `0 0 0 ${4 + 2 * Math.sin(t * 4)}px rgba(225,162,58,0.12)`,
      }}/>
      <span>LIVE · {hh}:{mm}:{ss}.{cs} AEST</span>
      <span style={{ color: csBone4 }}>·</span>
      <span style={{ color: csBone3 }}>2026.05.21</span>
    </div>
  );
}

// ── Bottom scene marker ────────────────────────────────────────────────────
function CSSceneMarker({ stage, title, x = 64, y = 1000 }) {
  return (
    <div style={{
      position: 'absolute', left: x, bottom: 56,
      display: 'flex', alignItems: 'center', gap: 18,
      color: csBone3, fontFamily: fMono, fontSize: 12, letterSpacing: '0.18em',
    }}>
      <span style={{
        width: 10, height: 10, border: `1px solid ${csAmber}`, transform: 'rotate(45deg)',
      }}/>
      <span style={{ color: csAmber }}>{stage}</span>
      <span style={{ width: 36, height: 1, background: csRuleStr }}/>
      <span>{title}</span>
    </div>
  );
}

// ── Bottom-right chain readout ─────────────────────────────────────────────
function CSChainReadout({ block = '#00184_2A', hash = '0x7f3a…c4e1' }) {
  const t = useTime();
  const blink = Math.floor(t * 2) % 2 === 0;
  return (
    <div style={{
      position: 'absolute', right: 64, bottom: 56,
      display: 'flex', alignItems: 'center', gap: 24,
      color: csBone3, fontFamily: fMono, fontSize: 11.5, letterSpacing: '0.1em',
      textAlign: 'right',
    }}>
      <div>
        <div style={{ color: csBone4, marginBottom: 4 }}>CHAIN BLOCK</div>
        <div style={{ color: csBone, letterSpacing: '0.06em' }}>{block}</div>
      </div>
      <div style={{ width: 1, height: 28, background: csRuleStr }}/>
      <div>
        <div style={{ color: csBone4, marginBottom: 4 }}>EVIDENCE HASH</div>
        <div style={{ color: csBone2, letterSpacing: '0.04em' }}>
          {hash} <span style={{ color: csAmber, opacity: blink ? 1 : 0.2 }}>▍</span>
        </div>
      </div>
    </div>
  );
}

// ── Standard "corner crosshair" registration marks ─────────────────────────
function CSRegistrationMarks() {
  const m = 40;
  const len = 18;
  const Mark = ({ x, y, dx, dy }) => (
    <g stroke={csBone3} strokeWidth="1" opacity="0.45" fill="none">
      <line x1={x} y1={y} x2={x + dx * len} y2={y} />
      <line x1={x} y1={y} x2={x} y2={y + dy * len} />
    </g>
  );
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="1920" height="1080">
      <Mark x={m} y={m} dx={1} dy={1} />
      <Mark x={1920 - m} y={m} dx={-1} dy={1} />
      <Mark x={m} y={1080 - m} dx={1} dy={-1} />
      <Mark x={1920 - m} y={1080 - m} dx={-1} dy={-1} />
    </svg>
  );
}

// ── Full chrome wrapper used inside Stage ──────────────────────────────────
function CSChrome({ stage, title, block, hash, showChrome = true, showBrand = true, showStamp = true, showScene = true }) {
  if (!showChrome) return null;
  return (
    <React.Fragment>
      <CSRegistrationMarks />
      {showBrand && <CSBrand />}
      {showStamp && <CSTimestamp />}
      {showScene && stage && <CSSceneMarker stage={stage} title={title} />}
      <CSChainReadout block={block} hash={hash} />
    </React.Fragment>
  );
}

// ── Animated diamond bullet ────────────────────────────────────────────────
function Diamond({ size = 10, color = csAmber, filled = false, style = {} }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      background: filled ? color : 'transparent',
      border: `1px solid ${color}`,
      transform: 'rotate(45deg)',
      ...style,
    }}/>
  );
}

// ── Simple horizontal rule with amber tick ─────────────────────────────────
function CSRule({ width = 64, label, color = csAmber }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width, height: 1, background: color, opacity: 0.7 }}/>
      {label && <span style={{
        fontFamily: fMono, fontSize: 11, letterSpacing: '0.18em',
        color: csBone3, textTransform: 'uppercase',
      }}>{label}</span>}
    </div>
  );
}

Object.assign(window, {
  csInk, csInk2, csInk3, csBone, csBone2, csBone3, csBone4,
  csAmber, csAmberSft, csSage, csRule, csRuleStr,
  fSerif, fSans, fMono,
  CSBackdrop, CSBrand, CSTimestamp, CSSceneMarker, CSChainReadout,
  CSRegistrationMarks, CSChrome, Diamond, CSRule,
});
