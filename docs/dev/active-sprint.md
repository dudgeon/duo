# Active sprint state — Sprint 3 (v0.6.3 → v0.6.4 cut)

> **What this file is.** Running scratchpad for the active sprint
> arc. The formal record lives in:
> - `docs/prd/canvas-split-view-research.html` (Split View locked spec)
> - `docs/prd/canvas-split-view-styling.html` (styling options canvas; awaiting owner pick)
> - `docs/DECISIONS.md § Editor / canvas convergence` (Phase 2 ADR)
>
> This file is the "where am I right now" file.
>
> **For future Claude instances:** if you're picking up after a context
> compaction, READ THIS FILE FIRST. It points at the formal plan + says
> exactly what's been done, what's owed, and what's blocked on the
> owner.
>
> **Update cadence:** at the end of each commit (mark the row done,
> note any deviations, update "next" pointer).

---

## Smoke walk v0.6.4 — results 2026-05-03 evening

Owner walked all 18 items in `docs/dev/smoke-walks/v0.6.4.html`. Final tally: **10 PASS · 4 FAIL · 4 SKIP**.

**Cut posture:** ⛔ **NOT cut-ready as-is.** The v0.6.4 cut waits on a follow-up sprint to address BUG-074 (light-mode contrast regression in ENH-078 — high priority, user-visible regression) and BUG-075 (Phase 3b ⌘\ + ⌘⇧\ chord regression — keyboard chords are a load-bearing entry point per the PRD). Right-click + CLI paths into Split View work fine, so the chord regression isn't a hard block on USING Split View, but cutting v0.6.4 with a documented "⌘\ doesn't fire" is below the bar. Fresh session resumes to fix; do not begin new work autonomously per owner instruction.

### PASS (10)

| # | Item | Note |
|---|---|---|
| 1 | BUG-070 | Cursor lands in fresh HTML canvas on first click (no tab-away workaround). |
| 2 | ENH-039 + Phase 3a polish | Path links route to canvas / split per per-page meta opt-in. |
| 3 | ENH-076 | ⌘[ / ⌘] indent + outdent in HTML canvas (parity with markdown editor). |
| 4 | ENH-079 | Collapsed Navigator shows "Navigator: {project_name}" label. |
| 5 | ENH-036 | `duo open <url>` makes new browser tab visible immediately. <br>**Owner note:** new bug case spotted post-test — ⌃⇧\` doesn't reach faq.html on cycle-back. Filed as **BUG-076**. |
| 6 | Sprint 3 evening — swap semantics | Moving a new file into Split View while aux is occupied SWAPS them (existing aux → main); existing aux content preserved. |
| 7 | Phase 3b — tab right-click | "Move to Split View" on file tabs in WorkingTabStrip. <br>**Owner note:** add browser support in next sprint. Captured in Phase 3c-iv tracker. |
| 8 | Phase 3b — FileTree right-click | "Open in Split View" on file rows. |
| 9 | Phase 3b — PinnedNav right-click | "Open in Split View" on file pins. |
| 10 | Vitest | `npm run test:run` runs 41 (now 104) regression tests, all passing. |

### FAIL (4)

| # | Item | Failure |
|---|---|---|
| 1 | BUG-061 | Partial: trigger detection works for all 6 families, but `-` renders as round bullet (should be dashed marker style). PLUS: blockquote double-Enter doesn't exit (parity with bullet exit gesture). Filed as **BUG-073** (dashed-bullet style) and **BUG-072** (blockquote-exit) for v0.6.5. |
| 2 | ENH-078 | Light-mode regression — `bg-accent/30 + text-zinc-50` gives near-white text on cream-paper background. Dark mode works; light mode is illegible. Filed as **BUG-074**. ENH-078 status flipped from ✅ Shipped → 🟡 Partial. |
| 3 | Phase 3b — ⌘\\ chord | Keyboard chord ignored — right-click + CLI paths work, but ⌘\\ doesn't fire. Filed as **BUG-075**. Likely culprit: the `splitViewClose` → `splitViewPromote` rename in commit `511d8b8` may have left a callback ref dangling. |
| 4 | Phase 3b — ⌘⇧\\ chord (revised) | Same regression as #3 above — ⌘⇧\\ also ignored. Same root cause; same BUG-075. |

### SKIP (4)

| # | Item | Reason |
|---|---|---|
| 1 | BUG-071 | Couldn't test — the smoke-walk page now opts into Split View routing per ENH-039, so path link clicks land in aux instead of triggering the focus-transfer path BUG-071 fixed. **Action:** add a separate smoke item that uses a non-split path-link (or temporarily strip the meta) to exercise BUG-071 specifically. |
| 2 | Phase 3c-iii (revised) | Couldn't test — autosave fires too quickly (~800ms) for the smoke-walker to dirty + swap fast enough. Filed as **FOLLOWUP-006** (add a `duo dev autosave-delay` knob for testing). |
| 3 | Phase 3a + 3c-i | Owner deferred — will test on a future DMG restart so the smoke walk wasn't interrupted by a Duo relaunch. Add to the post-DMG smoke list. |
| 4 | ENH-070 | **Verified by Claude post-walk via `ls -la ~/.claude/duo/help/`:** `canvas-actions-demo.html` is correctly a symlink to the source repo. `faq.html` and `what-duo-does.html` are regular files because their bytes diverged from the source (the helper preserves user customizations as designed). Symlink mechanism works; edge case noted for v0.6.5 — when an agent edits the source repo's help/*.html, the installed copy doesn't auto-resync. Filed at the bottom of the ENH-070 entry. |

### Other notes for next sprint

| # | Note | Tracker |
|---|---|---|
| 1 | Move collapse-pane buttons from titlebar to the new-tab clusters (terminal cluster gets the collapse-terminal button; canvas cluster gets the collapse-canvas button). | **ENH-083** |
| 2 | Aux pane focus indicator parity — orange glow when active in side pane (matches main's accent treatment). | **ENH-084** |
| 3 | Split pane title bar should support same context-click verbs as main canvas tab (Move to Trash, Reveal in navigator, Rename, Copy path, Move back to main). | **ENH-085** |
| 4 | Increase visual separation in the navigator between user-claude (top) and project-files (bottom) sections. | **ENH-086** |
| 5 | "Open file" bold-text styling in navigator isn't self-explanatory — add tooltip + FAQ entry. | **ENH-087** |

### v0.6.4 cut readiness gate

Before cutting v0.6.4, the following must land:
1. **BUG-075** — Phase 3b chords fire correctly (right-click + CLI paths fall back gracefully but the keyboard chord is documented + advertised as a Split View entry point).
2. **BUG-074** — ENH-078 light-mode contrast (high-priority user-visible regression of a v0.6.4 deliverable).

The other FAILs (BUG-072 / BUG-073) are cosmetic / parity gaps that don't block the cut. The SKIPs are deferral / test-tooling gaps, not regressions.

**Recommended next-session sequence:** investigate BUG-075 first (likely a 1-line ref restoration — the `splitViewClose → splitViewPromote` rename probably missed a wiring point); then BUG-074 (text color theme-awareness in `FileTree.tsx`); re-smoke just those two items via a fresh manifest; then propose the cut.

---

## Current state — last updated 2026-05-03 (afternoon — idle-thoughts sweep)

**Active arc:** Sprint 3 — closes the v0.6.3 chapter into a v0.6.4 cut.
Now widened beyond Split View to absorb the queued idle-thoughts
items + adjacent small-scope wins, since the user explicitly asked
for an ambitious self-validatable sweep ("Please prioritize things
you can validate yourself without me needing to approve computer
control; please be ambitious in scope sweeping in as many small,
testable, defined things as you can").

**Phase status:**
- Phase 1 (walk-3 v3 fixes): ✅ DONE
- Phase 2 (convergence ADR): ✅ DONE
- Phase 3a (Split View core + UI + per-page meta + agent trigger
  language): ✅ DONE
- Phase 3a polish (styling pick): ✅ Owner picked **option A**
  (current/shipped slim symmetric chrome). No further chrome work
  for v0.6.4.
- Phase 3b (right-click invocation surfaces + ⌘\ chords): ⏸ Queued.
  Doesn't block the cut; ships in the next sprint.
- Phase 3c (persistence + edge cases): ⏸ Queued.
- **Idle-thoughts sweep (NEW):** ✅ DONE (2026-05-03 afternoon).
  Six items shipped, two filed-only, one discussion item. Detail
  below.

**Branch:** `main` (all work on main; no worktree).

**Package version:** `package.json` is `0.6.3`. The cut hasn't happened
yet — accumulating until a fresh smoke walk passes. Expected to bump
to `0.6.4` once the user smokes the sweep items.

---

## Sprint 3 commit chain (newest at bottom)

| Commit | Phase | What |
|---|---|---|
| `1b3b132` | Phase 1 (walk-3 prep) | BUG-070 v1 + BUG-061 v1 + ENH-039 + FOLLOWUP-002. The v1 fixes were INSUFFICIENT — owner walk-3 reported 5/6 FAIL. |
| `4baba8b` | Phase 1 walk-3 v2 | BUG-070 v2 (RAF poll on wire()) + BUG-061 v2 (start-match regex + `+` for CommonMark) + ENH-039 tilde expansion + agent model alias `haiku`. |
| `f7f6891` | **Phase 2** | Convergence ADR locked Path A (mirror, not unify). CLAUDE.md gets "Editor-canvas parity rule" requiring (a) Mirrored / (b) Skipped surface-specific / (c) Deferred annotation on every editor PR. No code changes — pure decision lock. |
| `40c9951` | **Phase 3a-i** | Split View end-to-end PLUMBING. shared/types.ts (DuoCommandName += `'split-view'`, IPC channels, `WorkingAuxState`/`WorkingAuxSnapshot`/`WorkingAuxOp`); core/socket-server.ts case + NavBridge methods; electron/main.ts implementations (open/close/promote/resize/get + state cache); electron/preload.ts `workingAux` bridge; cli/duo.ts `case 'split-view'` with sub-verbs; rebuilt cli/duo binary; renderer/App.tsx aux state hook + IPC subscribers. NO WorkingPane UI yet. |
| `a0c144c` | **Phase 3a-ii** | Split View VISIBLE UI. WorkingPane.tsx wraps existing strip+content into a "main column," conditionally renders an aux column when auxState is non-null. Three new inline components: `buildAuxFileTab(path)`, `AuxHeader` (slim header with `SPLIT` label + filename + ⇤ promote + ✕ close), `SplitViewDivider` (drag-to-resize, BUG-031 overlay pattern, double-click 0.5 reset, clamp 20-80). App.tsx threads `auxState` + 3 callbacks to WorkingPane (close, promote, resize). |
| `5506f06` | **Phase 3a polish docs** | Owner-requested styling-options canvas at `docs/prd/canvas-split-view-styling.html`. 5 options with CSS-driven mocks: A (current/shipped) symmetric slim · B (recommended) Slack-faithful subordinate with accent left rule + italic serif filename · C minimal/floating ✕ · D full tab strip in aux (B-ready) · E drawer/sheet with shadow. Side-by-side comparison table + my recommendation (B). **OWNER NEEDS TO PICK** before Phase 3b starts. |
| `56e986b` | **BUG-070/061 v3** | Walk-3 fail root causes diagnosed live: (1) BUG-070 v3: srcdoc iframes pass through an `about:blank` phase before the parser swaps in the real srcdoc doc; v2 wired against the disposable about:blank body, locked `wired=true`, never re-ran. Fix: bail in `wire()` when `doc.URL === 'about:blank'`. (2) BUG-061 v3: Chromium converts trailing literal space (U+0020) to `&nbsp;` (U+00A0) — DOM inspection confirmed `<h1>-&nbsp;</h1>`. Fix: `\s` regex matches both. Applied to heading, bullet, ordered, blockquote triggers. **Both verified PASS in live smoke this session.** |
| `f7ff1fe` | **Phase 3a polish code** | Per-page `<meta name="duo-path-target" content="split">` support so pages can default their `[data-duo-path]` clicks to Split View. Wiring: cdp-bridge.ts PATH_LINK_FORWARDER_IIFE reads the meta + per-link `data-duo-target` override; new `duoOpenPathSplit` CDP binding; main.ts dispatches to `splitViewOpen` (with same tilde expansion). Smoke-walk generator emits the meta. agents/duo.md `duo split-view` cheat-sheet now documents trigger language ("in split / alongside / side by side / see these side by side / as a companion / in the side panel" → split; default ALWAYS main). |

**Total commits this arc:** 8 (`1b3b132` → `f7ff1fe`) — plus the
2026-05-03 afternoon idle-thoughts sweep, uncommitted at time of
writing (next commit will land a single batch).

---

## Idle-thoughts sweep (2026-05-03 afternoon — self-validatable batch)

User asked for an ambitious sweep of small, testable, well-defined
items I could fully implement + typecheck + build without needing
computer-control approval. Walked the idle-thoughts.md doc + the
queued tasks.md candidates and shipped the eight items below as a
single batch.

| Item | Status | Files touched |
|---|---|---|
| **ENH-076** — ⌘[ / ⌘] indent/outdent in HTML canvas | ✅ Shipped (wave 1) | `renderer/components/HtmlCanvas/markdownShortcuts.ts` |
| **ENH-078** — Navigator selection prominence + click-to-deselect | ✅ Shipped (wave 1) | `renderer/components/FileTree.tsx` |
| **ENH-079** — Collapsed Navigator "Navigator: {project_name}" label | ✅ Shipped (wave 1) | `renderer/components/FilesPane.tsx` |
| **ENH-081** — Finder file-association registration for .md/.html | ✅ Shipped (wave 1, verify post-DMG) | `electron-builder.yml`, `electron/main.ts` |
| **BUG-071** — Focus limbo after smoke-walk path-link click | ✅ Shipped (wave 1) | `electron/main.ts` |
| **ENH-036** — `duo open <url>` brings new browser tab into view | ✅ Shipped (wave 2) | `renderer/App.tsx` |
| **ENH-039** — clickable smoke-walk paths | ✅ Status flipped (was mistracked — shipped earlier this sprint via `4baba8b` + `f7ff1fe`) | `tasks.md` |
| **ENH-077** — system dialog icon | 🟡 Code-path verified clean; DMG smoke-verify owed | `tasks.md` |
| Idle thought #2 — `⌘⇧A` tab search | 📁 Filed only (ENH-080) | `tasks.md` |
| Idle thought #3 — Enterprise distro = ZIP+submodule architecture | 📁 Filed (discussion) | `tasks.md` |
| Idle-thoughts.md hygiene — move all 4 unprocessed → Processed | ✅ Done | `idle-thoughts.md` |
| **Stage 4 dead-code cleanup** — orphaned `SkillsPanel`/`useSkillsContext`/`scanSkills` (no callers; explicitly excluded per CLAUDE.md "Brainstem / MCP — Not included") | ✅ Shipped (wave 3) | `renderer/components/SkillsPanel.tsx`, `renderer/hooks/useSkillsContext.ts`, `core/skills-scanner.ts` (all deleted), `shared/types.ts` (removed `SkillEntry` + 2 unused IPC channels) |
| **Wave 4** — orphaned deprecated alias (`EditorSelectionTagged`) | ✅ Shipped | `shared/types.ts` |
| **Wave 5** — ENH-070 dev-only FAQ symlink (Path 1) | ✅ Shipped | `electron/install-service.ts` |
| **Wave 6** — Vitest framework + first regression tests | ✅ Shipped | `package.json`, `vitest.config.ts`, `core/path-utils.ts` (extracted `expandTilde`), `core/path-utils.test.ts`, `renderer/components/HtmlCanvas/markdownShortcuts.ts` (extracted `matchBlockTrigger`), `renderer/components/HtmlCanvas/markdownShortcuts.test.ts`, `electron/main.ts` (uses `expandTilde`). 41 tests pass; locks BUG-061 v3 nbsp-tolerant trigger regex behavior + BUG-067/ENH-039 tilde expansion. |

**Validation walked self-side:**
- `npm run typecheck` — clean (no errors).
- `npm run build` — clean (out/main + out/preload + out/renderer
  build successfully; bundle sizes unchanged from baseline).
- Static review of every edit against the existing parity / pattern
  it claims to mirror (ENH-076 ↔ ListIndentShortcuts.ts; ENH-079 ↔
  CollapsedPaneRail.tsx; ENH-078 ↔ existing whitespace right-click
  handler; BUG-071 ↔ BUG-042 wireKeyForwarding inverse).

**What needs the user (for v0.6.4 cut to qualify as 'shipped'):**

The smoke walk for v0.6.4 should add rows for all six newly-shipped
items above, plus the still-pending Phase 3a polish verify (the
per-page split-routing meta from `f7ff1fe`, which needs a main-
process restart to live-test). I'll generate a fresh smoke-walk
manifest via `.claude/skills/smoke-walk/` when the user is ready
to walk.

**Phase 3c scope decision (2026-05-03 afternoon):** Phase 3c
includes session persistence (3c-i), confirms Phase 3a's
already-wired empty-main promotion (3c-ii), AND ships the
foundation of 3c-iii (dirty-replace dialog). Phase 3c-iv
(browser-in-aux) is deferred to v0.6.5.

**3c-iii foundation shipped (2026-05-03):** dirty-by-path Set in
App.tsx, populated alongside the existing fileTabs[i].dirty by
onTabDirtyChange. The aux pane's `aux:${path}` synthesized IDs are
detected by the prefix and routed to the same Set. All five Split
View entry points (chord, three right-click menus, CLI/page-link
IPC) now converge on splitViewMoveTabByPath, which fires a native
confirm dialog (Discard / Cancel) before silent-replacing a dirty
aux. v1 has no Save button (saves are per-editor + async; the
"save it manually first if you want to keep it" flow is the
intended escape valve until a save-by-path dispatch exists).

**3c-iv (browser-in-aux) still deferred to v0.6.5:** needs
BrowserManager bounds tracking for two WebContentsViews with focus
mirroring + per-view zoom locks. ~half a sprint of its own.

The v0.6.4 chapter feels complete: Split View core + visible UI +
invocation surfaces + persistence + swap semantics + dirty-replace
dialog. The single remaining deferred item (browser-in-aux) gets a
v0.6.5 follow-up sprint.

**Sprint 3 owner-clarification refinements (2026-05-03 evening):**

1. **`⌘⇧\` rewired close → promote.** Originally specified as "close
   the split"; refined to "promote aux back to main" (closes the
   split AND keeps the file open). Pure-discard close stays
   reserved for the ✕ button in the aux header. Mirrors the ⇤
   button's existing behavior. Updated in `globalShortcuts.ts`,
   `useKeyboardShortcuts.ts`, `App.tsx` (new `splitViewPromote`
   handler), and `canvas-split-view-research.html` PRD.

2. **`splitViewMoveTabByPath`: replace → swap semantics.** When
   moving a new file into Split View while aux already holds a
   different file, the existing aux file is now PROMOTED back to
   main as a new file tab — not discarded. Net effect: aux ↔ main
   exchange. Single-source-of-truth still holds. activeWorking
   flips to the newly-promoted main tab when the moved-in file
   was active (keeps focus on file work; falling back to browser
   would be surprising when there's literally a fresh file tab
   right there). Phase 3c-iii dirty-replace dialog still fires
   on the swap when the displaced aux is dirty (the editor
   unmounts during the pane move, losing unsaved edits). PRD
   updated with the new contract.

**Next-sprint research-doc owed (filed in v0.6.5 backlog):**

- **ENH-080 (`⌘⇧A` open-tab search palette) needs a research
  document before code work starts.** The palette is renderer
  DOM and would have the SAME WCV-occlusion class as BUG-006
  (in-page Send → Duo pill), BUG-045 (file:// browser tabs
  context menu), BUG-047 (the broader class summary), BUG-050
  (ContextMenu occluded by editor canvas), BUG-058 (context
  menu occluded by browser), and BUG-064 (trash + pinned-close
  modal occlusion). ENH-050's resolution was "native NSMenu +
  system sheets, NOT WCV-mute" — but the tab-search palette
  is interactive (typeahead-filterable list, arrow-key
  navigation), which an NSMenu doesn't fit cleanly. Research
  options to enumerate:
  - **(a) Native window** — Electron child `BrowserWindow` with
    transparent borderless chrome, dismiss on blur. Composes
    above WCV at the window-server level (same as
    `dialog.showMessageBox`).
  - **(b) WCV mute pattern (BUG-058 v2 lineage)** —
    `setOverlayMuted(true)` collapses every WCV to 1×1 while
    the palette is open; restores on close. Already retired
    for menus + sheets per ENH-050 ADR; resurrecting for the
    palette is acceptable IF (a) is impractical.
  - **(c) Renderer-DOM palette + WCV bounds adjust** — palette
    is React, but the renderer dynamically shrinks the WCV
    bounds while the palette is visible. Trickier than mute
    (animation, re-layout, restore edge cases).
  - **(d) Extension-style overlay** — render the palette into
    the active WCV via CDP injection (mirror BUG-006's in-page
    Send → Duo pill pattern). Unifies behavior across browser
    and renderer surfaces but introduces a CDP dependency for
    a feature that should work even when no browser is active.
  Recommendation seed: (a) is the cleanest answer if
  `BrowserWindow` can hit the right visual styling. (d) is the
  most novel; (b) is the safe fallback. Research doc should
  prototype (a) first and document why if it doesn't work.
  Owner-flagged constraint: "think hard about the menu
  occlusion issues we've had to make sure we get this one
  right." Filed in `tasks.md § ENH-080`.

**Editor-canvas parity rule disposition (for ENH-076):** **(a)
Mirrored** — same chord, same handler shape, same no-op-outside-
list semantics as `editor/extensions/ListIndentShortcuts.ts`. No
deferrals owed to the markdown editor.

**Post-DMG verification owed:**
- **ENH-081** — install v0.6.4 DMG, right-click an `.md` in Finder,
  confirm Duo appears in the Open With submenu. If not auto-listed,
  run `lsregister -kill -r -domain local -domain user`. (Same class
  of post-package-only verify as ENH-077; both fold into v0.6.4
  smoke.)
- **ENH-077** — open a packaged Duo, trigger any `dialog.confirm`,
  confirm the icon in the dialog is Duo's clawd glyph, not
  Electron's default. Likely no-op; closes if confirmed.

---

## Locked decisions this arc

From the Phase 2 + Phase 3 owner conversations (no code change to undo):

1. **Editor / canvas convergence** — Path A (mirror, not unify). PRD-H1 ("the canvas IS the page") is load-bearing; unifying would break it. CLAUDE.md plumbing checklist now requires explicit (a)/(b)/(c) annotation on every editor PR. See `docs/DECISIONS.md`.

2. **Split View design** — Slack-style, single aux slot, right-only. Option B (multi-tab aux) kept on the table for v2 with B-ready internals from day one (`tabs[]` shape even though length ≤ 1 in v1). Option C (n-way recursive splits) explicitly rejected.

3. **Split View locked behaviors** (from second AUQ pass):
   - Move semantics on tab right-click; Open semantics on file/link right-click. Single source of truth: never two tabs for the same path across panes.
   - Replacement: silent if clean, native dialog if dirty.
   - Empty-main edge: aux promotes to main; split closes.
   - Persistence: both `splitPct` AND aux `tabs[]` persist via session-state-service. (Phase 3c work.)
   - No pinning in v1.
   - Keyboard: `⌘\` open/move + `⌘⇧\` close. (Phase 3b work.)
   - **Capability deltas main↔aux:** NONE. Aux holds editable files with same TipTap/canvas surfaces, dirty/save/Send→Duo all work the same. Three things deferred (not absent): browser-tabs-in-aux, pinning, multi-tab.
   - **Agent default routing:** ALWAYS main. Trigger words for split: "in split / in split view / in the split / alongside / side by side / see these side by side / in the side panel / as a companion / open this in the side". Anything else → main. Documented in `agents/duo.md`.
   - **`⌘\`` cycle scope:** 2-way (terminal ↔ working pane) where "working pane" is whichever side was last focused. Moving between main and aux uses mouse click or a future chord (out of scope for v1).
   - **`⌃Tab` scope:** focused-pane-only. Cross-pane cycling rejected. Aux has 1 tab in v1 so cycling within aux is a no-op.
   - **User-facing label:** "Split View" (current; no rename). CLI verb `duo split-view`. Internal code keeps "aux" as shorter handle.

4. **One open question deferred:** FTUX default split content (auto-split welcome on first launch?) — pick after dogfooding; doesn't gate code work.

---

## Live smoke walk results — 2026-05-03

Walked against fresh dev rebuilt with all Phase 1/2/3 commits + the v3 fixes. All 5 items PASS:

| Item | Result | Note |
|---|---|---|
| BUG-070 v3 | ✅ PASS | Fresh `duo html new` canvas; first click in body lands cursor; typed text appears immediately. No tab-away+back needed. |
| BUG-061 v3 bullet | ✅ PASS | `- bullet trigger v3` rendered as `• bullet trigger v3`. |
| BUG-061 v3 ordered | ✅ PASS | `1. ordered` rendered as numbered list. |
| ENH-039 tilde | ✅ PASS | Click on `~/.claude/duo/help/faq.html` in walk-3 page → FAQ opened in browser pane with expanded path. |
| Phase 3 Split View v1 | ✅ PASS | `duo split-view {state, open, resize, promote, close}` all work. Visible side-by-side layout with AuxHeader (SPLIT label + filename + ⇤ + ✕). Close button works. Promote correctly creates new main tab + sets active. |

**One observation logged but not blocked-on:** `left_click_drag` on the 4px divider didn't trigger resize from synthetic mouse drag. CLI `duo split-view resize <pct>` works fine. UX-tuning followup; doesn't block sprint.

**Per-page split-routing meta** (commit `f7ff1fe`) NOT yet live-verified — main-process change requires another dev restart. Renderer-level changes (BUG-070 v3 + BUG-061 v3) verified in-session via Vite HMR.

---

## What's blocked on owner

1. ~~**Pick a styling option** for the Split View chrome.~~ ✅
   Resolved 2026-05-03 afternoon — owner picked **option A**
   (current/shipped slim symmetric chrome). No further chrome work
   for v0.6.4.

2. **(Soft)** Dev-restart to live-verify the per-page split-routing
   meta from `f7ff1fe` AND the idle-thoughts-sweep main-process
   changes (BUG-071 focus transfer, ENH-081 open-file handler).
   Renderer-only items from the sweep (ENH-076, ENH-078, ENH-079)
   are HMR-live in the running dev. Main-process items + the
   styling-pick canvas's path-routing meta need a single restart
   to live-test as a batch.

3. **Smoke walk** — after the dev restart, I'll generate a
   smoke-walk manifest covering: BUG-070 v3 (re-confirm), BUG-061
   v3 (re-confirm), ENH-039 (re-confirm), Phase 3a Split View
   end-to-end (re-confirm), Phase 3a polish per-page meta (NEW —
   needs the restart), ENH-076, ENH-078, ENH-079, BUG-071 (NEW —
   needs the restart).

---

## What's still queued for v0.6.4 cut

After the styling pick lands:

- **Phase 3b — invocation surfaces:**
  - Right-click "Move to Split View" on tabs (main only; aux's right-click should NOT show this entry)
  - Right-click "Open in Split View" on file rows in `FileTree`
  - Right-click "Open in Split View" on rows in `PinnedNav`
  - Right-click "Open in Split View" on `[data-duo-path]` in pages (per-link override; uses `data-duo-target` attr)
  - Keyboard: `⌘\` (open/move active tab to split) + `⌘⇧\` (close split). Routed through `globalShortcuts.ts`.

- **Phase 3c — persistence + edge cases:**
  - Session-state persistence: `aux.tabs[]` + `splitPct` survive launch via `session-state-service.ts`. State shape is additive (missing field = no split).
  - Empty-main promotion: closing the LAST main tab while aux is open promotes aux's tab to main (already wired in App.tsx; needs integration test).
  - Dirty-replacement native dialog: opening new aux content while aux is dirty fires `dialog.confirm` Save/Discard/Cancel.
  - Browser-in-aux: aux can hold a `kind: 'browser'` tab. Requires BrowserManager coordination.
  - FTUX default decision (deferred non-blocker).

- **v0.6.4 cut:** CHANGELOG, RELEASES.md "Pending → not yet cut" stash, faq.html "What's New," what-duo-does.html new-capabilities, then `cut-version` skill.

---

## How to resume after compaction

1. **Read this file FIRST.** Note the locked direction in `## Locked decisions this arc`.
2. **Check `git log --oneline -15`** — confirm the commit chain matches the table above.
3. **Check the styling canvas** — `docs/prd/canvas-split-view-styling.html`. If owner has picked an option in the chat history, look for which letter; align `WorkingPane.tsx § AuxHeader` accordingly. If not, ask.
4. **Most likely next action:** if styling picked, start Phase 3b (right-click menu items + keyboard chords). If not picked, ping owner for the pick.

---

## Cross-reference index

| File | Purpose |
|---|---|
| `docs/prd/canvas-split-view-research.html` | Split View locked spec — 7/8 §5 questions resolved across two AUQ passes |
| `docs/prd/canvas-split-view-styling.html` | 5 styling options with mocks; **owner pick pending** |
| `docs/DECISIONS.md § Editor / canvas convergence` | Phase 2 ADR (Path A: mirror) |
| `docs/DECISIONS.md § WCV-occlusion remediation` | Stage 17 / ENH-050 reference for the native-NSMenu pattern that informs Phase 3b's right-click menus |
| `CLAUDE.md § Plumbing checklists` | New "Editor-canvas parity rule" section |
| `agents/duo.md` § Verb cheat-sheet | `duo split-view` entry with trigger language |
| `tasks.md § BUG-061 / BUG-070 / ENH-039 / ENH-041` | Filed entries; v3 fixes committed |
