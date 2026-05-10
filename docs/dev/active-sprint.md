# Active sprint state — Sprint 14 (cut target v0.6.12)

**Theme: Developer experience + paper-cut polish + visibility-tooling cluster + image-cluster expansion + JSON/YAML viewer-editor.** Sprint 14 anchored on Sprint 13's close-out recommendation, then expanded 2026-05-10 across multiple owner pulls AND a same-day pull-forward of ENH-110 (JSON/YAML viewer-editor) from v0.6.13.

**Sprint 14 close-out batch (2026-05-10 post-walk-3):**
- **BUG-115** ✅ Closed — fixture-write race confirmed (BUG-107 normalize() intact). Memory rule + CLAUDE.md § 7d added. No code change.
- **ENH-128** 🟢 Walk-4 fix — added macOS `sips` shell-out fallback in `convertImageBytes` for HEIC/HEIF/RAW that nativeImage rejects.
- **ENH-133** 🟢 Walk-4 fix — Shift+Enter in claude tabs now writes Option+Enter byte sequence (newline). Owner directive 2026-05-10.
- **ENH-110** 🟢 Walk-4 fix — Tier 3 JSON/YAML viewer-editor with tree + raw-text toggle, autosave, large-file fallback, source-mode parse guard. Pulled forward from v0.6.13.

Walk-4 owed before v0.6.12 cut.

## Walk-3 results (2026-05-10) — 4 PASS / 1 FAIL / 3 SKIP

**PASS:**
- **ENH-110 DECISION GATE** — owner answered all 4 Qs. JSON viewer build deferred to **v0.6.13 P0**. Decisions captured in tasks.md ENH-110 entry.
- **ENH-129 PDF position** — drop inserts at drop point.
- **ENH-119 image selection tint** — both surfaces working.
- **ENH-127 v2 Claude Enter** — plain Enter = newline; ⌘Enter = submit.

**SKIP-trusted (owner: "I trust the agent"):**
- ENH-122-SELECTOR · ENH-122-JS-AND-LEGACY · ENH-132-ARIA-TAB-ROLES.

**FAIL:**
- **ENH-128 HEIC drag-drop** — drag fires correctly, but `nativeImage.createFromBuffer` can't decode the owner's HEIC bytes. Console: *"Could not decode image bytes (source MIME: image/heic)"*. Walk-3 fixed the path-to-convert; the convert itself is broken. **AND** the same walk surfaced **BUG-115** — external-conflict dialog fires on first edit (BUG-107 family OR fixture-write race; needs diagnosis). Both filed in tasks.md.

**Verbatim walk-3 result block** preserved at [`docs/dev/smoke-walks/v0.6.12-rev3.results.md`](smoke-walks/v0.6.12-rev3.results.md) for post-compact pickup.

## Cut readiness

**NOT YET READY.** Two blockers:
1. ENH-128 HEIC decode — diagnose nativeImage limitation OR scope-downgrade (accept HEIC verbatim; let WebKit render it; markdown source carries `.heic`).
2. BUG-115 dialog regression — diagnose whether it's a fixture-write race (no fix needed; agent behavior change) OR a BUG-107 normalization regression.

Walk-4 after both diagnoses + fixes. Then v0.6.12 cut.

---

## Status

**P0 — anchors shipped + verified end-to-end (2026-05-09):**

- **ENH-122** `duo dom <selector>` ✅ — renderer-DOM CLI verb. Selectors / `--attr` / `--text` / `--computed` / `--all` / `--js` modes all working. Sister verb: bare `duo dom` keeps the legacy browser-pane HTML dump (CDP).
- **FOLLOWUP-015 ENH-117 v2** ✅ — `ViewSourceOverlay.tsx` (modal) → `ViewSourcePanel.tsx` (panel-fill). Three triggers funnel into the same `'duo-view-source'` window event with toggle UX.

**P1 — Sprint expansion (2026-05-10):**

- **ENH-118** image-handling conversation ✅ — 4 owner picks captured: GIFs animate (no code), SVG inert via `<img>` (no code), HEIC convert (filed as ENH-128), PDF → link insert (filed as ENH-129).
- **ENH-110 JSON viewer decision gate** ⏳ — research doc refactored to interactive playground at [`docs/research/data-primitives-canvas.html § 5`](../../docs/research/data-primitives-canvas.html). Owner needs to walk the 4 questions + Copy decisions back. **Carry-forward sprint-to-sprint until closed** — see "Decision gates open" below.
- **ENH-123** `duo devtools` ⏳ — coming this sprint.
- **ENH-124** `duo layout` ⏳ — coming this sprint.
- **BUG-103** blockquote CSS leak ⏳ — coming this sprint.

**Cut readiness:** Pending the P1 work + smoke walk + ENH-110 review.

---

## Decision gates open (carry-forward — appear in every smoke walk until owner closes)

These are owner-decision items that gate downstream code work. They reappear in every smoke-walk manifest until the owner Copy-decisions back. Pattern locked 2026-05-10 after ENH-110 was lost across 3 sprints because its research doc never surfaced as a smoke-walk item.

_None open as of Sprint 14 close-out. ENH-110's gate closed walk-3 (build also shipped same-day in Sprint 14, pulled forward from v0.6.13)._

---

## Carry-overs after this cut (still pending)

Read the **candidate slate** below before the next sprint commits. Owner-directed items still need conversation gates (ENH-118 image-handling discussion before image polish; ENH-127 reconsideration if accidental-submit pain re-surfaces).

---

## Candidate slate (carries from Sprint 13's "Deferred to Sprint 14+" stash)

### Owner-directed (already named with intent)

- ~~**FOLLOWUP-015 — ENH-117 v2 panel-fill view-source.**~~ — ✅ Shipped Sprint 14 (read-only panel-fill per entry-gate AUQ).
- **ENH-127 reconsideration.** v1 implemented + reverted same day after live test confirmed Claude Code's input loop treats `\n` and `\r` identically. Future paths documented in tasks.md entry: (1) Claude Code adds raw-newline mode (out of Duo's control; could file upstream), (2) Duo-side composer-window pattern (separate text area outside the terminal), (3) anti-accidental-submit heuristic (delay-based or click-confirm). Pick a direction OR keep declined.
- **ENH-118 image-type handling discussion.** Owner ask from Sprint 12 walk-rev2: animate GIFs by default (today's behavior) or freeze first-frame Slack-style? SVG safety review owed (currently `<img>` tag, scripts blocked). HEIC/RAW reject vs convert? Open question in CLAUDE.md flagged "before Sprint 14 picks up the image-handling polish cluster" — answer this before ENH-119/120 work.

### Visibility-tooling cluster (saves blind-debugging pain — Sprint 13 surfaced repeatedly)

- ~~**ENH-122 `duo dom <selector>`**~~ — ✅ Shipped Sprint 14.
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
