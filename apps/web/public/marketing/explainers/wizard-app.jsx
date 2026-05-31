// wizard-app.jsx — ArchiveOne claim-wizard / workflow explainer composition

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  clientName: 'Vantage Industries',
  yearsHistory: 6,
  factsTarget: 18420,
}; /*EDITMODE-END*/

const WSCENES = [
  {
    start: 0.0,
    end: 7.5,
    stage: 'COLD OPEN',
    stageLabel: 'DEPOSIT · INTEREST',
    render: <WScene1ColdOpen />,
    showScene: false,
    showBrand: true,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 7.5,
    end: 13.0,
    stage: 'TITLE',
    stageLabel: 'THE CLAIM WIZARD',
    render: <WScene2Title />,
    showScene: false,
    showBrand: false,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 13.0,
    end: 23.0,
    stage: 'STAGE 01',
    stageLabel: 'WIZARD · FY25/26',
    render: <WScene3Wizard />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 23.0,
    end: 32.0,
    stage: 'STAGE 02',
    stageLabel: 'INGEST · YEAR-END DUMP',
    render: <WScene4DataDump />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 32.0,
    end: 42.0,
    stage: 'STAGE 03',
    stageLabel: 'LEARN · EMBED IN MOBILE',
    render: <WScene5Learning />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 42.0,
    end: 52.0,
    stage: 'STAGE 04',
    stageLabel: 'INFLECTION · JUN 30 → JUL 1',
    render: <WScene6Understanding />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 52.0,
    end: 62.0,
    stage: 'STAGE 05',
    stageLabel: 'FY26/27 · MOBILE',
    render: <WScene7Mobile />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 62.0,
    end: 73.0,
    stage: 'STAGE 06',
    stageLabel: 'TRUSTED ADVISOR',
    render: <WScene8Advisor />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 73.0,
    end: 82.0,
    stage: 'STAGE 07',
    stageLabel: 'COMPOUND',
    render: <WScene9Sticky />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 82.0,
    end: 91.0,
    stage: 'STAGE 08',
    stageLabel: 'DISPROPORTIONATE VALUE',
    render: <WScene10Value />,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 91.0,
    end: 100.0,
    stage: 'CHOICE',
    stageLabel: 'THE QUESTION',
    render: <WScene11Choice />,
    showScene: false,
    showBrand: true,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
  {
    start: 100.0,
    end: 107.0,
    stage: 'END CARD',
    stageLabel: 'OMNISCIENT AI',
    render: <WScene11End />,
    showScene: false,
    block: '#00184_2C',
    hash: '0xa17c…be39',
  },
];

function WScreenLabelUpdater() {
  const t = useTime();
  React.useEffect(() => {
    const root = document.getElementById('video-root');
    if (root) {
      const sec = Math.floor(t);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      const scene = WSCENES.find((s) => t >= s.start && t < s.end);
      const label = `${mm}:${ss} · ${scene ? scene.stage + ' · ' + scene.stageLabel : ''}`;
      root.setAttribute('data-screen-label', label);
    }
  }, [Math.floor(t)]);
  return null;
}

function WChromeManager() {
  const t = useTime();
  let active = null;
  for (const s of WSCENES) {
    if (t >= s.start && t <= s.end) {
      active = s;
      break;
    }
  }
  if (!active) return null;
  return (
    <CSChrome
      stage={active.stage}
      title={active.stageLabel}
      block={active.block || '#00184_2C'}
      hash={active.hash || '0xa17c…be39'}
      showBrand={active.showBrand !== false}
      showScene={active.showScene !== false}
    />
  );
}

function WApp() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Publish to window so getWTweaks() in wizard-scenes.jsx picks it up.
  window.__wizardTweaks = tweaks;

  // Nudge re-render when tweaks change while paused.
  const [nudge, setNudge] = React.useState(0);
  React.useEffect(() => {
    setNudge((n) => n + 1);
  }, [tweaks]);

  return (
    <div
      id="video-root"
      data-screen-label="00:00 · COLD OPEN"
      style={{ position: 'absolute', inset: 0 }}
    >
      <Stage
        width={1920}
        height={1080}
        duration={107}
        background={csInk}
        persistKey="archiveone-wizard"
      >
        <CSBackdrop />

        {WSCENES.map((s, i) => (
          <Sprite key={i + ':' + nudge} start={s.start} end={s.end}>
            {s.render}
          </Sprite>
        ))}

        <WChromeManager />
        <WScreenLabelUpdater />
      </Stage>

      <TweaksPanel>
        <TweakSection label="Demo client" />
        <TweakText
          label="Company name"
          value={tweaks.clientName}
          onChange={(v) => setTweak('clientName', v)}
        />

        <TweakSection label="Knowledge depth" />
        <TweakSlider
          label="Years of history"
          value={tweaks.yearsHistory}
          min={1}
          max={10}
          step={1}
          unit=" yrs"
          onChange={(v) => setTweak('yearsHistory', v)}
        />
        <TweakSlider
          label="Facts learned (target)"
          value={tweaks.factsTarget}
          min={1000}
          max={50000}
          step={500}
          onChange={(v) => setTweak('factsTarget', v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<WApp />);
