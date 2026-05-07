# Active sprint state — Sprint 9 (v0.6.9, in flight)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record — Sprint 8 close-out (v0.6.8 cut +
> Stage 21d distro packs + ⌘⇧A palette + Obsidian wikilinks +
> canvas modality lock) — lives in
> [docs/dev/session-log.md](session-log.md) under the 2026-05-06
> entry.
>
> **Update cadence:** at the end of each commit (mark a phase row
> done; flip the "next" pointer; add deviations).

---

## Sprint 9 — walk-3 verified, ready for cut (2026-05-07)

Three smoke-walk rounds. Final state below.

**Verified PASS:**
- ENH-096 wikilinks cmd+click (P0 owner directive) — walk-2.
- ENH-098 focus chords ⌘⇧L/⌘⇧;/⌘⇧' + `duo focus-pane` CLI (P1) — walk-3.
- BUG-101 `duo edit` editor-routed half (P1) — walk-3. Browser-routed half (`duo open https://...` not surfacing tab) carries to Sprint 10.
- ENH-102 ⌘⇧⌫ delete current file (P2) — walk-1.
- BUG-103 ⌘T new browser tab caret (P2 — surfaced + fixed mid-sprint) — walk-3.
- BUG-056 mandatory regression — moved to automated test coverage at [electron/cdp-bridge.test.ts](electron/cdp-bridge.test.ts); removed from smoke-walk skill's mandatory-items section.

**Deferred per owner directive:**
- ENH-091 caret seed (P1) — walk-2 traces showed seed sticks across rAF, override fires after Chromium internals. Owner: "low priority, do not revisit for a LONG time." Instrumentation stays in code.

**Shipped, awaiting end-to-end validation:**
- ENH-106 Distro Pack Builder Workshop (P1) — scaffolded (folder + CLAUDE.md + playground.md + assistant skill). SKIP'd in all three walks; not blocking but unvalidated by a real builder.

**Carry-overs to Sprint 10 (filed in tasks.md):**
- **BUG-104** — file-changed-on-disk dialog fires unexpectedly after ⌘⇧; chord (low — adjacent bug surfaced during ENH-098 walk-3).
- **BUG-105** — right-click → Copy path on a tab is a no-op (low–medium — feature exists but doesn't fire).
- **BUG-106** — `duo edit <non-existent-path>` opens tab + ENOENTs on read (medium — recommend mount-empty-as-new shape).
- **ENH-108** — cmd+click on `[[Does Not Exist]]` wikilink should create the file (Obsidian parity, owner-requested via walk-2 OTHER NOTES).
- **BUG-101 browser-routed half** — `duo open <url>` sometimes doesn't surface a browser tab (the editor-routed half is fixed; this needs separate diagnosis).
- **BUG-100** — Send→Duo pill in split-view aux (not walked yet).
- **BUG-102** — split-view blank during palette (owner-flagged "non urgent"; deferred).
- **FOLLOWUP-013** — BUG-093 right-click split-view crash repro hunt (needs interactive repro work).

**Tests:** 17 test files / 298 tests green (up from 281 at sprint start; +13 chord matchers, +7 wikilink resolver, +3 BUG-056 IIFE-source asserts). Typecheck clean.

**Cut next.** All P0/P1/P2 verified or deferred-with-owner-blessing. The cut-version skill closes Sprint 9 → v0.6.9 release.

---

## Sprint 9 progress — autonomous session 2026-05-07

> Owner went AFK; agent worked through the sprint solo. Verification
> in the live UI is owed across most items; code-paths + tests are
> green. Restart Duo dev session before walking — main-process
> changes (focusPane bridge, PANE_FOCUS_JUMP IPC) need a fresh
> `npm run dev`. (The agent did this twice during the session;
> current session is up.)

### Landed
- **ENH-096 wikilinks cmd+click** (P0) — `resolveWikilinkTargetAtClick` helper handles text-node targets (root cause: closest is undefined on Text nodes; pre-fix optional chain returned null and bailed) + pos-based decoration fallback. 7 vitest fixtures green. UI smoke owed: cmd+click a `[[…]]` wikilink in `/tmp/wikilink-diag/test-vault/Index.md`.
- **ENH-098 focus chords** (P1) — ⌘⌥L/⌘⌥;/⌘⌥' jump to terminal/main/aux pane respectively + CLI parity via `duo focus-pane <terminal|main|aux>`. Full plumbing checklist applied. 13 matcher fixtures green. CLI verb tested live against dev session — all three targets return ok. UI smoke owed: actual chord press in live UI.
- **ENH-091 caret seed instrumentation** (P1) — three diagnostic trace points: `[ENH-091 seed]` decision-point bails, `[ENH-091 wire-exit]` post-seed selection state, `[ENH-091 seed] post-rAF check` next-frame override detection. 12 fixtures still green. Instrumentation pinpoints which override path is winning when owner repros.
- **ENH-106 Distro Pack Builder Workshop** (P1) — repo-only `distro-pack-builder/` folder with scoped CLAUDE.md + README + 11-step playground.md + project-scoped assistant skill at `.claude/skills/pack-builder-workshop/`. Defers to canonical `/pack-builder` skill for mechanical work. Root CLAUDE.md updated.
- **BUG-101 tab routing** (P1) — root cause for the editor-routed half: React anti-pattern in `openFile` (setActiveWorking called from inside a setFileTabs updater). Lifted to a ref-based hand-off + post-updater flush. The browser-routed half (`duo open <url>` to a remote URL not surfacing a tab) still open; needs separate diagnosis if it persists after the editor-side fix lands.
- **ENH-102 ⌘⇧⌫ delete current file** (P2) — chord matcher + dispatch + browser-pane allowlist + App.tsx callback (confirm dialog → `files.trash` → close tab). Soft-success on ENOENT (mirrors right-click trash flow). 6 matcher fixtures green.

### Investigated, deferred
- **BUG-102 split-view blank during palette** (P2) — root cause confirmed: `setOverlayMuted(true)` shrinks both main + aux WCV to 1×1, but aux mute is over-aggressive in typical layouts (palette body sits center; aux is right; backdrop is 30% transparent — un-muted aux would be nicely dimmed). Recommended fix: bounding-box-aware mute (compute palette body bounds runtime; mute aux only when bounds intersect). Owner-flagged "non urgent"; deferred.
- **ENH-103 + ENH-104 SaveControl + autosave toggle** (P2) — owner-sign-off needed on the four-state visual treatment before code. Building in isolation risks shipping a design that needs to be redone. Deferred until owner present.
- **FOLLOWUP-013 BUG-093 right-click split-view crash repro hunt** (P2) — by definition needs interactive repro work; deferred until owner walks.
- **BUG-100 Send→Duo pill in split-view aux** (P2) — not yet investigated.

### Tests
- 16 test files / 294 tests green (up from 281 at sprint start). 13 new fixtures across ENH-098 (matcher × 7), ENH-102 (matcher × 6), and ENH-096 (resolver × 7) — note ENH-096's 7 are inside a NEW test file `WikilinkDecorations.test.ts` so the count of NEW tests is 13.
- TypeScript clean across both `tsconfig.node.json` and `tsconfig.web.json`.
- CLI binary rebuilt (`npm run build:cli`) and tracked.
- `npm run sync:claude` ran cleanly — `~/.claude/skills/duo/SKILL.md` and `~/.claude/agents/duo.md` reflect the new `duo focus-pane` verb + cheat-sheet entries.

### What's owed when owner returns
1. **UI smoke walk** of the landed items — open Duo, exercise each chord and the wikilink path. The smoke-walk skill (or a manual walk) covers it.
2. **Browser-routed BUG-101 follow-up** — if `duo open https://example.com` still doesn't surface, that's the second half (renderer state subscription drift, not the React-anti-pattern half I fixed).
3. **Walk against owner's real Obsidian vault** — the test vault at `/tmp/wikilink-diag/test-vault/Index.md` exercises the click path but not the resolver against a real vault structure.
4. **Decision on ENH-103/104 SaveControl shape** — four-state model (Saved / Save / Saving / Failed-retry) ready for sign-off; once owner picks a visual treatment, the code is a half-day item.

### Open questions still pending
- ENH-106 folder location: top-level vs. `examples/` (proposed top-level; keep unless owner prefers otherwise).
- ENH-101 expand/collapse semantic: deferred from sprint plan; revisit next sprint.

---

## Sprint 9 (v0.6.9) — committed 2026-05-07

**Theme:** Close half-ships from Sprint 8 + adjudicate the
idle-thoughts chord/UI batch + open the door for cohort pack
builders.

### P0 (cut blocker)
- **ENH-096 wikilinks cmd+click navigation** — close the click
  handler OR strip the visual decoration. 30-second console.debug
  diagnosis queued in tasks.md § ENH-096 § "What's left to
  investigate." Owner directive at v0.6.8 cut.

### P1 (strong commit)
- **BUG-101** `duo open` / `duo edit` sometimes return `{ok: true}`
  without surfacing the tab — bit us during the Sprint 9 planning
  session itself, strong signal of pain.
- **ENH-091** caret seed root-cause — third attempt; instrumentation
  in `seedCaretInEmptyParagraph` + the `wire()` exit per the
  diagnostic plan filed in v0.6.8 close-out.
- **ENH-098** focus-chord set ⌘⌥L (terminal) · ⌘⌥; (main canvas) ·
  ⌘⌥' (split view) — clean QOL, single-day, contained.
- **ENH-106** Distro Pack Builder Workshop — repo-resident
  playground doc + assistant skill, scoped to a new
  `distro-pack-builder/` folder. Skill ships in the repo (cwd-only)
  but NOT in the canonical DMG / `~/.claude/skills/`. Pairs with
  FOLLOWUP-011 (cross-machine substrate validation) — a real pack
  builder following the workshop on a non-Geoff machine validates
  Stage 21d end-to-end. Owner addition during sprint plan.

### P2 (in-scope if time)
- **BUG-100** Send→Duo pill missing on text selections inside the
  split-view aux browser pane.
- **BUG-102** split-view goes blank while ⌘⇧A tab-search palette is
  open (aux WCV mute too aggressive).
- **FOLLOWUP-013** BUG-093 right-click → split-view crash clean-repro
  hunt against the v0.6.7 instrumentation.
- **ENH-102** ⌘⇧⌫ delete current file (with confirm).
- **ENH-103 + ENH-104** SaveControl consolidation + autosave toggle,
  paired as one mid-day item.

### Skip / deferred to Sprint 10+
- **ENH-099** 3-way 33/33/33 layout chord — needs architecture
  decision; defer until 3-way layouts prove a real workflow need.
- **ENH-100** lock/unlock context menu verb — canvas-only meta
  exists (`<meta duo-default-editable="false">`); defer.
- **ENH-101** expand/collapse chords ⌘⌥T/⌘⌥C — owner: defer,
  discuss next sprint plan once the rail-collapse-vs-full-screen
  semantic is clearer.
- **ENH-105** `@` filename autocomplete — multi-day; pair with
  ENH-096 B2 wikilink autocomplete next sprint (same fuzzy-popover
  primitive).
- Older filed items: BUG-079, BUG-091, BUG-083, BUG-073, ENH-082,
  ENH-094, ENH-077, ENH-027, ENH-047, ENH-048, FOLLOWUP-002, -003,
  -004, -006, -007.
- **Cross-machine cohort validation** as a standalone stretch —
  rolled into ENH-106's pairing instead.

### Open questions
- ENH-106 folder location (top-level `distro-pack-builder/` vs.
  `examples/distro-pack-builder/`) — proposing top-level; owner
  redirect during implementation if preferred.
- ENH-101 semantic (rail-collapse vs. full-screen redundant with
  ⌘⌥0/9) — return to in next sprint plan.

(Source worksheet: [docs/dev/worksheets/sprint-plan-v0.6.9.html](worksheets/sprint-plan-v0.6.9.html).
Worksheet was generated but not used; proposal-and-AUQ flow
substituted for the worksheet UI per owner pref. The worksheet +
manifest were retained as breadcrumbs of the candidate pool.)

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
