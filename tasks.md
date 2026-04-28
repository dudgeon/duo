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

**Status:** ✅ Fixed 2026-04-26
**Priority:** Medium
**Filed:** 2026-04-26 (during Stage 12 verification)

**Repro:**
1. Click into the browser pane (any tab) so it has keyboard focus.
2. Press ⌘T.

**Expected:** New browser tab opens AND the address bar receives keyboard focus + selects its placeholder so the user can immediately type a URL.
**Actual:** New browser tab opens, but address bar is not focused — pressing keys does nothing until the user clicks the URL bar manually.

**Root cause (traced):**
The original "WebContentsView.focusActive race" hypothesis was wrong —
`switchTab` doesn't call `focusActive`. The actual cause was simpler: when
the WebContentsView has OS-level keyboard focus, the BrowserWindow
renderer doesn't. A renderer-side `addr.focus()` call when the renderer
doesn't own OS focus is a no-op — you can't give focus you don't have.
The renderer would set DOM focus internally, but Chromium's child-frame
focus model meant typing kept going to the WebContentsView (or, in the
empty-page case, was dropped silently).

**Fix shipped 2026-04-26:**
In `electron/browser-manager.ts § wireKeyForwarding`, reclaim
OS-level focus to the main BrowserWindow's webContents synchronously
BEFORE forwarding ⌘T / ⌘N / ⌘L to the renderer (these three are the
shortcuts whose renderer-side handler then focuses a renderer DOM
element). By the time the renderer's `onBrowserKey` handler runs,
the renderer has OS focus to give to the address bar / filename input.
⌃Tab and ⌘1–9 / ⌘⇧1–9 / ⌘W / ⌘B / ⌘[ / ⌘] are intentionally
excluded — those keep focus on the browser surface (Chrome-parity).

**Verified end-to-end in live app:**
- Click into example.com page content (browser WebContentsView has OS focus).
- ⌘T → new about:blank tab opens, address bar has DOM focus + URL selected.
- Typing "testing" lands in the address bar, not in the page or anywhere else. ✓

**Affected files:**
- `electron/browser-manager.ts` (`wireKeyForwarding` — added the
  pre-forward `webContents.focus()` for ⌘T/⌘N/⌘L)

---

### BUG-003: Pane focus indicator too subtle

**Status:** ✅ Fixed 2026-04-26
**Priority:** Low
**Filed:** 2026-04-26 (raised during Stage 12 Phase 2 verification)

**Repro:**
1. Open Duo with multiple panes visible (Files, Terminal, Working).
2. Click into one pane.
3. Try to tell which pane currently has keyboard focus.

**Actual:** The accent border on the focused column (`border-accent/60`) is barely perceptible, especially against the new Atelier paper-deep / paper backgrounds. With the reduced palette contrast (no more dark surfaces), the 60%-alpha ochre rule is harder to spot than it was against `#080808`.

**Why it matters:** "Which pane is focused" governs all the pane-aware shortcuts (⌃Tab, ⌘⇧], ⌘+/-, future ⌘[ etc. — see Stage 20 follow-ups). If the user can't see which pane is focused, every pane-aware shortcut becomes guess-and-check.

**Fix v1 (failed) shipped 2026-04-26:**
First pass tried full-opacity accent on the seam border PLUS a 2px
inset-shadow ring on all four sides of the focused column wrapper.
Worked for Files (no occluding child) but failed for Terminal
(xterm canvas paints over the inset shadow) and Working (the
WebContentsView is a separate WebContents that paints ABOVE any
renderer DOM in its bounds — a renderer-side overlay literally
cannot reach above it). What was left for those two columns was
just the 1px seam border, which abuts the seam border of the
neighbouring column — visually a single line that doesn't say
which side owns the focus.

**Fix v2 shipped 2026-04-26 (revised same-day):**
Move the focus indicator into chrome that's always renderer DOM
and never occluded — the column's tab strip / breadcrumb header.
When a column has keyboard focus, its strip background tints to
`accent-soft` (warm cream-amber in light, deep amber in dark) and
the strip's bottom border flips to full-opacity accent. The seam
border on the column wrapper still flips to full-opacity accent as
a secondary cue. The dead inset-shadow code was removed.

The strip is the right surface for this: it's the chrome that
"belongs" to one column unambiguously (no shared edge with the
neighbour), it's always above the WebContentsView vertically, and
the focused-tab top stripe pattern Stage 12 Phase 3 just shipped
gives the user a precedent for "accent stripe on chrome means
emphasis."

**Verified end-to-end in live app:**
- Click into Files column → breadcrumb header tints to accent-soft,
  others stay paper. ✓
- Click into Terminal column → tab strip tints to accent-soft +
  full-accent border-bottom; the active tab still pops with paper bg
  + accent top stripe. ✓
- Click into Working pane → tab strip tints, address-bar row stays
  paper-deep. ✓
- Switching focus between columns: only one strip is tinted at any
  moment; unambiguous. ✓

**Affected files:**
- `renderer/components/TabBar.tsx` (terminal strip — `focused` prop)
- `renderer/components/WorkingTabStrip.tsx` (working strip — `focused` prop)
- `renderer/components/WorkingPane.tsx` (passes `focused` through)
- `renderer/components/FilesPane.tsx` (breadcrumb header — accent-soft tint)
- `renderer/App.tsx` (column wrappers — drop dead inset shadow, pass `focused` down)

---

### BUG-004: ⌘` (pane focus toggle) breaks subsequent keyboard input routing

**Status:** ✅ Fixed 2026-04-26
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

**Fix shipped 2026-04-26 (two parts):**

1. **Reclaim OS focus to the renderer in main process.** The ⌘`
   menu-accelerator click handler in `electron/main.ts` now calls
   `mainWindow.webContents.focus()` BEFORE sending
   `IPC.PANE_TOGGLE_FOCUS`. Synchronous in main → by the time the
   renderer's IPC listener runs, the renderer owns OS focus. Without
   this, when the WebContentsView had OS focus (typical when ⌘` is
   pressed from the browser pane), the renderer's
   `textarea.focus()` call was a no-op.

2. **Focus the contenteditable, not the wrapper.** The renderer-side
   `togglePaneFocus` in `renderer/App.tsx` already focused the visible
   xterm helper textarea (terminal direction) and called
   `browser.focusActive()` (browser direction). For editor file tabs
   it focused `[data-duo-workingpane]` — the wrapper has tabIndex={0}
   but isn't a typing target. Now it queries for the contenteditable
   prose inside the wrapper and focuses that, falling back to the
   wrapper for non-editor file types (image / pdf / unknown preview)
   so arrow keys can still scroll.

**Verified end-to-end in live app:**
- Click into example.com page (browser has OS focus).
- ⌘` → typing "echo bug004ok" landed in the terminal PTY. ✓
- ⌘` again → back to working pane; subsequent typing did NOT
  reach the terminal (focus moved to browser). ✓

**Affected files:**
- `electron/main.ts` (menu accelerator click handler — added `webContents.focus()`)
- `renderer/App.tsx` (`togglePaneFocus` — focus contenteditable for editor tabs)

---

### PROCESS-001: Keyboard regression coverage gap

**Status:** ✅ Phase 1 (documentation) shipped 2026-04-26 · Phase 2 (Playwright) deferred
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

**Phase 1 shipped 2026-04-26:** `docs/dev/smoke-checklist.md § 5`
expanded to an explicit shortcut × focus-surface matrix with three
sub-sections:
- 5.1 Pre-flight (which file changes warrant a full matrix walk)
- 5.2 Shortcut × focus-surface matrix (12 rows × 4 surfaces, plus
  per-row "did focus land on the right element" verification)
- 5.3 Theme dimension (focus indicator visibility, xterm cursor color,
  address-bar focus ring — verified in both light + dark)
- 5.4 Pane-toggle focus contract — verbatim BUG-004 reproduction
  walked as a regression check

**Phase 2 still open:** Playwright + Electron automation. Defer
until Stage 18 (first-launch installer) lands and distribution
signals matter more. The current docs-only matrix is sufficient for
the daily-driver phase as long as it's actually walked on every
keyboard-touching change.

**Affected files (Phase 1):**
- `docs/dev/smoke-checklist.md` (§ 5 expanded)

**Affected files (Phase 2 — deferred):**
- `tests/` (new directory)
- `package.json` (Playwright dep + test script)

---

## Bugs (open)

### BUG-005: `duo key End --modifiers cmd` triggers Electron About panel on macOS

**Status:** ✅ Fixed 2026-04-26 (v0.3.1)
**Priority:** Low
**Filed:** 2026-04-25

**Repro:**
1. Open any document in the editor (caret anywhere in body).
2. From an agent / CLI session: `duo key End --modifiers cmd`.

**Expected:** Caret moves to end of document — or, if not bound, a clean no-op.
**Actual:** Electron's default About panel ("Electron / Version 32.3.3") pops up over the app. Caret position unchanged.

**Suspected cause:** `Cmd+End` is a Windows/Linux shortcut; on macOS the equivalent for "caret to end of document" is `Cmd+Down` (or `Fn+Right`). Cmd+End isn't bound to a navigation action in the editor and appears to fall through to Electron's default application-menu handling, which surfaces the About panel.

**Why it matters:** Agents driving `duo key` from cross-platform habits will reach for Cmd+End/Home/PageUp/PageDown. On macOS those are at best no-ops and at worst (as here) trigger unrelated UI. The user-visible effect — a modal popping up mid-task — looks like the agent did something wrong.

**Suggested fix paths (any/all):**
- `cli/duo.ts § duo key`: when `--modifiers cmd` is passed with a non-Mac-native navigation key (End / Home / PageUp / PageDown), translate to the Mac equivalent or reject with a clear error.
- `renderer/components/editor/MarkdownEditor.tsx`: bind `Cmd+Down` / `Cmd+Up` for caret-to-end / caret-to-start so agents have a working primitive on the Mac-native shortcut.
- `skill/SKILL.md` + `agents/duo-browser.md`: recommend Mac-native key combos for caret navigation; flag the Cmd+End/Home/PageUp/PageDown trap.

**Class of issue:** agent-facing CLI ergonomics — `duo key` accepts cross-platform key names and modifiers but doesn't normalize for the host OS, so a chunk of muscle-memory shortcuts misfire silently or noisily. Worth a sweep, not just the one-off.

**Discovered:** 2026-04-25 in an agent session that ran `duo key End --modifiers cmd` before a `doc write` insert. The append still worked (caret was already parked at end-of-paragraph) but the About modal was visibly disruptive to the user.

---

### BUG-006: Send → Duo pill on the browser pane doesn't render visibly

**Status:** 🆕 Filed
**Priority:** Medium (Stage 15.2 ships the data plane; visual chrome is the UX gate)
**Filed:** 2026-04-26 late-evening, after Stage 15.2 ship

**Repro:**
1. In Duo's browser pane, navigate to any page (e.g. `duo open https://example.com`).
2. Drag-select some text on the page.
3. **Expected:** small purple "Send → Duo ↗" pill appears anchored above (or below) the selection, just like in the markdown editor.
4. **Actual:** no pill appears; the data plane is correct (`duo selection --pane browser` returns the selection; the CDP `Runtime.bindingCalled` event fires and the cache populates per the Stage 15.2 verification), but the chip is invisible.

**Suspected cause: WebContentsView is OS-level, above the renderer DOM in the macOS compositor.** The pill is portaled to `document.body` with `position: fixed; z-index: 50`, but z-index is irrelevant when the WebContentsView is a native subview. Anything in the renderer's DOM is *behind* the WebContentsView wherever its bounds extend.

The current pill-placement logic does try to land *above* the selection (and falls back below). But:
- "Above" the selection's screen rect = `hostRect.top + pageRect.y - pillSize.height - 6`. For most selections this lands INSIDE the WebContentsView area (under it from the compositor's POV) → invisible.
- "Below" similarly lands inside or below the WebContentsView area → invisible-or-clipped.

The pill is only visible when the placement happens to fall in the address-bar strip ABOVE `hostRect.top` — which only occurs when the selection is near the top of the page AND the pill's `placeAbove` branch fires.

**Suggested fix paths:**
- **(a) Hoist the pill outside the WebContentsView's screen real estate.** Always anchor the pill in the chrome strip just above the WebContentsView (next to the address bar). Loses the "next to the selection" affordance but is the simplest fix that's compositor-safe.
- **(b) Inject the pill INTO the page itself via CDP.** Render an absolutely-positioned `<button>` inside the page DOM via the existing observer IIFE. Compositor-safe by construction. Click handler posts back via the binding to trigger `pty.write`. More wiring; keeps the "next to the selection" affordance.
- **(c) Move the WebContentsView to `BrowserView` mode where the renderer can overlay** — research whether Electron supports this for Chromium 122+. Would also fix the file-tab focus-ring occlusion (BUG-003 v1's original failure mode). Heavier lift.

Option (b) is closest to the design intent but adds CSS injection + event-routing complexity. Option (a) is the cheapest correct answer; option (c) is a future investment.

**Why it matters:** Stage 15.2's data plane is correct, but the user-facing primitive is invisible on the browser surface — the editor pill works, the browser pill doesn't, which violates the "one primitive, three modalities" promise that justifies the editor-agnostic contract.

**Discovered:** 2026-04-26 late-evening, immediately after Stage 15.2 shipped. Owner observed the gap during the next-stage review.

---

### BUG-007: Deleted files linger in the navigator until full reload

**Status:** ✅ Fix v1 shipped v0.3.1 (chokidar subscription wired) · ✅ Hardening shipped v0.5.1 (refresh on watcher (re)subscribe + clear stale selection on remove) — see "Update 2026-04-28" below
**Priority:** Medium
**Filed:** 2026-04-26 (during Navigator polish backlog scoping)

**Repro:**
1. Open Duo so the file navigator is showing a folder you can write to.
2. From any source (Duo's terminal, an external terminal, Finder, an agent's `rm`, an external `mv`): delete a file currently visible in the navigator.
3. Look at the navigator.

**Expected:** the row disappears within a frame or two of the disk-level removal.
**Actual:** the row remains. Clicking it surfaces an error (file not found) or, worse, the navigator behaves as if the file is still there. A full reload restores correctness.

**Suspected cause:** the navigator data path either (a) doesn't subscribe to chokidar's `unlink` event (only `add` / `change`), or (b) subscribes but the tree-mutation reducer ignores the event. The watcher is already running for `add` (typing a new file in another terminal updates the tree), so the surface is wired — only the unlink branch is missing or broken.

**Suggested fix paths:**
- **(a)** Audit the chokidar `.on(...)` chain in `electron/files-service.ts` (or wherever the navigator's watcher lives) for `unlink` + `unlinkDir` handlers that reach the same tree-mutation path as `add` / `addDir`.
- **(b)** If the events fire but don't propagate to the renderer, check the IPC channel that pushes nav-state to the renderer; the renderer-side reducer needs to remove the entry from its parent's children list (and prune empty parents if the navigator does that).

**Class of issue:** stale-state regression in the navigator data path. Worth a sweep on rename / move while we're in there — the same chokidar branch is likely dropping `unlinkDir` → `addDir` rename pairs, which would silently break the rename action being scoped in [item 6 of the Navigator polish backlog](docs/roadmap.html#backlog-nav-polish).

**Cross-ref:** Bundled into the [Navigator polish & ergonomics pass](docs/roadmap.html#backlog-nav-polish) backlog item — listed there as item 5 of 7. Fix lands here in `tasks.md`; backlog scoping lives in the roadmap.

**Discovered:** 2026-04-26, during the user's review of the file navigator surface. Surfaced as part of the Navigator polish bundle (item 5).

**Update 2026-04-28 (v0.5.1 hardening):** v0.3.1's chokidar subscription was correct, but the bug recurred under a race: when the user expanded a folder mid-delete (or navigated to a new cwd while a delete was firing), the watcher tear-down + re-subscribe gap could drop the unlink event. Hardening in `renderer/hooks/useNavigator.ts`:
1. After the watcher attaches, refresh every visible folder's listing once — catches events that fired during the sub-resub window.
2. On `removed` events, clear `selected` if it pointed to the deleted path — so a vanishing row doesn't leave a stale highlight.

**Affected files (v0.5.1):** `renderer/hooks/useNavigator.ts`.

---

### BUG-008: ⌘T from terminal focus doesn't open a new browser tab

**Status:** ✅ Fix shipped 2026-04-26 (commit pending v0.2.0)
**Priority:** Medium
**Filed:** 2026-04-26

**Repro:**
1. Click into a terminal tab so focus is on the terminal.
2. Press ⌘T.

**Expected:** New browser tab opens and the address bar receives focus (same behaviour as ⌘T from browser focus, post BUG-002 fix). ⌘T is a global Duo shortcut, not pane-scoped — terminal focus shouldn't suppress it.
**Actual:** Nothing happens — keystroke is swallowed (likely by xterm's PTY input path) and no browser tab opens.

**Likely cause (untraced):**
Mirror of BUG-001 part 2. xterm.js consumes ⌘T as PTY input by default; without an `attachCustomKeyEventHandler` branch returning `false` for ⌘T (and any other globally-routed app shortcuts), the keystroke never reaches the window-level `keydown` listener that would otherwise fire the new-tab handler. The BUG-001 fix added that handler for ⌃Tab / ⌃⇧Tab specifically — ⌘T was not in scope.

**Suggested fix:**
Extend the xterm `attachCustomKeyEventHandler` allowlist in `renderer/components/TerminalPane.tsx` to also let ⌘T (and ⌘N / ⌘L while in there — anything that's a Duo-global shortcut, not a terminal action) bubble to the window. Then verify the existing renderer-side ⌘T handler fires and that `wireKeyForwarding`'s pre-forward `webContents.focus()` from BUG-002 still gives the address bar OS focus when the source pane is the terminal (it should — the renderer owns OS focus when terminal has focus, so no reclaim is needed in this path).

**Class of issue:** xterm-eats-shortcut regression (same family as BUG-001). Sweep done 2026-04-26 — see Fix shipped below.

**Spec resolution (2026-04-26 evening):** The conflict between BUG-008's "Expected" (browser tab) and Stage 19c's pane-aware spec (claude tab from terminal focus) was resolved in favor of **Chrome-parity ⌘T everywhere = new browser tab**. Stage 19c's pane-aware ⌘T was flipped. Claude-tab spawning moves to ⌘⇧T (replacing 19c's "vanilla shell tab" assignment); vanilla shell only via the `>` half of the split-button on the terminal strip. Rationale: universal browser-style mental model wins over pane-aware discovery — the discovery affordance lives on the strip's `+` button instead.

**Fix shipped (2026-04-26 — commit pending v0.2.0):**

1. **`renderer/hooks/useKeyboardShortcuts.ts`** — `⌘T` always → `newBrowserTab()` regardless of pane focus. `⌘⇧T` → `newClaudeTab()` (replaces vanilla shell).
2. **`renderer/components/TerminalPane.tsx`** — extended the xterm `attachCustomKeyEventHandler` allowlist to bubble all Duo-global meta shortcuts (⌘T, ⌘⇧T, ⌘N, ⌘W, ⌘L, ⌘B, ⌘\`, ⌘0–9 with/without shift, ⌘+/=/-). Plus the existing ⌃Tab branch from BUG-001. Single sweep kills the whole family — the next Duo-global shortcut won't need its own bug filed.
3. Updated docs: roadmap card for Stage 19c, help/what-duo-does.html entry for "Open a Claude tab," help/faq.html entry on the ⌘T conflict.

**Verification still owed:**
- ⌘T from terminal / browser / files / editor focus → new browser tab + address bar focused (BUG-002 unchanged).
- ⌘⇧T from any focus → new claude tab.
- Other Duo-global meta shortcuts from terminal focus (⌘N, ⌘W, ⌘L, ⌘B, ⌘1–9) reach their handlers without xterm intercepting.
- xterm still receives non-Duo-global keystrokes (typing, ⌘C/V) normally.

---

### BUG-009: `+` (claude) button on terminal tab strip — claude doesn't auto-launch

**Status:** ✅ Fix shipped 2026-04-26 (commit pending v0.2.0; verification owed in next eyes-on session)
**Priority:** Medium
**Filed:** 2026-04-26 (during V-walk for v0.1.0 cut)

**Repro:**
1. With Duo open and at least one terminal tab, click the `+` button on the terminal tab strip (the claude side of the split-button, not the `>` shell side).
2. Observe the new tab.

**Expected:** New tab opens with title `claude · ~` and the claude REPL is running (Claude Code splash visible, ready for input).
**Actual:** New tab opens with the correct title, but the terminal ends in this state:

```
claude
(base) geoffreydudgeon@mac ~ % claude
```

— literal `claude` rendered on line 1 BEFORE the shell prompt drew, then `claude` typed at the prompt on line 2 with NO trailing newline. Claude never launches. The user has to manually press Enter to fire the command.

**Likely cause (untraced):**
Race between `pty.write(activeTabId, 'claude\n')` and the PTY's shell-prompt render. The write fires before the shell prompt is ready, so the bytes land too early — the first `claude` lands as raw text (no prompt to receive it), then the `\n` lands at an empty prompt (no-op), then the prompt draws, then a second write of `claude` (without `\n`?) lands at the prompt and just sits there. Two-write timing or single-write-before-ready, hard to tell without instrumenting.

**Verified once Enter pressed:** Claude Code v2.1.119 launches normally; `/remote-control is active` confirms PTY is wired. Tab title flips from `claude · ~` to `Claude Code` once the REPL detects (which is correct behavior).

**Suggested fix:**
Wait for the shell to be ready before writing `claude\n`. Options:
- **(a)** Wait for the first prompt-shaped bytes to appear in the PTY output buffer before issuing the write. Tightest fix; needs a small "prompt detector" (regex on common shell prompts: `% `, `$ `, `# `, `> `).
- **(b)** Sleep ~250-500ms after PTY spawn before writing. Crude but reliable; the user wouldn't notice the delay relative to claude's own boot time (~1.5s).
- **(c)** Use `ptyManager.onReady(tabId, () => pty.write(...))` if there's an existing readiness signal; if not, add one.

Option (b) is the quickest path; option (a) is the right path. Class of issue: PTY-write-too-early race.

**Class of issue:** New-tab auto-launch reliability. Same family of risk affects `duo new-tab --cmd "..."` (Stage 19c CLI verb) — the CLI is likely racing the same way. Worth a single fix that covers both code paths.

**Fix shipped (2026-04-26, pending v0.2.0 cut):** Replaced `queueMicrotask`-only deferral with `waitForPtyReady(id)` in `renderer/App.tsx`. The helper subscribes to `pty.onData` for the new tab id and resolves on first data event (= shell has emitted PS1) plus a 30ms paint settle. 1-second hard fallback in case data never arrives. Subscribing is safe — `dispatchPostSpawnWrite` runs immediately after `newTab()` so the listener registers well before the shell's startup output (~50–200ms after spawn). Same fix path covers all post-spawn payloads (`claude\n`, install banner, CLI `--cmd`), so `duo new-tab --cmd "..."` is fixed in the same edit.

**Affected files (actual):**
- `renderer/App.tsx` — added `waitForPtyReady` helper (~25 LOC); `dispatchPostSpawnWrite` now awaits it before writing.

**Verification still owed (next eyes-on session):**
- Click `+` on the terminal tab strip → tab title is `claude · ~`, claude REPL launches, NO literal `claude` text rendered above the prompt, NO orphaned `claude` typed at the post-startup prompt.
- `duo new-tab --kind claude` from a Duo terminal → same expected behavior.
- `duo new-tab --cmd "ls -la"` from a Duo terminal → `ls -la` appears at the prompt (no trailing newline per D21), shell prompt is fully drawn first.
- `duo new-tab --kind claude` when `claude` is missing from PATH → install banner renders cleanly at the prompt with no race artifacts.

---

### FOLLOWUP-005: First codesign on a new machine waits on a keychain permission dialog (and reports misleading errors if missed)

**Status:** ✅ Resolved 2026-04-26 (root cause owner-identified — not a bug, a macOS UX gotcha)
**Priority:** Stage 21 nice-to-document; not a blocker
**Filed:** 2026-04-26 (during v0.2.0 `npm run dist`)

When `CSC_NAME` is in env (from `~/Documents/duo-private/.env`), electron-builder auto-discovers the Developer ID Application cert and attempts to sign. The first time codesign accesses the cert's private key in the keychain on a given Mac, macOS pops up a system dialog asking the user to confirm — "codesign wants to use the key in your keychain. Allow / Always Allow / Deny." If the user doesn't click within macOS's internal timeout, codesign fails with one of two misleading errors:

**Run 1 manifested as:**
```
.../Electron Framework.framework/.../af.lproj/locale.pak: timestamps differ by 401 seconds — check your system clock
```

**Run 2 (after the partial sign attempt corrupted the build tree) manifested as:**
```
.../Duo Helper (GPU): resource fork, Finder information, or similar detritus not allowed
```

**Both were the same root cause.** Owner identified it: the keychain permission dialog had been waiting in the background for several minutes. Once "Always Allow" was clicked, the cert access is cached for that Mac and subsequent codesign invocations work normally without prompting.

**Two earlier diagnoses were wrong:** I first guessed system clock skew (verified Apr 26 EDT correct); then guessed extended attributes (the `com.apple.provenance` xattrs were real but a downstream symptom — `codesign` would have stripped or tolerated them once it could actually access the key). Both error messages from `codesign` are misleading on this path; the keychain-dialog failure mode produces almost-random downstream errors depending on which file codesign was on when access timed out.

**For Stage 21:** no code change needed. Document in the cut-version skill: when `npm run dist` is run on a Mac where the Developer ID cert's private key has never been accessed by `codesign`, watch for the macOS keychain permission dialog and click "Always Allow." After that one-time grant, the build runs unattended.

**Workaround used during v0.2.0:** `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist` — produces unsigned DMGs (which is what v0.2.0 wanted anyway since Stage 21 hadn't shipped). v0.2.0's `dist/Duo-0.2.0-arm64.dmg` + `dist/Duo-0.2.0.dmg` are unsigned by design, not by accident.

---

### BUG-011: Install banner success state never renders (disappears silently on click)

**Status:** ✅ Fix shipped 2026-04-26 (one-line deletion, see Fix below)
**Priority:** Medium (install actually completes; user gets no feedback)
**Filed:** 2026-04-26 (during v0.2.0 owner verification)

**Repro:**

1. Fresh `~/.claude/duo/installed.json` absent (or version mismatch).
2. Launch Duo (`npm run dev` or the v0.2.0 DMG).
3. Welcome banner appears at top with [Install] button.
4. Click [Install].

**Expected:** Banner shows "Installing…" briefly, then "Installed. Skill + subagent + help files in `~/.claude/`; `duo` CLI ready on your PATH" (or the PATH-missing variant) for ~3s, then auto-dismisses.

**Actual:** Banner shows "Installing…" briefly, then disappears immediately with no success message. The install itself succeeds — `~/.claude/duo/installed.json` is written, `~/.local/bin/duo` is in place, etc. — only the user-feedback step is broken.

**Root cause:**

`renderer/components/FirstLaunchBanner.tsx` has a render-gate ordering bug. When `setStatus({installed: true, needsUpdate: false, ...})` fires on success, the very next render evaluates:

```ts
if (!status) return null
if (status.installed && !status.needsUpdate) return null   // ← fires immediately
if (dismissed) return null
if (phase === 'idle' && status.installed && !status.needsUpdate) return null
```

The second `if` returns null before the success state can render. The 3s auto-dismiss timer is irrelevant — the component already unmounted. The fourth `if` would have been the correct gate (only hide-on-installed when phase is idle, not success/error/running) but it never fires because the second `if` short-circuits first.

**Fix shipped (one line — delete):**

```diff
  if (!status) return null
- if (status.installed && !status.needsUpdate) return null
  if (dismissed) return null
  if (phase === 'idle' && status.installed && !status.needsUpdate) return null
```

The remaining checks correctly let the success/error states render through phase transitions while still hiding the banner once installed + idle on future launches.

**Verification owed after fix:**

- Click [Install] on a fresh `~/.claude/duo/installed.json`-absent state → banner shows "Installed." with appropriate cli-on-PATH variant for ~3s before auto-dismiss.
- Click [Install] when `~/.local/bin` is NOT on `$PATH` → banner stays open with the `export PATH=...` snippet + [Got it] button (the `stable=false` branch in `handleInstall`).
- Re-launch Duo with `installed.json` present + version match → banner does NOT appear (the fourth `if` correctly fires).
- Edit `installed.json` to set version to "0.0.9" → relaunch → banner appears with "Update available" copy.

**Class of issue:** state-machine render gate ordering. The fix is a deletion; no new logic. Should land alongside an actual eyes-on V-walk of the install banner (deferred from v0.1.0/v0.2.0 smoke passes — exactly the kind of bug that would have caught this).

**Affected files:**

- `renderer/components/FirstLaunchBanner.tsx`

---

### BUG-010: BUG-009 residual — literal `claude` echoes above the shell prompt

**Status:** ✅ Shipped v0.3.0 (2026-04-26 evening) — `waitForPtyReady` now uses prompt-tail regex on stripped ANSI; 14/14 standalone test cases pass
**Priority:** Low (cosmetic — claude DOES launch end-to-end)
**Filed:** 2026-04-26 (during v0.2.0 smoke-pass after BUG-009 fix landed)

**Repro:**
1. Click `+` on the terminal tab strip (or press ⌘⇧T from any focus).
2. Watch the new tab as it spawns.

**Expected:** Shell prompt draws cleanly; `claude\n` writes to the prompt; `claude` command runs; Claude Code splash + workspace prompt appears.
**Actual:** All of the above happens (the Claude Code REPL DOES launch — BUG-009 is genuinely fixed), but a bare `claude` echoes on its own line ABOVE the shell's PS1 line. End state looks like:

```
claude
(base) geoffreydudgeon@mac ~ % claude

[Claude Code splash]
```

The first line is the cosmetic artifact. Pure visual noise; no functional impact.

**Likely cause (untraced):**
The BUG-009 fix's `waitForPtyReady` helper resolves on the FIRST `pty.onData` event for the new tab, plus a 30ms paint settle. But zsh (and other shells) often emit some output BEFORE PS1 is fully drawn — terminal-init escape codes, working-dir notice, or similar. If `waitForPtyReady` resolves on that pre-PS1 byte, the `claude\n` write fires before the shell's prompt is ready to receive command input. The bytes:
- `claude` echoes locally on whatever line the terminal driver is currently on (which is pre-PS1, hence the bare line)
- `\n` lands; depending on shell state, may or may not advance the line
- Then PS1 finally draws on the next line
- Then `claude` re-appears at the prompt (because zsh's input buffer captured it after PS1 drew)

End result: claude command DOES execute (because it lands at the prompt with the trailing `\n`), but the visual is noisier than the intended "shell drew, command typed, command ran" flow.

**Suggested fix:**
Switch `waitForPtyReady` from "first data" trigger to a prompt-shape regex on the buffered output. Look for trailing `% `, `$ `, `# `, or `> ` (the common shell prompt terminators) before resolving. Reuses the same listener; just adds a regex check instead of unconditional resolve. Probably ~10 LOC change in `renderer/App.tsx`.

Alternative: a deliberate post-PS1 sleep (e.g., 200ms). Crude but predictable. Less elegant.

**Class of issue:** PTY-write timing; same family as BUG-009. The "first data" heuristic was a step up from the prior `queueMicrotask` race but doesn't fully model shell startup. A prompt-detector ends the family.

**Affected files (suspected):**
- `renderer/App.tsx` (`waitForPtyReady` helper)

**Update 2026-04-26 evening:** Fix shipped — `waitForPtyReady` now strips ANSI escapes and matches a prompt-tail regex (`/[$%#❯>›→]\s*$/`). 14/14 standalone test cases pass (bash/zsh/conda/root/starship/fish all detected; mid-startup escapes correctly ignored). Live verification owed.

---

### BUG-012: HTML canvas — global ⌘N, ⌘T, ⌃Tab don't reach the App-level handler

**Status:** ✅ Shipped v0.3.0 (2026-04-26) — preventative kb-shortcut architecture: iframe forwarder consults `matchGlobalShortcut` and re-dispatches global shortcuts to parent window
**Priority:** High (regression — same family as BUG-001 / BUG-008)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Open any HTML canvas tab (e.g. `~/.claude/duo/help/canvas-actions-demo.html`).
2. With keyboard focus inside the canvas (click into the body), press ⌘N, ⌘T, or ⌃Tab.

**Expected:** Same global behavior as from any other surface — ⌘N opens a new markdown file interstitial, ⌘T opens a new browser tab (or claude tab from terminal focus per BUG-008), ⌃Tab cycles tabs.
**Actual:** Nothing happens; keystrokes are swallowed by the iframe's contentEditable.

**Root cause (suspected):**
`renderer/components/HtmlCanvas/RenderedCanvas.tsx` installs a `keydown` listener on the iframe's document and forwards events to `onShortcut(e)` — but `CanvasTab.tsx`'s `handleShortcut` only handles ⌘S/⌘B/⌘I/⌘U/⌘K and returns `false` for everything else, which currently means "let contentEditable handle it" (incorrect). The else branch should re-dispatch the keydown event up to `window` so `useKeyboardShortcuts` sees it.

**Suggested fix:**
In `CanvasTab.handleShortcut`, when no canvas-specific shortcut matches, synthesize a `KeyboardEvent` on `window` (or call a hoisted forwarder from App.tsx) so the global hook fires. Mirrors how `BROWSER_KEY_FORWARD` works for the browser pane.

**Class of issue:** keystroke escape from a focused surface. Same family as BUG-001 (xterm), BUG-008 (xterm + browser). Each new pane needs its own escape mechanism documented in the smoke matrix and CLAUDE.md plumbing checklist.

---

### BUG-013: Markdown editor — ⌘T opens a duplicate FAQ instance instead of a new doc

**Status:** ✅ Shipped v0.3.0 (2026-04-26) — TipTap surface adopts the shared `matchGlobalShortcut` matcher; ⌘T now properly opens a fresh browser tab from MD editor focus
**Priority:** High (regression; user-confusing)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Open a markdown file in the editor.
2. Press ⌘T.

**Expected:** Per Stage 11 D33e, ⌘T from editor focus opens a new browser tab. (Or per the reporter's expectation here, ⌘T from editor focus could open a new markdown-file interstitial — that's a spec discussion, not a fix.)
**Actual:** Spawns a duplicate of the duo FAQ as a new tab.

**Plus a related symptom inside the FAQ tab:** ⌃Tab from inside duo FAQ only cycles among duo-FAQ tabs (duplicates), not across all tabs. Possibly because the FAQ is rendered in the embedded browser pane and ⌃Tab inside the WebContentsView is being handled by Chromium's tab-cycling, not Duo's.

**Likely fix:**
- Confirm Stage 11 D33e behavior: ⌘T from editor focus should open a new browser tab (today's behavior). The "duplicate FAQ" hint suggests the new browser tab is landing on `faq.html` (which is the new default landing per v0.2.0) — that's *expected*, but the reporter's mental model is "I'm in an editor, ⌘T should give me a new doc." Worth surfacing the spec choice.
- ⌃Tab from inside the FAQ (which is a browser-pane WebContentsView) needs the BROWSER_KEY_FORWARD escape to actually fire — verify that path.

**Class of issue:** spec confusion + keystroke escape. Resolve via the matrix.

---

### BUG-014: Markdown editor — ⌃Tab does nothing (should cycle tabs)

**Status:** ✅ Shipped v0.3.0 (2026-04-26) — same fix as BUG-012/013: TipTap consults the shared global-shortcut matcher and yields ⌃Tab to the document capture-phase listener
**Priority:** High (regression — same family)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Open a markdown file in the editor.
2. Press ⌃Tab.

**Expected:** Cycles through the WorkingPane tab strip (or terminal tabs depending on the focus-aware spec — same as the resolution that closed BUG-001 for terminal focus).
**Actual:** Nothing happens.

**Root cause (suspected):**
TipTap/ProseMirror swallow the keydown unless the markdown editor adds its own `editorProps.handleKeyDown` that returns `false` for the global-shortcut keys. Same shape of fix as the canvas iframe, different mechanism.

**Class of issue:** keystroke escape from TipTap. Add to the smoke matrix; document the escape mechanism in CLAUDE.md plumbing checklist.

---

### BUG-015: HTML canvas — comment rail renders even when there are no comments

**Status:** ✅ Fixed 2026-04-26 (v0.3.1)
**Priority:** Medium (visual noise; no functional impact)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Open any HTML canvas tab without comments (e.g. a fresh `duo html new` canvas).

**Expected:** Comment rail collapses or hides; gives the editing area more horizontal room.
**Actual:** Empty rail occupies its full width with no threads.

**Suggested fix:**
`renderer/components/HtmlCanvas/CanvasTab.tsx` — gate the `<CommentRail>` render on `threads.length > 0` (or surface a placeholder collapsed state). Trivial conditional.

---

### BUG-016: HTML canvas in dark mode — pasted bold text is illegibly low contrast

**Status:** ✅ Fixed 2026-04-26 (v0.3.1)
**Priority:** High (accessibility / readability)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Set theme to dark.
2. Open an HTML canvas; paste text containing bold (e.g. from a Google Doc or another markdown editor that ships `<b>` / `<strong>`).

**Expected:** Bold text renders in the same ink color as surrounding body text.
**Actual:** Bold text renders dark-brown on the dark canvas paper background — nearly invisible.

**Likely cause:**
The pasted HTML carries inline color styles or class names that resolve to light-mode tokens; the canvas's iframe stylesheet isn't overriding `b`/`strong` color in dark mode. Could also be the serializer / paste-handler keeping inline `style="color: #..."` from the source.

**Suggested fix:**
- Add a paste handler that strips `style="color: ..."` and class attributes from pasted nodes (force the canvas's own typography to win).
- And/or: explicitly style `b, strong` to inherit `color` in the canvas stylesheet.
- Pairs naturally with ENH-002 (paste-as-plain-text).

---

### BUG-017: Theme toggle "system" setting renders as light, not actual OS preference

**Status:** ✅ Fixed 2026-04-26 (v0.3.1)
**Priority:** Medium (accessibility / regression)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Repro:**
1. Set theme toggle to "system."
2. Set macOS to Dark Mode in System Settings → Appearance.

**Expected:** Duo follows macOS into dark mode without further input.
**Actual:** Duo stays in light mode regardless of OS setting.

**Suggested fix:**
Audit the theme service. The css `@media (prefers-color-scheme: dark)` blocks are present in the FAQ / canvas / Atelier tokens, so the matchMedia-driven branch should work — unless the renderer's `system` mode is hard-coded to a light fallback or doesn't subscribe to `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)`.

---

## Missing features

### MISSING-001: Markdown editor — no way to add a comment

**Status:** 🆕 Filed
**Priority:** Medium (feature gap; HTML canvas has comments via Stage 17d-A)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Context:**
Stage 14a (CommentRail binding for the markdown editor) is the planned home for this — currently labeled "next" on the roadmap, with the visual primitive (`<CommentRail>`) already built in 17d-A and reused by the canvas. The markdown half hasn't shipped.

**Suggested next step:**
Promote Stage 14a in the v0.3.0 / v0.4.0 sequencing once the kb-shortcut family lands. The CommentRail primitive + new-comment composer pattern are already solved canvas-side; binding them to TipTap is mostly data-plane work.

---

## Enhancement opportunities

### ENH-001: New HTML canvases should default to stable IDs

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (UX papercut)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Today:**
First open of a new canvas pops the "Add stable IDs to all elements?" prompt (Stage 17b H12–H14). Per-directory choice persists.

**The papercut:**
When Duo *itself* wrote the canvas (`duo html new`), the prompt is unnecessary friction — Duo's own boilerplate ships with no IDs, and the agent is the most common CLI user.

**Suggested fix:**
- `duo html new` could write a sidecar (`<file>.duo.json`) with `idChoice: 'always'` so the first open auto-injects without prompting.
- Or: `duo html new` injects IDs at write time so the file lands on disk with them already.

The prompt remains valuable for HTML files Duo *didn't* author (a hand-authored or downloaded canvas the user opens).

---

### ENH-004: Better default boilerplate for new HTML canvases (paired with ENH-001)

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (pair with ENH-001 — both touch `duo html new`'s output)
**Filed:** 2026-04-26 (during v0.3.0 cut, owner suggestion)

**Today:**
`shared/html-boilerplate.ts` ships a minimal H17 v1 skeleton: `<!doctype html>`, title meta, `<h1>${title}</h1>`, empty `<p>`. No styles, no IDs, no Atelier flavor. The first-open prompt asks the user about ID injection (because IDs are absent).

**Suggested combined improvement (closes ENH-001 + ENH-004):**
1. **Inject `data-duo-id="<ulid>"` on every element at write time**, not on first open. The first-open prompt becomes redundant for Duo-authored canvases (closes ENH-001 by construction; the prompt remains valuable for hand-authored / downloaded HTML the user opens later).
2. **Add a small inline CSS block** so the canvas reads well immediately:
   - Atelier-ish defaults (cream paper, ink-soft body, serif headings, accent ochre).
   - `prefers-color-scheme: dark` media query for dark mode.
   - Body width cap (~720px max-width, centered, generous line-height).
3. **Add `<meta name="viewport">`** for sensible defaults if a canvas gets shared as a web page later.
4. **Drop a small invisible HTML comment** describing what the file is and how to extend (helps an agent see "this is a Duo canvas, the IDs are stable, etc." when reading via `duo html get`).

The styles must remain canvas-local and editable — the user can delete or rewrite them at will. They're a starting hint, not a contract. The "no Duo chrome leaks" guarantee (`duo-just-added`, `data-duo-canvas-runtime`, etc.) still applies; these are user-authored CSS, not runtime-only attributes.

**Affected files:**
- `shared/html-boilerplate.ts` — extend the template.
- `renderer/components/HtmlCanvas/idInjector.ts` (or the equivalent ulid mint) — used at write time too.
- `electron/main.ts § htmlNew` — call the new boilerplate that already has IDs.
- `renderer/App.tsx § onCommitNewFile` — same call site for ⌘N + `.html` path.

**Cross-refs:** ENH-001 (closed by this), Stage 17 PRD H17 (full Atelier body width + Tailwind opt-in is still 17b/17e scope; this is a smaller "useful defaults out of the box" middle ground).

---

### ENH-003: "What Duo Does" should default-pin alongside the FAQ

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (FTUX consistency)
**Filed:** 2026-04-26 (during v0.3.0 cut)

**Today:**
First-launch (and every fresh window) shows the FAQ as the default browser-pane landing tab. "What Duo Does" — the canonical capability inventory at `~/.claude/duo/help/what-duo-does.html` — is reachable only via a link from the FAQ.

**The request:**
Make "What Duo Does" a second pinned default tab alongside the FAQ so users see both reference surfaces immediately without hunting. The FAQ explains *concepts*; What Duo Does enumerates *capabilities* — they pair.

**Suggested implementation:**
- Bootstrap a `~/.claude/duo/pins.json` with the two help URLs pre-pinned at install time (Stage 18b's `PACK.json § pins` is the natural home, but a smaller direct-write at install can ship sooner).
- Or: extend the `BrowserManager.defaultLandingUrl()` to seed *two* tabs on a fresh session instead of one, both pre-pinned.

Cross-refs Stage 24 (pin storage), Stage 18b (distro pre-pins).

---

### ENH-002: "Paste as plain text" — menu item + keyboard shortcut for all editors

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (request; cross-editor consistency)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Scope:**
Both the markdown editor (TipTap) and the HTML canvas (contentEditable) inherit the standard rich-paste behavior. Users coming from Google Docs / web apps regularly want to drop the styling.

**Suggested implementation:**
- Single menu item "Edit → Paste and Match Style" wired via Electron's app menu.
- Keyboard shortcut: ⌘⇧V (macOS standard).
- Each editor handles by reading the clipboard's `text/plain` instead of `text/html`.
- Pairs with BUG-016 — fixing paste-as-plain-text by default for the canvas would also kill the dark-mode contrast bug.

---

## Follow-ups (open · process / docs)

### FOLLOWUP-001: Add `agents/duo.md` to the new-CLI-verb plumbing checklist (CLAUDE.md)

**Status:** ✅ Closed 2026-04-26 late-evening (Stage 5 v2)
**Priority:** Low (process)
**Filed:** 2026-04-26 evening
**Closed:** Item 7 of the plumbing checklist now reads "every new verb
must update the agent's verb cheat-sheet" without the *pending*
qualifier. The `duo` subagent file at `agents/duo.md` is load-bearing.

**What.** When Stage 5 v2 (Duo subagent) lands, the existing "every new CLI verb must touch these places" checklist in `CLAUDE.md` (currently `shared/types.ts` + `electron/preload.ts` + `electron/main.ts` + `electron/socket-server.ts` + `cli/duo.ts` + `skill/SKILL.md`) needs a new entry: **`agents/duo.md`**. Once the agent is the canonical CLI driver for orchestrators, every new verb without an agent-prompt update means agents will be unaware of it and orchestrators will fall back to inline-CLI for that verb, defeating the purpose.

**Why deferred.** The agent file doesn't exist yet — Stage 5 v2 is the stage that creates it. Updating the checklist now would point at a missing file and confuse anyone shipping a verb in the meantime.

**When to actually do it.** Build-order step in `docs/prd/stage-5-v2-duo-subagent.md` § 9 already includes "update CLAUDE.md plumbing checklist." Treat this `tasks.md` entry as the surface that surfaces the work if the PRD step gets dropped during execution.

**Affected file:** `CLAUDE.md` (the "Plumbing checklist for a new CLI verb" inside the "CLI parity" rule, near line ~330 of the file).

---

### FOLLOWUP-002: Harden `agents/duo.md` session guard against Bash-allowlist denial

**Status:** ⏳ Open (low priority — corner case)
**Priority:** Low
**Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** When the agent's session-guard bash command (`[ -n "$DUO_SESSION" ] && echo "in_duo" || echo "not_in_duo"`) is permission-denied — typically because a user wrote a tight `Bash(duo *)` allowlist that doesn't cover `[`/`echo`/compound commands — the agent currently proceeds with the task anyway. C5 walk surfaced this: with `--allowedTools "Bash(duo *)"` the guard check was denied 3 times, then the agent fell through to `duo doc read /tmp/foo.md` and reported the file's contents.

**Fix.** Add to the agent prompt's session-guard block: "If you cannot run the check (the Bash call is permission-denied or otherwise unable to execute), treat that the same as `not_in_duo` — refuse and stop. Never run a `duo` verb without first confirming `$DUO_SESSION` is set."

**Why low priority.** Most users don't hand-write Bash allowlists for the duo agent specifically; the realistic outside-Duo scenario (no allowlist) works correctly — verified live in C5.

**Affected file:** `agents/duo.md` (Session guard section, lines 19–37).

---

### FOLLOWUP-003: Re-measure Class B perf with cumulative-context methodology

**Status:** ⏳ Open (open question, not blocking)
**Priority:** Low
**Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** The synthetic Class B measurement during Stage 5 v2 ship inverted the PRD's hypothesis: subagent path (`Sonnet → Task(duo)`) was ~2× the cost and 2× the wall-clock of inline (`Sonnet → Bash(duo *)`) on a fresh F1. Cause: Claude Code already routes mechanical tool execution to Haiku regardless of `--model`, so the subagent path stacks a second Haiku context on top of the existing fast-tier Haiku.

**Why the PRD pass criteria don't apply.** "≥60% orchestrator-token reduction" assumed the top-level Sonnet was processing CLI dumps. In Claude Code today, it isn't. The benefit framing has to shift to: *bounded context per task*, *specialized prompt*, *clear orchestrator/agent contract* — qualitative wins that scale with session length, not per-task dollar wins on a cold-cache synthetic.

**Right methodology.** Track cumulative orchestrator-context tokens across a multi-task session — e.g. 10 sequential duo tasks in one Claude Code session, with vs without subagent. The cache-pollution argument should show up there.

**Why low priority.** The agent already shipped; the qualitative wins are real even if the quantitative measurement disagreed with the PRD. Re-measurement is "would be nice for justifying the architecture" not "blocking next stage."

**Affected files:** none directly. Notional follow-up for whoever wants to validate the architectural choice.

---

### FOLLOWUP-004: Visual smoke of Stage 5 v2 + Stage 15.1 (CLI half + pill UI) via computer-use

**Status:** ⏳ Open (deferred — user couldn't approve computer-use access in the spawning session)
**Priority:** Low (CLI surface is verified via API responses; this would only catch UI/renderer regressions)
**Filed:** 2026-04-26 late-evening, after `request_access` for Electron timed out

**What.** Run the visual sanity pass on the live Duo app to confirm:
1. App boots cleanly post-Stage-5-v2 main-process changes (`shell.openExternal`, the `external` socket case, `getSelectionFormatState`/`setSelectionFormat`, `sendToActiveTerminal`, `TERMINAL_ACTIVE_PUSH` IPC) — no preload/main errors at mount.
2. The renderer's `useSelectionFormat` hook initializes cleanly and does its initial pushState (verify by running `duo selection-format` immediately after boot — should return `{format: 'a'}` for a fresh install or whatever was last persisted).
3. The `terminal:active-push` IPC fires on tab switch — open two terminal tabs, switch between them, run `duo send --text "marker"` while each is active, verify the payload lands only in the focused one.
4. The previously-issued `duo send` payloads from this session ("hello from duo send", "from stdin", the multi-line G10 sample) are visible in the active terminal's scrollback. (Will not have been "executed" — no Enter was pressed.)
5. No console / DevTools errors related to the new IPC channels.

**Why deferred.** `request_access` for Electron timed out — the user couldn't approve in the dialog from the session that needed it. Walking the smoke checklist § 1 (App boot) + § 2 (Terminal pane) + § 7 (Agent bridge — selection-format + send) by eye next session covers this faster than re-attempting computer-use.

**Recipe** (manual, ~5 min):
1. Launch Duo, open DevTools (⌘⌥I), check console for errors.
2. **CLI half:** in a Duo terminal: `duo selection-format` → expect `{format: 'a'}`; `duo selection-format c` → verify persisted state; `duo selection-format` → expect `{format: 'c'}`; `duo selection-format a` to restore. `duo send --text "smoke"` → expect "smoke" appended to terminal input line, no Enter pressed. Switch to a second terminal tab, repeat — payload lands in the new active tab only.
3. **Pill UI half (Stage 15.1):** open `/tmp/pill-fixture.md` (or any `.md`) via `duo edit`. Select a sentence in the editor with the mouse. **Expect:** a small purple pill labelled "Send → Duo ↗" floating ~6px above the selection, right-aligned to the selection's right edge. **Click the pill.** Expect: pill disappears, focus moves to the active terminal, and the formatted payload appears at the prompt — by default format A (`> "your selection"\n> (~/path · heading_trail)\n`), no Enter pressed. Verify with `duo selection-format b` then re-select-and-click → expect literal text only. Verify with `duo selection-format c` then re-select-and-click → expect an opaque token like `<<duo-sel-abc123>>`.
4. **Edge cases:** select near the top of the editor (no room above) → pill should appear *below* the selection; select to the far right of the column → pill should clamp to the viewport edge; click outside the editor without clicking the pill → pill should disappear (it follows editor focus).

**Affected files:** none directly. Just a verification pass.

---

## v0.4.2 punch list (filed 2026-04-27 from owner-side smoke)

Owner installed the prebuilt v0.4.2 DMG and walked the surfaces. These
came back as observations — a mix of bugs and enhancements. Filed
together so the v0.4.3 patch (or v0.5.0 cut) can scoop them in one
pass.

---

### BUG-018: ⌘T opens new browser tab landing on FAQ

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — `⌘T` now opens fresh `about:blank` instead of duplicate FAQ
**Priority:** Medium (papercut — every new tab needs to be re-navigated)
**Filed:** 2026-04-27

**Today:**
`⌘T` from any pane opens a new browser tab that loads `~/.claude/duo/help/faq.html` (the default landing). The FAQ is right above as the default *first* tab — so `⌘T` produces a duplicate FAQ rather than a fresh canvas to navigate from.

**Expected:**
A "new tab" experience — about:blank, a stub "Where to?" page, or the most-recent-history URL. Whichever, it shouldn't be the FAQ.

**Suggested fix:**
`electron/browser-manager.ts § defaultLandingUrl()` is the FIRST-tab default. `⌘T`'s code path — `addTab(defaultLandingUrl())` — uses the same call. Split the two: keep `defaultLandingUrl()` as the boot default; add `newTabUrl()` (or accept an `addTab(undefined)` → about:blank) for the keyboard path.

**Affected files:** `electron/browser-manager.ts`, possibly `electron/main.ts` if the IPC for ⌘T-add-tab routes through there.

---

### BUG-019: ⌘T new browser tab doesn't focus the address bar

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — address-bar focus via two nested `requestAnimationFrame`s after new-tab commit
**Priority:** Medium (pairs with BUG-018; together they're the "⌘T felt right" fix)
**Filed:** 2026-04-27

**Today:**
`⌘T` opens a new browser tab but the address bar stays unfocused. Browser-default behavior is for `⌘T` to land focus in the address bar so the user can type a URL immediately.

**Expected:**
After `⌘T` resolves, `BrowserRenderer`'s address-bar input has keyboard focus.

**Suggested fix:**
The new-tab code path needs to push focus to the address bar after `addTab()` resolves. There's likely a renderer-side `useEffect` that watches active tab changes; add a focus-the-address-bar branch when the new tab's URL is the new-tab placeholder (paired with BUG-018).

**Affected files:** `renderer/components/BrowserRenderer.tsx` (or the address-bar component); the new-tab dispatch in `App.tsx` / `WorkingPane.tsx`.

---

### BUG-020: First FAQ tab non-closeable but not pinned

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — first/last tab now closeable; opens fresh `about:blank` first, then closes (Notion pattern)
**Priority:** Medium (UX inconsistency — should match an existing affordance)
**Filed:** 2026-04-27

**Today:**
The boot-time first browser tab (FAQ) doesn't render a close-X. Trying to ⌘W on it does nothing. But it doesn't show a pin glyph either — it looks like a regular tab that just happens to be undeletable.

**Expected:**
Either: (a) auto-pin the FAQ default tab on first install (matches Stage 24's pin model — pin glyph, sorts leftmost, ⌘W gates behind confirm modal); OR (b) keep it non-closeable but pin-styled so the affordance is visible; OR (c) make it closeable like every other tab and let the user re-open it via the help menu / pinned state.

**Owner suggestion:** "we did mean for this to be pinned instead?" — leans toward (a). Stage 24 + ENH-003 already default-pin FAQ + What Duo Does, so the pin should be in `pins.json` post-install. Verify whether the close suppression is from `BrowserManager.closeTab`'s "cannot close last tab" guard (degenerate) vs. the pinned-confirm modal. If it's the former, the bug is "BrowserManager allows closing the only tab if the user really wants to" + "first-launch pins.json includes the FAQ".

**Affected files:** `electron/browser-manager.ts` (closeTab guard), `electron/install-service.ts` (pin bootstrap — verify FAQ is pre-pinned), `renderer/components/WorkingPane.tsx` (close-X visibility).

---

### BUG-021: ⌃Tab cycle skips restored tabs after session restore

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — cycle now uses refs instead of closure-captured tabs so post-session-restore state is always visible
**Priority:** **High** (load-bearing for session-restore credibility — "the tabs are there but I can't reach them with the keyboard")
**Filed:** 2026-04-27

**Today:**
After Duo relaunches and session restore re-creates tabs (terminals + browser tabs), `⌃Tab` only cycles the tabs created/touched in the CURRENT session — not the restored ones. Owner observation: "still seeing a weird tab cycle bug where ; hard to pin down but I think ctrl tab is only cycling this session's tabs, not restored tabs; either way, it is only cycling some of the tabs."

**Expected:**
`⌃Tab` cycles the full strip — restored + current-session — in display order.

**Hypothesis:**
The keyboard-shortcut handler likely captures the cycle list at mount time (or memoizes it on a stale dep), so tabs added later (via session restore's mount-time hydration) aren't in the cycle set. Could also be a tab-id-shape mismatch (restored tabs get fresh UUIDs; the handler may be tracking against the original-session UUIDs).

**Suggested triage:**
1. Look at `useKeyboardShortcuts` and the ⌃Tab branch — does it pull from a `tabs` ref/state that's reactive to changes?
2. Check the tab-cycle order — is it cycling correctly on tab CREATE within the current session but breaking only on RESTORED tabs? Or is the cycle generally broken with > N tabs?
3. The session-restore hydration in `App.tsx` calls `setTabs(restoredTabs)` — confirm the keyboard hook re-computes its cycle list when this fires (probably yes since deps include `tabs`, but the `?` is whether the handler closure captures a stale `tabs` reference).

**Affected files:** `renderer/hooks/useKeyboardShortcuts.ts`, `renderer/App.tsx` (the session-state hydration block I added in Phase 2B).

---

### BUG-022: New HTML canvas doesn't focus the writing area on open

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — `RenderedCanvas` calls `doc.body.focus()` on canvas mount
**Priority:** Medium (papercut — every new canvas needs an extra click)
**Filed:** 2026-04-27

**Today:**
`⌘N` → name a `.html` file → opens a fresh HTML canvas with the smart-blank overlay. The canvas mounts unfocused; the user must click into the page to start typing.

**Expected:**
After the canvas mounts, focus moves to the contentEditable body so the first keystroke lands as content. (Mirrors the markdown editor's behavior — `⌘N` → name `.md` → editor opens already focused.)

**Suggested fix:**
`renderer/components/HtmlCanvas/RenderedCanvas.tsx` `onReady` callback (the iframe-load hook) — after `wired` is set, call `iframe.contentDocument.body.focus()` (or whatever the focus surface is). May need to handle the "iframe steals focus from the address bar" edge case.

**Affected files:** `renderer/components/HtmlCanvas/RenderedCanvas.tsx`, possibly `renderer/components/HtmlCanvas/CanvasTab.tsx`.

---

### BUG-023: HTML canvas click area too small — must click ON existing text

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — body fills viewport (`min-height: 100vh`) with content in a 720px `<main>` child so clicks anywhere place a cursor
**Priority:** Medium-High (significant friction for the canvas surface)
**Filed:** 2026-04-27

**Today:**
Owner observation: "clickable area in html canvas still too small; must click RIGHT on existing text to place cursor". Clicking in the visual margin of the page (or in whitespace between paragraphs) doesn't place a cursor; only clicking directly on a glyph or inside a tight bounding box around existing text places it.

**Expected:**
Click anywhere within the page's content column places a cursor at the nearest text position (typical browser/Word/Notion behavior).

**Hypothesis:**
The contentEditable body has a too-tight min-height or its child blocks have margins that are outside the click-receptive area. Possibly `<body>` itself isn't claimed as the editable surface or there's a conflicting padding/click-target setup in the boilerplate stylesheet (ENH-001/004 introduced inline Atelier styles).

**Suggested triage:**
1. Inspect the iframe DOM in DevTools, check `<body>` and its contentEditable boundary.
2. Look at `shared/html-boilerplate.ts` — the inline stylesheet may need a `min-height: 100%` on body or different padding to expand the click-receptive area.
3. Worst case: add a click-handler to the iframe document that captures clicks on the *body* and synthetically positions the cursor at the nearest text node.

**Affected files:** `shared/html-boilerplate.ts` (boilerplate stylesheet), `renderer/components/HtmlCanvas/RenderedCanvas.tsx` (iframe + contentEditable wiring).

---

### BUG-024: Comment button occludes Send → Duo pill on canvas selection

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — Comment button stacks below selection (Send→Duo stays above), falls back to "stack above" when selection is at viewport bottom
**Priority:** Medium (selection UX — both pills appear at the same anchor and stack visually)
**Filed:** 2026-04-27

**Today:**
Selecting text on an HTML canvas surfaces both the Send → Duo pill (Stage 15.2) and the Comment button (Stage 17d-A). They render at the same selection anchor and visually overlap; one tends to be hidden behind the other.

**Owner suggestion:** "combine buttons?"

**Possible fixes:**
- (a) Single combined pill with a split affordance — primary action (one half) is Send → Duo, secondary (other half, maybe a chevron) is Comment.
- (b) Stack vertically — Send → Duo on top, Comment below (or vice versa). Both visible, neither occluded.
- (c) Single primary pill with a hover-to-reveal flyout containing additional actions. More refined but more clicks.

**Recommend:** (a) or (b) for v1; (c) is post-1.0 polish.

**Affected files:** `renderer/components/HtmlCanvas/CanvasTab.tsx` (selection UI), the `SendToDuoPill` primitive in `renderer/components/editor/`.

---

### BUG-025: Folder chevron click promotes/opens the row instead of just toggling expansion

**Status:** ✅ Shipped v0.5.0 (2026-04-27) — Stage 26 PR 1: chevron split into discrete button with `e.stopPropagation()`
**Priority:** Medium (papercut on the most-used navigator gesture)
**Filed:** 2026-04-27

**Today:**
The whole folder row in `FileTree.tsx` is a single `<button>` with one `onClick` that does both `actions.toggleExpand(entry.path)` AND `actions.selectItem(entry.path, 'folder')`. Clicking the chevron is structurally identical to clicking anywhere else on the row — there's no chevron-only hit-target.

**Why this is a bug now (and why it pairs with the Stage 26 / nav-polish item 1):**
Once we land single-click-to-select / double-click-to-open semantics (Stage 26 item 1), the row's primary click becomes "select/promote." The chevron must remain a discrete affordance that *only* toggles expansion, otherwise clicking it will also select the folder (and, in the future, double-clicking to open will fight the toggle).

**Expected:**
- Click on chevron → toggle expand/collapse only. Does not change selection. Does not open.
- Click on the rest of the row → select-only (per Stage 26 item 1) or open (today, until item 1 lands).

**Suggested fix:**
Split the chevron out of the row `<button>` into its own button with `e.stopPropagation()` on click. Two paths:
- (a) Nest a `<span role="button">` inside the row button (semantically iffy but simple).
- (b) Refactor the row into a `<div>` containing two siblings: a chevron button and a row button. Cleaner; matches VS Code / Finder DOM. *Recommend.*

**Affected files:** `renderer/components/FileTree.tsx` (the `TreeNode` component, lines ~158-200).

**Cross-refs:** Stage 26 item 1 (double-click-to-open) — these ship together; item 1 alone without BUG-025 leaves the chevron half-broken.

---

### BUG-026: Pasted markdown lands as a code block in the markdown editor

**Status:** ✅ Shipped v0.5.1 (PR 2, 2026-04-28) — root cause: tiptap-markdown's `clipboardTextParser` always parses with `{ inline: true }`, so block-level markdown (headings, lists, fences) lands as a single chunk that the schema collapses into a code block. Fix: new `MarkdownPaste` TipTap extension (priority 1000) installs a higher-priority `clipboardTextParser` that inspects the source text — block markers (`^# `, `^- `, `^1. `, `^> `, ` ``` `, blank-line separator) trigger block-mode parse; otherwise inline-mode is preserved (so the "paste a bold word mid-sentence" case still works). Verified live: pasting `# Heading\n\nA paragraph with **bold**.\n\n- list item 1\n- list item 2\n\n> blockquote` lands as proper H1 + paragraph + bullet list + blockquote.
**Priority:** Medium-High (degrades the core "paste from another agent / doc" loop)
**Filed:** 2026-04-27

**Today:**
Pasting raw markdown text into the TipTap markdown editor wraps the entire paste in a single `<pre><code>` block — even when the source has no triple-backtick fences. Headings, lists, bold/italic, links — all rendered as literal characters inside a code block.

**Repro:**
1. Copy any markdown text from outside the editor (another markdown file, ChatGPT/Claude output, GitHub raw view).
2. Paste into a markdown editor tab.
3. The whole paste becomes one code block.

**Expected:**
The paste lands rendered: `# Heading` becomes a heading, `- item` becomes a list, `**bold**` becomes bold. Plain prose stays prose. Existing fenced code blocks (with triple-backticks in the source) stay code blocks.

**Hypothesis:**
TipTap's default paste handler treats unknown text/plain content as code on the current schema (likely because of a `code-block` extension's paste rule that's matching too greedily, or because the `text/plain` clipboard payload is being routed through the code-block path before any markdown parser sees it).

**Suggested triage:**
1. Inspect the editor's TipTap configuration — which paste rules are registered, in what order? Look in `renderer/components/editor/extensions/` and `renderer/components/editor/MarkdownEditor.tsx`.
2. Add a markdown-aware paste rule that runs ahead of the code-block path: when `text/plain` clipboard data parses cleanly as markdown (or has structural markers like `#`, `-`, `*`, fenced blocks), parse it via the existing markdown→ProseMirror pipeline (whatever drives the initial doc load).
3. Edge cases to think through: pure prose with no markers should still paste as prose (not code); content with backtick-fenced code blocks inside should keep those as code blocks; smart-paste needs to not destroy line breaks in poetry/lists.

**Affected files:** `renderer/components/editor/MarkdownEditor.tsx`, `renderer/components/editor/extensions/` (paste rule lives here).

**Cross-refs:** ENH-002 (paste-as-plain-text — a complementary affordance for users who *want* the plain-text version).

---

### BUG-027: ⌘⇧T in browser focus opens claude tab instead of reopening last-closed browser tab

**Status:** ✅ Shipped v0.5.1 (PR 3, 2026-04-28) — `BrowserManager` grows a `closedTabs` stack (cap 10, skips `about:blank`); `closeTab` pushes the URL+title before tear-down; new `reopenLastClosed()` pops + addTab + switchTab. New IPC `BROWSER_REOPEN_LAST_CLOSED` + preload `browser.reopenLastClosed`. `useKeyboardShortcuts` dispatch branches: `pane === 'working'` → `browser.reopenLastClosed()`, otherwise → existing `newClaudeTab` (per BUG-008's universal-vs-pane-aware resolution). Verified live: opened `https://example.com/page1`, ⌘W'd it, ⌘⇧T from browser focus brought it back.
**Priority:** Medium (Chrome-parity on the browser pane; muscle memory)
**Filed:** 2026-04-27

**Today:**
Per BUG-008's spec resolution (2026-04-26 evening), ⌘⇧T was locked as "new claude tab everywhere" for predictability — flipping the previous Stage 19c assignment of "vanilla shell tab." From browser focus today, ⌘⇧T spawns a claude terminal tab.

**Owner request:**
Browser-pane ⌘⇧T should match Chrome: **reopen the last-closed tab** in the browser pane, not spawn a claude terminal tab.

**Expected (revised spec):**
- ⌘⇧T from browser focus → reopen the last-closed browser tab (Chrome parity).
- ⌘⇧T from terminal / files / editor focus → new claude tab (current behavior).
- Re-introduces pane-awareness on this specific shortcut, contra BUG-008's "universal" line.

**Spec impact:**
This re-opens the BUG-008 universal-vs-pane-aware debate that was closed in favor of universal. Worth documenting the rationale clearly in `globalShortcuts.ts` and the smoke matrix. Pane-awareness on the *browser pane* is closer to Chrome muscle memory than on the *terminal pane* — defensible to make ⌘⇧T pane-aware here without litigating ⌘T again.

**Implementation:**
1. `BrowserManager` grows a closed-tab stack — capped (~10), entries hold `{ url, title, favicon, closedAt }`. Push on `closeTab`, pop on reopen.
2. New IPC channel `BROWSER_REOPEN_LAST_CLOSED` + preload bridge entry.
3. `renderer/keyboard/globalShortcuts.ts` — change the ⌘⇧T row's intent from `'newClaudeTab'` to a pane-aware dispatcher (browser focus → `reopenLastClosedBrowserTab`; otherwise → `newClaudeTab`).
4. CLI parity per CLAUDE.md §4: `duo browser reopen` (or `duo tab reopen --kind browser`).

**Edge cases:**
- Stack empty → no-op (or subtle toast: "Nothing to reopen").
- Reopening a tab that's currently in another pane's history (e.g., the URL is also in current-session history) — fine, just open it fresh.
- Session restore + reopen — the closed-tab stack can persist across relaunch via `~/.claude/duo/session-state.json` (additive — defer to a later cut if it's friction).

**Affected files:** `electron/browser-manager.ts` (closed-tab stack), `electron/main.ts` (IPC), `electron/preload.ts` (bridge entry), `renderer/keyboard/globalShortcuts.ts`, `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`.

**Cross-refs:** BUG-008 (the universal-⌘⇧T resolution this revises); Stage 21c Phase 2 (session restore — fold the closed-tab stack into persisted state if needed).

---

### ENH-005: Copy button on code blocks (markdown editor + HTML canvas)

**Status:** ✅ Shipped v0.5.1 (PR 2 + PR 2 follow-up, 2026-04-28) — **both surfaces working live**:

- **Canvas (PR 2):** runtime-only buttons injected into the iframe contentDocument via `injectCodeBlockCopyButtons`. Marked `data-duo-canvas-runtime` so the serializer strips them on save.
- **Markdown editor (PR 2 follow-up):** PM widget + node decorations via the `CodeBlockCopyButton` extension. The node decoration adds the host class (`Decoration.node` survives PM transactions; direct `pre.classList.add` gets reverted). The widget decoration at `pos+1` renders a `<button>` inside the codeBlock content; CSS positions it absolute top-right of the pre. Click handler clones the `<code>` content, strips the button descendant, and `navigator.clipboard.writeText`s the cleaned text. Verified live: 2 buttons render on a 2-pre sample.md, click copies just the code text (no "Copy" label leakage).

**Files:** `renderer/components/editor/codeBlockCopyButton.ts` (canvas helper), `renderer/components/editor/extensions/CodeBlockCopyButton.ts` (TipTap extension), `renderer/components/editor/MarkdownEditor.tsx` (registration), `renderer/styles/globals.css` (positioning + hover-to-reveal).
**Priority:** Medium (high-value reading-side ergonomic)
**Filed:** 2026-04-27

**Today:**
Code blocks in both the markdown editor and HTML canvas render as syntax-highlighted (via lowlight + highlight.js) but have no affordance to copy the contents. User has to manually select-all and `⌘C`.

**Expected:**
Hover-to-reveal "Copy" button (top-right of each `<pre>` / `<code>` block) that copies the block's text content to the clipboard. Standard pattern (GitHub, Notion, Stack Overflow).

**Suggested implementation:**
- Markdown editor (TipTap): a code-block extension that renders a button alongside the block via `addNodeView()`. Or simpler: a renderer-level `useEffect` that scans `document.querySelectorAll('.tiptap pre')` and injects a button child.
- HTML canvas: similar — scan `<pre>` blocks in the iframe contentDocument and inject the button at iframe-load time. The button must NOT be persisted to disk (mark with `data-duo-canvas-runtime` so the serializer strips it on save, mirroring the existing runtime-chrome pattern).

**Affected files:** `renderer/components/editor/MarkdownEditor.tsx` (+ a new TipTap extension or DOM-level script), `renderer/components/HtmlCanvas/RenderedCanvas.tsx` (+ runtime-chrome injector).

---

### ENH-006: Right pane gets a "new browser tab" button (split-button pattern)

**Status:** ✅ Shipped v0.5.1 (PR 4, 2026-04-28) — `WorkingTabStrip` grew a split button mirroring `TabBar`'s terminal-strip pattern: `+` (primary, wider, ⌘N file) | `>` (secondary, narrower, ⌘T new browser tab). The browser-tab handler reuses the existing `addTab` + two-RAF address-bar focus dance (BUG-019 carryover), so the new tab arrives focused and ready for typing. Replaces the prior ⌥-click-on-`+` muscle memory with a discrete affordance that's visible at rest. **Note:** kept inline in `WorkingTabStrip` rather than extracting a shared `<SplitTabButton>` primitive — the two strips have minor styling differences and a 3rd consumer doesn't exist yet; defer the abstraction. Verified live: clicking `>` opened `about:blank` with the address bar selected.
**Priority:** Medium (mirrors terminal pane's discovery affordance for the working pane)
**Filed:** 2026-04-27

**Today:**
The WorkingPane tab strip has a `+` button that opens a file interstitial (⌘N flow). The terminal pane has a split `+` button (`+` = claude tab, `>` = shell tab — Stage 19c). Owner wants the WorkingPane to follow the same pattern: `+` for file (existing), and a sibling button for new browser tab.

**Expected:**
A second affordance on the WorkingPane tab strip — could be a `+ 🌐` button next to the existing `+` (file), or a split-button reuse (`+` defaults to last-used kind, `>` opens the secondary). Whichever mirrors the terminal-side convention.

**Owner phrasing:** "use same convention as double new button on terminal side."

**Suggested impl:**
- Reuse the same `<SplitTabButton>` primitive that Stage 19c built for the terminal strip — it's already a polymorphic split-button.
- Wire one half to the existing file-new flow, the other half to `electron.browser.addTab()` (which currently exists for the CLI path; just needs a UI binding).

**Affected files:** `renderer/components/WorkingTabStrip.tsx`, possibly `renderer/components/WorkingPane.tsx`. The Stage 19c split-button might need to be promoted to a shared primitive in `renderer/components/` (it currently lives in the terminal-strip component).

---

### ENH-007: Comment rail collapses but stays findable when all resolved

**Status:** ✅ Shipped v0.5.1 (PR 2, 2026-04-28) — `<CommentRail>` primitive grows internal `expanded` state. When every thread is resolved AND the user hasn't toggled expand, the rail collapses to a small "N resolved" pill (right edge of the canvas chrome). Click to expand into the full rail (in normal mode but with a "Hide" affordance in the header for re-collapse symmetry). Live verification deferred — would need a canvas authored to all-resolved state, which is awkward to set up in the dev smoke session; code-side review confirms the path. Both bindings (canvas Stage 17d already wired; markdown Stage 14 future) get this for free since it's primitive-level.
**Priority:** Low-Medium (BUG-015 hides it entirely; ENH-007 polishes "what if you've resolved all")
**Filed:** 2026-04-27

**Today:**
BUG-015 (shipped v0.3.1) gates the comment rail render on `railThreads.length > 0`. So when you have 0 OPEN threads (or 0 threads at all), the rail is hidden. The "🆕 there are 5 resolved threads but no open ones" case looks identical to "no threads at all" — the user has no way to see resolved comments.

**Expected:**
A collapsed pill / chip somewhere on the canvas chrome that says "5 resolved" (or similar), clickable to expand the rail in a "show resolved only" view. Mirrors how Google Docs / Notion handle resolved comments.

**Owner phrasing:** "comment rail looks good; rail should collapse but be findable when all comments resolved."

**Suggested impl:**
- Add a "rail toggle" affordance to the canvas toolbar / header: shows the count of resolved threads when there are 0 open. Click → reveals rail in resolved-only mode.
- Update `<CommentRail>` to support a `mode: 'open-only' | 'resolved-only' | 'both'` prop.
- The `data-duo-canvas-runtime` sentinel handles the "don't persist this UI to disk" part automatically.

**Affected files:** `renderer/components/editor/primitives/CommentRail.tsx`, `renderer/components/HtmlCanvas/CanvasTab.tsx`.

---

### ENH-009: Expand default external-domains.json bootstrap list

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — fresh-install defaults expanded to Slack/Gmail/Google Workspace/Atlassian/M365 (mile 1); existing-user additive merge folded into Stage 21e-iii
**Priority:** Medium-High (every Trailblazer hits Slack / Gmail / Google Docs daily; the embedded browser breaks SSO on most of them)
**Filed:** 2026-04-27

**Today:**
`electron/install-service.ts` (and the dev-only `sync:claude` script) bootstraps `~/.claude/duo/external-domains.json` with a single default: `["*.capitalone.com"]`. URLs matching it route to the system default browser; everything else stays in Duo's embedded `WebContentsView`.

**Owner observation:** "the block list of urls that duo browser should not attempt to open and should bounce to chrome/system browser, eg `*.capitalone.com`, `*.slack.com`, `gmail.com`, `docs.google.com`, other Google apps"

**Expected:**
A more comprehensive default list covering common SaaS apps that fail in the embedded browser due to SSO + corporate-managed browser requirements:

- `*.capitalone.com` (existing)
- `*.slack.com` (Slack web — SSO conditional access)
- `mail.google.com` (Gmail web — Google login + 2FA flows often broken in embedded)
- `docs.google.com` (Google Docs)
- `drive.google.com` (Google Drive)
- `calendar.google.com` (Google Calendar)
- `meet.google.com` (Google Meet — getUserMedia access patterns)
- `chat.google.com` (Google Chat)
- `accounts.google.com` (Google login flow, used by all Google apps)
- `*.atlassian.net` (Jira / Confluence — common enterprise SSO)
- `*.microsoftonline.com` (Microsoft 365 login — same SSO story as Atlassian)

**Two-mile fix:**

1. **Fresh-install defaults expand.** New install picks up the wider list. Lands cleanly in `electron/install-service.ts`'s bootstrap block + the `package.json sync:claude` dev script for parity. ~10 LOC.
2. **Upgrade-additive merge** (optional, deferred):
   - On version-bump install, read existing `external-domains.json`, parse `domains` array, add any MISSING bundled defaults (don't remove user entries, don't re-add entries the user explicitly deleted — would need a "dismissed-defaults" tracker for that, deferred).
   - Without this, existing users who already have an `external-domains.json` won't get the new domains. Workaround: delete the file → next launch re-bootstraps with new list.
   - Fold into Stage 21e-iii's provenance-aware install pattern (mile 2 belongs to v0.5.0 alongside the SHA tracking).

**v0.4.3 scope (this patch):** mile 1 only — fresh-install defaults expand. Document the existing-user migration path in release notes ("delete `~/.claude/duo/external-domains.json` to pick up the new defaults, or edit by hand").

**Affected files:**
- `electron/install-service.ts` (bootstrap defaults)
- `package.json` `sync:claude` script (dev-side parity)
- `fork.config.default.json` on the stage-21e branch (so the Vite-injected runtime defaults match — fold in when 21e rebases on v0.4.3)
- Release notes for v0.4.3 (existing-user migration note)

---

### ENH-008: Tooltip on "Your Claude settings" navigator pane

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — "Your Claude settings" + "Project Claude context" headers got explanatory `title` tooltips
**Priority:** Low (small comprehension nudge for non-technical PMs)
**Filed:** 2026-04-27

**Today:**
Stage 22 (v0.4.0) introduced the dual-pane navigator with the top pane labeled "Your Claude settings" — surfacing `~/.claude/CLAUDE.md` + `skills/` + `agents/` in plain English. The header is text-only with no explanation of WHAT these are or WHERE on disk they live.

**Expected:**
A tooltip / hover (or a small `(?)` glyph next to the header) explaining: "These files live at `~/.claude/` and apply to ALL of your Claude Code sessions, not just this project. Edit them to teach Claude your preferences globally."

**Owner phrasing:** "tooltip/hover that explains what these are (global for user) and where they live."

**Suggested impl:**
- `<UserClaudePane>` header gets a small `(?)` icon (or just title-attribute on the existing label) that surfaces the explanation on hover. Native browser title-attr is the lowest-effort option; a custom tooltip component would be richer but more work.
- Reciprocal tooltip on the bottom pane's "Project Claude context" section header would be symmetric ("These files live in this project's repo and apply only to Claude sessions started here").

**Affected files:** `renderer/components/UserClaudePane.tsx`, `renderer/components/ProjectClaudeContext.tsx`.

---

### ENH-010: Pinned files & folders section at the bottom of the navigator

**Status:** ✅ Shipped v0.5.0 (2026-04-27 night) — Stage 26 PR 2 landed Pinned section with right-click Pin/Unpin + CLI parity (`duo nav pin/unpin/pins`)
**Priority:** Medium (frequent-target shortcut for cross-folder workflows; pairs naturally with the rest of Stage 26)
**Filed:** 2026-04-27

**Today:**
The navigator's left pane has two sections — "Your Claude settings" (top, Stage 22) and the project tree (bottom, Stage 10) — but no surface for *user-pinned* files or folders. WorkingPane tab pinning (Stage 24) covers tabs in the right column, not the navigator. Frequent targets that aren't on the project tree's current visible subtree (e.g., `~/Documents/notes/inbox.md`, a sibling project's `tasks.md`, a deep config file) require manual breadcrumb navigation every time.

**Expected:**
A new third section at the *bottom* of the left pane labeled "Pinned" (collapsible, hidden when empty). Each entry shows:
- File icon (or folder icon for folder pins).
- Filename / folder name in primary text.
- A *shortened path* secondary line — e.g., `~/Documents/notes` or `…/sibling-project/.claude` — to disambiguate same-named files (`tasks.md` from three different projects, all pinned).

Entries are **grouped by parent folder** with the parent path as a small subdued group header. Single-/double-click semantics inherit from Stage 26 item 1 (single = select, double = open / reveal in tree).

**Pin scope (recommended for v1):**
- *Navigator pins are independent of WorkingPane tab pins* — different verbs, different storage. A user can pin a folder to navigate into quickly even if they never open it as a tab.
- Storage at `~/.claude/duo/nav-pins.json` (atomic tmp-rename writes; schema v1; corrupt → empty list). Mirrors Stage 24's `pins.json` shape but separate file.

**Pin verbs:**
- Right-click on any nav row → "Pin to navigator" / "Unpin from navigator". Pairs with the right-click menu added in Stage 26 item 6.
- CLI parity per CLAUDE.md §4: `duo nav pin <path>` / `duo nav unpin <path>` / `duo nav pins [--json]`.

**Open questions:**
- a. Drag-to-reorder within the Pinned section? Defer — v1 is insertion order or alphabetical-by-parent.
- b. Group expand/collapse per parent folder? Defer — v1 has flat groups; collapse the whole "Pinned" section as a unit.
- c. What does double-click on a *folder* pin do? Two options: (c1) open it as the navigator's current root (replaces breadcrumb); (c2) reveal-and-expand it in the project tree above. Pick (c1) for v1 — it's the "jump to" muscle memory; the tree always re-roots on entry.
- d. Shortened path algorithm: `~/` for home, `…/` for paths longer than ~30 chars. Pin to the same heuristic the breadcrumb uses for symmetry.

**Plumbing checklist:**
1. `shared/types.ts` — `NavPinsSnapshot` schema; new IPC channels `NAV_PINS_LOAD` / `SAVE` / `PUSH`.
2. `electron/preload.ts` — `electron.navPins.{load, save, subscribe}`.
3. `electron/main.ts` — IPC handler + atomic-write service (mirrors Stage 24's `pins-service.ts` — likely refactor to a shared `json-state-file.ts` helper since the pattern is identical).
4. `electron/socket-server.ts` — `nav pin/unpin/pins` cases.
5. `cli/duo.ts` — `duo nav pin/unpin/pins` subcommand parser. Rebuild binary.
6. `skill/SKILL.md` + `agents/duo.md` cheat-sheet.
7. `docs/CLI-COVERAGE.md` — inventory.
8. `renderer/hooks/useNavPins.ts` — new state machine (mirrors `useNavigator`).
9. `renderer/components/PinnedNav.tsx` — new section component, mounted at bottom of `FilesPane`.
10. `renderer/components/FilesPane.tsx` — slot the new section below the project tree; threading the `useNavPins` API.
11. `renderer/components/FileTree.tsx` — extend the row context menu (item 6) with Pin/Unpin entries.

**Affected files (high-level):** `shared/types.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/socket-server.ts`, `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`, `renderer/components/FilesPane.tsx`, `renderer/components/FileTree.tsx` (context menu), new `renderer/components/PinnedNav.tsx` + `renderer/hooks/useNavPins.ts`.

**Cross-refs:** Stage 24 (WorkingPane tab pins — separate concept, similar architecture; consider sharing a `json-state-file.ts` helper); Stage 26 item 6 (right-click menu — Pin/Unpin entries land there); Stage 26 item 8 (Go-to-path input — pinned folders are a common Go-to target, so the path input could optionally show pin matches as autocomplete).

---

### ENH-011: Plain-English rewrite of welcome / update banner copy

**Status:** 🆕 Filed
**Priority:** Medium (the install banner is the FIRST thing every new user sees; tone is load-bearing for AIP/Trailblazers cohort)
**Filed:** 2026-04-27

**Today (post-v0.4.5):**
The success-state copy and "Claude Code not detected" follow-up note got a plain-English pass in v0.4.5. The other three states still read like Stack Overflow:

- **Welcome (idle, fresh install):** "Welcome to Duo. Install the skill, subagent, help files, and CLI into `~/.claude/` + `~/.local/bin/`, and install a priming shim + SessionStart hook so `claude` sessions inside Duo arrive Duo-aware. Your existing files won't be touched."
- **Update available (idle, needsUpdate):** "Duo update available. Refresh the installed skill + subagent + help files + CLI + SessionStart hook in `~/.claude/` (currently at v{status.version})."
- **CLI install failed (success, !cli.installed):** "Installed. Skill + subagent + help files + SessionStart hook in `~/.claude/`. (CLI binary couldn't be copied — try again or symlink `cli/duo` manually.)"

Each one mentions terms the non-technical PM audience doesn't have a model for: "skill", "subagent", "priming shim", "SessionStart hook". Even reading them as a developer, the copy doesn't land — they're describing implementation, not outcome.

**Expected:**
The user model is "Duo will work with Claude" / "Update Duo" / "Something went a bit wrong but you can probably ignore it." Copy should match that register.

**Suggested rewrites (starter — wordsmithing welcome at write-time):**

- **Welcome:** "Welcome to Duo. Set up the files Duo needs to work with Claude — they go in `~/.claude/`, and we won't touch any of your existing files."
- **Update available:** "Duo update available — refresh the agent files in `~/.claude/` (currently from v{version})."
- **CLI failed:** "Installed. Agent files added to `~/.claude/`. (Couldn't drop Duo's CLI helper into `~/.local/bin/` — try again or symlink `cli/duo` manually.)"

Plus a sweep of inline jargon — "skill", "subagent", "priming shim", "SessionStart hook" — replaced with "agent files" / "make Claude Duo-aware" framing throughout. The technical terms can stay in code comments and the README, but the user-facing surface should be plain.

**Affected files:** `renderer/components/FirstLaunchBanner.tsx` (the idle / running / error / success-CLI-failed branches; success state was already partially rewritten in v0.4.5).

**Cross-refs:** v0.4.5 (which started this rewrite for the success state + shim-missing note); the broader "non-technical PM audience" thread that surfaced after v0.4.4 / v0.4.5 install. Owner pushback: "I barely understand it" / "that's not user-friendly" — the install banner copy is one of the first surfaces where Duo loses non-technical users.

---

### ENH-012: "Your Claude settings" navigator pane defaults collapsed

**Status:** ✅ Shipped in Stage 26 PR 2 (folded in 2026-04-27 evening)
**Priority:** Medium
**Filed:** 2026-04-27

**Today (post-Stage 22):** The "Your Claude settings" pane (top of the navigator) defaults to EXPANDED on first install. Owner observation while testing PR #29: "while we are working in the navigator, the 'your Claude settings' should default collapsed."

**Reason it matters:** Most users live in the project tree below. The user-claude pane is a settings-discovery aid — load-bearing on first use, then noisy when always-open. Defaulting collapsed gives the project tree more vertical room without removing the discovery surface.

**Fix (shipped):** `renderer/components/UserClaudePane.tsx § useState init` flipped — was `localStorage.getItem(LS_KEY) === '1'` (defaults expanded when null), now `localStorage.getItem(LS_KEY) !== '0'` (defaults collapsed when null). Users who explicitly expanded on a prior version have `'0'` in localStorage and stay expanded; first-launch users get the collapsed default.

---

### BUG-029: Right-click context menu on Pinned section gets clipped at viewport bottom

**Status:** ✅ Shipped v0.5.1 (PR 1, 2026-04-28) — `<ContextMenu>` now measures rendered height in `useLayoutEffect` and flips up/left when the natural position would overflow the viewport. Verified live: right-click on Pinned "Documents" at viewport bottom flipped the menu upward with all four items visible.
**Priority:** Medium
**Filed:** 2026-04-27

**Today:** Pinned section lives at the bottom of FilesPane. Right-click on a pin opens `<ContextMenu>` at the click `(x, y)`, rendering downward. If the row is near viewport bottom (usual case for pins), the lower menu items (Reveal in Finder / Unpin from navigator) extend past the window edge and clip.

**Suggested fix:** in `renderer/components/ContextMenu.tsx`, compute projected height (item count × ~32px + chrome) and flip upward when `y + projectedHeight > window.innerHeight`. Same logic should apply horizontally for right-edge clipping.

**Workaround:** use `duo nav unpin <path>` from the CLI. Functionally equivalent — though see BUG-030 for the renderer-refresh gap.

**Cross-cuts:** the same fix lifts the project-tree right-click menu (Stage 26 PR 1) and the inline-rename / Pin/Unpin entries to flip-aware behavior. Worth fixing once at the `<ContextMenu>` level.

---

### BUG-030: Navigator pin state doesn't push to renderer when changed via CLI

**Status:** ✅ Shipped v0.5.1 (PR 1, 2026-04-28) — new `IPC.NAV_PINS_CHANGED` push channel; `mainWindow.webContents.send` from both the IPC `NAV_PINS_TOGGLE` handler and the socket-server `nav-pin` op via new `NavBridge.pushNavPinsChanged`; `useNavPins` subscribes via `electron.navPins.onChange`. Verified live: `duo nav pin/unpin <path>` from a terminal flips the renderer's Pinned section count immediately, no reload.
**Priority:** Low
**Filed:** 2026-04-27

**Today:** `useNavPins` calls `electron.navPins.list()` ONCE on mount. CLI `duo nav pin/unpin` mutates `~/.claude/duo/nav-pins.json` on disk; main-process service sees it; but the renderer has no subscription, so on-screen Pinned section is stale until next renderer mount (reload / relaunch).

**Verified:** Pinned 2 files via right-click; ran `duo nav unpin <one>` from CLI; renderer still showed 2; after relaunch, showed 1 correctly.

**Suggested fix:** add an `IPC.NAV_PINS_CHANGED` push channel. Main broadcasts on every `NAV_PINS_TOGGLE` reply + every socket-server `nav-pin` op. Renderer's `useNavPins` subscribes via `electron.navPins.onChange(cb)`. Same pattern as Stage 21c's session-state push.

**Affected files:** `shared/types.ts`, `electron/main.ts`, `electron/preload.ts`, `renderer/hooks/useNavPins.ts`.

**Cross-refs:** Stage 24's `usePins` has the same shape (snapshot-on-mount, no push). A shared `json-state-file.ts` helper that bundles the push gives both systems live updates from one fix.

---

### BUG-028: Escape doesn't dismiss inline rename in navigator

**Status:** 🟡 Fix shipped v0.5.1 (PR 1, 2026-04-28) · live verification owed — computer-use harness can't send Escape keystrokes to Electron, so smoke walk left to owner. Code-side fix: Escape branch now calls `e.stopPropagation()` + sets a `cancelledRef` + explicitly calls `inputRef.current?.blur()` before `onCancel()`, with the blur handler short-circuiting when the cancel ref is set. Belt-and-suspenders against any React-18 batching path that could swallow the keydown's setState.
**Priority:** Medium
**Filed:** 2026-04-28 (referenced in roadmap + session log; never had a tasks.md entry)

**Today:**
Stage 26 PR 1 added inline rename: right-click → Rename flips the row label into a contenteditable input. ↵ commits, but ⎋ does not cancel — the input keeps focus, the rename state stays "in flight," and the only way out is to commit (or click elsewhere, which may or may not commit depending on blur handler).

Conventional file-tree spec (Finder, VS Code): ⎋ cancels rename, restores the original name, exits rename mode.

**Repro:**
1. Right-click a file row in the navigator → Rename.
2. Type a partial new name.
3. Press ⎋.

**Expected:** Input dismisses, original name restored, row exits rename state, focus returns to the row.
**Actual:** ⎋ does nothing visible; input keeps focus and content.

**Suggested fix:**
Inline-rename handler in `renderer/components/FileTree.tsx` (the row whose `isRenaming` flag is true) gets a `onKeyDown` branch:
```ts
if (e.key === 'Escape') {
  e.preventDefault();
  setRenamingId(null);  // exit rename state
  // input is unmounted; original label re-renders
}
```
Also worth ensuring blur doesn't auto-commit (or if it does, ⎋ has to set a flag the blur handler reads to suppress commit).

**Cross-cuts:** Same gesture model should apply to the Stage 26 inline-rename surface in the Pinned section (PR 2) — single rename-in-progress at a time, ⎋ cancels everywhere. Probably one cancel handler covers both surfaces if they share state.

**Affected files:** `renderer/components/FileTree.tsx` (row rename handler).

**Cross-refs:** Stage 26 PR 1 (the surface this lands on); BUG-029 (context menu clipping — same right-click flow surfaces both bugs together); BUG-030 (nav pins push channel — different bug, same PR cluster).

---

### ENH-013: "Send → Duo" pill enabled only when front terminal has a live Claude session

**Status:** ✅ Shipped v0.5.1 (PR 3, 2026-04-28) — strict mode (option a). New `electron/claude-presence.ts` polls the active terminal's PTY child-process tree via one `ps -ax -o pid,ppid,comm` walk every 500ms, looking for any descendant whose basename is `claude`. State machine: `'no-pty' | 'shell' | 'claude' | 'starting'` (the latter is a 1.5s grace window after a `kind: 'claude'` tab spawn so the pill doesn't flicker off during the launch gap). State pushes via `IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED`; renderer hook `useFrontTerminalClaudeLive` returns `state === 'claude' || state === 'starting'`. App.tsx gates the `onSendToDuo` prop on the hook — when false, pill primitive returns null entirely. PtyManager exposes `getPid(tabId)`. Renderer's `pushActiveId` now carries `kind` so main can arm the grace window correctly. Verified live: shell-only terminal + selected text in canvas → no pill. (CLI `duo terminal claude-state` deferred to a follow-up — not ship-blocking.)
**Priority:** Medium-High (correctness — the pill currently routes to dead PTYs / shell tabs and silently fails)
**Filed:** 2026-04-28

**Today:**
The "Send → Duo" pill renders on selection across three surfaces (markdown editor — Stage 15.1; browser pane — Stage 15.2; HTML canvas — Stage 17c) regardless of what's running in the focused terminal. If the user's front terminal is a bare shell (or a `kind: 'claude'` tab where they've `/exit`'d back to the shell), clicking the pill pushes selection text into a non-Claude prompt — looks broken.

`TabSession.kind` only records launch *intent*, not current process state — survives `/exit` to a bare shell, survives the claude process dying.

**Owner spec (option a — strict):**
- Pill is enabled only when the *front-of-terminal-column* tab has a live `claude` descendant in its PTY's process tree.
- Pill is disabled (or hidden — design call below) when: no terminals exist; front terminal has no claude descendant (bare shell); claude is mid-startup (>500ms gap from launch — see below).
- *Strict*, not permissive: even if another terminal tab has a live claude, the pill stays disabled until the user focuses that tab. Predictable trade for the muscle-memory cost.

**Implementation:**
1. **Process-tree probe.** New `electron/claude-presence.ts` (or fold into `electron/pty-manager.ts`) walks the PTY's child-process tree looking for a `claude` (or `node` running the claude entrypoint) descendant. Use `pgrep -P <ptyPid>` recursively, or one `ps -ax -o pid,ppid,comm` walk and filter. Sub-millisecond per walk.
2. **Polling loop.** Per active tab, probe every ~500ms while the tab exists. Cache last result; broadcast on flip only.
3. **State machine.** New `TerminalClaudeState` per tab: `'no-pty' | 'shell' | 'claude' | 'starting'`. `'starting'` covers the gap between `+ claude` click and the descendant appearing — gated by a 1500ms grace window from tab creation when `kind: 'claude'`. After the grace window, falls back to whatever ps says.
4. **IPC push channel.** New `TERMINAL_CLAUDE_STATE_CHANGED` channel — main → renderer broadcast on every state flip. Renderer caches `Map<tabId, TerminalClaudeState>`.
5. **Gating logic in the three pill sites.**
   - `renderer/components/editor/primitives/SendToDuoPill.tsx` (or wherever the pill primitive lives — locate during PR 3) reads `useFrontTerminalClaudeState()` hook.
   - When state !== 'claude' && state !== 'starting': render in disabled state (or hide entirely — owner picks during PR 3 walk; *recommend* render with grey-out + tooltip "Focus a Claude terminal to enable" so the user learns the rule, vs. silent disappear).
   - Same logic for the browser-pane pill and the canvas pill.
6. **CLI parity per CLAUDE.md §4.**
   - `duo terminal claude-state` → prints front-tab state (`shell` / `claude` / `starting` / `no-pty`).
   - `duo terminal claude-state --json` → all tabs as `[{tabId, kind, claudeLive, state}]`.
   - `duo terminal claude-state --tab <n>` → specific tab.
7. **Bonus: FOLLOWUP-002 piggyback.** The agent's session guard (`agents/duo.md`) currently relies on `$DUO_SESSION` env var checks; the same `pgrep` plumbing makes the agent guard cheaper and more robust. Land both at once.

**Edge cases to walk:**
- Claude crash → process disappears → state flips to `'shell'`, pill greys out. ✓
- `/exit` from claude back to shell → same as crash. ✓
- User runs `claude` directly (bypassing the `+ button` shim path) → descendant still named `claude`, state flips to `'claude'`. ✓
- Two terminal panes both with live claude — pill targets the front one only (per option a). Predictable.
- Terminal column not focused (browser focus / editor focus) → "front" is the most-recently-focused terminal tab. Same logic; the pill is about the routing target, not the user's current focus.
- Subprocess of claude (claude → bash → vim) — pgrep recursion finds claude in the chain regardless of depth. ✓
- Stage 19b PATH-shim wraps `claude --append-system-prompt` — descendant is still `claude`. ✓

**Affected files:**
- `electron/main.ts` (instantiate prober + broadcast)
- `electron/pty-manager.ts` (expose ptyPid per tab if not already)
- new `electron/claude-presence.ts` (the prober)
- `electron/preload.ts` (renderer subscription bridge)
- `electron/socket-server.ts` (new `terminal claude-state` case)
- `cli/duo.ts` (new verb + `printHelp()` update; rebuild binary)
- `shared/types.ts` (TerminalClaudeState type + IPC channel name + DuoCommandName extension)
- `renderer/hooks/useFrontTerminalClaudeState.ts` (new)
- `renderer/components/editor/primitives/SendToDuoPill.tsx` (gating)
- (browser-pane pill site + canvas pill site — locate during PR 3)
- `skill/SKILL.md` (verb cheat-sheet — sync:claude after)
- `agents/duo.md` (verb cheat-sheet entry under `## Verb cheat-sheet`)
- `docs/CLI-COVERAGE.md` (inventory)

**Cross-refs:** Stage 15.1 / 15.2 / 17c (the three pill sites); Stage 19c (`+ button` claude-launch — provides the `kind: 'claude'` marker we use as the grace-window seed); FOLLOWUP-002 (agent guard hardening — same plumbing).

**Open questions (decide during PR 3):**
- Disabled-pill UX: grey-out-with-tooltip vs. hide entirely. *Recommend* grey-out for discoverability.
- Polling cadence: 500ms vs. 1000ms vs. event-driven (xterm output sniff). *Recommend* 500ms polling for v1; event-driven is fragile across shell variants.
- Should `'starting'` count as enabled? *Recommend* yes — the user's intent is clearly "send to claude", and the pill click queues vs. fails, no worse than the existing flow.

---
