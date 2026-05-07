# Active sprint state — Sprint 10 (v0.6.10, planning pending)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record — Sprint 9 close-out (v0.6.9 cut +
> wikilinks closure + pane-jump chord set + duo edit reliability +
> workshop substrate + automated regression coverage) — lives in
> [docs/dev/session-log.md](session-log.md) under the 2026-05-07
> entry.
>
> **Update cadence:** at the end of each commit (mark a phase row
> done; flip the "next" pointer; add deviations).

---

## Sprint 10 (v0.6.10) — pending sprint-plan session

**Sprint goal — TBD pending sprint-plan.**

**Strong candidates** (carry-overs from Sprint 9 walks + tasks.md):

### P0 candidates
*None pre-locked.* The Sprint 9 cut closed the v0.6.8 P0 carry-over
(ENH-096 wikilinks). No P0-by-directive item is queued for Sprint 10.

### P1 candidates — Sprint 9 walk-3 carry-overs
- **BUG-101 browser-routed half** — `duo open <url>` sometimes returns ok with the tab present in BrowserManager state but the renderer's working pane doesn't flip to browser-kind. Same shape as the editor-routed half fixed in v0.6.9, different code path. Surfaced live during the v0.6.9 cut process (the rev2 walk page returned about:blank from `duo url` until `duo tab N` was explicitly run).
- **BUG-106** — `duo edit <non-existent-path>` opens the tab but editor errors with ENOENT. Recommended: mount empty buffer + flag as new-file (symmetric with `⌘N` flow). Affects automation flows like `touch + duo edit`.
- **ENH-108** — cmd+click on `[[Does Not Exist]]` wikilink should create the file at vault root (Obsidian parity, owner-requested via v0.6.9 walk-2 OTHER NOTES).
- **BUG-100** — Send→Duo pill missing on text selections inside the split-view aux browser pane.

### P2 candidates
- **BUG-104** — file-changed-on-disk dialog fires unexpectedly after ⌘⇧; chord (low — possible chokidar reconciliation race).
- **BUG-105** — right-click → Copy path on a tab is a no-op (menu entry exists; action doesn't fire).
- **BUG-102** — split view goes blank while ⌘⇧A palette is open (aux WCV mute too aggressive in narrow-split layouts; owner-flagged "non urgent" in v0.6.9).
- **FOLLOWUP-013** — BUG-093 right-click split-view crash repro hunt (instrumentation landed v0.6.7; awaits clean repro).
- **ENH-103 + ENH-104** — SaveControl consolidation + autosave toggle. Paired; needs owner UX sign-off on the four-state visual treatment before code.
- **ENH-101** — expand/collapse chords ⌘⌥T/⌘⌥C — owner-deferred from Sprint 9; revisit semantic (rail-collapse vs. full-screen).
- **ENH-099** — 3-way 33/33/33 layout chord. Architecture decision; defer until 3-way layouts prove a real workflow need.
- **ENH-100** — lock/unlock context menu verb (canvas-only meta exists; surface via right-click).
- **ENH-105** — `@` filename autocomplete in canvas editor (multi-day; pairs with ENH-096 B2 wikilink autocomplete; same fuzzy-popover primitive).

### Older filed items (low signal unless owner pulls forward)
BUG-079, BUG-091, BUG-083, BUG-073, ENH-082, ENH-094, ENH-077, ENH-027, ENH-047, ENH-048, FOLLOWUP-002, FOLLOWUP-003, FOLLOWUP-004, FOLLOWUP-006, FOLLOWUP-007.

### Stretch — cohort-distribution end-to-end validation
The v0.6.8 Stage 21d substrate + v0.6.9 ENH-106 workshop substrate ship, but neither has been validated on a non-Geoff machine. A real pack builder walking the workshop's `playground.md` end-to-end closes that gap (also closes FOLLOWUP-011).

---

## Sprint 9 (v0.6.9) — ✅ CUT 2026-05-07

Closed the v0.6.8 P0 carry-over (ENH-096 wikilinks cmd+click navigation) plus shipped a new chord vocabulary (⌘⇧L/⌘⇧;/⌘⇧') + `duo focus-pane` CLI parity + three layers of `duo edit` reliability bug + ⌘⇧⌫ delete-file chord + ⌘T URL-bar focus reclaim (BUG-103) + the Distro Pack Builder Workshop scaffolding + automated test coverage for the long-recurring BUG-056 pill-gating regression. ENH-091 caret seed deferred indefinitely per owner directive (override fires after Chromium internals).

Three smoke-walk rounds (one autonomous, two with owner). 17 test files / 298 tests green (up from 281 at sprint start; +13 chord matchers, +7 wikilink resolver, +3 BUG-056 IIFE-source asserts). Carry-overs to Sprint 10 listed above.

---

## Sprint 8 (v0.6.8) — ✅ CUT 2026-05-06

Anchor (Stage 21d cohort distribution) shipped. Three feature
surfaces alongside (ENH-080 ⌘⇧A palette, ENH-096 wikilinks Tier A
+ B1 partial, ENH-097 modality lock). Three Phase-0 polish items
shipped (ENH-091 partial, BUG-097 fixed, FOLLOWUP-008 done).
Walk-1 root-cause fixes for BUG-099 autosave race + ENH-080
walk-1 bugs + the Stage 21d uninstall pre-walk-surfaced bugs
(`c1bb133`).

---

## Workflow reminders

**Read first when picking up an in-flight initiative:** this file
points at the formal PRD + tracks commit-by-commit progress.

**Sprint-plan skill** (`/.claude/skills/sprint-plan/`) — proactively
offer when picking up a fresh session. Harvests candidates from
this file + tasks.md + roadmap.html + session-log.md.

**Cut-version skill** comes after the sprint walks clean.
