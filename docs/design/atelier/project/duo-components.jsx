// Mock Duo UI — pure presentational components used by both the canvas
// (small, static artboards) and the prototype (full-bleed interactive app).
//
// Single component file with optional props for: theme (light|dark),
// direction (stationery|atelier|fieldnotebook), state (which terminal tab
// is active, what's open in the working pane, whether agent moments
// pulse, etc.). Components compose into a `<DuoApp>` shell.

const { useState, useEffect, useRef, useMemo } = React;

// ──────────────────────────────────────────────────────────────────
// Tiny icon set — hand-drawn, monochrome, 1.25 stroke. Inherits color.
// ──────────────────────────────────────────────────────────────────
const I = {
  folder:     (p) => <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.1l1.3 1.3h4.6a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>,
  doc:        (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M2 1.5h5l2 2v7h-7v-9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/><path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1"/></svg>,
  md:         (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M2 1.5h5l2 2v7h-7v-9Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/><path d="M7 1.5v2h2" stroke="currentColor" strokeWidth="1"/><path d="M3.4 7.5l1-1.2 1 1.2 1-1.2 1 1.2" stroke="currentColor" strokeWidth=".9" strokeLinecap="round"/></svg>,
  img:        (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><rect x="1.5" y="1.8" width="9" height="8.4" rx="1" stroke="currentColor" strokeWidth="1"/><circle cx="4" cy="4.5" r="1" stroke="currentColor" strokeWidth=".9"/><path d="M10 8L7.5 5.5l-2 2.5L4 7l-2 1.8" stroke="currentColor" strokeWidth=".9"/></svg>,
  globe:      (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1"/><path d="M1.6 6h8.8M6 1.6c1.4 1.5 2 3.3 2 4.4s-.6 2.9-2 4.4C4.6 8.9 4 7.1 4 6s.6-2.9 2-4.4Z" stroke="currentColor" strokeWidth=".8"/></svg>,
  term:       (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><rect x="1.4" y="2" width="9.2" height="8" rx="1.2" stroke="currentColor" strokeWidth="1"/><path d="M3.5 5l1.5 1-1.5 1M6 7h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  chev:       (p) => <svg width="9" height="9" viewBox="0 0 10 10" fill="none" {...p}><path d="M3.5 2.5L6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  plus:       (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  close:      (p) => <svg width="8" height="8" viewBox="0 0 8 8" fill="none" {...p}><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  pin:        (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><path d="M6 8.5v2.2M4 2.5h4M6 2.5v5l-1.8 1.5h3.6L6 7.5v-5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round"/></svg>,
  back:       (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  fwd:        (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  reload:     (p) => <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}><path d="M2 6a4 4 0 1 1 1.2 2.85" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M2 9V6h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  sun:        (p) => <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}><circle cx="7" cy="7" r="2.6" stroke="currentColor" strokeWidth="1.1"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.7 2.7l1.1 1.1M10.2 10.2l1.1 1.1M2.7 11.3l1.1-1.1M10.2 3.8l1.1-1.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  moon:       (p) => <svg width="13" height="13" viewBox="0 0 14 14" fill="none" {...p}><path d="M11.5 8.5A5 5 0 1 1 5.5 2.5a4 4 0 0 0 6 6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/></svg>,
  clock:      (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.1"/><path d="M6 3.5v2.5l2 1.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>,
  spark:      (p) => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}><path d="M6 1.5l1.1 3.4 3.4 1.1-3.4 1.1L6 10.5l-1.1-3.4-3.4-1.1 3.4-1.1L6 1.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>,
  grip:       (p) => <svg width="9" height="9" viewBox="0 0 10 10" fill="none" {...p}><circle cx="3.5" cy="2.5" r=".8" fill="currentColor"/><circle cx="6.5" cy="2.5" r=".8" fill="currentColor"/><circle cx="3.5" cy="5" r=".8" fill="currentColor"/><circle cx="6.5" cy="5" r=".8" fill="currentColor"/><circle cx="3.5" cy="7.5" r=".8" fill="currentColor"/><circle cx="6.5" cy="7.5" r=".8" fill="currentColor"/></svg>,
};

// ──────────────────────────────────────────────────────────────────
// Generic helpers
// ──────────────────────────────────────────────────────────────────

// Resolve { dir, mode } → token bag
function useTokens(dir, mode) {
  return useMemo(() => DUO_TOKENS[dir][mode], [dir, mode]);
}
function useVoice(dir) { return DUO_VOICE[dir]; }

// Visual treatment for the terminal pane that distinguishes it from the
// working pane. Stationery: subtle paper-edge tint. Atelier: same paper
// but a thin warm rule + serif tab labels. Field notebook: graph paper
// pattern in light mode, leather charcoal in dark.
function termPaneStyle(dir, mode, t) {
  if (dir === 'fieldnotebook' && mode === 'light') {
    return {
      background:
        `repeating-linear-gradient(0deg, ${t.paperRule}33 0 1px, transparent 1px 22px),` +
        `repeating-linear-gradient(90deg, ${t.paperRule}33 0 1px, transparent 1px 22px),` +
        t.paperDeep,
    };
  }
  if (dir === 'fieldnotebook') {
    return { background: t.paperDeep };
  }
  return { background: t.paperDeep };
}

// "Manuscript" treatment for working pane background — slight vertical rule.
function workingPaneStyle(dir, mode, t) {
  return { background: t.paper };
}

// ──────────────────────────────────────────────────────────────────
// Window chrome — macOS-flavored but warm/soft.
// ──────────────────────────────────────────────────────────────────
function DuoTitleBar({ dir, mode, t, voice, onCycleTheme, themeLabel, dense, agentDot }) {
  return (
    <div style={{
      height: dense ? 36 : 40, flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 10px',
      background: t.paperEdge,
      borderBottom: `1px solid ${t.paperRule}`,
      fontFamily: voice.chrome, color: t.inkSoft,
      WebkitAppRegion: 'drag', userSelect: 'none',
    }}>
      {/* traffic lights */}
      <div style={{ display: 'flex', gap: 7, paddingLeft: 2, paddingRight: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff706a', boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.18)' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbe2e', boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.18)' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.18)' }} />
      </div>
      {/* App wordmark — serif on atelier/notebook, sans on stationery */}
      <div style={{
        fontFamily: voice.chromeAccent,
        fontSize: dir === 'stationery' ? 12 : 14,
        fontWeight: dir === 'stationery' ? 600 : 500,
        letterSpacing: dir === 'stationery' ? '.04em' : 0,
        textTransform: dir === 'stationery' ? 'uppercase' : 'none',
        color: t.ink,
        fontStyle: dir === 'atelier' ? 'italic' : 'normal',
      }}>
        {dir === 'atelier' ? 'Duo' : dir === 'fieldnotebook' ? 'Duo' : 'Duo'}
      </div>
      <div style={{ flex: 1 }} />
      {agentDot && (
        <div title="Claude is reading the working pane" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: voice.chrome, fontSize: 11, color: t.inkMute,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: t.accent, boxShadow: `0 0 0 3px ${t.accent}33`,
            animation: 'duo-agent-pulse 1.6s ease-in-out infinite',
          }} />
          <span>Claude · reading</span>
        </div>
      )}
      {/* Theme cycle */}
      <button onClick={onCycleTheme} title={`Theme · ${themeLabel}`} style={{
        WebkitAppRegion: 'no-drag',
        height: 24, padding: '0 8px', borderRadius: 6,
        border: `1px solid ${t.paperRule}`,
        background: 'transparent', color: t.inkSoft,
        fontFamily: voice.chrome, fontSize: 11, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {mode === 'light' ? I.sun({}) : I.moon({})}
        <span>{themeLabel}</span>
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Files pane — breadcrumb, pin, tree, reveal chip, collapsed rail
// ──────────────────────────────────────────────────────────────────
function FilesPane({ dir, mode, t, voice, collapsed, onToggleCollapsed, focused, tree, cwd, onCwd, pinned, onTogglePin, revealedPath, onDismissReveal, agentJustRevealed }) {
  if (collapsed) {
    return (
      <div onClick={onToggleCollapsed} style={{
        width: 44, flexShrink: 0, height: '100%', cursor: 'pointer',
        background: t.paperEdge, borderRight: `1px solid ${t.paperRule}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12, gap: 14,
        color: t.inkMute,
      }}>
        {I.folder({})}
        <div style={{ width: 18, height: 1, background: t.paperRule }} />
        <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: voice.chrome, fontSize: 10, color: t.inkGhost, letterSpacing: '.08em' }}>FILES</div>
      </div>
    );
  }
  const segments = breadcrumb(cwd);
  return (
    <div style={{
      width: 208, flexShrink: 0, height: '100%',
      background: t.paperEdge,
      borderRight: `1px solid ${focused ? t.accent + '66' : t.paperRule}`,
      display: 'flex', flexDirection: 'column', minHeight: 0,
      transition: 'border-color .2s',
    }}>
      {/* Header */}
      <div style={{
        height: 32, flexShrink: 0, display: 'flex', alignItems: 'center',
        borderBottom: `1px solid ${t.paperRule}`, paddingLeft: 8,
      }}>
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2,
          fontFamily: voice.chrome, fontSize: 11, color: t.inkMute, overflow: 'hidden',
        }}>
          {segments.map((s, i) => (
            <React.Fragment key={i}>
              <button onClick={() => onCwd?.(s.path)} title={s.path} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: i === segments.length - 1 ? t.ink : t.inkMute,
                fontFamily: 'inherit', fontSize: 'inherit',
                fontWeight: i === segments.length - 1 ? 600 : 400,
                padding: '2px 4px', borderRadius: 3, maxWidth: 100,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.label}</button>
              {i < segments.length - 1 && <span style={{ color: t.inkGhost }}>/</span>}
            </React.Fragment>
          ))}
        </div>
        <button onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin (freeze navigator)'} style={{
          width: 24, height: 24, borderRadius: 5, border: 'none',
          background: 'transparent', cursor: 'pointer',
          color: pinned ? t.accent : t.inkGhost,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{I.pin({})}</button>
        <button onClick={onToggleCollapsed} title="Collapse files pane" style={{
          width: 24, height: 24, marginRight: 4, borderRadius: 5, border: 'none',
          background: 'transparent', cursor: 'pointer', color: t.inkGhost,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Reveal chip */}
      {revealedPath && (
        <div style={{
          margin: '8px 8px 0', padding: '8px 10px', borderRadius: 6,
          background: t.accentSoft, border: `1px solid ${t.accent}33`,
          display: 'flex', alignItems: 'flex-start', gap: 8,
          fontFamily: voice.chrome, fontSize: 11,
          animation: agentJustRevealed ? 'duo-agent-flash 1.2s ease-out' : undefined,
        }}>
          <div style={{ color: t.accent, marginTop: 1 }}>{I.spark({})}</div>
          <div style={{ flex: 1, minWidth: 0, color: t.accentInk }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Claude moved here</div>
            <div style={{ color: t.accentInk, opacity: .8, fontFamily: DUO_FONTS.mono, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {revealedPath}
            </div>
          </div>
          <button onClick={onDismissReveal} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: t.accentInk, opacity: .6, padding: 2 }}>{I.close({})}</button>
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {tree.map((node, i) => <TreeNode key={i} node={node} depth={0} t={t} voice={voice} dir={dir} />)}
      </div>

      {/* Footer cwd */}
      <div style={{
        flexShrink: 0, padding: '6px 10px', borderTop: `1px solid ${t.paperRule}`,
        fontFamily: DUO_FONTS.mono, fontSize: 10, color: t.inkGhost,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{cwd}</div>
    </div>
  );
}

function TreeNode({ node, depth, t, voice, dir }) {
  const [open, setOpen] = useState(node.open ?? false);
  const isFolder = node.kind === 'folder';
  const selected = node.selected;
  return (
    <>
      <button
        onClick={() => isFolder && setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', border: 'none',
          background: selected ? t.accent + '20' : 'transparent',
          padding: `2px 8px 2px ${8 + depth * 12}px`,
          display: 'flex', alignItems: 'center', gap: 6,
          color: selected ? t.ink : (isFolder ? t.inkSoft : t.inkSoft),
          fontFamily: voice.chrome, fontSize: 12.5, cursor: 'pointer', lineHeight: 1.5,
          borderRadius: 0,
        }}
      >
        {isFolder
          ? <span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', color: t.inkGhost }}>{I.chev({})}</span>
          : <span style={{ width: 9 }} />}
        <span style={{ color: isFolder ? t.accent : t.inkMute, display: 'inline-flex' }}>
          {isFolder ? I.folder({}) : nodeIcon(node.name)}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.name}
        </span>
        {node.selectedBy === 'claude' && (
          <span title="Claude is reading this" style={{
            width: 5, height: 5, borderRadius: '50%', background: t.accent,
            boxShadow: `0 0 0 2px ${t.accent}33`,
          }} />
        )}
      </button>
      {isFolder && open && node.children?.map((c, i) => (
        <TreeNode key={i} node={c} depth={depth + 1} t={t} voice={voice} dir={dir} />
      ))}
    </>
  );
}
function nodeIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['md', 'markdown'].includes(ext)) return I.md({});
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return I.img({});
  return I.doc({});
}
function breadcrumb(cwd) {
  const parts = cwd.replace(/^~/, '~').split('/').filter(Boolean);
  let acc = '';
  return parts.map((p) => {
    acc = (acc ? acc + '/' : '') + p;
    return { label: p, path: acc };
  });
}

// ──────────────────────────────────────────────────────────────────
// Tab strip — UNIFIED visual language. Used by terminal pane AND
// working pane, so the user reads them as one family. The differentiator
// between the two halves is tab *shape and accent line*, not chrome
// language: terminal tabs sit on a slightly deeper paper, working tabs
// on lighter paper; both share the same chip style, plus a small slot
// icon (terminal vs file/web) so type is legible.
// ──────────────────────────────────────────────────────────────────
function TabStrip({ dir, mode, t, voice, kind, tabs, activeId, onSelect, onClose, onNew, dense }) {
  // kind: 'terminal' | 'working'
  const stripBg = kind === 'terminal' ? t.paperEdge : t.paperDeep;
  return (
    <div style={{
      height: dense ? 32 : 36, flexShrink: 0, display: 'flex', alignItems: 'flex-end',
      paddingLeft: 8, paddingRight: 6, gap: 2,
      background: stripBg,
      borderBottom: `1px solid ${t.paperRule}`,
    }}>
      {tabs.map(tab => {
        const active = tab.id === activeId;
        return (
          <button key={tab.id} onClick={() => onSelect?.(tab.id)} style={{
            position: 'relative',
            display: 'flex', alignItems: 'center', gap: 6,
            height: dense ? 26 : 30,
            padding: '0 10px',
            maxWidth: 200,
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: active ? t.paper : 'transparent',
            color: active ? t.ink : t.inkMute,
            fontFamily: dir === 'fieldnotebook' && active ? voice.chromeAccent : voice.chrome,
            fontStyle: dir === 'atelier' && active ? 'italic' : 'normal',
            fontSize: dir === 'atelier' && active ? 13 : 12,
            fontWeight: active ? 500 : 400,
            cursor: 'pointer',
            boxShadow: active ? `inset 0 1px 0 ${t.paperRule}, inset 1px 0 ${t.paperRule}, inset -1px 0 ${t.paperRule}` : 'none',
          }}>
            {/* accent underline that bleeds into the pane below */}
            {active && (
              <span style={{
                position: 'absolute', left: 0, right: 0, top: 0, height: 2,
                background: t.accent, borderRadius: '8px 8px 0 0',
              }} />
            )}
            <span style={{ color: active ? t.accent : t.inkGhost, display: 'inline-flex' }}>
              {tab.icon === 'term' ? I.term({}) :
               tab.icon === 'globe' ? I.globe({}) :
               tab.icon === 'md' ? I.md({}) :
               tab.icon === 'img' ? I.img({}) : I.doc({})}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
            {tab.dirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.accent }} />}
            {onClose && tabs.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); onClose(tab.id); }} style={{
                width: 14, height: 14, borderRadius: 3,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: active ? t.inkMute : t.inkGhost, opacity: active ? .8 : 0,
                transition: 'opacity .12s, background .12s, color .12s',
              }} className="duo-tab-close">{I.close({})}</span>
            )}
          </button>
        );
      })}
      <button onClick={onNew} title="New tab" style={{
        width: 24, height: 24, borderRadius: 5, marginLeft: 4, marginBottom: 3,
        background: 'transparent', border: 'none', cursor: 'pointer', color: t.inkMute,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{I.plus({})}</button>
      <div style={{ flex: 1 }} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Terminal — two modes: default (dark canvas, dense mono) and cozy
// (paper canvas, larger serif-flavored mono with line-height + reader
// width). Cozy is the now-fleshed-out modality the user mentioned.
// ──────────────────────────────────────────────────────────────────
function TerminalPane({ dir, mode, t, voice, cozy, lines, agentTyping, fontBump = 0 }) {
  const dark = !cozy;
  const bg = cozy ? t.termCozyBg : t.termBg;
  const fg = cozy ? t.termCozyFg : t.termFg;
  const fontSize = (cozy ? 14 : 12.5) + fontBump;
  const lineHeight = cozy ? 1.6 : 1.35;
  const padding = cozy ? '24px 32px' : '12px 14px';
  return (
    <div style={{
      flex: 1, minHeight: 0, position: 'relative',
      background: bg, color: fg,
      fontFamily: DUO_FONTS.mono, fontSize, lineHeight,
      overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', overflowY: 'auto',
        padding,
        maxWidth: cozy ? `${92 * (fontSize * 0.6)}px` : '100%',
        margin: cozy ? '0 auto' : 0,
      }}>
        {lines.map((ln, i) => <TermLine key={i} line={ln} t={t} cozy={cozy} dark={dark} />)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 4 }}>
          <span style={{ color: t.accent, marginRight: 8 }}>❯</span>
          {agentTyping && (
            <span style={{ color: cozy ? t.inkSoft : t.termFg, opacity: .85 }}>
              duo ax --selector '[role="document"]'<span className="duo-cursor" style={{ background: t.accent }}>&nbsp;</span>
            </span>
          )}
          {!agentTyping && (
            <span className="duo-cursor" style={{ background: cozy ? t.ink : t.termFg, width: '0.55em', height: '1.05em', display: 'inline-block', verticalAlign: 'text-bottom' }} />
          )}
        </div>
      </div>
      {/* Cozy mode badge */}
      {cozy && (
        <div style={{
          position: 'absolute', top: 8, right: 12,
          fontFamily: voice.chromeAccent, fontStyle: 'italic',
          fontSize: 10.5, color: t.inkGhost, letterSpacing: '.02em',
          background: t.paperEdge, padding: '2px 8px', borderRadius: 10,
          border: `1px solid ${t.paperRule}`,
        }}>
          cozy mode · 92ch · 14px
        </div>
      )}
    </div>
  );
}

function TermLine({ line, t, cozy, dark }) {
  if (line.kind === 'prompt') {
    return (
      <div>
        <span style={{ color: t.accent }}>❯</span>{' '}
        <span style={{ opacity: .85 }}>{line.cmd}</span>
      </div>
    );
  }
  if (line.kind === 'agent') {
    return (
      <div style={{
        display: 'flex', gap: 8, padding: cozy ? '10px 0' : '4px 0',
      }}>
        <span style={{ color: t.accent, fontFamily: 'inherit', flexShrink: 0 }}>◆</span>
        <span style={{ color: dark ? t.termFg : t.inkSoft }}>{line.text}</span>
      </div>
    );
  }
  if (line.kind === 'tool') {
    return (
      <div style={{
        display: 'flex', gap: 8, padding: cozy ? '6px 0' : '2px 0',
        color: dark ? '#8a857a' : t.inkMute,
      }}>
        <span style={{ color: t.accent, opacity: .7 }}>●</span>
        <span style={{ fontStyle: 'italic' }}>{line.text}</span>
      </div>
    );
  }
  if (line.kind === 'output') {
    return <div style={{ color: dark ? '#a8a395' : t.inkSoft, opacity: .85 }}>{line.text}</div>;
  }
  if (line.kind === 'blank') return <div>&nbsp;</div>;
  return <div>{line.text}</div>;
}

// ──────────────────────────────────────────────────────────────────
// Working pane — markdown editor (Google-Docs-y), browser, image preview
// ──────────────────────────────────────────────────────────────────
function WorkingMarkdownEditor({ dir, mode, t, voice, doc, agentSelectionGlow, editorFamily, trackChanges, justAddedKey, onAcceptAll, onRejectAll, pillSlot }) {
  const family = editorFamily || voice.editor;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.paper }}>
      {trackChanges && (
        <div style={{
          flexShrink: 0, padding: '6px 18px',
          background: t.accentSoft,
          borderBottom: `1px solid ${t.accent}33`,
          display: 'flex', alignItems: 'center', gap: 10,
          fontFamily: voice.chrome, fontSize: 11.5, color: t.accentInk,
        }}>
          <span style={{ display: 'inline-flex', color: t.accent }}>{I.spark({})}</span>
          <span style={{ flex: 1 }}>
            <strong>Suggesting · 3 changes from Claude.</strong>{' '}Review inline, or use the actions on the right.
          </span>
          <button onClick={onRejectAll} style={{
            height: 22, padding: '0 8px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${t.accent}55`, background: 'transparent', color: t.accentInk,
            fontFamily: voice.chrome, fontSize: 11,
          }}>Reject all</button>
          <button onClick={onAcceptAll} style={{
            height: 22, padding: '0 8px', borderRadius: 4, cursor: 'pointer',
            border: 'none', background: t.accent, color: t.paper,
            fontFamily: voice.chrome, fontSize: 11, fontWeight: 600,
          }}>Accept all</button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: '40px 0' }}>
        <div style={{
          maxWidth: 720, margin: '0 auto', padding: '0 60px',
          fontFamily: family, fontSize: 16.5, lineHeight: 1.7, color: t.ink,
        }}>
          <div style={{ fontFamily: voice.chrome, fontSize: 11, color: t.inkMute, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 16 }}>
            {doc.kicker}
          </div>
          <h1 style={{ fontFamily: voice.chromeAccent, fontSize: 36, lineHeight: 1.15, margin: '0 0 8px', fontWeight: 600, color: t.ink, letterSpacing: '-.01em' }}>
            {doc.title}
          </h1>
          <div style={{ color: t.inkMute, fontSize: 13, fontFamily: voice.chrome, marginBottom: 32 }}>
            {doc.byline} · saved 2 minutes ago
          </div>
          {doc.blocks.map((b, i) => <EditorBlock key={i + ':' + (justAddedKey ?? '')} block={b} t={t} voice={voice}
            agentSelectionGlow={agentSelectionGlow}
            trackChanges={trackChanges}
            pillSlot={i === 6 ? pillSlot : null} />)}
        </div>
      </div>
    </div>
  );
}

function EditorBlock({ block, t, voice, agentSelectionGlow, trackChanges, pillSlot }) {
  // 'justAdded' block — entire block fades in then text highlight fades out
  const blockClass = block.kind && block.justAdded ? 'duo-block-in' : '';
  const wrap = (el) => block.justAdded
    ? React.cloneElement(el, { className: ((el.props.className || '') + ' duo-block-in').trim() })
    : el;
  if (block.kind === 'h2') {
    return wrap(<h2 style={{ fontFamily: voice.chromeAccent, fontSize: 22, marginTop: 36, marginBottom: 8, fontWeight: 600, color: t.ink, letterSpacing: '-.005em' }}>{block.text}</h2>);
  }
  if (block.kind === 'h3') {
    return wrap(<h3 style={{ fontFamily: voice.chromeAccent, fontSize: 16.5, marginTop: 24, marginBottom: 6, fontWeight: 600, color: t.ink }}>{block.text}</h3>);
  }
  if (block.kind === 'p') {
    return wrap(
      <p style={{ margin: '0 0 14px', textWrap: 'pretty' }}>
        {block.spans ? block.spans.map((s, i) => renderSpan(s, i, { t, voice, agentSelectionGlow, trackChanges, pillSlot: i === 1 ? pillSlot : null })) : block.text}
      </p>
    );
  }
  if (block.kind === 'ul') {
    return wrap(<ul style={{ paddingLeft: 22, margin: '0 0 14px' }}>
      {block.items.map((it, i) => <li key={i} style={{ margin: '4px 0' }}>{typeof it === 'string' ? it : renderSpan(it, i, { t, voice, agentSelectionGlow, trackChanges })}</li>)}
    </ul>);
  }
  if (block.kind === 'quote') {
    return wrap(
      <blockquote style={{
        margin: '14px 0', padding: '4px 0 4px 16px',
        borderLeft: `3px solid ${t.accent}`,
        color: t.inkSoft, fontStyle: 'italic',
      }}>{block.text}</blockquote>
    );
  }
  if (block.kind === 'code') {
    return wrap(
      <pre style={{
        background: t.paperEdge, border: `1px solid ${t.paperRule}`,
        borderRadius: 6, padding: '12px 14px', margin: '14px 0',
        fontFamily: DUO_FONTS.mono, fontSize: 13, color: t.inkSoft, overflowX: 'auto',
      }}>{block.text}</pre>
    );
  }
  return null;
}

// Render a span with marks: agent (selection glow), mark, em, strong, code,
// justAdded (yellow flash that fades over 6s), insertion (green underline),
// deletion (red strikethrough). The last two are the track-changes pair.
function renderSpan(s, i, { t, voice, agentSelectionGlow, trackChanges, pillSlot }) {
  if (s.mark === 'agent' && agentSelectionGlow) {
    return <span key={i} style={{
      position: 'relative',
      background: t.mark, padding: '0 2px',
      boxShadow: `0 0 0 1px ${t.accent}55, 0 0 12px ${t.accent}40`,
      borderRadius: 2, transition: 'box-shadow .4s',
    }}>
      {pillSlot && pillSlot}
      {s.text}
    </span>;
  }
  if (s.mark === 'mark') {
    return <span key={i} style={{ background: t.mark, padding: '0 2px', borderRadius: 2 }}>{s.text}</span>;
  }
  if (s.mark === 'justAdded') {
    return <span key={i} className="duo-just-added" style={{ '--duo-just-added-strong': t.mark }}>{s.text}</span>;
  }
  if (s.mark === 'insertion') {
    if (!trackChanges) return <span key={i}>{s.text}</span>;
    return <span key={i} style={{
      background: t.mark + '88',
      borderBottom: `2px solid ${t.accent}`,
      padding: '0 1px',
    }}>{s.text}</span>;
  }
  if (s.mark === 'deletion') {
    if (!trackChanges) return null; // accepted view drops deleted text
    return <span key={i} style={{
      textDecoration: 'line-through',
      textDecorationColor: '#b8553a',
      textDecorationThickness: '1.5px',
      color: t.inkMute, opacity: .7,
      background: '#b8553a18',
    }}>{s.text}</span>;
  }
  if (s.mark === 'em') return <em key={i}>{s.text}</em>;
  if (s.mark === 'strong') return <strong key={i}>{s.text}</strong>;
  if (s.mark === 'code') return <code key={i} style={{ fontFamily: DUO_FONTS.mono, fontSize: '.88em', background: t.paperEdge, padding: '1px 5px', borderRadius: 3 }}>{s.text}</code>;
  return <React.Fragment key={i}>{s.text}</React.Fragment>;
}

// Browser pane (simple)
function WorkingBrowser({ dir, mode, t, voice, url, title, content }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: t.paper }}>
      <div style={{
        flexShrink: 0, height: 36, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 8,
        background: t.paperDeep, borderBottom: `1px solid ${t.paperRule}`,
      }}>
        <button style={{ background: 'transparent', border: 'none', color: t.inkMute, cursor: 'pointer', padding: 4 }}>{I.back({})}</button>
        <button style={{ background: 'transparent', border: 'none', color: t.inkGhost, cursor: 'not-allowed', padding: 4 }}>{I.fwd({})}</button>
        <button style={{ background: 'transparent', border: 'none', color: t.inkMute, cursor: 'pointer', padding: 4 }}>{I.reload({})}</button>
        <div style={{
          flex: 1, height: 24, padding: '0 10px',
          background: t.paper, border: `1px solid ${t.paperRule}`, borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: voice.chrome, fontSize: 11, color: t.inkSoft,
          overflow: 'hidden',
        }}>
          <span style={{ color: t.inkGhost }}>🔒</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: t.paper, padding: '24px 32px', fontFamily: voice.chrome, color: t.ink }}>
        <div style={{ fontFamily: voice.chromeAccent, fontSize: 24, marginBottom: 12, fontWeight: 600 }}>{title}</div>
        {content}
      </div>
    </div>
  );
}

// Image preview
function WorkingImage({ t, voice, name }) {
  return (
    <div style={{ flex: 1, background: t.paperDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
      <div style={{
        width: 220, height: 140, borderRadius: 6,
        background: `linear-gradient(135deg, ${t.accent} 0%, ${t.accentSoft} 100%)`,
        boxShadow: `0 8px 24px ${t.ink}22`,
      }} />
      <div style={{ fontFamily: voice.chrome, fontSize: 12, color: t.inkMute }}>{name} · 1024×640</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Whole app — composition
// ──────────────────────────────────────────────────────────────────
function DuoApp({
  dir, mode, dense = false,
  filesCollapsed = false, onToggleFiles,
  cwd = '~/projects/conversational-servicing',
  tree = SAMPLE_TREE,
  pinned = false, onTogglePin,
  revealedPath = null, onDismissReveal, agentJustRevealed = false,
  termTabs = SAMPLE_TERM_TABS, activeTermTab, onSelectTermTab, onCloseTermTab, onNewTermTab,
  workingTabs = SAMPLE_WORKING_TABS, activeWorkingTab, onSelectWorkingTab, onCloseWorkingTab, onNewWorkingTab,
  cozy = false, terminalLines = SAMPLE_TERM_LINES, agentTyping = false, fontBump = 0,
  workingDoc = SAMPLE_DOC, agentSelectionGlow = false,
  trackChanges = false, justAddedKey = 0, onAcceptAll, onRejectAll,
  pillSlot = null,
  editorFamily,
  onCycleTheme, themeLabel = 'System',
  agentDot = false,
  width = '100%', height = '100%',
  splitPct = 50,
  focusedColumn,
}) {
  const t = useTokens(dir, mode);
  const voice = useVoice(dir);
  // Resolve the active working tab's renderer
  const activeWT = workingTabs.find(wt => wt.id === activeWorkingTab) || workingTabs[0];
  const activeTT = termTabs.find(tt => tt.id === activeTermTab) || termTabs[0];

  return (
    <div style={{
      width, height,
      display: 'flex', flexDirection: 'column',
      background: t.paper, color: t.ink,
      fontFamily: voice.chrome,
      overflow: 'hidden',
      borderRadius: 12,
      boxShadow: '0 24px 60px rgba(20,15,8,.18), 0 4px 12px rgba(20,15,8,.08)',
    }}>
      <DuoTitleBar dir={dir} mode={mode} t={t} voice={voice}
        onCycleTheme={onCycleTheme} themeLabel={themeLabel}
        dense={dense} agentDot={agentDot} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <FilesPane dir={dir} mode={mode} t={t} voice={voice}
          collapsed={filesCollapsed} onToggleCollapsed={onToggleFiles}
          focused={focusedColumn === 'files'}
          tree={tree} cwd={cwd} pinned={pinned} onTogglePin={onTogglePin}
          revealedPath={revealedPath} onDismissReveal={onDismissReveal}
          agentJustRevealed={agentJustRevealed} />
        {/* Terminal column */}
        <div style={{
          width: `${splitPct}%`, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          ...termPaneStyle(dir, mode, t),
          borderRight: `1px solid ${t.paperRule}`,
        }}>
          <TabStrip dir={dir} mode={mode} t={t} voice={voice}
            kind="terminal" tabs={termTabs}
            activeId={activeTermTab} onSelect={onSelectTermTab}
            onClose={onCloseTermTab} onNew={onNewTermTab} dense={dense} />
          <TerminalPane dir={dir} mode={mode} t={t} voice={voice}
            cozy={cozy} lines={terminalLines} agentTyping={agentTyping}
            fontBump={fontBump} />
        </div>
        {/* Working column */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          ...workingPaneStyle(dir, mode, t),
        }}>
          <TabStrip dir={dir} mode={mode} t={t} voice={voice}
            kind="working" tabs={workingTabs}
            activeId={activeWorkingTab} onSelect={onSelectWorkingTab}
            onClose={onCloseWorkingTab} onNew={onNewWorkingTab} dense={dense} />
          {activeWT.type === 'editor' &&
            <WorkingMarkdownEditor dir={dir} mode={mode} t={t} voice={voice}
              doc={workingDoc} agentSelectionGlow={agentSelectionGlow}
              editorFamily={editorFamily}
              trackChanges={trackChanges} justAddedKey={justAddedKey}
              onAcceptAll={onAcceptAll} onRejectAll={onRejectAll}
              pillSlot={pillSlot} />}
          {activeWT.type === 'browser' &&
            <WorkingBrowser dir={dir} mode={mode} t={t} voice={voice}
              url={activeWT.url} title={activeWT.pageTitle}
              content={SAMPLE_BROWSER_CONTENT(t, voice)} />}
          {activeWT.type === 'image' &&
            <WorkingImage t={t} voice={voice} name={activeWT.title} />}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sample data
// ──────────────────────────────────────────────────────────────────

const SAMPLE_TREE = [
  { kind: 'folder', name: 'docs', open: true, children: [
    { kind: 'folder', name: 'prd', children: [] },
    { kind: 'file', name: 'VISION.md', selected: true },
    { kind: 'file', name: 'ROADMAP.md' },
    { kind: 'file', name: 'DECISIONS.md' },
  ]},
  { kind: 'folder', name: 'electron', children: [] },
  { kind: 'folder', name: 'renderer', children: [] },
  { kind: 'folder', name: 'cli', children: [] },
  { kind: 'file', name: 'README.md' },
  { kind: 'file', name: 'CLAUDE.md' },
  { kind: 'file', name: 'package.json' },
  { kind: 'file', name: 'tailwind.config.mjs' },
];

const SAMPLE_TERM_TABS = [
  { id: 't1', icon: 'term', title: 'duo (claude)' },
  { id: 't2', icon: 'term', title: 'tests · watch' },
  { id: 't3', icon: 'term', title: 'electron-vite' },
];

const SAMPLE_WORKING_TABS = [
  { id: 'w1', type: 'editor', icon: 'md', title: 'VISION.md', dirty: true },
  { id: 'w2', type: 'browser', icon: 'globe', title: 'PRD — Conv. Servicing', url: 'https://docs.google.com/document/d/abc/edit', pageTitle: 'PRD: Conversational Servicing v3' },
  { id: 'w3', type: 'image', icon: 'img', title: 'screen-after.png' },
];

const SAMPLE_TERM_LINES = [
  { kind: 'prompt', cmd: 'claude' },
  { kind: 'agent', text: 'Reading the PRD section you highlighted in the editor — give me a moment.' },
  { kind: 'tool', text: 'duo selection' },
  { kind: 'output', text: '> "We need a way for the agent to surface its current focus..."' },
  { kind: 'blank' },
  { kind: 'agent', text: "Three things to flag in that paragraph:" },
  { kind: 'agent', text: ' 1. "surface its current focus" is doing a lot of work — what kind of focus?' },
  { kind: 'agent', text: " 2. The reveal-chip pattern already covers files; this might be a duplicate." },
  { kind: 'agent', text: ' 3. We have no analogue for the *terminal* surface — worth naming.' },
  { kind: 'blank' },
  { kind: 'agent', text: 'Want me to draft a revision in the doc?' },
];

const SAMPLE_DOC = {
  kicker: 'docs / vision',
  title: 'Duo — Vision',
  byline: 'Geoff · last edited Apr 24',
  blocks: [
    { kind: 'p', text: "Duo collapses three surfaces a PM uses every hour — files, a terminal, and a working canvas — into one warm room, and gives Claude Code a CLI to drive any of them." },
    { kind: 'h2', text: 'Persona' },
    { kind: 'p', text: "A product manager who already lives in Claude Code, writes specs in Google Docs and Markdown, and is tired of switching contexts to copy text out of one window and into another." },
    { kind: 'h2', text: 'Principles' },
    { kind: 'ul', items: [
      'The CLI is the spec. Every UI affordance has a duo verb.',
      'Warm before it is dense.',
      "Claude is a coworker — visible when working, quiet when idle.",
    ]},
    { kind: 'h2', text: 'The flagship bet' },
    { kind: 'p', spans: [
      { text: "We need a way for the agent to " },
      { text: "surface its current focus", mark: 'agent' },
      { text: " across panes — when Claude is reading the working pane, the user should see it; when it's writing in the terminal, the same. " },
      { text: 'No surprise hand-offs.', mark: 'em' },
    ]},
    { kind: 'quote', text: 'A coworker who you can see thinking is far easier to trust than one who works in silence.' },
    { kind: 'h3', text: 'Non-goals' },
    { kind: 'ul', items: [
      'Replacing the IDE.',
      'Multi-agent orchestration in MVP.',
      'Cross-platform — macOS first.',
    ]},
  ],
};

// Doc with a paragraph in the flagship bet that has a justAdded span,
// plus a freshly added bullet at the end. Keys swap on demand to retrigger.
const SAMPLE_DOC_WITH_AGENT_ADDS = (key) => ({
  ...SAMPLE_DOC,
  blocks: SAMPLE_DOC.blocks.map((b, i) => {
    if (i === 6 /* flagship-bet paragraph */) {
      return { kind: 'p', spans: [
        { text: "We need a way for the agent to " },
        { text: "surface its current focus", mark: 'agent' },
        { text: " across panes \u2014 when Claude is reading the working pane, the user should see it; when it's writing in the terminal, the same. " },
        { text: 'No surprise hand-offs.', mark: 'em' },
        { text: ' ' },
        { text: "The terminal surface needs its own analogue \u2014 a small typing indicator and a soft pane-tint when Claude is composing.", mark: 'justAdded' },
      ]};
    }
    return b;
  }).concat([
    { kind: 'p', justAdded: true, spans: [
      { text: '', mark: 'justAdded' }, // padding to ensure block is highlighted too
    ]},
  ]).slice(0, -1).concat([
    { kind: 'p', justAdded: true, spans: [
      { text: '\u201cFocus across panes\u201d resolves into three concrete UI moments: a titlebar dot, a selection glow, and a reveal-chip in the files pane. Each one has a duo verb and an ax target.', mark: 'justAdded' },
    ]},
  ]),
  _key: key,
});

// Track-changes mock — same doc, but the flagship-bet paragraph carries
// proposed insertions and deletions. Toggle the trackChanges prop to view
// the suggesting-mode chrome (banner + colored marks). Toggle off to see
// the accepted state (deletions disappear, insertions stay).
const SAMPLE_DOC_TRACK_CHANGES = {
  ...SAMPLE_DOC,
  blocks: SAMPLE_DOC.blocks.map((b, i) => {
    if (i === 6) {
      return { kind: 'p', spans: [
        { text: "We need a way for the agent to " },
        { text: "surface its current focus", mark: 'deletion' },
        { text: "signal where it's working", mark: 'insertion' },
        { text: " across panes \u2014 when Claude is reading the working pane, the user should see it; when it's writing in the terminal, " },
        { text: "the same.", mark: 'deletion' },
        { text: "a soft pane tint says so.", mark: 'insertion' },
        { text: ' ' },
        { text: 'No surprise hand-offs.', mark: 'em' },
      ]};
    }
    if (b.kind === 'h3' && b.text === 'Non-goals') {
      return { kind: 'h3', text: 'Non-goals', _next: true };
    }
    return b;
  }).concat([
    { kind: 'p', spans: [
      { text: 'Each focus moment maps to one duo verb \u2014 ', mark: 'insertion' },
      { text: 'duo glow', mark: 'insertion' },
      { text: ', ', mark: 'insertion' },
      { text: 'duo reveal', mark: 'insertion' },
      { text: ', ', mark: 'insertion' },
      { text: 'duo dot', mark: 'insertion' },
      { text: '.', mark: 'insertion' },
    ]},
  ]),
};

Object.assign(window, { SAMPLE_DOC_WITH_AGENT_ADDS, SAMPLE_DOC_TRACK_CHANGES });

const SAMPLE_BROWSER_CONTENT = (t, voice) => (
  <>
    <div style={{ color: t.inkMute, fontSize: 13, marginBottom: 24, fontFamily: voice.chrome }}>Geoffrey M. · last edit by you, 4 minutes ago</div>
    <div style={{ fontFamily: voice.editor, fontSize: 15, lineHeight: 1.7, color: t.ink, maxWidth: 640 }}>
      <p style={{ margin: '0 0 14px' }}>This PRD covers the v3 rewrite of the conversational-servicing experience for US Card. The current build (v2) ships with three known UX dead-ends; this revision retires them in favor of a smaller, sharper intent surface.</p>
      <p style={{ margin: '0 0 14px' }}>The most important change: <strong>collapsing the disambiguation step</strong> onto the result card itself, so the customer never sees a blank "Did you mean…" prompt mid-flow.</p>
      <h3 style={{ fontFamily: voice.chromeAccent, fontSize: 17, marginTop: 24, marginBottom: 8, fontWeight: 600 }}>Background</h3>
      <p style={{ margin: '0 0 14px' }}>v2 was instrumented end-to-end in March 2026; the funnel data shows 22% of sessions abandon at the disambiguation step alone…</p>
    </div>
  </>
);

// Send → Duo pill — floating purple bubble that appears above any
// selection in the WorkingPane (Stage 15g PRD § 4 / G1-G5).
function SendToDuoPill({ onClick, animateClick, label = 'Send → Duo', shortcut = '⌘D' }) {
  return (
    <span style={{
      position: 'absolute', top: -36, right: -8,
      transform: animateClick ? 'translateY(6px) scale(.92)' : 'none',
      opacity: animateClick ? 0 : 1,
      transition: 'opacity .25s ease-out, transform .25s ease-out',
      pointerEvents: animateClick ? 'none' : 'auto', zIndex: 5,
      animation: animateClick ? 'none' : 'duo-pill-in .22s ease-out',
    }}>
      <button onClick={onClick} style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 10px 0 9px', borderRadius: 999,
        background: '#7c6af7', color: 'white', border: 'none',
        boxShadow: '0 6px 18px rgba(124,106,247,.4), 0 1px 0 rgba(255,255,255,.25) inset',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
        fontSize: 11.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6h7M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>{label}</span>
        <span style={{ opacity: .65, fontSize: 10.5, marginLeft: 2 }}>{shortcut}</span>
      </button>
      <span style={{
        position: 'absolute', left: 24, bottom: -3, transform: 'rotate(45deg)',
        width: 8, height: 8, background: '#7c6af7',
      }} />
    </span>
  );
}

Object.assign(window, {
  DuoApp, FilesPane, TabStrip, TerminalPane, WorkingMarkdownEditor, WorkingBrowser, WorkingImage, DuoTitleBar,
  SendToDuoPill,
  SAMPLE_TREE, SAMPLE_TERM_TABS, SAMPLE_WORKING_TABS, SAMPLE_TERM_LINES, SAMPLE_DOC, I,
});
