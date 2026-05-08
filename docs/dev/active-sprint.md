# Active sprint state — Sprint 9 (v0.6.9, planning pending)

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

## Sprint 8 (v0.6.8) — ✅ CUT 2026-05-06

Anchor (Stage 21d cohort distribution) shipped. Three feature
surfaces alongside (ENH-080 ⌘⇧A palette, ENH-096 wikilinks Tier A
+ B1 partial, ENH-097 modality lock). Three Phase-0 polish items
shipped (ENH-091 partial, BUG-097 fixed, FOLLOWUP-008 done).
Walk-1 root-cause fixes for BUG-099 autosave race + ENH-080
walk-1 bugs + the Stage 21d uninstall pre-walk-surfaced bugs
(`c1bb133`).

**Carry-overs to Sprint 9:**
- **ENH-096-WIKILINKS cmd+click navigation — Sprint 9 P0**
  (owner directive). Visual decoration without working navigation
  is a confusing half-feature; close OR strip the decoration.
- ENH-091 caret seed (two attempts, neither moved live behavior).
- BUG-100 Send→Duo pill missing in split-view aux.
- BUG-101 `duo open` / `duo edit` sometimes return success
  without surfacing tab.
- BUG-102 split view blanks during ⌘⇧A search overlay.
- BUG-093 right-click split-view crash (instrumentation only;
  awaiting clean repro).
- FOLLOWUP-013 BUG-093 repro hunt.

---

## Sprint 9 (v0.6.9) — pending sprint-plan session

**Sprint goal — TBD pending sprint-plan.** Owner directive at
v0.6.8 cut: ENH-096 wikilinks closure is P0.

**Strong candidates** (ready for the worksheet):

### P0 — Owner-directed
- **ENH-096-WIKILINKS cmd+click navigation** — close the click
  handler OR strip the decoration. 30-second console.debug
  diagnosis queued in tasks.md § ENH-096 § "What's left to
  investigate."
- **ENH-108 paste-image handling (markdown editor + HTML canvas)** —
  owner-directed P0 (idle-thoughts sweep, 2026-05-08). ⌘V or
  drag-drop an image into either editor surface → Duo saves to the
  active file's parent dir + inserts the reference (`![](path)` in
  markdown, `<img src=...>` in canvas). Closes a workflow-defining
  gap (today: save-to-Desktop → drag-to-Finder → markdown-link-by-
  hand). Mirror requirement per editor-canvas parity rule. Full
  plumbing checklist in tasks.md § ENH-108.

### P1 candidates — walk-1/walk-rev2 carry-overs
- **ENH-091 caret seed** — diagnostic plan recorded; needs
  `console.debug` instrumentation in `seedCaretInEmptyParagraph`
  + the `wire()` exit to identify the override.
- **BUG-100** Send→Duo pill in split-view aux pane.
- **BUG-101** `duo open` / `duo edit` tab routing.
- **BUG-102** split view blank during palette overlay.
- **BUG-093** right-click split-view crash repro hunt.

### P2 DRAFT candidates — fresh from idle-thoughts sweep (2026-05-06 + 2026-05-08)
- **ENH-098** focus-chord set ⌘⌥L/;/'.
- **ENH-099** 3-way 33/33/33 chord ⌘⌥4 (likely defer until use case proven).
- **ENH-100** lock/unlock context menu verb.
- **ENH-101** expand/collapse chords ⌘⌥T/⌘⌥C (likely redundant with ⌘⌥0/9).
- **ENH-102** ⌘⇧⌫ delete current file with confirm.
- **ENH-103** consolidate Save indicator + button.
- **ENH-104** autosave toggle.
- **ENH-105** `@` filename autocomplete (multi-day item; pairs with ENH-096 B2).
- **ENH-106** extend lock/unlock to Markdown via YAML frontmatter
  (paired with ENH-100; first user is `idle-thoughts.md` Notion mirror).
- **ENH-107** terminal tab strip context-menu Move-left / Move-right.
- **BUG-103** markdown blockquotes render with literal curly
  quotation marks instead of left-border (~5-line CSS fix; cross-ref BUG-061).

### Stretch — cohort-distribution end-to-end validation
- **The v0.6.8 substrate ships** but hasn't been validated on a
  non-Geoff machine. Find a real distro use case (Cap One AIP
  starter pack? a community-built lesson pack?) and walk the
  cross-machine flow. This was the "what comes next" framing in
  `docs/RELEASES.md`'s v0.6.8 entry.

---

## Workflow reminders

**Read first when picking up an in-flight initiative:** this file
points at the formal PRD + tracks commit-by-commit progress.

**Sprint-plan skill** (`/.claude/skills/sprint-plan/`) — proactively
offer when picking up a fresh session. Harvests candidates from
this file + tasks.md + roadmap.html + session-log.md, generates a
worksheet, parses owner priority, synthesizes a Sprint 9
commitment.

**Cut-version skill** comes after the sprint walks clean.
