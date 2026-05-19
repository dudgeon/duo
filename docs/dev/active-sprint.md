# Active sprint state — between sprints (post-v0.7.2, pre-Sprint 19)

**Status (2026-05-18 evening):** v0.7.2 cut + tag pushed + [GitHub release](https://github.com/dudgeon/duo/releases/tag/v0.7.2) published with signed DMG. v0.7.2 polish wave closed adjacent items from v0.7.1's Sprint 18 markdown chapter. Next sprint not yet scoped.

---

## 🔥 Post-compaction me: read this first

**v0.7.2 cut as [`v0.7.2` tag](https://github.com/dudgeon/duo/releases/tag/v0.7.2).** Theme: editor UX polish + agent CLI parity + save-conflict reliability. 8 commits since v0.7.1 (cut earlier same day). `package.json` already bumped to v0.7.3 for next sprint.

**No active sprint plan.** Owner has not yet locked the v0.7.3 / Sprint 19 scope. If owner asks "what's next?", consult the carry-forward queue below + the `tasks.md § 🟡 Filed` entries; offer 3–5 candidates rather than picking unilaterally.

**Nothing owed before next strong-trigger work.** Both v0.7.1 follow-ups (BUG-139 v1.1 Q4+Q5 + BUG-138 Phase 5) shipped in v0.7.2. Single smoke walk (4/4 PASS) closed cleanly. All 🟡 owner-decision gates closed.

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
| **Next sprint scope** — pick from the carry-forward queue. v0.7.2 closed v0.7.1's owed follow-ups. | Whenever owner ready to scope Sprint 19 / v0.7.3 |
| **ENH-127** composer-window direction (declined / Duo-side composer / anti-accidental-submit heuristic / upstream feature request) | If accidental-submit pain re-surfaces |
| **Backlinks / graph view** (Obsidian cluster) — Sprint 19+ anchor? Or defer further? | When wikilinks usage tells us demand |
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
