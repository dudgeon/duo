# Duo — Bug & Task Backlog

> **Scope.** Engineering ledger — open work + root-cause writeups for closed bugs. **Canonical version-by-version inventory lives in [CHANGELOG.md](CHANGELOG.md)** and the prose log in docs/RELEASES.md; this file is the running notebook with the "why did this break, what did we learn" detail those don't carry. \*\***Reading guide.** Status field on each entry: `🆕 Filed` / `🟡` / `⏳ Open` (active work) vs. `✅ Shipped vX.Y.Z` (closed; kept for historical reference). To find what's actively open at a glance: `grep -B1 "Status:\*\* (🆕\|🟡\|⏳)"`. \*\***Closed-work archive (ENH-191 / D1, 2026-05-31).** Closed entries (✅ shipped · ❌ won't-do · 🟢 done) now live in [tasks-archive.md](tasks-archive.md) — this file had grown to an 11k-line / 1.2 MB monolith (Duo's own editor worst-case). The cut-version skill moves newly-closed entries to the archive on each cut so this stays lean. \*\***Status legend.** OPEN (stay here): 🆕 filed · 🟡 awaiting-decision · ⏳ open · 🚧 in-progress · 🔴 blocker · ⬜ draft · ⚠️ / 🔵 see entry. CLOSED (archived): ✅ shipped · ❌ won't-do · 🟢 done.


### ENH-210: Faint "you-are-here" pill on the active surface's project tile in All mode

**Status:** 🚧 In progress — implemented on `claude/project-rail-pill-treatment-owzqlk`; awaiting owner smoke-walk. **Priority:** P2. **Effort:** S. **Filed:** 2026-06-11 (owner ask).

**Ask (owner, 2026-06-11).** When the project rail is on **All** (`focusedProject === null`), give the parent project of the currently **active surface** a faint pill treatment, so there's an ambient "you-are-here" hint even when no project filter is engaged. Today All mode shows zero indication of which project owns what you're looking at — the strong focused-tile treatment only appears once you explicitly filter.

**Design decisions (owner-clarified).**
- **D1 — Single active surface, not a union.** There is exactly *one* active thing across the whole app at a time — a terminal **or** a canvas/working tab, never both. The pill follows that one surface, resolved from the existing cross-pane focus signal `focusedColumn` (`'files' | 'terminal' | 'working'`):
  - `'terminal'` → the active terminal's project (`terminalMembership[activeTabId]`).
  - `'working'` / `'files'` → the active working tab's project. The navigator (`'files'`) folds into the working side because it drives the canvas; it is not a distinct project source.
- **D2 — Browser mode counts.** The active working tab contributes regardless of kind (page/file/json/image/pdf **and** browser). A `file://` browser tab resolves via `browserTabMembership`; non-`file://` URLs (and no-project surfaces) yield no pill.
- **D3 — All mode only.** Gated on `focusedProject === null`. In focused mode the strong focused-tile treatment already owns the signal; the pill never competes with it. The All tile itself is never pilled (the active surface always resolves to a *project* root, not `null`).
- **D4 — Faint, clearly sub-focused.** A low-alpha tinted fill (`color-mix(in srgb, <tint> 14%, transparent)`) — same idiom family as the globals.css faint tints (12%/22%) — distinct from the focused state's full-hue fill + white text + left notch.

**Implementation.** `renderer/App.tsx` derives `activeSurfaceProject` (memo off `focusedColumn`, `activeTabId`, `activeWorking`, the three membership maps, `browserTabs`) and passes it to `ProjectRail` as `activeProject`. `renderer/components/ProjectRail/ProjectRail.tsx` marks the tile whose `root === activeProject` **only when** `focusedProject === null && !focused`, rendering the faint pill.

**Cross-refs.** ENH-182 (project rail; Phase 3c/D11 auto-focus this complements — D11 switches *filter* on activation in focused mode; this is the ambient cue in All mode), `renderer/App.tsx` (`focusedColumn`, `terminalMembership` / `tabMembership` / `browserTabMembership`, ProjectRail render site), `renderer/components/ProjectRail/ProjectRail.tsx`.

### ENH-213: ⌘⇧F vault-search palette is occluded by the canvas/WCV during search

**Status:** 🆕 Filed (2026-06-12, ENH-208 v0.10.1 walk — owner, non-blocking). **Priority:** P2. **Effort:** S–M (investigate overlay-mute coverage).

**Symptom (owner, walk PASS w/ note).** With a canvas page (or browser tab) in the working pane, opening the ⌘⇧F vault-search palette shows distracting bleed-through from the composited surface behind the overlay — "the canvas occlusion is distracting during search operation." Functionally fine (search + open-at-match work); it's a visual-occlusion polish.

**Fix sketch.** The palette is already in App.tsx's `setOverlayMuted` union (the WCV-occlusion guard) — but the owner still sees occlusion, so the mute likely doesn't cover the **canvas** tab kind (PageTab iframe), only the browser WCV. Audit what `setOverlayMuted` actually hides for `activeWorking.kind === 'page'` vs `'browser'`; the TabSearchPalette / VaultQuickSwitcher overlays share the same machinery, so the fix is shared. Cross-ref the WCV-occlusion remediation notes in `docs/DECISIONS.md`.

### ENH-214: ⌘⇧F should also surface templates so they're findable + editable

**Status:** 🆕 Filed (2026-06-12, ENH-208 v0.10.1 walk — owner, non-blocking). **Priority:** P2. **Effort:** S.

**Symptom (owner).** "⌘⇧F should also surface templates so I can easily find and edit them." Today `core/vault/search.ts` walks via the shared `walk()` which skips `templates/` (in `SKIP_DIRS`, the D5 query-exclusion), so a search never returns template files — there's no quick path to open `templates/person.md` to edit a type's schema.

**Fix sketch.** Two options: (a) include `templates/` in the search scan and tag those hits (e.g. a "template" group/badge in the palette) so they're visually distinct from entity hits; or (b) a dedicated affordance (a `templates ▸` section in the palette, or a `duo vault templates` verb the picker reuses). Keep the corpus/lint exclusion intact — this is search-surface only. Decide (a) vs (b) with the owner; (a) is the smaller change.

### ENH-215: Opening a typed entity note should default its metadata panel to shown

**Status:** 🆕 Filed (2026-06-12, ENH-208 v0.10.1 walk — owner, non-blocking). **Priority:** P2. **Effort:** S.

**Symptom (owner).** "For a typed entity, like person, when we open it the metadata should default to show." Opening a note that carries a `type:` (an entity from a template) should default the editor's FrontmatterPanel to expanded, since the frontmatter fields ARE the entity's data — not collapsed behind a toggle.

**Fix sketch.** In the markdown editor's FrontmatterPanel mount, default `expanded = true` when the parsed frontmatter has a `type:` key (typed entity) — keep the current default (collapsed, or last-state) for ordinary notes. Verify against the per-file persisted panel state so the owner's manual collapse still sticks within a session. `renderer/components/editor/FrontmatterPanel.tsx` + its mount in `MarkdownEditor.tsx`.

### FOLLOWUP-048: Multi-word names can't reach the silent-stub type-picker — the `[[` suggester closes on whitespace

**Status:** 🆕 Filed (2026-06-10, out of ENH-208 Phase 2). **Priority:** P2. **Effort:** S–M (matcher widening + popover-dismiss semantics). _(Renumbered from FOLLOWUP-046 on the v0.10.1 rebase — main's v0.10.1 release notes claimed 046 for the `base render`-on-empty-`.base` follow-up; merged incumbent keeps the number.)_

**Symptom.** D4's example gesture is `[[Jordan Lee]]` ⇥ → type picker — but `findWikilinkMatch` (`renderer/components/editor/extensions/suggestionMatchers.ts`) rejects whitespace in the query, so typing the space after "Jordan" closes the popover before the New: row can be offered. Popover stubs are single-word today; multi-word entities take the narration path (`duo vault stub person "Jordan Lee"`) or cmd+click create. The Vault Guide ch4 documents the limitation explicitly.

**Fix sketch.** Widen the matcher to allow spaces (Obsidian behavior: the `[[` session stays open until `]]`, Escape, or a newline). The risk to manage: a stray `[[` followed by continued prose keeps the popover open — mirror Obsidian's dismissal rules (close on `]]` / Escape / newline + a query-length cap) and extend `suggestionMatchers.test.ts` with the in-prose cases. Then drop the one-word caveat from `docs/guide/vault-guide.html` ch4 + the createNoteRow comment.

**Cross-refs.** ENH-208 D4, `extensions/WikilinkSuggestion.ts`, `extensions/createNoteRow.ts`.

### FOLLOWUP-047: Remove the orphaned find-prev window listeners (global ⌘⇧F retired) + the deliberate browser find-bar asymmetry

**Status:** 🆕 Filed (2026-06-10, out of ENH-208 Phase 2; widened 2026-06-12 per owner decision). **Priority:** P3 (dead code, no user impact). **Effort:** XS.

The ENH-208 D22 re-pick retired the GLOBAL ⌘⇧F find-previous dispatch (the chord now opens the vault-search palette; the find bars' input-local ⌘⇧F still works via the matcher's `ctx.inFindBar` yield). The window-event listeners that consumed the old global dispatch remain, now unreachable: `renderer/components/Page/PageTab.tsx` (`duo-page-find-prev`, ~line 1233) and `renderer/components/BrowserRenderer.tsx` (`duo-browser-find-prev`, ~line 199); MarkdownEditor's copy was already removed with the re-pick. Delete the two listeners + any now-unused dispatch constants; grep `find-prev` to confirm nothing else consumes them.

**Deliberate asymmetry (owner decision, 2026-06-12 — DOCUMENT, don't change).** The browser pane's find bar is **⇧Enter-only** for find-previous: it does not set `data-duo-findbar` and has no input-local ⌘⇧F handler, so ⌘⇧F while it's focused opens the vault-search palette (the `ctx.inFindBar` yield never fires — the bar isn't marked). The editor + canvas bars keep BOTH input-local ⌘⇧F and ⇧Enter. This is intentional, not residue of the cleanup above — whoever picks this item up should remove the dead listeners without "fixing" the asymmetry.

**Cross-refs.** ENH-208 D22 re-pick (PRD), `renderer/keyboard/globalShortcuts.ts` (`inFindBar` gate), FOLLOWUP-048.

### BUG-200: Collapsing the terminal pane terminates ALL terminal sessions

**Status:** 🚧 In progress — surgical fix implemented + **live-verified** on `claude/practical-jones-a07605` (this branch); awaiting owner smoke-walk + cut. **Priority:** P0 (data loss — kills running shells / live Claude sessions). **Effort:** S (surgical) · robust hardening split to ENH-209.

**Symptom (owner report, 2026-06-10).** Collapsing the terminal pane (the collapse control, or `duo split 0`) appears to terminate every terminal session rather than hide it. Expanding spawns fresh shells; the prior processes, scrollback, and any running Claude sessions are gone.

**Root cause (multi-agent code investigation + 3 adversarial verifiers, confidence high).** Collapse UNMOUNTED the terminal subtree instead of hiding it, and `TerminalInstance`'s mount-effect cleanup unconditionally kills its PTY:
1. Collapse sets `splitPct → 0` (`App.tsx` `toggleCollapseTerminal`); `isTerminalCollapsed = splitPct === 0`.
2. The render ternary swapped the entire `<TabBar/> + <TerminalPane/>` subtree for `<CollapsedPaneRail/>` — a real React unmount.
3. `TerminalPane` receives the FULL `tabs` array, so the unmount tears down EVERY `<TerminalInstance>`, not just the active one — this is why ALL sessions die.
4. Each instance's `useEffect` cleanup calls `window.electron.pty.kill(tab.id)` with no collapse-vs-close guard → `PTY_KILL` IPC → `PtyManager.kill()` → node-pty `IPty.kill()` + session delete. Permanent; no detach path exists.
5. On expand, the remount calls `pty.create()` → a brand-new shell in the tab's launch cwd.

Violated the in-code contract at `TerminalPane.tsx` ("hidden — not unmounted — when inactive so the PTY session and scroll buffer survive"); tab-switching already honored it via `display:none`, collapse did not. Note `closeTab` itself never calls `pty.kill` — the unmount cleanup is the SOLE kill path, which is exactly why it couldn't distinguish "collapse" from "close."

**Fix (this branch — option (a), surgical).**
- `renderer/App.tsx` — stop swapping the subtree. Render `CollapsedPaneRail` as a sibling; keep `TabBar + TerminalPane` mounted under a wrapper hidden with a TRUE `display:none` when collapsed (zero box), so PTYs + scrollback survive. On expand the host regains size and the existing `ResizeObserver` refits.
- `core/pty-manager.ts` + `core/constants.ts` — `PtyManager.resize` now floors cols at `TERMINAL_MIN_COLS` (8) as a backstop so even a future hide that clips the host to a narrow strip (vs zeroing it) can't fit to ~4 cols and reflow the live TUI (the BUG-156 reflow class). Grounded by the 900px window `minWidth` (a real terminal is ≥~12 cols even at the 20% min split). 3 new unit tests in `core/pty-manager.test.ts`.

**Why display:none and NOT the 36px column clip.** An adversarial verifier caught that the naive "keep mounted inside the 36px collapsed column" would re-introduce BUG-156: the host would be ~36px (non-zero), the `ResizeObserver`'s zero-size guard wouldn't trip, fit → ~4 cols, `pty.resize(4, …)` reflows the live Claude TUI. The fix MUST hide via a true `display:none` (the existing zero-size guards then no-op cleanly); the cols floor is the structural backstop.

**Verified (live, 2026-06-10 — this worktree's dev build).** Drove the real collapse → expand via the TabBar control (clicked through `duo dom --js`). The 6 `.xterm-host` instances stayed MOUNTED through collapse (pre-fix they'd unmount → 0); every host's `offsetParent` went `null` when collapsed (a true `display:none` ancestor, so the resize guards no-op — no reflow), and on expand the active host regained layout (ResizeObserver refits). The active shell's PID was IDENTICAL before and after the cycle (same `/bin/zsh` process survived; not a fresh spawn). `splitPct` round-tripped 55 → 0 → 55. Typecheck + full suite (1192) green.

**Deferred (owner-approved 2026-06-10).** The robust architecture — decouple PTY-kill from component unmount so NO accidental unmount can destroy a session — is tracked as **ENH-209**. **FOLLOWUP-044** tracks the parallel canvas-pane collapse pattern.

**Cross-refs.** `renderer/App.tsx` (terminal-column render site), `renderer/components/TerminalPane.tsx` (`TerminalInstance` cleanup `pty.kill`; the `display:none` hide pattern; the `ResizeObserver`), `electron/preload.ts` (`PTY_KILL` bridge), `electron/main.ts` (`PTY_KILL` handler), `core/pty-manager.ts` (`kill`/`resize`), `core/constants.ts` (`TERMINAL_MIN_COLS`). Related: BUG-156 (the resize-to-zero SIGHUP class this guards against), ENH-066 (the collapse-rail feature whose ternary introduced the unmount).

---

### ENH-209: Decouple PTY-kill from TerminalInstance unmount (collapse-safety by construction)

**Status:** 🆕 Filed 2026-06-10 (owner-approved deferral from BUG-200). **Priority:** P2. **Effort:** M.

**Ask.** Make it structurally impossible for an accidental React unmount to terminate a shell. Today `TerminalInstance`'s mount-effect cleanup is the *sole* PTY-kill path — `closeTab` / `closeOtherTabs` kill only as an unmount side effect. BUG-200's surgical fix stops *collapse* from unmounting, but any future code that unmounts the pane (a refactor, a new layout mode, an error-boundary remount) would silently kill every session again.

**Approach (sketch — needs a PRD).**
- Move `pty.kill` OUT of the `TerminalInstance` unmount cleanup; on unmount only detach listeners + `term.dispose()` the local xterm view, leaving the PTY alive in main.
- Call `pty.kill` EXPLICITLY from every real close path: `closeTab`, `closeOtherTabs`, the ⌘Z-restore eviction, and window/workspace teardown (cross-check `PtyManager.disposeForWindow`).
- On remount, REATTACH to the surviving session (`PtyManager.create` already no-ops if the session exists) — requires a scrollback/replay path, since the disposed xterm view comes back blank. This is the larger part.
- Remove/repair the stale `renderer/hooks/useTerminal.ts` (`useTerminalIPC` — zero consumers today, also kills on cleanup) so it can't be wired up later and silently reintroduce the bug.

**Why deferred.** Larger surface + reattach/replay semantics + its own tests; BUG-200's surgical fix already resolves the reported data loss. This is the durable hardening.

**Cross-refs.** BUG-200 (parent), FOLLOWUP-044 (canvas parallel), `renderer/components/TerminalPane.tsx`, `renderer/App.tsx` (`closeTab` / `closeOtherTabs`), `core/pty-manager.ts`, `renderer/hooks/useTerminal.ts`.

---

### FOLLOWUP-044: Canvas pane collapse uses the same unmount pattern — verify it doesn't lose editor/browser state

**Status:** 🆕 Filed 2026-06-10. **Priority:** P2. **Effort:** S (investigate) + TBD. **Parent:** BUG-200.

Discovered while fixing BUG-200: the canvas (working-pane) collapse uses the identical render shape — `App.tsx` does `{isCanvasCollapsed ? <CollapsedPaneRail/> : <WorkingPane/>}`, so collapsing the canvas UNMOUNTS `WorkingPane` and all its children (editors, pages, browsers). Unverified whether this loses state: markdown/canvas editors may persist via disk autosave + lifted tab state, and browser tabs are main-process `WebContentsView`s (the renderer unmount may or may not destroy them). **Action:** verify empirically (open an editor with unsaved edits + a browser tab with scroll/form state → collapse canvas → expand → check survival). If state is lost, the fix mirrors BUG-200's `display:none` approach (and folds into ENH-209's decouple work); if `WebContentsView`s are destroyed on collapse, that's the higher-severity case.

**Cross-refs.** BUG-200 (parent — terminal side), ENH-209, `renderer/App.tsx` (canvas-column render site), `renderer/components/WorkingPane.tsx`.

---

### FOLLOWUP-045: No CLI verb fully collapses/expands a pane (splitPct 0/100) — `duo split` clamps to 20–80

**Status:** 🆕 Filed 2026-06-10. **Priority:** P2. **Effort:** S. **Source:** discovered verifying BUG-200.

CLI-parity gap (CLAUDE.md § 4). The human can fully COLLAPSE the terminal (or canvas) pane to `splitPct` 0 (or 100) via the TabBar collapse button / `CollapsedPaneRail` / ⌘⌥0 / ⌘⌥9, but the agent cannot: `duo split <pct>` clamps numerics to 20–80 and none of its presets hit 0/100, and there is no `duo collapse` verb. So collapse/expand is effectively UI-only — verifying BUG-200 required clicking the button through `duo dom --js "…click()"` rather than a first-class verb. **Fix:** add a collapse affordance to the CLI — e.g. `duo split collapse-terminal | collapse-canvas | expand` (routing through `toggleCollapseTerminal` / `toggleCollapseCanvas`), or let `duo split 0|100` bypass the clamp. Then sync the 4 CLI surfaces (`cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`) per the plumbing checklist.

**Cross-refs.** `cli/duo.ts` (`split` verb + its socket handler's clamp), `renderer/App.tsx` (`toggleCollapseTerminal` / `toggleCollapseCanvas`), BUG-200 (the fix whose verification surfaced this).

---

### ENH-207: Drag a file/folder from the navigator to insert its path into the active terminal

**Status:** ✅ **Shipped v0.10.0 (2026-06-08, PR #81)** — owner-requested; smoke-walked 7/8 PASS (one non-blocking FAIL — collapsed-rail drop — deferred to FOLLOWUP-043). Renumbered from a colliding ENH-204 (which #79 holds). **Priority:** Medium. **Effort:** S. *(archive-move deferred to next sweep.)*

**Ask.** Let the user drag a row out of the navigator (`FileTree`) and drop it on the terminal to insert that file's or folder's **absolute path** at the cursor of the **active** terminal — the everyday "point Claude at this file without typing or copy/pasting the path" gesture. Works identically whether the foreground program is a vanilla shell or a running Claude Code session.

**Why.** Long/nested paths are tedious and error-prone to type or hand-copy when telling the agent which file to act on; the navigator already holds the exact absolute path (`entry.path`, annotated `// absolute` in `shared/types.ts`). Drag-to-insert removes the copy/paste round-trip and the typo risk, matching how every mainstream macOS terminal (Terminal.app, iTerm2, VS Code) already behaves.

**Decisions (owner-locked 2026-06-08, via `AskUserQuestion`).** (1) **Scope:** files **and** folders; **navigator-only** (native Finder/OS-file drops deferred — different `dataTransfer` payload). (2) **Terminator:** one **trailing space, no newline** — safe in both shell and Claude (a space submits in neither); a newline would risk submitting a half-formed prompt to Claude. (3) **Multi-select:** dragging with several navigator rows selected inserts **all selected paths, space-joined in tree order** (each single-quote-wrapped if it contains a space/metacharacter), with one trailing space. (4) **Quoting:** POSIX single-quote-wrap a path only when it contains a space/shell-metacharacter; emit raw otherwise. (5) **CLI parity:** satisfied by the shipped `duo send --text "<path>"` (same `ptyManager.write` primitive) — **no new verb**.

**Approach (provisional — see PRD).** Make `FileTree` rows `draggable` and stash the path on `dataTransfer` (a duo-namespaced `application/x-duo-fs-path` type **plus** `text/plain`, so foreign/OS drops stay distinguishable). Add `onDragOver`+`onDrop` on the terminal-column wrapper in `App.tsx` (the `flex-1 overflow-hidden` div around `TerminalPane`) — `onDragOver` **must** `preventDefault()` or Chromium navigates the window to the `file://` URL and blanks the app. Resolve the active PTY via the existing `activeTabId` state and write the assembled payload via `window.electron.pty.write(activeTabId, payload)` — the same transport the Send→Duo pill and `duo send` already use, so **no new IPC**. Fallback if xterm swallows the drop: a capture-phase listener on the xterm host, mirroring the BUG-094 paste handler in `TerminalPane.tsx`.

**Cross-refs.** `renderer/components/FileTree.tsx` (per-row content `<button>` — add `draggable`/`onDragStart`), `renderer/App.tsx` (drop target on the terminal-column wrapper; the existing `pty.write(activeTabId, …)` in the canvas `terminal:send` action), `renderer/components/TerminalPane.tsx` (xterm host + the BUG-094 capture-phase paste precedent), `core/pty-manager.ts` (the shared `write(id, data)` PTY primitive), `cli/duo.ts` (`send` verb — the existing insert-into-active-terminal path that satisfies CLI parity), `shared/types.ts` (`DirEntry.path`). Related: ENH-190 ([PRD](prd/enh-190-navigator-resize-peek.md)) — sibling navigator-interaction upgrade; [ENH-191](#enh-191) — multi-window (the drop resolves the per-window `activeTabId`, so it is window-correct by construction).

**Docs.** PRD at [`docs/prd/enh-207-navigator-drag-path-to-terminal.md`](prd/enh-207-navigator-drag-path-to-terminal.md).

**Smoke walk (v0.9.3, 2026-06-08): 7/8 PASS.** Walked live: real file + folder drag, spaced-path single-quoting, multi-select tree-order, drop onto a running Claude session (lands in the input box, does NOT submit), foreign Finder drag (app stays intact — inert), and regression (nav click/open + terminal tab-reorder). **FAIL (non-blocking — owner confirmed not a functional requirement):** dropping on a *collapsed* terminal rail expands the column but spawns a fresh terminal instead of inserting the path; the common case (drop on the visible/expanded terminal) works. Deferred → FOLLOWUP-043.

---

### FOLLOWUP-043: ENH-207 — drop on a *collapsed* terminal rail should insert (currently expands + spawns a tab)

**Status:** 🆕 Filed 2026-06-08. **Priority:** Low. **Effort:** S. **Parent:** ENH-207.

Surfaced on the ENH-207 v0.9.3 smoke walk (owner: non-blocking, "not a func req"). Dropping a navigator row onto the terminal column while it is **collapsed to the 36px rail** expands the pane but **spawns a new terminal** and does **not** insert the dragged path. Expected (PRD D3c): expand the column and insert at the active terminal's cursor. Root-cause candidates: the drop fires `toggleCollapseTerminal()` (the `App.tsx` terminal-column wrapper `onDrop`) but the subsequent `pty.write(activeTabId, …)` targets a stale / just-revealed tab, and/or the `CollapsedPaneRail`'s own expand affordance consumes the gesture. Fix path: attach the drop handler to `CollapsedPaneRail` directly (or sequence expand → resolve active tab → write on the next tick), then add a smoke-walk line. The expanded-terminal drop (the common case) is unaffected.

---

### ENH-204: Opening a new terminal outside the focused project reverts to "All"

**Status:** ✅ **Shipped v0.10.0 (2026-06-08, [PR #79](https://github.com/dudgeon/duo/pull/79))** — implemented + reviewed twice (own 5-lens workflow + PR `/code-review`, 0 blockers, suggestions folded in); owner waived the live in-app smoke. **Priority:** Owner-requested. **Effort:** S. *(archive-move deferred to next sweep.)*

**Ask (owner, verbatim).** "When I am in a filtered project view, and I open a new terminal with CWD outside that project, I should revert to the 'all projects' (unfiltered) view."

**Why it matters.** ENH-182's focus filter hides any terminal whose membership ≠ `focusedProject` (`visibleTerminals`, App.tsx). So while focused on project A, opening a new terminal anywhere outside A (another project, or a non-project dir like `~`) creates a tab that is hidden the instant it's born — and it's the *active* tab, so the terminal you just asked for "vanishes" and ⌘T / ⌃Tab lose their target. Same disorientation class as BUG-194 (focus pinned to a vanished project), just triggered by a new outside-terminal instead of a `cd`-away.

**Fix.** Two pure helpers in `shared/project-lifecycle.ts` + one effect in `renderer/App.tsx`:
- `newTerminalMembershipsSince(prevIds, tabs, membership)` — the id-diff + first-run baseline, extracted from the effect so the boot-quiet contract is unit-tested (PR #79 review suggestion 1). First run (`prevIds === undefined`) returns `[]`; otherwise the memberships of tabs whose id is new.
- `shouldReleaseFocusForNewTerminals(focusedProject, newMemberships)` — the **exact negation of the visibility filter**: releases when focused and any genuinely-new terminal's membership (deepest enclosing project, or `null` for "no project") `!== focusedProject`. No-op in All mode.
- App.tsx effect (sibling to BUG-194's `shouldReleaseFocus` effect): feeds `seenTerminalIdsRef` through the two helpers, then `setFocusedProject(null)` when a new terminal is a non-member. Centralizing on the `tabs` array means **every** creation path (⌘T, the + button, `openTerminalHere`/`openClaudeIn`, the `duo` CLI, ⌘Z-restore) is covered at once — automatic UI/CLI parity.

**Decisions (owner-confirmable in review).**
- *Release-to-All, not switch-focus.* Owner's words are explicit ("revert to the all-projects view"). This is a **deliberate asymmetry** with the Phase-3c file-open behavior (`duo edit` of a file in another project *switches* focus to that project). Rationale: a new terminal's cwd is frequently a non-project dir, where "switch to its project" has no valid target; release-to-All always works.
- *New-terminal detection, not live-`cd`.* The effect weighs only newly-appeared terminal ids, so a terminal that later `cd`s out of the focused project does **not** retrigger here — that path stays BUG-194's (project drops from the rail → release).
- *Membership-based, mirroring the visibility filter.* The release predicate is the exact negation of `visibleTerminals` (`terminalMembership[id] === focusedProject`). An adversarial 5-lens review (2026-06-08) flagged that an earlier cwd-containment draft diverged from the filter for a **nested sub-project** (`~/repo/packages/sub` where `sub` is its own git root): the path is physically inside `~/repo` but membership is `sub`, so that terminal was kept-focused yet hidden — the exact vanish this ENH targets. Keying on membership closes it. **Residual (first-touch-only):** the *first* terminal opened in a *never-probed* sub-project can keep focus for the ~tens-of-ms until its git probe resolves (membership transiently reads as the parent), then the filter hides it without a release; self-recovers (click the tile or All). Blast radius shrinks to that first touch — the git/marker probe cache persists for the session, so every subsequent terminal in that sub-project releases correctly. Fast-follow if it bites: re-adjudicate **only** on an *unsettled→settled* membership transition for a still-active new tab, so it can't bleed into BUG-194's live-`cd` domain (PR #79 review suggestions 2–3).

**Tests / verify.** 16 new unit tests in `shared/project-lifecycle.test.ts` — the `shouldReleaseFocusForNewTerminals` release matrix (different-project, null/no-project, **nested sub-project**, member-keep, null-focus, batch, "exact negation of the visibility filter" pin) **plus** `newTerminalMembershipsSince` id-diff + first-run baseline incl. an explicit **boot-quiet pin** (first tick never releases even with a non-null focus). 35/35 in the file, full suite 1097/1097, both typecheckers clean. **Reviewed twice:** my own 5-lens adversarial workflow (3 confirmed → folded in: membership-divergence + comment-accuracy; 7 dismissed) and the [PR #79](https://github.com/dudgeon/duo/pull/79) `/code-review` (0 blockers; suggestions 1+3 — extract+test the effect glue, first-touch-only note — folded in here). **Live in-app smoke: waived by owner 2026-06-08** (active dev build was another worktree's; owner opted to merge on static + review verification rather than restart it).

### ENH-191 P5 multi-window follow-ups (post-merge, PR #73)

**Status:** 🆕 Filed 2026-06-08. **Priority:** P1 (item 1) / P3 (rest). **Effort:** S–M. **Source:** code review of PR #73 (merged `2e57ef0`); full detail in the PR comment.

Non-blocking hardening/polish surfaced reviewing the multi-window capstone (window 2 functional + CLI-addressable). The feature is verified — 1093 unit tests + typecheck clean + 8/8 smoke-walk — so none of these gate the merge or a release; they are the residual edges:

1. **[P1] Per-request window target is correct-by-discipline, not by-construction.** `cliTargetWindowId` / `cliDefaultWindowId()` (`electron/main.ts`) is module-global state set in `SocketServer.handle()` and must be read synchronously *before any `await`* in every consuming helper. The invariant is documented but unenforced, and there is no concurrency-interleaving test. → Add a test firing two overlapping `handle()` calls with different `windowId`s and asserting no cross-talk; longer-term, capture the target into a local at `handle()` entry and thread it through, removing the discipline dependency.
2. **[P3] `reassignWindowId` collision-freedom rests on an unasserted ordering invariant** (ascending persisted-id restore + sequential awaits → ascending live ids). → Add a defensive assert (the target live id is not an unprocessed persisted key) or a restore test with non-contiguous persisted ids (e.g. `{2, 3}`).
3. **[P3] `dropWindow`-without-flush + crash window.** An explicitly-closed (non-quit) window's removal isn't durable until the next natural flush (a sibling save / before-quit); a crash in that gap resurrects the closed window on next boot. Self-corrects (close it again).
4. **[P3] git-watcher is single-module last-armer-wins** at N>1 — two windows watching different cwds means the second arming stops the first's `INVALIDATE`. Per-window watchers were explicitly deferred to P5b. Not a crash (the N>1 chokidar-callback crash IS fixed).
5. **[P3] The 12-cache purge list in `createWindow`'s `closed` handler is hand-maintained** ("keep in sync if one is added") — a future `WindowKeyedCache` not added there leaks a closed window's slot past unregister. → Iterate a cache registry, or add a test asserting the list matches `grep new WindowKeyedCache`.

### BUG-198: `duo screenshot` times out (10s socket cap vs base64 round-trip)

**Status:** 🆕 Filed 2026-06-07. **Priority:** Medium. **Effort:** S.

`duo screenshot --out <path>` reliably times out ("Timeout waiting for response to \"screenshot\"") and writes no file. Reproduced 2026-06-07 on dev v0.9.2 (main @ cae95c6) against a normal browser-pane `file://` tab. The CLI's ~10s socket response cap fires before the base64-encoded image round-trips over the Unix socket; the CDP capture path itself works (a one-off Node socket client with a ~60s timeout captured a 92 KB PNG of the same pane). **Pre-existing** — not an ENH-191/203 regression (`main.ts` + `cdp-bridge.ts` untouched on this path; flagged during ENH-191 P2 live smoke). Fix options: (a) raise the per-request timeout for the `screenshot` verb in `cli/duo.ts`; (b) write the image main-side and return only the path instead of shipping base64. See the `core/socket-server.ts` handler + the `screenshot` case in `cli/duo.ts`. Add a regression test; update `docs/CLI-COVERAGE.md` if the contract changes. Surfaced by the v0.9.2 discoverability pre-walk.

### ENH-203: Duo skill ecosystem — bring the bundled skill up to standard + keep it current

**Status:** ✅ **Shipped v0.9.2 (2026-06-07) — executed 2026-06-06; all phases green; synced to ~/.claude.** **Priority:** Owner-requested. **Effort:** L (phased).

**Ask (owner).** The skill ecosystem hasn't been reviewed in a long time. (1) Write a PRD; (2) bring the bundled skill (`skill/**` → `~/.claude/skills/duo/`, `skill/priming.md`, `agents/duo.md`) up to skill-protocol best-practice standard without regressions; (3) add project-side machinery (CLAUDE.md + a path-scoped rule + a mechanical check) to **keep it current as CLI verbs are added**; (4) refactor content out of the oversized `SKILL.md` into `references/` + `scripts/`.

**Audit (6-agent parallel, 2026-06-06; evidence in the ENH-203 workflow transcript).** `SKILL.md` is **827 lines / 65 KB** — past a single Read window, so a one-shot reader sees neither the safety CRITICALs nor the troubleshooting. Fails best-practice gates G1–G3, G6, G7, G10 (see PRD §4). **Live agent-breaking defects:** phantom `duo files` in the **always-on** `priming.md` (every session); dead links to renamed `canvas-authoring.md`/`canvas-interaction.md` (`sync:claude` even `rm`s them); phantom `duo html update` taught 37× across spokes+templates; stale "targets v0.1.x" gate (app 0.9.2); `duo pack list|uninstall` undiscoverable to the subagent; `duo about`/`duo whereami` phantoms in enterprise-deployments.md. **Root cause:** 64/65 verbs hand-duplicated across 4 surfaces (~256 cells) with **zero mechanical enforcement** (no CI, no git hooks; "CLI is the spec" is advisory prose only).

**Plan.** Phase 1: fix all live defects + refactor `printHelp` to a structured `VERBS[]` single-source + ship `scripts/check-skill-currency.mjs` wired into predev/pretest (soft) + cut-version (strict). Phase 2: collapse `SKILL.md` to a ~200-line router, move the verb table + Patterns block into one-level-deep `references/`, add `scripts/`+`assets/`, TOCs, an explicit **never-circumvent-IT/sandbox/exfiltrate** safety directive. Phase 3: no-regression verify + cut.

**Discovered issues logged here (class + instances).** *Class:* the bundled skill drifts silently because nothing enforces the 4-surface sync — ENH-203's `check:skill-currency` is the systemic fix. *Instances (fix in Phase 1, go-green-on-first-run):* `duo files` phantom · `canvas-authoring.md`/`canvas-interaction.md` dead links · `duo html update` phantom · v0.1.x version gate · `duo about`/`duo whereami` phantoms · `duo pack`/`duo html click` undocumented · `printHelp` omits `image`+`pack`.

**Outcome (2026-06-06).** SKILL.md 828→252 lines; description 937→372 chars (trigger front-loaded); the ~99-row command table + 458-line Patterns block moved into one-level-deep `references/` (cli-reference, patterns-{browser,editor,canvas}, debugging, install-troubleshooting) each with a `## Contents` TOC; `printHelp` now renders from a `const VERBS[]` single-source (adds the previously-omitted `image`+`pack`); `priming.md` trimmed to 7 lines + the never-circumvent-controls safety line (phantom `duo files` removed from the always-on layer); explicit safety directive added to the hub + subagent; 5 orphan examples deleted; hook moved `skill/hooks/` → `skill/scripts/` (+ install-service.ts source path). Currency guard `scripts/check-skill-currency.mjs` (7 assertions) wired into `predev`/`pretest` (warn) + `cut-version` (strict). `npm run check:skill-currency --strict` exits 0; build:cli + typecheck + `duo --help` green; synced to `~/.claude` and verified byte-identical. **PR #74 review:** folded in the ENH-198 CriticMarkup track-changes steer (use `duo doc insert`/`delete`/`substitute`/`highlight`, never literal `<ins>`/`<del>`) across SKILL.md + references/comments.md + agents/duo.md + priming.md + CLAUDE.md §4a + `duo doc --help`.

**Deferred fast-follows (tracked).** (1) **D2 generator** — generate `cli-reference.md` + `agents/duo.md` cheat-sheet FROM the `VERBS[]` array (today hand-maintained; the guard catches drift but doesn't remove the 4-surface duplication). (2) **priming upgrade-propagation** — `sync:claude` now always re-copies `priming.md` so dev re-sync propagates, but installed end users only get fixes via a managed-region seam in `electron/install-service.ts` (still bootstrap-only on app upgrade). (3) **assets/ move** — relocate `examples/canvas-templates/` → `skill/assets/` to finish the standard layout (`scripts/` done; `assets/` dir created, empty). (4) **evals** — ≥3 skill eval scenarios run on Haiku/Sonnet/Opus (best-practice G15, currently unmet). **#74 review follow-ups (non-blocking):** (5) **guard hardening** — tighten A2's over-broad `\bno\b` negation (can skip phantom-checking any line containing the word "no") + add `#anchor` validation to A4 (file-existence only today, so a dead in-file section anchor ships undetected); (6) **TOCs** — add `## Contents` to the remaining >100-line references. (Separately: a pre-existing `*.capitalone.com` company-name leak in `package.json` `sync:claude` was flagged out-of-band — predates #74, tracked via its own task.)

**Docs.** PRD at [`docs/prd/enh-203-duo-skill-ecosystem.md`](prd/enh-203-duo-skill-ecosystem.md) (G1–G16 gates · C1–C9/S1–S6 defect ledger · D1–D4 locked decisions · phased plan).

---

> Sprint 24 anchor: close the v0.8.0 audit's deferred follow-ups (FOLLOWUP-031 through 040) before any new feature work. ENH-182 was the marquee chapter; Sprint 24 is its polish epilogue. Definition of done: all 10 FOLLOWUPs closed or explicitly deferred-with-reason. Expected cut shape: v0.8.1 PATCH (polish-only) OR v0.9.0 MINOR if a carry-forward capability lands alongside.


## Sprint 24 / v0.8.1 — v0.8.x polish wave (starting)
### ENH-191: Docs deep-clean — audit findings + owner-decision playground

**Status:** ⏳ **Decisions made + executing.** Owner walked the playground 2026-05-31; D1–D9 shipped on branch `fix/cli-version-and-docs-cleanup`; D10/D11 (the about-duo walkthrough's 7 screenshots) are the only remaining step. **Filed 2026-05-29.** **Priority:** P0/P1 doc-health — version-drift is systemic.

**Ask.** Deep clean + update of project docs (README, what-duo-does, roadmap, tasks, etc.); consider refactors where appropriate (tasks.md is a 1.2 MB monolith); read `about-duo.md` and propose an ordered, conversational feature walkthrough with screenshots in the same voice as the intro.

**What ran.** A 10-agent read-only audit workflow — 6 doc-cluster auditors + a `tasks.md` refactor design + an `about-duo.md` walkthrough proposal + a synthesis pass. (One cluster, dev-ops docs, failed to return structured output; its scope is partly covered by the synthesis and needs a re-run.)

**Deliverable.** Decision-bearing HTML playground at [`docs/research/docs-deep-clean-decisions.html`](research/docs-deep-clean-decisions.html) (Atelier kernel, 12 decision cards + Copy-decisions footer, per rule 11). Decisions: D1 `tasks.md` refactor (rec: status-based archive split → `tasks-archive.md`) · D2 company-reference scrub · D3 refresh RESUME/active-sprint · D4 hard-gate the stale "chrome" surfaces in cut-version · D5 `what-duo-does.html` renumber · D6 `dev/_archive/` + session-log rolling window · D7 VISION/FIRST-RUN/CLI-COVERAGE accuracy · D8 P2 judgment calls · D9 11 mechanical quick-wins · D10–D12 the `about-duo.md` walkthrough (format / media / proceed).

**Top finding — systemic version drift.** Every "chrome" surface `cut-version` is supposed to refresh has frozen at a different era (what-duo-does footer v0.6.9, roadmap header v0.8.0, RESUME/active-sprint at Sprint 24/v0.8.1) while package.json is v0.8.5. Same class as the `cli/duo.ts` `VERSION='0.1.0'` bug fixed 2026-05-29 (sourced from package.json). D4 (hard-gate in cut-version) is the durable systemic fix.

**Stays open until** the owner walks the playground (`duo open docs/research/docs-deep-clean-decisions.html`), copies decisions back, and the agent executes. Surfaces in every smoke walk until closed (rule 11 + research-report-review-task rule).


### ENH-196: Canvas change-highlight on reload (parity follow-on to ENH-195 D3)

**Status:** 🆕 **Filed 2026-06-05 — deferred by owner** (ENH-195 D3 note: "only highlight in markdown; flag as ENH for canvas"). **Priority:** Medium. **Effort:** M. **Parity disposition (renderer-surfaces.md):** (c) **Deferred** — ENH-195 ships the markdown change-highlight (`JustAdded` decoration + `prosemirror-changeset` diff on the clean-buffer reload branch); the canvas (`PageTab` / `justAddedPage.ts`) does not get it in this cut.

**Ask.** Mirror the markdown reload-change-highlight onto the HTML canvas: when an external/agent write reloads a clean canvas, wash the changed elements (`duo-just-added`, persist-until-edit) so the user sees what changed — same UX as the markdown editor's `[HIGHLIGHT-ON-RELOAD]` behavior.

**Why deferred.** Canvas diffing is DOM-level (fuzzier than ProseMirror's `prosemirror-changeset`, which gives inline ranges as positions for free), and the reload is a key-bump remount — so applying transient highlight classes to changed elements after remount needs its own design. `justAddedPage.ts` already has a `recentEdits` freshness-window repaint pattern to build on. Non-blocking; the markdown surface (the high-traffic editing path) carries the feature for v1.

**Cross-refs.** [ENH-195](#enh-195) (parent), `renderer/components/Page/justAddedPage.ts`, `renderer/components/Page/PageTab.tsx` reload branch, DECISIONS.md:620 (editor/canvas parity — this is a deliberate, tracked deferral, not accidental drift).

---



### ENH-198: Agent-native track-changes for markdown — write CriticMarkup, not `<ins>` tags

**Status:** 🆕 **Filed 2026-06-06 — owner, on the v0.9.1-rev2 walk OTHER NOTES.** **Priority:** Medium. **Effort:** S–M.

**Why it surfaced.** Owner told an agent (in a terminal) to "use track changes to modify an .md" → the agent wrote literal `<ins>…</ins>` HTML tags into `/tmp/walk-viewdiff-rev2.md` (a naive interpretation). Those do NOT render as Duo's accept/rejectable tracked changes — the editor's tracked-changes format is **CriticMarkup**, which it already parses. The agent simply didn't know the duo-native format.

**Ask (owner).** When an agent is asked to suggest tracked changes in markdown, the change should render as Duo tracked changes (CriticMarkup marks, accept/rejectable via the SuggestingBanner). *"Either the CLI verbs should tell it how to do it the duo-native way, or the duo MD editor should reformat the written changes as tracked changes — or both."*

**Approaches.**
- **(a) Guidance + a verb (recommended — reuses existing machinery).** The editor ALREADY renders CriticMarkup (`{++inserted++}` / `{--deleted--}` / `{~~old~>new~~}`) as tracked-change marks via `applyCriticMarkupFromText`. The gap is agent awareness. Fix: (1) skill/priming + `duo doc` help — "for tracked-change suggestions in markdown write CriticMarkup tokens, NOT `<ins>`/`<del>` HTML"; (2) optionally a convenience verb (`duo doc suggest --replace <old> <new>` / `--insert <text>`) that applies the edit AS a tracked change through the buffer (echo-safe, like the other `duo doc` verbs), so the agent never hand-writes tokens.
- **(b) Editor reformatting (fallback safety net).** On load/reconcile, detect common track-changes HTML (`<ins>`, `<del>`, `<s>`) and convert to CriticMarkup marks, so a naive `<ins>` write still renders as a tracked insertion. Fuzzier (what to detect, round-trip fidelity).

**Cross-refs.** [ENH-197](#enh-197) (the View-diff tracked-changes machinery), `renderer/components/editor/markdownCriticMarkup.ts` (`applyCriticMarkupFromText`), `core/markdown/criticmarkup.ts`, the `duo doc edit` verb (`core/markdown/plainEdit.ts`) + `.claude/rules/cli-plumbing.md`.

---

### ENH-199: Serialize the remaining atomic-writer services (ENH-191 Phase H follow-on)

**Status:** 🆕 **Filed 2026-06-06 — follow-on from PR #68 (ENH-191 Phase H, Cut 0).** **Priority:** Medium (latent races, same class as the lost-update bug #68 fixed). **Effort:** M.

**Why.** PR #68 routed the `pins` / `nav-pins` / `projects` / `session-state` writers through the new `core/write-queue.ts` (serial async RMW + collision-proof unique tmp), closing the lost-update race. The same fixed-`.duo.tmp` + unserialized-RMW pattern still lives in **~6 other atomic-writer services** the #68 review flagged: `core/active-workspace-service.ts`, `core/browser-history-service.ts`, `core/workspace-file-service.ts`, `core/workspace-history-service.ts`, `electron/files-service.ts`, and `install-service.ts`'s direct `pins.json` writes (bootstrap/upgrade-only — lower risk). Less likely to interleave today, but the fix's unique-tmp half should reach them too.

**Ask.** Audit which of these are genuinely concurrent vs bootstrap-only; route the concurrent ones through `createWriteQueue()` (or at minimum `uniqueTmpPath()`), with interleave tests mirroring `core/pin-services.test.ts`.

**Cross-refs.** `core/write-queue.ts`, `core/pin-services.test.ts`, PR #68, `docs/prd/enh-191-multi-window.md` → Phase H / risk R6.

---

### ENH-200: Wire `npm run lint` into an enforcement point (the gate is latent)

**Status:** 🆕 **Filed 2026-06-06 — follow-on from PR #69 (functional lint).** **Priority:** Low–Medium. **Effort:** S.

**Why.** PR #69 made `npm run lint` a real, runnable ESLint 8 flat-config gate (0 errors / ~59 warnings today). But **nothing invokes it automatically** — no CI workflow references eslint and there's no pre-commit/pre-push hook — so it only has teeth when run by hand. Duo already has a `predev`/`pretest` hook pattern (`scripts/check-materialization.sh`) to model on.

**Ask.** Add an enforcement point so `eslint .` runs on change — a GitHub Actions lint job (if/when CI exists), a `prepush` hook, or a `lint` step folded into the existing pre-* chain. Keep it error-gating only (warnings stay visible, non-blocking) per #69's lenient posture. Optionally add a `package.json` `engines` field pinning Node ≥18.17, since the ESLint 8 pin is Node-version-coupled.

**Cross-refs.** `eslint.config.mjs`, `package.json` (`lint` script), PR #69.

---

### ENH-201: Rework or remove the red "Release to collapse" navigator affordance (ENH-190 follow-up)

**Status:** 🆕 **Filed 2026-06-06 — owner, on the v0.9.1 smoke-walk.** **Priority:** Low (polish; owner: "it's fine for now"). **Effort:** S.

**Why.** During ENH-190 drag-to-collapse, the navigator's right border turns red with a "Release to collapse" hint. Owner on the walk: *"need a followup ENH to rework the red 'release to collapse' UI; or eliminate it; but it's fine for now."* The red reads as an error/destructive cue for a non-destructive action.

**Ask.** Rework the affordance (calmer color/treatment or a different cue) or remove it — owner picks during the rework. Non-blocking for the v0.9.x cut.

**Cross-refs.** [ENH-190](#enh-190), `renderer/components/FilesPane.tsx` (`willCollapse` state + red border), `renderer/styles/globals.css` (`.nav-resize-handle.will-collapse`).

---

### BUG-197: Navigator rail-peek commits on a whitespace click but NOT on a file/folder click

**Status:** 🆕 **Filed 2026-06-06 — owner, on the v0.9.1 smoke-walk (ENH-190).** **Priority:** Medium (the documented commit gesture is partly broken). **Effort:** S–M.

**Symptom (owner).** While the rail is peeked open, clicking empty body whitespace correctly commits the peek (stays expanded) — but **clicking a file or folder row does NOT also commit the peek** (it should). Owner: *"click in white space persists the expand; clicking in file or folder should but does not also persist the expand."* Non-blocking.

**Likely cause.** The peek-commit handler (ENH-190, `FilesPane.tsx`) fires on a body click, but a file/folder row's own click handler (open/select/toggle) stops propagation or runs first, so the commit path isn't reached on a row click.

**Expected (ENH-190 lock).** "Rail-peek commit = click anywhere in the body (not a header button)" — a file/folder row IS in the body, so it should commit the peek *while also* performing its open/toggle.

**Cross-refs.** [ENH-190](#enh-190), `renderer/components/FilesPane.tsx` (peek-commit handler + tree-row click handlers).

---

### BUG-196: Reloading a browser tab pinned in the Split-View aux may crash the dev app

**Status:** 🆕 **Filed 2026-06-06 — needs repro confirmation.** **Priority:** Medium (if it reproduces — a reload shouldn't take the app down). **Effort:** S–M (investigation).

**Symptom (observed once, v0.9.1 smoke-walk setup).** With the smoke-walk page pinned in the Split-View aux (browser kind), running `duo eval "location.reload()"` (which targets the **aux WebContentsView**, not the renderer shell) was immediately followed by the dev app going DOWN — socket `ECONNREFUSED`, no Electron process, and the dev log ended with no crash stack (clean-ish exit). Restart was clean.

**Suspected cause.** Aux-WCV lifecycle (same neighborhood as BUG-195's stale-aux-ref ghost). Reloading a WebContentsView that's composited into the aux may dispose/re-create it in a way the main process doesn't survive. Could also be dev-mode-only (electron-vite + `file://` reload) rather than a packaged-app bug.

**Repro to confirm.** `duo open <some.html>` → `duo split-view open-browser <id>` → `duo eval "location.reload()"`. Watch for socket drop. Compare against reloading the **renderer shell** (`duo dom --js "location.reload()"`), which is the smoke-walk skill's intended reload and did NOT crash in prior walks.

**Workaround.** Don't reload an aux-pinned browser tab; close + re-open it instead. The smoke-walk skill's §4b reload targets the renderer shell via `duo dom --js`, not the aux via `duo eval` — keep them distinct.

**Cross-refs.** [BUG-195](#bug-195) (aux-WCV stale-ref ghost), `renderer/App.tsx` (aux close/promote handlers), `electron/browser-manager.ts` (`releaseAuxTab`), `core/socket-server.ts`.

---


### ENH-189: Agent-agnostic Duo — Claude Code + Codex (research)

**Status:** 🟡 **Decisions OPEN — merged to `main` 2026-06-06 (PR #64); 7 decision cards (D1–D7) pending owner walk** of [`docs/research/agent-agnostic-duo.html`](research/agent-agnostic-duo.html). Recommended picks are logged below (throughline) but **not yet confirmed** — surfaces in every smoke walk until the owner walks the playground and pastes back the decision set (rule 11 + research-report-review-task rule). Research delivered 2026-05-27 (branch `claude/duo-agent-agnostic-research-9y1t3`). **Priority:** Strategic / owner-decision-gated. **Effort:** research only; implementation scope depends on D1.

**Ask.** Explore making Duo harness-agnostic across the Claude Code and Codex CLIs: identify what works across both, what no-ops with Codex, and what outright breaks; for each, propose options weighed by upfront vs ongoing maintenance burden.

**Deliverable.** Decision-bearing HTML playground at [`docs/research/agent-agnostic-duo.html`](docs/research/agent-agnostic-duo.html) (Atelier kernel, three-rings + cost-quadrant SVGs, UI mockups, 7 decision cards + Copy-decisions footer, per rule 11).

**Key findings (all file:line verified against source; Codex claims verified against OpenAI docs).** The `duo` CLI + Unix-socket bridge are harness-neutral — Codex over the same socket is byte-identical, and all ~100 verbs (browser/editor/canvas/file/layout/git/project/events) are agent-generic (no Claude branch in the dispatch switch). Claude-coupling concentrates in a thin lifecycle skin, tri-categorized (19 touchpoints):
- **Works (4):** socket protocol (`shared/types.ts:22`), ~100 verbs, PTY env injection (`DUO_SESSION`/`DUO_SOCKET`, `core/pty-manager.ts:46`), CLI transport.
- **No-op (3):** subagent (`agents/duo.md` — Codex has no Claude-style delegation subagent), SessionStart hook priming, `claude-return`/`shift-return` (`cli/duo.ts:680`). Silent absence, nothing errors.
- **Breaks (9):** tab `kind:'claude'` auto-launch (`shared/types.ts:7`, no `codex` kind), priming shim's `--append-system-prompt` (`install-service.ts:885` — **verified: Codex has NO per-session system-prompt flag**; issue #11588 closed/unmerged; AGENTS.md is its only instruction channel — this is the one genuinely hard gap), presence probe (`comm==='claude'`, `core/claude-presence.ts:143`), session capture (`~/.claude/projects/<enc-cwd>/*.jsonl`, `claude-session-tracker.ts:75`, vs Codex's date-bucketed `~/.codex/sessions/Y/M/D/rollout-*.jsonl`), `claude --resume` (`electron/main.ts:677`), JSONL title/count parsing, `resolveClaudeBinary` (`resolve-claude.ts:104`), `duo doctor` false-red (`cli/duo.ts:1882`), UserClaudePane (`useUserClaudeNavigator.ts:57`).
- **Generalizable (3):** **the skill** (`SKILL.md` — **the big correction: Codex DOES support skills**, the open agent-skills standard, progressive disclosure + implicit invocation, from `~/.agents/skills/`; sync the existing file there, near-verbatim, or ship a Codex plugin), project marker (`CLAUDE.md`/`.claude/` → add `AGENTS.md`/`.agents/`, `projects-service.ts:107`), author identity default.

**Maintenance-burden law (the throughline).** Coupling that reads a tool's *private file format* (rollout JSONL) or shells its *private flags* (`--append-system-prompt`, which Codex doesn't even have) is a standing drift liability; coupling that rides a *public contract* (the `SKILL.md` standard, `codex resume --last`, env vars, MCP) is durable.

**Recommended throughline (owner to confirm via the playground's decision cards):** D1=A (Claude-first, Codex-tolerant) · D3=B (sync the existing skill to `~/.agents/skills/duo/`; MCP-server later) · D4=A (add `codex` tab kind) · D5=A (add `codex` to presence matcher) · D6=A→B (skip rich resume; offer cwd-aware `codex resume --last`) · D7=C→A (hide pane/skip doctor checks for non-Claude now). Avoid the high-drift moves (parse rollout JSONL, auto-write project AGENTS.md) until parity is a proven need. Escalate D1→B (two-adapter `HarnessAdapter`) only when a *third* harness (Gemini CLI, aider — both also on the `~/.agents/skills/` standard) justifies the abstraction's ongoing cost.

**Affordance audit (rev 3, owner-requested).** New report §2b verifies, per "Breaks" row, whether Codex provides an affordance. Result: **6 direct · 1 partial · 2 none.** Direct (pure Duo-side hardcodes with a clean Codex equivalent): launch (`codex` binary / `codex exec`), presence (match `codex` process), resume action (`codex resume <id>`/`--last`), binary resolution, `duo doctor`, UserClaudePane. Partial: priming — **no** `--append-system-prompt` (openai/codex#11588 closed-unmerged); only file-based AGENTS.md (global `~/.codex/AGENTS.md`/`AGENTS.override.md` or project), and `CODEX_HOME` can scope it but relocates credentials/config too — no clean ephemeral Duo-scoped channel. None (the only genuinely hard residual): session **enumeration** by cwd + session **titles/count** — the active session id is not exposed via env/command/JSON (openai/codex#8923); only the interactive picker or parsing private `rollout-*.jsonl`. So the hard residual is just the session-history surface, which D6 already degrades.

**Goal → Codex-primitive alternatives (rev 4, owner-requested).** New report §2c restates each "Breaks" feature as its *goal* and maps Codex primitives. Key finding: Codex exposes **two integration surfaces** — (1) the terminal/PTY model (thin hooks: a `notify` program firing on `agent-turn-complete` carrying `thread-id` per openai/codex#4005 [cwd not yet in payload]; process presence) and (2) a **programmatic model** richer than Claude Code's (`codex exec --json` → `thread.started`/`turn.*`/`item.*`; `codex app-server`; `codex mcp-server`). So the §2b "None" rows aren't dead-ends: **#4 session-capture** → install a Duo-managed `notify` (scoped via `CODEX_HOME` or `$DUO_SESSION`) that reports `thread-id` live; Duo pairs it with the launching tab's known cwd → a rule-12 pointer, no rollout parsing; resume via `codex resume <id>`. **#6 label** → Duo owns the label (first PTY line + cwd it already sees). **#3 priming** → fold into the skill; no clean Duo-scoped ephemeral channel exists (CODEX_HOME can scope an AGENTS.md but relocates creds/config). The programmatic model gives full fidelity but shifts UX from "terminal you type into" to "service Duo drives" — a bigger bet, flagged not recommended for v1.

**Two distinct "teach the agent" problems (clarified rev 3).** (A) a *contributor's* agent working on the Duo repo → `CLAUDE.md` + the new repo-root `AGENTS.md` "Codex guidance shim" (owner-committed `ede8ae7`; points Codex at CLAUDE.md as canonical, says read `.claude/skills/**` directly, don't mirror a parallel tree). (B) an *end-user's* agent driving the Duo app via the `duo` CLI → the shipped `skill/SKILL.md` installed to the agent's skills dir. D3 is about (B); the committed AGENTS.md handles (A). Branch rebased onto `main` (ede8ae7) so it carries the owner's AGENTS.md.

**Process note (rev 2).** First draft wrongly claimed "Codex has no skills concept"; a web-search "fix" then wrongly placed Codex skills at `~/.codex/skills/`. Owner supplied the authoritative OpenAI Agent Skills doc; report was rewritten from a re-verified fact base (Duo files read from source; Codex facts cross-checked, incl. issue #11588 for the append-system-prompt gap). Counts also corrected (was mislabeled 19/Breaks-8; actual 19 with Breaks-9).

**Next.** Owner walks the playground, picks the decision set, pastes back → that pins implementation scope. No code changes shipped in this sprint (research only).

---

### BUG-191: Ghost project tile persists with no open files/terminals (frozen launch-cwd)

**Status:** ✅ **Cut into v0.8.5 (2026-06-02) on agent verification** — option (a) live-cwd tracking. Root-caused via 38-agent workflow (5-reader map → ranked hypotheses → 3-lens adversarial verification). **Priority:** Medium (persistent daily annoyance; functionally benign). **Effort:** M. **Smoke walk v0.8.5: owner SKIP** (didn't hand-walk); owner accepted **agent live-verification (3 ways:** unit tests + socket cd-out/cd-in tile clear+restore + computer-use screenshots**)** as sufficient for the cut.

**Fix (2026-05-31).** Membership now tracks each terminal's LIVE shell cwd, not its frozen launch cwd. New batched, liveness-aware main handler `PTY_LIVE_CWDS` (async `lsof` + a `PtyManager.getLiveness` tri-state so an exited shell drops its tile while a not-yet-spawned tab keeps its launch cwd) — `electron/main.ts`, `core/pty-manager.ts`. Renderer polls it on a visibility-gated 5s interval into a `liveCwdInfo` map that `deriveProjects` consumes via the new pure `effectiveProjectTerminals` (`shared/project-lifecycle.ts`); `mergeLiveCwdInfo` keeps the map reference stable so a steady poll doesn't re-derive every tick (`renderer/App.tsx`). **Verified live:** a shell that `cd`s out of a project clears its tile within the poll window; `cd` back restores it; tiles for `/tmp`-launched terminals canonicalize to `/private/tmp` via the live probe. Unit-covered in `shared/project-lifecycle.test.ts`.

**Symptom (owner, recurring).** A project tile persists in the rail "when no files or terminal tabs from that project are open."

**Root cause — frozen terminal launch-cwd** (confirmed: survived all three adversarial lenses, `refuteCount 0`). A tile renders only if its root owns ≥1 member or is pinned; a zero-member *unpinned* tile is provably impossible. A terminal's `cwd` is set once in `makeTab` (`renderer/App.tsx:192-200`) and **never rewritten** — not when the shell `cd`s away, not when the shell process exits. So `projectTerminals` (`App.tsx:882-885`, unfiltered `tabs.map(t => ({id, cwd}))`) carries the stale launch cwd into `deriveProjects`, and `terminalMembership` (`shared/projects.ts:247-248, 260-262`) re-qualifies the launch project on every derive. The `closeTab` floor-of-1 guard (`App.tsx:1600`) prevents closing a sole stale terminal, amplifying it. `PTY_LIVE_CWD` (the live shell cwd, `shared/types.ts:1398-1402`) already exists but is only read to *seed* a new tab, never written back. Secondary vector: a working tab whose file was deleted on disk is never pruned from `fileTabs[]` (no in-session `files.watch` prune; `MarkdownEditor.tsx:1024-1030` ignores `'removed'`).

**Triage (decisive observable).** The ghost's **pin pip** (`ProjectRail.tsx:250-256`) splits the cases: **pip-less** → this frozen-cwd/dead-shell bug; **pip present** → pinned tile, i.e. by-design (D12) or [FOLLOWUP-037](#followup-037) (pinned + marker deleted out-of-band) — *not* this bug. Right-click count `N≥1` = stale terminal, `M≥1` = stale file tab.

**Fix options (see playground).** (a) **[rec]** track the live shell cwd into membership (wire `PTY_LIVE_CWD` through `useTerminal.ts` → `tabs[].cwd`; drop membership on PTY exit); (b) prune dead members reactively (PTY-exit + `files.watch` on `'removed'`, mirrors PR #59's navigator self-heal); (c) diagnostics only (explain the ghost, don't remove it).

**Deliverable.** Decision-bearing HTML playground [`docs/research/bug-191-192-ghost-tiles-jitter-rootcause.html`](research/bug-191-192-ghost-tiles-jitter-rootcause.html) (Atelier kernel, pin-pip triage mockup, causal-chain diagram, option cards, 3 decision cards + Copy-decisions footer; per rule 11). **Open via `duo open`, not the Claude preview panel** (clipboard).

**Related.** Distinct from [FOLLOWUP-037](#followup-037) (pip-bearing pinned case). Same stale-persisted-state family as [BUG-167](#bug-167) / PR #59 (the prune pattern option (b) reuses). Shares a root family with [BUG-192](#bug-192) (the *transition* face of the same membership-state design).

**Next.** Owner walks the playground (Q1 fix + Q3 sequencing), pastes decisions back → pins implementation scope. **Review task: surfaces in every smoke walk until owner closes the decision.**

---

### BUG-192: Recursive jitter / force-quit loop when closing a project tile via right-click

**Status:** ✅ **Owner-PASS on smoke walk v0.8.5 (2026-06-02).** Fix on branch `claude/kind-goldstine-6904c1` — option (a) atomic + re-entrancy-guarded handler. **Priority:** High (force-quit-level) but was **Low static-confidence** on the exact edge; owner walked the right-click close gesture with no jitter/force-quit. **Effort:** M.

**Fix (2026-05-31).** `handleCloseProject` (`renderer/App.tsx`) now: (1) guards re-entrancy via `inFlightCloseRef` (a second close for the same root no-ops — generalizes [FOLLOWUP-032](#followup-032)); (2) runs `await dialog.confirm` BEFORE any snapshot/mutation, closing the await-split window; (3) hoists `setActiveTabId` OUT of the `setTabs` updater (the nested-setState anti-pattern). Member/survivor/active-shift logic extracted to the pure, unit-tested `planProjectClose` (`shared/project-lifecycle.ts`). **Verified:** a live `duo project close` closes the project, the floor-of-1 holds (fresh shell appended), and the app stays responsive — no loop/hang. The exact original right-click gesture with the owner's specific tab/browser state was not reproduced (it was never deterministic); the structural hazards are removed, so the owner's retry is the final confirmation.

**Symptom (owner).** Right-clicking a project tile and choosing the close item triggered a recursive/jittering re-render loop severe enough to require a force quit.

**Root cause — not pinned down by static analysis (honest).** Every *concrete* loop candidate was refuted across all three lenses — they each provably converge in today's build (value-equality bailouts, monotone probe caches, the `hasTerminalUnderRoot` raw-cwd guard, universal `focusedProject===null` early-returns). The best-supported remaining explanation is the **unguarded cross-store setState burst in `handleCloseProject`** (`App.tsx:1035-1101`): `setTabs` *with a nested `setActiveTabId` inside its updater* (`1064-1075`) + `setFileTabs` + `setActiveWorking` + `setFocusedProject`, optionally split by an `await dialog.confirm` (`1049-1060`), feeding the live effect cluster (browser-redirect machine E5/E6/E7 at `1242-1346` + auto-spawn E9) while membership probes settle — with **no in-flight/re-entrancy guard** (`inFlightCloseRef`, proposed in [FOLLOWUP-032](#followup-032), never implemented). StrictMode is off (`main.tsx:21-25`, no double-invoke damping) and the Close menu item gates on `n>0||m>0` regardless of focus (`ProjectRail.tsx:184`), so a **non-focused-tile close** keeps focus non-null and voids the convergence proofs. The owner *did* force-quit → a non-convergent region is reachable; it most likely lives in the burst→effect-cluster interaction under specific timing (non-focused close + a `file://` browser member tab + probe lag). IPC echo ruled out: `pushState` is echo-free (`electron/main.ts:1841-1843`).

**Fix options (see playground).** (a) **[rec]** make the handler atomic + re-entrancy-guarded (`inFlightCloseRef`; hoist `setActiveTabId` out of the `setTabs` updater; move the confirm before any snapshot) — hardens regardless of the exact trigger; (b) instrument first, then fix (dev-only update-depth counter / effect fire-count logs, repro live per the "build the visibility tool first" rule, then apply (a)) — the conservative move given Low confidence; (c) decouple the browser-redirect machine from the close burst.

**Deliverable.** Same playground as [BUG-191](#bug-191).

**Related.** Sibling "loop crash" to [BUG-190](#bug-190) but distinct (that is an app-quit `Object has been destroyed` cycle, not a render loop). Overlaps [FOLLOWUP-032](#followup-032) (the `inFlightCloseRef` guard option (a) adds). Shares a root family with [BUG-191](#bug-191) (the *steady-state* face).

**Next.** Owner walks the playground (Q2 approach + Q3 sequencing). Recommend instrument-first to confirm the edge before committing the handler rewrite. **Review task: surfaces in every smoke walk until closed.**

---

### BUG-193: Pinned reference tab spuriously maps to a shallow parent project (phantom parent tile + D11 focus theft)

**Status:** ✅ **Owner-PASS on smoke walk v0.8.5 (2026-06-02).** Fix on branch `claude/kind-goldstine-6904c1` — found during the v0.8.5 BUG-191/192 smoke walk. **Priority:** Medium-High (rail unusable when a git-repo parent + pinned tabs coincide). **Effort:** S.

**Symptom (owner, smoke walk).** Opened a terminal in `~/Documents/GitHub/stoop`; the rail spawned TWO tiles — `stoop` AND `~/Documents` — even though only stoop was opened. Worse: clicking the `stoop` tile, focus was immediately stolen by the `Documents` tile (the navigator briefly re-rooted to stoop, then snapped back to Documents). Documents then dominated focus for all projects.

**Root cause (pre-existing ENH-182; NOT the BUG-191 change — it lives in `deriveProjects`, untouched by that work).** `~/Documents` is itself a git repo, so it qualifies. The stoop terminal's candidate walk adds BOTH `stoop` (marker) and `~/Documents` (git root) to the qualifying set. The owner's pinned reference tabs (`tasks.md`, `idle-thoughts.md` in `~/Documents/GitHub/duo`) are correctly **excluded from candidate-gathering** per D2 — so `…/duo` is never added to the set — but their **membership was still computed** in Step 3 (`shared/projects.ts`). With `…/duo` and `…/GitHub` absent from the set, `deepestEnclosingRoot` walked up to the shallowest qualifying ancestor present — `~/Documents` — and assigned it as the pinned tabs' membership. That spurious membership (a) was added to the project set (Step 4) → the phantom Documents tile, and (b) was read by the D11 auto-switch effect (`renderer/App.tsx`) whenever a pinned tab was active → focus snapped to Documents on every rail click.

**Fix (2026-05-31).** `shared/projects.ts` Step 3 — a pinned tab now gets `tabMembership = null` (it's a cross-project reference with no home project, extending D2 from candidate-gathering to membership). This kills both symptoms at the source: no spurious parent root reaches the project set, and D11 reads `null` for an active pinned tab so it never auto-switches. Safe across all consumers — the visibility filter already special-cases pinned tabs (always visible), and `projectCounts` / the close handler correctly stop counting/closing pinned cross-refs. **Verified live:** the Documents tile disappeared (rail → `[stoop]` only); regression test in `core/projects-service.test.ts` ("BUG-193 — a pinned tab does NOT resolve to a shallow parent seeded by another member") fails pre-fix, passes post-fix; 864/864 tests pass.

**Note.** A separate, debatable question remains (not fixed here): should a giant git-tracked parent like `~/Documents` qualify as a project at all? With this fix it only surfaces when something genuinely non-pinned sits directly in it, which is arguably correct. File a follow-up if the owner wants parent-git-repo suppression.

---

### BUG-194: Focused project's last terminal cd-d out → terminal tab vanishes (multitab breaks)

**Status:** ✅ **Owner-PASS on smoke walk v0.8.5 (2026-06-02).** Fix on branch `claude/kind-goldstine-6904c1` — direct follow-on regression from BUG-191. **Priority:** High (loses access to a live terminal + breaks ⌘T/⌃Tab). **Effort:** S.

**Symptom (owner, smoke walk).** While focused on a project that had a single terminal, `cd`-ing that terminal OUT into a no-project root cleared the tile as expected — but the active terminal's TAB disappeared too. With the terminal strip empty, ⌘T just replaced the current terminal and ⌃Tab cycled the canvas tabs instead of terminals (multitab effectively dead).

**Root cause (introduced by BUG-191).** Membership now tracks the live shell cwd, so `cd`-ing the focused project's last terminal out drops the project from the rail. But `focusedProject` stayed pinned to the now-gone project, and the visibility filter `visibleTerminals = tabs.filter(t => terminalMembership[t.id] === focusedProject)` (`renderer/App.tsx`) then matched nothing — the orphaned terminal was filtered out of view (still in `tabs`, just hidden), and ⌘T/⌃Tab lost their target. Pre-BUG-191 this couldn't happen because membership was frozen at launch cwd (a cd never changed it).

**Fix (2026-06-01).** New pure `shouldReleaseFocus(focusedProject, projectRoots)` (`shared/project-lifecycle.ts`) + an effect in `renderer/App.tsx` keyed on `[railProjects, focusedProject]` that releases focus to "All" when the focused project is no longer in the rail. All view shows every terminal, so the orphaned terminal reappears and multitab works again. Pinned projects persist in `railProjects` even with zero members, so focusing a pinned-but-empty project correctly does NOT release. **Verified live:** focus released to All after the sole member cd-d out (terminal stays visible); tile clears once the project truly empties. Unit-covered (`shared/project-lifecycle.test.ts`, 4 cases). 868/868 tests pass.

---

### BUG-190: Quit-loop crash — "Object has been destroyed" cycling dialog on app quit

**Status:** 🟡 **Fix pushed `claude/duo-quit-loop-bug-OBZHB` 2026-05-27.** **Priority:** High (app un-quittable without force-quit). **Effort:** ~30 min.

> **Renumbered BUG-189 → BUG-190 (PR #61 review).** This PR opened before [ENH-189](#enh-189) ([#62](https://github.com/dudgeon/duo/pull/62)) landed on `main`; ENH-189 claimed the next-free id while #61 sat open. Same shared BUG/ENH counter, same collision pattern as the [ENH-187 → ENH-188 rename](#enh-188) the prior sprint; moved to the next free id, BUG-190.

**Symptom (owner repro 2026-05-27).** Quitting Duo popped the Electron "A JavaScript error occurred in the main process" dialog — `TypeError: Object has been destroyed` at `webContents.send` inside a node-pty `onData` handler. Clicking OK re-popped it immediately; the dialog cycled and owner had to force-quit.

**Root cause.** PtyManager forwards terminal output to the renderer through an EventSink adapter wired in `electron/main.ts` as `(channel, payload) => mainWindow?.webContents.send(...)`. The `?.` guards a *null* `mainWindow` but not a *destroyed* one. On quit, `before-quit` calls `ptyManager.dispose()` → `pty.kill()`, which makes node-pty flush a final burst of buffered output as `onData` events. Those fire after the window's `webContents` is torn down but before the `'closed'` handler nulls `mainWindow`, so each send throws "Object has been destroyed". The throw is uncaught (→ Electron's crash dialog), and because the buffered data keeps draining, every subsequent `onData` re-throws → the dialog loops. The same unguarded closure pattern existed in the socket-server EventSink, the BrowserManager state/tabs callbacks, and the nav-pins push — all async-driven, so all could race teardown the same way (the git-watch path had already grown a bespoke `webContents.isDestroyed()` guard, evidence this class had bitten before).

**Fix.** Added a single `safeSend(channel, payload?)` helper in `electron/main.ts` that checks `mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()` before sending, and routed every async-callback sink through it (PtyManager + socket-server EventSinks, BrowserManager state/tabs, nav-pins, claude-presence, git-watch — the last two had window-only / bespoke guards now consolidated onto the canonical path). No behavior change on the live path; sends mid-teardown become silent no-ops, which stops the throw and therefore the loop.

**Verification.** Reasoning + `npm run typecheck` clean. Not run in-app: this is a macOS-only Electron quit-time path and the fix landed in a Linux cloud container (no Electron, node-pty native rebuild unavailable). Owner smoke: launch Duo with a live terminal producing output, then ⌘Q — should quit cleanly with no error dialog.

**Follow-up (now folded in, same PR).** `electron/browser-manager.ts` had three still-unguarded `this.window.webContents.send` calls in the key-forward (1274/1405) and focus (1440) handlers, plus a `this.window.webContents.focus()` (1397) that would also throw on a destroyed window. Lower severity — they fire on keyboard/focus events (one-shot, no buffered-data burst), so they couldn't reproduce the *loop*, at most a single dialog if they raced quit. Hardened with an early-return guard at the top of each handler (`this.window.isDestroyed() || this.window.webContents.isDestroyed()`) — matching the file's existing inline-guard convention plus the webContents check that was this bug's root cause.

---

### BUG-167: Navigator ENOENT spam from ghost folders + console-flooding focus instrumentation

**Status:** 🟡 **Fix folded into PR #59 (ENH-182 polish epilogue) 2026-05-28.** **Priority:** Medium (console noise + perceived instability; functionally benign). **Effort:** ~1h.

**Symptom.** Switching between projects in v0.8.2 floods the renderer console with two error classes: repeated `[nav] list failed for …/skills/setup-check-workspace — Error invoking remote method 'files:list': ENOENT`, and per-interaction `[ENH-084-v4] … focusin/mousedown/blur` logs. Both read like instability; both are benign.

**Root cause (nav ENOENT).** `useNavigator` persists every folder ever expanded to `localStorage` (`duo.nav.expanded`) and never prunes it; the persisted `cwd` is restored with no existence check. The watcher effect depends on `[cwd, expanded]`, so each project switch re-subscribes and re-lists the entire expanded set. Any folder deleted/moved since — e.g. a transient skill workspace like `setup-check-workspace` — throws ENOENT on every navigation. Same pattern in `useUserClaudeNavigator`. PR #59's reactive heal cures the spam once the user navigates to the dead folder; this fold-in adds a **proactive mount-time prune** so the ghosts are gone *before* the first project switch.

**Root cause (`[ENH-084-v4]`).** `WorkingPane.tsx` installs document-wide `focusin` / `mousedown` / `blur` listeners that `console.log` on every event — a Sprint 17 "INSTRUMENTATION ONLY" data-capture pass that was never re-gated, so it ships in release builds.

**Fix.** Extracted shared util `renderer/hooks/pruneDeadPaths.ts` (`findDeadExpandedPaths` + `nearestExistingAncestor`, both probe-driven so a transient IPC failure leaves entries intact). Wired into:
- **`useNavigator`** — mount-time effect that recovers a missing persisted cwd to the nearest existing ancestor (else `initialCwd`) and drops dead `expanded` entries. Composes with PR #59's reactive heal: prune at startup, heal on first failure mid-session.
- **`useUserClaudeNavigator`** — same prune (no cwd to recover; root is fixed at `~/.claude`).
- **`WorkingPane.tsx`** — focus instrumentation gated behind opt-in `localStorage.duo.debug.focus === '1'` (read once on mount). Silent in release; recoverable if the subpane-focus work resumes. Deliberate asymmetry: developer-only, no `duo` verb (not a product surface).
- Replaced the inline `nearestExistingAncestor` in PR #59 with a call to the shared util so the reactive and proactive paths can't drift.

**Tests.** `renderer/hooks/pruneDeadPaths.test.ts` — 8 cases pinning the invariants: dead paths returned, probe failures kept (no speculative drops), empty set short-circuits, parallel probing, ancestor walk recovers + stops at fallback + survives a thrown probe.

**Cross-ref:** ENH-084 (the focus-glow defect whose v4 instrumentation this gates), BUG-039 (the `files.exists` probe pattern reused here for session-restore tab pruning), ENH-182 (project navigation, the surface this fires on). **Closed PR #63** filed the same bug independently (different shape: ENOENT string-match classifier + duplicated mount-prune in both hooks). Closed in favor of this fold-in.

---

### ENH-188: Terminal-tab context menu — parity with canvas tabs (reorder + close + copy cwd)

**Status:** 🆕 **Filed + implemented 2026-05-27** (branch `claude/terminal-tabs-context-parity-2lh2X`). **Priority:** Medium (daily-driver ergonomics; the headline gap is "can't reorder terminal tabs"). **Effort:** ~1.5h.

> **Renumbered ENH-187 → ENH-188 (PR #60 review).** The branch was cut from pre-v0.8.1 main; ENH-187 was meanwhile taken by the shipped `⌘T`/`duo new-tab` live-cwd-inheritance feature (v0.8.1, commit `0d303e1`). Different surface, so this work moved to the next free id, ENH-188.

**Symptom.** The terminal-tab right-click menu (`TabBar.tsx`) offered a single verb — "Reveal in navigator" (ENH-115) — while the canvas-tab menu (`WorkingTabStrip.tsx`) is rich: reveal, rename, copy path, **move left/right**, pin, move-to-split, edit-in-canvas, open-in-browser, view-source, trash. Terminal tabs couldn't be reordered at all (no drag, no menu), so a mis-ordered strip was permanent until close + reopen.

**Scope (owner-confirmed via AskUserQuestion 2026-05-27).** Reviewed every canvas-tab action for terminal fit:
- **Brought over:** **Move tab left / right** (the headline ask), **Copy cwd** (analog of canvas "Copy path" — tabs carry a `cwd`), **Close tab** (menu mirror of the × button), **Close other tabs** (no canvas analog, but a standard tab-strip verb). Plus the pre-existing **Reveal in navigator**.
- **Reorder gesture:** menu **+ HTML5 drag-and-drop** (mirrors canvas ENH-042), per owner pick. Distinct dataTransfer type `application/x-duo-terminal-tab-id` so terminal/canvas drags never cross-contaminate.
- **Skipped — no terminal analog:** Pin/Unpin (terminals have no pin concept), Move to Split View (working-pane-only), Edit-in-canvas / Open-in-browser (HTML modality flip), View source (file-content concept), Move to Trash (terminals aren't files — Close is the analog).
- **Skipped — not true parity:** Rename… (canvas renames the *file*; terminal titles come from the process/OSC — a manual override would be a new concept, declined for v1).

**Implementation.** `renderer/components/TabBar.tsx` — context-menu builder expanded (position-aware move items, separators between groups), HTML5 drag handlers + `dropTargetId` accent insertion cue, new `onReorderTab` / `onCloseOthers` props. `renderer/App.tsx` — `reorderTerminalTab(sourceId, targetId)` reorders the full `tabs` array with insert-before/after semantics (mirrors WorkingPane's `reorderTab`) while **preserving hidden tabs' absolute slots** under ENH-182 project focus (reorders only within the visible subsequence, rebuilds in place); `closeOtherTabs(keepId)` closes every *visible* terminal tab except the kept one and pushes each onto the ENH-179 closed-tab ring (⌘Z-restorable). Reorder persists for free via the existing workspace-save (`terminals: tabs.map(...)`). The reorder transform is extracted as the pure `shared/reorderTabs.ts § reorderVisible(items, sourceId, targetId, isVisible)` with **9 unit tests** (`shared/reorderTabs.test.ts`) pinning the insert-before/after + hidden-slot-preservation invariants (PR #60 review ask).

**Deliberate asymmetry (CLI parity).** Canvas "move left/right" is itself UI-only — there is **no** `duo` verb for canvas reorder either (only `BROWSER_MOVE_TAB_TO_AUX`). So terminal reorder shipping UI-only *faithfully* approaches canvas parity rather than introducing a new gap. The CLI verb is deferred, not skipped → FOLLOWUP-042.

**Cross-ref:** ENH-115 (the original single-verb terminal menu), ENH-042 (canvas drag-reorder this mirrors), ENH-050 (native NSMenu popup pattern both strips share), ENH-179 (closed-tab ring), ENH-182 (project-focus visibility filter the reorder respects).

---

### FOLLOWUP-042: `duo move-terminal-tab` (and arguably `duo move-tab` for canvas) CLI verb

**Status:** 🆕 **Filed 2026-05-27** (ENH-188 scoping, owner chose "defer CLI verb as follow-up"). **Priority:** Low. **Effort:** ~45 min (full new-CLI-verb plumbing checklist).

**Gap.** ENH-188 added human-facing terminal-tab reorder (menu + drag) but no CLI verb — matching the canvas side, which is *also* UI-only. CLAUDE.md §4 wants every human action mirrored in the CLI; this is a known, deliberate asymmetry pending this follow-up.

**Fix path.** Add `duo move-terminal-tab <n> <left|right>` (1-indexed against the visible strip). Probably pairs with a `duo move-tab <n> <left|right>` for the canvas WorkingPane so both reorder surfaces gain CLI parity in one pass. Full plumbing checklist applies (`shared/types.ts` → `electron/preload.ts` → `electron/main.ts` → `electron/socket-server.ts` → `cli/duo.ts` + `npm run build:cli` → `skill/SKILL.md` + `npm run sync:claude` → `agents/duo.md` → `docs/CLI-COVERAGE.md`). The renderer reorder primitives (`reorderTerminalTab`, WorkingPane's `reorderTab`) already exist — this is pure plumbing to reach them from the socket.

---

### BUG-165: Terminal stuck on "[process exited]" when its cwd was deleted

**Status:** 🟡 **Fix pushed `claude/terminal-process-exit-DFgEw` 2026-05-26.** **Priority:** High (terminal unusable, no recovery even on restart). **Effort:** ~45 min.

**Symptom (owner repro 2026-05-26).** Terminal sat in a repo dir; owner ran a command that deleted that dir out from under the shell. Terminal showed `[process exited]` and never recovered — every relaunch re-spawned into the same dead path and exited immediately. DevTools also showed `[nav] list failed for /Users/.../aipm/main … ENOENT: no such file or directory, scandir` (the navigator hitting the same dead path — separate symptom, not fixed here).

**Root cause.** `PtyManager.create` passed the tab's saved `cwd` straight to `pty.spawn`. node-pty's child `chdir(cwd)` fails when the dir is gone → child exits instantly → `onExit` → xterm prints `[process exited]`. The saved tab keeps pointing at the dead path, so the failure is sticky across restarts.

**Fix.** New pure helper `core/cwd-utils.ts § resolveExistingCwd(desired, fallback)` — returns the desired dir if it exists, else walks up to the nearest surviving ancestor (keeps the shell close to where the tab expected to be), else the fallback (home), else `/`. `PtyManager.create` resolves the cwd before spawning, stores the resolved cwd in the session, and — when substituted — injects a one-line amber note into the PTY stream (`[duo] <path> no longer exists — opened <resolved> instead.`) so the user understands the jump. The note is sent synchronously before any async shell output and after the renderer has wired its `onData` listener (both `useTerminal.ts` and `TerminalPane.tsx` wire listeners before calling `create`), so it lands above the first prompt and is never dropped.

**Tests.** `core/cwd-utils.test.ts` (6 tests) — existing path unchanged · nearest-ancestor walk · all-the-way-up walk · empty desired → fallback · non-absolute missing → fallback · neither exists → `/`. Extracted as a node-pty-free module so it's testable in CI without the native binding.

**Review hardening (PR #56, owner 2026-05-26).** ESC bytes stripped from the interpolated `cwd` / `resolvedCwd` before they go into the ANSI-wrapped amber note — a path legally containing `0x1b` (POSIX permits it) could otherwise subvert the color reset or inject terminal sequences. One-line `safe()` in `PtyManager.create`.

**Deferred (owner "no action now").** Substituted cwd is persisted to the session, so if the original dir reappears (git checkout, mkdir) the next respawn won't auto-jump back. A `desiredCwd` / `actualCwd` split on the session would let it. Defer unless it's real friction. → tracked here, not yet a numbered item.

**Spun-off follow-up.** → FOLLOWUP-041 (navigator parity).

---

### FOLLOWUP-041: Navigator `files:list` should fall back like the terminal on a deleted cwd

**Status:** 🆕 **Filed 2026-05-26** (PR #56 review, owner request). **Priority:** Medium (half of the two-pane "where am I?" experience stays broken after BUG-165). **Effort:** ~30-45 min + live walk.

**Symptom.** BUG-165 fixed the terminal recovering from a deleted cwd, but the navigator still ENOENTs: `[nav] list failed for /Users/.../aipm/main … ENOENT: no such file or directory, scandir`. The FileTree's `files:list` IPC hits the same dead path and the tree renders empty/errored.

**Fix path (owner suggestion).** Have the navigator's path-bind reuse `core/cwd-utils.ts § resolveExistingCwd` — when `FilesService.list` (or wherever the FileTree binds its root) ENOENTs, walk up to the same nearest-surviving-ancestor, rebind the tree there, and surface a similar one-line note in the navigator chip. Shared helper keeps terminal + navigator fallback behavior identical.

**Why not bundled into PR #56.** Touches the FileTree UI (rebind + chip note) which needs live verification in the running app; BUG-165's PR is a narrow main-process fix. Keep them separate so the urgent terminal fix can merge without waiting on a UI walk.

---

### ENH-186: Project rail tile abbreviations — word-aware + collision-free

**Status:** 🆕 **Filed + implemented 2026-05-26** (branch `claude/projects-filter-abbreviations-FKeyl`). **Priority:** Medium (daily-driver legibility). **Effort:** ~1.5h.

**Symptom.** The project rail (ENH-182) labels each tile with `name.slice(0, 2)` — the first two characters of the folder name (`ProjectRail.tsx` ~155). Many projects begin with `ai` / `aipm`, so the rail showed a stack of identical, useless **“AI”** tiles. The abbreviation carries no information when several projects share a two-character prefix.

**Fix.** New pure helper `computeProjectAbbreviations(projects)` in `shared/projects.ts` derives a word-aware, collision-free label for the whole visible set at once (collision detection needs every name in hand). Rules:
- **Multi-word** → first letters of the first two words (`ai-pm-tools` → `AP`). On collision (same first two words) → three initials (`APT` / `APD`).
- **Single-word** → first two letters (`platform` → `PL`). On collision → extend one letter at a time (`PLAT` / `PLAN`), capped at four.
- **Proposed fallback** for collisions the letter ladder can't break (`ai-pm-data` vs `ai-pm-dashboard` both → `APD`; two-word names sharing initials): numeric suffix by sort order (`APD`, `APD2`); first tile keeps the clean form. Word-split handles `-` `_` `.` space + camelCase/PascalCase; leading dot stripped.

**Surfaces touched.** `shared/projects.ts` (pure logic + 19 unit tests in `shared/projects.test.ts`); `renderer/components/ProjectRail/ProjectRail.tsx` (computes the map via `useMemo`, passes `abbreviation` per tile — replaces the inline `initials`). No `Project` type / `deriveProjects` change (abbreviation is a view concern that depends on the currently-rendered set).

**Visual mockup.** `docs/research/enh-186-project-abbreviations.html` (interactive — type names, watch tiles resolve) + `docs/research/assets/project-filter/abbreviations-before-after.{svg,png}` (before/after + collision ladder).

**Open for review.** (1) Numeric-suffix fallback vs. a 4th-initial / extra-letter scheme for the unbreakable cases — chose numeric for tile width + consistency. (2) Single-word letter cap (4) before numeric.

---

### FOLLOWUP-035: handleProjectFocus dead-code probe

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 1). **Priority:** Low. **Effort:** 5 min.

**Symptom.** Audit agent flagged `renderer/App.tsx` \~901 declaration of `handleProjectFocus` callback but couldn't find its use site. Possible: dead code, OR shadowed by an inline JSX lambda in `<ProjectRail onFocus={...}>`.

**Fix path.** Grep for `handleProjectFocus` uses; check `<ProjectRail` props; if confirmed dead, remove the declaration + dep array. If actually used (audit was wrong), leave + add a code comment pointing at the call site for future grep audits.

**Bundle target.** Tier 1 polish commit alongside FOLLOWUP-036/038/040.

---

### FOLLOWUP-036: Focus-release chip aria-label repetition

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 1). **Priority:** Low (a11y polish). **Effort:** 5 min.

**Symptom.** `renderer/App.tsx` \~3545 — focus-release chip has both visible text "Focused: {name}" AND `aria-label="Release focus ({name})"`. Screen reader reads "Focused: duo, button, Release focus (duo)" — repetitive.

**Fix.** Drop `({name})` from aria-label (visible text already conveys it) OR simplify aria-label to just "Release focus." Pick the latter — keeps the button-purpose statement clean.

**Bundle target.** Tier 1 polish commit.

---

### FOLLOWUP-038: useWorkspacePillMenuFlag TS narrowing edge case

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 1). **Priority:** Low. **Effort:** 5 min.

**Symptom.** `renderer/hooks/useWorkspacePillMenuFlag.ts` \~41-43 — `function refresh(event: StorageEvent | CustomEvent) { if ('key' in event && event.key && event.key !== LS_KEY) return }`. `'key' in event` is always true on `StorageEvent` AND any CustomEvent that incidentally carries a `key` field. The narrowing intent is "skip storage events for other keys"; a malicious/coincidental CustomEvent on the EVENT channel carrying a `key` field would also be filtered.

**Practically benign.** We dispatch a bare `CustomEvent` (no `key` field), so the filter never fires for our own events. Add a code comment explaining the intent + acknowledging the edge case.

**Bundle target.** Tier 1 polish commit.

---

### FOLLOWUP-040: Smoke-walk item — File → New Workspace with pill flag OFF

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 1). **Priority:** Verification-only. **Effort:** 5 min (manifest entry).

**Why.** ENH-184 defeaturing made the workspace pill a passive label. The audit noted: `WorkspaceSwitcherDropdown.tsx`'s `handleNew` was unchanged (still calls `window.electron.workspaceFile.newWorkspace()`), and the native File menu's `New Workspace` handler routes through the same bridge. Worth one explicit smoke item with `duo workspace-pill-menu off` to verify the menu path still works post-defeaturing.

**Fix.** Add a smoke walk item to the next manifest:

```json
{
  "id": "ENH-184-FILE-MENU-NEW-WORKSPACE",
  "title": "ENH-184 — File → New Workspace works with pill menu disabled",
  "steps": [
    "Confirm pill flag is OFF: `duo workspace-pill-menu` → returns {enabled: false}.",
    "Click File menu → New Workspace.",
    "Confirm a fresh workspace opens (one shell terminal at home, no file tabs, title bar back to 'Duo' or 'No workspace')."
  ]
}
```

**Bundle target.** Tier 1 polish commit (add to manifest as part of the polish bundle's smoke walk).

---

### FOLLOWUP-031: MaxListenersExceededWarning — hoist claudePresence subscription

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 2). **Priority:** **High** (biggest user-facing impact in Sprint 24). **Effort:** \~30 min.

**Symptom.** Renderer log emits `(node:NNNN) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 terminal:claude-presence-changed listeners added to [IpcRenderer]. MaxListeners is 10.` during normal use of a multi-terminal-tab session.

**Root cause.** `renderer/hooks/useClaudePresence.ts:15-19` registers a listener per component mount; each `TerminalPane` invocation creates one. With \~10+ terminal tabs (a routine state), the count exceeds Node's default 10-listener warning threshold. Listeners are properly removed on unmount, but the warning fires the moment count exceeds 10 — even transiently while a tab spawns/closes.

**Fix path.** Hoist the subscription to App.tsx + push state down via React context. Mirrors the existing `useFrontTerminalClaudeLive` pattern. One subscription total (App.tsx level); `useClaudePresence` becomes a `useContext` consumer; no per-TerminalPane listener registration.

**Implementation sketch:**

1. Create `renderer/contexts/ClaudePresenceContext.tsx` — provider holds the per-tab presence map, subscribes to `window.electron.terminal.onClaudePresenceChange` once at App mount.
2. App.tsx wraps children in `<ClaudePresenceContext.Provider>`.
3. `useClaudePresence` becomes `useContext(ClaudePresenceContext)` — returns the map (or a per-tab getter).
4. Each TerminalPane reads via context, no IPC subscription.

**Risk.** Behavior should be identical from the user's perspective. The only observable change is the absence of the warning. Add a regression test that subscribes the same channel N times + counts IPC listeners (assert ≤1).

**Hook-point lesson (Sprint 23 § 7):** the natural shape is "context provider at App.tsx → consume via useContext in TerminalPane." Don't introduce a new state-change-cascade pattern.

---

### FOLLOWUP-032: Double `duo project close` race

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 2). **Priority:** Low (rare CLI race). **Effort:** \~20 min.

**Symptom.** `electron/main.ts:309-317` `requestProjectClose` just sends an IPC event; no lock. Two parallel CLI calls send two `PROJECTS_CLOSE_REQUEST` events, renderer's `handleCloseProject` runs twice. The second invocation reads stale `projectCounts.get(root)` (still has live counts; React state hasn't re-derived yet from the first close), shows a second confirm dialog.

**Repro.** `(duo project close duo &); duo project close duo` → two stacked dialogs if claude-kind member terminal exists.

**Fix.** In `handleCloseProject`, gate on `inFlightCloseRef.current.has(root)`. Set on entry; clear on completion (success or cancel).

```typescript
const inFlightCloseRef = useRef<Set<string>>(new Set())

const handleCloseProject = useCallback(async (root: string) => {
  if (inFlightCloseRef.current.has(root)) return  // already closing
  inFlightCloseRef.current.add(root)
  try {
    // ... existing close logic
  } finally {
    inFlightCloseRef.current.delete(root)
  }
}, [...])
```

**Risk.** Trivial. The ref doesn't interact with React state lifecycle.

---

### FOLLOWUP-033: `duo project list` empty during 1-2s renderer-boot window

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 2). **Priority:** Medium. **Effort:** \~30 min.

**Symptom.** `electron/main.ts:292-296` — `projectsState` initializes to `{projects:[], focusedProject:null, counts:{}}`. The renderer's `PROJECTS_STATE_PUSH` only fires after `useProjects` settles + initial qualify probes complete. Between Duo launch and first push (\~1-2s), `duo project list` returns the empty default — indistinguishable from "no projects open."

**Repro.** Restart Duo, immediately run `duo project list` → `{ projects: [], focusedProject: null, counts: {} }`. Same shape as "no projects."

**Fix.** Add `ready: boolean` to `ProjectsStateSnapshot`:

- Default false at main-side `projectsState` initialization.
- Renderer's `pushState` always sends `ready: true`.
- CLI emits warning when reading `ready: false`: *"renderer not yet ready (Duo is still booting / probing projects). Retry in 1-2s."*

**Alternative:** block the CLI call until `ready: true` with a timeout (\~3s). Simpler from the agent's perspective but less observable.

**Recommendation.** Add the `ready` flag + emit the warning. Leave blocking as a future enhancement. Agent retry logic is cheap; the warning is the right diagnostic.

**Files touched.** `shared/types.ts` (`ProjectsStateSnapshot.ready`), `electron/main.ts` (initial state + `getProjectsState`), `renderer/App.tsx` (pushState always sends `ready: true`), `core/socket-server.ts` (`duo project list` handler emits warning when not ready).

---

### FOLLOWUP-034: Rail-color rotation past 6 projects (Tier 3 — owner decision)

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 3 — design-gated). **Priority:** Low (PRD R2 planned; not user-blocking — most workflows have &lt;7 projects).

**PRD context.** R2 says hash-stable `colorIndex = hash(rootPath) % 6`. With 6 hash buckets, 50% collision probability at 4 projects (birthday paradox; P(no collision, N=4, K=6) ≈ 0.278). Past 6 projects, PRD says "rotate shade variants" — unspecified shape.

**Owner decision needed.** What's the shade-variant rule?

- **Option A** — `colorIndex × variant_count` (e.g. 6 hues × 2 lightness = 12 effective slots; double-hash determines lightness).
- **Option B** — overlay marker (a small dot/stripe in a secondary color on collision).
- **Option C** — saturation shift (same hue, desaturated for the second hit).
- **Option D** — defer (current state — collisions silently happen; user sees two same-color tiles).

**Recommended default if owner unavailable:** Option D (defer). No urgent need; &lt;7 active projects in typical use.

---

### FOLLOWUP-037: useProjects probe-after-delete cache (Tier 3 — owner decision)

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 3 — design-gated). **Priority:** Low (documented limitation).

**Symptom.** `renderer/hooks/useProjects.ts:13` — "no invalidation" comment is correct: if a user pins a project, then deletes `CLAUDE.md` from outside Duo, the cached `markerResults` STILL shows `true` for the session. Result: ghost tile persists in rail across the session. Re-launching Duo clears the cache.

**Owner decision needed.** Invalidation strategy?

- **Option A** — `fs.watch` on each cached candidate dir. Most reactive; adds N filesystem watchers per session (memory + handle cost).
- **Option B** — Invalidate on focus change. Periodic re-probe; cheap; lag is one focus-change.
- **Option C** — Drop cache + re-probe every N minutes. Simplest; not very reactive.
- **Option D** — Leave as-is (current state). Document the limitation.

**Recommended default if owner unavailable:** Option D. Real users rarely delete a project's `CLAUDE.md` mid-session without intending to.

---

### FOLLOWUP-039: Cross-window race on `duo workspace-pill-menu` (Tier 3 — owner decision)

**Status:** 🆕 **Filed 2026-05-25** (v0.8.0 audit, Tier 3 — future-proofing). **Re-triaged 2026-06-08** — premise is now true: multi-window shipped v0.10.0 (ENH-191 P5a/P5b), so this race is reachable at N>1. **Priority:** Low (real but low-frequency N>1 race).

**Symptom.** `setWorkspacePillMenuFlag` writes localStorage in one window; a second window now receives a `storage` event (origin-window doesn't fire `storage`, others do) but the in-window `CustomEvent` fires only in the origin window — so the flag can land out of sync across windows. Now that window 2 is real, this is exploitable in practice (toggle the pill-menu setting in one window, observe the other).

**Owner decision needed.**

- **Option A** — Leave as-is and document. Low-frequency: the workspace-pill-menu flag is rarely toggled, and the `storage` event already propagates the localStorage change to other windows; only the in-window `CustomEvent` side is asymmetric.
- **Option B** — Use the `BroadcastChannel` API for cross-window coordination so all windows react consistently regardless of origin.

**Recommended default if owner unavailable:** Option A (document, defer the `BroadcastChannel` work). The cross-window value still propagates via `storage`; the asymmetry is narrow and the toggle is infrequent.

---


> Sprint 23 earned the MINOR. Six commits closed the project-as-filter-layer story end-to-end: ENH-182 Phases 3 + 4 + 2b + ENH-185 polish + ENH-184 workspace-pill defeaturing + a polish pass folding in 5 audit-found fixes (FOLLOWUP-030 + Phase 3c-browser + BUG-161/162/163/164). Smoke walk 5/5 PASS via computer-use pre-walk. v0.8.0 cut + tagged + released 2026-05-25.


## Sprint 23 / v0.8.0 — ENH-182 capstone (shipped)
### Deferred audit findings — file as v0.8.x follow-ups

Background audit (agent ac060771dc81e76f5) surfaced additional polish items that DON'T fold into v0.8.0. File as tracked follow-ups for v0.8.x:

- **FOLLOWUP-032** — double `duo project close` race. Two parallel CLI calls send two `PROJECTS_CLOSE_REQUEST` events; handleCloseProject runs twice; second invocation reads stale `projectCounts.get(root)`. Stacks two dialogs if claude-kind. Fix: in handleCloseProject, gate on `inFlightCloseRef.current.has(root)`. **Severity:** Low (rare CLI race).
- **FOLLOWUP-033** — `duo project list` returns empty silently during 1-2s renderer-boot window. Renderer hasn't pushed first snapshot; main returns empty default — indistinguishable from "no projects open." Fix: add `ready: boolean` to ProjectsStateSnapshot flipped on first push; CLI warns "renderer not yet ready" when false. **Severity:** Medium.
- **FOLLOWUP-034** — rail-color rotation past 6 projects. PRD R2 says "rotate shade variants past 6" — not implemented. \~50% collision probability at 4 projects (birthday paradox; P(no collision, N=4, K=6) ≈ 0.278). **Severity:** Low (planned per PRD; not user-blocking).
- **FOLLOWUP-035** — `handleProjectFocus` may be dead code. Defined at App.tsx \~901 but its use site wasn't found in audit grep; could be shadowed by inline JSX lambda. Verify + remove if dead.
- **FOLLOWUP-036** — Focus-release chip aria-label awkward. App.tsx \~3545 reads "Focused: duo, button, Release focus (duo)" — repetitive. Drop the visible-text from the aria-label or simplify to "Release focus."
- **FOLLOWUP-037** — `useProjects` probe-after-delete cache: if pinned project's marker is deleted out-of-Duo mid-session, `markerResults` cache still shows true → ghost tile persists. Documented limitation; revisit if real users hit it.
- **FOLLOWUP-038** — `useWorkspacePillMenuFlag` TS narrowing of `'key' in event` ambiguous between StorageEvent + CustomEvent with `key` field. Practically benign (we dispatch bare CustomEvent); worth a code comment.
- **FOLLOWUP-039** — Cross-window race on `duo workspace-pill-menu`. Re-triaged 2026-06-08: multi-window shipped v0.10.0, so now reachable at N>1 (real but low-frequency race).
- **FOLLOWUP-040** — Smoke-walk item: with `duo workspace-pill-menu off`, exercise `File → New Workspace` to verify the menu handler still works post-ENH-184.

---

### FOLLOWUP-030 — Browser-pane active-tab redirect on focus change

**Status:** 🆕 **Filed 2026-05-25** during v0.8.0 pre-cut audit. **Priority:** Low (UX polish; not user-blocking).

**What's wanted.** When a user enters a project focus and the currently-active browser tab is NOT a member of the focused project, the browser pane's WebContentsView still renders that tab's content (Phase 2b only hides the strip entry, not the pane). The renderer's existing Phase 2 effect at App.tsx (`useEffect` on `[focusedProject, visibleTerminals, visibleFileTabs]`) handles the file-tab analog by re-routing `activeWorking` to a visible member — extend the same pattern for browser tabs.

**Implementation sketch.** Add a parallel effect: when `focusedProject !== null` AND `activeWorking.kind === 'browser'` AND the active BrowserTab is not in `visibleBrowserTabIds`, call `window.electron.browser.switchTab(visibleBrowserTabIds.values().next().value)` to shift to the first visible member; fall back to `setActiveWorking({ kind: 'file', ... })` if no member browser tabs exist.

**Why deferred from v0.8.0.** Pure UX polish; the existing strip-hide already makes the active tab unreachable via the strip UI. Surfacing this only matters when a user routinely uses focus to "blank out" the browser content of a non-member tab; that workflow may not even materialize.

---

### FOLLOWUP-031 — `MaxListenersExceededWarning` on `terminal:claude-presence-changed`

**Status:** 🆕 **Filed 2026-05-25** during v0.8.0 pre-cut audit. **Priority:** Low (warning only; no user-visible behavior change).

**Symptom.** Renderer log emits `(node:NNNN) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 terminal:claude-presence-changed listeners added to [IpcRenderer]. MaxListeners is 10.` during normal use of a multi-terminal-tab session.

**Hypothesis.** The `useClaudePresence` hook at `renderer/hooks/useClaudePresence.ts:15-19` registers a listener per component mount; each `TerminalPane` invocation creates one. With many terminal tabs (the test session had 9+), the registered count exceeds Node's default 10-listener warning threshold. Listeners are properly removed on unmount, but the warning fires the moment count exceeds 10 — even transiently while a tab spawns/closes.

**Fix candidates.**

1. Use a single subscription at the App.tsx level + push state down via React context (matches the `useFrontTerminalClaudeLive` pattern). Eliminates per-tab listener.
2. Bump `ipcRenderer.setMaxListeners(N)` for this specific channel during app boot.
3. Refactor main-side broadcast so each tab gets its own dedicated IPC channel (decouples listener counts).

(1) is the cleanest. Pre-existing — not new with v0.8.0.

---

### BUG-079 — Ctrl-Tab cycle latency CONFIRMED REPRO in focused mode (Sprint 22 walk-1 update)

**Status update 2026-05-25:** owner ENH-182-CTRL-TAB walk-1 PASS with explicit note "passes, but observing some noticeable ctrl-tab latency." This is a **partial repro of the long-standing BUG-079** ("tab-cycle latency — needs prod repro"). The Phase 2 filter doesn't change the cycle implementation (we just hand `visibleTerminals` to `useKeyboardShortcuts.tabs` instead of the full `tabs`), so the latency is the same root cause as BUG-079. The Sprint 17 diagnosis at \[feedback_verify_current_behavior_before_proposing_fix.md\] established total renderer-keydown → switchTab return = \~15ms regardless of pacing; the latency isn't in the dispatch path. Hypotheses 4 (modifier release timing) + 5 (upstream consumer race) are still open. Owner's observation gives us a fresh chance to instrument under known conditions (focused on duo with 1 visible terminal — narrow set, should be fastest case; if it still feels slow, the latency is NOT in cycle traversal). Add to Sprint 23 carry-forward priority list.

---

### ENH-184 — Workspace pill defeaturing (still in-flight on `main`, this session left untouched)

**Status:** 🟡 **Working tree state preserved from prior session.** Other-claude was driving ENH-184 when this Sprint 22 session began; their uncommitted changes are intact on `main`:

- `renderer/hooks/useWorkspacePillMenuFlag.ts` (new, untracked) — localStorage-backed flag, default OFF
- `renderer/App.tsx` (modified) — flag imported + declared as `workspacePillMenuEnabled`, NOT YET CONSUMED
- `renderer/components/WorkspaceSwitcherDropdown.tsx` (modified) — `handleNew` routing fix (save-as → newWorkspace)

Sprint 22 finishing work for ENH-184 (handoff to whichever Claude picks it up): wire the flag to gate the pill's onClick, owner walk, optional CLI parity verb. See full plan at `docs/dev/active-sprint.md § ENH-184`.

---


## Sprint 21 / v0.7.9 — closed (ENH-183 walks)
### ENH-183 PARED 2026-05-25 (Option A) — S2 + C11 + T3 + force-rename dropped

**Owner directive 2026-05-25**, mid-walk: *"the banner is useless; the repeated session restarts you've done demonstrate that the resume function, which we actually care about, is working; the force rename is also not necessary because claude is successfully summarizing the sessions."* Confirmed via empirics — `duo session hydrate` returned `{hydrated: false, reason: 'already-has-aiTitle'}` 100% of the time during rev5 pre-walk. Haiku auto-titling covers \~80% of sessions (per C1 step-0 PRD § 11) + tab title carries the name via `✳ <haiku>` prefix. The S2 banner just duplicated info already in the tab.

**Kept (final ENH-183 surface):**

- **S1** resume pills (fresh shell tab in CWD with prior sessions → list with click-to-resume)
- **S3** restore offer (workspace switch reattaches a tab that hosted claude → `[Resume] ×` banner)
- **D5 read ladder** (`customTitle > aiTitle > firstPrompt > uuid`) — needed by S1 + S3 title display
- **BUG-158** realpath fix
- **BUG-160** discriminator correctness (dismissedBanner scoped to S3)
- CLI: `duo session list`, `duo session resume`

**Dropped:**

- **S2** named banner (`● Claude session: X`) — duplicated tab title
- **S2 inline rename** (click title → contentEditable → /rename injection)
- **C11** educational tip (`Duo named this session…`) — no S2 to attach to
- **T3** auto-hydration (autosave-triggered `/rename` injection) — caused [BUG-156](#bug-156); Haiku covers it
- **BUG-159** (`\n` → `\r` rename terminator) — superseded by pare; no `/rename` injection paths remain
- **FOLLOWUP-028** (T3 re-enable design) — closed as won't-do; T3 itself dropped
- CLI: `duo session rename`, `duo session hydrate`, `session collapse/expand` (never shipped)
- Decision locks **D2** (educational banner), **D8** (write ladder), **D12** (collapsed-dot), partial **D6** (T3 trigger), partial **D11** (S2 mockup variants)

**Files touched (deletions + simplifications):**

- 🗑 `electron/session-hydrator.ts` (114 LOC)
- 🗑 `electron/session-hydrator.test.ts` (\~160 LOC)
- 🗑 `renderer/store/sessionTipPrefs.ts` (38 LOC)
- ✂ `renderer/components/SessionHeader.tsx` — dropped `NamedBanner` (\~160 LOC), inline-rename, C11 tip render, S2 branch + discriminator return
- ✂ `renderer/components/SessionHeader.test.ts` — S2 tests rewritten as S0 tests; BUG-160 test updated to reflect post-pare behavior; 15 tests still pass
- ✂ `renderer/store/sessionHeader.ts` — dropped `collapsed` + `editingTitle` fields
- ✂ `electron/main.ts` — removed `sessionRename`, `sessionHydrate`, `SESSION_MAYBE_HYDRATE` IPC, T3 trigger block
- ✂ `core/socket-server.ts` — removed `sessionRename` + `sessionHydrate` interface methods + dispatch cases
- ✂ `electron/preload.ts` — removed `maybeHydrate` API exposure
- ✂ `shared/host-api.ts` — removed `MaybeHydrateResult` type
- ✂ `shared/types.ts` — removed `SESSION_MAYBE_HYDRATE` IPC constant
- ✂ `cli/duo.ts` — removed `session rename` + `session hydrate` subcommands + help text. Rebuilt binary.
- ✂ `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` — removed verb cheat-sheet entries

**Net code change:** \~600 LOC removed across deletions + simplifications. Typecheck clean. 15/15 SessionHeader tests pass.

**v0.7.9 cut scope (post-pare):**

- BUG-158 (realpath in `encodeProjectDir`) + regression tests
- BUG-160 (discriminator dismissedBanner scoping)
- FOLLOWUP-027 (about:blank ghost-tab — shipped earlier this session)
- ENH-183 pared: S1 + S3 + D5 ladder + supporting CLI

**Walk impact for rev5+:** S2/C11/CLI-RENAME items become N/A (those features are gone). Owner re-walks just S1 (already PASSed rev3) + S3-RESTORE (already PASSed via Resume click) + S3-DISMISS (×) to close v0.7.9.

**Memory rule reminder logged:** I shipped a "fix" (BUG-159) without first checking the artifact (JSONL) the owner's verbal report referred to. The JSONL had two `custom-title` entries proving the rename WAS committing — the "bug" was a visual artifact, not a functional failure. `feedback_verify_current_behavior_before_proposing_fix.md` applies to "is this even a bug?" questions, not just impact framing.

---

### FOLLOWUP-028: T3 auto-hydrator re-enable design — input-buffer race + idle-gate

**Status:** 🆕 **Filed** 2026-05-24. Carries forward across compaction. Blocks T3 re-enable.

**Origin.** [BUG-156](#bug-156-claude-crashed-mid-session-during-enh-183-rev3-t3-walk--root-cause-ptyresize0-0)'s defensive disable. Even though the root cause was `pty.resize(0,0)` (not the hydrator's `/rename` injection), the T3 path still has unaddressed UX risks that prevent safe re-enable:

1. `\r` **force-submits user partial input.** The hydrator writes `\r/rename <title>\n`. The leading `\r` is interpreted by Claude (and any TUI) as Enter — anything in the user's input buffer gets submitted as a real prompt before the `/rename` lands. If the user is mid-typing a 3rd prompt when autosave fires + T3 gate opens, that partial becomes a Claude prompt.
2. **Mid-turn timing.** The hydrator can fire during Claude's response to a prior prompt. Slash commands queued mid-response have unclear handling — may merge with the user's input, may be ignored, may land after Claude is idle. We don't have empirical data on which path Claude actually takes.
3. **No idle-gate.** The current gate is messageCount + customTitle/aiTitle absence + in-memory dedup. It doesn't include "is Claude idle right now?" — which is the gate we actually need to be safe.

**Proposed design.**

- Replace `\r` with `\n` (linefeed only, no Enter-submit). The `/rename` lands on a fresh line without committing the user's partial input. Caveat: Claude's input parser may still interpret an interior `\n` as a turn boundary — verify empirically.
- Add idle-gate: tail the session JSONL for the most-recent assistant entry's completion marker (e.g. a `stop_reason` field). Only inject when the timestamp of the last assistant turn-end is more recent than any user turn-start. Re-check every N seconds; never inject within \~500ms of an assistant entry landing.
- Optional: also check that the user's input buffer is empty. Hard to do from main, but possible by querying xterm's `term.buffer.active.cursorY` against the prompt baseline. Renderer-side gate.

**ACs for re-enable.**

1. Empirical test: inject `/rename` while Claude is mid-turn → verify the queue handling (does it land cleanly after the assistant finishes? does it merge with the user's input? does it cause SIGHUP independent of resize?).
2. Empirical test: `\n` vs `\r` — both should land the rename in Claude's storage. `\n` should NOT submit user's partial input.
3. Idle-gate covers the "user is actively typing" case.
4. Tracer log (per BUG-156 convention) records every injection so post-incident forensics work.

**Where the flag lives.** `T3_AUTO_HYDRATION_ENABLED = false` in `electron/main.ts` § `setEnrichBeforePersistHook`. Flip to `true` to re-enable; restart dev to apply.

**Deferred walk item.** ENH-183 rev3 manifest item `ENH-183-T3-AUTO-HYDRATION` is the verification path for T3. While `T3_AUTO_HYDRATION_ENABLED = false`, the walk item cannot exercise the trigger. Owner directive 2026-05-24: defer this single walk item into Sprint 22 alongside FOLLOWUP-028 completion — when T3 re-enables under the new design, walk this item as part of the verification. All other ENH-183 rev3 unwalked items are walked under v0.7.9 via the `duo session hydrate <tabId>` CLI workaround (ENH-183-CLI-HYDRATE) which exercises the same hydration code path under explicit user gesture (different risk profile).

---

### BUG-157: Audit other fit-then-resize patterns for the same latent bug

**Status:** 🆕 **Filed** 2026-05-24. Owner-callable refactor task.

**Pattern.** BUG-156's root cause was renderer-side "measure DOM → write to main-process backing system via IPC" without checking whether the measured value was sane. The xterm `fit.fit()` + `pty.resize(cols, rows)` loop in TerminalPane was one instance. There are sibling instances:

- `renderer/components/ImageView.tsx:95` — ResizeObserver
- `renderer/components/BrowserRenderer.tsx:57` — ResizeObserver (browser-pane bounds → WCV)
- `renderer/components/AuxBrowserSlot.tsx:111` — ResizeObserver (aux pane bounds → WCV)
- `renderer/hooks/useTerminal.ts:42` — `fit.fit()` (dead code? not used by TerminalPane; grep shows no caller)

**Audit ACs.**

1. For each ResizeObserver, identify what value it computes from the host's measured bounds.
2. Identify where that value crosses an IPC boundary (any `window.electron.*` call).
3. Verify the receiving main-process function defensively rejects zero/negative dimensions.
4. If not, add the guard at the main-process boundary (BUG-156's defense-in-depth pattern: authoritative check at the API border, not just at the call site).
5. Bonus: remove `renderer/hooks/useTerminal.ts` if confirmed dead code.

**Why this matters.** Any future layout-change PR (split-view resize, sidebar collapse, modal-induced reflow) can expose these latent bugs the same way ENH-183's flex-column wrapper did. Pre-emptive guards prevent the next surprise.

---

### ENH-184: Workspace pill defeaturing — passive label only + fix "+" handler routing

**Status:** 🟡 **Filed 2026-05-24 — queued for Sprint 22.** Working-tree changes started this sprint (uncommitted on `main`); finishing deferred to keep v0.7.9 narrow.

**Origin.** [Notion idle thoughts](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe) bullet 2026-05-24:

> BUG/ENH: today, `workspace pill > new workspace` behaves differently than `file > new workspace`; it *appears* to act more like a `save as` command: existing state is maintained, but the name changes. I want to pull back on the pill functionality: keep the workspace name (if saved/named), but remove the interactivity; user can use the file menu for workspace operations.

**Two parts (bundled).**

**(a) Defeaturing the pill click.** The title-bar workspace pill currently opens a dropdown on click (ENH-171 shipped v0.7.7). Owner direction: render the pill as a **passive label** — workspace name visible, no caret, no dropdown, no click handler. All workspace operations route through the File menu (`File > New Workspace`, `File > Open Workspace`, `File > Save Workspace As…`, recents).

**(b) "+" handler routing bug.** The original ENH-171 dropdown wired the "+" button to `window.electron.workspaceFile.save({ saveAs: true })`. That's "save current as new" semantics — the user's existing tabs/state stayed, only the path/name changed. Should have been `newWorkspace()` (the same path `File > New Workspace` uses — fresh empty workspace, prompt-on-dirty handled by the shared `newWorkspaceReset()` flow). Misread of the Q4 owner-lock at ENH-171 time ("`+ inline → opens Save As dialog`" — interpreted literally rather than as "what the user expects '+' to do").

**Working-tree state (uncommitted on** `main` **at session start 2026-05-24).**

- New hook `renderer/hooks/useWorkspacePillMenuFlag.ts` — localStorage-backed flag `duo.workspacePillMenu`, default OFF. Mirrors ENH-176 `useSendPillFlags` pattern.
- `renderer/App.tsx` \~line 809 — imports + declares `workspacePillMenuEnabled = useWorkspacePillMenuFlag()`. **NOT YET CONSUMED.** Dead code until wired to gate the pill click handler.
- `renderer/components/WorkspaceSwitcherDropdown.tsx` line \~87 — `handleNew` changed from `save({ saveAs: true })` to `newWorkspace()`. Header comment updated to mark Q4 as superseded with reasoning.

**Sprint 22 finishing tasks.**

1. Wire `workspacePillMenuEnabled` to gate the pill's `onClick` in App.tsx (look around the `<WorkspaceSwitcherDropdown />` mount, \~line 3101). When OFF: no caret rendered, click is a no-op.
2. Verify on owner walk: pill displays the workspace name as a passive label, click does nothing, `File > New Workspace` / `File > Open Workspace` / `File > Save Workspace` all still work. The "+" handler fix is independently right — keep it whether the menu re-enables or not.
3. CLI parity per [CLAUDE.md](http://CLAUDE.md) § 4: add `duo workspace-pill-menu [on|off]` reading/setting the localStorage flag (mirrors `duo claude-return` / `duo shift-return` toggles). Optional — owner can DevTools-toggle if a CLI verb feels like overkill for a feature-flag.
4. Update `shared/types.ts` `DuoCommandName` + `electron/socket-server.ts` handler + `cli/duo.ts` verb + skill + agents/duo.md cheat-sheet + [CLI-COVERAGE.md](http://CLI-COVERAGE.md) (full plumbing checklist for the new CLI verb if shipping it).

**Why deferred from v0.7.9.** v0.7.9's marquee is ENH-183 (Claude session lifecycle) + FOLLOWUP-027 (about:blank ghost-tab). Bundling this in would expand scope without unblocking ENH-183's owner walk. Working-tree changes don't pollute the cut (cut is from `main` HEAD; the changes aren't committed). The dead flag declaration has zero behavior impact even if accidentally committed; the "+" handler fix is the only behavior delta and it's isolated to a code path the rev3 walk doesn't exercise.

**No regression risk to v0.7.9.** The rev3 walk manifest doesn't exercise the workspace switcher dropdown's "+" button or the pill click. The 9 remaining unwalked items (S2 + S3 + C11-TIP + CLI) test ENH-183 paths only.

---


## Sprint 19 / v0.7.3 — in flight
### Bug cluster — `duo doc comment --reply-to` ergonomics + live-editor sync (BUG-142..147)

**Origin.** Owner-on-behalf-of-agent bug report 2026-05-19 at [/tmp/duo-bug-report-comment-reply.md](/tmp/duo-bug-report-comment-reply.md). A fresh agent took 2 min and 16 shell calls to reply to a single CriticMarkup comment. Six distinct bugs surfaced across CLI ergonomics, server↔editor sync, active-editor identity, help discoverability, and skill docs.

**Cluster.**

- [BUG-142](#bug-142-doc-edit-not-propagated-to-live-editor-buffer) — `duo doc comment` writes to disk but the open editor's TipTap buffer isn't refreshed.
- [BUG-143](#bug-143---reply-to-should-make---anchor-optional) — `--reply-to` requires `--anchor`; only the parent comment ID coincidentally works.
- [BUG-144](#bug-144-duo-layout-and-doc-read-disagree-about-active-editor) — `duo layout` and `duo doc read <path>` return contradictory "active editor" values.
- [BUG-145](#bug-145-duo-doc-verb-lacks-focused-per-subcommand---help) — `duo doc --help` doesn't exist; agent has to page the global help.
- [BUG-146](#bug-146-skill-missing-canvas-vs-editor-comment-decision-tree) — skill has no "where is the comment?" routing; user's word "canvas" is ambiguous.
- [BUG-147](#bug-147-skill-missing-comments-reference-page) — no `references/comments.md` for the comment lifecycle.
- [BUG-148](#bug-148-electron-main-process-crashes-with-epipe-when-stdout-is-closed) — main-process EPIPE crash dialog when stdout is closed (surfaced live during this session's dev restarts).

**Target outcome.** The bug report's expected agent behavior: a 3-call task (`duo layout` → `duo doc read` → `duo doc comment --reply-to <id> --body "X"`) where the live editor immediately reflects the reply.

**Shipped status (2026-05-19, this session).** All six bugs closed. End-to-end live verified: the 3-call expected path now works; the reply appears in the editor's thread after close-reopen of the file. One follow-up filed:

- [FOLLOWUP-023](#followup-023-chokidar-reload-after-reply-misclassifies-criticmarkup) — chokidar reload after a reply leaves the tracked-changes rail momentarily misclassified; close-reopen the file → renders correctly. Lower priority since the headline (reply visible) is fixed.

---

### FOLLOWUP-023: chokidar reload after reply misclassifies CriticMarkup

**Status:** 🆕 **Filed 2026-05-19** (this session). Sub-bug surfaced while verifying BUG-143 live.

**Symptom.** Right after `duo doc comment --reply-to` writes the parent token with an extended body containing `\n↪`, the editor's chokidar watcher fires, `setContent + applyCriticMarkupFromText` runs, and the tracked-changes rail temporarily shows pre-existing {==X==} highlights as new `+ ins` cards (e.g. "TRACK CHANGES (2)" became "(4)" with the comment-anchor highlights misclassified as insertions). Close-reopen the file → rail renders correctly.

**Likely cause.** `applyCriticMarkupFromText` re-parses the new body but applies marks on top of an already-marked buffer, not into a clean state. Existing comment-anchor highlights get a second-pass insertion mark applied. On full remount, marks are parsed from scratch and are correct.

**Fix path (not yet implemented):** before `applyCriticMarkupFromText` on reload, clear all existing CriticMarkup marks from the buffer first (or use `editor.commands.setContent` with a strict mark-rebuild pass). Alternative: detect newline-containing comment-body changes and force a full remount of the editor tab.

**Priority:** Low. The headline (reply visible) is fixed via close-reopen workaround. Documented in `skill/references/comments.md` so agents know to close-reopen if a reply doesn't show immediately.

---

### FOLLOWUP-029: Projects + filtered view as a distro-pack authoring tool

> **Renumbered 2026-05-25** from FOLLOWUP-028 at merge time — `main` had concurrently filed FOLLOWUP-028 (T3 auto-hydrator re-enable design).

**Status:** 🆕 **Filed 2026-05-24** (owner note-for-later during ENH-182 filter-layer expansion). Idea: once projects-as-filter-layer (ENH-182 §5 / D8) exists, a distro pack could ship as a **pre-declared project** (its `CLAUDE.md`, skills, and starting tabs bundled), and "focus" becomes the natural way an enterprise user drops into a curated pack without seeing unrelated work. Revisit when distro-pack work resumes (pairs with 21d / ENH-112 / `/pack-builder`). No action until ENH-182 decisions land.

---

### ENH-181: Resume-banner inline rename + collapse toggle — folded into ENH-183

**Status:** 🟡 **Filed 2026-05-23 · folded into [ENH-183](#enh-183) 2026-05-24.** Original scope below preserved for historical reference. The inline rename + collapse toggle behaviors now live in ENH-183 § S2 (collapsed/expanded/edit mode).

**What it does.** The resume banner ENH-177 paints (post-workspace-switch) gains two new affordances:

1. **Inline rename via PTY** `/rename` **injection.** User clicks the title in the banner → it becomes a contentEditable field → user types a new name → presses Return → Duo writes `\r/rename <new-name>\n` to the active claude PTY in that tab → claude processes the slash command → `sessions-index.json § customName` updates → banner re-renders with the new title. **Gated on** `claudePresence === 'claude'` in the tab — if no live claude in this tab, the title is non-editable (cursor: not-allowed, tooltip explains).
2. **Collapse toggle.** Default state on workspace switch is a small marker indicator on the terminal tab itself (subtle "⏪" dot/chip). Tapping the tab expands the full banner inside the terminal pane (title + Resume + ×). Tapping again collapses back to marker. Collapse state persists per-tab across the session (lost on Duo quit; fresh workspace switch starts collapsed).

**Esc handling.** While in edit mode, Esc cancels the edit and reverts the title to its prior value. Return commits. Click-outside also commits (consistent with most contentEditable UX).

**Mechanism (path 2 from owner directive 2026-05-23):** PTY injection, not direct `sessions-index.json` write. Trade-off: 2-line transcript footprint per rename + only works when claude is live, BUT zero schema coupling — claude owns the write and our injection survives any schema change. Owner: *"I want path 2 and if needed we can limit to only when Claude is active."*

**Plumbing sketch:**

1. Banner JSX — title becomes `<span contentEditable={isEditing}>` with `onBlur`/`onKeyDown` handlers.
2. New IPC: `duo.session.rename(tabId, newTitle)` → writes `\r/rename <title>\n` to `PtyManager.write(tabId, ...)`.
3. Banner reads `claudePresence` (already wired by ENH-177) to enable/disable edit.
4. Collapse state: `useState<Record<tabId, boolean>>` in `TerminalPane` or workspace-level. Tab strip renders the "⏪" marker chip when `lastClaudeSession` exists AND `collapsed === true`; banner renders inside the terminal when `collapsed === false`.
5. CLI parity (per [CLAUDE.md](http://CLAUDE.md) § 4): `duo session rename <tabId> "<title>"` for agent-driven rename, same PTY inject path.

**Canonical PRD:** `docs/prd/_archive/enh-177-181-session-resume-banner.html` **(archived — superseded by** `docs/prd/enh-183-claude-session-lifecycle.html`**)** — owner-locked 2026-05-24. 12 sections: scope, 7 locked decisions w/ rationale, file inventory (9 files, \~412 LOC for cherry-pick), mechanism empirics table, 6 risk cards, 10 acceptance criteria, build order, out-of-scope. Has Copy-review button at footer. [Notion mirror](https://www.notion.so/36945f48854f810ca7f9dfa275c4389d).

**Visual companion:** `docs/prd/_archive/enh-177-banner-mockup.html` (archived) — the 7 states rendered interactively.

**Cross-ref:** [ENH-177](#) (the banner this extends) · [ENH-180](#enh-180) (closed; the PTY-injection mechanism survives here in user-driven form) · [ENH-082](#) (Terminal Context Bar — another consumer of session titles).

---

### ENH-177: Restore Claude session across workspace switch — folded into ENH-183

**Status:** 🟡 **Filed 2026-05-23 · folded into [ENH-183](#enh-183) 2026-05-24.** Original ENH-177 scope (workspace-resume banner) now lives as **S3 (restore-offer)** in the ENH-183 canonical PRD. Implementation still cherry-picks [f351719](https://github.com/dudgeon/duo/commit/f351719) as Step 1; ENH-183 then layers the S0/S1/S2 states + hydration triggers on top. Original entry text below preserved for historical reference.

**\[Original entry — historical\] · 2026-05-23 · built + reverted pre-cut — queued for re-ship next sprint with ENH-180 folded in.** Implementation landed at [f351719](https://github.com/dudgeon/duo/commit/f351719); reverted at [49f4644](https://github.com/dudgeon/duo/commit/49f4644) so v0.7.7 cuts without the banner. Capture path (`electron/claude-session-tracker.ts` + `enrichBeforePersistHook`) and banner UI (`ClaudeResumeBanner.tsx`) are in git history; cherry-pick or re-implement Sprint 21 after owner walks the workspace-switch-and-back flow live. **ENH-180 closed and absorbed into this re-ship** — banner reads `~/.claude/projects/<encoded-cwd>/sessions-index.json` for its title (prefers `customName` &gt; `summary` &gt; short UUID fallback); see mockup (archived). **ENH-181 also bundled** — inline rename via PTY `/rename` (gated on claudePresence), collapse-to-tab-marker toggle, Esc cancels edit. Owner ask: *"when a terminal tab had an active claude session in it, and the user switches to a different workspace and come back, their claude session appears to be lost; I want us to know (eg via workspace autosave metadata) when a given terminal tab last had an active claude session, ideally an identifier for that claude session (I'm not sure if this is exposed), such that on session restart we can either run 'claude resume {session}', or remind the user that they can (with a non-annoying banner)."*

**Owner-locked spec (2026-05-23):**

- **Restore UX (locked):** *banner with one-click Resume*. Non-modal banner anchored inside the restored terminal tab: `⏪ This tab had Claude session abc123 — Resume?` + primary Resume button + dismiss (×). Dismiss is once-per-tab-per-restore.
- Clicking Resume writes `claude --resume <session-id>\n` into the PTY of the restored tab. Same wire as the `claude` auto-launch for `kind='claude'` tabs.
- Source of session-id: Claude writes per-session JSONL files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` (one file per session). We scrape the most-recently-modified file matching the tab's PTY cwd at teardown time and persist the session-id in the workspace metadata.

**Plumbing sketch:**

1. **Track session-id on workspace save.** New main-process helper that, for each terminal tab with `claudePresence === 'claude'`, scans `~/.claude/projects/<encoded-cwd>/` and picks the most-recently-modified `*.jsonl` — that's the live session. Encoded-cwd matches Claude's own convention (slashes → dashes etc.).
2. **Extend** `SessionState.terminals[]` with `lastClaudeSession: { id: string, capturedAt: number } | null`. Persisted in `.duo-workspace`.
3. **On workspace load + terminal restore**, if `lastClaudeSession.id` is present + the PTY tab is back up, render the banner. Banner is a renderer-only component anchored inside `TerminalPane` (or a sibling above the xterm host).
4. Resume button → IPC write to PTY: `claude --resume <id>\n`. Tab's `claudePresence` will detect the new `claude` process within the polling interval.
5. Dismiss persists in transient state (not saved); re-loading the workspace prompts again unless the user resumed.

**Open sub-questions (resolve during build):**

- What if the session-id file is no longer there (claude purged it)? Banner shows but Resume errors — surface "session no longer available" inline.
- What if the user opens the workspace on a different machine where the session ID doesn't exist? Same handling: try → fail → "session no longer available."
- Auto-banner suppress after N session-switches without resume? Probably not v1 — let owner walk the v1 and decide.

**Cross-ref:** `core/claude-presence.ts` (probe that already detects claude descendants — same source for "this tab is currently running claude"), `~/.claude/projects/` (Claude's session-jsonl directory — undocumented but stable), Sprint 16 ENH-013 (the original claude-presence prober that enables this whole feature class).

---

### ENH-174: Disable TipTap autolink — bare URLs / filenames stop auto-converting to markdown links

**Status:** 🆕 **Owner-locked 2026-05-23** — implementation queued. Surfaced during [BUG-155](#bug-155-false-positive-file-changed-on-disk-dialog-from-tiptap-markdown-autolink-round-trip) verification. Owner directive: *"I do want to avoid [filename.md](http://filename.md) conversion false positives; I am comfortable with users needing to manually set a url as a linked url via cmd-k or direct md notation."*

**Scope.** Set `autolink: false` in `Link.configure({})` at `renderer/components/editor/MarkdownEditor.tsx:498`. Bare URL-shaped text (`prd.md`, `example.com`, `foo.org/path`) will no longer be auto-converted to a link mark on parse, so it stays as plain text on serialize. Source markdown stays byte-stable.

**Trade-off (owner-accepted).** Users can no longer rely on auto-linking when typing bare URLs in the editor. To make a link they use one of:

- ⌘K — opens the LinkPromptModal (already shipped)
- Direct markdown notation: `[text](http://url)`
- Paste a URL onto selected text (TipTap's paste-as-link behavior is independent of autolink — should still work; verify during build)

**Why it matters.** Solves the disk-mutation half of BUG-155. Pre-fix: on every autosave of a file containing bare URL-shaped text, TipTap mutated the source from `prd.md` to `[prd.md](http://prd.md)`. Post-fix: source stays as the user typed it.

**Belt-and-suspenders.** BUG-155's `normalizeForEchoCompare` autolink-collapse stays in place — even with autolink disabled in this configuration, the normalize is a defensive net if any other code path (a future extension, a plugin, a TipTap upgrade resetting defaults) re-introduces autolink behavior.

**Plumbing checklist (per [CLAUDE.md](http://CLAUDE.md) rule 4):**

1. `renderer/components/editor/MarkdownEditor.tsx` — `Link.configure({ autolink: false, openOnClick: false, ... })`. Confirm `openOnClick: false` is also set (already is, per current config — verify during build).
2. **Verify paste-as-link still works** — selecting text then pasting a URL should still wrap the selection in a link. This is a separate TipTap path from autolink.
3. **Verify clicking existing links still works** — files that already have `[text](url)` notation should keep their links rendering / opening correctly.
4. **Live test on** `docs/about-duo.md` — type 'x', backspace, autosave. Confirm `prd.md` stays as bare text on disk (no rewrite to `[prd.md](http://prd.md)`).
5. **Add a vitest fixture** for the autolink-off behavior if one doesn't exist (regression coverage).

**Files likely touched:** `renderer/components/editor/MarkdownEditor.tsx` (config), possibly `renderer/components/editor/extensions/MarkdownLinkShortcuts.ts` if any of its logic assumed autolink-on.

**Cross-ref:** [BUG-155](#bug-155-false-positive-file-changed-on-disk-dialog-from-tiptap-markdown-autolink-round-trip) (the false-positive normalize fix that surfaced this), [ENH-137](#) (markdown editor general polish), ⌘K LinkPromptModal (existing UX path for manual linking).

---

### ENH-169: Navigator-side new-file / new-folder UX

**Status:** ⬜ Planned — Sprint 20 / v0.7.7.

**Scope.** Three triggers, one shared modal+flow for creating files/folders in the navigator:

1. **Breadcrumb right-click** → context menu: `New file here…` / `New folder here…` / `Reveal in Finder` / `Open terminal here`. Default location = the dir of the segment that was right-clicked.
2. **File menu** → `New File…` / `New Folder…`. Default location = currently-focused navigator dir.
3. **Keyboard chords** `⌘N` (New File) / `⌘⇧N` (New Folder). Same default-location logic.

All three reuse the same modal (asks for name, validates filename collision, creates via existing `FilesService` IPC, scrolls the new entry into view via `NAV_REVEAL`).

**Open sub-question (resolve during build):** does `⌘N` collide with any existing chord in `renderer/keyboard/globalShortcuts.ts`? Likely free but verify before binding.

**Files likely touched:** `electron/main.ts` (File menu items), `renderer/keyboard/globalShortcuts.ts` (chord registry), navigator breadcrumb component (right-click handler), new `renderer/components/NewFileModal.tsx` or extension of existing wikilink-create modal pattern, plus the existing `FilesService.create*` IPC handlers.

**Cross-ref:** ENH-016 (existing "New folder…" navigator action), ENH-039 (path-link handling), `[skill]: vocabulary.md` (file kind classification — `.md` opens in editor, `.html` opens in canvas via `duo edit` vs `duo open` after creation).

---

### ENH-166 v2: Interleave comment + tracked-changes items by document position

**Status:** ⏳ **Filed + implemented 2026-05-19** (this session, post-v1-feedback). Owner feedback after walking v1: *"this is close, but you have just stacked the comment and track changes rails — this is a bad UX; I specifically said that comments and tracked changes should coexist in a single rail, e.g. \[comment 1, addition 1, comment 2, deletion 1, comment 3\], in the order that they appear in the document."*

**Reframe.** v1 put both rails in one 280px column but kept them as two STACKED sections (TrackedChangesRail on top, comment threads below). v2 merges them into ONE sorted list keyed on PM document position — items truly coexist.

**Implementation.** New component `renderer/components/editor/UnifiedAnnotationRail.tsx`:

- Merges `TrackedRange[]` (sortKey = `range.from`) + `BuiltMarkdownThread[]` (sortKey = `thread.range?.from ?? MAX_SAFE_INTEGER` — sidecar-only threads sort to the end).
- Renders a single header (`"{N} ANNOTATIONS"`), one row of merged filter chips (**All / Mine / Agent / Others**) that span both kinds via the existing `classifyAuthor` helper, then the sorted card list.
- Each card keeps its kind-specific shape — `TrackedChangeCard` from TrackedChangesRail (✓/✗ buttons, kind chip) and `CommentThreadCard` from CommentRail (reply form, Resolve / Reopen). Both were exported as named exports for reuse.
- Comment thread numbers are reassigned 1-based AFTER the sort so the badge reflects document order across mixed kinds.

**Files touched (v2 delta):**

- `renderer/components/editor/UnifiedAnnotationRail.tsx` — NEW
- `renderer/components/editor/TrackedChangesRail.tsx` — export `TrackedChangeCard` + `FilterChip` + `classifyAuthor` + `AnnotationFilter` type for reuse
- `renderer/components/editor/primitives/CommentRail.tsx` — export `CommentThreadCard` + `CardProps`
- `renderer/components/editor/MarkdownEditor.tsx` — swap the v1 two-section wrapper for one `<UnifiedAnnotationRail />`; drop the now-dead `railThreads` adapter useMemo + the `CommentThread` type import
- ⬇ The v1 `containerless` prop on `CommentRail` and the `.duo-comment-rail__nested` CSS class remain — harmless dead surface that other hosts (canvas / PageTab) could opt into later. The `.duo-unified-rail` CSS class is still load-bearing (the new component uses it).

**Live-verified shape** (fixture with 2 tracked changes + 2 comments at staggered positions):

```
4 ANNOTATIONS
All 4  Mine  Agent 1  Others 1
[ 1 "a highlight" ─ geoffreydudgeon "first thread" + ✨ claude reply ]   ← PM ~120
[ + ins (unattributed) "an inserted phrase" ]                            ← PM ~250
[ − del (unattributed) "a deleted phrase" ]                              ← PM ~380
[ 2 "another highlight" ─ ✨ claude lead + ✨ claude reply ]              ← PM ~510
```

**Originally**

### ENH-166: Unify comment + tracked-changes rails into one column

**Status:** ⏳ **Filed + implemented 2026-05-19** (this session). Owner directive: *"in 0.7.2, comments and tracked changes live in their own rails; this takes up too much width; we need to combine these into a single rail, where comments and tracked changes coexist."*

**Symptom (v0.7.2 and prior).** The markdown editor renders TWO side-by-side rails as flex children of the prose+rails row in `renderer/components/editor/MarkdownEditor.tsx`: the BUG-138 Phase 4e per-suggestion track-changes rail (\~variable width, no explicit cap) AND the Sprint 6 Phase 4 / MISSING-001 comment rail (`.duo-comment-rail` = 280px fixed). When a file has both a tracked change and a comment, \~560px of horizontal width disappears from the prose column on a typical wide-editor session.

**Fix shape.** Single 280px column hosting both sections, replacing the two flex children. Tracked changes section renders on top (its own collapsible header + "Mine / Agent / Others" filter chips intact); comment threads section renders below (in `containerless` mode so the unified `<aside>` owns the chrome). Each card preserves its kind-specific shape — no card refactoring; only the container changes.

**Implementation (this session).**

- `renderer/components/editor/primitives/CommentRail.tsx` — new optional `containerless: boolean` prop. When true, the outer element becomes a chrome-less `<div>` (CSS class `duo-comment-rail__nested`) so a parent rail container owns width, border, and background. Both the normal rail render and the all-resolved collapsed-chip render honor the flag.
- `renderer/styles/globals.css` — new `.duo-comment-rail__nested` rule (inline-display, inherits color/font from parent) + new `.duo-unified-rail` rule (280px fixed, max-width 320px, paper-deep background, paper-edge left border — same chrome the old comment rail had; this becomes the unified container).
- `renderer/components/editor/MarkdownEditor.tsx` — the two side-by-side rail renders collapse into a single `<aside className="duo-unified-rail">` with both `<TrackedChangesRail />` and `<CommentRail containerless />` nested inside. Visibility gate is `(!isNew && (trackedChangesList.length > 0 || railThreads.length > 0))` — same as the union of the prior two gates.

**Smoke walk paths to exercise.**

1. Open a `.md` file with comments only → unified rail shows only the comment section + threads, header reads "{N} comments".
2. Open a `.md` with tracked changes only → unified rail shows only the tracked-changes section + cards.
3. Open a `.md` with BOTH → both sections render stacked in one 280px column. Prose column gets \~280px back compared to v0.7.2.
4. Resolve all comments → the "{N} resolved" chip appears nested in the unified column (not a separate floating chip), inside the unified rail's chrome.
5. Toggle the tracked-changes collapse chevron → the cards collapse but the comment threads section remains rendered below.
6. Filter chips (Mine / Agent / Others) still work; ✓ / ✗ accept/reject still works; click-to-jump still works.

**Plumbing-checklist disposition.** No new tab kind, no new CLI verb, no new page op — pure renderer composition. Skill / agents docs unchanged (rails are visual chrome, no agent-driven verbs).

**Editor-canvas parity disposition.** **(b) Skipped — surface-specific.** The HTML canvas (PageTab) doesn't currently render a tracked-changes rail (BUG-138 family was markdown-only). When canvas grows tracked-change support, the same unification pattern transfers — the `containerless` prop is already there for reuse.

**Verification status.** Typecheck ✅. Live verification deferred — packaged Duo v0.7.2 is currently running on the only socket path; restarting into dev would lose the user's working state. Smoke walk runs when the user is ready to switch to `npm run dev`.

**Carry-forward.** If the unified column feels visually crowded once both sections are non-empty (e.g. the two headers competing), a v2 could merge them into a single "Annotations ({total})" header above an inline-mixed list sorted by source position. Defer pending owner walk.

---


## Recent (v0.7.2 cut — polish wave — 2026-05-18)
### ENH-165: Lock the screenshot-annotation style for Duo docs

**Status:** 🆕 **Filed 2026-05-18 (post-v0.7.1 cut).** Owner started writing Duo docs (`docs/about-duo.md` + two raw screenshots in `docs/`) and wants annotated screenshots that are "tasteful but visually striking." Rather than build a Duo annotation feature (corner-case use), elicit a style spec once via playground → reuse the spec per-screenshot.

**Playground:** `docs/research/screenshot-annotation-style.html`. Five fully-formed annotation styles rendered as SVG overlays on the same reference screenshot (`docs/image-20260518-105715-661d.png`) with the same three callout targets. Four owner-decision blocks: (1) style direction A–E, (2) frame treatment, (3) numbering convention, (4) output format (HTML+SVG re-editable / flattened PNG / both). Recommended picks: A (editorial atelier) · hairline frame · contextual numbering · both formats.

**Why this exists.** The "tasteful + striking" target is personal aesthetic — not derivable from the atelier kernel alone. Locking it once lets future "annotate this screenshot" requests skip the style-debate and just produce the SVG overlay matching the agreed look.

**Once walked.** Locked style becomes a comment block in the playground's `.html` source (or a sibling markdown spec). Per-screenshot workflow: agent reads the spec → generates `<name>.annot.html` with SVG overlay → optionally rasterizes to `<name>.annot.png` via headless Chrome → owner tweaks coordinates via natural language ("move callout 2 up and left").

**Carry-forward rule:** this entry surfaces in every smoke walk until the owner Copy-decisions back and closes the gate.

---


## Recent (v0.7.1 walk-1 fixes — 2026-05-18)
### BUG-138 walk-1 FAIL: Phase 4b — typed text wraps as one-CM-token-per-character

**Status:** 🟡 **Filed 2026-05-18 walk-1; walk-1 fix shipped same-day. Awaiting walk-2.**

**Symptom (owner walk-1):** *"inserted text is spaced far too far apart (between characters) ... inspecting source, looks like duo split the inserted work into one edit per character."*

**Root cause.** `SuggestingMode.appendTransaction` stamped a fresh `ts = new Date().toISOString()` on every character's TR. ProseMirror compares marks by `type + attrs` deep-equality; distinct `ts` per char → distinct marks → no text-node merging → JSON serializes as N text nodes each with its own mark → CM serializer emits {++abc++} instead of one {++abc++}. Visual artifact: the per-char wrappers add per-char layout-break opportunities that look like wide letter-spacing.

**Walk-1 fix.** Drop `ts` from auto-stamped non-comment marks. Standard CriticMarkup tokens ({++text++} / {--text--} / {==text==}) carry no metadata anyway — Phase 1's serializer would lose the `ts` on save regardless. Mark schema's `ts` attribute stays (Phase 4's TipTap-side rail filter still reads it when present), but Suggesting auto-stamp now passes only `{ author }`. Same fix applied to `wrapAsDeletion`. PM merges across consecutive same-author marks → one mark, one CM token on save.

**Files touched:** `renderer/components/editor/extensions/SuggestingMode.ts` lines 81–92 (appendTransaction) + lines 168–175 (wrapAsDeletion).

---

### BUG-138 walk-1 FAIL: Phase 4c — Backspace/Delete not intercepted (shadowed by another extension)

**Status:** 🟡 **Filed 2026-05-18 walk-1; walk-1 fix shipped same-day. Awaiting walk-2.**

**Symptom (owner walk-1):** *"deletion was just normal, non-tracked; no deletion added to the track changes rail."*

**Root cause.** TipTap's keymap dispatches keyboard shortcuts in extension-priority order. The default Extension.priority is 100. StarterKit's nodes (paragraph, list-item, blockquote, code-block) all register their own `Backspace` handlers (unindent list, exit code block, merge node boundaries) at default priority. With ties, dispatch order is roughly registration order — SuggestingMode landed AFTER StarterKit so its handler was effectively shadowed.

**Walk-1 fix.** Set `priority: 1000` on the SuggestingMode extension. TipTap evaluates higher priority FIRST. When Suggesting is OFF, our handler short-circuits `return false` immediately → default behavior runs as normal. When Suggesting is ON, our `wrapAsDeletion` runs and consumes the keystroke. Bonus: also fixes any other Backspace/Delete handler ordering hazard for the same reason (no other extension can pre-empt us).

**Files touched:** `renderer/components/editor/extensions/SuggestingMode.ts` — `priority: 1000` added to the `Extension.create({...})` block.

---


> **Forgetting-protection.** Each gate below is a playground that owner must walk (radio + Copy decisions) before the gated implementation work starts. These appear in every smoke walk manifest until owner closes them. The v0.7.0 cut is blocked until all four are walked. \*\***How to walk:** `duo open <path>` opens the playground in Duo's browser pane. Pick a radio for each decision card, add any notes, hit "Copy decisions" at the bottom, paste back to Claude. \*\***Status convention.** 🟡 = awaiting owner walk. Once walked + decisions copied, status flips to ⏳ In progress (Claude implementing), then ✅ Shipped after the smoke walk closes.


## 🟡 OPEN OWNER-DECISION GATES — v0.7.0 cut blocked until walked
### GATE-GH-CLUSTER-v2: GitHub-integration cluster (decisions captured; PROTOTYPE GATE OWED before code)

**Status:** 🟡→⏳→🟡 **Decisions captured 2026-05-17, but owner requires a prototype playground BEFORE implementation.** New gate filed below as GATE-GH-CLUSTER-PROTO. **Playground (v1, walked):** `docs/research/github-integration-cluster-v2.html` — 7 decisions. **Filed:** 2026-05-17. **Decisions locked:** 2026-05-17. **Re-gated:** 2026-05-17 (owner asked for prototype). **Blocks:** ENH-152a v2, ENH-155, ENH-152b, ENH-152c. Estimate 2-3 dev days for cluster once prototype lands.

**Locked decisions:**

- **Q1:** BRANCH-ONLY-CLEAN chip format. Clean=`[main]`, Dirty=`[main · 3 modified]`, Diverged=`[main · 2 ahead, 1 behind]`. **Plus tooltip:** hover shows "Main branch of '{repo-name}' repo" (or similar).
- **Q2:** TEXT-ONLY chip (no icon). Saves visual noise.
- **Q3:** ROOT-ROW placement — **PLUS new owner-added spatial logic (substantial):**
  - If the repo-root folder IS visible in the Navigator tree → pill next to that folder's row (the original spec).
  - **If the user has navigated INSIDE the repo root (root folder NOT visible in current Navigator view)** → display a **banner/ribbon ABOVE the tree** showing the same git state, and the banner is right-clickable + interactable as though it were the repo-root folder itself (right-click → "Open in GH", "Clone…", same context-menu items as the root folder would offer).
  - Owner: *"ask me questions if this does not make sense; before building, make a prototype html artifact/playground reflecting your understanding of the intent, then get my approval; make multiple options (visually) if there is ambiguity and you need to show them."*
- **Q4:** YES-DETECT GitHub Enterprise via remote URL prefix (`git remote get-url origin` returning `https://github.foo.com/...`).
- **Q5:** SHOW-ALWAYS right-click menu items regardless of auth state. URLs work without auth for public repos.
- **Q6:** ANY-CHANGE dot semantics (staged OR unstaged OR untracked → same dot). **Plus tooltip:** dot tooltip provides additional context (e.g. "Modified · 3 lines changed since last commit" or similar — TBD in prototype).
- **Q7:** FSEVENTS-DEBOUNCED refresh (250ms debounce). Real-time updates without thrashing.

**New constraints from owner notes that need to be visible in the prototype:**

1. Tooltip on the repo-root chip (Q1).
2. Tooltip on per-file dirty dots (Q6).
3. Context-aware presentation: pill (root visible) vs. ribbon (root not visible).
4. Ribbon must be right-clickable/interactable as proxy for the repo-root folder.
5. Right-click on repo root → "Open on GitHub" option (already ENH-155 scope, confirmed by owner).


> Filed during the v0.6.8 cut close-out sweep. Each entry below is a draft of an idea from `idle-thoughts.md` that needs sprint planning input before code work — chord conflicts, exact UX choice, scope boundaries. **Refine in the next sprint-plan session.**


## DRAFT — Sprint-9+ candidates from idle-thoughts sweep (2026-05-06)
### ENH-100: Lock/unlock context menu verb for filetypes that support editability

**Status:** ⬜ DRAFT — needs refinement before code. **Priority:** Medium (concept exists in code via `<meta duo-default-editable="false">` and the read-only/edit toggle strip; right-click menu would surface it more discoverably). **Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** Right-click on a tab (or in the editor body?) → "Lock" / "Unlock" verb that toggles editability. Current state: HTML canvases with `<meta duo-default-editable="false">` mount in read-only mode with a toggle strip; markdown editor has a `Saved` / `Save` button area but no lock concept.

**Needs refinement.**

- **What "lock" means per filetype.** HTML canvas: write `<meta duo-default-editable="false">` to disk and re-mount in read-only? Markdown editor: ??? (no equivalent meta convention; tiptap-markdown doesn't have a read-only mark). PDF / image: no-op since they're not editable to start with.
- **Where the menu lives.** Right-click on the tab title in the strip? Or a kebab menu in the toolbar? Or both?
- **Persistence.** Does "lock" persist across sessions (write to file or sidecar) or is it a session-only state?
- **Markdown editor scope.** Is the markdown editor in scope for v1, or does this start as a canvas-only verb that gets a sister implementation later?

**Recommended path.** Start with canvas-only, write the meta tag on lock, surface via right-click on the tab. Markdown later if there's a real use case.

**Update 2026-05-08 — markdown driver landed.** ENH-106 files the data-model + editor wiring for markdown lock/unlock (YAML frontmatter `duo-default-editable: false`, mirrors ENH-034). Real first user: the local `idle-thoughts.md` Notion mirror. ENH-100's "Markdown later" arm reopens once ENH-106 ships — at that point this verb extends to markdown tabs alongside canvas tabs.

---

### ENH-106: Extend lock/unlock to Markdown files (frontmatter persistence)

**Status:** ⬜ DRAFT — needs refinement before code. **Priority:** Medium-High (real first-user exists: `idle-thoughts.md` is a regenerable Notion mirror that should never accept local edits, but today there's no mechanism to enforce that). **Filed:** 2026-05-08 (idle-thoughts processing pattern shift to Notion-canonical).

**What's wanted.** Extend the lock / unlock concept (ENH-034 + ENH-100) from HTML canvases to Markdown files. The HTML side ships today via `<meta name="duo-default-editable" content="false">` parsed in `electron/files-service.ts § getHtmlMeta`; markdown has no equivalent. Add a parallel mechanism so a `.md` file can be marked "open in read-only mode" with the same eye/pencil toggle strip the HTML canvas uses.

**Real-world driver.** The local `idle-thoughts.md` is now a read-only mirror of [Duo Idle Thoughts (Notion)](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe) — refreshed via the Notion MCP every time Claude reads idle-thoughts. Local edits get silently overwritten on next sync. Surfacing this as a UI lock (with explicit unlock to override) prevents the data-loss footgun. Lesson packs (Stage 28) are the second use case: lesson markdown should mount read-only by default for the same reason canvas lessons do.

**Recommended persistence — YAML frontmatter.**

```markdown
---
duo-default-editable: false
---

 # Document body…
```

Rationale:

- **Standard convention.** Jekyll, Hugo, Obsidian, Notion-export all use YAML frontmatter. Agents writing markdown already know the pattern.
- **Single-file unit.** No sidecar, no localStorage divergence between machines.
- **Mirrors the HTML mechanism.** Same key name (`duo-default-editable`), same true/false semantics, same precedence rules. Re-uses the per-tab pencil/eye toggle that ENH-034 already shipped (just gate it on a different parser path).

**Plumbing checklist (mirrors ENH-034).**

1. `electron/files-service.ts` — add `getMarkdownMeta(filePath)` that parses YAML frontmatter and returns `{ editableDefault: boolean | null }`. Reuse a small frontmatter parser (e.g. `gray-matter` is dep-heavy; a 30-line custom parser handling `---\nkey: value\n---` is enough for v1).
2. `shared/host-api.ts` — extend `MarkdownFileMeta` (new shape, parallel to `HtmlFileMeta`) with `editableDefault?: boolean`.
3. `renderer/components/editor/MarkdownEditor.tsx` — read meta on mount, seed initial `readOnly` state. Hide TipTap's full toolbar when `readOnly`; show a `Read-only · Edit` strip parallel to `CanvasTab`'s.
4. **TipTap read-only.** TipTap-core has `editor.setEditable(false)` (it's the standard pattern; "tiptap-markdown doesn't have a read-only mark" in ENH-100 was wrong — `setEditable` is at the editor level, not the markdown extension). Verify it disables ProseMirror input + paste + drop + IME without breaking the rendered view.
5. **Persisting unlock.** Mirror ENH-034: per-file localStorage key `duo:editor:readOnly:<path>` overrides the meta default. Toggling the strip flips localStorage, NOT the source frontmatter (so the file stays canonically "this is a locked doc" but the user can scribble locally if they really mean it).
6. `agents/duo.md` **+** `skill/SKILL.md` — document the frontmatter convention so agents can write `duo-default-editable: false` into generated lessons / mirrors / docs.

**Cross-reference ENH-100.** ENH-100 is the right-click "Lock / Unlock" verb; ENH-106 is the underlying data-model + editor wiring it depends on. ENH-100's "Markdown later if there's a real use case" arm closes once ENH-106 lands. After ENH-106:

- ENH-100 v2 surfaces "Lock" / "Unlock" on markdown tabs alongside canvas tabs.
- Right-click "Lock" on a markdown tab writes the frontmatter on save (or surfaces an AskUserQuestion if the file has no frontmatter block — "add `duo-default-editable: false` to the top of the file?").

**Open questions for owner.**

- **Frontmatter visibility in the editor.** TipTap by default would render `---\nduo-default-editable: false\n---` as visible content. Options: (a) frontmatter is hidden in the rendered view but visible in source view (Obsidian-style); (b) frontmatter renders as a small grey collapsed strip at the top; (c) frontmatter is fully invisible and only the toggle strip surfaces it. Recommend (a) — matches Obsidian, gives advanced users a clear handle, doesn't pretend the file is something it isn't.
- **Sidecar fallback?** If frontmatter proves too invasive (e.g. for files the user wants to keep clean source for), allow a parallel `.duo.json` sidecar with `{ "editableDefault": false }`. Defer to v2.
- **Other frontmatter fields (forward-compat).** While we're parsing frontmatter, ENH-096 (Obsidian-vault-friendly editor) lands with its own conventions (vault-root, sidecar, wikilink config). The frontmatter parser should be a shared module both can consume. Plan the API once, ship it twice.

**First user lined up.** `idle-thoughts.md` already carries an explicit `<!-- Canonical: ... -->` warning header today. Once ENH-106 ships, the Notion-sync writer adds a `duo-default-editable: false` frontmatter block to every refresh, so the file auto-locks. Pre-loading the frontmatter NOW (before ENH-106 ships) is harmless — TipTap renders it as visible YAML until the parser lands, then it goes invisible and the lock activates.

---

### ENH-107: Terminal tab strip — context-menu commands to move tabs left / right

**Status:** ⬜ DRAFT — needs refinement before code. **Priority:** Medium-Low (working-pane tabs already have drag-and-drop reorder via ENH-042; terminal tabs have neither drag-reorder nor context-menu reorder today, so users with 3+ terminal tabs have no way to reorganize them). **Filed:** 2026-05-08 (idle-thoughts sweep).

**What's wanted.** Right-click on a terminal tab in `TerminalPane.tsx` → context menu with at minimum two entries: `Move tab left` (disabled when tab is at index 0) and `Move tab right` (disabled when tab is at last index).

**Current state.** `TerminalPane.tsx` (line 162) maps tabs to buttons with NO `onContextMenu` handler — terminal tabs have no right-click menu at all today. `WorkingTabStrip.tsx` already has drag-and-drop reorder (ENH-042) and a working tab context menu (ENH-026: Reveal in Navigator + others); the working-pane patterns can be cribbed for the terminal side.

**Plumbing checklist.**

1. `renderer/components/TerminalPane.tsx` — add `onContextMenu` on each tab button. Spawn a small popover-style menu (matches `WorkingTabStrip.tsx`'s ENH-026 affordance — same visual language).
2. **State plumbing.** Terminal tab order lives in `renderer/App.tsx` § `tabs` state (line \~307 area). Add a `moveTerminalTab(id, direction)` callback or expose `setTabs` reorder helper. Persist tab order in `~/.claude/duo/session-state.json` so reorder survives restarts (terminal tabs already restore via Stage 21c Phase 2).
3. **CLI parity (per [CLAUDE.md](http://CLAUDE.md) working-style item 4).** UI feature → CLI counterpart. New verb: `duo terminal move <tab-index> <left|right>` (or `duo terminal reorder <from> <to>`). Bridge → `electron/socket-server.ts` → renderer state. Touch the full plumbing checklist (shared/types.ts, preload.ts, main.ts, socket-server.ts, cli/duo.ts, skill/SKILL.md, agents/duo.md, docs/CLI-COVERAGE.md).
4. **Optional v2: drag-and-drop reorder.** Crib from `WorkingTabStrip.tsx § ENH-042`. Reuse the same drag-target overlay logic. Could ship in the same PR if low-cost; defer to v2 if context-menu version lands first.

**Open questions for owner.**

- **Menu scope.** Just `Move left` / `Move right`, or also `Close tab` / `Close other tabs` / `Pin tab` while we're adding context-menu plumbing? Recommend: just the two reorder entries for v1; expand if there's a real ask.
- **Keyboard chord parallel?** Working-pane tab reorder via `⌘⇧←` / `⌘⇧→` would be a natural pair. Could file as a sub-ENH or roll in.

**Affected files.** `renderer/components/TerminalPane.tsx`, `renderer/App.tsx` (state), `electron/main.ts` (session-state persistence), CLI plumbing chain. Smaller surface than ENH-105/106 but still touches the full CLI-parity stack.

---

### ENH-108: Paste-image handling — markdown editor + HTML canvas (save to active file's parent dir)

**Status:** ⬜ DRAFT — needs refinement before code. **Owner-directive P0 for Sprint 9 (high priority).Priority:** **High** — owner explicit "high priority item to the roadmap / include in the next sprint" (idle-thoughts sweep, 2026-05-08). Closes a workflow-defining gap: today, dropping an image into a doc means save-to-Desktop → drag-to-finder → markdown-link-by-hand. After this lands, ⌘V into either editor surface "just works" the way Obsidian / Notion users expect. **Filed:** 2026-05-08 (idle-thoughts sweep).

**What's wanted.** In BOTH the markdown editor (`MarkdownEditor.tsx`) and the HTML canvas (`RenderedPage.tsx` iframe), paste-from-clipboard with image data should:

1. **Save the image** to the parent directory of the active file (or a fallback location for untitled docs).
2. **Insert a reference** at the caret — markdown editor uses `![](relative-path)`, HTML canvas uses `<img src="relative-path">` ("html tagging" per the owner's bullet).
3. **Both surfaces feel identical** from the user's perspective: same trigger (⌘V), same auto-naming, same in-folder save.

**Plumbing checklist.**

 1. **TipTap Image extension audit.** Verify `@tiptap/extension-image` is in the editor config; if not, add it. Confirm it round-trips through tiptap-markdown's serializer as `![](path)` and not as inline base64.
 2. **Markdown-editor paste handler.** TipTap exposes `editorProps.handlePaste`. Detect `event.clipboardData.items` entries with `image/*` MIME types, extract as Blob, IPC-save via the new endpoint, insert the image node at caret.
 3. **Canvas paste handler.** `RenderedPage.tsx` mounts the iframe; install a `paste` listener on the iframe document. Same Blob → IPC → insert flow, but inserts an `<img>` element via `execCommand('insertHTML', ...)` or direct DOM manipulation (matches existing canvas mutation patterns).
 4. **IPC endpoint.** `electron/files-service.ts § saveImageBeside(activeFilePath, buffer, ext) → { path, error? }`. Writes to `dirname(activeFilePath)/<generated-name>.<ext>`. Returns the relative path the editor should insert.
 5. **Filename generation.** `image-<YYYYMMDD-HHMMSS>-<4charhash>.<ext>` — sortable, zero collisions, readable. Hash is `crypto.randomBytes(2).toString('hex')`.
 6. **MIME → extension mapping.** `image/png` → `.png`, `image/jpeg` → `.jpg`, `image/gif` → `.gif`, `image/webp` → `.webp`, `image/svg+xml` → `.svg`. Reject other MIMEs with a console warn.
 7. **Untitled-file edge case.** If the active file has no on-disk path (new tab, never saved), surface an AskUserQuestion: "Save document first to use paste-image, or save image to \~/.claude/duo/scratch-images/?" Recommend the prompt-to-save default.
 8. **Drag-and-drop parity (v1).** Same handler for `drop` events with image files attached. One handler implementation, two trigger sources.
 9. **CLI parity (per [CLAUDE.md](http://CLAUDE.md) working-style item 4).** New verb: `duo image insert <local-path>` — insert an image from a local file into the active editor's caret position (copies to active-file parent dir if outside it; references it if inside). Touches the full plumbing chain (shared/types.ts, preload.ts, main.ts, socket-server.ts, cli/duo.ts, skill/SKILL.md, agents/duo.md, docs/CLI-COVERAGE.md).
10. **Skill stub.** `skill/examples/paste-image-workflow.md` showing the agent-side trigger pattern.

**Open questions for owner.**

- **Filename strategy.** Timestamp + hash (recommended — sortable, collision-free), or content-hash dedupe (saves disk if user pastes the same image twice, but harder to read), or per-folder counter `image-1.png`?
- **Vault-relative vs file-relative paths.** ENH-096 introduces vault-root awareness. For v1, paths are file-relative (simpler). v2 could opt into vault-root if `.obsidian/` exists.
- **Alt-text prompt.** Empty for v1 (users can edit), or AskUserQuestion on every paste? Recommend: empty for v1.
- **Max image size.** No limit for v1, or reject &gt; N MB to prevent accidental huge-PNG pastes? Recommend: no limit; surface as v2 if it becomes a problem.
- **Image format normalization.** Clipboard PNGs are often huge (browser screenshots). Convert to JPEG for photographic content? Recommend: keep clipboard format for v1; revisit if disk-bloat reports surface.
- **Markdown editor scope vs HTML canvas scope.** Both surfaces ship together (same PR), or one-at-a-time? Recommend: ship together — the user-facing promise ("paste an image, it goes in") is identical, and the IPC + filename code is shared.

**Affected files.**

- `renderer/components/editor/MarkdownEditor.tsx` (paste handler).
- `renderer/components/Page/RenderedPage.tsx` (iframe paste handler).
- `renderer/components/Page/PageTab.tsx` (mount the handler if needed).
- `electron/files-service.ts` (`saveImageBeside`).
- `shared/host-api.ts` + `electron/preload.ts` (IPC contract).
- `electron/socket-server.ts` (CLI verb routing).
- `cli/duo.ts` (`duo image insert`).
- `skill/SKILL.md` + `agents/duo.md` (cheat-sheet entry).

**Cross-refs.**

- **ENH-096** (Obsidian-vault-friendly editor) — adjacent territory; Obsidian's "default location for attachments" is the design precedent. This ENH picks the simplest variant (same folder as active file).
- **BUG-061** (canvas markdown gap — bullets/indent missing) — same theme of MD/HTML editor parity. Both ENH-108 and BUG-061 push toward "the two surfaces feel identical for content authoring."
- **Editor-canvas parity rule** in [CLAUDE.md](http://CLAUDE.md) (Locked decision 2026-05-02) — **mandatory disposition for both surfaces in this PR**: this is option (a) **Mirrored** — same feature in both the markdown editor and the HTML canvas, same PR.

**Smoke after ship.**

1. Open a markdown file. ⌘C an image from a screenshot, ⌘V into the editor → image appears inline; check the source for `![](image-...)` markdown link; confirm the file landed beside the markdown.
2. Same flow in HTML canvas → image appears inline; source view shows `<img src="image-...">`.
3. Drag-and-drop a `.jpg` from Finder onto either surface → same outcome.
4. Untitled markdown tab + ⌘V image → AskUserQuestion appears.
5. CLI: `duo image insert /path/to/local-image.png` from a different cwd → image saved beside active doc, inserted at caret.

---

### ENH-113: Tab should detect file deletion and close-with-alert

**Status:** 🆕 Filed 2026-05-07 (Sprint 9 walk-1, owner ENH idea). **Priority:** **Low–Medium** — UX paper cut. Active editor tabs become orphaned views of disk state when the file is deleted out from under them; typing into the buffer continues but autosave starts erroring or recreates the file silently. **Filed:** 2026-05-07.

**What's wanted.** When a file with an active tab is deleted (e.g. `rm -f /tmp/foo.md` from any terminal, or any other process), Duo should detect the deletion via the file watcher and either:

1. Close the tab automatically with a brief banner ("`foo.md` was deleted from disk; closed."), OR
2. Mark the tab visually as "orphaned" + offer a button to recover (re-save the in-memory buffer to the original path) or close.

Recommended: option 1 for clean state + option 2 for dirty state — clean buffer = nothing to lose, just close; dirty buffer = preserve the work behind a banner.

**Affected code.**

- `electron/files-service.ts § watch` already runs chokidar on the navigator's CWD; it emits unlink events.
- `renderer/App.tsx` listens to navigator state pushes and could subscribe to a `file-deleted` channel.
- New IPC channel `IPC.FILES_DELETED` (broadcast on chokidar unlink for any watched path).
- Renderer-side handler in App.tsx: scan fileTabs for matching path; for clean tabs, closeFileTab; for dirty tabs, mark with a `deletedFromDisk: true` flag + render the banner.

**Cross-ref:** Surfaced during ENH-091 walk-1 — owner reset the test file with `rm -f /tmp/enh091-fresh.html`, then re-`duo edit`'d, and the failed ENOENT showed the autosave-against-deleted-file path is currently silent.

---

### ENH-112: Distro Pack Builder Workshop — repo-resident playground doc + assistant skill

**Status:** 🟡 **LANDED in Sprint 9 (2026-05-07)** — initial scaffolding shipped. Workshop folder `distro-pack-builder/` carries scoped [CLAUDE.md](http://CLAUDE.md) + [README.md](http://README.md) + step-by-step [playground.md](http://playground.md) (11 steps from scaffold-from-template through cohort distribution) + project-scoped assistant skill at `.claude/skills/pack-builder-workshop/SKILL.md`. Does NOT ship to end-user machines (npm sync:claude unchanged); only people who clone Duo and open Claude in the workshop folder pick it up. Root [CLAUDE.md](http://CLAUDE.md) updated to reference the new folder. Refines as real pack builders surface friction. **Priority:** Sprint 9 P1 (locked 2026-05-07 sprint-plan session — owner directive). **Filed:** 2026-05-07.

**Verification owed.** A real pack builder (or owner) walking the playground end-to-end on a non-Geoff machine. Closes the FOLLOWUP-011 cross-machine-validation gap simultaneously. Scaffolding is in place; walking it surfaces real-builder friction the v1 doc doesn't anticipate.

**Resolved (per recommended path).**

- Folder location: top-level `distro-pack-builder/` (not under `examples/` — keeps the workshop itself separate from the template the workshop references; existing `examples/distro-pack-template/` stays where it is and is *referenced* from the workshop).
- [CLAUDE.md](http://CLAUDE.md) scope: explicit "inherits from `../CLAUDE.md`" reference + workshop-specific scope on top. No partial-merge mechanics.
- Skill discovery: project-scoped at `<workshop>/.claude/skills/pack-builder-workshop/`; not synced to `~/.claude/`.
- Doc format: markdown, step-by-step with embedded code examples, "Common pitfalls" troubleshooting table.
- Smoke validation: included as Step 10 of [playground.md](http://playground.md) (smoke install on builder's own Mac before distribution).

**What's wanted.** A rich, step-by-step playground doc that walks an enterprise distro pack builder through Duo's pack-builder primitives — what's available, how to build them, where to load them. Bundled with an authoring-assistant skill scoped to the cwd. The skill ships **in the repo** (so contributors / forkers / enterprise pack builders cloning Duo get it) but **NOT in the canonical signed DMG / \~/.claude/skills/** (end users don't need it).

**Workflow.** A distro pack builder clones / forks the Duo repo, opens Claude Code in `<repo>/distro-pack-builder/` (or wherever the workshop folder lives), and immediately has:

- A scoped [CLAUDE.md](http://CLAUDE.md) telling Claude "you are helping build a Duo distro pack — here are the primitives, here are the conventions, here's where things load."
- Human-facing step-by-step docs for the builder to read.
- An assistant skill that helps with the mechanical work — manifest authoring (`plugin.json` + `DISTRO.json`), validation, build-zip / build-pkg / build-bundled-fork, version bumping, smoke testing.

**Distinct from the existing** `pack-builder` **skill (Stage 21d-ii).** That skill ships globally via `npm run sync:claude` → `~/.claude/skills/pack-builder/`. It's the *canonical authoring path* for any user. ENH-112 is the **workshop wrapper** — guided tutorial + scoped [CLAUDE.md](http://CLAUDE.md) + assistant — that lives in the repo and only activates for people working IN the repo. Ideally the new skill *uses* the existing pack-builder skill rather than duplicating it.

**Needs refinement.**

- **Folder location.** Top-level `distro-pack-builder/`? Under `examples/` (alongside the existing `examples/distro-pack-template/`)? Under `tooling/`? Recommend top-level `distro-pack-builder/` with the existing template folder remaining at `examples/distro-pack-template/` and being *referenced* from the workshop.
- **Workshop [CLAUDE.md](http://CLAUDE.md) scope.** Does it inherit from the project root [CLAUDE.md](http://CLAUDE.md)? Override? Partial merge? Recommend: reference the project root via "see `../CLAUDE.md`" + add workshop-specific scope on top.
- **Skill discovery.** If the skill lives at `<repo>/distro-pack-builder/.claude/skills/`, Claude Code auto-discovers it when cwd is inside that folder. No `npm run sync:claude` step needed for the workshop skill — it's project-scoped by design.
- **Doc format.** Markdown (renders in Duo canvas, easy to read). Step-by-step with embedded code examples, screenshots if useful.
- **Smoke validation.** The workshop should be walkable end-to-end by someone unfamiliar with Duo internals. A second-person walk (cross-machine cohort validation) closes the FOLLOWUP-011 gap simultaneously.

**Affected files / new structure (proposed).**

- `distro-pack-builder/CLAUDE.md` — scoped builder instructions.
- `distro-pack-builder/README.md` — entry point linking to the playground doc.
- `distro-pack-builder/playground.md` — step-by-step walk through primitives.
- `distro-pack-builder/.claude/skills/pack-builder-workshop/` — assistant skill (project-scoped, not synced).
- Cross-references to `examples/distro-pack-template/` and `skill/references/distro-v1-schema.json`.

**Pairs with FOLLOWUP-011** (cross-machine substrate validation) — a real enterprise pack builder following the workshop on a non-Geoff machine validates Stage 21d's substrate end-to-end.


## Missing features
### MISSING-001: Markdown editor — no way to add a comment

**Status:** 🟡 **PARTIAL** in v0.6.7 (Sprint 6 Phase 4, 2026-05-04). Full TipTap data plane SHIPPED (mark + sidecar + re-anchor + rail + 3 affordances all work end-to-end and reopen-survives), but smoke walk surfaced one regression: clicking a rail thread beyond #1 doesn't activate the corresponding anchor's stronger background tint. Filed as BUG-087 — follow-up before the v0.6.7 cut. Full TipTap data plane:

- `CommentMark` **extension** (new `renderer/components/editor/extensions/CommentMark.ts`). Inline mark with a `commentId` attribute that renders as `<span data-duo-comment-id="…" class="duo-comment-anchor-text">`. Inclusive boundaries (typing at the edge extends the anchor); doesn't merge with adjacent marks of a different id; commands `applyCommentMark(id, from?, to?)` and `removeCommentMark(id)` for the comment lifecycle.
- **Sidecar persistence** (`<file>.md.duo.json`, same shape as canvas — extended `SidecarComment` with optional `excerpt` / `contextBefore` / `contextAfter` for re-anchoring). Markdown source stays clean: `Markdown.html` is configured `false` so the spans strip on serialize; comments live entirely in the sidecar JSON.
- **Re-anchor on file load** (`renderer/components/editor/markdownComments.ts` — new module). Walks the parsed doc looking for each sidecar comment's excerpt; uses `contextBefore` / `contextAfter` for disambiguation when the same excerpt appears multiple times. Pre-save pass refreshes excerpt + context to the latest text so the next reopen finds it. PM-position → text-offset mapping handles node-boundary off-by-one cleanly.
- **CommentRail + composer** wired in MarkdownEditor with the same primitive shared with the canvas. The `NewCommentComposer` got extracted from PageTab into `primitives/NewCommentComposer.tsx` so both surfaces use one implementation.
- **Three discoverable affordances** (parity with BUG-081's canvas redesign):
  - Toolbar 💬 button via `EditorActions.startComment` + `canStartComment`. Wires through a `startCommentRef` so the editorActions closure stays stable while the toolbar always invokes the latest handler.
  - ⌘⌥M global shortcut (no new chord — same `'startComment'` ShortcutId from Phase 2; the markdown editor listens for `'duo-start-comment'` window events identically to the canvas).
  - Right-click "Comment" menu entry. `electron/main.ts` gate extended: shown when EITHER the canvas iframe (`frameURL` is `about:srcdoc`) OR the main BrowserWindow's renderer with an editable selection (`isEditable === true`). Browser-tab WCVs have their own ecmOptions instance so they're never affected.
- **Visual decoration** in `globals.css` mirrors the canvas's `[data-duo-has-comment]` rule for `.ProseMirror [data-duo-comment-id]` — soft accent background + bottom border, stronger when the thread is active. Light + dark mode parity.
- **Bidirectional click-to-focus** wired: clicking a thread in the rail → scroll editor to the marked range; clicking the marked text → activate the corresponding rail thread.

Verified live: created comment via toolbar / ⌘⌥M / right-click; the rail mounts; the second paragraph picks up the orange decoration; close + reopen the file — decoration reappears via the re-anchor pass; Electron-restart cycle preserves everything (sidecar on disk).

Promoted 2026-05-04 after owner asked "I thought we shipped comments a long time ago for both the markdown editor and HTML canvas — I can't find them in the app." Stage 14a was deferred sprint after sprint; this is the cycle that ships it. Pairs with BUG-081 (canvas comments regression — file together as the "comments are real and visible" sprint). **Priority:** **High** (was Medium — feature gap that the owner recently re-discovered; the comments capability was always communicated as "shipped on canvas, coming to markdown next" but Stage 14a never landed). **Filed:** 2026-04-26 (v0.3.0 pre-cut smoke). Re-prioritized 2026-05-04.

**Context**:Stage 14a (CommentRail binding for the markdown editor) is the planned home for this — currently labeled "next" on the roadmap, with the visual primitive (`<CommentRail>`) already built in 17d-A and reused by the canvas. The markdown half hasn't shipped. `MarkdownEditor.tsx` has zero comment imports; the entire comment data plane (TipTap mark + decoration + anchor reconciliation across edits) is the unbuilt half.

**Suggested next step**:Pair with BUG-081 fix in v0.6.7. Sprint shape:

1. Fix BUG-081 first (canvas regression; smaller scope, restores known-good behavior).
2. Stage 14a — TipTap mark for `data-duo-comment-id` anchors, decoration to render the floating Comment pill on selection, anchor-reconciliation across edits (the hard part — when the user edits text mid-comment, the anchor should follow), CommentRail data-plane wire-up. The visual primitive + new-comment composer pattern are already solved canvas-side and reused.
3. Smoke walk to validate both surfaces end-to-end before next cut.

**Cross-ref:** BUG-081 (the canvas-side regression discovered in the same investigation). Stage 14 / 14a on `docs/roadmap.html`. Stage 17d-A (where the canvas-side first shipped).

---


## Follow-ups (open · process / docs)
### FOLLOWUP-002: Harden `agents/duo.md` session guard against Bash-allowlist denial

**Status:** ⏳ Open (low priority — corner case) **Priority:** Low **Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** When the agent's session-guard bash command (`[ -n "$DUO_SESSION" ] && echo "in_duo" || echo "not_in_duo"`) is permission-denied — typically because a user wrote a tight `Bash(duo *)` allowlist that doesn't cover `[`/`echo`/compound commands — the agent currently proceeds with the task anyway. C5 walk surfaced this: with `--allowedTools "Bash(duo *)"` the guard check was denied 3 times, then the agent fell through to `duo doc read /tmp/foo.md` and reported the file's contents.

**Fix.** Add to the agent prompt's session-guard block: "If you cannot run the check (the Bash call is permission-denied or otherwise unable to execute), treat that the same as `not_in_duo` — refuse and stop. Never run a `duo` verb without first confirming `$DUO_SESSION` is set."

**Why low priority.** Most users don't hand-write Bash allowlists for the duo agent specifically; the realistic outside-Duo scenario (no allowlist) works correctly — verified live in C5.

**Affected file:** `agents/duo.md` (Session guard section, lines 19–37).

---

### FOLLOWUP-003: Re-measure Class B perf with cumulative-context methodology

**Status:** ⏳ Open (open question, not blocking) **Priority:** Low **Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** The synthetic Class B measurement during Stage 5 v2 ship inverted the PRD's hypothesis: subagent path (`Sonnet → Task(duo)`) was \~2× the cost and 2× the wall-clock of inline (`Sonnet → Bash(duo *)`) on a fresh F1. Cause: Claude Code already routes mechanical tool execution to Haiku regardless of `--model`, so the subagent path stacks a second Haiku context on top of the existing fast-tier Haiku.

**Why the PRD pass criteria don't apply.** "≥60% orchestrator-token reduction" assumed the top-level Sonnet was processing CLI dumps. In Claude Code today, it isn't. The benefit framing has to shift to: *bounded context per task*, *specialized prompt*, *clear orchestrator/agent contract* — qualitative wins that scale with session length, not per-task dollar wins on a cold-cache synthetic.

**Right methodology.** Track cumulative orchestrator-context tokens across a multi-task session — e.g. 10 sequential duo tasks in one Claude Code session, with vs without subagent. The cache-pollution argument should show up there.

**Why low priority.** The agent already shipped; the qualitative wins are real even if the quantitative measurement disagreed with the PRD. Re-measurement is "would be nice for justifying the architecture" not "blocking next stage."

**Affected files:** none directly. Notional follow-up for whoever wants to validate the architectural choice.

---

### FOLLOWUP-004: Visual smoke of Stage 5 v2 + Stage 15.1 (CLI half + pill UI) via computer-use

**Status:** ⏳ Open (deferred — user couldn't approve computer-use access in the spawning session) **Priority:** Low (CLI surface is verified via API responses; this would only catch UI/renderer regressions) **Filed:** 2026-04-26 late-evening, after `request_access` for Electron timed out

**What.** Run the visual sanity pass on the live Duo app to confirm:

1. App boots cleanly post-Stage-5-v2 main-process changes (`shell.openExternal`, the `external` socket case, `getSelectionFormatState`/`setSelectionFormat`, `sendToActiveTerminal`, `TERMINAL_ACTIVE_PUSH` IPC) — no preload/main errors at mount.
2. The renderer's `useSelectionFormat` hook initializes cleanly and does its initial pushState (verify by running `duo selection-format` immediately after boot — should return `{format: 'a'}` for a fresh install or whatever was last persisted).
3. The `terminal:active-push` IPC fires on tab switch — open two terminal tabs, switch between them, run `duo send --text "marker"` while each is active, verify the payload lands only in the focused one.
4. The previously-issued `duo send` payloads from this session ("hello from duo send", "from stdin", the multi-line G10 sample) are visible in the active terminal's scrollback. (Will not have been "executed" — no Enter was pressed.)
5. No console / DevTools errors related to the new IPC channels.

**Why deferred.** `request_access` for Electron timed out — the user couldn't approve in the dialog from the session that needed it. Walking the smoke checklist § 1 (App boot) + § 2 (Terminal pane) + § 7 (Agent bridge — selection-format + send) by eye next session covers this faster than re-attempting computer-use.

**Recipe** (manual, \~5 min):

1. Launch Duo, open DevTools (⌘⌥I), check console for errors.
2. **CLI half:** in a Duo terminal: `duo selection-format` → expect `{format: 'a'}`; `duo selection-format c` → verify persisted state; `duo selection-format` → expect `{format: 'c'}`; `duo selection-format a` to restore. `duo send --text "smoke"` → expect "smoke" appended to terminal input line, no Enter pressed. Switch to a second terminal tab, repeat — payload lands in the new active tab only.
3. **Pill UI half (Stage 15.1):** open `/tmp/pill-fixture.md` (or any `.md`) via `duo edit`. Select a sentence in the editor with the mouse. **Expect:** a small purple pill labelled "Send → Duo ↗" floating \~6px above the selection, right-aligned to the selection's right edge. **Click the pill.** Expect: pill disappears, focus moves to the active terminal, and the formatted payload appears at the prompt — by default format A (`> "your selection"\n> (~/path · heading_trail)\n`), no Enter pressed. Verify with `duo selection-format b` then re-select-and-click → expect literal text only. Verify with `duo selection-format c` then re-select-and-click → expect an opaque token like `<<duo-sel-abc123>>`.
4. **Edge cases:** select near the top of the editor (no room above) → pill should appear *below* the selection; select to the far right of the column → pill should clamp to the viewport edge; click outside the editor without clicking the pill → pill should disappear (it follows editor focus).

**Affected files:** none directly. Just a verification pass.

---


Owner installed the prebuilt v0.4.2 DMG and walked the surfaces. These came back as observations — a mix of bugs and enhancements. Filed together so the v0.4.3 patch (or v0.5.0 cut) can scoop them in one pass.

---


## v0.4.2 punch list (filed 2026-04-27 from owner-side smoke)
### ENH-022: `duo doc goto` — agent-driven editor navigation (heading / line / anchor)

**Status:** 🔵 **DEFERRED — owner call v0.5.4 walk: "I'm tired of working this one, please drop priority level on this bug — it should not block the next release".** v4 added disk-reload (re-read file before each goto if the editor's clean) + `matched_heading` diagnostic field; v5 added `console.log('[doc-goto v4]', { didReload, bufferStale, heading })` for instrumentation. Both shipped in v0.5.4 but rev3 walk still showed BUG-034 instead of BUG-048. Carries over indefinitely; do NOT pull into the next sprint without owner re-prioritization. The instrumentation stays in the codebase so a future debugging pass has data without re-instrumenting. **Priority:** Deferred (was Medium; owner downgraded 2026-05-01)

**Was 🟡 (v3 partially fixed — released as-is in v0.5.3):** v3 precedence chain DID move the match (rev2: BUG-032; rev3: BUG-034 — different wrong heading, so the precedence change is doing something), but still wrong target. v4 hypotheses, in priority order:

1. **Buffer staleness (most likely).** TipTap's editor.state.doc was loaded when [tasks.md](http://tasks.md) was opened. Subsequent disk edits don't reload (Stage 16 external-write reconciliation is ⬜). The headings the precedence chain walks are from a stale buffer. The "different wrong heading" pattern between rev2 (BUG-032) and rev3 (BUG-034) is consistent with a buffer-from-different-snapshot.
2. **Word-boundary regex permissive.** My v3 regex `(^|\W)bug-038(\W|$)` should match a heading text containing "BUG-038" as a word, but my heading walk is comparing against `node.textContent` which loses formatting context — possibly multiple headings span "BUG-038" in their text via inline marks. Diagnose: log all headings the walk produces, see what matches.
3. **Closer numeric matches.** Rev2 picked BUG-032 (4 chars apart from 038); rev3 picked BUG-034 (4 chars apart). Coincidence? Or my word-boundary regex is matching shared prefix "bug-03" somehow. The needle "bug-038" should match exactly one heading; debugging via `matched_heading` field is the diagnostic path.

**Next-walk diagnostic ask:** when re-running, share the FULL CLI JSON response — the `matched_heading` field will name the actual heading text picked. With that, the cause is unambiguous.

**Was the v3 close attempt:** Match precedence tightened: `exact (case-insensitive) > starts-with > word-boundary > substring`. Previous v2 logic used a single `includes` pass which could pick a heading that mentions the needle as a stray substring; the precedence chain ranks intentional matches above incidental ones. Response shape (`DocGotoResult`) extends with `matched_heading` so wrong-match reports are self-diagnosing.

**Was 🟡 (v2 partially fixed — re-opened 2026-05-01 from v0.5.3-rev2 smoke walk):** Editor scrolled (v2 fix landed) but to BUG-032 instead of BUG-038. v2 fix proved the scroll plumbing; v3 fixes the heading-match logic.

**v3 hypotheses (carry into next sprint):**

1. **Heading match precedence is too loose.** Current impl: `headings.find(h => h.text.toLowerCase().includes(needle))`. First match wins, but `includes` is permissive — a heading text "BUG-032 (… mentions BUG-038 in body)" wouldn't match (only the heading text is searched), so this is unlikely. Worth verifying with the actual returned `anchor` field from the CLI response.
2. **Buffer staleness.** If the user opened [tasks.md](http://tasks.md) before tonight's edits and the editor's TipTap doc hasn't reloaded from disk (Stage 16 external-write reconciliation is ⬜), the `editor.state.doc.descendants` walk sees stale headings — possibly a version where BUG-038's heading text was different. Quick verify: run `duo doc read` against [tasks.md](http://tasks.md), compare the buffer against the disk file.
3. **Heading text shifted.** If the BUG-038 heading was renamed in a recent edit, an old anchor / heading text in the user's mental model wouldn't match the current text. Same diagnosis path as #2.
4. **Different file is the active editor.** `duo doc goto` operates on the active editor's path. If a different markdown file is active and contains a heading like "BUG-032 (… BUG-038 follow-up)", the match could land there. The CLI response's `path` field would tell us. Earlier smoke walks showed `path: ".../tasks.md"` so this seems unlikely but worth ruling out.

**Diagnostic ask for the next walk:** when re-running, share the FULL CLI JSON response (path / line / anchor fields). With that, the wrong-match cause is unambiguous.

**Was ✅ (v2 — briefly):** Two-pronged fix in `MarkdownEditor.tsx`'s doc-goto handler. (1) Chain `focus()`, `setTextSelection(pos)`, `scrollIntoView()` into a single `editor.chain().run()` so the scrollIntoView flag is on the same transaction that moves the selection — the original three-separate-commands form ended up with `scrollIntoView` running on an empty transaction after the selection had already settled, which PM treated as "selection visible — nothing to do" depending on layout. (2) Belt-and-braces RAF callback that resolves the target's DOM node via `view.domAtPos()` and calls native `scrollIntoView({ block: 'center', behavior: 'smooth' })` — same fix shape as BUG-043. v2 fixed the SCROLL gap; v3 must fix the MATCH gap.

**Was 🟡 (CLI parses + IPC returns ok, but the renderer doesn't scroll. Re-opened 2026-04-30 from v0.5.3 smoke walk):** User repro:

```
$ duo doc goto --heading "BUG-038"
{
  "ok": true,
  "path": "/Users/.../tasks.md",
  "line": 1802,
  "anchor": "bug-038-tab-cycle-still-skips-some-tabs-bug-021-follow-up"
}
```

The CLI lexical-scope fix (commit `bc5e520`) is correct — the response parses cleanly with the right path / line / anchor. The bug is now downstream in the renderer-side `dispatchDocGoto` handler, the markdown editor's response to that IPC, OR the editor's scroll-to-position implementation. The successful response means main + IPC are fine; the issue is in `MarkdownEditor.tsx`'s actual scrolling.

**v2 diagnosis (carry into next sprint):**

- Walk the path: `electron/main.ts § dispatchDocGoto` → IPC.DOC_GOTO_REQUEST → renderer handler in `MarkdownEditor.tsx` → ProseMirror commands.
- Most likely: the editor's `scrollToHeading` / `scrollToLine` helper has the same scroll-container-mismatch issue as BUG-043's find-bar (`scrollBy` on the wrong element). Look for `scrollIntoView` on a non-scrolling parent.
- Or: the active-editor matching is dropping the path mid-flight.
- Quick check: open [tasks.md](http://tasks.md), run `duo doc goto --line 100`, watch the Electron devtools for any ProseMirror command errors.

**Was ✅ (briefly):** Lifted `flagValue(args, name)` to module scope in `cli/duo.ts` so all subcommand cases share a single arg-flag lookup. Renamed the local one-arg shim in `case 'html'` to `flag` (closure over `subRest`) and updated all html-op call sites. Smoke-tested: `node cli/duo doc goto --heading "BUG-040"` against the live app returned `ok:true` with the resolved anchor. Original v1 (84f5a35) had the renderer/IPC plumbing right (or so I thought); only the CLI parser was broken — but the renderer's actual scroll handler is now exposed as the second half of this bug.

**Was 🟡 (broken at CLI surface — re-opened 2026-04-30):** User repro:

```
$ duo doc goto --heading "BUG-040"
duo: flagValue is not defined
```

**Root cause:** `cli/duo.ts § case 'doc' / sub === 'goto'` (lines \~479–481) called `flagValue(subRest, '--heading')` etc., but `flagValue` was defined locally INSIDE `case 'html'` (line \~652) and wasn't visible from the `'doc'` case scope. Pure lexical-scope bug.

**Implementation (renderer / IPC / main — all good, just blocked by the CLI bug)**:New `duo doc goto [<path>] --heading "X" | --line N | --anchor "Y"` verb. Markdown editor handles `--heading` (case-insensitive substring on heading text), `--line` (1-indexed; PM-tree walk to map line → block position), and `--anchor` (GitHub-slug match against headings; exact &gt; prefix &gt; substring). HTML canvas handles `--anchor` (`data-duo-id` first, falls back to `id`) and `--line` (top-level child of `<main>` / `<body>` — coarse). After landing: focus the editor, place caret / scroll into view, paint a 1.5s `.duo-goto-flash` highlight on canvas matches. Plumbing: full 8-step checklist + types in shared/types.ts (`DocGotoRequest` / `DocGotoResult`) + IPC channels + preload/host-api + main dispatch + socket-server case + cli verb + skill + agents + CLI-COVERAGE. **Priority:** **High** (real workflow gap — owner hit it 2026-04-30 looking for BUG-040 in `tasks.md`; agent has no way to land the editor view at the right spot after `duo edit`) **Filed:** 2026-04-30 (sprint addition)

**Owner ask:** "duo doc goto --heading|--line|--anchor so the agent can land the editor view after duo edit (the gap I just hit looking for BUG-040)." Followed by: "Should probably be go-to arbitrary dom element in html, and heading in markdown."

**Today:** `duo edit <path>` opens the file in the working pane. The user / agent then has to scroll to find what they came for. For a 2200-line `tasks.md` looking for `### BUG-040`, that's manual scrolling. Same gap exists for HTML canvases (no way to scroll to a specific `data-duo-id` after `duo edit`).

**Expected (v1):**

```
duo doc goto [<path>] --heading "Foo"
duo doc goto [<path>] --line 1043
duo doc goto [<path>] --anchor "bug-040"
```

`<path>` optional — defaults to the active editor's path. One of the three flags is required. Returns `{ ok, path, line?, anchor?, error? }`.

**Resolution semantics:**

- `--heading "Foo"` (markdown only) — case-insensitive substring match against heading text in document order. First match wins. Errors with helpful message + list of matched headings if zero matches.
- `--line N` (any text editor) — 1-indexed (vim / VS Code convention). Clamps to last line if N &gt; line count.
- `--anchor "X"` —
  - **Markdown editor:** matches the slugified-id of any heading. `### BUG-040: Foo` → slug `bug-040-foo`. `--anchor "bug-040"` matches via prefix or substring (case-insensitive). The slug computation matches GitHub's: lowercase, replace whitespace with hyphens, strip non-alphanumerics-or-hyphens.
  - **HTML canvas:** matches the FIRST element whose `data-duo-id` OR `id` attribute equals `--anchor`. `data-duo-id` wins if both exist on different elements. Owner clarification: "go-to arbitrary dom element in html" — so any `id` is in scope, not just `data-duo-id`.

**After landing:**

- Scroll the matched line / element into view (centered or top-third — recommend top-third for context).
- Place cursor at start of line (markdown) / focus the body and select the matched element (canvas).
- Focus the editor surface so subsequent keystrokes land in the doc.
- Push a brief "just-added" highlight on the matched line / element so the user sees where it landed.

**Plumbing checklist (per [CLAUDE.md](http://CLAUDE.md) § 4):**

1. `shared/types.ts` — `DocGotoRequest` / `DocGotoResult` discriminated unions; new IPC channels `DOC_GOTO_REQUEST` / `DOC_GOTO_RESULT`.
2. `electron/preload.ts` — wire request/reply pair (mirror `dispatchDocWrite`).
3. `electron/main.ts` — `dispatchDocGoto()` + socket-server handler.
4. `core/socket-server.ts` — extend NavBridge with `docGoto`; new case in command switch.
5. `cli/duo.ts` — `case 'doc'` branch with `goto` subcommand; flag parsing for `--heading | --line | --anchor`; `printHelp()` update. Rebuild binary.
6. `skill/SKILL.md` — verb cheat-sheet entry under § Verb cheat-sheet.
7. `agents/duo.md` — same.
8. `docs/CLI-COVERAGE.md` — inventory update.

**Renderer side:**

- `MarkdownEditor.tsx` — accept a new `onGotoRequest` callback or expose a ref method. Use TipTap's `editor.commands.setTextSelection` + `editor.view.dispatch` with a scroll-into-view marker. Heading lookup: walk the editor's doc tree, find heading nodes, match text. Line lookup: count newlines in the markdown (or use TipTap's `state.doc.resolve`). Anchor lookup: compute slug from each heading, match.
- `CanvasTab.tsx` — accept goto via the existing `htmlOp`-style dispatch OR a dedicated channel. Use `iframe.contentDocument.querySelector('[data-duo-id="X"], #X')`, then `element.scrollIntoView({ block: 'center' })` and add a "just-added" CSS class to the element for \~2s.

**Scope:**

- v1 ships markdown + canvas goto (the two surfaces with editor semantics).
- Browser tab goto (scroll to anchor in a loaded page) deferred — `BrowserManager` could add `--anchor` for `#fragment` URLs, but that's URL-bar work, not editor work.
- Image / PDF / markdown-preview tabs don't make sense for goto.

**CLI shape examples:**

```
$ duo doc goto --heading "BUG-040"
{"ok":true,"path":"/Users/geoff/.../tasks.md","line":2161,"anchor":"bug-040-external-domain-blocklist-not-bouncing-capitalonecom-gmailcom-to-system-browser"}

$ duo doc goto ~/notes/scratch.md --line 42
{"ok":true,"path":"/Users/geoff/notes/scratch.md","line":42}

$ duo doc goto --anchor "checklist-section"
{"ok":true,"path":"...","anchor":"checklist-section"}
```

**Cross-ref:** Stage 11 (markdown editor host), Stage 17a (canvas), Stage 15 (CLI plumbing checklist), `duo reveal` (file-level analog — this is the in-document analog).

---

### ENH-027: Local HTML defaults to canvas, not browser (`<meta name="duo-open-in">` opt-out)

**Status:** ❌ **Superseded by ENH-156 (verb-driven modality, v0.7.0).** ENH-027 was the `<meta name="duo-open-in">` opt-out path to "local HTML defaults to canvas." ENH-156 replaced meta-based routing entirely — `duo open` = browser (show me the thing), `duo edit` = canvas (modify the source); no meta is consulted. The original intent is satisfied by the verb, so this won't ship as specced. Closed 2026-05-31 (ENH-191/D8 re-evaluation). **Filed:** 2026-04-30 (v0.5.3 smoke walk OTHER NOTES).

**Why held until 17e:** the same machinery 17e ships for the script opt-in dialog (H8) reads the file's `<head>` at open time and decides a sandbox/routing property based on what it finds. ENH-027 piggybacks naturally — same `<head>` peek, same routing gate, same sidecar persistence model. Doing ENH-027 first means either (a) building a temporary single-purpose meta-reader that 17e then has to absorb, or (b) shipping ENH-027 without a path for users to upgrade their browser-routed pages to scripts-allowed canvases (the obvious progression). BUG-045 (file:// browser tabs expose Reveal/Trash — ✅ shipped v0.5.3) closes the immediate user pain so the wait costs nothing. See § BUG-045 above + the 17e roadmap entry for the bundling rationale.

**Owner observation:** "for local html artifacts, ... (better yet) they should default open in canvas not in browser."

**Today:**

- `duo edit foo.html` → routes via `fileClassifier.ts` → `html-canvas` type → opens in working pane as canvas. ✅ correct.
- Click `foo.html` in navigator → also via classifier → canvas. ✅ correct.
- `duo open foo.html` → resolves to `file://...` URL → calls `browser.openTab()` → opens in **browser pane**, NOT canvas. ❌ inconsistent.

The `duo open` verb was originally designed for URLs (web pages), and the file-path-resolution sugar (`resolveOpenTarget` converts a relative path to `file://`) was bolted on for convenience. But that means the same .html file routes to two different surfaces depending on which verb the agent chose, which leaks an internal distinction the user shouldn't have to know about.

**Design (already in docs/roadmap.html — Help/FAQ backlog)**:A per-file routing declaration via HTML meta tag. Agents/users add `<meta name="duo-open-in" content="browser">` to a file that explicitly needs browser semantics (scripts, full Chromium APIs, navigation, devtools). Default for HTML without the meta = canvas.

**Affected paths:**

- `core/socket-server.ts § case 'open'` — for `file://` URLs ending in `.html`/`.htm`, peek at the file's `<meta>` to decide canvas vs browser. If browser, current behavior. If canvas (or no meta), dispatch via NAV_EDIT-style IPC to the renderer to mount via fileClassifier.
- `renderer/components/fileClassifier.ts` — already returns `html-canvas` for `.html`. Optionally extend to read the meta tag and switch to a `browser` indicator when set, so the click-in-navigator path can also honor it.
- `.claude/skills/smoke-walk/generate.mjs` — add `<meta name="duo-open-in" content="browser">` to the generated HTML so smoke walks continue to land in browser (where their copy-button JS runs). Without this, ENH-027 would break the smoke-walk skill since canvas iframes have no `allow-scripts` (Stage 17e deferred).

**Sequencing decision:** ENH-027 should land before/alongside Stage 17e (per-file allow-scripts opt-in). Until 17e ships, the meta tag is the only escape valve for HTML that needs scripts — agent-generated dashboards, FAQ live-search, smoke walks, mini-tools.

**Cross-ref:**

- docs/roadmap.html § Help/FAQ — established the `duo-open-in` design.
- Stage 17e — allow-scripts opt-in dialog (still deferred). Once shipped, scripts can run in canvas, and `duo-open-in: browser` becomes a narrower escape valve (specifically for full-Chromium APIs, devtools, navigation history).
- BUG-045 — covers the deletable-from-browser case for files that explicitly chose browser semantics.
- `.claude/skills/smoke-walk/` — needs the meta tag once ENH-027 ships, OR a `--browser` CLI flag on `duo open`.

---

### ENH-041: Split the canvas (right pane) into side-by-side panels

**Status:** 🚧 v1 (Slack-style single aux slot) actively building in Sprint 3 (v0.6.3 → v0.6.4 arc). Locked spec: `docs/prd/canvas-split-view-research.html`. As of 2026-05-03:

- ✅ **Phase 3a-i** (`40c9951`): plumbing end-to-end — types, IPC channels, NavBridge methods, CLI `duo split-view {state, open, close, promote, resize}`, App.tsx state hook + IPC subscribers. Verified via CLI.
- ✅ **Phase 3a-ii** (`a0c144c`): visible UI — WorkingPane horizontal split, AuxHeader, SplitViewDivider. Verified live.
- ✅ **Phase 3a polish** (`f7ff1fe`): per-page `<meta duo-path-target="split">` so pages can default their `[data-duo-path]` clicks to Split View; smoke-walk generator opts in; agent docs document trigger language ("in split / alongside / side by side / as a companion / in the side panel").
- ⏳ **Phase 3a styling** (`5506f06` canvas drafted): 5 options (A current/shipped, B recommended, C–E alternatives) at `docs/prd/canvas-split-view-styling.html`. **Owner pick pending.**
- ⏳ **Phase 3b** (queued): right-click "Move to Split View" on tabs / file-tree / pinned / page-link; `⌘\` open + `⌘⇧\` close keyboard chords.
- ⏳ **Phase 3c** (queued): session-state persistence (aux + splitPct survive launch); empty-main → promote (already wired; needs integration test); dirty-replace native dialog; browser-tabs-in-aux.
- 🔵 **Deferred non-blocker:** FTUX default split content (auto-split welcome on first launch?) — pick after dogfooding.

**Locked spec deltas from the original "side-by-side panels" framing:**

- v1 is single-slot (one aux tab); Option B (multi-tab aux) kept on table for v2 with B-ready internals (`tabs[]` shape) from day one.
- Aux is right-side-only; no top/bottom/left aux; no recursive splits (Option C explicitly rejected).
- Capability deltas main↔aux: NONE in v1 (same TipTap/canvas surfaces, dirty/save/Send→Duo all work the same; three things deferred: browser-tabs-in-aux, pinning, multi-tab).
- Move semantics on tab right-click; Open semantics on file/link right-click. Single source of truth: never two tabs for the same path across panes.
- ``` ⌘\`` cycle is 2-way (terminal ↔ working pane, last-focused side);  ```⌃Tab\` is focused-pane only.
- User-facing label "Split View" (CLI verb `duo split-view`).

**Priority:** Low-medium (long-tail leverage; not blocking any current sprint but enables compelling workflows) **Filed:** 2026-05-02 (Stage 27 walk-2 owner request)

**Terminology:** see ENH-040 — "canvas" = right pane in user vocabulary (the slot that hosts a markdown editor, HTML canvas, browser tab, etc.).

**What's wanted:** the ability to split the canvas (right pane) into two side-by-side sub-panels, so the user can have e.g. a markdown editor on the left of the canvas + a browser tab on the right of the canvas, viewable simultaneously. Each sub-panel has its own active tab + tab strip.

**Why this is interesting:**

- Compare-and-edit: open the source markdown in the left sub-panel + a generated HTML preview in the right sub-panel; edits on left, watch right repaint.
- Reference-while-authoring: docs in left, code editor in right.
- Multi-canvas lessons: a Stage 28 lesson canvas in left + the HTML the user is creating in right.

**Existing precedent:** the main split (terminal | canvas) is already a horizontal divider. This ENH extends the model to a SUB-divider inside the canvas. The same `react-split-pane` / equivalent primitive should drive both.

**Scope (rough — for later flesh-out):**

1. New "Split canvas" menu item / right-click on the canvas's empty space.
2. Two sub-panels, each owning its own `activeWorking` state independently. Tab strip is per-sub-panel.
3. Drag-to-move-tab-between-sub-panels (UX detail; bound up with ENH-042 reorder).
4. The terminal column stays unchanged — split is purely within the right pane.
5. Persistence: layout state (one or two panels) is part of session-restore.

**Sequencing concern:** depends on us having stable session-restore semantics for multi-pane state (Stage 21c Phase 2 covers single-canvas restore today; multi-sub-panel needs schema extension).

**Cross-ref:** ENH-040 (collapse — a related but orthogonal pane-management feature); session-state-service (where restore schema would extend).

---

### ENH-043: The smoke-walk skill should be re-buildable via playground primitives \[REFRAMED — narrowed scope\]

**Status:** 🚧 **Reframed twice in Sprint 5.** First reframe (2026-05-04 morning) decomposed into ENH-092/093/094 + a worksheet refactor. Second reframe (2026-05-04 evening) — owner pushback on the "framework" direction: future-Claude is a capable coder; primitives that pre-chew its meal just get bypassed. Final scope: **ship ENH-094 (browser-pane runtime injection) so the smoke walk can fire** `duo:event` **live as the user interacts; close ENH-092/093 won't-do.** The smoke walk's existing inline JS (state/tally/composition) stays — it's appropriate page-specific code. The DELTA after ENH-094 is that the worksheet adds `data-duo-action="duo:event"` decorators on radio changes, and Claude subscribed via `duo events --follow` sees walk progress live instead of waiting for copy/paste. Net change to the worksheet generator: \~5 lines of decorator injection. ENH-043 closes when ENH-094 ships + the worksheet generator emits the event decorators. **Priority:** High (architectural — this is what the playground is *for*). **Filed:** 2026-05-02 ([idle-thoughts.md](http://idle-thoughts.md)). Reframed 2026-05-04 (post-Phase-5 cut readiness check).

**What the smoke walk actually does today (custom inline JS in** `worksheet/generate.mjs`**).** The 958-line generator emits a self-contained HTML page with NO playground primitives — every behavior is custom `addEventListener`:

1. Per-item radios → CSS class on parent card (color tinting per PASS/FAIL/SKIP)
2. Live tally (counts at top, recompute on every change)
3. localStorage persistence (every input/change → save; on load → restore)
4. "Mark all PASS" bulk button
5. "Clear saved" wipe button
6. "Copy results" — gather form state, format as text, write to clipboard
7. "Send to Claude" — same composition, route to `window.duoSendResult` with clipboard fallback (FOLLOWUP-007 plumbing)
8. Per-step `<pre>` copy buttons + backtick-parsing logic for runnable-command detection

**What playground primitives have today.** Seven one-shot action verbs (`claude:spawn`/`terminal:send`/`editor:open`/`nav:reveal`/`selection:set`/`theme:set`/`terminal:focus`/`duo:event` + `browser:open`) + `data-payload-from` for single-input form-state binding. The vocabulary is "click → fire one structured action to host." Smoke walks need state, DOM reactivity, composition, clipboard — none of which today's verbs cover.

**Plus a runtime-injection gap.** The playground action runtime (`installPlaygroundActions(doc, opts)`) lives in the canvas iframe's `contentDocument` — it doesn't reach browser-pane pages. Even with new verbs, a smoke walk hosted in a browser tab couldn't use them today. Same precedent already exists for partial cases though (Send→Duo pill `SELECTION_OBSERVER_IIFE`, `data-duo-path` `PATH_LINK_FORWARDER_IIFE`); we extend it to a full `PLAYGROUND_RUNTIME_IIFE` that injects the vocabulary into browser-pane pages too.

**Decomposition (3 sub-ENHs):**

1. **ENH-092** — Playground state + DOM-reactivity primitives (`state:save`/`state:set`/`state:get`/`state:wipe`, `dom:set-class`/`dom:toggle-class`/`dom:bind`).
2. **ENH-093** — Playground composition + clipboard (`compose:result` walks form state into a structured payload; `clipboard:copy` writes literal or composed payload).
3. **ENH-094** — Inject the playground runtime into browser-pane pages via CDP (`PLAYGROUND_RUNTIME_IIFE`). Now playground primitives work in EITHER pane.

After 092 + 093 + 094 ship, ENH-043 = refactor `worksheet/generate.mjs` to emit pure declarative HTML using the new vocabulary. No inline JS. Manifests stay JSON; output becomes a thin recipe of playground verbs.

**Why this matters (the original framing was right; the implementation didn't catch up):** the same primitive set will power lesson canvases, agent-generated dashboards, smoke walks, sprint-plan worksheets, future retros / triage forms. Today each is a separate generator. After ENH-092/093/094 + 043, they share one runtime contract.

**Cross-ref:** ENH-092 / ENH-093 / ENH-094 (the dependencies). Stage 27 (the canvas-authoring vocabulary this extends). FOLLOWUP-007 (`duoSendResult` binding — the partial-case CDP injection precedent).

**Cross-ref:** Stage 27 PRD (canvas-authoring); `skill/canvas-authoring.md`; ENH-046 (code-block + copy-button primitive — a sub-component this ENH would need).

---

### ENH-045: Navigator — "Project Claude Context" improvements (collapsible, dynamic name, project detection, gh integration)

**Status:** 🚧 ENH-045a shipped v0.6.3 — sub-stages b/c/d still queued **Priority:** Medium (meaningful UX upgrade with downstream ENH branches). **Filed:** 2026-05-02 ([idle-thoughts.md](http://idle-thoughts.md) item — multi-bullet) **ENH-045a shipped 2026-05-02** — `renderer/components/ProjectClaudeContext.tsx`:

- Collapsible header (default collapsed per owner direction). Toggle persists across sessions in localStorage at `duo:project-claude-context:collapsed`.
- Dynamic title: `{projectName} Claude context` where projectName resolves to `package.json` `name` field if present at cwd, otherwise the last segment of cwd. Async package.json read happens once per cwd change; folder-name shows immediately, package name upgrades when read lands.
- Auto-detection: the existing `candidates` check (renders nothing when no `CLAUDE.md` / `.claude/` / `tasks.md` / `AGENTS.md` exist) already matched the owner's "any folder containing a `.claude/` OR being the root of a git/github repo IS a project" framing — projects with no Claude context still don't render the section.
- Disclosure caret rotates 90° on expand; click anywhere on the header toggles.

**Still queued:**

- **ENH-045b** — gh status visibility (depends on a `git`/`gh` background prober; deferred — needs Stage 21d socket auth).
- **ENH-045c** — promote-to-project + sync-to-github actions (downstream of 045b).
- **ENH-045d** — new-project skill (interview flow + templates).

**Owner's full feature set:**

1. **"Project Claude Context" should be collapsible**, default to collapsed.
2. Renamed to **"{project-name} Claude Context"** where `{project-name}` is the current project's name (folder name, repo name, or `name` from package.json — define precedence).
3. **Auto-detect projects:** any folder containing a `.claude/` OR being the root of a git/github repo IS a project.
4. **Github status visible** (per project — pull state, branch, etc.).
5. **Easy github actions** from the navigator (later — this is downstream).
6. **Promote a file to be a project** via CLI or context-click.
7. **Sync a folder to github** even if not yet linked.
8. **Project assets / new-project skill:** explore creating default per-project assets (project overview HTML, lesson skill that interviews the user about goals, etc.).
9. **Project templates** for the enterprise-distro story (ties to Stage 18b).

**Sequencing:** this ENH is a parent of multiple sub-ENHs. Items 1-3 are the v1 (collapsible, naming, auto-detect) and unblock most of the experience. Items 4-5 are gh-integration (Stage 21d-ish — depends on socket-auth + agent-driven-nav-notifications). Items 6-9 are subsequent expansions.

**Recommended carve-up:**

- ENH-045a — collapsible + dynamic naming + .claude/ detection (cheap; v1)
- ENH-045b — gh status visibility (depends on a `git`/`gh` background prober)
- ENH-045c — promote-to-project + sync-to-github actions
- ENH-045d — new-project skill (interview flow + templates)

**Cross-ref:** Stage 18b (pack distribution — project templates fold here); existing `useNavigator` hook + `FileTree.tsx` for the rendering.

---

### ENH-047: Smoke walk V8 / "duo events" listener should auto-spawn — don't ask user to copy/paste a command

**Status:** 🆕 Filed **Priority:** Medium (process improvement to smoke-walk skill). **Filed:** 2026-05-02 (walk-2 owner feedback on V8)

**Owner observation:** "this is a fine smoke test, but we cannot rely on the user to copy/paste commands into the terminal to put duo in listening mode; you will need to figure out how to automate this."

**What's wanted:** when a smoke-walk step requires a background process (currently `duo events --follow` for V8/V13), the skill should spawn that process FOR the user — either by:

1. Using `duo new-tab --cmd "duo events --follow"` to open a new terminal tab with the command pre-running, OR
2. Capturing events programmatically in main and surfacing them via a renderer-side panel within the smoke-walk page itself, OR
3. Spawning a hidden background process and writing its stream into a localStorage-backed log that the smoke-walk page polls + displays.

**Recommended:** path 1 (auto-spawn via `duo new-tab`) — simplest, lowest delta from today, keeps the user in control of the process.

**Sequencing:** depends on ENH-046 (the walk page emitting code blocks with copy buttons) — this ENH is the "now also auto-launch where possible" upgrade.

**Cross-ref:** ENH-046; smoke-walk skill PRD (`docs/dev/smoke-walks/`); V8 / V13 walk items.

---

### ENH-048: Smoke walk V14 — clearer instructions for "use a new terminal session?"

**Status:** 🆕 Filed **Priority:** Low (smoke-walk usability). **Filed:** 2026-05-02 (walk-2 owner feedback on V14)

**Owner feedback (verbatim):** "no idea how to follow this instruction; please be clearer. is this in a new terminal session?"

**What's wanted:** V14 instructions ("Run `duo events --limit 10` and copy the cursor of an OLDER event...") need explicit context:

- Which terminal? A new one, or the same one as V8's `--follow`?
- Should the V8 `--follow` listener still be running, or stopped?
- "Cursor format `<unix-ms>-<seq>`" — what's the exact copy-paste shape?

**Action:** rewrite the V14 step list with:

1. Explicit terminal hand-off ("In a SECOND terminal, separate from V8's listener").
2. A worked example with sample output ("you should see lines like `{cursor: '1777725725181-0', ...}` — copy the `cursor` value verbatim including quotes").
3. The `duo events --since '<cursor>'` invocation in a code block with a Copy button (ties to ENH-046).

**Cross-ref:** ENH-046; ENH-047; V14 walk item.

---

### ENH-077: System dialog icon — verify production behavior, file polish if dev-only

**Status:** 🟡 Code-path verified clean (2026-05-03 — Sprint 3 sweep). DMG smoke-verify owed in v0.6.4 cut to formally close. **Priority:** Low (cosmetic; only visible in dev) **Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V4 owner notes)

**Owner observation (verbatim):** "can we update the icon that displays in system dialogs?"

**Context:** `dialog.showMessageBox` on macOS uses the parent BrowserWindow's app icon by default. In a packaged + signed Duo build, that icon is Duo's clawd glyph (Stage 21b). In dev (`npm run dev`), the parent is Electron's default app icon — which is what owner saw. So the dev display is "wrong-looking" but production should already be correct.

**Code-path verification (2026-05-03):**

- `electron-builder.yml § mac.icon: build/icon.icns` ✅ correct (Stage 21b multi-resolution icon, generated from `build/icon.png`).
- `electron/main.ts § new BrowserWindow({ ... })` constructor ✅ does NOT override `icon:` — the bundle's Info.plist icon governs.
- `build/icon.icns` ✅ exists in the repo.
- No `dialog.showMessageBox` call in the codebase passes a custom `icon:` argument that would short-circuit the bundle icon.

**Conclusion:** production behavior should be correct without any code change. The dev-mode "wrong icon" is an artifact of running in unpackaged Electron and is not a defect worth shipping a dev-only override for (would add complexity for cosmetic-only polish).

**v0.6.4 DMG verify step:** open a packaged + signed Duo, trigger any `dialog.confirm` (e.g. right-click a navigator entry → Move to Trash), confirm the dialog shows Duo's clawd glyph. If yes → close ENH as no-op. If no → re-open and look at `electron-builder.yml § mac.icon` resolution + the .app bundle's `Resources/icon.icns` path.

---

### Discussion-only: location of `agents/duo.md` (project root vs `.claude/agents/`)

**Owner observation (verbatim):** "why is the duo agent definition here `/Users/geoffreydudgeon/Documents/GitHub/duo/agents/duo.md` and not in here `/Users/geoffreydudgeon/Documents/GitHub/duo/.claude` ?"

**Answer:** `agents/duo.md` at the project root is the SOURCE-OF-TRUTH that the install service ships. On `npm run sync:claude` (dev) and on the Stage 18 install banner (production), it's copied to `~/.claude/agents/duo.md` — which IS where Claude Code reads agent definitions from. So the user-Claude-side "where Claude reads it" is `.claude/agents/`, but the in-repo source is `agents/`.

**Could it move to** `.claude/agents/duo.md` **in the repo?** Yes — `.claude/` at the project root is itself a valid Claude-Code-recognized location, and the install service could pick it up from there. Pros: consistency with the user-level layout. Cons: project-root `.claude/` is currently for project-specific Claude config (settings, hooks, etc.), and mixing distributable agent-definitions with project-config is conceptually muddled. The repo's current layout (`agents/`, `skill/`, `packs/` all at root) treats those as "things Duo ships TO users" — a clean ship-source layout.

Filed as a discussion item, not a task. No code change unless the owner picks a direction.

---

### Discussion: Enterprise distro is a downloaded ZIP that becomes a submodule, NOT a fork

**Filed:** 2026-05-03 ([idle-thoughts.md](http://idle-thoughts.md) → processed in this sprint).

**Owner observation (verbatim):** "when we ship the enterprise distribution module or whatever it's called, should anticipate that the bundle (at the client site) will be a GH repo that is submoduled, or similar, into whatever version of the duo app is pulled down from [github.com/dudgeon/duo](http://github.com/dudgeon/duo); duo will not be cloned/forked, it will be literally downloaded as a zip file and then uploaded to the enterprise GH"

**Why this matters:** the prior Stage 21e "fork-friendly architecture" work assumed enterprise instances would clone or fork `dudgeon/duo`, edit `fork.config.json` + add their own packs, and run their own `dist-signed.sh`. The owner is clarifying that the ACTUAL enterprise pattern is:

1. Enterprise downloads `dudgeon/duo` as a ZIP (not via git).
2. Uploads the unzipped tree to their internal GitHub.
3. Adds their own enterprise pack(s) — likely as a **git submodule** under (e.g.) `packs/enterprise-name/` — pointing at a separate enterprise-only repo.
4. Builds Duo locally on enterprise infra. The submodule's pack ships in the resulting DMG.

**Implications for the architecture (v0.6.5+ / Stage 18b+):**

- `packs/` **directory must tolerate submodules.** electron-builder's `extraResources` glob already covers `packs/**/*`, but submodule contents are pulled in at `git submodule update`, not at clone time. The build script needs to ensure submodules are checked out before `electron-builder` runs. Add `git submodule update --init --recursive` to `scripts/dist.sh` and `scripts/dist-signed.sh` (already done? check).
- `PACK.json` **discovery** must continue to work for submodule-shaped packs (path-walk, not git-aware).
- `fork.config.json` — the existing layered identity overrides (productName / appId / publish coordinates) are still the right pattern; nothing about ZIP-download breaks them.
- **Update channel** — enterprise builds set `publish.provider` to their internal release host (GHEC, S3, internal Sparkle feed). The fork-config injection at CLI override time already supports this.
- **Doc work owed:** `docs/HOW-TO-FORK.md` should add an "Enterprise distro" section spelling out the ZIP+submodule pattern explicitly. Currently the doc implies `git clone fork`, which doesn't match the realized enterprise workflow.

**Filed as a discussion item.** No code change required RIGHT NOW — the existing Stage 21e architecture supports this pattern fine. The work owed is documentation + a sanity check that `dist-signed.sh` runs `git submodule update --init` before `electron-builder` (small addition if missing). Pull into a Stage 18b enterprise-distro sprint when that work surfaces.

**Cross-ref:** Stage 21e (fork-friendly architecture, shipped v0.5.0); `docs/HOW-TO-FORK.md`; `fork.config.default.json`; `electron-builder.yml § extraResources`.

---

### BUG-073: HTML canvas bullet rendering — `-` should produce a dashed bullet style, not the default round bullet

**Status:** 🆕 Filed (surfaced in v0.6.4 smoke walk, BUG-061 row). **Priority:** Low-Medium (cosmetic; functionality is fine — list creation triggers correctly. The marker character should hint at the visual style the way Markdown previewers (GitHub, Bear, Notion) do.) **Filed:** 2026-05-03 (owner smoke walk note).

**Owner observation (verbatim):** *"partial pass; '-' should render as dashed bullet, not round bullet; all other cases pass"*

**Today:** All three unordered-list markers (`-`, `*`, `+`) trigger an `<ul>` with default browser styling — the default `list-style-type: disc` (round bullet). Functionally correct (BUG-061 v3 ships); cosmetically the marker character is lost on conversion.

**What's wanted:** preserve the visual hint of the typed marker character.

- `- `→ `list-style-type: '– '` or similar (dashed marker)
- `* `→ asterisk or default disc (round)
- `+ `→ plus marker

**Implementation candidates:**

1. **Per-item** `data-list-marker` **attr.** When `convertEmptyBlockToList` fires, stamp the `<li>` (or its parent `<ul>`) with `data-list-marker="dash"` / `"asterisk"` / `"plus"`. CSS (in the canvas's `<head>` boilerplate or via the renderer's atelier overlay) maps to the right `list-style-type`. Survives a save → reopen round-trip cleanly.
2. **Inline** `style="list-style-type: ..."`**.** Simpler but pollutes the saved HTML with style attributes; inconsistent with the rest of the canvas's class-based styling pattern.
3. **CSS class.** `<ul class="duo-list-dash">` etc.; pretty-printer needs to whitelist them.

**Recommended:** option (1) — `data-` attrs are cheap, pretty-printer-stable, and easy to read in saved HTML.

**Editor-canvas parity disposition (per [CLAUDE.md](http://CLAUDE.md) § 4):** **(c) Deferred** — markdown editor has this concept too (TipTap's BulletList extension supports per-item marker), but a separate ENH should carry that parity once this canvas-side ENH ships.

**Cross-ref:** BUG-061 (parent — markdown-trigger family); `markdownShortcuts.ts § convertEmptyBlockToList` (the function that needs to know which marker character was typed).

---

### BUG-086: Smoke-walk skill should re-verify the page rendered as a browser tab (not as a canvas)

**Status:** 🔴 **IMMEDIATE PRIORITY for v0.6.7** (Sprint 6 mid-flight, 2026-05-04 smoke-walk procedural failure) **Priority:** **Medium** (smoke-walk is sprint infrastructure; if it can route to the wrong surface, the cut process gets jammed and the walk has to be re-done by hand). **Filed:** 2026-05-04 (smoke walk v0.6.7 — owner reported "smoke walk non functional — opened as editable in html canvas so I could not click the 'copy results' button").

**Symptom.** The smoke-walk page (`docs/dev/smoke-walks/v0.6.7.html`) was generated correctly with `<meta name="duo-open-in" content="browser">`. The skill ran `duo open <path>` which returned `{ ok: true, routedTo: "browser" }` — the bridge confirmed routing to the browser pane. AND `duo url` immediately after confirmed the URL + title matched the smoke-walk page in the browser tab list. Despite all that, the user saw the page render as an editable HTML CANVAS and couldn't click the Copy results / Send to Claude buttons (the canvas's contentEditable swallows interactions). The user fell back to copying the page text by hand.

**Likely cause.** Investigation deferred. Two hypotheses:

1. The user's last-active working tab was a canvas, and `duo open` opened the smoke walk into a NEW browser tab BUT the working pane stayed on the previous canvas — the user saw the canvas and assumed it was the smoke walk.
2. There's a path where the meta tag's routing intent is honored at the bridge level (return path returns `routedTo: "browser"`) but the renderer-side WorkingPane still mounted it as a canvas. Either way, post-`duo open` checks (which the skill DOES run via `duo url`/`duo title`) would NOT have caught hypothesis 1 — they only verify the BROWSER tab's URL/title.

**What to fix on the skill side:**

1. After `duo open`, ALSO run `duo selection --pane canvas` and `duo selection --pane editor` — confirm neither returns the smoke-walk path. If either does, the page rendered into the wrong surface.
2. Pre-handoff, check `activeWorking.kind === 'browser'` via `duo nav-state` (or equivalent). If the working pane is showing a canvas/editor, the user's eye lands there — not on the new browser tab.
3. If detection fails, instruct the user to click the smoke-walk tab in the browser-tab strip explicitly before walking.

**Cross-ref:** smoke-walk [SKILL.md](http://SKILL.md) § Step 5 (the existing focus-verification step doesn't catch this case).

---

### BUG-089: Canvas — anchor decoration "flickers" while typing inside a commented heading

**Status:** 🔴 **IMMEDIATE PRIORITY for v0.6.7** (BUG-083 smoke-walk follow-up) **Priority:** **Medium** (cosmetic; users notice and worry the comment is breaking). **Filed:** 2026-05-04 (smoke walk).

**Symptom.** Canvas. User adds a comment to an H1, then types inside that H1 to edit it. The orange anchor decoration on the H1 visibly flickers (briefly disappears + reappears) on each keystroke.

**Likely cause.** paintAnchors is called from the builtThreads useMemo / useEffect chain. On every typing transaction, MutationObserver fires → handleChange → … some path that re-runs paintAnchors. paintAnchors removes + re-stamps `data-duo-has-comment` (instead of leaving it in place when the anchor element is still present). The remove-then-stamp window is one paint frame and is visible as a flicker.

**Fix path.** In paintAnchors's loop, only update attributes that have CHANGED. If the anchor element already has `data-duo-has-comment="1"`, don't strip + re-set. Same for `data-duo-comment-active`.

**Cross-ref:** BUG-083 (parent feature). commentAnchors.ts § paintAnchors.

---

### BUG-093: Right-click tab → Move to Split View can crash the renderer

**Status:** 🟡 **Filed + INSTRUMENTED in v0.6.7** (smoke walk v0.6.7-rev3 OTHER-NOTES, 2026-05-04). Awaits a clean repro against the instrumented build. **Priority:** **High** (when the bug fires, the canvas / editor crashes; pre-instrumentation the entire renderer dropped to the app-level error page; post-instrumentation the WorkingPane drops to a localized error panel and the rest of the app — terminal column, file tree, banners — keeps running). **Filed:** 2026-05-04 (rev3 walk BUG-088/090 step 3 — "tried to move that canvas to split view (right click tab) and it caused a render error that forced reload of the whole app").

**Symptom.** With a fresh canvas active in the working pane (rev3 step was a `/tmp/v067r3-bullets.html` canvas with a few bullets typed and one comment thread), user right-clicks the tab → "Move to Split View." The renderer crashes (React error overlay or main-process error message). Pre-v0.6.7-instrumentation, the app-level boundary caught it but the user lost their entire working session on Reload.

**Suspected causes (still need a clean repro + the new traces to confirm).**

- Dirty-replace swap path in `App.tsx § splitViewMoveTabByPath` — the aux slot's existing content gets promoted back to main as a fresh file tab; if the canvas was mid-mount (autosave debouncer pending, comment-rail mounting, auto-stamp observer attached, user-typed mutations not yet flushed), the unmount/remount cycle could trip a stale-ref or unmount-after-setState pattern.
- Auto-stamp observer cleanup race (recent: [99826fa](https://github.com/dudgeon/duo/commit/99826fa) dropped the install sentinel and now relies on idempotent stamping; cleanup function returned by `installAutoStampIds` may not run before the iframe's `srcdoc` swap on remount).
- Comment data-plane (Sprint 6 Phase 4 — [ea1e828](https://github.com/dudgeon/duo/commit/ea1e828)) — the rail / TipTap data plane assumes a stable surface; an iframe re-srcdoc during a swap may leave dangling subscriptions.

**Instrumentation landed (v0.6.7).**

- **Inline** `ErrorBoundary` **wraps** `<WorkingPane>` **in** `App.tsx`**.** A render error inside WorkingPane no longer drops the entire renderer to the app-level error page — it shows a localized "WorkingPane hit a render error" panel inside the working column with a "Try again" button (remounts via the boundary's `retryKey` bump) and a "Reload renderer" fallback. Terminal column, file tree, banners, menu all keep running. Captured `[ErrorBoundary:WorkingPane]` console error survives the remount / persists in devtools.
- **Structured** `[BUG-093]` **console traces in** `App.tsx § splitViewMoveTabByPath`**.** Logs at every decision point: ENTRY (with auxState / dirty count / fileTabs count), no-op-already-in-aux, dirty-replace gate firing, dirty-replace gate CANCELLED, beginning swap, COMMITTED. Cheap when no crash happens; if the next move-to-split crashes, the last `[BUG-093]` line in the console names which step preceded the throw.

**Repro plan (now armed).** Open Duo dev. Type some bullets in a fresh canvas. Add a comment on one bullet. Open devtools console (filter on `[BUG-093]` and `[ErrorBoundary:WorkingPane]`). Right-click the canvas tab → "Move to Split View." If it crashes:

1. Read the last `[BUG-093]` log — the step it printed identifies WHICH phase of the swap was running.
2. Read the `[ErrorBoundary:WorkingPane]` log — the error message + component stack identifies WHICH component threw.
3. Cross-reference the two. The combination is usually enough to name the bug without further digging.

**Code-side analysis (Sprint 8 Phase 4, 2026-05-06).** Without a clean live repro yet, I audited the suspect code paths against the v0.6.7 instrumentation. Three structural issues stand out as likely contributors when the bug fires:

1. **Multi-setState cascade across** `await` **boundary** (App.tsx § splitViewMoveTabByPath:1564-1647). After `await window.electron.browser.releaseAuxTab()` (line 1566) and `await window.electron.dialog.confirm(...)` (line 1591), React's automatic batching is broken. The subsequent block fires four separate setStates in sequence: `setFileTabs(filter)` (1619), `setFileTabs(append)` (1627), `setActiveWorking(...)` (1634), `setAuxState(...)` (1643). Each triggers a render. WorkingPane's intermediate-render states are mid-swap — fileTabs may already not include the moving-in path while activeWorking still references it, OR the new aux path is set before fileTabs has stabilized. A child component (PageTab → RenderedPage's iframe wire) reading inconsistent state during one of those intermediate renders is a plausible throw point.

2. **Stale** `fileTabs` **closure in setActiveWorking** (line 1636). `const wasMoved = fileTabs.find(t => t.id === prev.id && t.path === path)` reads `fileTabs` from the useCallback closure rather than React's latest state. Once line 1619's `setFileTabs(prev => prev.filter(t => t.path !== path))` queues, the closure-captured `fileTabs` is stale by the time line 1636 runs. The find still works (we want pre-removal data), but a similar pattern elsewhere could miss updates and cause an inconsistent state read.

3. **PageTab unmount/remount during swap** — when auxState.paths changes, WorkingPane decides which tab kind=`'page'` mounts in main vs aux. The path move triggers a `key={tab.id}` change on the PageTab, forcing unmount + remount. handleReady's wireCleanupRef cleanup chains (selectionchange listener, MutationObserver from installAutoStampIds, comment-anchor click delegate, just-added repaint scheduler) all return cleanup functions that must run BEFORE the new wire fires. If a previous wire's cleanup races with the new wire's setup, the new doc could observe leaked listeners or torn-down state. The recent BUG-088 fix (commit `e203b7c`'s ENH-091 caret-seed change uses the same wire path) doesn't add a new failure mode but does reaffirm the wire-path's complexity.

**Defensive fix candidates (deferred — low confidence without repro):**

- (a) Wrap the post-await setState block in `flushSync` from `react-dom` so all four setStates apply synchronously as one render batch. Trade: flushSync has its own caveats (forbidden during render; can de-optimize React's scheduling).
- (b) Restructure the swap: compute the desired state shape first (one object), then call setStates in dependency order with a single useReducer-style update. Bigger refactor but eliminates the intermediate-render risk class.
- (c) Add explicit unmount-stabilization in PageTab — guard handleReady against stale doc references via a per-mount epoch counter that handleReady checks before each side-effect install.

**Filed FOLLOWUP-013** (next sprint) to drive the clean-repro investigation: open Duo dev with devtools open + filtered on `[BUG-093]` + `[ErrorBoundary:WorkingPane]`, exercise the rev3 repro shape (fresh canvas + bullets + one comment + right-click → Move to Split View), capture the trace + ErrorBoundary log + component stack. With those three lines the fix usually names itself; without them any code change is speculation.

**Cross-ref:** BUG-092 (companion — even when the move *succeeds*, the resulting canvas is broken because the iframe sandbox blocks scripts); BUG-091 (the over-broad lift that gated this); BUG-065 (the original v0.6.3 ErrorBoundary that this extends with `inline` + `label` + `Try again`); Sprint 6 Phase 1/3/4 (comment-system work that may have introduced the unmount race).

---

### ENH-111: Data primitives umbrella — image v2, CSV table, YAML, Mermaid (PM persona cluster)

**Status:** ⬜ DRAFT — clustered roadmap doc landed; **image v2 promoted to Sprint 12 P0 anchor (owner directive 2026-05-08, pre-cut)** alongside BUG-108 (table-cell-copy). **Priority:** **Medium** — most items in the cluster are S/M effort; the cluster is what earns the win for the PM persona.

**Research doc.** `docs/research/data-primitives-canvas.html` §3 — primitive × use-case × effort matrix.

**Cluster sequencing (revised 2026-05-08 per owner pull):**

- **Image v2** (Sprint 12 P0 — promoted from Sprint 13 by owner): toolbar chrome around existing `<img>` base — zoom / pan / fit-to-window / 1:1 actual-size / dimensions readout / copy-to-clipboard. \~1d. PM persona benefit: dragging a screenshot from Slack into Duo currently shows a small image; with proper chrome, users can zoom into UI mockups without leaving Duo. Image tab type already exists (`renderer/components/fileClassifier.ts` § `'image'` case); this is renderer-side polish.
- **BUG-108 table-cell-copy** (Sprint 12 P0 — newly discovered 2026-05-08): clipboard gets literal `"[table]"` string instead of selected cell text. See BUG-108 entry below for symptom + reproduction. Pairs with image v2 because both are "fix what users actually do daily" Sprint 12 work.
- **JSON tier-3 viewer (ENH-110)** (Sprint 12 P1 — was P0 anchor in earlier sprint plan): `@uiw/react-json-view` as new `kind: 'json'` tab type. \~3d.
- **CSV / TSV** (Sprint 12 P2 — defer if Sprint 12 fills with image + BUG-108 + JSON): sortable table, column-type inference, summary stats. `papaparse` + TanStack Table. \~5d.
- **YAML** (Sprint 13 P1): reuse the JSON tab kind with a `format` discriminator. \~1d.
- **Mermaid** (Sprint 13 P0, paired with Obsidian content fidelity): TipTap node extension inside the markdown editor. \~2d.

**Cluster non-contents (skip / defer):**

- **SQLite explorer** — real users for this are devs not PMs; DB Browser for SQLite is great + native + free. Skip unless complaint surfaces.
- **xlsx (Excel)** — Numbers/Excel are 30-second OS-level open. Don't compete.
- **Log viewer** — pairs with ENH-082 (Terminal Context Bar) once that ships; defer to Sprint 14+.

---

### ENH-115: Right-click terminal tab → "Reveal in navigator" (focus nav on tab's CWD)

**Status:** 🆕 Filed 2026-05-09 (Sprint 12 P1 — landing alongside image v2 + BUG-108). **Priority:** **Medium** — small QoL bridge between the terminal column and the navigator. The terminal tab already knows its `cwd`; the navigator already knows how to navigate-to a path; today there's no gesture to connect them. **Filed:** 2026-05-09.

**What's wanted.** Right-click any tab in the terminal tab strip → context menu with at least one entry: **"Reveal in navigator"** (working name). Clicking it calls `nav.actions.navigateTo(tab.cwd)` — same code path that `duo reveal` already uses — and surfaces the existing reveal chip so the user sees what just changed.

The pattern matches macOS's "Reveal in Finder" affordance and Duo's existing `nav.onReveal` plumbing — this is the in-app sibling to the CLI's `duo reveal` verb.

**Naming TBD.** Owner explicitly flagged the label as uncertain. Candidates:

- **"Reveal in navigator"** — matches the existing "Reveal in Finder" verb pattern; concise. **Recommended.**
- "Reveal project in navigator" — owner's first instinct; accurate when CWD is a project root, but verbose and "project" is overloaded.
- "Show CWD in navigator" — explicit but jargon-y.
- "Focus navigator here" — readable but doesn't reuse the established "Reveal" verb.

Recommend "Reveal in navigator" for the v1 label; revisit during the smoke walk if it reads wrong in context.

**Affected code (estimated, \~30min).**

- `renderer/components/TabBar.tsx § Tab` — add `onContextMenu` to the tab button. Calls `window.electron.menu.popup({ items: [...], x, y })` with a single entry today, leaving room for additional verbs later (e.g. "Duplicate tab in this CWD", "Close all other tabs").
- `renderer/components/TabBar.tsx § TabBarProps` — add `onRevealCwd?: (cwd: string) => void` callback so the wiring stays in App.tsx.
- `renderer/App.tsx` — wire the prop to `nav.actions.navigateTo(cwd)` + `setRevealChip(cwd)` (mirrors the existing `nav.onReveal` handler at line \~1257).

**No new IPC surface needed** — `window.electron.menu.popup` (BUG-105 / ENH-050) and `nav.actions.navigateTo` already exist.

**Open questions for the smoke walk.**

- Should the menu also offer "Open new terminal here" / "Duplicate tab"? **Defer** — v1 ships the single verb; expand only if the right-click gesture feels under-utilized.
- Should the reveal chip differentiate "from CLI" vs "from terminal context-menu"? **No** — same source-of-truth, same chip.

**Cross-ref:** Pairs with the existing `duo reveal <path>` CLI verb (Stage 10) and the `nav.onReveal` listener at renderer/App.tsx:1257.

---

### ENH-123: `duo devtools` — open the renderer's DevTools from CLI (Sprint 12 walk-rev3 retro)

**Status:** 🆕 Filed 2026-05-09 from same-day retro. **Priority:** Medium — backstop for the 5% of cases where ENH-122's targeted query isn't enough and you need the full DevTools UI (Network tab, full Elements tree, breakpoints). **Filed:** 2026-05-09.

**What's wanted.** `duo devtools` opens DevTools on the main renderer (default). `duo devtools --browser-pane` opens DevTools on the active browser pane's WebContentsView. `duo devtools --close` closes any open DevTools. One-line implementation: `mainWindow.webContents.openDevTools({ mode: 'right' })`.

---

### ENH-124: `duo layout` — structured snapshot of working pane state (Sprint 12 walk-rev3 retro)

**Status:** 🆕 Filed 2026-05-09 from same-day retro. **Priority:** Medium — third missing tool exposed by today's diagnosis. \~20 min wasted on misreading the layout from screenshot pixels: I assumed the working pane was a single full-width slot when it was actually a split view with the image-viewer squished to \~80px wide. A structured layout snapshot would have made this immediately obvious. **Filed:** 2026-05-09.

**What's wanted.** `duo layout` returns JSON describing the WorkingPane's current state:

```json
{
  "split": true,
  "main": { "tab": { "kind": "image", "path": "/tmp/foo.png", "id": "tab-3" }, "width": 80, "height": 540 },
  "aux":  { "tab": { "kind": "editor", "path": "/tmp/note.md", "id": "tab-2" }, "width": 760, "height": 540 },
  "focused": "main",
  "terminal": { "expanded": true, "width": 480 },
  "navigator": { "expanded": true, "width": 220 }
}
```

Reuses existing state via `nav-state` + new IPC for working-pane state. Removes ambiguity about WHAT THE USER IS LOOKING AT — every "is the image viewer the small slot or the big one?" question becomes a 100ms call.

**Cross-ref:** Existing `duo nav-state` covers the FILE TREE. This is the missing parallel for the WORKING PANE.

---

### ENH-120: Copying a markdown range that includes an image should put the image on the clipboard too

**Status:** 🆕 Filed 2026-05-09 from owner OTHER NOTES on Sprint 12 walk-rev4. Owner: "less urgent but still important to note on the image handling section(s) of the roadmap as a known limitation." **Priority:** Low-Medium — known limitation, document for now, schedule for image-handling-cluster sprint. **Filed:** 2026-05-09.

**What's wanted.** When the user selects a range in the markdown editor that includes an image, then ⌘C and pastes into another app (Notes, Mail, Slack, etc.), the image should appear in the destination — not just the surrounding text without it. Today: only the text portion arrives at the destination.

**Why this happens (current state).** The markdown editor uses tiptap-markdown's `transformCopiedText` to serialize the selected slice as markdown text. Markdown text is `![](blob:...)` for v1 paste-image inserts (per FOLLOWUP-014 — abs path is the v2 plan). Even with a real path, the destination app receives PLAIN TEXT — not the image bytes. To put the image bytes on the clipboard alongside, the copy handler needs to ALSO write image data to the clipboard via `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob, 'text/plain': text })])`.

**Scope considerations:**

- Single-image selection (just the image, no surrounding text): straightforward — write image + text to clipboard.
- Multi-image selection: most other apps only accept ONE image per clipboard write. Pick the first? Refuse? Concat into a montage? Document the limitation.
- Mixed text + image: the text portion travels as-is; the image portion converts to image bytes.

**Cross-ref:** ENH-108, FOLLOWUP-014 (relative-path portability), ENH-118 (image-type handling discussion). All belong in the image-handling cluster on the roadmap.

---

### ENH-139: Extend PackManifest schema to support markdown editable / markdown locked / playground (browser-mode) defaults

**Status:** 🟡 **Open / deferred until needed.** Surfaced 2026-05-10 by ENH-138's owner general-comment confirming the v1 PackDefault.kind union (just `'canvas'`) doesn't cover all four content kinds owner asked about. Defer until a real pack default needs markdown OR explicit playground routing. **Priority:** Medium — gates pack-delivered markdown content. Not urgent because today's known FTUX content (`what-duo-does.html`, `beginners-guide.html` likely) is HTML. **Filed:** 2026-05-10.

**What's wanted.** Expand the union from `kind: 'canvas'` to `kind: 'canvas' | 'editor' | 'markdown-preview' | 'browser'` to express:

- `'canvas'` — HTML in canvas mode (editable raw HTML; today's behavior)
- `'editor'` — `.md` file in TipTap rich editor (full editable markdown experience)
- `'markdown-preview'` — `.md` file in read-only preview pane (locked markdown — user reads, doesn't type)
- `'browser'` — explicit playground routing (today implicit via the file's `<meta duo-open-in>` meta — making this explicit at the pack-default level lets a single HTML file be routed differently per pack default if needed)

**Implementation sketch:**

1. `shared/types.ts § PackDefault.kind` — expand the union.
2. `core/pack-loader.ts § validateManifest` — accept the new kinds.
3. `electron/main.ts § first-launch defaults hook` — remove the line 535 `if (def.kind !== 'canvas') continue` filter; route each kind:
   - `'canvas'` → `NAV_EDIT` (current; openFileSmart handles routing)
   - `'editor'` → `NAV_EDIT` (same call; openFileSmart routes `.md` to editor by default)
   - `'markdown-preview'` → some new IPC that forces preview mode (need to add — `openFileSmart` doesn't currently have a "force preview" override; might need a new `mode: 'preview'` argument similar to ENH-097's `mode: 'canvas'`)
   - `'browser'` → `openFileSmart(path, name, 'browser')` (the explicit override path; bypasses the file's own `duo-open-in` meta)
4. Update PackManifest validation tests + smoke-walk fixture packs covering each kind.

**Trigger to land:** when ENH-137 (Beginner's Guide) author chooses markdown OR when a future content pack needs explicit browser-mode default-open without depending on the file's meta hint.

**Cross-ref:** ENH-138 (the principle that surfaced this gap). ENH-137 (the most likely trigger).

---

### ENH-157: Comments in the browser pane — CDP-injected sidecar overlay for `file://` HTML

**Status:** 🆕 Filed Sprint 18 (2026-05-16) as the prioritized follow-up to ENH-156. **Priority:** P1 for Sprint 18 — once ENH-156 ships, the "make artifact + open + comment" outcome only fully closes when comments work on browser-pane HTML. Without this, `duo html comment` on a `duo open`-mounted file requires the caller to first `duo edit` (mode-switch friction). **Filed:** 2026-05-16.

**Origin.** Owner directive during ENH-156 scoping: *"will add comment still work in the duo browser? this is important — we (user and claude) still need to be able to add/view comments to local html in the duo browser."* Verified the gap: `dispatchHtmlComment` in `electron/main.ts:2114` only reaches PageTab (`renderer/components/Page/PageTab.tsx:1724`). BrowserRenderer + browser-manager have NO comment listener. Browser-pane comments don't work today — and never did. ENH-156 makes the gap more visible by moving the HTML default to browser.

**What ships.**

- `duo html comment` + `duo html comments` work on HTML mounted in the browser pane (CDP-injected `file://` URLs).
- Sidecar (`<name>.duo.json`) reads + writes route through main, same shape as canvas-mode sidecar plumbing today.
- Comment anchors (`data-duo-id` resolution) work the same way they do in PageTab — resolved against the live DOM inside the WebContentsView via CDP.
- Visual overlay (the comment dots + thread cards) injected via CDP `Page.addScriptToEvaluateOnNewDocument` + a runtime-injected toolbar — mirrors ENH-094's `playgroundActions` CDP-injection pattern.
- Comments visible across canvas ↔ browser mode flips on the same file (sidecar is the single source of truth; both surfaces read the same `<name>.duo.json`).
- Right-click "Add comment" on a selected element in the browser pane (UI shortcut) — same surface as canvas's selection-pill flow.

**Plumbing surface ([CLAUDE.md](http://CLAUDE.md) § 4).**

- `electron/browser-manager.ts` — CDP injection for the sidecar runtime (mirror `playgroundActions` injection).
- `electron/main.ts` `dispatchHtmlComment` / `dispatchHtmlCommentsList` — route to browser pane when the target `file://` URL matches an active browser tab; fall back to canvas (PageTab) otherwise.
- `renderer/components/BrowserRenderer.tsx` — wire the comment-overlay's data-duo-id resolution + anchor rendering for the browser surface.
- `shared/types.ts` — extend the comment IPC contract if needed.
- `cli/duo.ts` — no CLI changes (existing `duo html comment` / `duo html comments` verbs work as-is; routing change is server-side).
- `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md` — update notes to reflect that comments now work in both surfaces.

**Constraints.**

- `file://` only (per current `duo html comment` scope). Web URLs out of scope.
- Sidecar path resolution from a browser-pane URL: strip `file://` prefix + decodeURI to recover the on-disk path; same shape as `core/socket-server.ts:446-487` already does for the open routing.

**Dependencies.** Lands after ENH-156 (the verb-split exposes the gap and shifts the default surface). Could ship independently, but the user-visible value only materializes once browser is the HTML default.

**Cross-ref.** ENH-156 (the verb-split that makes this load-bearing). ENH-094 (`playgroundActions` CDP injection — the established pattern for browser-pane overlays). The canvas-side comment pipeline in PageTab (`renderer/components/Page/PageTab.tsx:1720-1810`) as the parity reference.

---

### ENH-155: Right-click GitHub menu on FileTree + bounce-list update — "Open on GitHub" + "Copy GitHub URL"

**Status:** 🆕 Filed Sprint 17 (2026-05-13) on branch `claude/github-integration-planning-rPdVY`. Picked by owner as candidate "C+D" in the GitHub-integration cluster AUQ. Independent of ENH-150 (no Doctor / probe dependency). Ships in parallel with ENH-151 / ENH-152 / ENH-154. **Priority:** P2 — small surface, high "feels right" payoff. Half-day to a day. **Filed:** 2026-05-13.

**What ships.**

- **Right-click "Open on GitHub"** on folder rows + file rows in FileTree. Folder → `github.com/<owner>/<repo>/tree/<sha>/<rel-path>`. File → `github.com/<owner>/<repo>/blob/<sha>/<rel-path>` (with `#L<start>-L<end>` if a selection exists in the editor). Uses `shell.openExternal()` so the URL bounces through the system browser (matches [CLAUDE.md](http://CLAUDE.md) SSO requirement).
- **Right-click "Copy GitHub URL"** — same plumbing, writes URL to clipboard via `clipboard.writeText()`.

---

### ENH-154: Link a local folder to a GitHub repo (new or existing) — `duo gh-link` + "Link to GitHub…" modal

**Status:** 🆕 Filed Sprint 17 (2026-05-13). Planning artifact at `docs/research/link-folder-to-repo.html`. 5 owner decisions pending; coding gated on Copy-decisions paste-back. **Priority:** P1 for the GitHub-integration cluster — closes the "folder isn't on GitHub yet" gap. Pairs with ENH-151 (URL → folder direction; this is folder → URL). **Filed:** 2026-05-13.

**Origin.** Owner ask 2026-05-13 during the GitHub-integration scoping AUQ: *"want command to link a local folder to a repo, either new or existing; not sure how this should work…"* → picked "playground it first" for the shape. The 4 use cases the playground enumerates: (U1) brand-new folder never on GitHub, (U2) folder + existing remote URL, (U3) local git repo without remote, (U4) distro pack publishing (crosses ENH-149 gh-auth path).

**Two flows.**

- **Flow A (new repo)** — `git init` → `git add . + commit` → `gh repo create --source=. --push`. Result: folder is now a tracked GitHub repo at `github.com/<owner>/<name>`.
- **Flow B (connect to existing)** — `git init` → `git remote add origin <url>` → `git fetch origin` → conflict gate (remote-empty → push, remote-has-content + local-empty → pull, remote-has-content + local-has-content → confirm per Q2).

**5 open decisions (owner walks playground, paste back):**

- **Q1 · Entry-point shape** — single modal w/ new-vs-existing radio (recommended) / two separate menu items / CLI-first with thin modal wrapper.
- **Q2 · Pre-state risk policy** — warn + confirm (recommended) / block + explain / plow ahead. Covers: already-a-git-repo, already-has-different-remote, has-uncommitted-changes.
- **Q3 · Default visibility for new repos** — private (recommended) / public / no default (force pick).
- **Q4 · Multi-host gh / GHE** — auto from `gh auth status` (recommended) / always [github.com](http://github.com) (defer GHE) / always show picker.
- **Q5 · Post-link behavior** — auto-push + open in system browser (recommended) / auto-push only / link-only (user pushes manually).

**Plumbing surface ([CLAUDE.md](http://CLAUDE.md) § 4, sketch — firms up after decisions).**

- `cli/duo.ts` — `duo gh-link [path]` verb. Flags shape depends on Q1.
- `shared/types.ts` — `DuoCommandName` extension; IPC channel for link operation + pipeline-progress state snapshot.
- `electron/main.ts` — IPC handler spawning gh / git child processes; File menu entry; pipeline-runner with cancel.
- `electron/socket-server.ts` — CLI bridge case.
- `electron/preload.ts` — renderer API for invoke + subscribe-to-progress.
- `renderer/components/LinkRepoModal/` — new modal (form, pipeline preview, progress, success state).
- `renderer/components/FileTree.tsx` — folder right-click "Link to GitHub…".
- `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md` — verb registration.

**Dependencies / cross-refs.**

- **ENH-149** ✅ closed — gh auth probe; established detect→validate→guide→optionally run principle this feature inherits.
- **ENH-150** — integration primitive (Doctor panel). gh-auth-missing case routes to Doctor; this feature consumes ENH-150a's `github` integration entry.
- **ENH-151** — `duo clone`. Shares gh auth probe + bounce-list with this feature; complementary direction.
- **ENH-152** — Navigator status overlay. Root chip immediately reflects linked state after success.
- **ENH-155** — Right-click "Open on GitHub" / "Copy GitHub URL". Lights up on the just-linked folder.

**Why a playground, not a markdown doc** (per [CLAUDE.md](http://CLAUDE.md) § 11). Owner-decision-shaped artifact: 5 decisions × \~3 options + 6 pre-state cells + general comments. Modal mocks live next to the radios that shape them; decisions round-trip via Copy-decisions in one click.

**Affected files (planning artifact only — this entry).** `docs/research/link-folder-to-repo.html` — the playground itself (atelier-styled, opens in browser pane via `duo open <path>`).

**Trigger to close ENH-154.** Owner walks playground on a Mac (personal or work; the decisions don't depend on which), hits Copy decisions, pastes back. Claude synthesizes:

1. Locks the 5 decisions into ENH-154 follow-on entries (or merges into this entry's "Final shape" section).
2. Codes the modal + CLI verb + plumbing on `claude/github-integration-planning-rPdVY`.
3. Smoke-walks alongside ENH-151 / ENH-152 / ENH-155 once the cluster lands.

---

### ENH-153: First-launch Doctor auto-open + status banner pattern (final shape per ENH-150 Q3)

**Status:** 🆕 Sketched — depends on ENH-150 Q3 decision (auto-open / banner / passive). Will firm up after owner walks integration-primitive playground. **Priority:** P1 for FTUX once ENH-150 lands. **Filed:** 2026-05-13 (cross-ref from ENH-150).

**What this is.** The first-launch posture for Duo when one of the active distro pack's `integrations[]` entries probes as `missing` AND is marked `required`. Three shapes on the table per ENH-150's Q3: auto-open the Doctor canvas tab / passive status banner with click-to-open / fully passive (rely on user to find Doctor via menu).

**Cross-ref.** ENH-150 (parent — integration primitive playground).

---

### ENH-152: Navigator git status overlay — root chip + per-file dirty dots (owner-directive: clean stays invisible)

**Status:** ⚠️ v1 Slice 1 shipped 2026-05-16 BUT owner rejected the clean-stays-invisible directive on walk: *"no visual indication that duo/ is root of a github repo in the navigator view (very bad)"*. **v2 design (always-visible repo-root chip + dirty indicator) filed in the GitHub-integration cluster v2 PRD** at `docs/prd/github-integration-cluster-v2.md § 1`. Walk also reported: chip never appeared on dirty repos (likely BUG-125 v2 baseline issue interfering with file-change detection). Slice 2 (per-file dirty dots) → ENH-152b, deferred to Sprint 18. **Priority:** P1 for ambient git visibility — "is this folder a repo?" + "is it clean?" answered without opening terminal. **Filed:** 2026-05-13. Promoted from sketch (was referenced in ENH-149 § cross-refs and ENH-150 cross-ref list). Slice 1 shipped 2026-05-16.

**Slice 1 — Root chip (this entry). ✅ SHIPPED.**

- FileTree root row gets a small chip next to the folder name:
  - **Not a repo** → no chip (current behavior).
  - **Clean + up-to-date with remote** → no chip (owner directive: clean stays invisible).
  - **Dirty** → `main · modified` chip (orange `#c46a1c` accent matching atelier accent).
  - **Diverged from remote** → `main · 2 ahead` / `main · 3 behind` / `main · 2↑ 1↓`.
  - **Detached HEAD** → `(detached) · 3 modified` if dirty, otherwise no chip.
- ✅ **Shipped:** `core/git/status.ts` (Node-side getGitStatus probe) + `formatGitStatusChip` formatter in `shared/host-api.ts` + IPC channel `git:status` (renderer pulls; no main→renderer push in v1) + `renderer/components/FileTree.tsx` chip render + `duo git-status [<path>]` CLI verb.
- ✅ **Refresh story (v1):** poll on cwd change + on window focus. Cheap and correct; fsevents-driven invalidation (`.git/HEAD`, `.git/index`, `.git/refs/remotes/origin/<branch>` throttle 300ms) → ENH-152c.

**Slice 2 — Per-file dirty dots (follow-up entry).** Will file as ENH-152b when slice 1 ships. Same data source (`git status --porcelain=v2`); per-path dot in FileTree row.

**Plumbing surface ([CLAUDE.md](http://CLAUDE.md) § 4).** `core/git/` (new — repo-info reader; shared with ENH-155 URL builder), `electron/main.ts` (fsevents watcher + status reader), `shared/types.ts` (`GitRepoStatus` snapshot type + IPC channel), `electron/preload.ts` (renderer subscribe API), `renderer/components/FileTree.tsx` (chip render), `cli/duo.ts` (`duo git-status [path]` for CLI parity returning the same snapshot JSON), `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md`.

**Independent of ENH-150** — no integration primitive / Doctor dependency. The chip just reads `.git/`; no probe runner involved.

**Cross-ref.** ENH-149 (gh auth playground that surfaced this sketch). ENH-150 (parallel; not gating). ENH-151 (clone — once cloned, the chip immediately shows `main · clean`-less = no chip + branch tracked). ENH-154 (link — after link succeeds, chip reflects the new state). ENH-155 (right-click GitHub menu — both read `git remote` + `git rev-parse`; share `core/git/` helper).

---

### ENH-150: Integration primitive for distro packs — Doctor panel + probe runner + setup-chain walker

**Status:** 🆕 Filed Sprint 17 (2026-05-13). v2 planning artifact at `docs/research/integration-primitive-design.html`. Supersedes the § 5 sketch in ENH-149's playground. **Priority:** P1 for the GitHub-integration thread. Becomes the substrate for **ENH-151** (`duo clone`) and the framework every enterprise distro pack will use to declare gh / brew / Jira / Confluence / etc. integrations. **Filed:** 2026-05-13.

**Origin.** Owner pushback during ENH-149 walk-back: my "Duo never installs" over-correction dropped the dependency-chain pattern (brew → gh) that IS the enterprise install path when the pack maker says so. The refined principle: **detect → validate → guide → optionally run (with explicit consent)**. The framework runs probes; the pack supplies every command Duo executes; switching from "personal Mac" to "enterprise Mac" is a pack swap, not a code change.

**What ships in the framework (Duo main).**

- PACK.json schema gains `integrations: PackIntegration[]` with `id` / `label` / `priority` / `required` / `probe` / `requires` / `setupDoc` / `setupSteps`.
- `SetupStep` discriminated union: `{type:"depends"}` / `{type:"run"}` / `{type:"tell"}`.
- Probe runner — invokes pack-shipped executables, parses stdout JSON `{status, summary, detail, fixHint, version}`, treats non-zero exit / non-JSON as `unreachable`.
- Chain walker — resolves `depends` recursively, orders steps, drives confirm-before-run for `run` steps.
- New `WorkingTab kind: "doctor"` — canvas-rendered Doctor panel with integration list + expanded chain view.
- CLI verbs: `duo doctor --integrations` / `duo doctor inspect <id>` / `duo doctor fix <id>` / `duo doctor open` ([CLAUDE.md](http://CLAUDE.md) § 4 parity).
- IPC channels: `integrations-list` (snapshot), `integration-run-step` (PTY-piped run with cancel).

**What pack builders add (content).**

- Their own `integrations[]` entries in PACK.json.
- Probe scripts at `checkers/<id>.sh` (or wherever the entry's `probe` field points).
- `setupSteps[]` declarations with their org-specific install commands.
- Setup docs (HTML/markdown) the `tell` steps link to.
- Optional `priority` to override another pack's integration entry.

**Open decisions (owner walks playground, paste back):**

- **Q1** — `run` step confirm UX (per-step / bulk preview / pack-author declared per step). Recommended: per-step.
- **Q2** — Override resolution when packs declare same id (explicit `priority` field / last-loaded / explicit `extends` / no-auto-override-error). Recommended: explicit `priority`.
- **Q3** — First-launch posture (auto-open Doctor / status banner / passive). Recommended: auto-open if any `required` integration is missing.
- **Q4** — Probe trust model (sandbox no-net / trust-the-pack / signed-only / user-grants-on-install). Recommended: sandbox no-net + 10s timeout (matches canvas-action precedent).
- Plus general comments / schema-naming pushback.

**Sketched implementation sub-ENHs (filed concrete once decisions lock):**

- **ENH-150a** — Default Duo pack ships `integrations[]` entries for git / brew / github (probes + setupSteps + setup docs).
- **ENH-150b** — Doctor panel UI (canvas-rendered WorkingTab + run-step UI + confirm dialog + chain expanded view).
- **ENH-153** — First-launch Doctor auto-open + status banner pattern (final shape per Q3).

**Cross-ref chain.**

- **ENH-149** (now ✅ closed by this synthesis) — auth probe that surfaced the principle.
- **ENH-151** (sketch) — `duo clone <url>` + `File → Clone…` menu. Depends on ENH-150a's `github` integration entry.
- **ENH-152** (sketch) — Navigator git status overlay. Independent — no integration-primitive dep; ships in parallel.

**Why a playground (not a markdown doc) — [CLAUDE.md](http://CLAUDE.md) § 11.** Owner-decision-shaped artifact with 4 decisions + general comments + UI mockup walk. Mockups grounded in Duo's actual app palette (cream paper + ochre `#C66A2E` accent + 8px status dots + 12–13px row text — same tokens as `renderer/styles/globals.css`). Round-trips via Copy-decisions back to Claude in one click.

---

### ENH-148: Navigator multi-select v2 — ⇧-click range + ⌘-A select-all (deferred from ENH-147 v1)

**Status:** 🆕 Filed Sprint 17 commit 4 (2026-05-11). ENH-147 v1 shipped ⌘-click + multi-row trash; this entry is the deferred v2 work. **Priority:** Medium — completes the standard Finder multi-select pattern. **Filed:** 2026-05-11.

**Scope.**

1. **⇧-click range select.** Extend selection from `primaryPath` (the v1 anchor, set by single-click / ⌘-click) to the shift-clicked row. Requires a design decision: does the range collect ALL rows visible between anchor and click (including across expanded folder boundaries)? Or only siblings inside the same parent? Finder takes the first option; some IDE trees take the second.

   - Affected files: `renderer/hooks/useNavigator.ts` (new `extendSelectionTo(path, kind)` action), `renderer/components/FileTree.tsx § onSingleClickRow` (route on `e.shiftKey`).
   - Implementation sketch: walk the rendered tree (rootEntries + expanded children, dotfile-filtered) collecting paths between anchor index and clicked index. Pass into `selectAllPaths(paths, kinds)`.

2. **⌘-A select-all-visible.** New global shortcut binding scoped to nav-pane focus. Selects every visible row in the current cwd's listing (top-level only, OR including expanded children — owner decision).

   - Affected files: `renderer/keyboard/globalShortcuts.ts` (new `'selectAllInNavigator'` chord), `renderer/hooks/useKeyboardShortcuts.ts` (dispatch), `renderer/components/FileTree.tsx` or `FilesPane.tsx` (listener that calls `actions.selectAllVisible(visiblePaths)`).
   - Safety: cap at "current directory + immediate children" — a tree with thousands of expanded descendants would be a surprise on ⌘-A.

3. **CLI parity** (optional). Extend `NavStateSnapshot` with `selectedPaths: string[]`. Today the CLI's `duo nav-state` returns the singular `selected` field; broadening to a list is forward-compat for agents driving batch deletion via `duo files trash` loops.

**Cross-ref:** ENH-147 (v1 parent — landed 2026-05-11).

---

### BUG-137: Markdown link editing — `[text](url)` not parsed; ⌘K is a no-op

**Status:** 🟡 **Shipped 2026-05-18; v0.7.1 walk-1 FAIL → fixes shipped same-day.** Walk-1 surfaced four sub-issues: (1) link displayed the URL instead of the bracketed text, (2) no hover tooltip showing the URL, (3) ⌘K reported as no-op, (4) owner-added scope: clicking the toolbar link button on an existing link should edit (in-place) instead of being a no-op. Plus a fifth owner ask: collapsible track-changes rail (filed as part of BUG-138 follow-ups). Walk-1 fixes:

- **(1) URL-as-text** — root cause: `markInputRule` picks the LAST capture group as the kept text. My regex captured `[(text), (url)]` → URL was kept. Walk-1 fix: replaced `markInputRule` with a custom `InputRule` whose handler does `tr.replaceWith(range, schema.text(match[1], [linkType.create({ href: match[2] })]))`. Now the matched `[text](url)` becomes just `text` with the link mark.
- **(2) Tooltip** — `@tiptap/extension-link` renders `<a href="…">text</a>` with no title attribute. Walk-1 fix: `.extend({ renderHTML({ HTMLAttributes }) { return ['a', { ...HTMLAttributes, title: HTMLAttributes.href ?? null }, 0] } })` chained onto `Link.configure(...)` so every link gets its href as a native browser tooltip.
- **(3) ⌘K** — handler IS registered + reachable (no other Mod-k binding shadowing it). Walk-1 fix: bumped extension `priority: 1000` so it's first in the keymap dispatch order. Also: `extendMarkRange('link')` before `setLink({href})` so a collapsed-caret-inside-an-existing-link edits the whole span in place rather than partially.
- **(4) Edit existing link via toolbar** — already supported in v1 via `actions.currentLinkHref()` + `extendMarkRange('link')` but reported as broken; the priority bump + extendMarkRange combo from (3) fixes it transitively (the toolbar's `insertLink` callback goes through the same `setLink` path).

**Original entry (pre-walk-1):Status:** ✅ **Shipped 2026-05-18 (post-v0.7.0-cut).**

**Symptom.** Owner: *"link editing in markdown seems broken; is not parsing* `[markdown_link](url)`*, and is ignoring cmd-k kb shortcut."*

Two specific failures:

1. Typing `[text](url)` directly into the markdown editor stays as literal characters — no link mark applied. TipTap's `@tiptap/extension-link` ships `autolink: true` (raw URL → link) and `linkOnPaste: true` (paste a URL onto selected text → link) but NO input rule for the markdown `[text](url)` syntax.
2. ⌘K (toolbar hint reads "Link (⌘K)") was wired to a button onClick, but no keyboard binding registered ⌘K to the same `setLink` flow. The chord was unmapped at every layer (no `globalShortcuts` row, no TipTap `addKeyboardShortcuts` entry on any extension).

**Fix.** New extension at `renderer/components/editor/extensions/MarkdownLinkShortcuts.ts`. No state; just two `addX` hooks:

1. `addInputRules` — `markInputRule({ find: /\[([^\]]+)\]\(([^)]*)\)$/, type: schema.marks.link, getAttributes: (m) => ({ href: m[2] }) })`. Fires when the user types the closing `)`; converts the matched `[text](url)` to text wrapped in a link mark.
2. `addKeyboardShortcuts` — `Mod-k` calls `window.prompt('Link URL', current ?? 'https://')` and routes to `editor.chain().focus().extendMarkRange('link').setLink({ href }).run()`. Empty string → `unsetLink()`. Same code path as the toolbar button's `insertLink` callback.

Wired into `MarkdownEditor.tsx`'s extensions array right after `Link.configure(...)` so the two are paired.

**Editor-canvas parity rule (per [CLAUDE.md](http://CLAUDE.md) § 7).** **(c) Deferred** — canvas-side `[text](url)` parsing + ⌘K wiring queued for Sprint 18. The canvas uses its own DOM-mutation actions path (`canvasEditorActions.ts`), not TipTap, so the same extension shape doesn't apply. Cross-ref: BUG-061 (markdown parsing broken in HTML canvas — sibling parsing-gap class).

**Verification owed.** Real-keystroke test required (synthetic events don't trigger TipTap input rules or keymaps cleanly): (a) type `[example](https://example.com)` in any markdown file → "example" should render as a clickable link, (b) press ⌘K with text selected → prompt should appear, accept URL → selection becomes a link.

---

### BUG-135: Git ribbon (and dependent menu actions) activate for navigator cwd even when cwd is not a repo root

**Status:** 🆕 **Filed 2026-05-18 (post-v0.7.0-cut).** Sprint 18 pull (owner-confirmed 2026-05-18). **Priority:** Medium — alignment fix; ribbon should match per-folder icon's strictness.

**Symptom.** Owner screenshot: navigator at `~/Documents/GitHub/stoop`. Git ribbon at the top reads `⎇ Documents · main · 34 m…` — claims `stoop` is part of the `~/Documents` repo. Right-click context menu items "Open on GitHub" + "Copy GitHub URL" also activate for files inside `stoop`. But `stoop` itself isn't a repo root.

Owner: *"github repo ribbon shows for folder even if folder is not a repo root; so do the context menu actions for that folder and its contents."*

**Owner clarification (2026-05-18 AUQ):** *"this has nothing to do with terminal CWD; when I look at a folder in navigator, it correctly shows no gh logo, but when I click into that folder it shows the ribbon."*

**Root cause — the precise mismatch.** The per-folder `⎇` icon (rendered by `FolderRepoChip` from `childRepoMap`) uses STRICT repo-root detection (`getGitStatus(child).isRepo === true && workTreeRoot === child`) → stoop correctly gets no icon when shown as a row. But the RIBBON uses `gitSnap = window.electron.git.status(state.cwd)`, which climbs up the directory tree until it finds ANY `.git`. When `~/Documents/.git` exists (owner versions Documents), every descendant — including stoop — resolves to "inside the Documents repo." So clicking INTO stoop activates the ribbon claiming Documents, even though the per-folder check correctly said "stoop is not a repo."

**Fix shape — align ribbon to per-folder-icon strictness.** The ribbon should suppress when the gitSnap's `workTreeRoot` is NOT a "natural" ancestor of cwd — defined precisely as:

> **Show ribbon iff** `cwd` **is at-or-inside a repo root, AND the path from** `cwd` **up to that repo root does NOT cross a folder that itself contains 2+ peer-repo children.**

For owner's case: cwd=`stoop`, repo=`~/Documents`. The path crosses `~/Documents/GitHub`, which contains multiple peer-repo children (duo, figma-cli-skill, project-microsite, rollout, session-share, space-jam — all repo roots per the childRepoMap we already compute). So GitHub is clearly a "container folder" and the ribbon must suppress.

For duo project: cwd=`~/Documents/GitHub/duo/electron`, repo=`~/Documents/GitHub/duo`. The path is just `electron → duo`. Duo is the repo root, no peer-repo container crossed → ribbon shows.

**Implementation sketch.**

1. When computing `gitSnap` in `FileTree.tsx`, walk from `state.cwd` up to `gitSnap.workTreeRoot`. At each intermediate level, scan that level's children for peer-repos (we can reuse the existing `scanReposIn` helper from `core/git/scan.ts`).
2. If any intermediate level has ≥2 peer-repo children, treat the ribbon as suppressed (`isInRepo = false` from the ribbon's perspective).
3. Same suppression applies to the per-file dirty dots + the right-click "Open on GitHub" / "Copy GitHub URL" menu items (they all gate on `inGhRepo` / `gitSnap`).
4. Cache the result per cwd — only re-probe on cwd change or window focus (same lifecycle as gitSnap).

**Affected surfaces (all share gitSnap):**

- Git ribbon at top of navigator (`renderer/components/FileTree.tsx § isInRepo + gitSnap.workTreeRoot`).
- Right-click "Open on GitHub" + "Copy GitHub URL" on files/folders inside the cwd's "claimed" repo.
- Per-file dirty dots (ENH-152b) — would highlight every file under stoop as dirty per Documents's git status.

**Cross-ref:** BUG-132 rev2 (peer-repo case — same gitSnap-climbs-wrong-way pattern, different surface).

---

### BUG-130: Browser pane `file://` tabs don't auto-reload when the underlying file is mutated via CLI

**Status:** 🆕 Filed 2026-05-17 (discovered during v0.7.0-rev4 walk of ENH-159 v2 inspect mode). Filed to roadmap as **L2-PLAYGROUND-AUTORELOAD** — architectural, not QOL. **Priority:** **High (architectural).** Owner framing: *"if we are going to use chromium for playground, with the agent mutating the playground, refreshing needs to be automated, or we need to use something other than chromium for playgrounds.*"**Filed:** 2026-05-17. **Roadmap entry:** `docs/roadmap.html § L2-PLAYGROUND-AUTORELOAD`.

**Symptom.** Owner during ENH-159 v2 inspect walk: *"in the 2nd or third step, where you add a button to the html canvas via cli, the button did not immediately appear — user had to manually hit refresh."*

**Root cause.** Browser-pane tabs showing `file://` URLs use Chromium's normal page-load lifecycle. Chromium does NOT auto-reload `file://` pages when the underlying file changes on disk (this is by design — file:// is treated like any HTTP URL). When the agent mutates the file via `duo write` / `duo html append` / a shell `printf` / etc., the browser pane keeps showing the stale version until the user hits ⌘R or right-click → Reload.

Compare with **canvas mode** (kind: 'page'): canvas mounts a contentEditable iframe with srcdoc, AND the renderer's file-watcher hooks the FOLLOWUP-019/BUG-125-v2 reconciliation path that auto-reloads on external write. Browser mode has no equivalent.

**Affected flows.**

- Walk-rev4 ENH-159 v2 step 2: `duo open /tmp/test.html` → modify file via CLI → browser tab stays stale.
- Any agent workflow: "the user is looking at this page in the browser pane, I'll edit the file" → user sees no change.
- ENH-156 `duo open` is now the agent's default surface for HTML files — this gap matters more after that change.

**Suggested fix.**

1. **Browser-pane file-watcher.** When the active browser tab's URL is `file://...`, register a chokidar watcher (reuse `electron/files-service.ts`) on the file path. On change → `webContents.reload()` for that tab.
2. **Lifecycle.** Watch starts on tab activation (or on tab nav to a `file://` URL). Stops on tab close or nav to a non-`file://` URL.
3. **Debounce.** Same 250ms debounce as the existing file-watchers to avoid thrashing on rapid writes (e.g. an agent running multi-line `duo html append` in a loop).
4. **Echo-guard.** If Duo itself mutated the file (via `duo html *` ops), the page should reload — that's the point. No echo-guard needed.
5. **Optional polish.** Subtle visual "↻ reloading" hint in the tab strip during the reload window, so the user knows the change came in.

**Estimate:** 0.5 dev day. Mirrors the canvas-mode file-watcher pattern (PageTab's external-write reconciliation) but simpler — no dirty-buffer to reconcile.

**Cross-ref.**

- ENH-156 (`duo open` → browser mode default for HTML) — makes this gap more visible.
- FOLLOWUP-019 / BUG-125 v2 — canvas-mode external-write reconciliation that the browser pane currently lacks.
- BUG-107 / BUG-085 — markdown editor's external-write reconciliation.

---

### BUG-128: `docs/research/integration-primitive-design.html` playground renders blank

**Status:** 🟡 Filed 2026-05-16 (discovered during v0.7.0 walk). **Post-walk investigation 2026-05-16: NOT REPRODUCING** in current session. **Priority:** Medium — blocks ENH-150 owner decisions. Without the playground rendering, the 4 decisions can't be walked. **Filed:** 2026-05-16.

**Symptom.** Owner during v0.7.0 walk: *"playground is actual blank page"*. `duo open docs/research/integration-primitive-design.html` lands in the browser pane (per ENH-156 default), but the page itself shows no content.

**Investigation 2026-05-16 (post-walk).** Reproduced via `duo open` + `duo edit` in dev session against the same file. Browser pane: page renders with 66 body children, 13745px scroll height, 27838 chars visible text, header element present, atelier-styled body (paper bg #fbf8f1, dark ink #2b2620), display:block + opacity:1 + visibility:visible. Canvas pane: identical render via canvas iframe (scripts blocked per ENH-156 verb-routing, but page CSS + DOM still load). **The page is not blank.**

**Hypotheses for the walk-time blank state (owner verification needed before fix):**

1. Stale tab — owner had a previously-opened tab pointing at an empty or different file; the active surface didn't actually load the playground.
2. Iframe load race — first canvas-mount of an HTML file with file:// + large `<style>` block may have transient empty-frame state before the body paints.
3. Inspect-mode interference — ENH-159 inspect mode was being walked in the same session; a freeze-frame from inspect might have left a stale screenshot up.
4. Scroll-position — page is 13745px tall; if the viewport happened to be at a region of `display:none` decision-card content, owner might have read "blank" where it was "below-fold whitespace."

**Next step.** Owner re-opens the playground in a fresh dev session and confirms — if blank repeats, capture `duo dom 'body' --js '(...)'` snapshot before reporting. If renders fine, close as no-repro.

---

### ENH-145: Obsidian-parity research — PRD of "truly full-featured Obsidian client" + delta inventory

**Status:** 🆕 Filed 2026-05-11 from idle-thoughts Notion sweep. **Priority:** Low-Medium — research request, not a build directive. Owner: *"we will likely not build it all, but I still want to know.*"**Filed:** 2026-05-11.

**Owner ask (verbatim):** *"research on current deltas of obsidian vault functionality in duo vs native obsidian editor; eg what things should duo do with the actual vault file? PRD truly full featured Obsidian client, indicate what we have built and tested; we will likely not build it all, but I still want to know"*

**What's owed.** A research playground (`docs/research/obsidian-parity.html` per [CLAUDE.md](http://CLAUDE.md) § 11 — HTML interactive playground, not markdown) inventorying:

1. **What native Obsidian does with vault files** — categorized by domain (wikilinks, embeds, tags, frontmatter, dataview queries, daily notes, canvas files, plugins, hot-reload, vault config, sync, mobile).
2. **What Duo has built** — cross-reference ENH-096 family (Tier A + B subsets shipped through Sprint 9-11), ENH-114 (cmd+click create), ENH-109 (`.obsidian/` visibility), ENH-105 (`@` mention).
3. **What Duo has tested vs untested** — explicit gap analysis.
4. **What we'd skip vs what's tractable** — owner picks per-area what's worth pursuing.

**Format per [CLAUDE.md](http://CLAUDE.md) § 11.** Interactive HTML playground in `docs/research/`. Atelier styling. Inline `.decision-card` blocks where owner can decide "pursue / skip / defer" per domain. Sticky `.copy-bar` footer with structured decisions payload for Copy-decisions-back round-trip.

**Filed as a tracked review task** per the `feedback_research_reports_must_file_review_task.md` memory rule. This entry surfaces in every smoke walk until owner closes the gate via Copy-decisions.

**Cross-ref.** ENH-096 (Obsidian-vault-friendly editor — parent feature, Tier-A+B-subset shipped). `docs/prd/obsidian-vault-research.md` (existing research doc — may need refresh or migration to HTML playground format).

---

### ENH-143: Keyboard shortcut to close the current tab (separate from delete-file)

**Status:** ⚠️ **Shipped Sprint 17 commit 5 (2026-05-11) + walk-FAIL 2026-05-16.** Owner walked v0.7.0: explanation exists in entry 55b BUT *"still references tollowup 020"* placeholder text. Tiny content fix owed — the FOLLOWUP-020 placeholder text in `packs/duo-default/canvases/what-duo-does.html` still hasn't been fully scrubbed (a separate instance must exist somewhere; the entry 55b line itself was updated in [ce7d85d](https://github.com/dudgeon/duo/commit/ce7d85d) but owner's grep apparently caught another). **Also: BUG-126 filed during this walk** — `⌘F` search in canvas mode stops narrowing after first character. Resolution: ⌘W (close tab, no fs change) + ⌘⇧⌫ (delete file + close tab) already cover the use cases owner asked about; the bar was just to make them discoverable. Original 3 chord-conflict hypotheses (close vs delete-file vs close-tab-history) collapsed to "the existing chords were just hard to find." Sprint-17 instinct: ship the discoverability touch without a new chord; if owner finds a missing case, re-open with new scope.

**What v1 delivers:**

- **New entry 55b in** `packs/duo-default/canvases/what-duo-does.html` — "Close the active tab with ⌘W" article, placed adjacent to entry 56's existing "Delete the active file with ⌘⇧⌫". The two chord-pair entries now sit side-by-side in the Workspace setup category. The body covers the universal-macOS framing, the no-confirm-by-default rule, the pinned-tab confirm-modal exception, and the explicit pairing with ⌘⇧⌫.
- **CLI parity gap surfaced** → FOLLOWUP-020 filed. The new entry initially referenced `duo close-tab` for working-pane tabs; that verb doesn't exist. Updated the entry to reference only `duo close <n>` (browser tabs) and leave a placeholder pointing at FOLLOWUP-020 for the working / terminal close-active-tab CLI parity work.

**What was considered and skipped:**

- **New chord** (`⌘⌥W`, `⌘⇧W`, etc.) — owner's "requires confirmation" phrasing suggested a NEW close-with-confirm chord, but ⌘⇧⌫ already provides destructive-confirm semantics (file → Trash) and ⌘W's silent close is the universal expectation. No third chord is warranted; the gap was discoverability.
- **Right-click context-menu surfacing** — tab right-click menus already include a "Close" item that fires the same action as ⌘W (via WorkingTabStrip and TabBar menu builders). The chord IS visible in the menu accelerator label. No further surfacing needed; the canvas entry is the discoverable docs.
- **Cheat-sheet help menu** — Duo doesn't ship a unified keyboard shortcut help surface today. The what-duo-does canvas IS the cheat-sheet (categorized, searchable via `data-keys`). Building a separate help-menu surface would be a bigger refactor; skipped.

**Pack-version bump deferred to next cut.** PACK.json is still at 1.0.2 (cut for v0.6.15). The next cut bumps it per the cut-version skill Step 4 (ENH-138 — pack-version-bump fires the per-user banner via installed-packs.json).

**Owner observation (verbatim):** *"ENH — kb shortcut to delete current tab, requires confirmation; candidates cmd-shift-delete, cmd-opt-delete"*

**Priority:** Medium — chord-set polish. **Filed:** 2026-05-11. **Shipped:** 2026-05-11.

**Owner observation (verbatim):** *"ENH — kb shortcut to delete current tab, requires confirmation; candidates cmd-shift-delete, cmd-opt-delete"*

**Ambiguity to resolve (owner sign-off needed before code work).**

Both candidate chords (`⌘⇧⌫`, `⌘⌥⌫`) overlap with adjacent functionality:

- `⌘⇧⌫` is already used by ENH-102 (shipped Sprint 9) for "delete the FILE backing the current tab" (with confirm). That's not "close the tab" — that's `fs.unlink(path)` + close the tab as side-effect.
- `⌘W` is the universal macOS "close tab" chord; Duo already uses it (ENH-037 — `⌘W` closes the focused tab, never the parent window).

Owner's "delete current tab" phrasing might mean:

1. **Close the tab** (no fs change; just dismiss from the strip). Already done via `⌘W`. Would adding a new chord be redundant?
2. **Delete the file** (the ENH-102 case; already shipped).
3. **Close + remove from tab history** (no current mechanism; would be new).

**Recommendation.** Treat as no-op for now (existing `⌘W` covers close-tab; existing `⌘⇧⌫` covers delete-file). Surface to owner: "is this a request for a NEW capability beyond what `⌘W` + `⌘⇧⌫` already provide, or is it a request to make those discoverable?" If the answer is the discoverability angle, the fix is in the menu / cheat-sheet / context-menu surface rather than a new chord.

**Cross-ref.** ENH-102 (delete-current-file ⌘⇧⌫ — shipped Sprint 9). ENH-037 (⌘W closes focused tab — shipped). ENH-100 (lock/unlock context menu — same surface).

---

### ENH-137: Beginner's Guide to Duo — owner-authored draft + Claude polish + ship as content

**Status:** 🟡 **Open / awaiting owner draft.** Owner directive 2026-05-10 (paraphrased from ENH-134 review): *"we do need a more useful beginners guide to duo; add as a task for me to write the initial version and for you to augment, package for distribution.*"**Priority:** High — the in-app FAQ is being removed (ENH-135); the welcome banner + first-launch experience needs a friendlier on-ramp than just "click Install." **Filed:** 2026-05-10.

**What's wanted.** A beginner's guide to Duo aimed at the primary persona (PMs and other non-engineering knowledge workers). Probably explains:

- What Duo IS (the workspace + agent pair model)
- The first 30 seconds (Install banner → click Install → terminal tab → `claude` → ask it about something on your screen)
- The three-column layout (files / terminal / right-pane polymorphic tabs) and what each is for
- The flagship Google Docs read/edit success test
- Where to go from here (link to in-app help / GitHub Issues)

**Two open AUQs:**

1. **Q1 — content surface.** Should it be:

   - **(a)** A new file in `help/` (e.g. `help/beginners-guide.html`) — direct replacement for the FAQ
   - **(b)** A new lesson pack at `packs/beginners-guide/` (auto-opens on first launch via PackLoader)
   - **(c)** Both — pack for the first-launch open + help/ file for the always-on Help-menu surface
   - Owner-recommended option per ENH-134 review surfaces: probably **(b)** ("perhaps the new beginners guide should ship as a pack?"). But (c) hedges if discoverability matters.

2. **Q2 — process.** Owner writes draft v1; Claude polishes, formats per Atelier voice, paginates if needed, builds the pack/help-file artifact. Each iteration is owner-reviewed.

**Owner action:** write a draft (any format — markdown, prose dump, even a transcript of an explanation). File at `~/.claude/duo/beginners-guide-draft.md` or paste back to a Claude session.

**Claude action (after owner draft lands):** polish the draft, render as HTML matching the Atelier styling (`help/` aesthetic), pick the surface per Q1, ship in the appropriate location, update install-service if needed (e.g., add to default pins.json if (c) is picked).

**Cross-ref:** ENH-138 (the default-pack mechanism this content lives in once both lands). ENH-135 (FAQ removal — creates the discoverability gap this fills). ENH-134 (planning playground that surfaced this).

**Pack-shape clarification (added 2026-05-10 after owner principle discussion):** with ENH-138's "FTUX content → packs" boundary, the surface decision (Q1 in the original ENH-137 filing — pack vs help file vs both) collapses to *"the pack IS the surface."* The Beginner's Guide content lives at `packs/duo-default/canvases/beginners-guide.html` once both ENHs land. ENH-137's remaining work: owner-authored draft + Claude polish + paste into the pack canvas.

---

### ENH-130: Agent-built-artifact auto-reveal + default playground chrome

**Status:** 🆕 Filed 2026-05-10 from owner directive (Sprint 14 expansion). **Priority:** **High** — workflow-defining. When the agent says "I made you X", the user shouldn't have to hunt for it. **Filed:** 2026-05-10.

**Owner directive (verbatim):** *"when user says 'make me a playground/html file/markdown doc that does x', even if canvas pane is collapsed, default behavior should be for duo, when complete, to expand the canvas, open the work product in the main pane (browser tab if playground) and bring focus to it. By default, playgrounds should include a 'send to Claude' and copy results/output button. Pull in work to enable this and encode the behavior."*

**Two parts:**

**Part A — Agent reveal verb / flag.** When the agent creates an artifact for the user (via `duo edit` for markdown, `duo open` for HTML/playground, `duo edit --canvas` for HTML in canvas mode), Duo should:

1. Check if the working pane is collapsed (terminal at full width / `splitPct >= 75`). If yes, expand it (e.g. `duo split even` → 50).
2. Open the file in the main pane (existing `duo edit` / `duo open` behavior).
3. Focus the pane (existing `duo focus-pane main`).

**Implementation (chosen): new** `--reveal` **flag on** `duo edit` **and** `duo open`**.** Back-compat (default false). Skill mandates `--reveal` when creating artifacts for the user. Server-side: a `revealAfterAction` helper in main.ts that runs the layout check + setSplit + focusPane sequence when the flag is present.

**Part B — Playground default chrome.** Every new playground (HTML file with `<meta name="duo-open-in" content="browser">`) created via `duo html new --playground` (or scaffolded by the agent following [make-playground.md](http://make-playground.md)) defaults to including:

- **"Send to Claude" button** — uses `data-duo-action="terminal:send"` to push selected text / output / a default payload back to the agent.
- **"Copy output" button** — uses `navigator.clipboard.writeText` (or the worksheet primitive's pattern) to hand the user a structured payload they can paste back to the agent.

**Implementation (chosen): update** `skill/make-playground.md` **+ canvas templates** to require both buttons in the boilerplate. Update `skill/examples/canvas-templates/playground.html` (or equivalent) to include the chrome.

**Cross-refs.** ENH-122 (`duo dom`) + ENH-124 (`duo layout`) — used by the agent to inspect state before/after `--reveal`. ENH-098 (`duo focus-pane`) — the focus mechanism. ENH-014 (`duo split`) — the expand mechanism.

---

### FOLLOWUP-025: File → Clone… modal (renderer-side, paired with ENH-151's CLI)

**Status:** ⚠️ v1 Shipped 2026-05-16 BUT walk-FAIL 2026-05-16 — three issues. **v2 PRD filed** at `docs/prd/followup-025-clone-modal-v2.md`: (1) CSS rendering bug — `bg-black/40` backdrop bleeds through modal body (owner attached screenshot); (2) defaults to `~/Documents` instead of current Navigator cwd; (3) chord-only entry (⌘⇧K) unacceptable per owner — needs File menu "Clone GitHub Repo…" + right-click Navigator "Clone GitHub repo here…" entry points. **Priority:** P2 — the CLI is the spec for v1; the modal is a discoverability + non-agent-user affordance. **Filed:** 2026-05-16. **Shipped:** 2026-05-16.

**Today.** ENH-151's CLI shipped (`duo clone <url> [<path>]`, `duo gh-auth`). The renderer-side IPC handlers + preload exposures (`window.electron.git.clone`, `window.electron.git.ghAuth`) are already wired — pure-UI follow-up.

**What to ship.**

1. `renderer/components/CloneModal/CloneModal.tsx` — minimal modal with URL input + target-path input (defaults derived from URL) + Clone button + auth-missing banner.
2. File → "Clone…" menu entry in `electron/main.ts` (native macOS menu) + IPC channel for the menu→renderer push.
3. Keyboard shortcut entry in `renderer/keyboard/globalShortcuts.ts` — propose `⌘⇧K` (free today).
4. Auth-missing UX: until ENH-150's Doctor panel lands, modal shows "Run `gh auth login` in a Duo terminal, then re-open this dialog." After Doctor lands, swap the pointer to open Doctor at the GitHub-integration row.

**Cross-ref.** ENH-151 (parent — CLI shipped). ENH-150 (Doctor panel — modal points there when it ships).

---

### FOLLOWUP-021: `duo install --clean` — strip old fence markers + retire dead Stage-20 shim path

**Status:** 🆕 Filed 2026-05-16 (scoped out of ENH-156 to keep blast radius minimal). **Priority:** Low — gated on whether self-heal alone is enough; revisit if reports surface where users see stale `~/.local/bin/duo` symlinks or vestigial `# Duo CLI` fences in `~/.zshrc` causing confusion. **Filed:** 2026-05-16.

**Today.** ENH-156's boot-time self-heal makes SHIM_DIR/duo correct on every Duo launch, but leaves prior install artifacts in place:

- Old-style `# Duo CLI` fences in `~/.zshrc` (the pre-ENH-141 marker style; the current `addToShellPath` writes a different `# >>> duo PATH >>>` marker and doesn't recognize the old one).
- Stale `~/.local/bin/duo` symlinks pointing into versioned dev-checkout directories (e.g. `Documents/duo-main-0_6_13/cli/duo`) that no longer exist or are wrong.
- Dead `~/.claude/bin/duo` from the retired Stage-20 install path.

These don't break Duo (SHIM_DIR/duo is the load-bearing path and self-heals), but they're noise that confuses subsequent diagnosis attempts (the screenshot's other Claude session was misled by exactly this kind of vestigial state).

**What to ship.** A new `duo install --clean` flag that:

1. Strips known-old fence markers from the user's shell rc (`# Duo CLI`, any other documented vintages). Preserves anything else.
2. Removes `~/.claude/bin/duo` (the dead Stage-20 path) if it exists.
3. Validates `~/.local/bin/duo` actually points at a current binary; if symlink target is non-existent or a versioned-dev-checkout path, removes it.
4. Reports what was cleaned + what was left alone.

Opt-in, never auto-cleans on boot — users may have manual customizations and we don't want to strip without consent.

**Cross-ref:** ENH-156 (boot-time self-heal; this is its opt-in cleanup companion). docs/DECISIONS.md → "Boot-time self-healing CLI shim" "Trade-offs accepted" section.

---

### BUG-102: Split view goes blank while ⌘⇧A tab-search palette is open

**Status:** 🟡 Open (filed during smoke walk v0.6.8-rev3, 2026-05-06). Owner: *"non urgent.*"**Priority:** **Low** — small visual annoyance. The user opens the palette over a split-view layout, the aux pane goes blank for the duration, the user picks a tab + dismisses, the aux pane returns. No data lost; just a UI flash that competes with the user's mental model of the palette as a transient overlay. **Filed:** 2026-05-06 (Smoke walk v0.6.8-rev3 ENH-080-MULTI-PANE PASS notes — *"split view goes blank when search is active; this is a small annoyance and I want to fix in a future sprint -- non urgent"*).

**Symptom.** With split view active, press ⌘⇧A. The palette opens (correct), but the aux pane's WCV blanks instead of compositing behind the palette. When the palette dismisses, the aux pane's WCV restores.

**Root cause (educated guess from the ENH-080 walk-1 fix path).** The walk-1 fix wired `setOverlayMuted(true)` on palette-open and extended the helper to also mute the aux WCV (`tabs[auxTabId].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })`). Mute = WCV shrunk to 1×1, leaving the renderer's overlay free to composite. But "blanking" the aux pane during a palette-open is too aggressive: the user can SEE the palette body anyway (the overlay is correctly above the WCV), so the aux mute isn't needed for the no-occlusion case. We mute the aux WCV but the aux PANE BACKGROUND inside the renderer still renders — the user sees the renderer's empty placeholder area where the WCV used to be.

**Fix candidates (deferred):**

1. **Don't mute the aux WCV during palette overlay** — only mute the main WCV (the one most likely to occlude). If aux ends up occluding (depends on layout), revisit case-by-case.
2. **Render a snapshot of the aux WCV behind the palette** while muted — visually preserves the layout but adds complexity.
3. **Resize the aux pane's renderer placeholder to fill the slot** — keep the aux pane visually present (just with a brief flash).

**Sprint 9 investigation (2026-05-07).** Confirmed root cause via code reading: `setOverlayMuted(true)` in browser-manager.ts:801 shrinks BOTH the main WCV and the aux WCV (when present) to 1×1 to prevent WCV-over-overlay compositing. This is correct for the main WCV (palette body is centered, sits over main). It's over-aggressive for the aux WCV in typical layouts: the palette body (`max-w-2xl` \~672px, centered) sits in the screen's center; the aux pane is on the right. Backdrop (`bg-black/30 fixed inset-0`) covers everywhere but is 30% transparent — an un-muted aux WCV would composite over the backdrop, dimming aux content but keeping it visible (the desired UX). HOWEVER: in narrow-split layouts (\~1280px window with 50/50 split), the palette body overlaps the aux bounds by \~200px, so the un-muted aux WCV would occlude the palette body (regression).

**Recommended fix when this gets prioritized.** Compute the palette body's runtime bounding box (renderer-side known, can be IPC'd to main) and pass it to `setOverlayMuted` as an optional argument. Mute aux only if its bounds intersect the palette body's bounds. Mute main unconditionally (palette always sits over main). Falls back to current behavior when bounds aren't passed. Estimated half-day work; needs careful smoke against varying split-view widths.

(1) is cheapest. Worth checking whether the original BUG-058 context-menu use case ALSO blanked the aux WCV — if so, this is a pre-existing behavior the palette inherited, and (1) might regress that. Defer the choice to walk + repro time.

**Naming note.** Owner asked: should the tab-search palette have a proper user-facing name beyond "⌘⇧A"? Current docs call it "tab-search palette" / "tab search". Possible: "Quick Switcher" (Obsidian/VS Code parity), "Go to Tab" (more verbose), "⌘⇧A palette" (chord-named). Defer naming decision until next user-docs pass.

**Cross-ref:** ENH-080 (the palette itself); BUG-058 (the original setOverlayMuted use case for context menus).

---

### BUG-100: Send → Duo pill missing on text selections inside the split-view (aux) browser pane

**Status:** 🟡 Open (Sprint 11 evaluated 2026-05-07; deferred). Owner originally flagged "non blocking, add to backlog" v0.6.8; Sprint 11 architectural assessment confirms cost: a CdpBridge multi-attach refactor (\~3–4 hours of careful debugger plumbing) is the right shape for this. The bridge today holds a single `wc: WebContents` field; attaching to a second tab requires either (a) a parallel `auxWc` slot with mirrored Runtime.addBinding setup + a separate session-events listener (option 1 below), (b) a tab-id-keyed Map of bridges (option 2 — cleaner architecture but more code), or (c) executeJavaScript-based one-shot injection without CDP bindings (option 3 — sidesteps the binding plumbing; selection data has to round-trip via window CustomEvent + IPC instead). Owner pull pending — deferred to a future sprint when the workflow surfaces. Workaround: promote the aux browser tab back to main (⌘⇧/) before selecting. **Priority:** **Medium** — affects users who park a reference page in the split-view + select text from it for chat. Workaround: promote the aux browser tab back to main (⌘⇧/) before selecting. **Filed:** 2026-05-06 (Smoke walk v0.6.8 step 5 — *"opened claude session: pill DOES appear for selected text in main pane, but not in split view"*).

**Symptom.** With at least one Claude tab live in the terminal pane and a browser tab pinned to the split-view (aux), selecting text inside the aux pane's WebContentsView does NOT render the in-page Send → Duo pill. Selection in the MAIN browser pane behaves correctly under the same conditions.

**Hypothesis (untested).** The Send→Duo pill is rendered via CDP injection into the active browser tab's webContents (`cdp-bridge.ts § showPillFor`). The CDP connection is attached to `tabs[activeIndex]` only. Aux tabs have a separate webContents that the CDP bridge has no awareness of — any `selectionchange` events fired by the aux pane's WebContentsView don't reach the pill code. Fix candidates:

1. Attach a parallel CDP bridge to the aux webContents when one is pinned, mirroring the main bridge's selection→pill flow.
2. Hoist the CDP bridge to be tab-id-keyed (one bridge per webContents) and attach on aux pin / detach on aux clear.
3. Forward selectionchange via a minimal `before-input-event`-style preload script in the aux pane only.

(2) is the cleanest but the heaviest refactor. (1) is the most localized; (3) sidesteps CDP entirely. Defer the choice until the bug is prioritized.

**Cross-ref:** Stage 15.3 Send → Duo pill (origin); Sprint 7 Phase 3c (aux browser pinning).

---

### ENH-082: Terminal Context Bar — collapsible UI surface below terminal tabs for job + docs + skills shared between user and agent

**Status:** 🆕 Filed · **research-doc owed before code (medium-sized feature)**. **Priority:** Medium-High (closes a real coordination gap between user and agent — today neither can express "what is THIS terminal focused on?" except via in-band conversation; a structured surface would make terminal context inspectable, persistent, and clickable). **Filed:** 2026-05-03 (owner ask — flagged "want to think hard about this one").

**Owner ask (verbatim):** *"a terminal context bar: a collapsable ui element below the terminal tabs, where both user and duo can indicate the job that a given terminal is focused, the documents it is working with (with links to focus them in canvas), skills being used, etc -- will want to think hard about this one"*

**Problem this closes.** Today, terminal context is invisible:

- The user has multiple terminals (one per task) and forgets which is which after an hour. Tab titles are just `claude · <basename>` or `shell · <cwd>` — no semantic info.
- The agent in a given terminal has working memory about the current job, files in scope, skills in use — but none of that is surfaced to the user.
- When the user moves between terminals or comes back after lunch, they have to ask the agent "what was I doing here?" — a recurring re-orientation tax.
- Files the agent has been editing in this terminal don't have a linked surface; the user can't click to focus them in canvas without remembering paths.

**What's wanted (v1 sketch):**

A collapsible UI element rendered below the terminal tab strip (above the active terminal pane). Per-terminal-tab; collapsed by default; click the strip to expand. Shows:

1. **Job statement** — one-line plain text describing what this terminal is focused on. Both user-editable (text input) and agent-writable (`duo terminal job <text>` or canvas-action `terminal:set-job`). e.g. "v0.6.5 markdown CommentRail (MISSING-001)" or "writing this week's stakeholder update."
2. **Documents in scope** — list of file paths the terminal is working with. Each path is a clickable link that focuses it in the canvas (via `sendEdit` / `openFileSmart`). Both user-editable (right-click "Add to terminal context" on file/tab) and agent-writable (`duo terminal docs add <path>`). Auto-population candidates: files the agent has read or written via `duo` verbs in this terminal session.
3. **Skills in use** — list of Claude Code skill names active in this terminal session (from `~/.claude/skills/` discovery). Possibly auto-populated from skill-discovery output; user can pin / unpin.
4. **(Optional v2) Recent activity** — last 5 `duo` verbs invoked from this terminal (read from `duo events` ring buffer scoped to `DUO_SESSION`). Read-only; mostly for the agent to summarize "what did we just do here?"

Bar visual:

- Collapsed = a thin (\~24px) strip with a chevron + the job statement (truncated). Click anywhere on it to expand.
- Expanded = \~120-180px tall section with three sub-sections (Job / Docs / Skills), each with inline-edit affordances + an agent-emit indicator (a small clawd glyph next to fields the agent recently wrote, fading like the just-added wash on edits).
- Theme: same Atelier paper-cream / ochre palette; serif italic for the job statement (matches the active-tab serif).

**Architecture sketch (research doc finalizes):**

- **State location:** per-terminal-tab metadata, persisted in `~/.claude/duo/session-state.json` alongside the terminal's `cwd` + `kind` (extend `SessionStateTerminal` shape — additive field, same pattern as Phase 3c-i `aux`).

- **Per-tab state shape:**

  ```ts
  interface TerminalContext {
    job: string                  // user/agent-writable one-liner
    docs: { path: string; addedBy: 'user' | 'agent' }[]
    skills: string[]             // skill names; reserved for v2 auto-discovery
    expanded: boolean            // collapsed/expanded UI state
    recentEdits?: { field: 'job' | 'docs' | 'skills'; ts: number; author: 'user' | 'agent' }[]
                                 // for the just-added wash (max 10)
  }
  ```

- **CLI surface (new verbs, full plumbing checklist per [CLAUDE.md](http://CLAUDE.md) § 4):**

  - `duo terminal job [<text>]` — read or set the active terminal's job statement.
  - `duo terminal docs [add|remove|list] [<path>]` — manage the docs list.
  - `duo terminal skills [add|remove|list] [<name>]` — manage the skills list (v2 may auto-populate from skill discovery).
  - `duo terminal expand|collapse` — UI state.
  - `duo terminal context [--json]` — read everything for the active terminal.
  - All scoped by `DUO_SESSION` env so verbs run from inside a terminal target THAT terminal automatically; `--terminal <id>` flag for cross-terminal writes from outside (rare).

- **Skill update:** new entry in `skill/SKILL.md` documenting the convention — agents should set the job statement at session start and update the docs list as they touch files. Eventually this becomes part of the priming flow (Stage 19b).

- **UI components:** new `renderer/components/TerminalContextBar.tsx` that consumes per-tab context state from `useTerminalContext` hook (mirror of `useNavigator` shape).

**Edge cases the research doc should resolve:**

1. **Initial state.** When a new terminal spawns, what's the default? Probably empty context, collapsed. But if the spawn was via `duo new-tab --claude --cmd "work on X"`, can the spawn pre-populate the job statement?
2. **Multi-tab ↔ single context.** What if the same skill or doc is referenced from multiple terminals? Probably each terminal has its own list (terminal-scoped); a separate "global" context surface (Stage 22's "Project Claude Context" panel) is the global view.
3. **Doc click → canvas focus.** Clicking a doc link should focus it via `sendEdit` (markdown → editor; HTML → canvas; etc.) but should NOT clear the user's current canvas selection or scroll position. Pattern reuses ENH-039's path-link click flow.
4. **Agent-write rate limiting.** If the agent updates the docs list on every file touch, the bar churns visually. Recommend: debounce the agent-write side; only flash the just-added wash on first-write-in-N-seconds.
5. **Persistence vs. ephemerality.** Should the context survive across launches (like other session state)? Probably yes — the user wants to come back and remember what they were doing. But should it persist across `duo doctor` clean restart? Probably yes (it's user data, not transient state).
6. **Privacy / sensitivity.** If the agent writes free-text job statements, what guardrails prevent it from accidentally writing user-private text into a context bar that gets stored on disk? Probably none needed (the user IS the audience), but worth a sentence in the research doc.
7. **Discoverability.** First-time users won't know the bar exists if it's collapsed by default. Pattern: expanded by default for the first terminal of a fresh install (FTUX); collapsed by default after that.

**Required before code: research doc** at `docs/prd/terminal-context-bar-research.html` (mirror of `canvas-split-view-research.html`'s structure) covering:

- The seven edge cases above
- Visual mockups (Atelier-styled, paper-cream + ochre, two states — collapsed + expanded)
- Per-state prop contracts and IPC channel shape
- CLI verb signatures + plumbing-checklist file list
- A locked decision on default-collapsed vs. default-expanded for FTUX
- Sequencing / phase plan (probably 17a/17b style — first the data plane + CLI + persistence, then the UI surface, then the agent-side conventions)

**Why this matters strategically.** Today Duo's user-agent-pair surface is rich on the canvas side (Stage 17 family) and rich on the navigator side (Stage 22's "Your Claude settings" + "Project Claude context"). The terminal is the third leg of the pair surface and currently has zero structured shared context. Closing this gap makes the terminal a first-class participant: the user can SEE what the agent is working on, the agent can SAY what it's working on, and both can drop into the same docs in canvas with one click.

**Sequencing:** medium-sized feature. Doesn't gate anything in v0.6.5 directly. Reasonable home is post-MISSING-001 (markdown CommentRail) once Stage 14a closes — the markdown editor's annotation work is conceptually adjacent (both are "structured shared surface for user-agent communication"). Owner-driven priority, not architectural.

**Cross-ref:** Stage 22 (Your Claude settings + Project Claude context — global-scope shared context, this is its terminal-scope sibling); Stage 19b (priming — terminal context bar's job statement is a natural fit for the priming text); ENH-013 (Send → Duo enabled-only-when-active-Claude — uses the same per-terminal Claude-presence signal that this bar's "is the agent live?" affordance would use); Stage 27 canvas-action verbs (`terminal:focus`, `terminal:send` — same plumbing layer the new `terminal:set-job` etc. would extend).

---

### FOLLOWUP-006: Increase the autosave delay (or add a "test mode" knob) so the dirty-replace dialog can be smoke-tested

**Status:** ⏳ Open (low-priority test-tooling improvement). **Filed:** 2026-05-03 (owner v0.6.4 smoke walk skipped Phase 3c-iii because saves are too fast).

**Owner observation (verbatim):** *"saving is too fast to test; please make a todo for a separate session (this is not urgent) to increase autosave delay to allow testing"*

**Today:** the canvas / markdown editor autosave debounce is \~800ms (`MarkdownEditor` and `CanvasTab`). When the smoke-walker types a few chars to dirty the buffer and immediately tries to swap split content, the autosave has already fired and the buffer is clean again — Phase 3c-iii's dirty-replace dialog never appears because the dirty signal cleared.

**What's wanted:** a deterministic way to keep a buffer dirty for the smoke walk window (a few seconds), so the dirty-replace flow can be exercised.

**Options:**

1. **Test-mode env var** — `DUO_AUTOSAVE_DELAY_MS=10000` env override (read by main.ts at boot, passed to renderer via `additionalArguments`). Production unchanged at 800ms; test runs bump to 10s.
2. **Per-buffer debounce knob via duo CLI** — `duo dev autosave-delay <ms>` agent-tunable runtime setting, persisted in localStorage. Useful beyond smoke walks (e.g. agents wanting to make multi-file edits without intermediate saves churning the disk).
3. **A "no-autosave" mode for smoke walks** — explicitly disable autosave; user has to ⌘S to save. Cleaner test isolation but riskier (forgetting to re-enable could surface as a v0.6.5 user-side regression).

**Recommended:** option (2) — `duo dev autosave-delay [<ms>]` (read or set). The `dev` namespace is for agent / tester ergonomics; production users never reach for it. v1: localStorage'd globally. Touches the new-CLI-verb plumbing checklist.

**Cross-ref:** Phase 3c-iii (the smoke walk skip that filed this); BUG-033 (autosave races with `duo doc-write` / `duo html *` mid-edit — same autosave-timing-is-relevant family).

---

### FOLLOWUP-007: Wire `window.duoSendResult(text, opts)` CDP binding so worksheet "Send to Claude" lands in the active terminal directly

**Status:** 🆕 Filed **Filed:** 2026-05-03 (sprint-plan worksheet spike — primitive ships with the contract; binding plumbing comes next).

**What's needed.** The new `worksheet` skill (`.claude/skills/worksheet/`) generates pages with a "Send to Claude" footer button alongside "Copy results." The button calls `window.duoSendResult(text, { worksheet: NAME })` and falls back to clipboard.writeText when the binding isn't present. Today, every Duo build is in the fallback state — the binding doesn't exist. Worksheets work via copy-paste, but the high-leverage Send-to-Claude path is unwired.

**The contract worksheets commit to:**

```javascript
window.duoSendResult(text: string, opts?: { worksheet: string })
// Resolves when the text has been delivered to the active Claude terminal.
// Rejects if no Claude session is active (worksheet falls back to clipboard).
```

**Plumbing checklist** (touches [CLAUDE.md](http://CLAUDE.md) item 4 plumbing rules):

1. `electron/cdp-bridge.ts` — new `DUO_SEND_RESULT_FORWARDER_IIFE` injected alongside the existing `PATH_LINK_FORWARDER_IIFE`. Exposes `window.duoSendResult` as a `Runtime.bindingCalled`-routed function. Page-side wrapper marshals `(text, opts)` → JSON, returns a Promise.
2. `electron/main.ts` — `cdpBridge.onSendResult(text, opts)` handler. Resolves: find the active Claude terminal tab (the same `claude-presence` signal `cdp-bridge.ts § showPillFor` already reads); if none, reject. If yes, call `terminalPane.sendText(activeClaudeTabId, text)` (or extend `socket-server.ts § terminal-send` if a new path is cleaner) and resolve.
3. `electron/socket-server.ts` — likely no change; the binding routes through main, not the CLI socket. But if we want a CLI parity verb (`duo worksheet send-result`), this is where the case lands.
4. `shared/types.ts` — minor: extend the IPC channel set if main needs to push a "delivered" signal back to the renderer for visualization (probably not v1).
5. `cli/duo.ts` — no new verb required v1; the binding is page-side, not CLI-side. Could add `duo worksheet send-result --text <...>` if we want symmetry. Defer until a use case demands it.
6. **No** `skill/SKILL.md` **change needed** — the existing Worksheets section already documents the contract and notes the fallback.
7. **Smoke-walk regression** — once shipped, the Send-to-Claude button on the next smoke walk worksheet should land directly in the Claude terminal. That's the validation.

**Open question — should we also send a confirmation event back**?The page-side Promise resolves when `duoSendResult` returns. We could additionally fire a `duo:event` with `{ name: 'worksheet-sent', payload: { worksheet, text_length } }` for any agent listening with `duo events --follow`. Worth doing if we expect agent-side smoke walk auto-driving (Stage 28 lesson harness already follows this pattern).

**Why this is a follow-up rather than a blocker.** The worksheet primitive is shippable today via copy-paste; the Send button just provides a smoother path when the binding lands. Filing as 🆕 so it surfaces in the next sprint plan.

**Cross-ref:** ENH-039 (`duoOpenPath` / `duoOpenPathSplit` CDP binding — the parallel path); Stage 27 canvas-action vocabulary (`terminal:send` action verb is the same plumbing target on the canvas-pane side). The worksheet's HTML lives in the BROWSER pane, so the canvas-action verbs don't apply directly — this binding is a new injection target.

---

### FOLLOWUP-013: BUG-093 clean-repro investigation (right-click → Move to Split View renderer crash)

**Status:** 🟡 **Sprint 16 attempt: could not reproduce via CLI; carry forward to v0.6.16.** 2026-05-11 — fired `⌘/` (splitViewToggle chord) via synthetic KeyboardEvent dispatched to document; full instrumentation trace fired correctly (`[BUG-093] ENTRY → beginning swap → COMMITTED`) with no ErrorBoundary trigger, no React error overlay, no renderer crash. Tried variants: canvas with pre-seeded bullets + comment thread, fresh-via-`duo html new` canvas (mid-injection), dirty-buffer + sidecar-dirty swap. None crashed. The original v0.6.7 rev3 repro was user-typed bullets + a comment; my CLI synthesis can't fully simulate the dynamic typing state (autosave debouncer pending mid-keystroke, MutationObserver firing on user input, etc.). Instrumentation remains in place; the next user-triggered crash will leave the forensic trace the task entry's "fix path" depends on. **Priority:** **High** — BUG-093 fires from a real user gesture and crashes the WorkingPane. **Filed:** 2026-05-06. **Re-attempted:** 2026-05-11.

**What this follow-up does.** v0.6.7 shipped instrumentation around `splitViewMoveTabByPath` + an inline `ErrorBoundary` around `<WorkingPane>`. The crash hasn't been re-observed since the rev3 walk that surfaced it. This follow-up drives the clean-repro:

1. Open Duo dev with devtools console visible, filtered on `[BUG-093]` and `[ErrorBoundary:WorkingPane]`.
2. Reproduce the rev3 shape: fresh canvas → type bullets → add a comment on one bullet → right-click the canvas tab → "Move to Split View."
3. If it crashes: capture the last `[BUG-093]` line (names the swap phase that was running) + the `[ErrorBoundary:WorkingPane]` error message + component stack. The combination usually names the bug.
4. If it refuses to reproduce: try variants — multi-bullet canvas with multiple comments, mid-typing dirty buffer, swap-direction (canvas → split when split is empty vs occupied), the BUG-098 trash interaction.

**Code-side analysis already recorded** (see [BUG-093 entry](#BUG-093) for the three structural-issues audit + three deferred fix candidates). Don't ship a code change without a clean trace.

**Cross-ref:** BUG-093 (the bug being investigated), BUG-092 (companion — even when the move succeeds, scripts don't run in the canvas iframe), BUG-091 (the over-broad lift that gated the original surface).

---

### ENH-091: Place caret at end of body (after existing content) when opening a freshly-created canvas

**Status:** 🟡 **DEFERRED indefinitely per owner directive (Sprint 9 walk-2, 2026-05-07).** Walk-2 traces showed every `[ENH-091 seed] APPLIED` was followed by `[ENH-091 wire-exit] {startContainerName: 'P', startOffset: 0, ...}` AND `[ENH-091 seed] post-rAF check {stillInSeededP: true, ...}` — meaning the seed sticks across the next animation frame. But typing still landed in the H1 title, not the empty &lt;p&gt;. So the override fires AFTER rAF (after Chromium's internal layout pass) — unfixable without a different architectural approach (e.g. handling the first keystroke ourselves and re-routing it; or rebuilding the canvas DOM so there's no H1-first-focusable surface).

Owner directive (walk-2): *"this is a low priority bug and we should not revisit for a LONG time unless the console provides a smoking gun and obvious fix; please remove from this sprint."* Done — instrumentation stays in code (cheap to keep, helps a future investigator), [tasks.md](http://tasks.md) status flipped to deferred, no further sprint-9 work. Recommend: pick this up only when a Chromium update changes layout timing OR when someone has an architectural-rewrite proposal.

**Walk history (kept for reference):**

1. Walk-0 (v0.6.8): added `seedCaretInEmptyParagraph` helper; smoke showed caret moved from "offset 0 of body" to "end of title" — partial regression.
2. Walk-1 (Sprint 9): rebuilt detector to handle the `<br>` placeholder; added 12 vitest fixtures + diagnostic traces. Walk-1 owner: "no console output" — `console.debug` was hidden by DevTools default filter.
3. Walk-2 (Sprint 9 walk-1 fix): flipped traces to `console.log`; corrected manifest verb to `duo html new`. Walk-2 traces showed seed APPLIES + sticks across rAF, but override still wins — Chromium-internals timing.
4. Sprint 9 walk-2 outcome: deferred per owner directive.

**Verification owed when owner returns.** Open Duo's renderer DevTools, create a fresh canvas (`duo edit --canvas /tmp/foo.html` against a non-existent path — the renderer creates boilerplate). Type a single character. Read the console for the three trace lines. The output pinpoints the override.

**Attempt 1 (e203b7c, walk-1).** New `seedCaretInEmptyParagraph` helper at renderer/components/Page/caretSeed.ts called from RenderedPage.tsx's `wire()` after `body.focus()` fires. Detection: `<main>` or `<body>` root has `<h1>` first + single trailing empty `<p>` + no content between. On match, repositions caret inside the empty `<p>`. 11 vitest fixtures green. Walk-1: caret moved from offset-0-of-body to end-of-title (a regression, not a fix).

**Attempt 2 (4f9f60c, walk-1 rev2).** Hypothesized Chromium auto-inserts `<br>` placeholder into empty contentEditable blocks → detector bailed because `<br>` is ELEMENT_NODE not TEXT_NODE. Fix: detector now accepts a single `<br>` child as the "empty" marker; switched range creation to `setStart(<p>, 0)` to sidestep Chromium's "round to nearest text position" behavior. 12 vitest fixtures (was 11). Walk-rev3: same symptom as walk-1 — caret on title line. Fix didn't help.

**What's left to investigate.** The seedCaretInEmptyParagraph helper has correct unit-test coverage (12 fixtures pin the seed/no-op boundary in jsdom) but doesn't successfully reposition the caret in the live iframe. Hypotheses for next sprint:

- **iframe focus race.** `body.focus()` runs synchronously, then seed runs, but Chromium's contentEditable focus logic may schedule a microtask that overrides our manual selection back to "first focusable text" (= start of H1).
- **Selection isn't applied in time.** The seed runs inside the iframe's window, but the iframe may not yet have the OS-level focus chain Chromium needs to apply `getSelection().addRange()`.
- **Detector firing on the wrong frame.** wire() fires on iframe load; maybe `doc.body` doesn't yet match the boilerplate when the seeder runs.
- **A different code path is overriding.** Perhaps the "auto-stamp IDs" pass or some other wire() step moves the cursor after we set it.

**Recommended next-sprint approach.** Add `console.debug('[ENH-091]', { detected, sel: doc.getSelection()?.toString(), focusNode: doc.getSelection()?.focusNode?.nodeName })` at the top of seedCaretInEmptyParagraph and at `wire()` exit. Reproduce live. The actual position the cursor ends up in (vs. where the seed sets it) will name the override. **Priority:** Low (small QOL, not a blocker; current behavior is "caret at offset 0 of body" which sits BEFORE the boilerplate `<h1>` heading). **Filed:** 2026-05-04.

**Owner observation (verbatim):** *"when I* `duo html new /tmp/p5-v4.html`*, in the resulting html canvas, the cursor is at the beginning of the empty doc; it would be nice if it was at the end"*

**Owner constraint:** *"I don't want you to design anything too rube goldberg to accomplish this, but it is an ENH I want you to file."*

**What's wanted.** When a new canvas opens (via `duo html new` OR ⌘N save-as `.html`), place the caret AT THE END of the existing body content — typically inside the empty `<p>` after the boilerplate's `<h1>title</h1>`. Today the caret lands at offset 0 of body, which puts it BEFORE the `<h1>` — typing immediately would prepend characters to the title, not start the body.

**Why this is QOL, not a paper cut.** The user can click into the empty `<p>` after the heading and start typing — same gesture they'd do anyway. But auto-placing the caret in the right spot is one less click on the most common new-canvas flow.

**Implementation sketch (keep it simple per owner direction).**

The caret-placement code likely lives in `renderer/components/Page/PageTab.tsx` or `renderer/components/Page/RenderedPage.tsx` — wherever the iframe gets its initial focus on first load. Look for where the iframe body's contentEditable is set and the first selection is established.

The cleanest implementation: detect "fresh canvas" (e.g., `data-duo-just-created` attribute set by the new-file commit handler, or the existing first-mount check) and on the iframe ready event, find the LAST block-level child of `<main>` (or `<body>` if no main) and place the caret at offset 0 of its content (or end if it has content).

For the boilerplate `<h1>title</h1><p></p>`, the last block is the empty `<p>`. Caret at offset 0 of that `<p>` = inside the empty paragraph below the heading. ✓

**Affected files (estimated):**

- `renderer/components/Page/PageTab.tsx` — likely where initial focus is wired (handleReady hook).
- `renderer/components/Page/RenderedPage.tsx` — possibly the iframe load handler.
- `shared/html-boilerplate.ts` — could optionally stamp a `data-duo-just-created` attr on the empty `<p>` for clean detection (or use position-based logic).

**Out of scope:** existing canvases (where the user opens a previously-saved .html) — they get whatever the prior saved cursor state was, OR offset 0 of body if no saved state. This ENH is specifically about the *fresh* canvas path.

**Cross-ref:** BUG-070 (cursor-doesn't-land-on-fresh-canvas — different bug, fixed v0.6.4 via about:blank guard; that fix made the caret LAND, this ENH refines WHERE it lands). `shared/html-boilerplate.ts` (the boilerplate shape this design assumes).

---

### ENH-096: Obsidian-vault-friendly editor (wikilinks + vault quick switcher + sidecar convention)

**Status:** 🟡 **PARTIAL — Sprint 9 walk-1 surfaced second root cause; walk-1 fix landed.** Tier A + B1 wikilink rendering shipped in v0.6.8; cmd+click click-handler fix landed in Sprint 9 walk-0; vault-root walker fix landed in Sprint 9 walk-1. Awaiting walk-2 verification. B2 + B4 still deferred.

**Sprint 9 walk-1 user-verified failure 2026-05-07.** Owner ran the smoke walk; cmd+click was still no-op. Owner-provided console log (`/Users/geoffreydudgeon/Downloads/localhost-1778149539006.log`) showed the click handler IS firing AND the dispatch IS reaching the App.tsx listener — every cmd+click logged `[ENH-096] No vault root found; cannot resolve wikilink: <name>`. So the walk-0 click-handler fix was correct + working; the bug surfaced was downstream in `findVaultRoot`.

**Sprint 9 walk-1 fix (2026-05-07).** `findVaultRoot` was using `window.electron.files.exists` to detect `.obsidian/`. But `filesService.exists` is documented (BUG-039 semantic — used by session-restore to drop tabs whose FILES were deleted) to return true ONLY for regular files. `.obsidian/` is a DIRECTORY → exists returned false → walker climbed past every real vault root and reported "no vault." The pre-fix comment in App.tsx even said "exists returns true for either file or directory presence" — that assumption was wrong; the implementation strictly checks `st.isFile()`. Fix: added a sibling `filesService.dirExists(absPath)` (returns `st.isDirectory()`) + IPC channel `FILES_DIR_EXISTS` + preload bridge + host-api type. Switched `findVaultRoot` to call `dirExists` instead. Total plumbing: `electron/files-service.ts § dirExists`, `shared/types.ts § IPC.FILES_DIR_EXISTS`, `electron/main.ts § FILES_DIR_EXISTS handler`, `electron/preload.ts § files.dirExists`, `shared/host-api.ts § dirExists type`, `renderer/App.tsx § findVaultRoot`. Existing exists() left strictly file-only (BUG-039 semantic preserved).

**Sprint 9 walk-0 fix (2026-05-07, summary).** Click-handler fix — extracted `resolveWikilinkTargetAtClick` helper handling text-node targets via parentElement + pos-based decoration fallback. 7 vitest fixtures green. Owner walk-1 confirmed click handler now reaches the resolver.

**🔴 SPRINT 9 P0 — Owner directive at v0.6.8 cut (2026-05-06):** *"wikilinks is urgent for next sprint as we only have half a feature and it could confuse users."* Visual decoration without working navigation is a confusing half-state — the link styling implies clickable behavior that doesn't fire. Sprint 9 must close B1 to a fully-working state OR strip the decoration entirely (revert to plain `[[…]]` text) to avoid the false affordance.

**Verification owed (UI smoke).** Open a markdown file with `[[…]]` wikilinks inside an `.obsidian/`-marked folder. Cmd+click a wikilink. Expected: target file opens. Test vault available at `/tmp/wikilink-diag/test-vault/Index.md` (auto-generated during the Sprint 9 diagnostic).

**Walk-1 fix (66f9b09).** Hypothesized root cause was case-sensitive resolver — `'other-note' === 'Other Note'` → false → silent no-op. Added `normalizeWikilinkName(name)` helper (lowercase + `-`/`_`/whitespace → single space, more forgiving than Obsidian itself). Applied on both sides of the BFS comparison. 8 vitest fixtures green. **Walk-rev3 verdict:** symptom unchanged. The resolver fix didn't help — meaning the click handler isn't reaching the resolver at all. The dispatched `duo-wikilink-open` window event is either not firing or App.tsx's listener isn't picking it up.

**What's left to investigate.** WikilinkDecorations.ts § handleClick is supposed to fire on cmd/ctrl+click on a span with `[data-duo-wikilink-target]`. Hypotheses for next sprint:

- **ProseMirror plugin order — another handleClick claims first.** TipTap's Link extension (`openOnClick: false` is set) shouldn't claim. But there are many extensions in MarkdownEditor.tsx; one of them may return `true` from handleClick before WikilinkDecorations gets a turn.
- `event.target.closest()` **returns null.** If the click target is a text node (not the styled span), `closest` returns null → handler bails. Try walking up via `event.target.parentElement?.closest(...)` or use ProseMirror's `pos` parameter to look up the decoration directly.
- **Decoration class isn't on the rendered DOM.** Verify with DevTools: is the `<span class="duo-wikilink" data-duo-wikilink-target="...">` actually present around the wikilink text in the live editor?
- **window event isn't reaching App.tsx listener.** Add `console.debug('[ENH-096 click]', wikilinkTarget)` at dispatch + `console.debug('[ENH-096 receive]', e.detail)` at the App.tsx handler. The first one tells us the click handler fires; the second tells us the event reaches the listener.

**Recommended next-sprint approach.** Add the two `console.debug` lines, walk in DevTools, see which trace fires (or doesn't). 30-second diagnosis. The visual decoration renders fine (steps 1-2 PASSED in both walks); the issue is purely the click→navigation path.

**Original (pre-walk-1) fix description follows.**

- **A1 — sidecar convention doc.** Two new entries in help/faq.html § Working with files: "Can I open my Obsidian vault in Duo?" + "What are the .duo.json files next to my notes?" Covers what works, what doesn't, and the `*.duo.json` gitignore recommendation for git-tracked vaults.
- **A4 —** `.obsidian/` **watcher ignore.** files-service.ts § watch chokidar config now ignores `.obsidian/`, `.git/`, and `node_modules/` at the watcher level. Pre-emptive against Obsidian's frequent `workspace.json` writes if a user manually expands the navigator's hidden-files toggle. (`.obsidian/` was already hidden from the navigator by Stage 10's dotfile filter.)
- **A5 — wikilink no-op verify.** tiptap-markdown's default config (`html: false`, `breaks: false`, no Wikilink mark in StarterKit) round-trips `[[…]]` literals verbatim through save. Confirmed by inspection — the WikilinkDecorations plugin (B1) is purely a render-time decoration and never mutates the source.
- **B1 — wikilink rendering + cmd+click resolution.** New renderer/components/editor/extensions/WikilinkDecorations.ts ProseMirror plugin scans the doc on every transaction for `[[Page Name]]` patterns and decorates each match with `class="duo-wikilink"` + a `data-duo-wikilink-target` attribute. Atelier-styled (accent-soft tinted background, accent-ink text). cmd/ctrl+click fires `duo-wikilink-open` window CustomEvent. App.tsx resolver walks up from the active file's directory until it finds an `.obsidian/` (vault root, depth-cap 16), then BFS-searches the vault for the target file (name-first, dotdir-skipping, scan-cap 2000 entries). Path-bearing targets (e.g. `[[subdir/Page]]`) try `<root>/<target>.md` / `<root>/<target>` / `<root>/<target>.html` literal forms first. Plain click stays cursor-placement so source-edit isn't blocked.

**Sprint 11 — B2 + B4 + ENH-105 SHIPPED (2026-05-08, after walks 1-3):**

- **B.2 wikilink autocomplete** ✅ — `@tiptap/suggestion` + `@tiptap/extension-mention` deps + new `WikilinkSuggestion` extension with custom `findWikilinkMatch` (rejects mid-`[[Foo]]` text near caret). Custom popover lifecycle with `dismissed` flag for clean Enter dismissal. Verified live walk-3.
- **B.4 vault quick switcher (⌘O)** ✅ — `VaultQuickSwitcher` overlay sourcing the same vault index. Walk-3 fix added `keyboard.reclaimFocus()` after pick so the new tab actually receives keyboard focus.
- **ENH-105** `@` **mention** ✅ — parallel `AtMention` extension with `findAtMentionMatch` (rejects mid-word `@` for email-address protection). Inserts canonical `[[wikilink]]` form so vault round-trip is unified.
- **Shared substrate**: `vaultIndex.ts` (useVaultIndex hook + scoreVaultFile + rankVaultFiles, 12 unit tests), `SuggestionPopover` primitive, `suggestionMatchers.ts` (17 unit tests).

**Original deferred list (now shipped):**

- **~~B2 — wikilink autocomplete on~~** `[[`**~~.~~**\~\~ Needs a popup overlay coordinated with TipTap's input handler — substantively more work than the decoration plugin. Filed as a future scope item under the same ENH-096 entry. **~~Recommended approach (Sprint 10 research, 2026-05-07):~~** use TipTap's first-party\~\~ `@tiptap/suggestion` ~~utility (the same primitive that backs the~~ `Mention` ~~extension) rather than hand-building the popover. Pairs with B4 + ENH-105 (~~`@` ~~autocomplete) on the same shared primitive. NPM-published, actively maintained — way better than the~~ `aarkue/tiptap-wikilink-extension` ~~GitHub repo (7 commits, no npm publish, no Obsidian-vault-aware features).~~ **Shipped Sprint 11.**
- **~~B4 —~~** `⌘O` **~~vault quick switcher.~~**\~\~ Logic shape is well-understood (TabSearchPalette UI + a vault-walking source). Defer until B2 lands so they can share the popup primitive. Owner can manually navigate via the existing FileTree until then. \~\~**~~Note:~~** ~~B4 is closer to a renderer-level overlay than a TipTap suggestion (it's not text-position-anchored), so it shares the FUZZY MATCH source with B2 + ENH-105 but has its own UI shell (resembling ENH-080's~~ `⌘⇧A` ~~palette).~~ **Shipped Sprint 11.**
- **A3 —** `@testing-library/react` **infra + frontmatter round-trip fixtures.** Defer alongside FOLLOWUP-009's existing deferral note — the infra cost doesn't earn its keep until there's a concrete async-orchestration test the smoke walk can't cover.

**Library / framework research (Sprint 10, 2026-05-07).** Three candidate approaches for raising Obsidian fidelity were evaluated:

1. `aarkue/tiptap-wikilink-extension` — TipTap-native but stagnant (7 commits, no npm publish, no Obsidian-vault-aware resolution). NOT a worthwhile dependency.
2. `erykwalder/lezer-markdown-obsidian` — high-fidelity Obsidian-flavored markdown PARSER, but for `@lezer/markdown` (CodeMirror 6's parser stack). Adopting requires migrating the editor framework from TipTap → CodeMirror 6. Not a small change.
3. **Stay with TipTap, lean on first-party** `@tiptap/suggestion` **for autocomplete features.** Recommended path. Hand-rolled wikilink rendering already shipped (B1 — see WikilinkDecorations.ts). The remaining Obsidian work is composable with TipTap primitives: callouts → custom Mark/Node, tag pills → Decoration plugin, math → KaTeX integration via existing CodeBlockLowlight pattern, mermaid → similar.

**Architectural note.** Obsidian itself uses CodeMirror 6 — every Obsidian editor primitive lives in the CodeMirror ecosystem. If Duo ever needs Obsidian-grade editing fidelity (e.g. live-preview of complex markdown trees, deep plugin compatibility), the architecturally honest answer is to migrate the editor surface. That's a multi-sprint shift; today's hand-rolled TipTap path is the right pragmatic call. Revisit if user research surfaces "I tried Duo for my vault and the editor feels weird compared to Obsidian" as a recurring complaint.

**Owner-locked design calls (resolved per AUQ on 2026-05-06):**

1. Vault root detection: walk up from active file's directory until `.obsidian/` is found (cap 16 levels). Fall back to no-op if no ancestor matches.
2. Wikilink resolution: name-first, vault-wide BFS. First-match wins on basename (without extension).
3. Sidecar location: same-folder. Documented in faq.html with `*.duo.json` gitignore guidance.
4. `⌘O` policy: deferred to B4. Existing chord behavior unchanged.

**Priority:** Medium. **Filed:** 2026-05-06. **Priority:** Medium — opens Duo to the Obsidian audience (a non-trivial slice of would-be Duo users maintain markdown vaults in Obsidian today). Defensive baseline (Tier A) is XS effort and prevents trust erosion; rendering-layer affordances (Tier B subset) ship the most-noticed gaps. **Filed:** 2026-05-06.

**Background.** Research doc at `docs/prd/obsidian-vault-research.md`. The basic round-trip already works thanks to Stage 11 frontmatter pass-through, BUG-085 external-write reconciliation, and dotfile-hidden navigator. What breaks is the visual + invocation layer: wikilinks render as plain text, no vault-wide quick switcher, sidecars accumulate next to notes without user-facing documentation.

**Scope (Sprint 8 phase boundary):**

- **Tier A — defensive baseline.**
  - **A1** Sidecar convention doc — faq.html + what-duo-does.html addition explaining `<note>.md.duo.json` sidecars; recommend `*.duo.json` in `.gitignore` for git-tracked vaults.
  - **A3** Frontmatter round-trip vitest fixtures for Obsidian-style YAML (`tags: [...]`, `aliases: [...]`, `cssclasses: [...]`, custom properties); folds into FOLLOWUP-009's `@testing-library/react` infra.
  - **A4** File watcher ignore rule for `.obsidian/` (separate from navigator hide).
  - **A5** Wikilink no-op verification — confirm tiptap-markdown round-trips `[[…]]` cleanly; smoke walk item.
- **Tier B subset — distinctive Obsidian features.**
  - **B1** Wikilink rendering — custom TipTap node/mark recognizing `[[Page Name]]`, rendered as Atelier-styled clickable inline span; `cmd+click` opens the linked file from the resolved vault root.
  - **B2** Wikilink autocomplete on `[[` — fuzzy-search vault notes; Tab/Enter to insert; Esc dismisses. Shares a base palette implementation with ENH-080 + B4.
  - **B4** Vault quick switcher (`⌘O`) — fuzzy file search across the entire vault root; distinct from ENH-080's open-tab search; shares the palette base.

**Deferred to follow-up (filed separately if/when sprint scope warrants):**

- Tier B3 (inline tag rendering as clickable pills)
- Tier B5 (full-text vault search panel `⌘⇧F`)
- Tier C — backlinks panel, outline panel, daily notes shortcut, callout TipTap extension, properties panel (Stage 11 D15 already filed), math (KaTeX), mermaid
- Tier D — graph view, `.canvas` file support, reading-mode toggle, embed rendering, block references, plugin compatibility, theme compatibility (these are out of scope or indefinitely deferred)

**Pairs naturally with already-in-sprint:**

- ENH-080 (tab-search palette): same fuzzy-palette primitive; B2 + B4 reuse the base.
- FOLLOWUP-009 (testing-library/react infra): A3 fixtures land in the new test directory.
- Stage 21d (distro packs): an "obsidian-companion" distro pack (future sprint) ships Obsidian-tuned skills + canvas templates leveraging the editor affordances landing here.

**Open questions surfaced in the research doc (to settle before code):**

1. Vault root detection — walk up to `.obsidian/`? Use navigator CWD? Persisted "this is a vault root" mark?
2. Obsidian's "shortest path when possible" wikilink resolution — match it (name-first across vault, ambiguity warning) or use relative-path resolution?
3. Sidecar location for vaults — same folder as note (current) or centralized under `.obsidian/duo-comments/`?
4. Hotkey conflict policy — Obsidian's `⌘O` is the most likely contention; Duo's `⌘O` could be repurposed for vault quick switcher when a vault is detected.

**Acceptance (the smoke-walkable shape):**

1. Open an Obsidian vault folder via Duo's navigator.
2. Click any `.md` note — frontmatter intact (verified by save + reload).
3. `[[Other Note]]` wikilinks render as styled clickable spans; `cmd+click` opens the linked note in a new tab.
4. Typing `[[` opens autocomplete; Enter inserts.
5. `⌘O` opens vault-wide quick switcher; type to filter; Enter opens.
6. `.obsidian/` invisible in navigator (already-shipped).
7. Edit + save in Duo. Switch to Obsidian. Obsidian sees the changes. No frontmatter loss.
8. Smoke walk green; FOLLOWUP-009 tests cover frontmatter round-trip.

**Cross-ref:** `docs/prd/obsidian-vault-research.md` for the full surface map.

---

### ENH-094: Inject the playground runtime into browser-pane pages via CDP

**Status:** 🆕 Filed (Sprint 4 close-out 2026-05-04 — playground architecture decomposition). **Priority:** High (third leg of the ENH-043 meta-initiative — without this, playground primitives stay canvas-tab-only). **Filed:** 2026-05-04.

**Problem.** The playground action runtime (`installPlaygroundActions(doc, opts)`) lives in the canvas iframe's `contentDocument` — it doesn't reach browser-pane pages. Smoke walks (and any worksheet that needs `<script>` execution privileges Chromium grants browser tabs but not canvas iframes) are hosted in browser tabs, so they can't access the playground vocabulary today. With ENH-092 + ENH-093 the verbs exist; this ENH puts them in scope for browser-pane pages.

**Mechanism.** Mirror the proven pattern of CDP-injected page-side runtimes:

- `SELECTION_OBSERVER_IIFE` (Send → Duo pill, Stage 15.2 — already shipped)
- `PATH_LINK_FORWARDER_IIFE` (`data-duo-path` clicks, ENH-039 — already shipped)
- `BROWSER_SEND_TO_DUO_BINDING` (Send → Duo pill click, BUG-006 v2 — already shipped)

New: `PLAYGROUND_RUNTIME_IIFE` injected on every CDP attach + on `Page.frameNavigated`. The IIFE installs the same delegated-click listener for `data-action="*"` that `installPlaygroundActions` does in the canvas runtime, and routes actions through a `Runtime.binding` (`duoPlaygroundAction(actionPayload)`) back to main, where `BrowserManager` forwards to the renderer over `IPC.PLAYGROUND_ACTION`. Renderer dispatches via `onPlaygroundAction` (the existing handler). Identical contract to the canvas-side runtime; only the delivery channel differs.

**Affected files (estimated):**

- `electron/cdp-bridge.ts` — new `PLAYGROUND_RUNTIME_IIFE` constant + `Runtime.addBinding('duoPlaygroundAction')` + `Runtime.bindingCalled` handler that emits to a single browser-side listener.
- `electron/browser-manager.ts` — wire the listener to `IPC.PLAYGROUND_ACTION`.
- `shared/types.ts` — IPC channel addition.
- `electron/preload.ts` — minimal pass-through if the renderer doesn't already subscribe via existing channels.
- `renderer/App.tsx` (or wherever browser-pane page hosts integrate) — connect the IPC channel to the existing `onPlaygroundAction` dispatcher used by canvas pages. ONE handler should serve both panes.

**Trust gate (cross-cuts ENH-094 + Stage 23 trust model):** Stage 23 limits canvas-action firing to files under `~/.claude/duo/` (path-restricted trust). For browser-pane pages, the same trust check needs to apply — only file:// URLs under trusted paths fire playground actions; arbitrary http(s) sites stay inert. Re-use the existing `isPathTrusted` check.

**Effort estimate:** \~1 sprint (CDP injection + IPC plumbing + trust check + browser-pane test surface).

**Cross-ref:** ENH-043 (meta). ENH-092 + ENH-093 (the verbs this exposes to browser pages). Stage 23 (canvas action vocabulary + trust model). Stage 15.2 / ENH-039 / BUG-006 (CDP injection precedents).
