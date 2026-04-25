# Duo — Bug & Task Backlog

## Bugs

### BUG-001: ⌃Tab does not cycle terminal tabs when focus is on terminal

**Status:** ✅ Fixed 2026-04-26 (commit pending)
**Priority:** Medium
**Filed:** 2026-04-25

**Repro:**
1. Open two or more terminal tabs.
2. Click into a terminal tab so focus is on the terminal.
3. Press ⌃Tab.

**Expected:** Cycle forward through terminal tabs (same behaviour as ⌘⇧]).
**Actual (pre-fix):** Cycles browser (working-pane) tabs instead — identical to pressing ⌃Tab with browser focus.

**Root cause (traced):**
`renderer/hooks/useKeyboardShortcuts.ts` lines 168–180 handle `⌃Tab / ⌃⇧Tab` unconditionally — the handler always calls `window.electron.browser.getTabs()` and `switchTab()` regardless of which pane is active.
The hook does not receive a `paneFocus` / `activeFocus` signal, so it cannot branch on terminal vs. browser focus.

**Fix shipped 2026-04-26 (three parts — original sketch needed two more):**
1. Plumb pane focus into the hook. `useKeyboardShortcuts` now takes
   `activePaneFocus: 'files' | 'terminal' | 'working'`; the `⌃Tab`
   branch cycles terminal tabs when it's `'terminal'`, browser tabs
   otherwise. App.tsx passes `focusedColumn` through. *(Original
   fix sketch.)*
2. Stop xterm from eating the keystroke. By default xterm.js consumes
   `Ctrl+Tab` as PTY input, so without an `attachCustomKeyEventHandler`
   that returns `false` for it, the keystroke never reaches the
   window-level `keydown` listener. Added in
   `renderer/components/TerminalPane.tsx` after `term.open(host)`.
3. Override pane source for browser-forwarded keystrokes. When the
   browser WebContentsView has focus, clicks into the browser content
   don't bubble to the terminal/working-column wrappers, so
   `focusedColumn` stays stuck at its last value. The fix passes
   `'working'` as a `paneOverride` argument to `process()` from the
   `onBrowserKey` path — the browser pane having keyboard focus is
   the proximate cause of the forward, regardless of cached state.

**Verified end-to-end in live app:**
- ⌃Tab from xterm focus → cycles terminal tabs forward ✓
- ⌃⇧Tab from xterm focus → cycles terminal tabs reverse ✓
- ⌃Tab from browser focus → cycles browser tabs forward ✓
- ⌃⇧Tab from browser focus → cycles browser tabs reverse ✓
- No cross-pane regression (terminal tabs unchanged when cycling browser, vice versa) ✓

**Affected files:**
- `renderer/hooks/useKeyboardShortcuts.ts` (pane-aware branch + paneOverride)
- `renderer/App.tsx` (pass `focusedColumn` as `activePaneFocus`)
- `renderer/components/TerminalPane.tsx` (xterm `attachCustomKeyEventHandler`)

---

### BUG-002: ⌘T from browser focus doesn't focus address bar (regression)

**Status:** Open
**Priority:** Medium
**Filed:** 2026-04-26 (during Stage 12 verification)

**Repro:**
1. Click into the browser pane (any tab) so it has keyboard focus.
2. Press ⌘T.

**Expected:** New browser tab opens AND the address bar receives keyboard focus + selects its placeholder so the user can immediately type a URL.
**Actual:** New browser tab opens, but address bar is not focused — pressing keys does nothing until the user clicks the URL bar manually.

**Suspected cause:**
The newBrowserTab() handler in `renderer/App.tsx` does:
```
setActiveWorking({ kind: 'browser' })
setFocusedColumn('working')
void window.electron.browser.addTab().then(() => {
  queueMicrotask(() => {
    const addr = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
    addr?.focus()
    addr?.select()
  })
})
```

The address-bar query + focus is in a `queueMicrotask` after `addTab()` resolves. Likely the focus call IS firing, but Chromium's `WebContentsView.webContents.focus()` (called from `BrowserManager.openTab → switchTab → focusActive`) wins the focus race AFTER the queueMicrotask, parking focus on the WebContentsView body instead of the address bar.

**Fix sketch:**
- Either delay the address-bar focus to the next animation frame after the WebContentsView focus call settles, or
- Make `BrowserManager.openTab` skip the auto-focus for the new view (caller decides), and let the renderer focus the address bar instead.

**Affected files:**
- `renderer/App.tsx` (`newBrowserTab` callback in `useKeyboardShortcuts` opts)
- `electron/browser-manager.ts` (`openTab → switchTab → focusActive` chain)

---

### BUG-003: Pane focus indicator too subtle

**Status:** Open
**Priority:** Low
**Filed:** 2026-04-26 (raised during Stage 12 Phase 2 verification)

**Repro:**
1. Open Duo with multiple panes visible (Files, Terminal, Working).
2. Click into one pane.
3. Try to tell which pane currently has keyboard focus.

**Actual:** The accent border on the focused column (`border-accent/60`) is barely perceptible, especially against the new Atelier paper-deep / paper backgrounds. With the reduced palette contrast (no more dark surfaces), the 60%-alpha ochre rule is harder to spot than it was against `#080808`.

**Why it matters:** "Which pane is focused" governs all the pane-aware shortcuts (⌃Tab, ⌘⇧], ⌘+/-, future ⌘[ etc. — see Stage 20 follow-ups). If the user can't see which pane is focused, every pane-aware shortcut becomes guess-and-check.

**Fix candidates (decide at kickoff):**
- Bump the focus border to `border-accent` (full opacity) + 2px
- Add a subtle accent-soft tint to the focused pane's background
- Tag the focused pane with a small pill in the chrome ("focus: terminal")
- All of the above

**Affected files:**
- `renderer/App.tsx` (column wrappers — `border-accent/60` → ?)
- Possibly add a focus-indicator component if (3) is picked

---

### BUG-004: ⌘` (pane focus toggle) breaks subsequent keyboard input routing

**Status:** Open
**Priority:** Medium
**Filed:** 2026-04-26

**Repro:**
1. Click into the browser pane so it has focus.
2. Press ⌘` to cycle pane focus back to terminal.
3. Try to type into the terminal — keystrokes don't reach the PTY.
4. Press ⌘` again to cycle back to browser.
5. Try to scroll the page with arrow keys — they don't work.

**Suspected cause:**
The ⌘` accelerator (`PANE_TOGGLE_FOCUS` IPC) flips the renderer's `focusedColumn` state and (per `BrowserManager.focusActive`) calls `webContents.focus()` on the active browser view. But the actual DOM focus / Chromium-frame focus state isn't being synchronized with the React state change. Specifically:

- After ⌘`-from-browser-to-terminal: the WebContentsView still has the browser-frame focus from BrowserManager's earlier `focus()` call; the renderer's React state thinks the terminal is focused but the xterm element never gets `focus()`. PTY writes are gated on xterm's `onData` handler which only fires when xterm has DOM focus.
- After ⌘`-from-terminal-to-browser: similarly, xterm holds the focus from a previous click; the browser WebContentsView doesn't actually receive focus, so its key event handler doesn't fire, so ArrowUp/Down don't scroll.

**Fix sketch:**
The pane-toggle handler in App.tsx needs to actually call:
- `xterm.focus()` on the currently-active terminal tab when toggling INTO terminal
- `window.electron.browser.focusActive()` (already exists) when toggling INTO working pane that has a browser tab active
- editor `.focus()` when toggling INTO working pane that has an editor tab active

Currently `togglePaneFocus` only updates the React state; it doesn't move OS-level focus.

**Affected files:**
- `renderer/App.tsx` (`togglePaneFocus` and the `onPaneToggleFocus` IPC listener)
- `renderer/components/TerminalPane.tsx` (need an imperative `focusActive()` API on the terminal instance)
- `renderer/components/editor/MarkdownEditor.tsx` (similar — focus the editor element)

---

### PROCESS-001: Keyboard regression coverage gap

**Status:** Open · process / tooling
**Priority:** Medium
**Filed:** 2026-04-26 (raised by owner after BUG-002, BUG-004 surfaced)

**Problem:** We've shipped four keyboard regressions in the last week (BUG-001, BUG-002, BUG-004, plus the ⌘T-pane-aware-then-revert churn). Each was caught by manual smoke testing days after the change that introduced it. The pattern:

1. Touch a renderer file or `useKeyboardShortcuts`.
2. Forget there's an interaction with xterm key-eating, WebContentsView focus stealing, or `nativeTheme`-driven default flips.
3. Smoke-test the obvious case (the change itself), miss the cross-cutting regressions.
4. Owner finds it days later when daily-driving Duo.

**What's missing:**
- An automated keyboard matrix test (probably Playwright over Electron) that walks all the shortcuts × all the focus surfaces × both themes.
- A pre-merge / pre-commit check that fires when `useKeyboardShortcuts.ts`, `TerminalPane.tsx`, `BrowserManager.wireKeyForwarding`, or any pane-focus-related file changes.
- A keyboard-matrix table inline in the smoke checklist (`docs/dev/smoke-checklist.md § 5`) that gets updated with every new shortcut.

**Proposed scope (decide at kickoff):**
1. **Documentation-first:** flesh out `docs/dev/smoke-checklist.md § 5` into an explicit
   **shortcut × focus surface × theme** matrix that a human (or Claude) walks before
   declaring keyboard work done. Cheap; would have caught BUG-002, BUG-003, BUG-004.
2. **Automated:** write a Playwright + Electron test runner that drives the app via
   the existing CDP bridge and asserts focus + observable side effects for each
   matrix cell. Bigger lift; needs a one-time investment.

Recommend (1) before any more keyboard work; consider (2) after Stage 18 (first-launch
installer) when distribution-ready signals matter more.

**Affected files:**
- `docs/dev/smoke-checklist.md` (extend § 5 keyboard matrix)
- `tests/` (does not exist yet — would be a new directory)
- `package.json` (test script + Playwright dep if (2) lands)
