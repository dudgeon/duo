# Active sprint state — between sprints (post-v0.7.1, pre-Sprint 19)

**Status (2026-05-18 evening):** v0.7.1 cut + tag pushed + GitHub release published with signed DMG. Sprint 18 chapter closed. Next sprint not yet scoped.

---

## 🔥 Post-compaction me: read this first

**v0.7.1 cut as [`v0.7.1` tag](https://github.com/dudgeon/duo/releases/tag/v0.7.1).** Theme: markdown source-of-truth — comments + track-changes + frontmatter all visible inline. 30 commits since v0.7.0. `package.json` already bumped to v0.7.2 for next sprint.

**No active sprint plan.** Owner has not yet locked the v0.7.2 / Sprint 19 scope. If owner asks "what's next?", consult the carry-forward queue below + the `tasks.md § 🟡 Filed` entries; offer 3–5 candidates rather than picking unilaterally.

**Two things absolutely owed before next strong-trigger work:**

1. **BUG-139 v1.1** — owner walked the design-options playground and locked 4 of 5 picks:
   - **Q2=A** (uniform mono values, no type styling) — already matches v1, no-op
   - **Q3=C** (raw-YAML-only editing, no per-row inline edit) — already matches v1, no-op
   - **Q4=B** (default collapsed on first open) — code change owed: flip `sidecar.frontmatterPanelCollapsed === true` default to `true` when the field is undefined (currently undefined ⇒ false)
   - **Q5=B** (click-to-expand long values inline) — code change owed: replace static ellipsis with row-click → expand row to multi-line view with left accent border, click again to collapse
   - Q1 (row density) deferred — owner had no strong preference.

2. **BUG-138 Phase 5 (provisional)** — inline standalone-comment rendering. v0.7.1 Phase 2's migration collapses multi-entry threads into one anchored comment with `↪ @author <ts>:` separators in the body. Phase 5 would split these back apart with an inline atom node for standalone replies (better threaded display). NOT urgent; on Owner walk it didn't surface as a blocker. File this as the next BUG-138 carry-forward, don't ship without owner pull.

---

## Carry-forward queue (most-recent first; not in priority order)

Owner-walked + decided but not yet implemented:

- **BUG-139 v1.1** — Q4 (default collapsed) + Q5 (click-to-expand long values). See above.
- **BUG-138 Phase 5** — inline standalone-comment atom node for replies. See above.

Filed during v0.7.1 cycle, not blocking the cut, awaiting prioritization:

- **BUG-079** — tab-cycle latency. Needs production repro (synthetic test in Sprint 17 ruled out 3 hypotheses; new H4 + H5 leads).
- **BUG-093** — split crash (filed Sprint 17).
- **BUG-122** — save-conflict banner deeper fix. v0.6.15 hardened the diagnostic + widened the normalize window; waiting on owner-side log from next repro.
- **BUG-124** — `writeConflictLog` logs-dir mkdir gap (filed Sprint 17).
- **BUG-129** — `duo open` nonexistent file UI side (CLI side fixed Sprint 17; navigator-click + did-fail-load fallback in BrowserRenderer deferred).
- **BUG-131** — ⌘A no-op in playground inputs (filed Sprint 17).
- **ENH-084 v4** — aux glow. Owner walk owed (60s click-around). Diagnostic instrumentation already shipped Sprint 17.
- **ENH-118** — image-type handling. Animate GIFs vs freeze first-frame; SVG safety review; HEIC/RAW reject vs convert. Owner decision needed before any code.
- **ENH-127** — composer-window direction for accidental-submit. Defer further unless pain re-surfaces (ENH-142 v0.6.15 per-pref toggle covers the common case).
- **ENH-137** — Beginner's Guide. New pack content; defer until BUG-139 v1.1 + BUG-138 Phase 5 land or owner explicitly pulls.
- **ENH-141** enterprise smoke — agent-side dev verification of the Sprint 16 install-path hardening (BUG-121 area).
- **ENH-148 v2** — once owner walks v1 (just shipped), the cross-boundary cell selection variant from BUG-123 v2 may re-surface. Wait for owner ping.
- **ENH-157** — browser-pane comments. Architectural follow-up to Sprint 17 inspect. Defer.
- **ENH-162** — Clone modal destination-collision UX (filed Sprint 17). Polish — defer.
- **FOLLOWUP-020** — `duo close-tab` CLI parity for active working/terminal tab.
- **FOLLOWUP-021** — `duo install --clean` to wipe + reinstall the shim + SessionStart hook (use case: enterprise machines with stale state).
- **BUG-024** follow-up — combine Send → Duo + Comment pills (single split-pill or hover flyout). Defer.
- **17a.5** — template gallery (canvas templates as a discoverable surface). Defer.
- **Backlinks panel / graph view** (Obsidian cluster). Waiting on wikilinks-autocomplete (v0.6.10 shipped) usage signal to confirm demand.

---

## Open questions awaiting owner input

| Question | Priority |
|---|---|
| **Next sprint scope** — pull BUG-139 v1.1 + Phase 5 first, or pick from the broader carry-forward queue? | Whenever owner ready to scope Sprint 19 |
| **BUG-118 image-type handling direction** | Before any image-polish sprint |
| **ENH-127** composer-window direction (declined / Duo-side composer / anti-accidental-submit heuristic / upstream feature request) | If accidental-submit pain re-surfaces |
| **Backlinks / graph view** (Obsidian cluster) — Sprint 19+ anchor? Or defer further? | When wikilinks usage tells us demand |
| **17a.5 template gallery** directions A/E | Before any code work on templates |

---

## Locked memories from Sprint 18

| Memory | What it captures |
|---|---|
| [feedback_use_computer_use_for_keystroke_tests](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_use_computer_use_for_keystroke_tests.md) | When a smoke-walk item needs real keystrokes (Backspace intercept, ⌘K, paste, IME), request computer-use access (apps: `["Electron"]`) and verify live BEFORE handoff. Three failed walks of the same bug is the symptom this rule prevents. |
| [feedback_always_open_playgrounds_in_duo](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_always_open_playgrounds_in_duo.md) | Claude desktop preview panel lacks `navigator.clipboard` → Copy-decisions silently fails; always `duo open` instead. |
| [feedback_spawn_claude_for_testing_when_needed](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_spawn_claude_for_testing_when_needed.md) | When verification needs live-Claude (claudeLive=true), spawn one yourself via `duo new-tab --claude --cwd <path>`. |
| [feedback_grep_all_implementations_before_rename](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_grep_all_implementations_before_rename.md) | User-visible strings often have 3+ copies (React + CDP IIFEs + test fixtures); grep all before declaring rename done. |

---

## What shipped this sprint (inventory)

For the prose narrative, see [docs/RELEASES.md § v0.7.1](../RELEASES.md). For the one-line inventory, see [CHANGELOG.md § [0.7.1]](../../CHANGELOG.md). For the per-commit detail, see [docs/dev/session-log.md § 2026-05-18 v0.7.1 cut](session-log.md).

Headlines:

- **BUG-138** (4 phases, 147 unit tests) — markdown comments + track-changes via inline CriticMarkup. Parser/serializer + 4 TipTap marks + tiptap-markdown integration; silent sidecar→inline migration + `duo author` verb; 6 agent CLI verbs (`duo doc {insert,delete,substitute,comment,accept,reject}`); Suggesting toolbar toggle + auto-wrap-typed/Backspace + bulk banner + per-suggestion rail + filter chips + collapsible chevron.
- **BUG-139** — Frontmatter Properties panel above editor body. Chevron-collapse persisted per-doc; Edit raw textarea with live parse-error feedback; "+ Add properties" affordance.
- **ENH-148** — Multi-select v2: ⇧-click range + ⌘-A select-all + `nav-state.selectedPaths` CLI parity.
- **BUG-130** — Browser-pane `file://` auto-reload via chokidar watcher per tab.
- **BUG-135** — Git ribbon strictness (suppresses on peer-repo-container crossings).
- **BUG-136** — `gh-auth` PATH augmentation.
- **BUG-137** — Markdown link editing: 3 walks of fixes. Final shape: custom InputRule (no markInputRule) + `LinkPromptModal` (Electron renderers throw on `window.prompt`) + Link extension extended for tooltip + extendMarkRange before setLink.
- **BUG-141** — Settings.json banner wording reworded.
- **ENH-164** — Closed as already-shipped via `duo new-tab --claude`.
- **Walk-1 follow-ups:** Suggest toolbar icon (Lucide pencil), TC rail collapse, ribbon icon parity, frontmatter design-options playground.

---

## Compaction-safe pointer table

After compaction, the new agent should read (in order):

| To know | Read |
|---|---|
| **The cut just happened** | This file's "🔥 Post-compaction me" block above. v0.7.1 is out; no active sprint scoped yet. |
| **What shipped in v0.7.1** | This file's "What shipped this sprint" section + [docs/RELEASES.md § v0.7.1](../RELEASES.md) for the prose. |
| **What's owed before next strong work** | This file's "🔥 Post-compaction me" — BUG-139 v1.1 (Q4 + Q5) and provisional BUG-138 Phase 5. |
| **Carry-forward backlog** | This file's "Carry-forward queue" section. |
| **Memory rules from this sprint** | The "Locked memories" table above + [MEMORY.md](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/MEMORY.md). |
| **Current package.json version** | `0.7.2` (post-cut bump). Dev build titlebar paints `0.7.2 ·dev`. |
| **GitHub release** | https://github.com/dudgeon/duo/releases/tag/v0.7.1 |

**What's running:** dev session under v0.7.2 ·dev. Test fixtures in `/tmp/` from the 4 smoke-walk revs (`/tmp/walk-bug137-rev*.md`, `/tmp/walk-bug138-rev*.md`, `/tmp/walk-link-final.md`) can be deleted at owner's discretion.
