# Duo — Bug & Task Backlog

## Bugs

### BUG-001: ⌃Tab does not cycle terminal tabs when focus is on terminal

**Status:** Open  
**Priority:** Medium  
**Filed:** 2026-04-25

**Repro:**
1. Open two or more terminal tabs.
2. Click into a terminal tab so focus is on the terminal.
3. Press ⌃Tab.

**Expected:** Cycle forward through terminal tabs (same behaviour as ⌘⇧]).  
**Actual:** Cycles browser (working-pane) tabs instead — identical to pressing ⌃Tab with browser focus.

**Root cause (traced):**  
`renderer/hooks/useKeyboardShortcuts.ts` lines 168–180 handle `⌃Tab / ⌃⇧Tab` unconditionally — the handler always calls `window.electron.browser.getTabs()` and `switchTab()` regardless of which pane is active.  
The hook does not receive a `paneFocus` / `activeFocus` signal, so it cannot branch on terminal vs. browser focus.

**Fix sketch:**  
- Pass the current pane focus state (terminal / browser / editor) into `useKeyboardShortcuts` as a new option (e.g. `activePaneFocus: 'terminal' | 'browser' | 'editor'`).
- In the `⌃Tab` branch: if focus is `'terminal'`, cycle terminal tabs (same logic as ⌘⇧]); otherwise cycle browser tabs as today.
- Applies symmetrically to `⌃⇧Tab` (reverse direction).

**Affected files:**  
- `renderer/hooks/useKeyboardShortcuts.ts` (primary fix)  
- `renderer/App.tsx` (pass focus state as new prop)
