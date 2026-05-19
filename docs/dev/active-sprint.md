# Active sprint state — Sprint 19 / v0.7.3 in flight

**Status (2026-05-19):** Sprint 19 mid-flight. Two waves shipped this session: (1) ENH-166 unified annotation rail; (2) BUG-142..147 cluster from the bug-report on `duo doc comment --reply-to` ergonomics + live-editor sync. One follow-up filed (FOLLOWUP-023). Smoke walk + cut owed.

---

## 🔥 Post-compaction me: read this first

**ENH-166 v2 unified annotation rail (shipped + live verified).** Owner kickoff: *"in 0.7.2, comments and tracked changes live in their own rails; this takes up too much width; we need to combine these into a single rail."* Owner feedback after v1: *"you have just stacked the comment and track changes rails — bad UX; I specifically said items should coexist in a single rail, e.g. [comment 1, addition 1, comment 2, deletion 1, comment 3], in the order that they appear in the document."* v2 introduces `UnifiedAnnotationRail.tsx` that merges TrackedRange[] + BuiltMarkdownThread[] into one PM-position-sorted list with a single header, merged filter chips (Mine/Agent/Others span both kinds), and 1-based comment numbering reassigned post-sort. Live-verified: the rail reads top-to-bottom as `[comment-1, +ins, −del, comment-2]` matching document order. Prose column gets ~280px back.

**BUG-142..147 cluster (shipped + live verified).** Bug report at [/tmp/duo-bug-report-comment-reply.md](/tmp/duo-bug-report-comment-reply.md) — agent took 2 min + 16 shell calls to reply to a single CriticMarkup comment.

- **BUG-142** — `doc-edit` not propagated to live editor. ROOT CAUSE: the reported "no update" was specific to the `--reply-to` codepath corrupting the parent token (insert/delete/etc. DO refresh via the existing BUG-085 chokidar path). Closed via BUG-143 fix.
- **BUG-143** — `--reply-to` ergonomics. New pure function `addCommentReply` finds the parent comment by id, appends `\n↪ @<author> <ts>: <body>` inside the parent's `{>>…<<}` body. Socket-server branches on `--reply-to + no --anchor`. CLI loosens validation. 6 new vitest fixtures.
- **BUG-144** — `duo layout` vs `doc read` active-editor mismatch. ROOT CAUSE: each mounted editor error-replied on path mismatch instead of silently ignoring; the bogus error from a non-matching editor raced and won. Fix: silent `return` on mismatch in all four IPC handlers (`onDocRead`, `onDocGoto`, `onDocFind`, `onDocWrite`).
- **BUG-145** — `duo doc --help` / `duo doc <sub> --help` returns focused per-subcommand help (~15 lines vs. the ~200-line global help).
- **BUG-146** — "Where is the comment?" decision tree added to `skill/SKILL.md`, keyed on `duo layout § main.kind`.
- **BUG-147** — `skill/references/comments.md` covering the comment lifecycle, on-disk shape, and the 3-call expected agent path.
- **BUG-148** — Electron main-process EPIPE crash. Surfaced live during dev restarts: `npm run dev` under `nohup` detaches; once the parent stdout closes, the dev-only renderer-console forwarder at `electron/main.ts:651` throws EPIPE → user-visible error dialog. Fix: canonical Node-on-broken-pipe stdout/stderr handlers at the top of `electron/main.ts`.

**Test counts:** 649 → 655 vitest tests, all green. Typecheck ✅. Skill synced via `npm run sync:claude`.

**Open follow-up:** [FOLLOWUP-023](../../tasks.md) — chokidar reload after a reply leaves the tracked-changes rail momentarily misclassified (highlights show as insertions); close-reopen renders correctly. Lower priority since the headline (reply visible) is fixed and documented in the new reference page.

**Files touched this session (9 + 1 new):**
- [`electron/main.ts`](../../electron/main.ts) — BUG-148 EPIPE handlers
- [`renderer/components/editor/UnifiedAnnotationRail.tsx`](../../renderer/components/editor/UnifiedAnnotationRail.tsx) — NEW (v2)
- [`renderer/components/editor/TrackedChangesRail.tsx`](../../renderer/components/editor/TrackedChangesRail.tsx) — export `TrackedChangeCard` + `FilterChip` + `classifyAuthor` for reuse
- [`renderer/components/editor/primitives/CommentRail.tsx`](../../renderer/components/editor/primitives/CommentRail.tsx) — export `CommentThreadCard` (v2) + `containerless` prop (v1, retained)
- [`renderer/components/editor/MarkdownEditor.tsx`](../../renderer/components/editor/MarkdownEditor.tsx) — swap v1 two-section wrapper for `<UnifiedAnnotationRail />`; drop the now-dead `railThreads` adapter; 4× BUG-144 silent-ignore fixes
- [`renderer/styles/globals.css`](../../renderer/styles/globals.css) — `.duo-unified-rail`
- [`core/markdown/docEdit.ts`](../../core/markdown/docEdit.ts) — `addCommentReply`
- [`core/markdown/docEdit.test.ts`](../../core/markdown/docEdit.test.ts) — 6 new tests
- [`core/socket-server.ts`](../../core/socket-server.ts) — branched comment op
- [`cli/duo.ts`](../../cli/duo.ts) — `printDocHelp` + validation
- [`skill/SKILL.md`](../../skill/SKILL.md) — decision tree + updated example
- [`skill/references/comments.md`](../../skill/references/comments.md) — NEW

**Smoke walk owed (one rev, all of):**
- ENH-166: open `.md` with mixed CriticMarkup → unified rail in 280px column.
- BUG-142/143: `duo doc comment --reply-to <id> --body "X"` (no --anchor) → reply appears in thread after close-reopen.
- BUG-144: two `.md` files open; `duo doc read <non-active path>` returns that file (no spurious error).
- BUG-145: `duo doc --help` and `duo doc comment --help` return focused help.
- BUG-146/147: open `skill/SKILL.md` + `skill/references/comments.md` → decision tree + reference both readable.

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
