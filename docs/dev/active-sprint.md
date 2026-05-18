# Active sprint state — Sprint 18 / v0.7.1 "Browser-pane completion"

**Theme:** Close the browser-pane-as-first-class-surface story that Sprint 17 opened (Send → agent + inspect + clone + GH menu). Sprint 18 finishes the chapter with auto-reload, comments-in-page, multi-select polish, and an agent-side claude-spawn verb.

> **Status (2026-05-18, post-v0.7.0-cut):** Sprint planning complete. 4 items pulled in; cut goal v0.7.1.

---

## 🔥 Post-compaction me: read this first

1. **v0.7.0 just shipped** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.0), signed+notarized DMG attached). Theme was GitHub-integration cluster + Send → agent rename. Sprint 17 fully closed (rev8 walk PASSED).
2. **Sprint 18 plan: "Browser-pane completion."** Pull list (owner-confirmed 2026-05-18):
   - **BUG-130** — Browser pane `file://` auto-reload (architectural; on roadmap).
   - **ENH-157** — Browser-pane comments (CDP-injected sidecar overlay for file:// HTML).
   - **ENH-148** — Multi-select v2 (⇧-click range + ⌘-A + CLI parity).
   - **ENH-164** — `duo terminal new --kind claude` CLI verb.
3. **Stretch (if room):** BUG-079 (tab-cycle latency — needs prod repro), FOLLOWUP-021 (`duo install --clean`).
4. **NOT in this sprint** (deferred): ENH-137 Beginner's Guide; ENH-141 enterprise smoke; ENH-118 / ENH-127 / Stage 17a.5 / Backlinks / BUG-123 v2 — all need owner-decision playgrounds first.

---

## Sprint 18 pull list

### BUG-130 — Browser pane `file://` auto-reload

**Status:** 🟡 Open · architectural · on roadmap as L2-PLAYGROUND-AUTORELOAD.

**Why it matters.** Owner's framing from rev4 walk: *"if we are going to use chromium for playground, with the agent mutating the playground, refreshing needs to be automated, or we need to use something other than chromium for playgrounds."*

When the agent edits a `file://` HTML file via `duo html *` or filesystem write, the browser tab pointing at that file doesn't auto-reload. User has to manually `duo reload` or close + re-open. This breaks the playground-as-live-surface story.

**Investigation lanes:**
- fsevents on `file://` URL → reload via `webContents.reload()` for matching tabs.
- Debounce strategy (Mass edits should fire one reload, not N).
- Edge cases: what about tabs the agent didn't edit but the user is viewing?
- Multiple tabs at the same `file://` URL — reload all.

**Out of scope for v1:** Hot Module Replacement / preserve scroll position. v1 is just "reload."

---

### ENH-157 — Browser-pane comments (CDP-injected sidecar overlay)

**Status:** 🟡 Open · filed during Sprint 17 GH-cluster prototype work.

**Why it matters.** Canvas + markdown editor have comments (rail + decoration). Browser-pane HTML files (the same files when opened via `duo open`, NOT `duo edit`) have no comment surface. Owner uses `duo open` for playgrounds; can't annotate them.

**Approach.** Same CDP-injection model as the Send → agent pill (SELECTION_OBSERVER_IIFE) — inject a comment-overlay IIFE that reads the `.duo.json` sidecar, paints anchored comment decorations, and surfaces a comment-add UI on selection.

**Plumbing:**
- Reuse comment data model from canvas (`recentComments[]` in sidecar; same anchor format).
- New `INJECT_COMMENTS_IIFE` in `cdp-bridge.ts` paired with `injectComments()` lifecycle.
- Page-side overlay paints comment markers + opens a thread popover on click.
- New CDP binding `duoCommentSubmit(payload)` to write new comments back to the sidecar.

---

### ENH-148 — Navigator multi-select v2 (⇧-click + ⌘-A + CLI parity)

**Status:** 🟡 Open · v1 shipped Sprint 17 (⌘-click toggle + multi-row trash).

**Why it matters.** v1 covers the non-contiguous case. v2 needs:
1. **⇧-click contiguous range** — VS Code / Finder muscle memory.
2. **⌘-A select-all-in-visible-dir** — capped at "current directory + immediate children" per memory rule (safety: don't select 10k descendants).
3. **CLI parity** — extend `NavStateSnapshot` with `selectedPaths: string[]` (today's `selected: string` is singular).

**Risk surface:** Make sure the keyboard shortcut handler doesn't intercept ⌘-A in editable surfaces (BUG-131-class regression).

---

### ENH-164 — `duo terminal new --kind claude` CLI verb

**Status:** 🟡 Open · filed during Sprint 17 close-out.

**Why it matters.** Pairs with the new `feedback_spawn_claude_for_testing_when_needed.md` memory rule — agent needs to set up `claudeLive=true` test conditions itself. Today's path (`duo send "claude\n"` + sleep) is brittle.

**Shape:**
- `duo terminal new` — spawns shell tab.
- `duo terminal new --kind claude` — spawns Claude tab.
- `--cwd <path>` — optional starting cwd.
- Returns `{ok: true, id: <uuid>, kind: '...'}` so callers can poll for claudePresence detection.

**Plumbing per CLAUDE.md § 4 plumbing checklist** — shared/types, preload, main, socket-server, cli/duo, skill/SKILL.md + agents/duo.md cheat-sheets, CLI-COVERAGE.md.

---

## Stretch items (pull if BUG-130 lands fast)

### BUG-079 — Tab-cycle latency

Already instrumented with `[BUG-079] switchTab` log lines + synthetic test ruling out IPC + cycleNext. Pending **production repro** — owner observation, then bisect using the existing trace.

### FOLLOWUP-021 — `duo install --clean`

A nuke-then-reinstall verb for the install service. Useful when installed.json drifts irrecoverably. Small scope.

---

## NOT in Sprint 18 (deferred — needs decision walks first)

| Item | Why deferred |
|---|---|
| ENH-118 image-type handling | Owner-decisions owed: animate GIF vs freeze first frame; SVG safety review; HEIC/RAW reject vs convert. Build playground before code. |
| ENH-127 (composer-window vs anti-accidental-submit) | Owner directive shape unclear; lower priority now that ENH-142 shipped the per-pref toggle. |
| BUG-123 v2 (cross-boundary cell selection) | After v1's cell-selection visibility, decide: ship cross-boundary text spanning OR close. |
| Stage 17a.5 (template gallery / registry) | Owner directive shape A vs E unclear. |
| Backlinks panel / graph view | Demand-driven — wait for wikilink autocomplete (v0.6.10) usage data. |
| ENH-137 Beginner's Guide | Bigger surface; better as its own sprint. |
| ENH-141 enterprise smoke | Owner-machine validation — pull when owner has the work machine handy. |

---

## What this is and isn't

**This is** the natural follow-on to Sprint 17 — closing the browser-pane-as-first-class-surface story (auto-reload + comments) and finishing v1 threads (multi-select v2). Plus the agent-self-setup verb that the rev8 retro flagged.

**This isn't** the Chrome-extension exploration (still on its own branch), the Obsidian-cluster next-tier (queued indefinitely), or any of the decision-walk-shaped items above.

**Cut goal:** v0.7.1. MINOR-bump if BUG-130 + ENH-157 both ship (new capabilities); PATCH if only the smaller items land.

---

## Carry-forward to Sprint 19

Anything from the Stretch list above that doesn't land; ENH-084 v4 (aux glow — needs 60s walk); BUG-093 (split crash); BUG-122 deeper fix; plus whatever owner-decision walks land between sprints.
