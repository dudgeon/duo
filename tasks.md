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
