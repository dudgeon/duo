import { useRef, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TabSession } from '@shared/types'

// scrollback defined here; shared/constants.ts uses Node.js os/path and can't be imported in renderer
const SCROLLBACK = 10_000

// Stage 9 typography values. Default vs cozy — see docs/prd/stage-9-cozy-mode.md § C7.
const DEFAULT_FONT_SIZE = 13
const DEFAULT_LINE_HEIGHT = 1.4
const COZY_FONT_SIZE = 15
const COZY_LINE_HEIGHT = 1.55
// Reader-width cap (cols) applied only when cozy is on.
const COZY_MAX_COLS = 92

// Stage 11 § D33d / Stage 12 — xterm.js draws on a canvas, so CSS
// overrides from the `.light` / `.dark` body class don't reach it. We
// swap theme objects based on the effective theme whenever it changes.
// Background + foreground use the Atelier paper/ink/term tokens; ANSI
// colors are tuned for warm-paper compatibility (less neon than the
// previous Warp×Linear palette).
//
// Stage 12 Phase 3 — cozy mode now flips the entire xterm canvas to a
// paper background ("cozy mode flips to paper canvas" per the Atelier
// design intent in docs/design/atelier/project/tokens.jsx). Each theme
// has a default (inky) variant and a cozy (paper) variant. The active
// theme is picked by `pickTheme(themeEffective, cozy)` and re-applied
// whenever either dimension changes.
const DARK_THEME = {
  background: '#0C0A07',     // --duo-term-bg (dark)
  foreground: '#E9DEC2',     // --duo-term-fg (dark)
  cursor: '#E08F4A',         // --duo-accent (dark) — warm amber cursor
  cursorAccent: '#0C0A07',
  black: '#26201A',          // --duo-paper-edge (dark)
  red: '#E07A6B',            // muted terracotta
  green: '#9CB872',          // sage
  yellow: '#E5B765',         // soft amber
  blue: '#7CA7C9',           // dusty blue
  magenta: '#C28FB0',        // rosewood
  cyan: '#82B8B0',           // moss-cyan
  white: '#C8BD9E',          // --duo-ink-soft (dark)
  brightBlack: '#5A5142',    // --duo-ink-ghost (dark)
  brightRed: '#EF8E7F',
  brightGreen: '#B0CC85',
  brightYellow: '#F2C97D',
  brightBlue: '#9BBED9',
  brightMagenta: '#D6A6C2',
  brightCyan: '#9DCFC4',
  brightWhite: '#F0E9D6'     // --duo-ink (dark)
} as const

const LIGHT_THEME = {
  background: '#1A1410',     // --duo-term-bg (light) — terminal stays inky on the paper page
  foreground: '#F0E9D6',     // --duo-term-fg (light)
  cursor: '#C66A2E',         // --duo-accent (light) — ochre cursor
  cursorAccent: '#1A1410',
  black: '#26201A',
  red: '#D9694F',            // brick red on dark surface
  green: '#86A65D',
  yellow: '#D4A24A',
  blue: '#6F95B5',
  magenta: '#B581A3',
  cyan: '#74A89F',
  white: '#C8BD9E',
  brightBlack: '#7B6F58',    // --duo-ink-mute (light)
  brightRed: '#E9836B',
  brightGreen: '#9DBA73',
  brightYellow: '#E5B765',
  brightBlue: '#8DAEC8',
  brightMagenta: '#C997B5',
  brightCyan: '#88BBB1',
  brightWhite: '#FBF8EE'     // --duo-paper (light)
} as const

// Cozy variants — paper canvas, ink foreground. The ANSI palette is
// re-tuned for legibility on a light background (deeper, less neon).
const COZY_LIGHT_THEME = {
  background: '#FBF8EE',     // --duo-term-cozy-bg (light) — paper
  foreground: '#1A1410',     // --duo-term-cozy-fg (light) — ink
  cursor: '#C66A2E',         // --duo-accent (light)
  cursorAccent: '#FBF8EE',
  black: '#1A1410',
  red: '#A33A1F',            // deeper brick — needs contrast on paper
  green: '#5A7637',
  yellow: '#9C7320',         // ochre on paper, not amber
  blue: '#2F5F86',
  magenta: '#7E4666',
  cyan: '#3E726B',
  white: '#3D352A',          // --duo-ink-soft (light)
  brightBlack: '#7B6F58',    // --duo-ink-mute (light)
  brightRed: '#C04F33',
  brightGreen: '#6E8B45',
  brightYellow: '#B58730',
  brightBlue: '#447395',
  brightMagenta: '#925978',
  brightCyan: '#508780',
  brightWhite: '#1A1410'
} as const

const COZY_DARK_THEME = {
  background: '#1A1611',     // --duo-term-cozy-bg (dark) — soft warm dark
  foreground: '#F0E9D6',     // --duo-term-cozy-fg (dark)
  cursor: '#E08F4A',
  cursorAccent: '#1A1611',
  black: '#26201A',
  red: '#E07A6B',
  green: '#9CB872',
  yellow: '#E5B765',
  blue: '#7CA7C9',
  magenta: '#C28FB0',
  cyan: '#82B8B0',
  white: '#C8BD9E',
  brightBlack: '#5A5142',
  brightRed: '#EF8E7F',
  brightGreen: '#B0CC85',
  brightYellow: '#F2C97D',
  brightBlue: '#9BBED9',
  brightMagenta: '#D6A6C2',
  brightCyan: '#9DCFC4',
  brightWhite: '#F0E9D6'
} as const

function pickTheme(effective: 'light' | 'dark', cozy: boolean) {
  if (cozy) return effective === 'light' ? COZY_LIGHT_THEME : COZY_DARK_THEME
  return effective === 'light' ? LIGHT_THEME : DARK_THEME
}

interface TerminalPaneProps {
  tabs: TabSession[]
  activeTabId: string
  onTitleChange: (id: string, title: string) => void
  /** Per-tab cozy state keyed by tab UUID. Tabs not present inherit
   *  `cozyDefault`. */
  cozyByTab: Record<string, boolean>
  cozyDefault: boolean
  /** Per-tab signed font-size bump from ⌘+/-/0. Added on top of the
   *  cozy/default base fontSize. */
  fontBumpByTab: Record<string, number>
  fontBumpDefault: number
  /** Stage 11 — resolved `light` | `dark` for the active app theme. */
  themeEffective: 'light' | 'dark'
}

export function TerminalPane({
  tabs, activeTabId, onTitleChange, cozyByTab, cozyDefault, fontBumpByTab, fontBumpDefault, themeEffective
}: TerminalPaneProps) {
  return (
    <div className="relative w-full h-full bg-surface-0">
      {tabs.map(tab => (
        <TerminalInstance
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onTitleChange={onTitleChange}
          cozy={cozyByTab[tab.id] ?? cozyDefault}
          fontBump={fontBumpByTab[tab.id] ?? fontBumpDefault}
          themeEffective={themeEffective}
        />
      ))}
    </div>
  )
}

// ── Individual terminal instance ─────────────────────────────────────────────
// Rendered for every tab; hidden (not unmounted) when inactive so the PTY
// session and scroll buffer survive tab switches without re-mounting.

interface InstanceProps {
  tab: TabSession
  isActive: boolean
  onTitleChange: (id: string, title: string) => void
  cozy: boolean
  fontBump: number
  themeEffective: 'light' | 'dark'
}

function TerminalInstance({ tab, isActive, onTitleChange, cozy, fontBump, themeEffective }: InstanceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<Array<() => void>>([])
  // Track the typography state we last applied so the effect below can
  // tell a cozy/font-bump change from an initial mount and avoid
  // redundant fits. `applied` holds "cozy:bump" so either changing
  // triggers a re-apply.
  const appliedTypoRef = useRef<string | null>(null)

  // ── Mount terminal ─────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host || termRef.current) return

    const term = new Terminal({
      // Stage 12 Phase 3 — cozy mode swaps the canvas to paper. Pick the
      // initial theme using both dimensions; the swap effect below keeps
      // it in sync as either changes.
      theme: { ...pickTheme(themeEffective, cozy) },
      fontFamily: 'JetBrains Mono, Cascadia Code, Fira Code, ui-monospace, monospace',
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: DEFAULT_LINE_HEIGHT,
      cursorBlink: true,
      scrollback: SCROLLBACK,
      allowProposedApi: true
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)

    // BUG-001 fix (part 2/2) — let ⌃Tab / ⌃⇧Tab bubble up to the window
    // keydown listener so `useKeyboardShortcuts` can route them through
    // its pane-aware handler. By default xterm.js eats Ctrl+Tab as
    // valid terminal input; Duo overloads it for tab cycling, so we
    // return false to skip xterm's handling. The renderer's `useEffect`
    // window listener then sees the keydown and runs the branch in
    // useKeyboardShortcuts.ts. Without this, xterm consumes the keystroke
    // before it can bubble.
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') return false
      return true
    })

    // Set refs before attempting the first fit so resize/visibility effects
    // still work even if fit throws (e.g. zero-size container on initial mount).
    termRef.current = term
    fitRef.current = fit

    const safeFit = () => {
      const { width, height } = host.getBoundingClientRect()
      if (width <= 0 || height <= 0) return false
      try { fit.fit() } catch (err) { console.warn('[duo] xterm fit failed', err) }
      return true
    }

    // Defer the first fit so the host has measured dimensions. Retry on the
    // next frame if layout isn't ready yet.
    if (!safeFit()) requestAnimationFrame(safeFit)

    // Wire PTY → terminal output
    const offData = window.electron.pty.onData(tab.id, (data) => term.write(data))

    // Wire terminal exit
    const offExit = window.electron.pty.onExit(tab.id, (_code) => {
      term.writeln('\r\n\x1b[2m[process exited]\x1b[0m')
    })

    // OSC title sequence → tab title
    term.onTitleChange((title) => onTitleChange(tab.id, title || 'Terminal'))

    // User keystrokes → PTY
    term.onData((data) => window.electron.pty.write(tab.id, data))

    // Start the PTY
    window.electron.pty.create(tab.id, undefined, tab.cwd)

    cleanupRef.current = [offData, offExit]

    return () => {
      cleanupRef.current.forEach(fn => fn())
      window.electron.pty.kill(tab.id)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [tab.id, tab.cwd, onTitleChange])

  // ── Typography application (cozy + ⌘+/- font bump) ─────────────────────────
  // When `cozy` or `fontBump` changes, push new typography into xterm,
  // toggle the host class for padding/max-width, measure the cell width
  // once xterm has re-rendered, then refit + resize the PTY.
  useEffect(() => {
    const host = hostRef.current
    const term = termRef.current
    const fit = fitRef.current
    if (!host || !term || !fit) return
    const key = `${cozy ? 1 : 0}:${fontBump}`
    if (appliedTypoRef.current === key) return
    appliedTypoRef.current = key

    const baseSize = cozy ? COZY_FONT_SIZE : DEFAULT_FONT_SIZE
    term.options.fontSize = Math.max(8, baseSize + fontBump)
    term.options.lineHeight = cozy ? COZY_LINE_HEIGHT : DEFAULT_LINE_HEIGHT

    host.classList.toggle('cozy', cozy)

    // Two rAFs: the first lets xterm re-render at the new font; the second
    // lets the DOM pick up the class change and measure cleanly before the
    // reader-width cap is computed.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!termRef.current || !fitRef.current) return
      if (cozy) {
        const cellPx = measureCellWidth(host)
        if (cellPx > 0) {
          host.style.setProperty('--cozy-max-px', `${Math.round(cellPx * COZY_MAX_COLS)}px`)
        } else {
          host.style.removeProperty('--cozy-max-px')
        }
      } else {
        host.style.removeProperty('--cozy-max-px')
      }
      try { fitRef.current.fit() } catch (err) { console.warn('[duo] typography fit failed', err) }
      const { cols, rows } = termRef.current
      window.electron.pty.resize(tab.id, cols, rows)
    }))
  }, [cozy, fontBump, tab.id])

  // ── Fit on visibility change ───────────────────────────────────────────────
  useEffect(() => {
    if (!isActive || !fitRef.current || !termRef.current) return
    // Defer one frame so the DOM has finished showing the element
    const id = requestAnimationFrame(() => {
      fitRef.current?.fit()
      const { cols, rows } = termRef.current!
      window.electron.pty.resize(tab.id, cols, rows)
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isActive, tab.id])

  // ── Resize observer ────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const ro = new ResizeObserver(() => {
      if (!isActive || !fitRef.current || !termRef.current) return
      fitRef.current.fit()
      const { cols, rows } = termRef.current
      window.electron.pty.resize(tab.id, cols, rows)
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [isActive, tab.id])

  // ── Live theme swap ────────────────────────────────────────────────────────
  // xterm.js paints on its own canvas/WebGL layer \u2014 CSS overrides don't
  // reach it. When the app theme flips (via the toggle or `duo theme`),
  // swap whenever app theme OR cozy mode changes (Stage 12 Phase 3 — cozy flips to paper canvas in light, warm dark canvas in dark).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = { ...pickTheme(themeEffective, cozy) }
  }, [themeEffective, cozy])

  return (
    <div
      ref={hostRef}
      className="xterm-host absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}

// Measure the rendered monospace cell width so the reader-width cap tracks
// the actual cozy font size. We read xterm's own measured geometry off the
// first ".xterm-rows" row; falling back to a getBoundingClientRect() of a
// single glyph if that shape isn't available in this xterm version.
function measureCellWidth(host: HTMLElement): number {
  const row = host.querySelector<HTMLElement>('.xterm-rows > div')
  if (row) {
    const rect = row.getBoundingClientRect()
    const children = row.children.length
    if (rect.width > 0 && children > 0) return rect.width / children
  }
  // Fallback: synth-measure a single glyph in the host's computed font.
  const sample = document.createElement('span')
  sample.textContent = 'M'
  sample.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;font-family:inherit;font-size:inherit;'
  host.appendChild(sample)
  const px = sample.getBoundingClientRect().width
  host.removeChild(sample)
  return px
}
