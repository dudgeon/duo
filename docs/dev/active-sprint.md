# Active sprint state — Sprint 20 / v0.7.7 IN FLIGHT

**Status (2026-05-22):** Build green-lit by owner 2026-05-22 with a same-turn ENH-172 add ("an ENH to the view menu for show/hide hidden files/folders in the navigator"). Scope now 4 ENHs / 8 items. v0.7.6 cut + DMG published earlier 2026-05-22 ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.6)).

**Theme.** *"Smaller daily-driver actions become first-class menu / chord surfaces."* Four coherent ENHs covering navigator-side file creation, the first Settings menu, the workspace switcher decided in ENH-168, and the navigator's existing-but-buried show/hide-dotfiles toggle.

---

## Sprint 20 scope (4 ENHs, 8 items)

### ENH-172 — Show / hide hidden files & folders in the navigator

Owner ask 2026-05-22 (same turn as the sprint green-light). Surfaces the existing `showDotfiles` navigator state (renderer-local since Stage 10, no UI / chord / CLI today) as a first-class user-facing toggle. Three triggers, one shared state:

1. **View menu** → new checkbox *"Show Hidden Files"* (mirrors Cozy-mode's checkmark-echo pattern via a new `HIDDEN_FILES_STATE_PUSH` IPC channel).
2. **Keyboard chord** ⌘⇧. — verified free in `globalShortcuts.ts`. Finder convention.
3. **CLI verb** `duo hidden-files [show|hide|toggle]` + extend `duo nav-state` to include `showDotfiles: boolean`.

Persist via localStorage (today it's a `useState` default-false; promote to persisted so the checkbox doesn't reset each dev cycle). The `.claude` and `.obsidian` always-visible carve-outs ([`shouldShow`](renderer/components/FileTree.tsx:1471)) stay — this toggle controls generic dotfiles only.

Files likely touched: `shared/types.ts` (`DuoCommandName` + IPC channel + nav-state snapshot field), `electron/preload.ts` (bridge API), `electron/main.ts` (menu item + ipcMain + getter/setter), `electron/socket-server.ts` (command switch case), `cli/duo.ts` (verb + printHelp), `renderer/hooks/useNavigator.ts` (localStorage persistence + bridge subscribe), `renderer/App.tsx` (chord wiring), `renderer/keyboard/globalShortcuts.ts` (new `toggleHiddenFiles` ShortcutId), `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md`.

### ENH-169 — Navigator-side new-file / new-folder UX

Three triggers, one shared flow:

1. **Breadcrumb right-click** → context menu with `New file here…` / `New folder here…` / `Reveal in Finder` / `Open terminal here`. Default location = the dir of the segment that was right-clicked.
2. **File menu** → `New File…` / `New Folder…`. Default location = currently-focused navigator dir.
3. **Keyboard chords** ⌘N (New File) / ⌘⇧N (New Folder). Same default-location logic as #2.

All three reuse the same modal (asks for name, validates filename collision, creates via existing `FilesService` + `NAV_REVEAL` to scroll the new entry into view). Sub-question to resolve during build: does ⌘N collide with anything in the renderer's `globalShortcuts` registry? Likely free but verify before binding.

Files likely touched: `electron/main.ts` (menu items), `renderer/keyboard/globalShortcuts.ts` (chord registry), `renderer/components/FileTree.tsx` or breadcrumb component (right-click handler), `renderer/components/NewFileModal.tsx` (new component or extend existing wikilink-create modal pattern).

### ENH-170 — Settings menu (Return-key prefs)

First Settings menu surface. Two toggles in v1, exposing the existing `duo claude-return` + `duo shift-return` CLI flags as GUI controls.

**Setting label (owner-locked):** *"Return → line break in Claude"*

| Toggle | Off (default) | On |
|---|---|---|
| **Return → line break in Claude** | Return submits to Claude (terminal default) | Return inserts a literal newline (multi-line composer) |
| **Shift+Return → submit in Claude** | Shift+Return inserts newline (Slack default) | Shift+Return submits |

Menu placement sub-question (resolve during build): `App > Settings…` is the macOS convention; `Tools > Settings` is a fallback. Both are acceptable; prefer the former. Modal vs new BrowserWindow vs Cozy-mode-style panel: smallest path is a renderer modal (no new window).

Files likely touched: `electron/main.ts` (menu item), new `renderer/components/SettingsModal.tsx`, wires to existing `IPC.CLAUDE_KEY_PREFS_SET` + `useClaudeKeyPrefs()` hook (already shipped Sprint 16).

### ENH-171 — Workspace switcher (title-bar dropdown)

Per locked ENH-168 decisions:

- **Q1 Position:** A — Title-bar dropdown (the existing workspace name badge becomes the click target).
- **Q2 Gesture:** a — Dropdown menu (single click → list).
- **Q3 Identification:** a — Name only (today).
- **Q4 Create:** b — "+ New Workspace" inline at the top of the dropdown opens the full native **Save Workspace As** dialog (no new modal).

Sprint-20 addition:

- **Keyboard chord** — `⌘\` to open the dropdown without clicking (additions Q3 #8).

Dropdown contents (in order):
1. `+ New Workspace` (opens Save As dialog)
2. Recent workspaces (same data as File > Open Recent Workspace, sorted by `lastOpenedAt`, capped 10, prune-missing)
3. Separator
4. `Clear Recent Workspaces`

Files likely touched: `renderer/App.tsx` § titlebar block (click handler on the workspace-name badge), new `renderer/components/WorkspaceSwitcherDropdown.tsx`, `renderer/keyboard/globalShortcuts.ts` (chord), reuses `window.electron.workspaceFile.listRecent()` + `openRecent()` + `save({saveAs:true})`.

---

## Chord-conflict findings (scanned `globalShortcuts.ts` 2026-05-22)

Two of the four sprint items collide with the existing registry. State-and-proceed (rule 6) candidates that need owner ack — surfaced here before the corresponding ENH starts:

| Sprint item | Conflict | Proposed resolution |
|---|---|---|
| **ENH-169** ⌘N New File | `⌘N` already maps to `newMarkdownFile` in `globalShortcuts.ts:196`. **Likely the same intent** — current behavior creates a new markdown file via App.tsx § `onCommitNewFile`. | Re-use the existing chord; ENH-169 generalizes `newMarkdownFile` from "navigator's currently-focused dir, .md only" to "selected breadcrumb/dir, kind-aware (.md or .html or folder)". No new ShortcutId — keep `newMarkdownFile` (or rename to `newFile` if grep-ALL plumbing per CLAUDE.md/feedback memory holds). |
| **ENH-171** ⌘\\ Workspace switcher | BUG-075 (v0.6.5) abandoned `⌘\\` for splitView because **1Password's system-level autofill grab eats it before Chromium sees the keystroke**. Re-binding now would have the same fate on most users' machines. | Proposed re-pick: `⌘⌥W` (no current owner; `W` already overloaded with role-binding gymnastics in `electron/main.ts:1950` but the meta+alt variant is free). Alternates: `⌘⇧S` (free; mnemonic "switch"), `⌘⇧B` (mnemonic "between workspaces"). Decision needed before ENH-171 plumbing lands. |
| **ENH-172** ⌘⇧. Show Hidden | Free — `Period` is not bound anywhere. Use `e.code === 'Period'` per the layout-defensive pattern. | No conflict; proceed. |
| **ENH-170** Settings menu | Owner chose macOS-native `App > Settings…` (no accelerator by default — system convention is `⌘,` but defer chord binding until owner asks). | No conflict; proceed. |

## Locked decisions (2026-05-22 AskUserQuestion)

| Q | Answer |
|---|---|
| Return-key toggle label | "Return → line break in Claude" (single-toggle framing — on = newline, off = submit; owner picked "Other" over the four proposed labels) |
| Workspace "+" behavior | Full native Save dialog (reuses Save Workspace As flow) |
| Sprint-20 additions to include | #5 Shift+Return companion · #6 ⌘N/⌘⇧N chords · #8 workspace-switcher chord (skipped #7 file-template defaults) |
| Output format for this plan | Update `docs/dev/active-sprint.md` (markdown) |

## Owner-decision gate cleared

- **ENH-168 — workspace switcher design playground** at [`docs/research/workspace-switcher.html`](docs/research/workspace-switcher.html) — owner walked + decided 2026-05-22. Decisions baked into ENH-171 above. Playground stays in `docs/research/` as the design record.

---

## 🔥 Post-compaction me: read this first

Sprint 20 (v0.7.7) is **planned but not started**. Three ENHs locked via AskUserQuestion 2026-05-22:

- **ENH-169** — Navigator new-file/new-folder UX (breadcrumb right-click + File menu + ⌘N/⌘⇧N chords).
- **ENH-170** — Settings menu, first occupant: Return-key prefs ("Return → line break in Claude" + companion Shift+Return toggle).
- **ENH-171** — Workspace switcher (title-bar dropdown per ENH-168 decisions + ⌘\ chord).

Scope detail in the "Sprint 20 scope" section above. The owner has not given the green-light to build yet; do not implement without confirmation.

**Last cut: v0.7.6** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.6), 2026-05-22). Includes the BUG-122 hypothesis 6 fix (HTML-entity decode in `normalizeForEchoCompare`) and the ENH-168 workspace switcher design playground. Full ADR for the v0.7.4 workspace-as-file foundation at [`docs/prd/enh-167-workspace-as-file.md`](../prd/enh-167-workspace-as-file.md).

**For prior-sprint detail** (v0.7.3 ENH-166 unified rail + BUG-142..147 + v0.7.4 ENH-167 workspace-as-file + v0.7.5 FOLLOWUP-024 + v0.7.6 BUG-122-h6) — see `docs/dev/session-log.md` § entries dated 2026-05-19 through 2026-05-22.

---

## Carry-forward queue (most-recent first; not in priority order)

Filed but not blocking, awaiting prioritization or external trigger:

- **BUG-079** — tab-cycle latency. Needs production repro (synthetic test in Sprint 17 ruled out 3 hypotheses; new H4 + H5 leads).
- **BUG-093** — split crash. Filed + instrumented; clean repro owed.
- **BUG-122** hypothesis 2/3 — save-conflict banner deeper fix. Hypothesis 4 (soft-break ≡ space) shipped v0.7.2 ([1834065](https://github.com/dudgeon/duo/commit/1834065)). Hypotheses 2 (Notion mirror race) + 3 (OneDrive/iCloud xattr race) remain open; next-repro `~/.claude/duo/logs/last-conflict.log` will tell us which is live if it fires again.
- **ENH-084 v4** — aux glow. Owner walk owed (60s click-around). Diagnostic instrumentation already shipped Sprint 17.
- **ENH-127** — composer-window direction for accidental-submit. Defer further unless pain re-surfaces (ENH-142 v0.6.15 per-pref toggle covers the common case).
- **ENH-137** — Beginner's Guide. New pack content; multi-day. Defer until owner explicitly pulls.
- **ENH-141** enterprise smoke — agent-side dev verification of the Sprint 16 install-path hardening (BUG-121 area).
- **ENH-148 v2** — once owner walks v1, the cross-boundary cell selection variant from BUG-123 v2 may re-surface. Wait for owner ping.
- **ENH-157** — browser-pane comments. Architectural follow-up to Sprint 17 inspect. Multi-day; defer.
- **FOLLOWUP-021** — `duo install --clean` to wipe + reinstall the shim + SessionStart hook. Low priority; gated on real user pain.
- **BUG-024** follow-up — combine Send → Duo + Comment pills (single split-pill or hover flyout). Defer.
- **17a.5** — template gallery (canvas templates as a discoverable surface). Defer.
- **Backlinks panel / graph view** (Obsidian cluster). Waiting on wikilinks-autocomplete usage signal.

---

## Open questions awaiting owner input

| Question | Priority |
|---|---|
| **Sprint 20 start signal** — three ENHs scoped above; build pending owner go-ahead. | When owner has time to scope the next ~1.5 days of work |
| **ENH-170 Settings menu placement** — `App > Settings…` (macOS convention) vs `Tools > Settings`? My lean: App > Settings, modal in renderer. | Resolvable during build (rule 6 state-and-proceed candidate) |
| **ENH-169 ⌘N chord availability** — verify `globalShortcuts.ts` has it free before binding. | During build |
| **ENH-127** composer-window direction (declined / Duo-side composer / anti-accidental-submit heuristic / upstream request) | If accidental-submit pain re-surfaces |
| **Backlinks / graph view** (Obsidian cluster) — anchor for a future sprint? Or defer further? | When wikilinks usage tells us demand |
| **17a.5 template gallery** directions A/E | Before any code work on templates |

---

## Locked memories from v0.7.2 cycle

| Memory | What it captures |
|---|---|
| [feedback_use_computer_use_for_keystroke_tests](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_use_computer_use_for_keystroke_tests.md) | When a smoke-walk item needs real keystrokes (Backspace intercept, ⌘K, paste, IME), request computer-use access (apps: `["Electron"]`) and verify live BEFORE handoff. **Elevated to CLAUDE.md § 7e in v0.7.2** as a session-start project default. |
| [feedback_always_open_playgrounds_in_duo](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_always_open_playgrounds_in_duo.md) | Claude desktop preview panel lacks `navigator.clipboard` → Copy-decisions silently fails; always `duo open` instead. |
| [feedback_spawn_claude_for_testing_when_needed](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_spawn_claude_for_testing_when_needed.md) | When verification needs live-Claude (claudeLive=true), spawn one yourself via `duo new-tab --claude --cwd <path>`. |
| [feedback_grep_all_implementations_before_rename](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_grep_all_implementations_before_rename.md) | User-visible strings often have 3+ copies (React + CDP IIFEs + test fixtures); grep all before declaring rename done. |

---

## What shipped this cut (inventory)

For the prose narrative, see [docs/RELEASES.md § v0.7.2](../RELEASES.md). For the one-line inventory, see [CHANGELOG.md § [0.7.2]](../../CHANGELOG.md). For the per-commit detail, see [docs/dev/session-log.md § 2026-05-18 v0.7.2 cut](session-log.md).

Headlines (14 deliverables):

- **BUG-139 v1.1 + v1.2** — Properties panel defaults collapsed; click row to expand long values with accent border + JSON pretty-print; Edit-raw textarea auto-grows up to 10 lines.
- **BUG-138 Phase 5** — Threaded comment rail display restored. `buildMarkdownThreads` now reads inline marks + sidecar; `parseRepliesFromBody` splits `↪`-joined bodies back into separate rail bubbles. Closes a silent regression where post-Phase-2 inline-only files showed an empty rail.
- **BUG-083 markdown polish** — Active-thread visual highlight bumped 0.22 → 0.42 alpha + 1px accent box-shadow.
- **BUG-122 hypothesis 4 fix** — `normalizeForEchoCompare` collapses soft-breaks before disk-vs-baseline compare; closes the false-positive banner on soft-break-wrapped markdown.
- **FOLLOWUP-022** — New CLI verb `duo doc highlight <file> --text "X"` closes BUG-138 family parity (HighlightMark was UI-only).
- **ENH-128 walk-4** — HEIC drag-drop verified live with iPhone HEIC + sips fallback; image-handling cluster closed.
- **ENH-102 verified** — ⌘⇧⌫ delete current file confirm dialog (Sprint 9 plumbing) walked + closed.
- **BUG-091 verified** — Right-click "Move to Split View" in WorkingTabStrip already shipped via Phase 3c; flipped paper-trail.
- **CLAUDE.md § 7e** — Session-start Electron access rule. Elevates the v0.7.1 walk-3 memory rule to a project default.
- **Skill — comment attribution** — New `skill/SKILL.md § Leave a comment or track-change` block.
- **6 stale git/status tests greened** + carry-forward queue cleanup (6 already-shipped v0.7.0 items were listed as open post-compaction).

---

## Compaction-safe pointer table

After compaction, the new agent should read (in order):

| To know | Read |
|---|---|
| **The cut just happened** | This file's "🔥 Post-compaction me" block above. v0.7.2 is out; no active sprint scoped yet. |
| **What shipped in v0.7.2** | This file's "What shipped this cut" section + [docs/RELEASES.md § v0.7.2](../RELEASES.md) for the prose. |
| **What's owed before next strong work** | Nothing — v0.7.2 closed v0.7.1's outstanding follow-ups. |
| **Carry-forward backlog** | This file's "Carry-forward queue" section. |
| **Memory rules from this cycle** | The "Locked memories" table above + [MEMORY.md](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/MEMORY.md). |
| **Current package.json version** | `0.7.3` (post-cut bump). Dev build titlebar paints `0.7.3 ·dev`. |
| **GitHub release** | https://github.com/dudgeon/duo/releases/tag/v0.7.2 |

**What's running:** dev session under v0.7.3 ·dev. Test fixtures in `/tmp/` from the v0.7.2 walk (`/tmp/walk-v0.7.2-*.md`) can be deleted at owner's discretion.
