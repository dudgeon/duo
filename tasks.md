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

**Status:** 🆕 Filed
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

**Status:** 🆕 Filed
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
