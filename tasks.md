# Duo — Bug & Task Backlog

> **Scope.** Engineering ledger — open work + root-cause writeups for
> closed bugs. **Canonical version-by-version inventory lives in
> [CHANGELOG.md](CHANGELOG.md)** and the prose log in
> [docs/RELEASES.md](docs/RELEASES.md); this file is the
> running notebook with the "why did this break, what did we learn"
> detail those don't carry.
>
> **Reading guide.** Status field on each entry: `🆕 Filed` / `🟡` /
> `⏳ Open` (active work) vs. `✅ Shipped vX.Y.Z` (closed; kept for
> historical reference). To find what's actively open at a glance:
> `grep -B1 "Status:\*\* (🆕\|🟡\|⏳)"`.
>
> **Pruning policy.** Closed entries stay until the lesson migrates
> to DECISIONS.md / CLAUDE.md plumbing checklist / smoke-checklist
> (then they're prune candidates). The file currently runs ~1500
> lines; not blocking anything, but a future cleanup cut can
> aggressively trim BUG-001..BUG-017 era entries since their lessons
> live elsewhere now.

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

**Status:** ✅ Shipped v0.5.1 (PR 5, 2026-04-28) — `FirstLaunchBanner` now reads in plain user-model English:

- **Welcome:** "Welcome to Duo. Set up the files Duo needs to work with Claude — they go in `~/.claude/`, and we won't touch any of your existing files."
- **Update available:** "Duo update available. Refresh the agent files in `~/.claude/` (currently from v{version})."
- **CLI install failed:** unchanged (already plain enough — "Couldn't drop Duo's CLI helper into `~/.local/bin/`; try again or symlink `cli/duo` manually.")
- **Success:** unchanged ("Installed. Claude inside Duo's terminals will arrive Duo-aware.")

Removed user-facing jargon: "skill", "subagent", "priming shim", "SessionStart hook" — replaced with "agent files" / "make Claude Duo-aware" framing. Technical terms remain in code comments + the README per the spec. Verified live: Update banner now reads "Refresh the agent files in ~/.claude/ (currently from v0.4.5)."
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

### BUG-031: HTML canvas / split-pane divider can't be dragged rightward (right pane shrinks-blocked)

**Status:** ✅ Fix shipped 2026-04-28 (v0.5.2 sprint PR 1) — option (1) overlay div implemented in `renderer/App.tsx` (`isDraggingSplit` state + `<div className="fixed inset-0 z-50 cursor-col-resize"/>` mounted while dragging). Verified in dev: synthetic mousedown on `.split-divider` mounts an overlay covering the full 1440×600 viewport; mouseup unmounts it. The iframe-trapping path is closed. **Browser-pane (WebContentsView) coverage is NOT in scope for this PR** — z-index can't push DOM above an Electron WebContentsView; if drag-over-browser repros for the user, file as a follow-up needing IPC-driven `setBounds` suppression during drag.
**Priority:** Medium-High (one of the most-felt papercuts; user can grow the right pane but never give it back to the left)
**Filed:** 2026-04-28

**Repro:**
1. Open a `.html` canvas (or any working-pane content that mounts an iframe / WebContentsView).
2. Drag the split divider rightward (intent: shrink the right pane, grow the terminal column).

**Expected:** Divider follows the cursor smoothly across the full 20–80% range, in either direction.
**Actual:** Drag works leftward (right pane grows). Drag rightward stalls — the divider stops as the cursor crosses the iframe's edge, even though `mousemove` is bound to `window`.

**Root cause (traced):**
`renderer/App.tsx:887–905` registers `mousemove` / `mouseup` on `window`, but iframes (HTML canvas) **and** the WebContentsView (browser pane) are out-of-process surfaces that *trap* mouse events when the cursor crosses into them. Once trapped, the events fire on the iframe's `contentDocument` window, never bubble up to the parent — so the parent's listener stops getting positions. The divider freezes wherever the cursor crossed the iframe edge.

The bug is invisible for empty / pure-text working-pane content because there's no out-of-process surface to capture events. It's specific to canvas + browser pane (which is most of the time the user is in a real layout).

**Proposed fix:** During an active drag, install a transparent overlay covering the entire split-container's right pane (z-index above the iframe + WebContentsView). Three patterns to consider:
1. **Overlay div (recommended).** While `isDragging.current === true`, render a `<div className="fixed inset-0 cursor-col-resize"/>` over the split area. Mouse events stay in the parent document. Cleanup on mouseup.
2. **`pointer-events: none` on iframes.** Toggle inline style on every mounted iframe + the WebContentsView host element. More invasive (need to know all surfaces); breaks if a new surface ships without registering.
3. **Pointer capture API.** `e.target.setPointerCapture(e.pointerId)` on mousedown — but this only works for events whose initial target is the divider itself, and the divider is a 1-2px sliver. Brittle.

Recommendation: **(1)**. One overlay element, one CSS class, no per-surface registration. Same pattern VS Code, Figma, and most pro web apps use for resize handles over rich content.

**Affected files (proposed):**
- `renderer/App.tsx` — extend `onDividerMouseDown` / mouse handlers to mount the overlay; read `isDragging.current` for visibility; cleanup on `mouseup`.
- `renderer/index.css` (or wherever split-divider styles live) — add `.split-drag-overlay` class.

**Cross-ref:** ENH-014 (pane-size presets — same divider plumbing).

---

### BUG-032: Canvas iframe steals focus from terminal on re-mount / agent edit

**Status:** ✅ Fix shipped 2026-04-29 (v0.5.2 sprint PR 4). `RenderedCanvas` accepts a new `shouldStealFocus` prop (default `true` for backwards compat); the `wire()` function reads it through a ref and only calls `doc.body.focus()` when truthy. `CanvasTab` gates it on `focused === true` (threaded from `WorkingPane.focused`, which is `focusedColumn === 'working'` at App.tsx). The ref-based read keeps the host effect from tearing down + re-mounting the iframe whenever focus toggles.

Effect: BUG-022's "first keystroke lands as content" ergonomic still fires when the user has the working pane focused. A re-mount triggered by srcdoc changes / HMR / post-doc-write reloads under terminal focus no longer yanks the cursor mid-typing.

**Re-reported 2026-04-30** (`20260430-improvement-notes.md` item 5 — "when focus is on terminal, and html canvas is open in work space, sometimes the cursor spontaneously jumps from the terminal to the html canvas"). Owner confirmed via AskUserQuestion that they were on a pre-v0.5.2 build; pull main + rebuild picks up the fix. No code change needed.

**Priority:** Medium (annoying mid-typing; intermittent so easy to dismiss until it happens enough)
**Filed:** 2026-04-28

**Repro (intermittent):**
1. Open an HTML canvas in the right pane.
2. Click into a terminal tab (focus on left pane).
3. Type into the terminal — at some point the cursor jumps into the canvas without the user clicking, and subsequent keystrokes land in the canvas.

**Root cause hypothesis (traced; needs confirm with logs):**
`renderer/components/HtmlCanvas/RenderedCanvas.tsx:162` calls `doc.body.focus()` on every iframe `load` event ("BUG-022 fix — focus the body when the canvas opens so the first keystroke lands as content"). The `wire()` function runs on the `load` event, which fires:
- Initial mount (intended).
- Whenever the iframe's srcdoc changes (e.g. `bumpVersion()` triggers a re-render via dependency on `[path, bumpVersion, readOnly, onCanvasAction, homeDir]` in CanvasTab's `onReady` effect — BUT the iframe srcdoc is keyed on initial HTML, not version, so this *shouldn't* re-fire).
- HMR re-mounts in dev.
- After a `duo html *` op that mutates the DOM enough to re-stamp srcdoc — we don't currently do this, but worth confirming.

The intermittency suggests the trigger isn't every-mutation but some specific path. Top suspects, in order:
1. Agent calls `duo html *` → DOM mutation observer fires `handleChange` → autosave fires → `setDirty(false)` → no re-render. Probably not it.
2. ENH-013's `useFrontTerminalClaudeLive` push-channel resubscribes the working-pane parent and the canvas re-mounts with `key={tab.id}` — but the key is stable per-tab, so this shouldn't tear down. Worth verifying with a `console.count` in `onReady`.
3. External file change (chokidar) — but neither editor wires file-watcher reload (confirmed: `grep -n "watch\|external\|reload" renderer/components/HtmlCanvas/CanvasTab.tsx renderer/components/editor/MarkdownEditor.tsx renderer/App.tsx` shows no path).

**Proposed fix:** Make the `body.focus()` call conditional on "canvas is the active pane focus." Two patterns:
1. **Skip focus when terminal column is focused** (recommended). RenderedCanvas accepts a `shouldStealFocus` prop; CanvasTab passes `focusedColumn === 'working'`. When the canvas re-mounts under terminal focus, no focus theft.
2. **Move the focus call to a one-shot effect** keyed only on initial mount — drop `wire()`'s focus side effect and put it in a separate `useEffect(() => { doc.body.focus() }, [])` that runs once.

Recommendation: **(1)** — keeps the BUG-022 ergonomic (first keystroke lands in canvas when the user opens one with intent) but doesn't fight focus when the user has clearly chosen a different surface.

**Affected files (proposed):**
- `renderer/components/HtmlCanvas/RenderedCanvas.tsx:148–162` — gate `doc.body.focus()` on a new prop.
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — pass `focusedColumn` through (already lifted in App.tsx; thread via a new prop or context).

**Verification asks:**
- Add a `console.count('[RenderedCanvas] wire fire')` instrumentation and reproduce, to confirm WHICH path causes the re-fire — root-cause certainty before code change.
- Repro on markdown editor (MarkdownEditor doesn't have an iframe so likely immune) — confirm.

**Cross-ref:** BUG-022 (the original "canvas should focus on open" fix that this regresses).

---

### BUG-033: Autosave races with `duo doc-write` / `duo html *` mid-edit

**Status:** ✅ v1 fix shipped 2026-04-29 (v0.5.2 sprint PR 5).
- **(a) Autosave paused while pending agent write is on screen.** Both surfaces add a `blockAutosaveRef` set true when `pendingWrite` / `pendingHtmlOp` becomes non-null. The timer is cleared immediately on transition to non-null; the change-handler arm-path skips queueing new timers while blocked. Save resumes naturally on accept / decline (the next user keystroke or sidecar mutation arms a fresh timer). Covers all three autosave call sites in `CanvasTab.tsx` (DOM-mutation handler, sidecar-mutation handler).
- **(b) Markdown replace-all banner copy sharpened.** `'Replace the whole document'` → `'Replace the whole document (your unsaved edits will be lost)'`. Canvas ops are already granular (`replace`, `set`, etc.) — no monolithic destruction surface, so existing copy stays.
- **(c) Diff preview already in tree** (140-char peek of the proposed text via existing `preview` prop on `WriteWarningBanner`). Both surfaces already pass it.

v2 still backlog: OT-style merge for `replace-selection` writes that land on dirty buffer; per-section locks. Stage 16 (external-write reconciliation) home.

**Priority:** Medium (real correctness risk — agent's writes can clobber user keystrokes; today partially mitigated by dirty-buffer banner)
**Filed:** 2026-04-28

**Today's behavior (traced):**
- **Markdown editor** (`MarkdownEditor.tsx:582–604`): clean buffer → agent's `duo doc-write` applies immediately. Dirty buffer → renders `WriteWarningBanner`, holds the IPC reply until user accepts/declines (Stage 13b). One pending write at a time; subsequent writes return `'Another write is awaiting the user's decision.'`
- **HTML canvas** (`CanvasTab.tsx:706–722`): same gate — dirty + write op → banner; clean + write op → applies immediately (Stage 17c PRD H36).

**The race the user is hitting:**
The dirty-buffer gate works *eventually*, but there's a window where the ergonomic outcomes can still surprise:

1. **Stale-snapshot save during agent write (canvas).** User types; autosave timer set for 800ms (`AUTOSAVE_DEBOUNCE_MS = 800`). Agent calls `duo html append`; clean-buffer-by-the-time-IPC-arrives → DOM mutates → MutationObserver fires → handleChange → autosave timer reset. But if user typed *just before* the agent op, the buffer is dirty → banner appears → user is mid-keystroke and accepts on muscle memory → applyDocWrite runs → user's recent keystrokes survive (DOM mutations merge), but the autosave that was queued for the user's earlier keystroke fires later and writes the merged state, in a non-deterministic order.
   *Why it feels like a fight:* the user sees their intended edit, the agent's edit, and sometimes a save state that looks half-applied — depending on the autosave timing.
2. **`replace-all` is silently destructive when accepted under typing.** The banner gives Yes/No. If the user accepts, `applyDocWrite` does `editor.commands.setContent(req.text, true)` — **replaces the entire buffer**. Anything the user typed between the agent's request and their acceptance is lost. The banner copy doesn't currently call this out (or does it — verify during fix).
3. **Markdown's banner accept doesn't pause autosave.** If autosave was about to fire and the user clicks accept, both happen.

**Proposed fix (split into v1 / v2):**

**v1 (small, ship soon):**
- (a) Pause the autosave timer while a `pendingWrite` is shown (markdown + canvas) — `clearTimeout` on banner show; user's accept/decline triggers the appropriate next state.
- (b) `WriteWarningBanner` copy update for `replace-all`: explicit "this will replace the entire document, including your unsaved changes." (Today's copy is generic.)
- (c) Add a "snapshot diff" preview to the banner so the user can SEE what the agent wants to write — at least a line count + "first 200 chars" peek. Lower-stakes acceptance.

**v2 (bigger):**
- (a) Operational-transform style merge for `replace-selection` writes that land on dirty buffer — apply the agent's insert at its anchor without dropping the user's edits. Not trivial; PM/TipTap supports this pattern but it's a real implementation.
- (b) Per-section locks: agent op declares a target anchor (`--id` or `--selector`); we lock just that subtree from user keystrokes for the brief op duration. Simpler than full OT; trades some keystroke-eating for guaranteed merge.

Recommendation: **v1 is the unblock**, ship in next bug-smashing sprint. v2 is a real Stage 16 (external-write reconciliation) item — fold there.

**Affected files (v1):**
- `renderer/components/editor/MarkdownEditor.tsx` — pause autosave timer on `setPendingWrite`; add diff preview to banner.
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — ditto (canvas's autosave timer at line 425–429).
- `renderer/components/editor/primitives/WriteWarningBanner.tsx` — accept new `mode` + `preview` props; render explicit `replace-all` warning + diff peek.

**Cross-ref:** Stage 13b (markdown banner), Stage 17c PRD H36 (canvas banner), Stage 16 (external-write reconciliation — v2 home).

---

### BUG-034: Canvas onboarding overlay occludes content on populated files

**Status:** ✅ Fix shipped 2026-04-29 (v0.5.2 sprint PR 2). Per the user's verbatim ask ("remove it and add a TODO to revisit"):
- `installPlaceholder` call site in `CanvasTab.tsx` replaced with a no-op (`cleanPlaceholder = () => {}`); import removed.
- TODO header added to `placeholder.ts` describing the right gate (`isJustBoilerplate(doc)` checked at install time, not on first mutation) so the Stage 17a.5 rebuild has the design context inline.
- Module file kept in tree as a starting point for the Stage 17a.5 onboarding refresh.

Verified: opening a populated `.html` (e.g. `~/demo.html`) now shows only its content — no centered "TYPE / SOON / SOON / SOON" card floating over the heading.

**Re-reported 2026-04-30** (`20260430-improvement-notes.md` item 4 — "the html canvas, on initial load, shows the 'features' view, which occludes the content below it; please just delete this feature"). Owner confirmed via AskUserQuestion that they were on a pre-v0.5.2 build; pull main + rebuild picks up the fix. No code change needed.

**Priority:** Medium (visible on every populated `.html` open until user types — high friction)
**Filed:** 2026-04-28

**Repro:**
1. `duo edit ~/some-existing-canvas.html` (or open via FileTree) — file has real content (not the boilerplate).
2. Canvas tab loads with the existing content visible — and a centered card overlay floating *over* the content showing "Markdown shortcuts work as you type · Component blocks via / · Start from a template · Ask the agent to draft this."

**Expected:** Overlay only on fresh / boilerplate canvases (which is what the original Stage 17a polish item 7 was scoped to).
**Actual:** `installPlaceholder` (`renderer/components/HtmlCanvas/placeholder.ts`) calls `refresh()` unconditionally at install time (line 168). There's no startup check against `isJustBoilerplate(doc)` — the helper exists at line 206 and is used only inside the MutationObserver callback to decide whether to dismiss on subsequent mutations.

So:
- Fresh canvas (boilerplate) → overlay shows → user types → first `input` event dismisses. ✓ intended.
- Populated canvas → overlay shows → MutationObserver checks on next mutation, sees `!isJustBoilerplate`, dismisses. But until a mutation fires (which on read-only viewing may be never), the overlay stays. ✗ bug.

**User's ask (verbatim):** "remove it and add a TODO to revisit."

**Proposed fix (matches the user's ask):**
1. **Remove the placeholder install entirely** for v1. Comment out the `installPlaceholder(doc)` call site in `CanvasTab.tsx` (or guard it behind a feature flag set to `false`).
2. **File the smart-blank onboarding work as a deferred substage of Stage 17a.5** with a note that the right gate is `isJustBoilerplate(doc)` checked at install time, not on first mutation. The `placeholder.ts` module stays in tree as a starting point for the rebuild.

**Cross-ref:** Stage 17a polish item 7, Stage 17a.5 directions A/E (template gallery / registry — overlap with the "soon" doors mentioned in the placeholder).

**Affected files:**
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — find + comment out `installPlaceholder` call (search `installPlaceholder` in CanvasTab; the import is at line 20).
- `renderer/components/HtmlCanvas/placeholder.ts` — leave as-is; add a top-level TODO comment "v1 disabled per BUG-034 — re-enable with isJustBoilerplate gate at install time."

---

### ENH-014: View menu — preset pane sizes (50:50, 67:33, 33:67, full-left, full-right)

**Status:** ✅ Shipped 2026-04-29 (v0.5.2 sprint PR 1, bundled with BUG-031). Menu surface, keyboard accelerators, and CLI verb all wired:
- View → Pane size submenu: Even (50/50), Terminal heavy (67/33), Canvas heavy (33/67), Full terminal (80), Full canvas (20).
- Accelerators: ⌘⌥1 = 67/33, ⌘⌥2 = 50/50, ⌘⌥3 = 33/67, ⌘⌥0 = full terminal, ⌘⌥9 = full canvas. (⌘1–⌘9 stayed bound to `jumpTerminalTab`, so the proposal's bare-⌘ scheme would have collided — escalating modifier picked the orthogonal slot.)
- CLI: `duo split <pct|even|terminal-heavy|canvas-heavy|terminal|canvas>`. Numeric arg clamps to 20–80. Returns `{pct}`.
- Plumbing: new `IPC.SPLIT_SET` channel; `setSplit` exported from `electron/main.ts`; new `'split'` case in `socket-server.ts`; `ElectronLayoutAPI` in shared/types + preload; App.tsx subscribes via `window.electron.layout.onSplitSet`.
- Persistence: session-only (matches today's `splitPct` state — not persisted across relaunches; queue for a follow-up if the user wants the preset to stick).

**Priority:** Medium (depends on BUG-031's fix — divider has to actually move both ways first)
**Filed:** 2026-04-28

**Why:** Users frequently want a known-good split — 50:50 for parity, ~67:33 for "terminal-heavy", inverse for "canvas-heavy." Doing this with the divider is finicky; a menu shortcut is faster.

**Proposed surface:**
- Native macOS Edit / View menu adds a "Pane size" submenu with: 50/50, 67/33 (terminal heavy), 33/67 (canvas heavy), Full terminal, Full canvas.
- Keyboard shortcuts for the three most-used: ⌘1 = 67/33, ⌘2 = 50/50, ⌘3 = 33/67.
- CLI parity per CLAUDE.md §4: `duo split <pct>` (0–100) sets the percentage. `duo split 50` mirrors the menu's 50/50.

**Affected files (proposed):**
- `electron/main.ts` — extend the application menu.
- `renderer/keyboard/globalShortcuts.ts` — register ⌘1/⌘2/⌘3 → `setSplit:33|50|67`.
- `renderer/App.tsx` — exposed setter / IPC handler.
- `cli/duo.ts` + `electron/socket-server.ts` — new `split` verb.
- `shared/types.ts` — `SPLIT_SET` IPC channel + `DuoCommandName` extension.

**Cross-ref:** BUG-031 (divider drag fix — must ship before this lands or the menu is the only way to resize, which is wrong).

---

### ENH-015: File-navigator collapse button discoverability

**Status:** 🆕 Filed
**Priority:** Low-Medium (button exists today; this is purely visibility)
**Filed:** 2026-04-28

**Today:** `CollapseButton` exists at `renderer/components/FilesPane.tsx:234–249`. Renders next to the pin button in the Files header. Icon: 12×12 chevron-into-rail SVG. Color: `text-zinc-600` → `hover:text-zinc-300`. Tooltip: "Collapse files column (⌘B)."

**User's report:** "cannot find the button to collapse the file navigator — is there one? I can see the button to un-collapse it when it is collapsed via window size."

The button **is there.** It's just too muted to find. Three things compound the discoverability:
1. **Color contrast** — `zinc-600` is barely-there on the cream surface; the eye doesn't catch it.
2. **Position** — sits to the right of the pin button, which is itself a small icon. Two small icons next to each other read as a single "controls cluster."
3. **Icon glyph** — the chevron-into-rail is unconventional (most apps use a sidebar / hamburger / stack). Users don't recognize it as "collapse."

**Proposed fix:** Three small things:
1. Bump default color to `text-zinc-500` or `text-zinc-400` so the glyph is visible at rest.
2. Swap the glyph for a more conventional sidebar-toggle icon (matches macOS Finder's sidebar toggle, VS Code's sidebar toggle).
3. Consider a one-time tooltip / coach-mark on first launch ("⌘B toggles the files column") — but this is an FTUX additive, not strictly required.

**Affected files:**
- `renderer/components/FilesPane.tsx:234–249` (CollapseButton — color + glyph).

**Cross-ref:** Stage 18 (FTUX) for the optional coach-mark.

---

### ENH-016: Create new file / new folder from FileTree context menu

**Status:** 🆕 Filed
**Priority:** **High** (parity with VS Code / Finder; re-asked 2026-04-30 with explicit "new folder" emphasis)
**Filed:** 2026-04-28 · re-asked 2026-04-30 (`20260430-improvement-notes.md` item 3 — "need new folder button in file explorer")

**Today:** Right-clicking a row in the FileTree (`renderer/components/FileTree.tsx:174–223`) shows: Open terminal here / Open in editor, Reveal in Finder, Copy path, Open with default app, Pin/Unpin, Rename, Move to Trash. **No "New file" or "New folder."**

`⌘N` exists for "new markdown file" (`App.tsx § onCommitNewFile`) but it spawns at the active pane / project root, not at the right-clicked folder. There's no way to "new file inside this folder" without a terminal.

**Proposed surface:**
1. Right-click a folder row → context menu adds **"New file…"** and **"New folder…"** at the top (above "Open terminal here").
2. Right-click a file row → menu adds **"New file in this folder…"** and **"New folder in this folder…"** (parent folder is the implicit target).
3. Right-click empty space inside the FileTree (no row hit) → menu shows "New file…" / "New folder…" / "Reveal in Finder" / "Open terminal here" against the project root.
4. Selection: clicking either entry reveals the new row inline in the tree with the rename input pre-focused (re-uses the existing `RenameInput` component). Empty default name; commit on Enter, cancel on Esc.

**CLI parity per CLAUDE.md §4:** Already covered — `duo new-file <path>` and `mkdir` from a terminal both work. The CLI side doesn't need new verbs; this is pure UI.

**Affected files (proposed):**
- `renderer/components/FileTree.tsx:174–223` — extend `buildContextMenu` to include the new entries; thread handlers from caller.
- `renderer/components/FilesPane.tsx` — handle `onContextMenu` on the empty area below the tree (currently drops; add a fallback menu).
- `renderer/App.tsx` (or wherever FileTree is mounted) — wire `onCreateFile(parent: string)` / `onCreateFolder(parent: string)` callbacks; reuse the `onCommitNewFile` plumbing.
- `electron/files-service.ts` — confirm `mkdir` / `writeFile` are exposed to renderer (they are; `files.write` works for new paths).

**Open questions:**
- For a new file, what's the default extension? Recommend: leave the rename input fully blank (user types `name.ext`); auto-classify on commit via `fileClassifier.ts`.
- For a new folder created via context menu on a file-row, do we expand the parent folder in the tree before showing the inline rename? Recommend: yes (otherwise the new row is invisible in a collapsed parent).

**Cross-ref:** Stage 26 (navigator polish — this folds into PR 3 ambient signals + Go-to path or stands alone).

---

### ENH-017: Install service offers to add CLI dir to shell PATH

**Status:** ✅ Shipped 2026-04-29 (v0.5.2 sprint PR 6). Banner-driven action:
- `installService.addToShellPath()` detects shell from `$SHELL` (zsh / bash / fish), picks the right rc file (`~/.zshrc`, `~/.bash_profile`, `~/.config/fish/config.fish`), and appends a fenced `# >>> duo PATH ... # <<< duo PATH <<<` block. Idempotent — re-runs detect the fence and return `{alreadyPresent: true}` without rewriting.
- `INSTALL_ADD_TO_PATH` IPC channel + `install.addToShellPath()` preload exposure.
- New `showAddToPathNote` row in `FirstLaunchBanner` renders when `cli.installed && !cli.onPath` (post-install state). Three sub-states: idle ("Use duo from outside the app? Add to PATH" + button), running ("Updating shell config…"), done (success copy that names the rc file + tells the user to open a new terminal or source it), error (manual-line fallback copy).

Failure modes are explicit (unrecognized shell, rc not writable) and surface a manual-line copy block. Cross-platform: macOS-only as scoped (Windows/Linux deferred).

**Priority:** Medium (current banner-hint flow loses users; "duo command not found" is the most-cited papercut in retros)
**Filed:** 2026-04-28

**Today (traced):**
- `electron/install-service.ts:73` — `CLI_DEST_DIR = ~/.local/bin`. CLI lands at `~/.local/bin/duo`, chmod 755.
- Stage 19b PATH shim → `~/.claude/duo/bin/claude` (a wrapper, not a duo binary).
- `isOnPath()` (line 193) checks if `~/.local/bin` is on `process.env.PATH`. Surfaces a banner hint in the install panel.

The banner only tells the user "add this line to your shell rc" — it doesn't *do* it. Most users either don't see the hint, or skip it on first read, then hit "duo: command not found" the first time they try the CLI from a Duo terminal.

**User's feedback (retro):** "neither `~/.claude/bin` nor `~/.local/bin` is on $PATH, even though duo install correctly symlinked the cli to both locations. Is this something that the install script should improve?"

(Note: `~/.claude/bin` doesn't exist as a CLI install target today — the user may be conflating with `~/.claude/duo/bin/claude` shim. Confirm during fix.)

**Proposed fix:**
1. **Add a "Add to PATH" button to the install banner.** Click → install service appends `export PATH="$HOME/.local/bin:$PATH"` to the user's shell rc:
   - Detect shell from `$SHELL` env: `zsh` → `~/.zshrc` (or `~/.zshenv` if it exists; zsh users with chezmoi/dotfiles often prefer `.zshenv`).
   - `bash` → `~/.bash_profile` (macOS convention) with fallback to `~/.bashrc`.
   - `fish` → `~/.config/fish/config.fish` (different syntax: `set -gx PATH $HOME/.local/bin $PATH`).
2. **Idempotent.** Wrap the appended line in a fenced block:
   ```
   # duo PATH (added by Duo installer; safe to remove or move)
   export PATH="$HOME/.local/bin:$PATH"
   # /duo PATH
   ```
   On re-install, detect the fence and skip if already present. If user moved the line manually, leave their version alone.
3. **Tell the user what to do next.** Banner success state: "Added `~/.local/bin` to your PATH in `~/.zshrc`. Open a new terminal (or run `source ~/.zshrc`) to pick it up."
4. **Surface failure modes clearly.** If the rc file is owned by another user, read-only, or in a non-standard location, show the manual-line copy block as today. Don't fail silently.

**Risks + safeguards:**
- Editing user shell rc files is invasive. Pattern: prompt explicitly via the banner button (not a silent default). Document the change in the success state. Use a fenced block so future-Duo can detect / remove its own line.
- Some users have `.zshenv` *and* `.zshrc` and PATH gets reset by `.zshrc` after `.zshenv` — appending to `.zshrc` is the safe default. Document this in the banner copy.
- macOS Bash users with `.bash_profile` *and* `.bashrc` — same hierarchy concern. `.bash_profile` for login shells (Terminal default), so that's the right target.

**Affected files (proposed):**
- `electron/install-service.ts` — new `addToShellPath()` method; called from a new IPC handler.
- `electron/main.ts` — register IPC handler.
- `electron/preload.ts` — expose `install.addToShellPath()` to renderer.
- `renderer/components/FirstLaunchBanner.tsx` (or wherever the install banner lives) — render the "Add to PATH" button when `isOnPath === false`.
- `shared/types.ts` — IPC channel + result type.

**Cross-ref:** Stage 18 (FTUX — install service home), Stage 19b (PATH shim — overlapping concern), retro feedback from Capital One trailblazers cohort.

**Open questions:**
- Should it offer to fix the shim path too (`~/.claude/duo/bin` for the `claude` wrapper)? That's already handled silently by the shim install — and it's only on PATH if the user has set it up. Recommend: same button covers both PATHs (symlink dirs the install service writes to).
- Windows / Linux story? Out of scope for v1 — Duo is macOS-only today. File as a follow-up if/when cross-platform lands.

---

### BUG-035: False-positive "Couldn't find Claude Code" banner when shell init takes >5s

**Status:** ✅ v1 fix shipped 2026-04-29 (v0.5.2 sprint PR 3). `electron/resolve-claude.ts` now:
1. Walks well-known absolute install dirs (`~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.bun/bin`, `~/bin`) + every entry in `process.env.PATH` with `fs.access(..., X_OK)` BEFORE attempting any shell.
2. Falls back to shell only when fast path misses; bumps per-attempt timeout from 5s → 15s; reorders flag-sets fastest-first (`-l` before `-l -i`).

**Verified on the user's machine:** the previously-timing-out call (5236ms, hit timeout) now resolves in **0.8ms** via the fast path (`~/.local/bin/claude`). 6500x speedup.

v2 (still backlog): banner copy that distinguishes "rc is slow" vs "claude genuinely missing"; in-banner `duo doctor` retry.

**Priority:** High (visible-on-every-launch friction; the banner accuses users of not having Claude Code installed when they do)
**Filed:** 2026-04-29

**Repro (timed on the user's machine):**
```
$ time zsh -l -i -c 'command -v claude'
/Users/geoffreydudgeon/.local/bin/claude
zsh -l -i -c 'command -v claude'  2.12s user 1.91s system 77% cpu 5.236 total
```

The shell takes **5.236s** to spawn-resolve. The resolver's per-attempt timeout is **5000ms** (`electron/resolve-claude.ts:69`), so the first attempt times out. The next attempts (`-i -c`, `-l -c`) likely time out the same way for users with rich `.zshrc` (NVM, conda, plugins). All three flag-sets time out → resolver returns `null` → `installShim()` throws → `priming.shimInstalled = false` → the banner copy `"Couldn't find Claude Code on this Mac. Duo searched your usual shell paths and didn't see claude."` fires falsely.

**Root cause:**
1. **Timeout too short** for users with slow rc files. 5s is below the realistic ceiling for a login-interactive zsh on a populated dev machine (NVM source, conda init, oh-my-zsh, asdf shims, etc.).
2. **No fast path** — the resolver always pays the cost of a full login-interactive shell load even when `claude` is already on `process.env.PATH` or in a well-known install location.
3. **Silent failure** — `try/catch` discards the actual error code (timeout vs ENOENT vs rc-file syntax error), so the false-positive banner gives the same copy whether the user lacks claude entirely or simply has slow rc files. No diagnostic surface.

**Proposed fix (split into v1 / v2):**

**v1 (small, ship soon):**
1. **Fast path before shell:** check well-known absolute install locations directly with `fs.access` — `~/.local/bin/claude`, `~/.npm-global/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.volta/bin/claude`, `~/.bun/bin/claude`, plus every entry in `process.env.PATH`. Return the first executable hit. Costs ~5–10 stat calls (~ms total) vs ~5–15s for the shell path. Catches the vast majority of installs without ever spawning a shell.
2. **Bump timeout to 15s** for the shell-fallback path. The user's measured 5.2s sets the realistic floor; 15s gives 3x headroom for users with even fattier rc files.
3. **Order shell variants fastest-first:** try `-l -c` (no `.zshrc`, fast) before `-l -i -c` (full load, slow).

**v2 (later):**
- Surface the actual failure mode in the banner: distinguish "rc file is slow" (suggest `duo doctor` or shell tuning) from "claude not on PATH at all" (suggest install link). Today's monolithic copy hides the difference.
- Auto-retry via `duo doctor` button right in the banner: spawns a one-shot login shell with longer timeout and shows the real `command -v claude` output.

**Affected files (v1):**
- `electron/resolve-claude.ts` — add `tryFastPaths()` that walks well-known locations + `process.env.PATH` before falling through to shells. Bump shell timeout to 15s. Reorder flag-sets so the fastest combo (no `-i`) goes first.

**Cross-ref:** v0.4.5 was the previous "Claude not detected" fix (drift between install-service and main.ts on which shell flags they used). This is a similar issue (timeout / fast-path) that v0.4.5's all-shell-fallback approach didn't anticipate.

---

### BUG-036: ⌘T from terminal focus opens browser tab — should open vanilla shell tab (decision reversal)

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W1). `useKeyboardShortcuts` dispatcher is now pane-aware:
- `⌘T` from terminal focus → `newShellTab()` (front terminal's launch CWD via `pendingCwd`).
- `⌘T` from any other focus → `newBrowserTab()` (Chrome parity, unchanged).
- `⌘⇧T` from terminal focus → `newClaudeTab()` (front terminal's launch CWD).
- `⌘⇧T` from browser focus → `reopenLastClosed()` (BUG-027, unchanged).
- `⌘⇧T` from any other focus → `newClaudeTab()` (unchanged).

The matcher in `globalShortcuts.ts` stays pane-agnostic (returns canonical `newBrowserTab` / `newClaudeTab` IDs); pane mapping is at dispatch only. `what-duo-does.html` items 18 + 19 updated to reflect the new bindings.

Note: "current CWD" resolves to the active tab's launch CWD (not live cwd post-`cd`). Live-cwd tracking would require an OSC 7 hook in PtyManager — separate ENH if requested. Pairs with Stage 26 PR 3 item 2 (active terminal CWD highlight) which has the same dependency.

**Priority:** Medium (revives pane-aware ⌘T mental model; reverses BUG-008 spec resolution)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 2)

**Owner ask:** "need to revert decision: cmd+t in terminal should open new terminal, not new browser tab"

**Resolution clarified 2026-04-30 (AskUserQuestion):**
- `⌘T` from terminal focus → **vanilla shell tab in current CWD**.
- `⌘⇧T` from terminal focus → **claude tab in current CWD**.
- `⌘T` from browser focus → new browser tab (Chrome-parity, unchanged).
- `⌘T` from files / editor / canvas focus → fall through to new browser tab (current behavior; recommend keep — only the terminal pane has a coherent "new of this kind" gesture).

**Today (post-BUG-008 + v0.2.0):**
- `renderer/hooks/useKeyboardShortcuts.ts` — `⌘T` everywhere → `newBrowserTab()`; `⌘⇧T` → `newClaudeTab()` from any focus.
- `renderer/components/TerminalPane.tsx` xterm allowlist bubbles `⌘T` / `⌘⇧T` to the window so the global handler fires.
- The `>` (shell) button on the terminal strip is the only path to a vanilla-shell tab today.

**What changes:**
1. `⌘T` branch in `useKeyboardShortcuts.ts` becomes pane-aware: `activePaneFocus === 'terminal'` → spawn shell tab at front terminal's CWD; otherwise → `newBrowserTab()`.
2. `⌘⇧T` branch becomes pane-aware too: from terminal focus → claude tab at front terminal's CWD; from any other focus → claude tab at last-known CWD (keeps the universal "spawn a Claude" affordance).
3. Front-terminal CWD plumbing already exists for the navigator/breadcrumb (Stage 10) and is being threaded for Stage 26 PR 3 item 2 (active-CWD highlight). Reuse it here.

**Cross-ref:** BUG-008 (the spec this reverses) — its "Chrome-parity ⌘T everywhere" rationale loses to "pane-aware muscle memory" once a user spends time in terminals. The discovery affordance for browser tabs lives on the browser pane's split `+` button (Stage 19c / ENH-006).

**Open questions:**
- Update `docs/dev/smoke-checklist.md § 5` keyboard matrix.
- `~/.claude/duo/help/faq.html` "⌘T conflict" entry needs rewrite; `what-duo-does.html` "Open a Claude tab" line stays accurate (`⌘⇧T` still spawns Claude).
- Roadmap card for Stage 19c gets a third spec note (this is now its third revision).

**Affected files:**
- `renderer/hooks/useKeyboardShortcuts.ts`
- `renderer/App.tsx` (thread current-CWD into the hook)
- `docs/dev/smoke-checklist.md`
- `~/.claude/duo/help/faq.html`

**Class of issue:** spec-revision (third on the `⌘T` family). Worth adding a note in `DECISIONS.md` once this lands so the next future-Claude doesn't re-debate it.

---

### BUG-037: HTML canvas — clicking inside the canvas while focus is elsewhere doesn't switch focus to it

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W1). Iframe-mousedown forwarder pattern: `RenderedCanvas` accepts `onUserInteract?: () => void`; inside `wire()` it attaches a capture-phase `mousedown` listener to the iframe document that calls the prop (read through a ref so prop changes don't re-mount the iframe). `CanvasTab` + `WorkingPane` thread it up; `App.tsx` passes `onCanvasFocusGained={() => setFocusedColumn('working')}`. Symmetric to BUG-032: that fix stopped the iframe from STEALING focus when the user had chosen another surface; this lets the iframe ACQUIRE focus when the user clicks in.
**Priority:** Medium (breaks the "click → focus" invariant; cascades into wrong-pane keyboard shortcuts)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 9)

**Owner observation:** "when focus is not on html canvas, clicking within the html canvas does not switch focus there"

**Repro:**
1. Open an HTML canvas in the working pane.
2. Click into the terminal so the terminal column has focus (orange chrome strip).
3. Click anywhere inside the canvas iframe.

**Expected:** The working column gains focus (chrome strip flips orange) AND the click places a cursor in the canvas body.
**Actual:** The cursor may place (BUG-023's "click anywhere → cursor lands" path) but `focusedColumn` stays `'terminal'`. Subsequent ⌃Tab cycles the wrong pane's tabs; subsequent ⌘T spawns the wrong-pane new-tab.

**Root cause hypothesis (untraced):**
The canvas iframe is a separate document. Click events inside the iframe don't bubble to the outer column wrapper's `onMouseDown` handler that sets `focusedColumn`. The outer wrapper sees the click happening on the `<iframe>` element itself (outer DOM), not on its contents.

For comparison: clicking into the markdown editor (no iframe) DOES flip `focusedColumn` because the contentEditable lives in the same document.

**Suggested fix:**
Install a `mousedown` listener on the iframe's document; on first interaction, post a message / call a parent-exposed setter that sets `focusedColumn = 'working'`. Pattern is symmetric to BUG-032's iframe focus-steal solution (it added an opt-out for iframe → terminal focus theft; this adds an opt-in for terminal → canvas focus acquisition on user click).

```ts
// renderer/components/HtmlCanvas/RenderedCanvas.tsx
iframe.contentDocument.addEventListener('mousedown', () => {
  onUserClickInCanvas?.()  // parent calls setFocusedColumn('working')
}, { capture: true })
```

**Affected files:**
- `renderer/components/HtmlCanvas/RenderedCanvas.tsx`
- `renderer/components/HtmlCanvas/CanvasTab.tsx` (forward the prop)
- `renderer/App.tsx` (pass setter)

**Cross-ref:** BUG-022 (canvas should focus body on open — opposite gesture, same component); BUG-032 (canvas iframe focus-steal — opposite direction); BUG-023 (click anywhere places cursor — adjacent fix).

---

### BUG-038: ⌃Tab cycle still skips some tabs (BUG-021 follow-up)

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W1). Diagnosis + fix:

**Root cause confirmed.** The cycle logic itself in `useKeyboardShortcuts.ts § cycleTabsForward / Backward` is correct (reads from refs, indexes by id, advances mod length). The bug was upstream: `focusedColumn` was getting stuck at `'working'` when the user thought they were "in" a terminal, so `pane !== 'terminal'` and the cycle went through browser tabs (which has fewer entries) — exactly matching the user's "right few tabs reachable" report.

Two paths where focus tracking lost the user's intent:
1. **Click into HTML canvas** — iframe events don't bubble to the column wrapper's `onMouseDown`, so `focusedColumn` stayed wherever it was last set. Fixed by BUG-037's mousedown forwarder.
2. **Focus arriving at xterm via a non-click path** — `webContents.focus()` reclaim (BUG-002), `⌘`-pane-cycle, post-spawn PTY init. xterm manages its own DOM heavily; the column wrapper's React `onMouseDown` doesn't fire on these.

**BUG-038-specific fix:** TerminalPane installs a `focus` listener on xterm's helper textarea. Whenever xterm gains focus by ANY path (click, programmatic, key-routed), `focusedColumn` flips to `'terminal'`. Belt+braces over the column wrapper's onMouseDown.

**Durable test coverage** (per the recurring-class regression rule):
- `docs/dev/smoke-checklist.md` row 11 expanded with **11b** (full-cycle: open ≥4 tabs, ⌃Tab N times, every tab visited, including post-session-restore) and **11c** (cross-pane focus tracking: alternate clicking terminal → canvas → terminal, ⌃Tab routes correctly each time).
- A unit test framework isn't in place yet (PROCESS-001 Phase 2 deferred); when it lands, the cycle helper extracts cleanly into a pure function for fixture-based testing.

**Class summary.** This is the third instance of "⌃Tab doesn't reach all tabs" (BUG-001, BUG-021, BUG-038). The first two were closure / xterm-eats-shortcut bugs; this one was a focus-tracking bug. All three resolutions are now structural: capture-phase matcher, ref reads, focus-event listeners. The smoke checklist row covers the scenario going forward.

**Priority:** Medium (load-bearing for tab navigation; user reports recurrence on 2026-04-30)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 11)

**Owner observation:** "still an issue where some tabs are included when we cycle (ctrl-tab) through tabs, others are not; currently I can only cycle through the right few tabs with ctrl-tab, but not the rest"

**Context:**
BUG-021 (shipped v0.4.3) fixed the closure-stale-tabs case by switching the cycle handler to read `tabs` via a ref instead of capturing it in a useEffect closure. The user is reporting a different symptom — ⌃Tab reaches some tabs but not others, asymmetrically (not just "session-restored tabs unreachable" which BUG-021 closed).

**Triage hypotheses:**
1. **Pinned tabs sort vs. cycle order.** Stage 24 pins sort to leftmost; does the cycle iterate `tabs` in display order (post-sort) or insertion order? If insertion, pinned tabs may be skipped when cycling forward from a non-pinned tab.
2. **Browser vs. terminal cycle list sync.** ⌃Tab in browser focus → `browser.getTabs()` + `switchTab(nextId)`; ⌃Tab in terminal focus → terminal-tab cycle. Are the two cycle lists aligned with the strip's display order?
3. **`focusedColumn` stale during transitions.** If ⌃Tab fires while focus is mid-transition, the cycle may consult the wrong pane's list.
4. **First-tab special handling (BUG-020 era).** The first FAQ tab has historical special-casing — confirm it's not being treated as "outside the cycle list."

**Verification ask (owner):** enumerate WHICH tabs are reachable vs. not in a specific repro session — e.g., "5 terminal tabs, ⌃Tab reaches tabs 3/4/5 but skips 1/2." The asymmetry will narrow the hypothesis.

**Class of issue:** Recurring regression on the same family of code. Per the global preference for durable test coverage on recurring regressions, this fix should land WITH a regression test that opens N terminal + browser tabs, presses ⌃Tab N times from each pane focus, and asserts every tab ID was visited exactly once.

**Cross-ref:** BUG-001 (xterm-eats-shortcut, three-part fix), BUG-021 (closure-stale tabs, ref fix). This is the third instance of "⌃Tab doesn't reach all tabs."

**Affected files (suspected):** `renderer/hooks/useKeyboardShortcuts.ts`, `renderer/App.tsx`.

---

### BUG-039: Session restore errors when a previously-open file was deleted between sessions

**Status:** 🆕 Filed
**Priority:** Medium-High (visible-on-launch error; common case for any user who deletes files between sessions)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 12)

**Owner observation:** "when a file that was open in a session is deleted between sessions, duo attempts to reopen the tab/file at relaunch, and shows an error (because it is gone)"

**Repro:**
1. Open a file (e.g. `~/Documents/notes/scratch.md`) in a WorkingPane tab.
2. Quit Duo.
3. Delete the file from disk (Finder / `rm`).
4. Relaunch Duo.

**Expected:** Either the tab is silently dropped during session-restore hydration, OR it opens with a friendly placeholder ("file not found at `<path>` — close tab? reveal parent in Finder?").
**Actual:** Duo attempts to read the file, hits ENOENT, surfaces an unhandled error in the tab.

**Suggested fix:**
During session-restore tab hydration, `fs.access(path)` each restored file path before pushing the tab into `tabs`. On ENOENT: drop silently OR push a `kind: 'missing-file'` tab shape that renders a placeholder. Recommend the placeholder for better mental-model continuity (the user knows what disappeared); silent drop is fine as a 30-LOC v1.

**Affected files:**
- `electron/session-store.ts` (session hydration)
- `renderer/App.tsx` (restoreTabs hydration block)
- `renderer/components/WorkingPane.tsx` (placeholder kind, if added)

**Cross-ref:** Stage 21c Phase 2 (session restore — original home of this code path). BUG-007 (deleted-files-linger in navigator — adjacent symptom; both stem from missing `unlink` event handling).

---

### BUG-040: External-domain blocklist not bouncing capitalone.com / gmail.com to system browser

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W2). Diagnosis revealed the bug was bigger than a matcher tweak — there was **no routing interceptor for user-driven navigation at all.** Pre-fix, `external-domains.json` was an agent-only convention: the duo subagent read the file from `priming.md` and chose `duo external <url>` for off-host targets, while the BrowserManager's `webContents.loadURL` called from address-bar typing / link clicks bypassed the file entirely. Fix:
- New `core/external-domains-service.ts` — loads + parses + caches + matches; watches the file for live edits (250ms debounce). The matcher `*.foo.com` already handled bare-domain (`foo.com`) since Stage 25 — that part wasn't broken; the missing piece was hooking it into BrowserManager.
- `BrowserManager` now installs `will-navigate` + `will-redirect` interceptors on every WebContentsView (catches address-bar, link clicks, form posts, redirects). Off-host hosts → `event.preventDefault()` + `shell.openExternal(url)` + push the existing `EXTERNAL_REDIRECTED` IPC banner.
- `setWindowOpenHandler` consults the same matcher for popups.
- `addTab` initial load checks first; off-host URLs leave the tab on `about:blank` to avoid a flash-load-then-bounce.
- `electron/main.ts` `openExternalUrl` reuses the same service for the post-redirect banner reason lookup; the inline `lookupExternalDomainReason` + `matchesDomain` are gone.
**Priority:** **High** (defeats the whole point of the off-host blocklist; SSO + corporate-managed-browser flows break in the embedded browser)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 13)

**Owner observation:** "we still need to implement the browser blocklist ... capitalone.com and gmail still load in the duo browser -- this should not happen"

**State of the bundled blocklist (per ENH-009 v0.4.3 + Stage 21e v0.5.0):**
Fresh installs get an expanded `~/.claude/duo/external-domains.json` covering `*.capitalone.com`, `*.slack.com`, `mail.google.com`, `docs.google.com`, `drive.google.com`, `*.atlassian.net`, `*.microsoftonline.com`, etc. Existing-user upgrade-additive merge was deferred (mile 2 of ENH-009) — see ENH-021 below.

**Two distinct problems behind the user's report:**

1. **gmail.com loads in embedded browser** — likely existing-user issue. User installed pre-v0.4.3, their `external-domains.json` only contains `["*.capitalone.com"]`, gmail isn't on their list because additive merge never landed. Resolution path: ENH-021 (additive merge) OR `rm ~/.claude/duo/external-domains.json && relaunch` to re-bootstrap.

2. **capitalone.com STILL loads in embedded browser despite being in the user's list** — this is the real bug. The pattern-match / route-decision code is failing for an entry that's known-present. Hypotheses, in order of likelihood:
   - **Bare-domain mismatch.** Pattern is `*.capitalone.com` (subdomain wildcard) but user is hitting `capitalone.com` (no subdomain). `*.capitalone.com` doesn't match `capitalone.com` itself — only subdomains. This is the most common cause of "blocklist ignored my entry."
   - **In-page redirect / nested-frame blind spot.** Browser-Manager's URL-decision path may only check the top-level navigation URL, not subsequent in-page redirects (e.g., `capitalone.com` → `www.capitalone.com` → `myaccounts.capitalone.com`). The `will-navigate` vs `did-navigate-in-page` events handle these differently.
   - **Stale or invalid `external-domains.json`.** JSON parse failure could silently fall back to empty-list — confirm with explicit logging.

**Suggested triage:**
1. Owner: paste contents of `~/.claude/duo/external-domains.json`. If it's `["*.capitalone.com"]` only, item 1 (existing-user gap) is confirmed — workaround = delete the file, relaunch.
2. Test bare vs. subdomain navigation in the embedded browser. If `capitalone.com` (bare) loads but `www.capitalone.com` bounces to system browser, the matcher is strict-wildcard-only.
3. Log the URL + match decision in `BrowserManager`'s `will-navigate` / `will-redirect` handlers temporarily.

**v1 fix scope:**
- (a) Confirm bundled defaults cover both bare AND wildcard forms (`capitalone.com` + `*.capitalone.com`, `gmail.com` + `mail.google.com`, etc.). Add bare-domain entries where missing.
- (b) Fix the matcher to handle bare-domain entries OR document the subdomain-only semantic in the file's leading comment + ship a `duo blocklist test <url>` verb so users (and agents) can validate routing decisions deterministically.
- (c) Trace `will-redirect` / `did-navigate-in-page` to confirm same routing is applied to redirects.

**Affected files (suspected):**
- `electron/browser-manager.ts` (URL-routing decision; matcher logic)
- `electron/install-service.ts` (bundled defaults — add bare forms)
- `cli/duo.ts` (new `blocklist test/list` verb — optional v1 scope)

**Cross-ref:** ENH-009 (the original mile 1 — fresh-install defaults expansion); ENH-021 below (additive-merge for existing users); Stage 21e-iii (provenance-aware install pattern that was supposed to host the merge).

---

### ENH-018: Markdown editor — bullet marker character should match the source (`*` → disc, `-` → dash)

**Status:** 🆕 Filed
**Priority:** Medium (visual fidelity — what's on disk should match what's rendered, character by character)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 1; spec corrected same day)

**Owner observation:** "treat dashed bullets as dashed bullets -- not round bullets" → corrected to: "`*` should render as round bullets, `-` should render as dash bullets"

**Today:**
- TipTap's `BulletList` node has no concept of "which marker character was in the source" — it normalizes to a single `bulletList` node type.
- `markdown-io.ts` round-trips both `*` and `-` to a single canonical character on save (currently `-`). This means a user who typed `* foo` gets `- foo` back on save → marker character is silently rewritten.
- `renderer/styles/globals.css` `.duo-editor-prose ul:not([data-type="taskList"])` falls through to browser default `disc` for everything.

**Expected:**
1. `* foo` in source → renders as a **round bullet (disc)** AND round-trips back to `* foo` on save.
2. `- foo` in source → renders as a **dash** (en-dash `–` or hyphen-style) AND round-trips back to `- foo` on save.
3. Mixed lists in the same document preserve their respective markers.
4. New lists created via toolbar / shortcut default to one or the other (recommend `-`, matching CommonMark norm + current default).
5. Lists started by typing `* ` (input rule) → disc marker; lists started by `- ` → dash marker.

**This is structurally larger than the original "swap disc for dash" suggestion.** Three pieces:

**A. Schema attribute on `bulletList` to track the source marker.**
- Extend TipTap's `BulletList` (or wrap it) with a `marker: '*' | '-'` attribute, default `'-'`.
- Round-trip:
  - Parse: `markdown-io.ts` markdown → ProseMirror parser sets `marker` to whichever character was at the start of the list. (Requires reading the source line — most md→PM parsers don't expose this. May need a custom remark plugin or post-parse pass.)
  - Serialize: ProseMirror → markdown writes the `marker` attribute back as the bullet character.

**B. CSS rendering keyed on the attribute.**
```css
.duo-editor-prose ul[data-marker="*"]:not([data-type="taskList"]) {
  list-style-type: disc;
}
.duo-editor-prose ul[data-marker="-"]:not([data-type="taskList"]) {
  list-style-type: '–  ';  /* en-dash + double space */
}
```

**C. Input rules respect the typed character.**
- TipTap's default bullet-list input rule matches `[*+-]\s` and creates a `bulletList`. Override (or add a parallel rule) so the matched character sets `marker` on the new node.
- Toolbar "bullet list" button defaults to `'-'` (CommonMark canonical).

**Round-trip risks:**
- A list started with `*` and later edited (split / merged / re-flowed) — the `marker` attribute should propagate through edits. ProseMirror handles attribute preservation for splits but verify behavior for merging two lists with different markers.
- Lists nested inside other lists — each `bulletList` carries its own `marker`. Should compose naturally.
- Pasting markdown with `+` (third CommonMark bullet character) — for v1, recommend `+` → dash (treat as `-` synonym) OR add a third style. Plus is rare; defer.

**v1 scope (locked 2026-04-30 after research + AskUserQuestion):**

| Decision | Choice |
|---|---|
| Round-trip #1 — direct edits (Enter, Backspace, indent/outdent) preserve marker | ✅ ship in v1 |
| Round-trip #2 — save → reopen preserves marker | ✅ ship in v1 |
| Round-trip #3 — paste from another markdown source preserves markers | ⏳ deferred to v2 (document as known limitation; markers normalize to canonical on paste) |
| Round-trip #4 — copy out preserves markers in `text/markdown` clipboard MIME | ✅ free with #2 (serializer covers it) |
| Marker variants supported | **All three: `*`, `-`, `+`** (full CommonMark) |
| Mixed-list collision behavior | **Inherit parent's marker.** If user types `* ` inside an existing dashed list, the new item conforms to `-`. Cozy-md-editor's pattern — predictable, surprise-free. Mixed-marker authoring requires explicit edit at the source. |

**Implementation sketch (informed by cozy-md-editor research):**

A. **Schema attribute on `bulletList`.** Add `marker: '*' | '-' | '+'` (default `'-'`) via a small `BulletListWithMarker` extension that wraps `@tiptap/extension-bullet-list`.

B. **Parse: source character → attribute.** Custom remark plugin (or post-parse pass on the mdast tree) reads the bullet character at each list's start position and stamps it into the `bulletList` node attrs. The remark `list` node has a `start` offset that lets us peek at the original character in the raw source.

C. **Serialize: attribute → source character.** Extend the ProseMirror→markdown serializer in `markdown-io.ts` to emit the stored marker character per list.

D. **Input rules respect the typed character on list creation.** Override TipTap's default bullet-list input rule (matches `[*+-]\s`) so the matched character sets `marker` on the new node. **Inheritance rule: if the new list is being created inside an existing `bulletList`, inherit the parent's marker; only top-level new lists adopt the typed character.**

E. **CSS attribute selectors.**
```css
.duo-editor-prose ul[data-marker="*"]:not([data-type="taskList"]) { list-style-type: disc; }
.duo-editor-prose ul[data-marker="-"]:not([data-type="taskList"]) { list-style-type: '–  '; }
.duo-editor-prose ul[data-marker="+"]:not([data-type="taskList"]) { list-style-type: '+  '; }
```

F. **Behavioral fallback (Cozy-port).** Even with full AST tracking, on Enter / Backspace / Shift+Tab inside a list, run a Cozy-style regex (`/^(\s*)([-*+])\s/`) over the current line as a second-line check. Catches edge cases where ProseMirror's command output drifts from the AST attribute. Cozy's `findParentListType` is the reference for outdent inheritance.

**Test plan:**
- Round-trip fixture: `tests/fixtures/bullet-markers.md` with `*`, `-`, `+` lists, nested mixed lists, and an alternating sibling pattern. Parse → serialize → assert byte-identical with the source.
- Behavioral tests: Enter on a `*` line yields `*`, Enter on a `-` line yields `-`, Shift+Tab on a `* child` under `- parent` outputs `- child`.
- Known-failure test for paste fidelity (until v2): paste `- A\n* B` → both render with the canonical marker; document as expected.

**Out of scope (v1):**
- Paste fidelity (round-trip #3).
- HTML canvas marker selection — canvas authors hand-craft their own CSS; ENH-020 templates may follow this convention but it's not enforced.
- Numbered list marker variants (`1.` vs `1)`) — same architectural shape but separate ENH.
- Ordered-list re-numbering on outdent (cozy-md-editor's open TODO line 590) — out of scope.

**Reusable assets from cozy-md-editor** (`/Users/geoffreydudgeon/VSC Projects/vsc-cozy-md-editor/src/commands/editing.ts`): the `BULLET_RE` regex, `findParentListType()` function, and the Enter / Shift+Tab handlers. These are pure TypeScript text utilities — not VS Code-specific. Port verbatim into a `bullet-marker-utils.ts` helper in `renderer/components/editor/` and call it from the TipTap commands.

**Affected files:**
- `renderer/components/editor/extensions/BulletListWithMarker.ts` (new — wraps `@tiptap/extension-bullet-list` with the `marker` attribute + input rules)
- `renderer/components/editor/markdown-io.ts` (parse + serialize)
- `renderer/components/editor/bullet-marker-utils.ts` (new — Cozy-port of `BULLET_RE` + `findParentListType` for behavioral fallback)
- `renderer/styles/globals.css` (attribute-selector CSS rules)
- `renderer/components/editor/EditorToolbar.tsx` (bullet button: default to `-`; if cursor is inside an existing list, adopt that list's marker)

**Cross-ref:** Cozy-md-editor's `findParentListType` + `BULLET_RE` are the behavioral reference. v2 (paste fidelity) maps to `extensions/MarkdownPaste.ts` — fold there when picked up.

---

### ENH-019: Suppress OS scrollbar UI on horizontal tab strip overflow

**Status:** 🆕 Filed
**Priority:** Low (visual polish)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 14)

**Owner observation:** "when scrolling horizontally through tabs in either the terminal or the working area/right pane, an os-default scroll bar ui/handle renders -- this is not necessary and should be suppressed"

**Today:**
The terminal tab strip (`renderer/components/TabBar.tsx`) and the WorkingPane tab strip (`renderer/components/WorkingTabStrip.tsx`) both use horizontal `overflow-x: auto`. macOS renders a transient scrollbar handle when content exceeds container width. Visually noisy.

**Suggested fix (v1):**
- `overflow-x: scroll; scrollbar-width: none` (Firefox) + `&::-webkit-scrollbar { display: none }` (Chromium) on the tab-strip scroll containers. Pure cosmetic suppression, no interaction change. ⌃Tab cycle + tab activation already cover keyboard navigation.
- Alternative (deferred): change to `overflow-x: hidden` and add ◀/▶ chevron buttons revealed only when overflow exists. UX polish but changes interaction model.

**Affected files:**
- `renderer/components/TabBar.tsx` (or its CSS)
- `renderer/components/WorkingTabStrip.tsx` (or its CSS)
- Possibly a single shared utility class in `globals.css`.

---

### ENH-020: Skill — "Building effective HTML canvases" (templates + ID conventions + agent-event buttons)

**Status:** 🆕 Filed
**Priority:** Medium (canvas authoring is the most-used Stage 17 surface; structured guidance turns ad-hoc canvas builds into reproducible patterns)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 10)

**Owner ask:** "we need skill for building effective html canvases -- should include things like a template (eg notion-like structure you previously recommended), and rules for unique identifiers for divs where appropriate, guidance to make button elements function well with the duo cli for sending events from canvas >> duo, etc; skill should include multiple templates"

**Scope:** A dedicated skill at `skill/examples/canvas-authoring.md` (per CLAUDE.md plumbing checklist § 8 stub for new tab types) covering:

1. **Anatomy of a Duo canvas.** Boilerplate from `shared/html-boilerplate.ts` walked line-by-line — atelier palette tokens (`--paper`, `--ink`, `--accent`), dark-mode `@media`, `body min-height: 100vh` (BUG-023 fix), `<main>` content column at 720px max-width.
2. **Stable IDs (`data-duo-id`).** Why agent edits rely on them; auto-stamping at write time (ENH-001); when to author IDs by hand (durable anchors for comment threads / agent-targeted ops); ULID pattern.
3. **Agent-event buttons.** `data-duo-action` triple — `claude:spawn`, `terminal:send`, `browser:open`. Trust-gate path restriction (Stage 23 — actions only fire from `~/.claude/duo/`). Worked examples: a "run this checklist with Claude" button, a "send selected text to terminal" button, an "open external doc in browser" button.
4. **CLI ops cheat-sheet.** `duo html append/replace/prepend/set/delete/wrap/move/edit-attr/get/query` — what each does, when to reach for it, how `--id` vs `--selector` resolves.
5. **Three (or more) templates** at `skill/examples/canvas-templates/`:
   - `notion-doc.html` — title + heading hierarchy + callout blocks + checklist; mirrors a Notion-style daily-doc.
   - `dashboard.html` — top-row metric cards + a status table + an "ask Claude" CTA.
   - `walkthrough.html` — numbered step blocks each with a `claude:spawn` button + collapsible details. Pairs well with onboarding flows.
6. **Anti-patterns.** `<script>` tags swallowed by the iframe sanitizer; absolutely-positioned overlays (BUG-034 onboarding card story); inline `style` attributes harmless but discouraged.

**Discoverability:**
- New row in `skill/SKILL.md` linking to the skill file.
- New row in `agents/duo.md` cheat-sheet noting the skill location (so the Haiku-driven subagent can find it).
- `npm run sync:claude` after edits.

**Cross-ref:**
- Stage 17a.5 (template gallery — direct overlap; this skill's templates seed the 17a.5 gallery if/when it ships).
- `backlog-templates` roadmap item (template registry across markdown + HTML).
- ENH-001 + ENH-004 (stable IDs + atelier defaults — already shipped; this skill teaches users how to use them).

**Affected files (proposed):**
- `skill/examples/canvas-authoring.md` (new)
- `skill/examples/canvas-templates/*.html` (new — at least 3 seed templates)
- `skill/SKILL.md` (link + summary line)
- `agents/duo.md` (cheat-sheet entry)

---

### ENH-021: External-domains.json — additive-merge for existing users on upgrade

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint W2). `electron/install-service.ts § bootstrapOrMergeExternalDomains()` replaces the prior bootstrap-only block. On every install/upgrade: parse the existing `~/.claude/duo/external-domains.json`, compute `missing = bundledDefaults - userHosts` (string-equal compare against `host` field; handles both string and `{host, reason?}` entry forms), append missing to the array, write back. User entries preserved verbatim. Malformed-JSON case → leave alone (don't clobber edit-in-progress); the runtime service handles parse failures with empty-list fallback. v2 deferred: dismissed-defaults sidecar so a default the user explicitly deleted doesn't come back on next install.
**Priority:** Medium-High (gates ENH-009's reach for any pre-v0.4.3 install; pairs with BUG-040)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 13 — partial; the existing-user side)

**Today:**
`electron/install-service.ts:296–303` bootstraps `~/.claude/duo/external-domains.json` only if absent. Existing users with a populated file (typically just `["*.capitalone.com"]` from the original v0.x bootstrap) don't pick up v0.4.3's expanded list (Slack, Gmail, Google Docs, Atlassian, M365). The comment at line 293 references "Stage 21e-iii (v0.5.0) adds an additive-merge upgrade path" — but Stage 21e shipped without that mile.

**Expected:**
On install / version-bump, read existing `external-domains.json`, parse `domains`, add any MISSING bundled defaults to the array. Don't remove user entries. Don't re-add entries the user explicitly deleted (requires a "dismissed-defaults" tracker — deferred to v2).

**v1 algorithm:**
1. Read `external-domains.json`. If parse fails, fall through to bootstrap-from-scratch (existing path).
2. Compute `missing = bundledDefaults - userDomains`.
3. If `missing` is non-empty, write back `userDomains ∪ missing`. Atomic tmp-rename pattern (existing `writeFileAtomic` helper).
4. Log: "added N new bundled defaults — capitalone.com (bare), mail.google.com, docs.google.com, *.slack.com, *.atlassian.net".
5. Surface in the install banner (or a one-shot toast on first relaunch post-upgrade): "Updated your blocklist with N new SaaS domains. Edit at `~/.claude/duo/external-domains.json`."

**v2 (deferred):**
- "Dismissed-defaults" tracker (sibling JSON) so re-runs don't re-add user-removed entries.
- In-app UI to view / toggle the blocklist (settings panel).
- `duo blocklist add/remove/test/list` CLI verbs.

**Affected files:**
- `electron/install-service.ts` — `mergeExternalDomains()` helper alongside the existing bootstrap block.
- `shared/external-domains-defaults.ts` — extract the bundled default array if not already (so install-service + matcher share one source).
- `fork.config.default.json` — verify the Vite-injected runtime defaults match bundled.
- Release notes for the version that ships this.

**Cross-ref:** ENH-009 (the original mile 1 — fresh-install defaults), BUG-040 (the bare-domain matcher fix that pairs with this).

---

### ENH-022: `duo doc goto` — scroll the markdown editor to a heading / anchor / line

**Status:** Open
**Priority:** Medium (small but high-utility — every "find BUG-040 in tasks.md" / "show me the Stage 17 section" turn currently requires the user to ⌘F)
**Filed:** 2026-04-30 (discovered while opening `tasks.md` in the editor and being unable to land on `BUG-040` from the CLI)

**Today:**
`duo edit <path>` opens a markdown file in the rich editor (right pane), but the CLI has no verb to scroll the editor to a specific heading, anchor, or line number. `duo reveal` is navigator-side only. The agent has no programmatic way to land the user's view on a section after opening — they have to ⌘F.

**Class of issue:**
Editor-side navigation parity with the file navigator's `reveal`. The skill description even advertises "navigate the editor" but the verb surface ends at `doc read` / `doc write`.

**Expected:**
A CLI verb that scrolls the active markdown editor (or the editor for `--path <path>`) to a target and optionally moves the caret there.

```
duo doc goto --heading "BUG-040"          # text match against ## / ### / #### (case-insensitive substring)
duo doc goto --line 2015                  # line number in the source markdown
duo doc goto --anchor bug-040             # GitHub-style slug
duo doc goto [...] --pin-caret            # also move the caret + select the heading
```

Returns `{ok, matched: {heading, line}}` or `{ok: false, reason: "no match"}`.

**Plumbing checklist (touch every one — see CLAUDE.md § 4):**
1. `shared/types.ts` — add `DocGotoRequest` to the IPC contract; add to `DuoCommandName`.
2. `electron/preload.ts` — expose to renderer.
3. `electron/main.ts` — ipcMain handler; main→renderer dispatch.
4. `electron/socket-server.ts` — new case in command switch.
5. `cli/duo.ts` — `doc goto` subcommand + `printHelp()` update. Rebuild `cli/duo`.
6. `renderer/components/editor/MarkdownEditor.tsx` (or its primitives) — resolve target → ProseMirror position → `view.dispatch(scrollIntoView)`. Heading match: walk the doc tree for `heading` nodes whose textContent matches.
7. `skill/SKILL.md` — agent discovery + example.
8. `agents/duo.md` — verb cheat-sheet entry.
9. `docs/CLI-COVERAGE.md` — inventory update.
10. `npm run sync:claude` after skill / agent edits.

**Pairs with:**
- An equivalent for the HTML canvas would be `duo html goto --id <duo-id>` or `--selector <css>` (canvas already has `data-duo-id` resolution; this is a thin wrapper over `scrollIntoView`).

**Cross-ref:** Discovered while looking up BUG-040 (line 2015 of this file) from the CLI.

---

### ENH-023: ⌘F find-in-document for the markdown editor (and other surfaces)

**Status:** Open
**Priority:** Medium-High (basic table-stakes for any editing surface — the lack of it surfaces the moment a doc is longer than one screen, e.g. `tasks.md` is 2000+ lines)
**Filed:** 2026-04-30 (discovered alongside ENH-022 — when ENH-022 came up, the fallback "use ⌘F" turned out not to exist either)

**Today:**
The markdown editor (TipTap) has no in-document search. ⌘F on a long document does nothing. Same gap on the HTML canvas (iframe). Browser pane and terminal each have their own native find paths but neither is wired to a global ⌘F shortcut, and neither is exposed to the CLI.

**Class of issue:**
Find/search parity across Duo's text surfaces. The lack is most acute in the editor — a long-doc surface with no scroll-to (ENH-022) AND no find means the agent and user are both blind to anything past the visible viewport.

**v1 — markdown editor:**
- ⌘F opens a small find bar (top-right of the editor pane, dismissible with Esc).
- Type-as-you-search, highlights all matches, ⏎ / Shift+⏎ steps through, ⌘G / ⌘⇧G also step.
- Match count badge ("3 of 17").
- Case-sensitive + whole-word toggles (off by default).
- ⌘⌥F opens find-and-replace (deferred to v2 if it complicates v1).
- Implementation: TipTap has `@tiptap/extension-search` or roll on top of ProseMirror's `prosemirror-search` plugin. Either gives decoration-based highlights without mutating the doc.

**v2 — broader surface coverage (deferred but worth noting now so the global shortcut wiring is built once):**
- HTML canvas: forward ⌘F into the iframe; use `window.find()` or a custom highlighter over the rendered DOM.
- Browser pane: `webContents.findInPage()` — Electron has this built in; needs a UI shell for the find bar.
- Terminal: `xterm-addon-search` — already a maintained xterm extension.
- The keyboard registry in `renderer/keyboard/globalShortcuts.ts` should grow a single `find-in-active-surface` action that each surface implements per the three patterns in CLAUDE.md § 6 (in-document / iframe / native-bridged).

**CLI parity (CLAUDE.md § 4 — every UI feature ships a `duo` counterpart):**
```
duo doc find "BUG-040"                    # next match in active editor; returns {matched, line, occurrence}
duo doc find --all "BUG-0"                # JSON list of all matches
duo doc find --next / --prev              # step through last query
```
Equivalent `duo html find` / `duo browser find` come along with v2 surface coverage.

**Plumbing checklist for v1:**
1. `renderer/keyboard/globalShortcuts.ts` — register `find-in-document` (⌘F) + `find-next`/`find-prev` (⌘G/⌘⇧G).
2. `renderer/components/editor/MarkdownEditor.tsx` — install search plugin, render find-bar primitive (likely `renderer/components/editor/primitives/FindBar.tsx`), wire shortcut → toggle bar / step matches.
3. `electron/menu.ts` — Edit menu: Find / Find Next / Find Previous (so the muscle-memory works even before the find bar is open).
4. `shared/types.ts`, `electron/preload.ts`, `electron/main.ts`, `electron/socket-server.ts`, `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` — all touched per the CLI plumbing checklist when adding `duo doc find`.
5. `docs/dev/smoke-checklist.md` — add a "long-doc find" row.

**Cross-ref:** ENH-022 (`duo doc goto` — same surface, complementary capability — agent navigates by structure, user navigates by text).

---
