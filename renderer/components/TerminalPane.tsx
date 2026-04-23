import { useRef, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TabSession } from '@shared/types'

// scrollback defined here; shared/constants.ts uses Node.js os/path and can't be imported in renderer
const SCROLLBACK = 10_000

interface TerminalPaneProps {
  tabs: TabSession[]
  activeTabId: string
  onTitleChange: (id: string, title: string) => void
}

export function TerminalPane({ tabs, activeTabId, onTitleChange }: TerminalPaneProps) {
  return (
    <div className="relative w-full h-full bg-surface-0">
      {tabs.map(tab => (
        <TerminalInstance
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onTitleChange={onTitleChange}
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
}

function TerminalInstance({ tab, isActive, onTitleChange }: InstanceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<Array<() => void>>([])

  // ── Mount terminal ─────────────────────────────────────────────────────────
  useEffect(() => {
    const host = hostRef.current
    if (!host || termRef.current) return

    const term = new Terminal({
      theme: {
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
      },
      fontFamily: 'JetBrains Mono, Cascadia Code, Fira Code, ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.4,
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

  return (
    <div
      ref={hostRef}
      className="xterm-host absolute inset-0"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  )
}
