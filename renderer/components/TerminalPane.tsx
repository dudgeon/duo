import { useRef, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TabSession } from '@shared/types'
import { matchGlobalShortcut } from '../keyboard/globalShortcuts'
import { useClaudeKeyPrefs } from '../hooks/useClaudeKeyPrefs'
import { useClaudePresence } from '../hooks/useClaudePresence'

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
  /** BUG-038 — fires when xterm gains keyboard focus. The host
   *  (App.tsx) flips `focusedColumn` to 'terminal' so subsequent
   *  ⌃Tab cycles terminal tabs (not browser tabs). Belt+braces over
   *  the column wrapper's onMouseDown — xterm manages its own DOM
   *  heavily and there are paths (focus arriving from
   *  `webContents.focus()` in BUG-002, focus arriving via
   *  ⌘`-pane-cycle, focus arriving from a dispatchPostSpawnWrite
   *  PTY init) where the synthetic-event path doesn't see the
   *  click. */
  onTerminalFocus?: () => void
}

export function TerminalPane({
  tabs, activeTabId, onTitleChange, cozyByTab, cozyDefault, fontBumpByTab, fontBumpDefault, themeEffective, onTerminalFocus
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
          onTerminalFocus={onTerminalFocus}
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
  /** BUG-038 — fires on xterm focus. See TerminalPaneProps jsdoc. */
  onTerminalFocus?: () => void
}

function TerminalInstance({ tab, isActive, onTitleChange, cozy, fontBump, themeEffective, onTerminalFocus }: InstanceProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<Array<() => void>>([])

  // Sprint 16 / v0.6.15 — Claude-tab Enter key prefs. Mounted in every
  // TerminalInstance; the hook caches in localStorage + listens for
  // CLI-driven overrides. Stored in refs so the attachCustomKeyEventHandler
  // closure (which captures lexically at mount) reads the latest values
  // on every keystroke without needing to re-attach the handler.
  const { claudeReturn, shiftReturn } = useClaudeKeyPrefs()
  const claudeReturnRef = useRef(claudeReturn)
  claudeReturnRef.current = claudeReturn
  const shiftReturnRef = useRef(shiftReturn)
  shiftReturnRef.current = shiftReturn

  // BUG-154 (Sprint 20 / v0.7.7) — broaden the Return-override gate
  // from `tab.kind === 'claude'` to ALSO cover the case where the
  // user typed `claude` into a regular shell tab (tab.kind stays
  // 'shell' but Claude IS running). The claudePresence prober
  // (ENH-013) detects live Claude in any front terminal regardless
  // of how the PTY was spawned. Owner-reported gap on v0.7.7 walk:
  // "with cmd return for claude submit checked, return still
  // submits" — they were in a shell tab running claude, which the
  // kind-gate excluded.
  const claudePresenceState = useClaudePresence()
  const claudePresenceRef = useRef(claudePresenceState)
  claudePresenceRef.current = claudePresenceState
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
    // Bug fix family: xterm.js consumes most keystrokes as PTY input
    // by default, including Duo's window-level shortcuts. Without
    // this allowlist returning false, the keystroke never reaches
    // the renderer-side keydown handler in useKeyboardShortcuts.ts.
    //
    // Filed instances: BUG-001 (⌃Tab — fixed in this same file
    // earlier with the ⌃Tab branch below) and BUG-008 (⌘T → opens
    // browser tab, spec resolved 2026-04-26). Rather than allowlist
    // each new shortcut as bugs trickle in, sweep the entire Duo-
    // global meta-shortcut set in one shot. This kills the whole
    // class of "xterm eats this Duo shortcut" bug.
    //
    // Scope: any Duo-global shortcut that has a window-level
    // keydown handler in useKeyboardShortcuts.ts. The list:
    //   - ⌘T / ⌘⇧T (new browser / new claude tab)
    //   - ⌘N (new markdown file)
    //   - ⌘W (close active tab)
    //   - ⌘L (focus address bar)
    //   - ⌘B (toggle files column)
    //   - ⌘`  (toggle pane focus)
    //   - ⌘1–9 / ⌘⇧1–9 (terminal / working-pane tab jumps)
    //   - ⌘+ / ⌘= / ⌘- / ⌘0 (terminal font-size bumps)
    //   - ⌃Tab / ⌃⇧Tab (pane-aware tab cycling — BUG-001)
    //
    // Anything else (⌘C, ⌘V, plain typing, etc.) bubbles up to
    // xterm normally.
    // Preventative kb-shortcut architecture (replaces the previous
    // hardcoded allowlist). Defer entirely to the shared matcher in
    // `keyboard/globalShortcuts.ts` — if the matcher claims the
    // keystroke as a global shortcut, return false so xterm yields
    // and the keystroke bubbles to the document capture listener in
    // `useKeyboardShortcuts`. New shortcuts in the registry get
    // automatic terminal-pane coverage; old hardcoded list cannot
    // drift.
    term.attachCustomKeyEventHandler((e) => {
      const match = matchGlobalShortcut(e, { inEditableSurface: false })
      if (match) return false
      // ENH-127 v2 (2026-05-10) — Path 3b: in Claude tabs ONLY, plain
      // Enter writes a multi-line newline to Claude's input buffer
      // (no submit); ⌘Enter is the explicit submit gesture.
      //
      // KEY DISCOVERY (walk-3, 2026-05-10): Claude Code natively
      // accepts ⌥Enter (Option+Return) as a multi-line newline in
      // its input buffer. The byte sequence ⌥Enter sends on macOS is
      // ESC+CR (`\x1b\r`) — Claude reads ESC as "modified Enter,
      // append literal newline to buffer" rather than "submit."
      //
      // v1 + initial v2 both wrote `\n` on plain Enter, which Claude
      // treats identically to `\r` (submit). Both failed live test
      // for the same reason. The fix: write `\x1b\r` on plain Enter
      // — exactly what the user would get pressing ⌥Enter manually.
      // Claude shows a newline in the input box; nothing submits.
      // ⌘Enter writes `\r` (Claude's standard submit byte).
      //
      // Verification: walk-3 in dev — typed "test1" + ⌥Enter +
      // "test2" + ⌘Enter. Claude received both lines as one prompt
      // and responded "Got it — two test messages received." This
      // confirms `\x1b\r` is the right byte for "literal newline."
      //
      // Shell tabs (`tab.kind === 'shell'`) pass through unchanged —
      // breaking shell Enter would be far worse than the marginal
      // win.
      //
      // Only fire on keydown (xterm sends both keydown AND keyup;
      // intercepting both would write the byte twice).
      // walk-3 v3 fix — we MUST return false for Enter on all event
      // types (keydown / keypress / keyup) for our intercept to
      // actually suppress xterm's default `\r` write. Pre-fix we
      // filtered to keydown only and returned true on the others;
      // xterm's keypress dispatch then fired its default Enter
      // handler and wrote `\r` via onData ANYWAY, alongside our
      // pty.write of `\x1b\r`. Net result on Claude: it received
      // ESC+CR+CR and submitted on the trailing `\r`.
      //
      // Now: for plain Enter / ⌘Enter / Shift+Enter in Claude tabs,
      // return false on every event type, but only WRITE the byte on
      // keydown (so we don't write 3 times for keydown+keypress+keyup).
      //
      // ENH-133 (2026-05-10) — Shift+Enter joins plain Enter as a
      // newline gesture. Most messaging surfaces (Slack, Discord, GH
      // comments, gmail, claude.ai web) treat Shift+Enter as
      // "newline within composition" — muscle-memory miss before
      // ENH-133 because Shift+Enter did nothing useful in the
      // terminal. Implementation: relax the entry condition to admit
      // Shift+Enter; the existing `e.metaKey ? '\r' : '\x1b\r'` byte
      // logic already routes shift+Enter to ESC+CR (newline) since
      // metaKey is false. ⌘⇧Enter → submit (matches the "if Cmd is
      // held, submit" mental model from ENH-127 v2).
      // Sprint 16 / v0.6.15 — feature-toggle the Return/Shift+Return
      // overrides. ENH-127 v2 + ENH-133 shipped both as default-ON
      // (plain Return → newline, Shift+Return → newline). v0.6.15
      // flips the default for plain Return to 'submit' (matches every
      // other terminal in the world) while keeping the override
      // capability + the Shift+Return → newline default (matches
      // Slack/Discord/claude.ai web). Settings are localStorage-backed
      // + CLI-toggleable via `duo claude-return` + `duo shift-return`.
      //
      // Cases (Claude tabs only, plain Enter key, no Ctrl/Alt):
      //   1. ⌘ held (with or without Shift) → submit (`\r`). No toggle —
      //      ⌘Return is the unambiguous "submit" gesture from ENH-127 v2.
      //   2. Plain Enter (no modifier) → claudeReturn pref decides:
      //        'submit' (default) — pass through to xterm (writes `\r`)
      //        'newline' — write `\x1b\r` (ESC+CR; Claude reads as newline)
      //   3. Shift+Enter (no Cmd) → shiftReturn pref decides:
      //        'newline' (default) — write `\x1b\r`
      //        'submit' — pass through to xterm
      // BUG-154 (Sprint 20) — gate broadened: also fire when claudePresence
      // detects live Claude in a kind='shell' tab where the user typed
      // `claude` directly. Pre-fix, the Return-override only applied to
      // kind='claude' tabs (spawned via ⌘⇧T / `duo new-tab --claude`),
      // missing the common case of typing `claude` into a normal shell.
      const claudeIsLive = tab.kind === 'claude' || claudePresenceRef.current === 'claude'
      if (claudeIsLive && e.key === 'Enter' && !e.altKey && !e.ctrlKey) {
        if (e.metaKey) {
          // ⌘Enter / ⌘⇧Enter — always submit. No toggle.
          if (e.type === 'keydown') window.electron.pty.write(tab.id, '\r')
          return false
        }
        if (e.shiftKey) {
          if (shiftReturnRef.current === 'submit') return true  // xterm default
          if (e.type === 'keydown') window.electron.pty.write(tab.id, '\x1b\r')
          return false
        }
        // Plain Enter.
        if (claudeReturnRef.current === 'submit') return true  // xterm default
        if (e.type === 'keydown') window.electron.pty.write(tab.id, '\x1b\r')
        return false
      }
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

    // BUG-038 — when xterm gains keyboard focus, tell the host so
    // it can flip focusedColumn to 'terminal'. Belt+braces over the
    // column wrapper's onMouseDown for cases where focus arrives by
    // a non-click path (BUG-002 webContents.focus() reclaim,
    // ⌘`-pane-cycle, post-spawn PTY init). xterm's helper textarea
    // gets focus when xterm gains focus — listening on it catches
    // both human clicks and programmatic term.focus() calls.
    if (onTerminalFocus && term.textarea) {
      term.textarea.addEventListener('focus', onTerminalFocus)
    }

    // User keystrokes → PTY
    term.onData((data) => window.electron.pty.write(tab.id, data))

    // BUG-094 — strip TRAILING newlines from clipboard pastes. A copy
    // from chat / a doc / most sources ships with a trailing `\n`,
    // which the shell receives as Enter — the pasted command auto-
    // executes before the user can read or edit it. Capture-phase
    // listener on host fires before xterm's textarea-bound handler,
    // so we get first crack at the clipboard event; we drop only the
    // run of trailing newlines (matching Terminal.app's default paste
    // behavior) and hand the cleaned string to `term.paste()` (which
    // still wraps in bracketed-paste markers if the shell enabled
    // `?2004h`). Internal `\n`s are PRESERVED so legitimate multi-
    // line paste keeps working: Claude Code multi-line prompts, here-
    // docs, REPL blocks, copy-pasted scripts. Pastes without trailing
    // newlines fast-path to xterm's default — no behavior change for
    // the common single-line case.
    const onHostPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData?.getData('text/plain')
      if (data == null) return
      if (!/[\r\n]+$/.test(data)) return
      e.preventDefault()
      e.stopPropagation()
      const cleaned = data.replace(/[\r\n]+$/, '')
      if (cleaned) term.paste(cleaned)
    }
    host.addEventListener('paste', onHostPaste, true)

    // Start the PTY
    window.electron.pty.create(tab.id, undefined, tab.cwd)

    cleanupRef.current = [offData, offExit]

    return () => {
      cleanupRef.current.forEach(fn => fn())
      host.removeEventListener('paste', onHostPaste, true)
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

  // ── BUG-054: terminal:focus action verb listener ─────────────────────────
  // The Stage 27 `terminal:focus` action verb dispatches a
  // `duo-terminal-focus` CustomEvent on the window after flipping
  // focusedColumn to 'terminal'. setFocusedColumn alone only changes
  // the React focus *indicator*; it doesn't put the xterm in
  // keyboard-focus state. This listener catches the event and calls
  // termRef.focus() ON THE ACTIVE TAB ONLY (so multiple terminal
  // tabs don't all fight for focus when the verb fires). Mirrors
  // the duo-editor-find-open / duo-browser-find-open CustomEvent
  // pattern.
  useEffect(() => {
    if (!isActive) return
    const onFocus = () => {
      // Match the visibility-change effect's behavior exactly: defer
      // one frame so any concurrent layout settles, then call focus().
      requestAnimationFrame(() => {
        termRef.current?.focus()
      })
    }
    window.addEventListener('duo-terminal-focus', onFocus)
    return () => window.removeEventListener('duo-terminal-focus', onFocus)
  }, [isActive])

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
