// platform-app.jsx — ArchiveOne platform/economics composition

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "perClaim": 1500,
  "founderPct": 50,
  "founderSeats": 20
}/*EDITMODE-END*/;

function PSCENES_FOR(tw) {
  const founderClm = Math.round(tw.perClaim * (1 - tw.founderPct/100));
  return [
    { start:  0.0, end:  7.5,  stage: 'COLD OPEN',  stageLabel: 'YOUR FILE · YOUR KEYS',  render: <PScene1ColdOpen/>,    showScene: false, showBrand: true,  block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start:  7.5, end: 13.0,  stage: 'TITLE',      stageLabel: 'THE PLATFORM',           render: <PScene2Title/>,       showScene: false, showBrand: false, block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 13.0, end: 22.0,  stage: 'STAGE 01',   stageLabel: 'SOVEREIGN',              render: <PScene3Sovereign/>,                                     block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 22.0, end: 31.0,  stage: 'STAGE 02',   stageLabel: 'ENCRYPTED',              render: <PScene4Encrypted/>,                                     block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 31.0, end: 40.0,  stage: 'STAGE 03',   stageLabel: 'OWNED',                  render: <PScene5Owned/>,                                         block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 40.0, end: 47.0,  stage: 'STAGE 04',   stageLabel: 'EXPORTABLE',             render: <PScene6Export/>,                                        block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 47.0, end: 60.0,  stage: 'STAGE 05',   stageLabel: 'PRICING · TRIAL · PER-CLAIM', render: <PScene7Pricing/>,                                    block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 60.0, end: 69.0,  stage: 'STAGE 06',   stageLabel: 'CLIENT APP',             render: <PScene8ClientApp/>,                                     block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 69.0, end: 80.0,  stage: 'STAGE 07',   stageLabel: 'ECONOMICS',              render: <PScene9Economics/>,                                     block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 80.0, end: 89.0,  stage: 'OFFER',      stageLabel: `FOUNDER COHORT · ${tw.founderPct}% OFF · ${tw.founderSeats} SEATS`, render: <PScene10Offer/>, block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 89.0, end: 99.0,  stage: 'PHASE 2',    stageLabel: 'FOUNDATION ACCESS · CLAIM FINANCING', render: <PScene11Foundation/>,                       block: '#00184_2B', hash: '0xe9c4…d2a7' },
    { start: 99.0, end:106.0,  stage: 'END CARD',   stageLabel: 'OMNISCIENT AI',          render: <PScene11End/>,        showScene: false,                  block: '#00184_2B', hash: '0xe9c4…d2a7' },
  ];
}

const PSCENES = PSCENES_FOR(TWEAK_DEFAULTS);

function PScreenLabelUpdater({ scenes }) {
  const t = useTime();
  React.useEffect(() => {
    const root = document.getElementById('video-root');
    if (root) {
      const sec = Math.floor(t);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      const scene = scenes.find(s => t >= s.start && t < s.end);
      const label = `${mm}:${ss} · ${scene ? scene.stage + ' · ' + scene.stageLabel : ''}`;
      root.setAttribute('data-screen-label', label);
    }
  }, [Math.floor(t)]);
  return null;
}

function PChromeManager({ scenes }) {
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
      block={active.block || '#00184_2B'}
      hash={active.hash || '0xe9c4…d2a7'}
      showBrand={active.showBrand !== false}
      showScene={active.showScene !== false}
    />
  );
}

function PSeekBridge() {
  const tl = useTimeline();
  React.useEffect(() => {
    window.__seekStage = (t) => {
      if (tl.setPlaying) tl.setPlaying(false);
      if (tl.setTime) tl.setTime(t);
    };
    window.dispatchEvent(new Event('__seek_ready'));
  }, [tl]);
  return null;
}

function PApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Publish to window so getTweaks() in platform-scenes.jsx picks it up.
  window.__platformTweaks = tweaks;

  // Recompute scenes so labels (founder pct, seats) update in chrome.
  const scenes = React.useMemo(() => PSCENES_FOR(tweaks), [tweaks]);

  // Force a paint when tweaks change while paused — nudge the timeline.
  const [nudge, setNudge] = React.useState(0);
  React.useEffect(() => { setNudge(n => n + 1); }, [tweaks]);

  const founderClm = Math.round(tweaks.perClaim * (1 - tweaks.founderPct/100));

  return (
    <div id="video-root" data-screen-label="00:00 · COLD OPEN" style={{ position: 'absolute', inset: 0 }}>
      <Stage width={1920} height={1080} duration={106} background={csInk} persistKey="archiveone-platform">
        <CSBackdrop />

        {scenes.map((s, i) => (
          <Sprite key={i + ':' + nudge} start={s.start} end={s.end}>
            {s.render}
          </Sprite>
        ))}

        <PChromeManager scenes={scenes} />
        <PScreenLabelUpdater scenes={scenes} />
        <PSeekBridge />
      </Stage>

      <TweaksPanel>
        <TweakSection label="Pricing"/>
        <TweakSlider label="Per-claim fee" value={tweaks.perClaim}
          min={500} max={5000} step={50} unit="$"
          onChange={(v) => setTweak('perClaim', v)}/>

        <TweakSection label="Founder cohort"/>
        <TweakSlider label="Discount" value={tweaks.founderPct}
          min={0} max={75} step={5} unit="%"
          onChange={(v) => setTweak('founderPct', v)}/>
        <TweakSlider label="Seats" value={tweaks.founderSeats}
          min={5} max={50} step={5}
          onChange={(v) => setTweak('founderSeats', v)}/>

        <TweakSection label="Derived"/>
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: 'rgba(225,162,58,0.10)', border: '1px solid rgba(225,162,58,0.35)',
          display: 'flex', flexDirection: 'column', gap: 6,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
            <span style={{ color: 'rgba(41,38,27,0.6)', letterSpacing: '0.1em' }}>FOUNDER</span>
            <span style={{ color: '#29261b', fontWeight: 600 }}>${founderClm.toLocaleString()}/claim</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}>
            <span style={{ color: 'rgba(41,38,27,0.6)', letterSpacing: '0.1em' }}>STANDARD</span>
            <span style={{ color: '#29261b', fontWeight: 600 }}>${tweaks.perClaim.toLocaleString()}/claim</span>
          </div>
        </div>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PApp />);
