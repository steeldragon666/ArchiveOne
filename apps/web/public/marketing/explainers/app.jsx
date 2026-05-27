// app.jsx — ArchiveOne animated explainer composition

const SCENES = [
  { start:  0.0, end:  8.0,  stage: 'COLD OPEN',   stageLabel: 'THE NEW REALITY',   render: <Scene1ColdOpen/>,  showScene: false, showBrand: true,  block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start:  8.0, end: 14.0,  stage: 'TITLE',       stageLabel: 'ARCHIVEONE',         render: <Scene2Title/>,     showScene: false, showBrand: false, block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 14.0, end: 22.0,  stage: 'STAGE 01',    stageLabel: 'CAPTURE',           render: <Scene3Capture/>,                                       block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 22.0, end: 30.0,  stage: 'STAGE 02',    stageLabel: 'STAMP',             render: <Scene4Stamp/>,                                         block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 30.0, end: 40.0,  stage: 'STAGE 03',    stageLabel: 'ASSEMBLE',          render: <Scene5Assemble/>,                                      block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 40.0, end: 48.0,  stage: 'STAGE 04',    stageLabel: 'APPORTION',         render: <Scene6Apportion/>,                                     block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 48.0, end: 54.0,  stage: 'STAGE 05',    stageLabel: 'WATCH',             render: <Scene7Watch/>,                                         block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 54.0, end: 60.0,  stage: 'STAGE 06',    stageLabel: 'SEAL',              render: <Scene8Seal/>,                                          block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 60.0, end: 66.0,  stage: 'PAYOFF',      stageLabel: 'CONSULTANT TIME · RETURNED', render: <Scene9Stat/>,                                  block: '#00184_2A', hash: '0x7f3a…c4e1' },
  { start: 66.0, end: 72.0,  stage: 'END CARD',    stageLabel: 'OMNISCIENT AI',     render: <Scene10End/>,      showScene: false,                  block: '#00184_2A', hash: '0x7f3a…c4e1' },
];

function ScreenLabelUpdater() {
  // Update the video root's data-screen-label each second so users can
  // comment on a specific timestamp and the agent knows where to look.
  const t = useTime();
  React.useEffect(() => {
    const root = document.getElementById('video-root');
    if (root) {
      const sec = Math.floor(t);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      const scene = SCENES.find(s => t >= s.start && t < s.end);
      const label = `${mm}:${ss} · ${scene ? scene.stage + ' · ' + scene.stageLabel : ''}`;
      root.setAttribute('data-screen-label', label);
    }
  }, [Math.floor(t)]);
  return null;
}

function App() {
  return (
    <div id="video-root" data-screen-label="00:00 · COLD OPEN" style={{ position: 'absolute', inset: 0 }}>
      <Stage width={1920} height={1080} duration={72} background={csInk} persistKey="archiveone-explainer">
        <CSBackdrop />

        {SCENES.map((s, i) => (
          <Sprite key={i} start={s.start} end={s.end}>
            {s.render}
          </Sprite>
        ))}

        <ChromeManager scenes={SCENES} />
        <ScreenLabelUpdater />
      </Stage>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
