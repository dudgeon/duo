# Active sprint state — Sprint 12 (v0.6.10 cut pending, image v2 + BUG-108 + ENH-115 ready for smoke walk)

**Theme:** Image viewing chrome + the table-cell-copy paper cut + a
small terminal-tab context-menu QoL.

**Owner directive (2026-05-08 evening, post-walk-3):** *"don't cut yet;
I want to address image handling (should be in the roadmap now) and
one more newly discovered bug before cutting: copying cell text from
a table in the markdown editor just copies '[table]' to the clipboard."*
**Owner directive (2026-05-09):** *"add another feature (document it
then add to sprint): right clicking on terminal tab should offer
option to focus the navigator on that tab's CWD."* → ENH-115.

The cut-version proposal (drafted in chat, not yet applied) is held
in `RELEASES.md § Pending`. Sprint 12 lands THREE additions before
the cut fires; all three landed 2026-05-09 — smoke walk owed before
the cut.

### Status (2026-05-09)
- **ENH-111 (image v2):** ✅ committed. Toolbar + zoom + pan +
  context menu + dimensions/size readout. New IPCs: `files.stat`,
  `clipboard.writeImage`. Component lives at
  `renderer/components/ImageView.tsx`.
- **BUG-108 (table cell copy):** ✅ committed. Higher-priority
  `clipboardTextSerializer` in
  `renderer/components/editor/extensions/TableCellCopy.ts` returns
  the slice's plain text when the slice begins with a table node;
  defers (returns null) for whole-table copies so tiptap-markdown's
  existing markdown-table serializer continues to render those.
- **ENH-115 (terminal tab → Reveal in navigator):** ✅ committed
  (batched with image v2). One context-menu entry on the terminal
  tab strip, calls the existing `nav.actions.navigateTo` + reveal
  chip. Working label: "Reveal in navigator" — revisit during
  smoke walk if it reads wrong.

### P0 anchor — image viewer v2 (promoted from Sprint 13)
- **ENH-111 (image v2)** — toolbar chrome around the existing image
  tab. Zoom (+/−), fit-to-window, 1:1 actual-size, dimensions readout
  (e.g. `1440 × 900 · 312 KB`), copy-to-clipboard, pan via drag.
  Right-click → Open in Preview.app / Reveal in Finder / Copy path
  via the existing `clipboard:write-text` IPC. Hand-roll (~1d). PM
  persona benefit: dragging a screenshot from Slack into Duo currently
  shows a small image; with chrome, users can zoom into UI mockups
  without leaving Duo. Image tab type already exists (renderer/components/
  fileClassifier.ts § 'image'); this is renderer-side polish.

### P0 anchor — BUG-108 table cell copy
- **BUG-108** — copying selected text from a markdown-editor table
  cell yields the literal string `"[table]"` instead of the cell's
  text content. Likely TipTap Table + tiptap-markdown's clipboard
  serializer emitting a placeholder for the whole table node when
  ANY selection within the table is copied. Fix: intra-cell selections
  serialize to JUST the selected text; only whole-node selections
  yield the markdown-table representation.

### P1 — ENH-115 terminal-tab "Reveal in navigator"
- **ENH-115** — right-click on a terminal tab → context-menu entry
  "Reveal in navigator" (label TBD; owner flagged uncertainty —
  recommend matching the macOS "Reveal in Finder" verb pattern).
  Reuses `window.electron.menu.popup` (no new IPC) + the existing
  `nav.actions.navigateTo` + reveal-chip flow from the CLI's
  `duo reveal` plumbing. ~30min change in `TabBar.tsx` +
  `App.tsx` wiring. Filed mid-sprint 2026-05-09 per owner.

### Sequencing
1. **Image v2 first** — well-scoped, single-component refactor of the
   existing image tab. Lower-risk than BUG-108 (which involves
   TipTap clipboard serialization, more architectural).
2. **BUG-108 second** — surgical fix in TipTap Table extension config
   + clipboard serializer override.
3. **ENH-115 third** — small, isolated UI add in the terminal tab
   strip. Lands after image v2 is verified so the smoke walk can
   batch both.
4. **Cut v0.6.10** — once all three land + smoke walk passes.

### Deferred to Sprint 13+
- **JSON viewer (ENH-110)** — research doc landed; pull in once
  Sprint 12 closes.
- **CSV / TSV** (ENH-111 cluster) — pairs with JSON.
- **YAML / Mermaid** — Sprint 13 content fidelity.

---

# Sprint 11 (v0.6.10 work, committed 2026-05-07 → 2026-05-08)

**Theme:** Obsidian autocomplete + split-view rough edges.

**Owner directive (2026-05-07 evening):** *"roll straight into Sprint 11
— will walk in the morning; no need to cut if your work is committed."*

> **Status update 2026-05-08:** All Sprint 11 P0 + P1 + carry-overs
> landed across walks 1–3. 4/6 walk-3 PASS; 2 walk-3 FAILs (⌘O focus
> + BUG-107 file-changed dialog) fixed in walk-3 commits and verified
> live via computer-use. Owner deferred cut pending image v2 + BUG-108
> additions (see Sprint 12 above).

### P0 anchor — TipTap Suggestion primitive shared across three features
- **ENH-096 B.2** — wikilink autocomplete on `[[`. Type `[[fo`, popup
  shows fuzzy matches from the vault, ↑↓ to nav, Tab/Enter inserts
  the wikilink. Closes the v0.6.8 owner directive ("we only have half
  a feature").
- **ENH-105** — `@` filename autocomplete in the markdown editor. Same
  popover, same vault-walking source. Type `@`, select a sibling
  file, inserts as a `[[wikilink]]` (so vault round-trip is unified).
- **ENH-096 B.4** — `⌘O` vault quick switcher. Renderer-overlay shell
  (resembles ENH-080's `⌘⇧A` palette) sharing the same fuzzy match +
  vault walk source.

**Architectural pieces (one-time investments shared by all three):**
- `@tiptap/suggestion` + `@tiptap/extension-mention` deps installed
  (~2 KB gz combined; first-party + zero-deps).
- New module `renderer/components/editor/vaultIndex.ts` — caches the
  vault file list for fuzzy match. Refreshed on watcher events.
  Both the suggestion popover (B.2 + ENH-105) AND the `⌘O` palette
  (B.4) read from this index.
- New module `renderer/components/editor/extensions/WikilinkSuggestion.ts`
  — TipTap suggestion extension that triggers on `[[` and resolves
  via `vaultIndex`.
- New module `renderer/components/editor/extensions/AtMention.ts` —
  parallel suggestion extension for `@`, inserts as `[[wikilink]]`.
- New component `renderer/components/VaultQuickSwitcher.tsx` —
  the `⌘O` overlay (refactor of ENH-080's TabSearchPalette pattern).

### P0 carry-overs (Sprint 10 walk-1 OTHER NOTES + earlier deferrals)
- **BUG-091** — right-click "Move to split view" missing from the
  WorkingTabStrip's tab right-click menu. Sprint 8 P3 carry-over.
- **BUG-093** — split-view → renderer crash (instrumented in v0.6.7;
  needs FOLLOWUP-013 clean-repro work).
- **BUG-100** — Send → Duo pill missing on text selections in the
  split-view (aux) browser pane. Owner-flagged "non blocking, deferred."

### P1 polish
- **ENH-109** — show `.obsidian/` in the navigator when the active
  CWD is inside a vault. Pairs naturally with the autocomplete work
  (vault-aware navigator).

### Skip / defer
- **JSON viewer / data primitives** (ENH-110, ENH-111) — research doc
  landed at `docs/research/data-primitives-canvas.html`; deferred to
  Sprint 12 anchor per owner research-review pending. Don't dive in.
- **Backlinks panel + tag pills** (ENH-096 B.3 + Tier C) — Sprint 13+
  per the 3-sprint synthesis.

### Sequencing
1. **Wikilink autocomplete (B.2) FIRST** — closes the v0.6.8 owner
   directive; most user-pull. Forces the architectural pieces (deps,
   vault index, suggestion extension shape).
2. **`@` autocomplete (ENH-105)** — second feature on the same primitive,
   verifies the shape is reusable.
3. **`⌘O` quick switcher (B.4)** — third feature, refactors ENH-080's
   palette pattern.
4. **Carry-overs (BUG-091/093/100)** — mechanical once the autocomplete
   work settles. Each is sub-day.
5. **ENH-109** — polish, last.

---

# Sprint 10 (v0.6.10, committed 2026-05-07)

> **Status update 2026-05-07:** All P0 + P1 implementation landed in
> a single autonomous push following the AUQ-driven plan below.
> Tests: 323 passing (up from 298 at sprint start; +25). Typecheck
> clean. Smoke walk next.
>
> **What landed (autonomous session):**
> - **ENH-103 + ENH-104 SaveControl** — pill component with the
>   four owner-locked states (Saved muted gray · Save bg-accent +
>   white · Saving… disabled with spinner · Failed-retry red on
>   muted bg) + hover-reveal autosave on/off toggle. Both editor
>   (TipTap) + canvas (PageTab) surfaces. Per-app localStorage
>   key (`duo.autosave.v1`) shared across both surfaces; cross-tab
>   sync via `duo:autosave-changed` CustomEvent. 8 unit tests.
> - **ENH-114 wikilink-create-on-cmd+click** — Obsidian-parity:
>   cmd+click on `[[Does Not Exist]]` creates the file at vault
>   root + opens it. `buildWikilinkCreatePath` extracted to its
>   own module with 17 unit tests covering extension handling
>   (`.md` / `.html` / `.htm` / `.txt` recognition, no double-up),
>   path-bearing targets (`[[notes/Foo]]`), and path-traversal
>   defense (`../`, `/etc/passwd`, leading slashes all sanitized).
> - **BUG-101 browser-routed half** — root cause: the defensive
>   supplemental `browser:focus-gained` push from `core/socket-
>   server.ts` (added BUG-048 v2 for the "Duo not foregrounded"
>   case) sent `null` payload but Phase 3c BUG-095 had switched the
>   renderer's handler to `payload.slot`. Two-layer fix: send
>   `{tabId, slot:'main'}` from socket-server; null-guard the
>   renderer handler so future shape regressions can't reproduce.
> - **BUG-106 duo edit non-existent path** — pre-flight existence
>   check in `nav.onEdit` handler; pre-create empty bytes (or
>   HTML boilerplate via `classifyFile`) before `openFileSmart`.
>   Symmetric with `⌘N`'s `onCommitNewFile` pre-write convention.
> - **BUG-105 Copy path no-op** — root cause: `navigator.clipboard.
>   writeText` silently rejects when called from a native NSMenu's
>   `click` handler (no user-gesture context). Fixed by adding
>   main-process `clipboard:write-text` IPC and routing all three
>   call sites (WorkingTabStrip, WorkingPane aux, FileTree)
>   through it. The new `window.electron.clipboard.writeText` is
>   the canonical path for any future context-menu copy.
>
> **Procedural deviation from sequencing:** active-sprint.md said
> "SaveControl FIRST — lock the design in time for an owner UI walk
> before the carry-overs land." The autonomous session shipped
> SaveControl + carry-overs together. The owner UI walk is the
> smoke walk; if SaveControl needs design rework, the carry-overs
> are independent and can stand on their own.



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
- **ENH-114** — cmd+click on `[[Does Not Exist]]` wikilink creates the file at vault root + opens it (Obsidian parity). Pairs with the resolver path fixed in v0.6.9. Owner-requested via walk-2 OTHER NOTES.
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
**Cross-machine cohort validation** deferred until ENH-114 ships in THIS sprint. Once Duo has an Obsidian-friendly vault editor (wikilinks render + cmd+click navigates + cmd+click creates), the demo for a real pack builder walking `distro-pack-builder/playground.md` end-to-end on a non-Geoff Mac is a much richer story. Not this sprint.

### Sequencing
1. **SaveControl + autosave toggle FIRST** — the anchor. Lock the design in time for an owner UI walk before the carry-overs land.
2. **Carry-overs in any order** — each is sub-day. ENH-114 has the most architectural shape (the resolver branch + file create + parent dir mkdir for path-bearing forms); the three BUGs are mechanical fixes once root cause is in hand.

(Source: AUQ in chat 2026-05-07; no worksheet generated.)

---

## Sprint 9 (v0.6.9) — ✅ CUT 2026-05-07

Closed the v0.6.8 P0 carry-over (ENH-096 wikilinks cmd+click navigation) plus shipped a new chord vocabulary (⌘⇧L/⌘⇧;/⌘⇧') + `duo focus-pane` CLI parity + three layers of `duo edit` reliability bug + ⌘⇧⌫ delete-file chord + ⌘T URL-bar focus reclaim (BUG-109) + the Distro Pack Builder Workshop scaffolding + automated test coverage for the long-recurring BUG-056 pill-gating regression. ENH-091 caret seed deferred indefinitely per owner directive (override fires after Chromium internals).

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
