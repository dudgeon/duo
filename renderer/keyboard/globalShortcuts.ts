// Preventative keyboard-shortcut architecture.
//
// The chronic regression family (BUG-001, BUG-008, BUG-012/013/014) all
// share one root cause: every interactive surface (xterm, contentEditable
// iframe, TipTap, WebContentsView) intercepts keystrokes by default, and
// each new pane needs bespoke wiring to let global shortcuts escape. That
// makes the default DEAD: a shortcut starts broken in any new pane until
// someone wires the escape, and "wires the escape" is the failure mode.
//
// This module inverts that default. Every surface that handles keystrokes
// asks one question — `matchGlobalShortcut(e, ctx)` — and yields control
// to the global handler when the match is positive. The same matcher
// drives:
//
//   - the capture-phase document listener in `useKeyboardShortcuts`
//     (parent doc → fires before TipTap, before app controls bubble)
//   - the iframe forwarder in `installGlobalShortcutForwarder` (canvas
//     → resyntehesizes the keystroke at the parent so the capture
//     listener picks it up)
//   - xterm's `attachCustomKeyEventHandler` (returns false when the
//     matcher claims the keystroke)
//   - the BrowserManager's `before-input-event` IPC forward (already
//     forwards on a hardcoded list; will switch to the matcher in a
//     follow-up so the list stops drifting)
//
// Adding a new shortcut: add an entry below. Adding a new pane: adopt
// one of the three escape patterns. Quadratic coverage with linear
// effort. The smoke matrix in docs/dev/smoke-checklist.md is the
// second line of defense; the first is that surfaces *cannot* see
// these keystrokes without explicitly opting into them.

/** What kind of focus context the keystroke is firing in. The matcher
 *  uses this to disambiguate shortcuts that should be locally consumed
 *  by an editor (e.g. ⌘B for bold) from their global meaning (toggle
 *  the Files column).
 */
export interface FocusContext {
  /** True when keyboard focus is inside a contentEditable host
   *  (markdown editor, HTML canvas body) — these surfaces "own" letter
   *  shortcuts like ⌘B/⌘I/⌘U for formatting. */
  inEditableSurface: boolean
}

/** A typed registry of every global shortcut. Adding a row gives every
 *  surface that consults the matcher coverage of the new shortcut for
 *  free. */
export type ShortcutId =
  | 'newBrowserTab'
  | 'newMarkdownFile'
  | 'newClaudeTab'
  | 'closeTab'
  | 'focusAddressBar'
  | 'focusBreadcrumbEdit'
  | 'openFind'
  | 'findNext'
  | 'findPrev'
  | 'toggleFilesColumn'
  | 'togglePaneFocus'
  | 'fontBumpUp'
  | 'fontBumpDown'
  | 'fontBumpReset'
  | 'jumpTerminalTab'
  | 'jumpWorkingTab'
  | 'prevTerminalTab'
  | 'nextTerminalTab'
  | 'cycleTabsForward'
  | 'cycleTabsBackward'
  // Stage 15.3 — ⌘D fires Send → Duo on the active surface (editor /
  // canvas / browser pane). Each surface listens for the
  // duo-send-to-duo CustomEvent and runs its own pill click.
  | 'sendToDuo'
  // Sprint 3 Phase 3b — Split View open/move + promote chords. ⌘\
  // moves the active main tab into the aux slot (or, if the
  // active tab is already in aux, no-op). ⌘⇧\ promotes aux back
  // to main (closes the split AND keeps the file open). Slack
  // reference: cmd+shift+. opens the split, but ⌘\ is more
  // discoverable for Duo's "open in split" gesture (and matches
  // the visual divider character). For pure-close (discard split
  // entirely without promoting the aux file), use the ✕ button
  // in the aux header.
  | 'splitViewToggle'
  | 'splitViewPromote'

export interface ShortcutMatch {
  id: ShortcutId
  /** The numeric arg for shortcuts that need it (1–9 for tab jumps). */
  arg?: number
}

/**
 * Returns the matched shortcut, or null if the keystroke is not a
 * global one (passes through to whatever local handler wants it).
 *
 * Order matters — the first match wins. Specific combos before
 * generic ones (e.g. ⌘⇧T before ⌘T).
 */
export function matchGlobalShortcut(
  e: KeyboardEvent,
  ctx: FocusContext
): ShortcutMatch | null {
  const meta = e.metaKey
  const shift = e.shiftKey
  const ctrl = e.ctrlKey
  const alt = e.altKey
  const key = e.key.toLowerCase()

  // ⌃Tab / ⌃⇧Tab — pane-aware tab cycling. Highest priority because
  // ⌃Tab is otherwise consumed by xterm / browser as PTY input or
  // Chromium's built-in tab cycling.
  if (ctrl && !meta && !alt && e.key === 'Tab') {
    return { id: shift ? 'cycleTabsBackward' : 'cycleTabsForward' }
  }

  // ⌘⇧T — new claude tab (post-BUG-008 spec).
  if (meta && shift && !alt && !ctrl && key === 't') {
    return { id: 'newClaudeTab' }
  }

  // ⌘T — new browser tab (Chrome parity).
  if (meta && !shift && !alt && !ctrl && key === 't') {
    return { id: 'newBrowserTab' }
  }

  // ⌘N — new markdown file. Inside an editable surface ⌘N still
  // fires globally (no editor consumes it for letter formatting).
  if (meta && !shift && !alt && !ctrl && key === 'n') {
    return { id: 'newMarkdownFile' }
  }

  // ⌘W — close tab.
  if (meta && !shift && !alt && !ctrl && key === 'w') {
    return { id: 'closeTab' }
  }

  // ⌘L — focus address bar (Chrome parity).
  if (meta && !shift && !alt && !ctrl && key === 'l') {
    return { id: 'focusAddressBar' }
  }

  // Stage 26 PR 3 item 8 — ⌘⇧G "Go to folder" (Finder parity).
  // Flips the navigator breadcrumb into an editable input.
  if (meta && shift && !alt && !ctrl && key === 'g') {
    return { id: 'focusBreadcrumbEdit' }
  }

  // ENH-023 — ⌘F open find / focus existing find input.
  if (meta && !shift && !alt && !ctrl && key === 'f') {
    return { id: 'openFind' }
  }
  // ENH-023 — ⌘G next match. Works even when find bar is closed if
  // there's a previous query (matches Chrome / VS Code).
  if (meta && !shift && !alt && !ctrl && key === 'g') {
    return { id: 'findNext' }
  }
  // ENH-023 — ⌘⇧F previous match (avoids the ⌘⇧G conflict with
  // breadcrumb-edit Go to folder).
  if (meta && shift && !alt && !ctrl && key === 'f') {
    return { id: 'findPrev' }
  }

  // ⌘B — toggle the Files column. Yields to the local editor when
  // focus is on a contentEditable surface (⌘B = bold there).
  if (meta && !shift && !alt && !ctrl && key === 'b' && !ctx.inEditableSurface) {
    return { id: 'toggleFilesColumn' }
  }

  // Stage 15.3 — ⌘D fires Send → Duo on the active surface. Yields
  // to the local editor when focus is on a contentEditable surface
  // (⌘D in markdown editors / canvas iframes is "duplicate line" /
  // selection in some keymaps; we don't override). Outside editable
  // surfaces (browser pane, files navigator), ⌘D fires the chord.
  // Inside the markdown editor / canvas, the SendToDuoPill click
  // and the chord resolution at the surface level handle it
  // (each surface installs its own listener for duo-send-to-duo).
  if (meta && !shift && !alt && !ctrl && key === 'd') {
    return { id: 'sendToDuo' }
  }

  // ⌘` — cycle pane focus.
  if (meta && !shift && !alt && !ctrl && e.key === '`') {
    return { id: 'togglePaneFocus' }
  }

  // ⌘= / ⌘+ / ⌘- / ⌘0 — terminal font bump.
  if (meta && !shift && !alt && !ctrl && (key === '=' || e.key === '+')) {
    return { id: 'fontBumpUp' }
  }
  if (meta && !shift && !alt && !ctrl && key === '-') {
    return { id: 'fontBumpDown' }
  }
  if (meta && !shift && !alt && !ctrl && key === '0') {
    return { id: 'fontBumpReset' }
  }

  // ⌘⇧1–⌘⇧9 — jump to working-pane tab N.
  if (meta && shift && !alt && !ctrl && /^[1-9]$/.test(key)) {
    return { id: 'jumpWorkingTab', arg: parseInt(key, 10) }
  }

  // ⌘1–⌘9 — jump to terminal tab N.
  if (meta && !shift && !alt && !ctrl && /^[1-9]$/.test(key)) {
    return { id: 'jumpTerminalTab', arg: parseInt(key, 10) }
  }

  // ⌘⇧[ / ⌘⇧] — previous / next terminal tab.
  if (meta && shift && !alt && !ctrl && e.key === '[') {
    return { id: 'prevTerminalTab' }
  }
  if (meta && shift && !alt && !ctrl && e.key === ']') {
    return { id: 'nextTerminalTab' }
  }

  // Sprint 3 Phase 3b — ⌘⇧\ promotes aux back to main (closes the
  // split AND keeps the file open). Specific combo before generic
  // ⌘\ below, per "first match wins" ordering rule. For pure-close
  // (discard the split entirely without promoting), the aux header's
  // ✕ button is the affordance.
  // BUG-075 (v0.6.5) — must use `e.code === 'Backslash'`, not
  // `e.key === '\\'`. On US keyboards, Shift+\ produces `e.key === '|'`
  // (the shifted character), so the original `e.key === '\\'` check
  // could NEVER match when shift was held — chord was silently dropped.
  // `e.code` is the physical-key API and is modifier-independent.
  if (meta && shift && !alt && !ctrl && e.code === 'Backslash') {
    return { id: 'splitViewPromote' }
  }
  // Sprint 3 Phase 3b — ⌘\ moves the active main tab into the aux
  // slot, or no-ops if the active tab is already in aux. Routed
  // through App.tsx's splitViewOpen IPC; same destination the CLI
  // verb `duo split-view open <path>` uses.
  if (meta && !shift && !alt && !ctrl && e.code === 'Backslash') {
    return { id: 'splitViewToggle' }
  }

  return null
}

/**
 * Detect whether `activeElement` is inside a contentEditable surface.
 * Works in both the parent document and iframe documents (caller
 * passes the document to inspect).
 */
export function isInEditableSurface(doc: Document): boolean {
  const active = doc.activeElement as HTMLElement | null
  if (!active) return false
  if (active.isContentEditable) return true
  return active.closest('[contenteditable="true"]') !== null
}
