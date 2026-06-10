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
  /** ENH-179 (Sprint 20 / v0.7.7) — true when focus is in any
   *  text-accepting host (contentEditable OR `<input>` OR
   *  `<textarea>`). Used to gate ⌘Z reopen-last-closed-tab so text
   *  undo wins inside dialogs, address bars, breadcrumb edit, etc.
   *  Browser-pane forwarder always sets this to `true` for safety
   *  (the WCV's own undo wins on the browser side). Optional for
   *  back-compat: callers that omit this default to "no info"
   *  (falsy → matcher treats it as `!inAnyTextInput`, so older
   *  shortcuts behave unchanged). */
  inAnyTextInput?: boolean
}

/** A typed registry of every global shortcut. Adding a row gives every
 *  surface that consults the matcher coverage of the new shortcut for
 *  free. */
export type ShortcutId =
  | 'newBrowserTab'
  | 'newMarkdownFile'
  | 'newFolder'
  | 'newClaudeTab'
  | 'closeTab'
  // FOLLOWUP-025 — File → Clone… modal trigger. ⌘⇧K binds it from
  // the renderer; the native File menu's "Clone…" entry also dispatches
  // the same modal-open. Pure-UI complement to ENH-151's CLI.
  | 'openCloneModal'
  | 'focusAddressBar'
  | 'focusBreadcrumbEdit'
  | 'openFind'
  | 'findNext'
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
  // Sprint 6 BUG-081 — ⌘⌥M opens the comment composer on the active
  // editor surface (canvas first; markdown side lands in Phase 4 /
  // MISSING-001). Google Docs parity. Dispatches 'duo-start-comment'
  // CustomEvent — same indirection as sendToDuo so the global hook
  // stays free of surface-specific state.
  | 'startComment'
  // BUG-138 Phase 4 — ⌘⌥T toggles Suggesting mode on the active
  // markdown editor (typing wraps as track-changes). Dispatches
  // 'duo-toggle-suggesting' CustomEvent so the global hook stays
  // surface-agnostic; only the active markdown editor responds.
  | 'toggleSuggesting'
  // Sprint 6 BUG-084 — ⌘R reloads the active BROWSER tab (Chrome
  // parity). Gated to browser tabs in dispatch — does NOT reload
  // markdown editor / canvas / terminal panes (no "reload" concept
  // makes sense there). Replaced the prior Electron-default ⌘R
  // behavior of reloading the entire app + killing all sessions.
  | 'reloadBrowserTab'
  // ENH-117 — ⌘⌥V opens a read-only "view source" overlay on the
  // active editor (markdown source) or canvas (pretty-printed
  // HTML). Both surfaces listen for the dispatched
  // 'duo-view-source' CustomEvent; only the active one responds
  // (gated on isActive). View-source convention from browsers /
  // many editors.
  | 'viewSource'
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
  // ENH-080 — ⌘⇧A opens the tab-search palette (fuzzy search across
  // all open file tabs + browser tabs in the working strip). Renderer
  // overlay, not a native window. Esc dismisses; arrows + Enter pick.
  | 'openTabSearchPalette'
  // ENH-098 (Sprint 9) — pane-jump chord set. ⌘⇧L jumps focus to the
  // terminal pane (whichever terminal tab is active), ⌘⇧; jumps to
  // the main working pane (whichever main-strip tab is active), ⌘⇧'
  // jumps to the split-view aux pane (no-op when split view is
  // closed). Distinct from `togglePaneFocus` (⌘`) which CYCLES — the
  // jump chords go DIRECTLY to a named pane.
  //
  // Walk-1 chord re-pick (Sprint 9 walk-1, 2026-05-07): originally
  // ⌘⌥L/;/' but the owner's window manager intercepts the meta+alt
  // combos at the system level, so the chord never reached the
  // renderer. Re-picked to meta+shift form. Uses `e.code` (KeyL /
  // Semicolon / Quote) regardless because Shift modifies the produced
  // character on US layouts (Shift+L = 'L', Shift+; = ':',
  // Shift+' = '"') — `e.code`-based matching is layout-independent.
  | 'focusTerminalPane'
  | 'focusMainPane'
  | 'focusAuxPane'
  // ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active working-pane file
  // (move-to-trash with confirm). Matches Finder-style destructive
  // muscle memory. Working-pane file tabs only — browser tabs and
  // terminal tabs are out of scope (closing them isn't deletion;
  // ⌘W already exists for tab close). Fires inside editable
  // surfaces too — file deletion is a higher-level intent than
  // line-edit, and TipTap's default ⌘⇧⌫ behavior (delete to start
  // of line) yields to it.
  | 'deleteCurrentFile'
  // Sprint 11 ENH-096 B.4 — ⌘O opens the VaultQuickSwitcher overlay
  // (fuzzy search across all files in the active vault root).
  // Distinct from ⌘⇧A (TabSearchPalette / open-tabs only). When the
  // active file isn't inside a vault, the overlay still opens but
  // shows a "no vault detected" empty state.
  | 'vaultQuickSwitcher'
  // ENH-159b — ⌘⇧C toggles browser-pane element-inspect mode
  // (Chrome devtools parity). Hover an element to outline; click to
  // ship its snapshot (tag + selector + heading trail + innerText
  // + key attrs) to the active terminal. ESC exits without picking.
  // CLI parity: `duo inspect [--on|--off]`.
  | 'toggleInspectMode'
  // ENH-172 (Sprint 20 / v0.7.7) — ⌘⇧. toggles the navigator's
  // showDotfiles flag (Finder / VS Code convention). The same View
  // menu accelerator owns the chord at the app-menu level, so this
  // matcher is a backup for cases where the menu accelerator isn't
  // reached (e.g. WebContentsView focus). Uses `e.code === 'Period'`
  // — Shift+. produces '>' as e.key on US layouts, so the layout-
  // dependent path would miss it (same gotcha as ⌘⇧A `KeyA`).
  | 'toggleHiddenFiles'
  // ENH-179 (Sprint 20 / v0.7.7) — ⌘Z reopen the most recently closed
  // tab (file / browser / terminal). Gated on `inAnyTextInput` so
  // text undo wins inside contentEditables, `<input>`/`<textarea>`,
  // dialogs, address bar, breadcrumb edit, browser-pane focus.
  // Owner ask: "cmd+z reopens recently closed tab if tab".
  | 'reopenLastClosedTab'
  // ENH-208 Phase 2 (D11) — ⌘⇧N captures an untyped inbox note into
  // the UI-resolved vault (default vault first, else the active
  // file's vault). Dispatches the 'duo-vault-capture' CustomEvent;
  // App.tsx owns the IPC call + opening the created note. Owner
  // re-pick 2026-06-10: this chord was New Folder (ENH-169), which
  // moved to ⌥⇧⌘N.
  | 'vaultQuickCapture'
  // ENH-208 Phase 2 (D22) — ⌘⇧F opens the vault-search palette
  // (full-text search over the vault, hits grouped by file; Enter
  // opens the hit and jumps the editor to the match). Took the chord
  // over from the global findPrev registration (removed) — the find
  // bar's input-local ⌘⇧F handler (FindBar.tsx) still owns
  // find-previous while the bar is focused.
  | 'openVaultSearchPalette'

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

  // ENH-169 (Sprint 20) — ⌥⇧⌘N: new folder in the navigator's current
  // cwd. Mirrors macOS Finder. Owner ask: "new file menu actions for
  // new file, new folder (inherits navigator focus as default
  // location)" — the chord parity for the File menu items.
  // ENH-208 owner re-pick (2026-06-10): moved from ⌘⇧N to ⌥⇧⌘N so
  // vault quick-capture could take the more reachable chord. Use
  // `e.code === 'KeyN'` because Option mangles the produced character
  // on macOS (same gotcha as the ⌘⌥M / ⌘⇧A code-vs-key lessons).
  if (meta && shift && alt && !ctrl && e.code === 'KeyN') {
    return { id: 'newFolder' }
  }

  // ENH-208 Phase 2 (D11) — ⌘⇧N captures an untyped note into the
  // UI-resolved vault's inbox (default vault first, else the active
  // file's vault — main owns the resolution). Chord freed by the
  // ENH-169 newFolder move above. `e.code === 'KeyN'` for
  // layout-safety (same as ⌘⇧A's KeyA).
  if (meta && shift && !alt && !ctrl && e.code === 'KeyN') {
    return { id: 'vaultQuickCapture' }
  }

  // ⌘W — close tab.
  if (meta && !shift && !alt && !ctrl && key === 'w') {
    return { id: 'closeTab' }
  }

  // ENH-179 (Sprint 20 / v0.7.7) — ⌘Z reopen the most recently closed
  // tab (file / browser / terminal). Yields to text undo whenever
  // focus is in a text-input surface (contentEditable, `<input>`,
  // `<textarea>`) — see FocusContext.inAnyTextInput. ⌘⇧T isn't free
  // (it spawns a new Claude tab — newClaudeTab above), so ⌘Z is the
  // owner-picked chord with smart routing.
  if (meta && !shift && !alt && !ctrl && key === 'z' && !ctx.inAnyTextInput) {
    return { id: 'reopenLastClosedTab' }
  }

  // ⌘L — focus address bar (Chrome parity).
  if (meta && !shift && !alt && !ctrl && key === 'l') {
    return { id: 'focusAddressBar' }
  }

  // FOLLOWUP-025 — ⌘⇧K: File → Clone… modal.
  if (meta && shift && !alt && !ctrl && key === 'k') {
    return { id: 'openCloneModal' }
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
  // ENH-208 Phase 2 (D22) — ⌘⇧F opens the vault-search palette.
  // Took the chord over from the global findPrev registration
  // (ENH-023, removed): find-previous stays reachable via the find
  // bar's input-local ⌘⇧F handler (FindBar.tsx), which
  // stopPropagation()s before this matcher can see the keystroke —
  // so the two never collide while the bar is focused. Use
  // `e.code === 'KeyF'` for layout-safety (same as ⌘⇧A's KeyA).
  if (meta && shift && !alt && !ctrl && e.code === 'KeyF') {
    return { id: 'openVaultSearchPalette' }
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

  // Sprint 6 BUG-081 — ⌘⌥M opens the comment composer on the active
  // editing surface. Google Docs parity. Fires inside editable
  // surfaces too — comments REQUIRE a selection in an editable
  // surface, so yielding to the editor would defeat the purpose.
  // No native conflict: ⌘⌥M is "Minimize All" in macOS's standard
  // Window menu, but Duo's app menu doesn't include that item, so
  // the chord reaches the renderer.
  //
  // Use `e.code === 'KeyM'` rather than `e.key === 'm'` because Option
  // on macOS modifies the produced character — Option+M yields 'µ'
  // (the micro symbol), not 'm'. Same root cause as BUG-075 v2 hit
  // for the splitView shortcuts (Slash vs '?').
  if (meta && alt && !shift && !ctrl && e.code === 'KeyM') {
    return { id: 'startComment' }
  }

  // BUG-138 Phase 4 — ⌘⌥T toggles Suggesting mode on the active
  // markdown editor. Use `e.code === 'KeyT'` (Option modifies the
  // produced character on macOS — same gotcha class as ⌘⌥M / ⌘⌥V).
  // No native ⌘⌥T conflict on macOS by default.
  if (meta && alt && !shift && !ctrl && e.code === 'KeyT') {
    return { id: 'toggleSuggesting' }
  }

  // Sprint 6 BUG-084 — ⌘R reloads the active BROWSER tab (Chrome
  // parity). Without this matcher, ⌘R either did nothing (after the
  // menu-role removal) or — worse, before the fix — reloaded the
  // entire app and killed every terminal session. Now: matched
  // unconditionally; dispatch decides whether to fire based on the
  // active working tab. If the user is on a browser tab, reload it.
  // Otherwise no-op (we explicitly do NOT reload editor / canvas
  // tabs — those represent unsaved local file state). Always claim
  // the keystroke so any Chromium fallback also gets consumed.
  if (meta && !shift && !alt && !ctrl && key === 'r') {
    return { id: 'reloadBrowserTab' }
  }

  // ENH-117 — ⌘⌥V opens the read-only "view source" overlay on the
  // active editor or canvas. Use `e.code === 'KeyV'` (not e.key === 'v')
  // because Option on macOS modifies the produced character — ⌘⌥V
  // would yield '√' as e.key on some layouts. Same gotcha class as
  // the existing ⌘⌥M comment chord.
  if (meta && alt && !shift && !ctrl && e.code === 'KeyV') {
    return { id: 'viewSource' }
  }

  // ENH-080 — ⌘⇧A opens the tab-search palette. Fuzzy search across
  // all working-pane tabs (file tabs + browser tabs). VS Code / Slack
  // muscle memory — `⌘⇧A` is the quick-action palette in both. Use
  // `e.code === 'KeyA'` to defend against keyboard layouts where
  // shift+A might produce something other than 'a' (same gotcha as
  // the other Option-affected chords above).
  if (meta && shift && !alt && !ctrl && e.code === 'KeyA') {
    return { id: 'openTabSearchPalette' }
  }

  // ENH-098 (Sprint 9 walk-1 re-pick) — pane-jump chords. ⌘⇧L/;/'
  // jump focus to terminal/main/aux respectively. Always use
  // `e.code` (not e.key) because Shift modifies the produced
  // character on US layouts (Shift+L = 'L', Shift+; = ':',
  // Shift+' = '"'). Originally ⌘⌥L/;/' but owner's system-level
  // window manager intercepts meta+alt combos before they reach
  // the renderer.
  if (meta && shift && !alt && !ctrl && e.code === 'KeyL') {
    return { id: 'focusTerminalPane' }
  }
  if (meta && shift && !alt && !ctrl && e.code === 'Semicolon') {
    return { id: 'focusMainPane' }
  }
  if (meta && shift && !alt && !ctrl && e.code === 'Quote') {
    return { id: 'focusAuxPane' }
  }

  // ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active working-pane file
  // (move-to-trash with confirm). `e.code === 'Backspace'` is
  // unambiguous — Backspace and Delete have distinct codes on Mac
  // keyboards (Backspace is the main-cluster key; Delete is the
  // forward-delete key on extended keyboards). The chord targets
  // the main Backspace.
  if (meta && shift && !alt && !ctrl && e.code === 'Backspace') {
    return { id: 'deleteCurrentFile' }
  }

  // Sprint 11 ENH-096 B.4 — ⌘O opens the VaultQuickSwitcher overlay.
  // `e.code === 'KeyO'` is layout-independent (matches the physical
  // O key regardless of whether the user is on QWERTY/Dvorak/etc.).
  // No shift/alt/ctrl modifiers — bare ⌘O. macOS apps usually bind
  // ⌘O to "open file dialog"; we override because Duo's vault model
  // makes the quick switcher a more useful destination, and File →
  // Open already lives in the menu under ⌘⇧O if the system Open is
  // ever wanted (FOLLOWUP if owner objects).
  if (meta && !shift && !alt && !ctrl && e.code === 'KeyO') {
    return { id: 'vaultQuickSwitcher' }
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

  // Sprint 3 Phase 3b — ⌘/ opens / moves into Split View; ⌘⇧/
  // promotes aux back to main (closes the split AND keeps the file
  // open). Specific combo before generic, per "first match wins."
  // For pure-close (discard the split entirely without promoting),
  // the aux header's ✕ button is the affordance.
  //
  // BUG-075 (v0.6.5) — chord re-pick. Originally ⌘\ / ⌘⇧\ but those
  // conflict with 1Password's system-level Cmd+\ autofill grab on
  // most macOS users' machines (1P intercepts before Chromium / Duo
  // ever sees the keystroke). ⌘/ + ⌘⇧/ chosen as the replacement —
  // free in Duo's registry, no system-level conflict, and ⌘? (the
  // shifted form) is only an issue if Duo's app menu has a Help
  // item (it doesn't in v0.6.5). Uses `e.code === 'Slash'` for the
  // same reason BUG-075 v1 needed Backslash: the shifted form
  // produces a different `e.key` ('?') so e.key checks would have
  // missed the shift case.
  if (meta && shift && !alt && !ctrl && e.code === 'Slash') {
    return { id: 'splitViewPromote' }
  }
  if (meta && !shift && !alt && !ctrl && e.code === 'Slash') {
    return { id: 'splitViewToggle' }
  }

  // ENH-159b — ⌘⇧C toggles browser-pane element-inspect mode (Chrome
  // devtools' Inspect Element chord). Uses `e.code === 'KeyC'`
  // because the matched character can drift between layouts (shift+c
  // is still 'C' on US but other layouts vary). The browser-pane's
  // before-input-event forwarder is gated on the same Shift+KeyC
  // combo so the chord reaches the renderer even when WCV has focus.
  if (meta && shift && !alt && !ctrl && e.code === 'KeyC') {
    return { id: 'toggleInspectMode' }
  }

  // ENH-172 (Sprint 20 / v0.7.7) — ⌘⇧. toggles show/hide hidden
  // files in the navigator (Finder / VS Code convention). Uses
  // `e.code === 'Period'` for layout-safety — Shift+. produces '>'
  // as e.key on US layouts. Note the View menu also binds this
  // accelerator at the app-menu level (electron/main.ts), so most
  // keystrokes are intercepted there before reaching this matcher;
  // this is the backup for cases where the menu doesn't see the
  // chord (WebContentsView focus paths, future renderer-only
  // dispatch paths).
  if (meta && shift && !alt && !ctrl && e.code === 'Period') {
    return { id: 'toggleHiddenFiles' }
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

/**
 * ENH-179 — superset of `isInEditableSurface` that ALSO returns true
 * when focus is in an `<input>` or `<textarea>`. Used to gate ⌘Z
 * reopen-last-closed-tab so text-undo wins in dialogs, address bars,
 * breadcrumb edit, and any other plain text-input surface.
 */
export function isInAnyTextInput(doc: Document): boolean {
  if (isInEditableSurface(doc)) return true
  const active = doc.activeElement as HTMLElement | null
  if (!active) return false
  const tag = active.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return false
}
