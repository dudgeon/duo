# Active sprint state — Sprint 17 (in progress; pre-cut)

**Theme:** **A+C+D bundle — Navigator + tab UX polish + Diagnostic + instrumentation sprint + Papercut sweep.** Owner pick 2026-05-11 from a 5-option AUQ; combined three coherent buckets into a single sprint since most items were small. Walk + cut pending — owner deferred the walk; running breadcrumb sweep before push.

> **Status: 9 sprint commits landed (incl. ENH-156 verb-split + ENH-157 filing); v0.6.16 cut pending owner walk + sign-off.** Sprint 16 + v0.6.15 cut detail preserved in § "Cut records" below.

## Sprint 17 commits (9, pre-cut)

| Commit | Item | Shape |
|---|---|---|
| [`ba79735`](https://github.com/dudgeon/duo/commit/ba79735) | **ENH-146** — `duo-atelier.css` kernel + `atelier-css.md` class library + CLAUDE.md § 11 redirect + `skill/make-playground.md` update + `sync:claude` broadened to `.css` | Ship — closes recurring ~200-line CSS authoring tax per playground |
| [`86deaf6`](https://github.com/dudgeon/duo/commit/86deaf6) | **ENH-144** — Close-tab focus shift to LEFT-neighbor file tab (was falling straight to `{ kind: 'browser' }`). Terminal + browser strips already correct | Ship — one-spot fix in `App.tsx § closeFileTab` |
| [`5c6225e`](https://github.com/dudgeon/duo/commit/5c6225e) | **BUG-079** — Instrumented every cycle hop with `[BUG-079]` timing trace. Synthetic test (4 browser tabs, ⌃⇧Tab) measured total renderer keydown → switchTab return at ~15ms regardless of pacing. H1 (IPC) + H3 (direction-asymmetric math) ruled out. H4 (modifier-key release) + new H5 (upstream keystroke consumption) remain | Diagnose-first — fix gated on production repro |
| [`5e36348`](https://github.com/dudgeon/duo/commit/5e36348) | **ENH-147 v1** — Navigator multi-select: `selectedItems: Map<path, kind>` + `primaryPath` anchor; ⌘-click toggle; multi-row context menu with pluralized "Move N items to Trash…"; chokidar event prunes the map. Both panes (project + ~/.claude) mirrored. ⇧-click range + ⌘-A → **ENH-148** filed | Ship v1 — full Finder UX deferred to next pickup |
| [`14c10b0`](https://github.com/dudgeon/duo/commit/14c10b0) | **ENH-143** — Discoverability touch: new entry 55b in `what-duo-does.html` for "Close the active tab with ⌘W" adjacent to entry 56's ⌘⇧⌫ delete-file. No new chord (existing ⌘W + ⌘⇧⌫ cover the use cases). Surfaced + filed **FOLLOWUP-020**: `duo close-tab` for active working/terminal tab doesn't exist (CLI parity gap) | Ship — docs only |
| [`d0fdc44`](https://github.com/dudgeon/duo/commit/d0fdc44) | **ENH-084 v4** — Instrumentation pass. `mainColRef` + `auxColRef` declared + attached; document-level capture-phase listeners on `focusin` + `mousedown` + `blur` with subpane classification. NO behavior change. Single-string log format so renderer→main forwarder captures full payload | Diagnose-first — fix gated on owner 60s click-around walk |
| [`f54f4b5`](https://github.com/dudgeon/duo/commit/f54f4b5) | **BUG-123 spike** (superseded by next commit) — Initial framing assumed A/B/C trade-offs that turned out to depend on assumed-correct current behavior | — |
| [`2d868a6`](https://github.com/dudgeon/duo/commit/2d868a6) | **BUG-123 v1 fix** — Root cause: Duo never imported `prosemirror-tables/style/tables.css`; the `.selectedCell` decoration was rendering invisibly. Empirical grounding (after owner correction) found the missing import; 9-line CSS fix in `globals.css` paints the overlay with Duo accent at 18% opacity + position:relative on td/th. Cross-boundary drag-to-outside-table deferred behind v1 owner walk | Ship — owner AUQ pick (CSS only + Duo orange) |
| _(pending sha)_ | **ENH-156** — HTML verb-split: `duo open <html>` → browser pane (interactive default); `duo edit <html>` → canvas mode (source-editable). Renderer's `openFileSmart` strips the `<meta duo-open-in>` consultation; CLI adds `--canvas` override for open + `--browser` override for edit; server passes mode through nav.edit. ENH-157 filed as the prioritized follow-up (browser-pane comment support — `duo html comment` currently canvas-only, surfaced by the new default). Doc sweep across CLAUDE.md / vocabulary.md / make-page.md / make-playground.md / SKILL.md / agents/duo.md / CLI-COVERAGE.md | Ship — owner pick (option 2 from the verb-split AUQ: ship now, file browser-comments ENH for Sprint 18) |

## Side branch — GitHub-integration planning (`claude/github-integration-planning-rPdVY`)

**Status:** Parallel planning thread, NOT on main. Opened 2026-05-13 after ENH-149 closed + ENH-150 was filed. Owner answered a 4-feature AUQ (status overlay / clone / right-click GitHub menu + bounce-list / link folder to repo) picking all four; said "playground it first" for the link-folder-to-repo decision.

| ID | Title | This-branch deliverable |
|---|---|---|
| **ENH-151** | `duo clone <url>` + File → Clone… modal | Promoted from sketch in tasks.md — full top-level entry with plumbing checklist; interim auth-missing UX defined (Doctor swap-in later) |
| **ENH-152** | Navigator git status overlay (root chip first; per-file dots follow-up) | Promoted from sketch in tasks.md — sliced into ENH-152a (root chip) + ENH-152b follow-up; clean stays invisible per owner directive |
| **ENH-154** | Link a local folder to a GitHub repo (new or existing) | Planning playground at [`../research/link-folder-to-repo.html`](../research/link-folder-to-repo.html); 5 owner decisions pending Copy-decisions paste-back |
| **ENH-155** | Right-click GitHub menu (Open on GitHub + Copy GitHub URL) + bounce-list update | Filed; small surface (CLAUDE.md SSO bounce requirement bundled) |

**Coding gate.** All four wait until owner walks ENH-154's playground AND the deferred Sprint 17 walk lands. Avoids piling new walk debt on top of v0.6.16's already-deferred close-out walk.

**When the gate clears.** Sequence is probably ENH-152 root chip → ENH-155 → ENH-151 → ENH-154 (chip first because every other feature reads `git remote` / `git rev-parse`; a shared `core/git/` helper extracted from the chip work is a no-regrets refactor for the rest).

---

**Memories filed during Sprint 17:**

- [`feedback_verify_current_behavior_before_proposing_fix.md`](../../memory/feedback_verify_current_behavior_before_proposing_fix.md) — don't claim what would be "lost" by a change based on how code SHOULD work; verify empirically first. Triggered by BUG-123 spike where I framed an A/B/C trade-off claiming "Option A loses in-table multi-cell drag" — owner caught: it doesn't work today, so there's nothing to lose. The fix turned out to be much simpler than the redesign I'd proposed.
- [`feedback_auq_descriptions_must_be_short.md`](../../memory/feedback_auq_descriptions_must_be_short.md) — AskUserQuestion UI truncates long descriptions; keep each option ≤ 1 sentence (~15 words). Long context goes in the chat reply BEFORE the AUQ call.

**New tracked items filed during Sprint 17:**

- **BUG-124** — `writeConflictLog` floods dev stderr with ENOENT because `~/.claude/duo/logs/` isn't mkdir-p'd at install. Manual mkdir applied as workaround; structural fix queued (two-line option: install-service mkdir OR `files.write` mkdir-p generically). Surfaces during ENH-144 verification.
- **ENH-148** — Navigator multi-select v2: ⇧-click range + ⌘-A select-all-visible + (optional) CLI nav-state extension to expose `selectedPaths` array. Anchor + scope decisions specified.
- **FOLLOWUP-020** — CLI parity gap. `duo close-tab` for active working / terminal tab doesn't exist. Full plumbing checklist documented (shared/types + socket-server + main + App.tsx + cli/duo.ts + skill + agent + CLI-COVERAGE + what-duo-does entry 55b placeholder swap).

## Owner walk owed before v0.6.16 cut

The walk is **deferred**; owner: "won't be able to walk for a while longer; please commit your work; then do a doc and breadcrumb sweep, commit and push." The breadcrumb sweep is happening now; the walk is the next gate.

When walk-time arrives, the smoke-walk manifest should cover:

1. **ENH-144** — open file tabs A, B, C; activate B; close B; verify A activates (NOT C, NOT browser pane). Edge: close leftmost (A) → B activates. Edge: close the only file tab → falls back to `{ kind: 'browser' }`.
2. **ENH-147 v1** — ⌘-click multiple files in the navigator; verify each row paints with `bg-accent`; right-click one of the selected rows; verify menu shows "Move N items to Trash…"; click → batch trash + selection clears + parent dirs refresh.
3. **ENH-143** — open `~/.claude/duo/packs/duo-default/canvases/what-duo-does.html` in canvas mode; search for "Close the active tab"; confirm entry 55b is present + reads coherently adjacent to entry 56's delete-file.
4. **BUG-123 v1** — open a markdown file with a table; click into A1, drag to C2 mouse-up; verify orange-tinted overlay on cells A1+A2+B1+B2+C1+C2 (Apple-Numbers-style cell selection visual). Edge: drag from cell to text outside the table — selection collapses to a single cell (today's behavior; cross-boundary is deferred to v2).
5. **ENH-146** — owner's confirmation that future playground generations actually inline the kernel + skip authoring the CSS block. Validated by the next playground I generate post-Sprint-17. (ENH-154 playground in walk-item 8 is the first one — confirms the kernel-inline pattern works in practice.)
6. **BUG-079 + ENH-084 v4 instrumentation** — both fire correctly when triggered; capture the streams when the bug surfaces. NO direct walk needed (passive instrumentation).
7. **Carryover from v0.6.15:** owner's pending enterprise smoke on work machine — ENH-141 BANNER-UI + WORK-MACHINE rows + BUG-119 quit-crash confirmation. **This is the v0.6.15 carry-forward, not Sprint 17 work** — but flagged so the v0.6.16 cut waits on it too.
8. **ENH-154 playground walk (off-Sprint-17, on side branch merged to main)** — `duo open docs/research/link-folder-to-repo.html`. Walk 5 decision cards (entry-point shape · pre-state risk policy · default visibility · multi-host gh · post-link behavior); decide each radio; add any general-comments. Hit **Copy decisions** and paste back. Gates coding on ENH-151 / ENH-152 / ENH-154 / ENH-155 (the GitHub-integration cluster). Also doubles as the ENH-146 kernel-inline validation per walk-item 5.
9. **ENH-156 — verb-split (HTML default routing).** Three tests:
   - `duo open /tmp/verb-test-playground.html` (an HTML with NO `duo-open-in` meta) → should land in the BROWSER PANE (pre-ENH-156 behavior: would have landed in canvas). Scripts should run if the page has any. Verify via `duo layout` → `main.kind: 'browser'` + `main.url: file://…`.
   - `duo edit /tmp/verb-test-playground.html` (same file) → should land in CANVAS MODE (PageTab). Buttons render but clicks place a cursor. Verify via `duo layout` → `main.kind: 'page'` + `main.path: /tmp/verb-test-playground.html`.
   - `duo open docs/research/link-folder-to-repo.html` (HAS `duo-open-in="browser"` meta — should continue working identically) → browser pane (no regression from existing playgrounds).
   - Edge: double-click a `.html` file in the navigator → browser pane (CLI/UI parity with `duo open`).
   - Edge: `duo open /tmp/verb-test-playground.html --canvas` → forces canvas mount (rare override case).

## Sprint 17 carry-forward (most likely Sprint 18 candidates)

| ID | Title | Gate |
|---|---|---|
| **BUG-079 deep-fix** | Tab-cycle latency. Instrumentation in place; awaits production repro for forensic capture | Owner triggers the latency naturally in normal use; trace lands in dev log |
| **ENH-084 v4 fix** | Aux pane focus glow. Instrumentation in place; awaits owner ~60s click-around walk between main + aux to capture the event stream | Owner walks (5 min) and pastes back the captured `[ENH-084-v4]` log block |
| **BUG-093** | Move to Split View renderer crash. Carried from Sprint 16 | User-triggered repro |
| **BUG-122 deeper fix** | Save-conflict banner re-surface. Defensive hardening already shipped v0.6.15; deeper fix gated on next-repro `~/.claude/duo/logs/last-conflict.log` capture | Next user repro |
| **BUG-123 v2** | Cross-boundary drag-to-outside-table — `tableEditing()` collapses to single-cell CellSelection when target leaves table; may be tractable via high-priority `handleDOMEvents.mousemove` override | Owner walks v1; if cross-boundary feels broken once cell selection is visible, file v2 follow-up |
| **BUG-124** | `writeConflictLog` logs-dir mkdir gap | None — half-day standalone |
| **ENH-148** | Multi-select v2: ⇧-click + ⌘-A + CLI parity | None — half-day to full-day depending on range-select cross-folder decision |
| **FOLLOWUP-020** | `duo close-tab` for active working/terminal tab — CLI parity for ⌘W | None — half-day with full plumbing checklist |
| **ENH-137** | Beginner's Guide content (`packs/duo-default/canvases/beginners-guide.html`) | Owner-authored draft |
| **ENH-141 enterprise smoke** | v0.6.15 work-machine validation | Owner's work-machine session |
| **ENH-157** | Comments in the browser pane (CDP-injected sidecar overlay) — closes the gap ENH-156 exposed: `duo html comment` is canvas-only today, so users who `duo open` a playground must `duo edit` to comment. CDP-injection pattern mirrors ENH-094's playground actions; sidecar reads route through main, same shape as canvas-mode plumbing. P1 — load-bearing for "make artifact + open + comment" outcome | None — Sprint 18 anchor candidate. Half-to-full sprint of work. |

## v0.6.16 cut prep

When owner walks + signs off:

1. Walk results land via the smoke-walk skill.
2. FAIL/SKIP rows trigger fix commits or get deferred + filed.
3. cut-version skill drafts release notes; owner picks "cut" / "rework" / "defer."
4. PACK.json bump (1.0.2 → 1.0.3) per ENH-138 — ENH-143 added entry 55b to what-duo-does.html, so existing users get the pack-version notification on next launch.
5. Cut commits + signed DMG via `bash scripts/dist-signed.sh`.
6. Push tag + release.

---

## Sprint 16 cut record (CLOSED 2026-05-11; v0.6.15 cut)

**Theme:** **A+B combined — install/upgrade close-out + stability sweep.** Sprint 16 opened 2026-05-10 with commits 1+2 (ENH-141 + BUG-121) shipping as the v0.6.14 same-day enterprise hotfix; commits 3-9 (BUG-119, FOLLOWUP-019, ENH-140 cluster, BUG-122 hardening + diag enrich, ENH-142) shipped as the v0.6.15 close-out 2026-05-11.

> **Status: v0.6.15 cut 2026-05-11.** Both v0.6.14 + v0.6.15 detailed in § "Cut records" below. Sprint 15 detail in § "Sprint 15 retrospective".

## v0.6.15 cut record (2026-05-11)

Sprint 16 close-out commits 3-9. Auto-mode run; owner directive at session start: "continue through all remaining sprint work, and if all good, please begin cut procedures."

| Commit | Item |
|---|---|
| [`4f47017`](https://github.com/dudgeon/duo/commit/4f47017) | **BUG-119** — fsevents SIGABRT on Cmd-Q. Disposes moved into `before-quit`; verified clean exit via osascript Quit Apple Event. |
| [`5991c43`](https://github.com/dudgeon/duo/commit/5991c43) | **BUG-085 audit + FOLLOWUP-019 filing.** Stale status correction (BUG-085 shipped Sprint 6); FOLLOWUP-019 named for what BUG-085 note (c) had left as "FOLLOWUP-NN" placeholder. |
| [`d6b6129`](https://github.com/dudgeon/duo/commit/d6b6129) | **FOLLOWUP-019** — canvas-side external-write reconciliation. Mirrors BUG-085 + BUG-099 to PageTab.tsx. Verified live (clean reload + dirty banner + pre-save bail). |
| [`f57bc95`](https://github.com/dudgeon/duo/commit/f57bc95) | **ENH-140 + pin URL auto-migration + op #8 pivot.** Three install-service changes in one cluster commit. Reuses `installed.json § files` SHA map for orphan diff; rewrites stale pins.json entries via PIN_RENAMES; bootstraps pins.json from each pack's `defaults[].pin: true`. |
| [`d55b314`](https://github.com/dudgeon/duo/commit/d55b314) | **BUG-122 filed.** Same-sprint interrupt: owner repro of the "file changed on disk" banner re-surfacing on v0.6.14 production DMG. |
| [`d2937be`](https://github.com/dudgeon/duo/commit/d2937be) | **BUG-122 defensive hardening.** Shared `conflictDiagnostic.ts` helper; TTL 2s → 5s; widened normalize; production-readable disk log. |
| [`f77b6c0`](https://github.com/dudgeon/duo/commit/f77b6c0) | **BUG-122 diagnostic enrichment + `duo doc conflict-log` verb.** Inline `firstDiffOffset` + tail excerpts in console; new CLI verb dumps the log file in one keystroke. |
| [`6637f01`](https://github.com/dudgeon/duo/commit/6637f01) | **ENH-142** — Claude-tab Enter key prefs. Plain Return default flipped 'newline' → 'submit'; Shift+Return → newline stays default; both behind `duo claude-return` + `duo shift-return` CLI toggles. |

**Two B-bucket items deferred to v0.6.16:**

- **BUG-093** — Move to Split View renderer crash. CLI repro attempted via synthetic `⌘/` chord; no crash, full instrumentation trace fired correctly (`[BUG-093] ENTRY → beginning swap → COMMITTED`). FOLLOWUP-013 updated with the no-repro outcome; instrumentation remains in place. Original v0.6.7 rev3 repro was user-typed bullets + comment, hard to simulate fully via CLI.
- **ENH-084 v4** — Aux pane focus glow. Declined per task entry's own "do NOT ship a v4 without studying these failures" guidance; needs instrumentation pass + live-click event-stream capture first (mistimed for end-of-sprint).

**v0.6.16 punch list carried forward:**
- BUG-093 — awaiting user-triggered crash + the `[BUG-093]` + `[ErrorBoundary:WorkingPane]` log combination.
- ENH-084 v4 — instrumentation pass first.
- BUG-079 — ⌃⇧\` tab-cycle latency (bumped from this sprint).
- BUG-122 deeper fix — gated on next-repro `~/.claude/duo/logs/last-conflict.log` contents.
- ENH-141 enterprise smoke — owner-side validation on work machine.
- ENH-137 Beginner's Guide — owner-authored draft pending.

---

## Sprint 16 commits already shipped (v0.6.14)

| Item | Status |
|---|---|
| **ENH-141** — drop `duo` CLI into SHIM_DIR (`~/.claude/duo/bin/`) so it works inside Duo PTYs and Claude Code sandboxes without `.zshrc` edits + fold `addToShellPath` into the FirstLaunchBanner [Install] action so the click also auto-wires `~/.local/bin` to `~/.zshrc` for external Terminal/iTerm use | ✅ shipped v0.6.14 (smoke walk 2/PASS 3/SKIP — BANNER-UI + WORK-MACHINE rows pending the enterprise install) |
| **BUG-121** — closing the last browser tab respawns about:blank in a loop. Dropped BUG-020 + BUG-096 spawn-replacement guards (motivation retired in v0.6.13's FAQ removal); `tabs.length === 0` is now a supported empty state; null-guarded all `activeView()` callers | ✅ shipped v0.6.14 (CLI-verified end-to-end) |

## Sprint 16 remaining plan (post-v0.6.14, cut target v0.6.15)

### A-bucket — Install/upgrade close-out ✅ shipped Sprint 16 commits 3 + 5

| ID | Title | Status | Estimate |
|---|---|---|---|
| **BUG-119** | fsevents shutdown race — SIGABRT every Duo quit. Moved `filesService.dispose()` + `ptyManager.dispose()` + flushes into `before-quit` so chokidar releases its native fsevents handle before V8 isolate teardown. Verified via osascript Quit Apple Event: no new crash report. | ✅ Sprint 16 commit 3 | ~30 min (actual) |
| **ENH-140** | Orphan file cleanup on upgrade. **Design simplified:** reused existing `installed.json § files` SHA map (Stage 21e-iii) rather than a new `installed-files.json`. `cleanupOrphans(prevShas, newFiles)` runs post-write — matched-SHA orphans deleted, customized files preserved + logged. Empty-dir sweep handles `help/` etc. when last contained file retires. Verified live with injected fake files (matched-SHA → deleted ✅; mismatched-SHA → preserved ✅). **Known limitation:** v0.6.13/v0.6.14 legacy orphans (`help/faq.html`, retired pack dirs) aren't tracked in prevShas so they don't auto-clean; v0.6.15+ retirements going forward do. | ✅ Sprint 16 commit 5 | ~half-day |
| **FOLLOWUP: pin URL auto-migration** | `migrateStalePinUrls()` walks pins.json on every install, rewrites known v(N-1)→v(N) renames (PIN_RENAMES map: `duo/help/what-duo-does.html` → `duo/packs/duo-default/canvases/what-duo-does.html`), drops pins for retired-no-successor entries (`duo/help/faq.html` → null). Idempotent. Verified live: owner's stale `help/what-duo-does.html` pin migrated correctly + other user-pins preserved. Closes the documented "two WDD tabs" transient. | ✅ Sprint 16 commit 5 | ~1 hr |
| **FOLLOWUP: op #8 pivot to pack-defaults iteration** | `bootstrapPinsFromPackDefaults(sourceRoot)` reads each `packs/*/PACK.json` and seeds pins.json from `defaults[].kind === 'canvas' && defaults[].pin === true` entries. Pin title extracted from each canvas's `<title>` element (falls back to pack.title). Replaces hardcoded WDD literal. Verified live: renamed pins.json away → install → seeded with `What Duo Does` pin from duo-default pack manifest. | ✅ Sprint 16 commit 5 | ~1 hr |

**A-bucket total:** ~1 day. End state achieved: enterprise-friendly install + upgrade story closes cleanly — fresh installs bootstrap pins dynamically from pack manifests, upgrades clean up after themselves, stale pinned tabs auto-migrate.

### B-bucket — Stability sweep (owner picked all 4 candidates 2026-05-10)

| ID | Title | Status | Estimate |
|---|---|---|---|
| **FOLLOWUP-019** (was BUG-085 layer-3) | **2026-05-11 audit:** Owner picked "BUG-085 layer-3" thinking docs were owed; audit confirmed all 3 layers (watcher + pre-save reconciliation + skill/agent docs) already shipped in commit `a4c56dc` (Sprint 6). BUG-085 status entry was stale at 🔴 IMMEDIATE for 3 sprints. Real owed work: mirror the BUG-085 + BUG-099 fixes from `MarkdownEditor.tsx` to `PageTab.tsx` (HTML canvas) — same scope, same data-loss class, just the canvas surface. Parent BUG-085 disposition upgraded from (c) Deferred to (a) Mirrored per CLAUDE.md § 4. | 🟢 P0 — same data-loss class as markdown variant; closes editor-canvas parity gap | ~half-day |
| **BUG-093 clean-repro investigation** | Right-click tab → Move to Split View crashes the renderer. Instrumented in v0.6.7 (WorkingPane drops to localized error panel; rest of app keeps running). FOLLOWUP-013 is the clean-repro tracking item — needs a reliable trigger sequence to bisect. | 🟢 P0 — when it fires, real crash from real user gesture | ~half-day if repro lands quickly |
| **BUG-122 (swap-in 2026-05-11)** | Save-conflict banner re-surfaces in v0.6.14. ✅ Defensive hardening shipped (commit 7): TTL bump 2s→5s, widened echo normalization (BOM + CRLF + per-line trailing whitespace), `~/.claude/duo/logs/last-conflict.log` production-readable diagnostic. Verified live: log file lands with firstDiffOffset + head/tail excerpts + appVersion stamp. **Deeper-fix gate:** awaiting next repro's log contents — `firstDiffOffset` + head excerpts tell us deterministically whether it's hypothesis 2 (cloud-sync BOM/CRLF), 3 (TTL — already widened to 5s, may suffice), or 4 (tiptap round-trip non-idempotency). | ✅ Sprint 16 commit 7 — hardened | ~half-day (actual) |
| ~~**BUG-079 tab-cycle latency probe**~~ — bumped to v0.6.16 | ⌃⇧\` reverse-cycle has multi-second latency + requires re-presses. Bumped to make room for BUG-122. ~half-day diagnosis + fix when it returns. | 🟡 P1 → deferred | — |
| **ENH-084 aux focus glow v4** | Aux pane focus indicator (orange glow when active in side pane). Three v0.6.5 attempts all failed (v1 mousedownCapture missed iframe clicks; v2 gate-removal sacrificed exclusivity; v3 focusin listener didn't reach iframe focus). v4 needs a fresh architectural read — probably tracks main-process focus events via `before-input-event` + an IPC broadcast rather than fighting iframe focus boundaries from the renderer. | 🟡 P2 — owner explicitly green-lit a 4th attempt | ~half to full day (risky; bail-out plan: log v4 defect alongside v1-v3 + move on if no progress within ~3 hr) |

**B-bucket total:** ~1.5–2 days.

**Sprint 16 total budget:** ~2.5–3 days remaining work + cut.

## Recommended commit order

1. **BUG-119** (30 min) — smallest, fixes every-quit crash dialog. Standalone.
2. **FOLLOWUP-019** (half-day) — mirror BUG-085's watcher + pre-save reconciliation + echo guard from `MarkdownEditor.tsx` into `PageTab.tsx`. Code change (not docs); original "BUG-085 layer-3" item the owner picked turned out to be already shipped (Sprint 6 commit `a4c56dc`).
3. **ENH-140 + pin URL auto-migration + op #8 pivot** (~1 day) — A-bucket cluster, all touch `install-service.ts`. Land as one commit (or 2 if op #8 pivot wants its own diff).
4. **BUG-122** (half-day) — swap-in 2026-05-11 per owner directive. Defensive hardening first (TTL bump + better echo normalization + production-readable diagnostic log); deeper fix gated on next repro's captured data. BUG-079 latency probe deferred to v0.6.16.
5. **BUG-093 clean-repro** (half-day) — bisect via instrumented build. May complete in a single afternoon if repro lands; otherwise file owned findings + move on.
6. **ENH-084 v4** (last — risky) — set 3-hour bail-out; if no traction, log v4 defect alongside v1-v3 and defer to v0.6.16.
7. **v0.6.15 cut** via cut-version skill.

## Open questions still needing Geoff's input

| Question | Priority |
|---|---|
| **ENH-137 Beginner's Guide** — when's the owner-authored draft landing? Drops into `packs/duo-default/canvases/beginners-guide.html` via pack-version bump (existing users see it auto-fire). | Surfaces in v0.6.15+ when draft exists |
| **ENH-118 image-type handling** — animate GIFs by default vs freeze first-frame Slack-style? SVG safety review owed? HEIC/RAW reject vs convert? | Before any image-polish sprint |
| **ENH-101 expand/collapse chord semantic** — rail-collapse (new behavior orthogonal to ⌘⌥0/9) vs full-screen (redundant; kill the chord)? | When the chord re-surfaces |
| Stage 17a.5 directions A/E (template gallery / registry) | Before any code work on templates |
| BUG-024 follow-up — combine Send → Duo + Comment pills (single split-pill or hover flyout)? | Before further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — anchor for a future sprint? Or defer further? | When wikilinks-autocomplete usage tells us whether the next-tier capability has demand |

## v0.6.14 cut record (2026-05-10)

Shipped same day Sprint 16 opened. [GitHub Release](https://github.com/dudgeon/duo/releases/tag/v0.6.14) (signed + notarized + stapled + validated DMG).

- **ENH-141** install-path hardening — `cli/duo install` tier-1 target moved from `~/.claude/bin/duo` → `~/.claude/duo/bin/duo` (the SHIM_DIR, already on PTY $PATH for the claude shim). Electron `installCli()` now also drops the SHIM_DIR symlink alongside its `~/.local/bin/duo` copy. FirstLaunchBanner [Install] click now folds `addToShellPath()` for external-terminal use. Reaches PTY $PATH inside both Duo terminals and managed Claude Code installs (where `.zshrc` writes are sandboxed out).
- **BUG-121** browser-tab respawn — Dropped BUG-020 + BUG-096 spawn-replacement guards (their motivation retired in v0.6.13's FAQ removal). `tabs.length === 0` is now a supported empty state; `activeView()` returns `WebContentsView | null`; all callers null-guarded. Closing the last browser tab no longer triggers an about:blank respawn loop. `navigate()` self-heals from the empty state via addTab+switchTab.
- **Smoke walk:** 2 PASS / 3 SKIP / 0 FAIL ([results](smoke-walks/v0.6.14.results.md)). 2 of the 3 SKIPs (BANNER-UI + WORK-MACHINE) are deferred to the production smoke on the enterprise install — owed before any "Sprint 16 done" claim.

---

## Sprint 15 retrospective (closed 2026-05-10)

**Theme:** Repo cleanup close-out + FTUX-content-→-packs migration + enterprise-friendly install hardening.

**Outcome:** v0.6.13 cut shipped. Tag pushed; DMG on GitHub Release. All P0 commitments landed. Two follow-ups filed (BUG-119, ENH-140) for Sprint 16.

### Shipped in v0.6.13 (5 sprint commits + cut + bump + 1 ledger entry)

| Commit | Item |
|---|---|
| `7a38fb1` | **ENH-136** — `git mv packs/claude-code-basics/ examples/lesson-pack-template/`. PACK.json renamed; internal `claude-code-basics` references bulk-renamed; new README walks the copy-customize flow. Skill cross-refs in `skill/lesson-runtime.md`, `skill/lesson-flythrough.md`, `skill/make-playground.md`, `skill/examples/curriculum-template/README.md`, `skill/examples/canvas-templates/lesson-scaffold.html` updated. |
| `20b83ca` | **BUG-118** — `cut-version` skill Step 4 adds `git diff --quiet cli/duo` post-`npm run build:cli` guard. Future cuts can no longer silently ship stale binaries. |
| `58c8fdf` | **ENH-138 + ENH-135 folded** — `packs/duo-default/` created with `PackManifest.builtIn: true` schema flag; `git mv help/what-duo-does.html → packs/duo-default/canvases/`; `git mv help/faq.html → docs/legacy/faq.html`; install-service op #8 pivoted (drops FAQ pin, repoints WDD URL to pack); `defaultLandingUrl()` + `helpUrl()` deleted from `browser-manager.ts`; `bootDefaultTab` constructor option dropped; `fork.config.default.json § helpPinnedFiles` drops `"faq.html"`. Comment refs throughout updated. |
| `3103ed2` | **BUG-116** — `scripts/dist-signed.sh:154` passes explicit version-pinned DMG path to `validate-dmg-launch.sh` (was: alphabetical glob silently validated v0.6.8 instead of v0.6.12 during the prior cut). |
| `ec0893b` | **Pack-canvas / pinned-tab idempotency contract ADR** — owner-raised at smoke walk close-out: "stale Duos on upgrade won't see the new WDD." First-launch hook in `electron/main.ts` reads `pins.json` membership; skips NAV_EDIT for URLs already pinned (avoids fresh-install double-open); fires NAV_EDIT for URLs not pinned (delivers new content to upgrade users). `openOnFirstLaunch: true` flipped back on (idempotency check makes it safe). Full design in `docs/DECISIONS.md § "Pack canvas / pinned tab idempotency contract"`. |
| `6d668af` | **release: v0.6.13** — CHANGELOG + RELEASES + roadmap + session-log updates. Tag `v0.6.13` (pushed). |
| `9d02b99` | **chore: bump to v0.6.14** for next sprint. |
| `243dbc7` | **docs(tasks): file BUG-119** — fsevents shutdown race producing SIGABRT every Duo quit. Pre-existing in v0.6.12; surfaced at Sprint 15 close-out. Fix scoped for Sprint 16. |

### Pre-cut commits (already on `main` before Sprint 15 work started)

These landed in the v0.6.12 → v0.6.13 cleanup batch (post-v0.6.12 cut, pre-Sprint-15 commit 1):

- `18725c7` — release: v0.6.12 (Sprint 14 — JSON/YAML viewer-editor pulled forward + visibility CLI + view-source panel-fill + image-handling close-out + Return semantics)
- `6822a66` — chore: bump to v0.6.13
- `ce74481` — chore(repo-clean): repo-root cleanup (rm RESUME.md, mv duo-brief.md → docs/, rm stray PNG, prune old DMGs)
- `32eab90` — docs(repo-clean): split README (535 → 168 lines + new `docs/dev/CONTRIBUTING.md` carrying dev content)
- `e4ff756` — docs(repo-clean): trim tasks.md (pruned BUG-001..BUG-017 era entries; -697 lines)
- `089521f` / `650609b` — docs(research): ENH-134 planning artifact + CLAUDE.md § 11 rule (planning artifacts default to HTML interactive playgrounds, not plain markdown)
- `bf8db68` — docs+fix: ENH-134 refocus + BUG-117 hardening + 4 follow-up filings (BUG-116, BUG-117, ENH-135, ENH-136, ENH-137)
- `8d1f96e` — fix(cli): rebuild stale cli/duo binary (v0.6.12 cut committed pre-rebuild copy)
- `e2b1f8c` — docs(tasks): file BUG-118
- `f04f113` — docs(install): file ENH-138 + capture "FTUX content → packs" principle in playground § 5
- `3e00bc7` — docs(breadcrumbs): close ENH-134 + capture decisions + Sprint 15 plan + ENH-139 schema-extension follow-on

### Smoke walk shape

- **`docs/dev/smoke-walks/v0.6.13.json`** — manifest with 3 items (existing-user-no-regression, ⌘T blank, DMG fresh-install deferred).
- **Walk-1 owner result:** 1 PASS + 2 FAIL. Both FAILs diagnosed as test-environment artifacts:
  - FAIL 1 (existing-user-upgrade): dev `pins.json` had developer-only repo-path pins (FAQ + WDD) pointing at moved files. Migrated to point at the new pack location + closed 3 broken tabs.
  - FAIL 2 (DMG fresh-install): owner ran `dist-signed.sh` pre-cut in wrong cwd; cleared at cut time when the script ran successfully end-to-end during Step 4.5.
- **Scenario B upgrade simulation (post-cut):** reverted `pins.json` WDD URL to v0.6.12-style + removed `duo-default@1.0.0` from `installed-packs.json` → installed v0.6.13 DMG over v0.6.12 → launched. First-launch hook fired correctly (`duo-default@1.0.0` re-flagged with new timestamp). Idempotency check ran. `openTab` deduped the pack URL against the existing session-restored tab (owner already had the pack URL open from dev work). Net: hook activated the pack-WDD tab rather than creating a duplicate. Two-tabs outcome from the ADR matrix is logically derived but not directly screenshotted in this dev-state run; would require also clearing session-state.json.

### Carry-forward to Sprint 16

Surfaced at close-out (now in the Sprint 16 Candidates table above):

- **BUG-119** — fsevents shutdown race. ~10 LOC fix; pre-existing pre-Sprint-15. Recommend as Sprint 16 commit 1.
- **ENH-140** — install-service should track + cleanup orphan files on upgrade (provenance manifest pattern, model after Stage 21d distro-pack-service's `InstalledFilesManifest`). The v0.6.13 cut left two known orphans on every upgrade user: `~/.claude/duo/help/faq.html` and `~/.claude/duo/packs/claude-code-basics/`. Pairs with the pin URL auto-migration follow-up.
- **Pin URL auto-migration follow-up** — install-service auto-rewrites `pins.json` entries pointing at v(N-1) paths to v(N) successors. Closes the "two WDD tabs" upgrade transient documented in v0.6.13 CHANGELOG as a known issue.
- **Op #8 pivot follow-up** — replace the hardcoded WDD URL literal in `install-service.ts § op #8` with iteration over `packs/*/PACK.json § defaults[].pin: true`. Removes the last duplicated default-pin code path.

### One callout deliberately deferred

The v0.6.13 GitHub Release notes do NOT explicitly call out the "two WDD tabs on first launch after upgrade" transient (the known-issue is in the CHANGELOG but not the release-body callout). Filed for later — install base is tiny (one owner, one or two machines) so end-user confusion isn't a near-term risk. Pin URL auto-migration follow-up will resolve the underlying issue before any wider rollout.
