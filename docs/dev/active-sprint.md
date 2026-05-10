# Active sprint state — Sprint 14 (cut target v0.6.12)

**Theme: TBD — picks open after v0.6.11 cut (2026-05-09 evening).** Sprint 13 closed cleanly with paste-image v2 + auto-redistribute panes + view-source v1 + race-class fixes. Sprint 14 has no anchor commitment yet — owner picks from the queued candidates below in the next planning session.

---

## Status (2026-05-09 — sprint open, no commitment yet)

No items committed. Read the **candidate slate** below + the **owner-directed pulls already on owner's mind** before the first work commit lands. Run `/sprint-plan` to get a worksheet for prioritization.

---

## Candidate slate (carries from Sprint 13's "Deferred to Sprint 14+" stash)

### Owner-directed (already named with intent)

- **FOLLOWUP-015 — ENH-117 v2 panel-fill view-source.** Owner walk-3 surfaced the surface miss on v1: *"view source should occupy the full panel … you should have asked more questions about the intent vs making this modal approach … not urgent to fix but this is bad."* v2 = panel-fill (in-place toggle; replaces the editor / canvas content area) + menu + tab-context entry triggers (not chord-only). Open scope question: read-only-only (~half-day) OR read+write panel-fill with bidi sync (~multi-day, requires CodeMirror integration with TipTap)? Confirm before code.
- **ENH-127 reconsideration.** v1 implemented + reverted same day after live test confirmed Claude Code's input loop treats `\n` and `\r` identically. Future paths documented in tasks.md entry: (1) Claude Code adds raw-newline mode (out of Duo's control; could file upstream), (2) Duo-side composer-window pattern (separate text area outside the terminal), (3) anti-accidental-submit heuristic (delay-based or click-confirm). Pick a direction OR keep declined.
- **ENH-118 image-type handling discussion.** Owner ask from Sprint 12 walk-rev2: animate GIFs by default (today's behavior) or freeze first-frame Slack-style? SVG safety review owed (currently `<img>` tag, scripts blocked). HEIC/RAW reject vs convert? Open question in CLAUDE.md flagged "before Sprint 14 picks up the image-handling polish cluster" — answer this before ENH-119/120 work.

### Visibility-tooling cluster (saves blind-debugging pain — Sprint 13 surfaced repeatedly)

- **ENH-122 `duo dom <selector>`** — query renderer DOM from CLI. Single CLI verb, ~half-day. Would have prevented several Sprint 13 blind-canvas debugging sessions.
- **ENH-123 `duo devtools`** — open the renderer's DevTools from CLI. ~hour. Backstop for the 5% of cases where ENH-122's targeted query isn't enough.
- **ENH-124 `duo layout`** — structured snapshot of working pane state (active tab kind/path, split state, etc.). ~half-day. Removes ambiguity about WHAT the user is looking at.

### Image-handling polish cluster (paired with ENH-118 above)

- **ENH-119** — selection tint covers images (visual feedback when an image is in the selected range).
- **ENH-120** — copy-with-image preserves image bytes on clipboard (today the markdown is copied but the image itself isn't a clipboard-image item).

### Larger / strategic candidates (would anchor a sprint by themselves)

- **ENH-110 JSON viewer (PM persona)** — research doc landed at `docs/research/data-primitives-canvas.html` § 4. Recommended Tier 3 (`@uiw/react-json-view` ~7 KB gz) as new `kind: 'json'` tab type. ~3 days. Open scope questions in CLAUDE.md (tier 2 vs 3, edit semantics, YAML cohabitation).
- **ENH-082 Terminal Context Bar** — collapsible UI for job + docs + skills shared between user and agent. Research-doc owed before code. Medium-large feature.
- **Obsidian cluster — backlinks panel / graph view** — Tier C from the Obsidian-vault research doc. Wikilinks autocomplete (v0.6.10) usage tells us whether the next-tier capability has demand.

### Bugs / paper cuts queued

- **BUG-100** — Send → Duo pill missing on text selections inside the split-view aux browser pane. Owner originally flagged "non blocking"; cost is a CdpBridge multi-attach refactor (~3-4 hours).
- **BUG-093** — right-click → Move to Split View can crash the renderer. Instrumented in v0.6.7; owner-blocked on a live repro against the instrumented build.
- **BUG-102** — split view goes blank while ⌘⇧A tab-search palette is open. Owner: *"non urgent."*
- **Stage 21b** — DMG background image. Polish-only.

---

## Sprint 14 picks awaiting owner

Run `/sprint-plan 0.6.12` for a worksheet that gathers all candidates (above + open `tasks.md` items + last walk's "Other notes for next sprint") and prompts P0/P1/P2/Skip prioritization. Otherwise lead the planning session with a direct AUQ on which 1-3 items to commit.

**Recommendation if owner just says "pick something":** ENH-122 (`duo dom`) as a half-day P0 because the visibility-tooling pain was repeated in Sprint 13. Pairs with FOLLOWUP-015 ENH-117 v2 panel-fill (small) for a coherent "developer experience + paper-cut polish" sprint shape. ENH-118 owner-pick conversation queued before any image-polish work.
