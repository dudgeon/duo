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

// Stage 11 § D33d — xterm.js draws on a canvas, so CSS overrides from the
// `.light` body class don't reach it. We swap theme objects based on the
// effective theme whenever it changes.
const DARK_THEME = {
  background: '#080808',
  foreground: '#e4e4e7',
  cursor: '#7c6af7',
  cursorAccent: '#080808',
  black: '#18181b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#3f3f46',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f4f4f5'
} as const

const LIGHT_THEME = {
  background: '#fafafa',
  foreground: '#18181b',
  cursor: '#7c6af7',
  cursorAccent: '#fafafa',
  black: '#27272a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#71717a',
  brightBlack: '#52525b',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#18181b'
} as const

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
      theme: { ...(themeEffective === 'light' ? LIGHT_THEME : DARK_THEME) },
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
  // swap the xterm theme object so the terminal matches.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = { ...(themeEffective === 'light' ? LIGHT_THEME : DARK_THEME) }
  }, [themeEffective])

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
