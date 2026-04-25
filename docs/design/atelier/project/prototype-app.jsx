// Interactive Duo prototype — Atelier direction.
//
// Demo sequence (~16s loop):
//   0s   plain VISION.md, no agent activity
//   2s   user "selects" flagship-bet paragraph (highlight + Send→Duo pill)
//   3.2s pill click animation
//   3.5s titlebar agent dot pulses, terminal switches to claude tab
//   4.5s terminal types
//   6s   reveal-chip pops in files pane
//   8s   Duo INSERTS new sentence + new paragraph in editor — yellow
//        highlight fades over 6s (the "just added" feature)
//   13s  selection glow softens, terminal reply settled, fade complete

const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "direction": "atelier",
  "themeMode": "light",
  "cozyTerminal": false,
  "density": "comfortable",
  "editorFont": "serif",
  "editorMode": "live",
  "playDemo": true,
  "showAgentDot": true
}/*EDITMODE-END*/;

const DEMO_STEPS = [
  { at: 0,     state: { selectionGlow: false, agentDot: false, agentTyping: false, revealedPath: null, revealedFlash: false, justAddedKey: 0, showPill: false, pillClicked: false } },
  { at: 2000,  state: { selectionGlow: true, showPill: true } },
  { at: 3200,  state: { pillClicked: true } },
  { at: 3500,  state: { agentDot: true, activeTermTab: 't1', showPill: false } },
  { at: 4500,  state: { agentTyping: true } },
  { at: 6000,  state: { revealedPath: 'docs/prd/stage-11-markdown.md', revealedFlash: true } },
  { at: 6800,  state: { revealedFlash: false } },
  { at: 8000,  state: { agentTyping: false, justAddedKey: 1 } },
];

function applyAt(elapsed) {
  let s = {};
  for (const step of DEMO_STEPS) if (elapsed >= step.at) Object.assign(s, step.state);
  return s;
}

function App() {
  const [tw, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const mode = tw.themeMode === 'dark' ? 'dark' : 'light';

  const [termTabs, setTermTabs] = useState(SAMPLE_TERM_TABS);
  const [workingTabs, setWorkingTabs] = useState(SAMPLE_WORKING_TABS);
  const [activeTermTab, setActiveTermTab] = useState('t1');
  const [activeWorkingTab, setActiveWorkingTab] = useState('w1');

  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [cwd, setCwd] = useState('~/projects/conversational-servicing');

  // demo loop
  const [tick, setTick] = useState(0);
  const startRef = useRef(performance.now());
  useEffect(() => {
    if (!tw.playDemo) { setTick(0); return; }
    startRef.current = performance.now();
    let raf;
    const loop = () => {
      setTick((performance.now() - startRef.current) % 16000);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [tw.playDemo]);

  // track-changes mode disables demo motion (different feature being shown)
  const trackChanges = tw.editorMode === 'suggest';

  const demo = (tw.playDemo && !trackChanges) ? applyAt(tick) : {};

  // Loop counter so justAddedKey re-triggers every cycle
  const cycleRef = useRef(0);
  useEffect(() => { if (tick < 100) cycleRef.current += 1; }, [tick < 100]);

  useEffect(() => {
    if (demo.activeTermTab && activeTermTab !== demo.activeTermTab && tick < 9000) {
      setActiveTermTab(demo.activeTermTab);
    }
  }, [demo.activeTermTab, tick]); // eslint-disable-line

  function cycleTheme() {
    setTweak('themeMode', tw.themeMode === 'light' ? 'dark' : 'light');
  }

  const onCloseWT = (id) => {
    const next = workingTabs.filter(t => t.id !== id);
    setWorkingTabs(next);
    if (activeWorkingTab === id) setActiveWorkingTab(next[0]?.id);
  };
  const onNewWT = () => {
    const id = 'w' + Math.random().toString(36).slice(2, 7);
    setWorkingTabs([...workingTabs, { id, type: 'editor', icon: 'md', title: 'Untitled.md' }]);
    setActiveWorkingTab(id);
  };
  const onCloseTT = (id) => {
    const next = termTabs.filter(t => t.id !== id);
    setTermTabs(next);
    if (activeTermTab === id) setActiveTermTab(next[0]?.id);
  };
  const onNewTT = () => {
    const id = 't' + Math.random().toString(36).slice(2, 7);
    setTermTabs([...termTabs, { id, icon: 'term', title: 'shell · ' + (termTabs.length + 1) }]);
    setActiveTermTab(id);
  };

  const editorFamily =
    tw.editorFont === 'sans' ? DUO_FONTS.sans :
    tw.editorFont === 'mono' ? DUO_FONTS.mono :
                               DUO_FONTS.serif;

  const liveLines = demo.agentTyping || tick > 9000 ? SAMPLE_TERM_LINES : SAMPLE_TERM_LINES.slice(0, 5);

  // Pick the doc model for the current editor mode:
  //   live      → the demo doc — no edits at start; after 8s, a new sentence
  //               + a new paragraph appear with `mark: 'justAdded'`
  //   suggest   → the track-changes doc with insertions + deletions visible
  //   accepted  → the track-changes doc rendered with deletions stripped
  //               (insertions stay) — i.e. what "Accept all" leaves behind
  const liveDoc = useMemo(() => {
    if (trackChanges) return SAMPLE_DOC_TRACK_CHANGES;
    if (tw.editorMode === 'accepted') return SAMPLE_DOC_TRACK_CHANGES;
    return demo.justAddedKey ? SAMPLE_DOC_WITH_AGENT_ADDS(cycleRef.current) : SAMPLE_DOC;
  }, [tw.editorMode, demo.justAddedKey, trackChanges]);

  return (
    <>
      <DuoApp
        dir={tw.direction} mode={mode}
        dense={tw.density === 'compact'}
        filesCollapsed={filesCollapsed}
        onToggleFiles={() => setFilesCollapsed(c => !c)}
        cwd={cwd} onCwd={setCwd}
        tree={SAMPLE_TREE}
        pinned={pinned} onTogglePin={() => setPinned(p => !p)}
        revealedPath={demo.revealedPath ?? null}
        agentJustRevealed={!!demo.revealedFlash}
        onDismissReveal={() => {}}
        termTabs={termTabs} activeTermTab={activeTermTab}
        onSelectTermTab={setActiveTermTab}
        onCloseTermTab={onCloseTT} onNewTermTab={onNewTT}
        workingTabs={workingTabs} activeWorkingTab={activeWorkingTab}
        onSelectWorkingTab={setActiveWorkingTab}
        onCloseWorkingTab={onCloseWT} onNewWorkingTab={onNewWT}
        cozy={tw.cozyTerminal}
        terminalLines={liveLines}
        agentTyping={!!demo.agentTyping}
        workingDoc={liveDoc}
        agentSelectionGlow={!!demo.selectionGlow}
        editorFamily={editorFamily}
        trackChanges={trackChanges}
        justAddedKey={trackChanges ? 0 : (demo.justAddedKey || 0) + cycleRef.current * 10}
        onAcceptAll={() => setTweak('editorMode', 'accepted')}
        onRejectAll={() => setTweak('editorMode', 'live')}
        onCycleTheme={cycleTheme}
        themeLabel={mode === 'dark' ? 'Dark' : 'Light'}
        agentDot={tw.showAgentDot && (!!demo.agentDot || trackChanges)}
        pillSlot={demo.showPill ? <SendToDuoPill animateClick={!!demo.pillClicked} onClick={() => {}} /> : null}
        splitPct={48}
      />

      <TweaksPanel title="Tweaks · Duo">
        <TweakSection label="Direction" />
        <TweakRadio label="Visual" value={tw.direction} onChange={(v) => setTweak('direction', v)}
          options={[
            { value: 'stationery',    label: 'Stationery' },
            { value: 'atelier',       label: 'Atelier' },
            { value: 'fieldnotebook', label: 'Notebook' },
          ]} />

        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={tw.themeMode} onChange={(v) => setTweak('themeMode', v)}
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        <TweakRadio label="Density" value={tw.density} onChange={(v) => setTweak('density', v)}
          options={[{ value: 'comfortable', label: 'Comfy' }, { value: 'compact', label: 'Compact' }]} />

        <TweakSection label="Working pane mode" />
        <TweakRadio label="Editor" value={tw.editorMode} onChange={(v) => setTweak('editorMode', v)}
          options={[
            { value: 'live',     label: 'Live' },
            { value: 'suggest',  label: 'Suggesting' },
            { value: 'accepted', label: 'Accepted' },
          ]} />

        <TweakSection label="Terminal" />
        <TweakToggle label="Cozy mode (paper, 14px, 92ch)" value={tw.cozyTerminal}
          onChange={(v) => setTweak('cozyTerminal', v)} />

        <TweakSection label="Editor body font" />
        <TweakRadio label="Family" value={tw.editorFont} onChange={(v) => setTweak('editorFont', v)}
          options={[
            { value: 'serif', label: 'Serif' },
            { value: 'sans',  label: 'Sans' },
            { value: 'mono',  label: 'Mono' },
          ]} />

        <TweakSection label="Demo" />
        <TweakToggle label="Auto-play Claude moment" value={tw.playDemo}
          onChange={(v) => setTweak('playDemo', v)} />
        <TweakToggle label="Agent activity dot" value={tw.showAgentDot}
          onChange={(v) => setTweak('showAgentDot', v)} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
