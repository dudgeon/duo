# Active sprint state — Sprint 10 (v0.6.10, committed 2026-05-07)

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

## Sprint 10 (v0.6.10) — committed 2026-05-07

**Theme:** Save/autosave clarity + adjacent paper cuts.

### P0 (anchor)
- **ENH-103 + ENH-104 paired SaveControl** — consolidates today's "Saved" / "Saving…" status indicator + the separate Save button into a single pill control with four color/text states:
  - **Saved** — muted gray text, button looks inert.
  - **Save** — solid `bg-accent` + white text, action-y / clickable.
  - **Saving…** — disabled state with spinner.
  - **Failed — retry** — red text on muted bg, click retries.

  Hover-reveal autosave on/off toggle adjacent to the SaveControl itself (zero new UI surfaces; the SaveControl owns the save concept, so it owns the toggle). Persists per-app via localStorage. Both editor (TipTap) + canvas surfaces. Owner-locked in this sprint plan: **pill button with color-state**, **hover-reveal toggle** (not View menu, not per-tab, not deferred).

### P1 (carry-overs)
- **ENH-108** — cmd+click on `[[Does Not Exist]]` wikilink creates the file at vault root + opens it (Obsidian parity). Pairs with the resolver path fixed in v0.6.9. Owner-requested via walk-2 OTHER NOTES.
- **BUG-101 browser-routed half** — `duo open <url>` sometimes returns ok with the tab present in BrowserManager state but the renderer's working pane doesn't flip to browser-kind. Same shape as the editor-routed half fixed in v0.6.9, different code path. Surfaced live during the v0.6.9 cut process.
- **BUG-106** — `duo edit <non-existent-path>` opens the tab but editor errors with ENOENT. Mount empty buffer + flag as new-file (symmetric with ⌘N flow).
- **BUG-105** — right-click → Copy path on a tab is a no-op. Menu entry exists; action doesn't fire. Likely missing dispatcher branch.

### Skip / Deferred to Sprint 11+
- **ENH-101 expand/collapse chords ⌘⌥T/⌘⌥C — KILLED 2026-05-07.** Redundant with ⌘⌥0/9 (full-pane chords already handle "full-screen this pane"). Closed in tasks.md; removed from backlog.
- **BUG-100** Send→Duo pill missing in split-view aux — defer.
- **BUG-104** file-changed dialog after ⌘⇧; — defer (owner-flagged low priority; possible chokidar race needing diagnostic instrumentation).
- **BUG-102** split-view blank during palette — already deferred (owner-flagged "non urgent").
- **FOLLOWUP-013** BUG-093 right-click split-view crash — needs interactive repro work.
- Older filed: BUG-079, BUG-091, BUG-083, BUG-073, ENH-082, ENH-094, ENH-077, ENH-027, ENH-047, ENH-048, ENH-099, ENH-100, ENH-105, FOLLOWUP-002 through -007.

### Stretch — explicitly Sprint 11 candidate
**Cross-machine cohort validation** deferred until ENH-108 ships in THIS sprint. Once Duo has an Obsidian-friendly vault editor (wikilinks render + cmd+click navigates + cmd+click creates), the demo for a real pack builder walking `distro-pack-builder/playground.md` end-to-end on a non-Geoff Mac is a much richer story. Not this sprint.

### Sequencing
1. **SaveControl + autosave toggle FIRST** — the anchor. Lock the design in time for an owner UI walk before the carry-overs land.
2. **Carry-overs in any order** — each is sub-day. ENH-108 has the most architectural shape (the resolver branch + file create + parent dir mkdir for path-bearing forms); the three BUGs are mechanical fixes once root cause is in hand.

(Source: AUQ in chat 2026-05-07; no worksheet generated.)

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
