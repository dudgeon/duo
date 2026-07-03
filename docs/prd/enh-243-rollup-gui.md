# ENH-243 — Rollup viewer & editor GUI (the "Rollups" tab)

**Status:** ✅ COMPLETE 2026-07-03 (PR #119) — v1 + fast-follows
ENH-244/250/251 (§ 11) + the ENH-248 gap batch (§ 12) all shipped and
owner-walked ("great — looks like we are done"). Of the § 12
recommendations, R1 and R9 closed unbuilt: R1 was superseded by the walk-2
refresh rework (one click makes a rollup current everywhere), R9 (Vault-row
glance-only trim) was reviewed and not adopted. Follow-up: ENH-249 (human
docs review after the bot editing passes).
**Owner decisions:** captured via `docs/research/rollup-viewer-layouts.html` (rev 2)
paste-back, 2026-07-02.
**Builds on:** ENH-228 (`type: rollup` notes, Vault view), ENH-229 (`duo rollup
render|list|diff`), ENH-208/216 (corpus, OKF/Obsidian dual-mode engine).
**User-facing manual:** [`skill/references/rollup-guide.html`](../../skill/references/rollup-guide.html)
(ENH-247) — the mechanisms + ecosystem walkthrough, with the § 12 gap
recommendations illustrated inline.

## Problem

Rollups today are authored by hand (or by a seeded Claude session) as YAML
`base` blocks inside `type: rollup` notes, and viewed as rendered HTML
artifacts. There is no way to *construct* or *reshape* a rollup from the GUI,
no live view over the corpus, and no way to edit an entity's frontmatter from
a rollup row. The Vault tab lists rollups but is read-only.

## What ships (v1)

In any workspace whose default vault is set (OKF included), a **Rollups**
top-level tab appears beside the Vault tab. It is a master–detail surface:

- **Left rail (collapsible):** every rollup in the vault (`listRollups`),
  plus **+ New rollup** — which creates a GUI-owned rollup immediately (no
  Claude session; the seeded-session path remains on the Vault tab).
- **Center:** the selected rollup rendered live from the corpus — grouped
  tables at 1..n group depths, a Refresh action, hover-reveals-path and
  click-opens-in-Duo on every row.
- **Right inspector "Roll Up" (collapsible), stacked:**
  1. the **definition builder** — entity type(s), ordered group-by levels,
     filters, columns — every change saves the config and re-renders live;
  2. the **frontmatter flip subpane** — when a row is selected, its typed
     attributes with one-click flips (bool toggle, enum picker, free text),
     applied instantly with an undo toast.
- **Doctor:** a rollup whose spec can't be parsed/evaluated renders as a
  diagnosis card with **Fix with Claude** — spawns a new Claude terminal in
  the vault's **parent** directory, seeded with a prepared repair prompt.

## Decisions

- **D1 — Layout: library rail master–detail (owner lock).** Left rollup list
  + center rendered view + right inspector. Both rails collapsible; the
  inspector panel is titled **"Roll Up"** (owner: not "Definition"). Rows are
  familiar Vault-view idioms.
- **D2 — Flip-edit semantics: instant apply + undo toast (owner lock).** A
  flip writes the note's frontmatter immediately through a surgical
  field-writer (same style as `stampRollupProvenance` — only the touched key
  changes, body byte-untouched), re-renders the rollup (the row may re-file
  into another group), and offers a one-click Undo that writes the prior
  value back. File-history (ENH-221) is the deep safety net.
- **D3 — Doctor: prepared prompt in a NEW terminal at the vault's parent CWD
  (owner lock).** Mirrors the ENH-228 "+ New rollup" spawn machinery
  (`makeTab` + `dispatchPostSpawnWrite`) but with `cwd =
  dirname(vaultRoot)` and a repair prompt carrying the note path + the parse/
  lint error. Rationale: the fix session sees the vault as a child folder and
  can't confuse the broken config's vault-relative paths with its own cwd.
- **D4 — Config format: the rollup note IS the config; the GUI owns a
  canonical base-block dialect.** No new file format, no sidecar (§D9). The
  builder serializes its model to a canonical embedded ```base block inside
  the `type: rollup` note (plus builder keys in frontmatter — see D5), so
  `duo rollup render|list|diff` and Obsidian Bases keep working unchanged.
  Reading back is **best-effort**: a note whose base block parses into the
  builder model is editable; a hand-authored note that doesn't round-trip is
  shown **view-only** (rendered fine, builder disabled with a "hand-authored
  spec" notice); a note whose spec fails to parse/evaluate at all gets the
  doctor card. Users never hand-edit GUI-owned configs (owner requirement) —
  but hand-authored rollups are first-class citizens of the *viewer*.
- **D5 — Multi-depth group-by: GUI-side in v1.** The engine's `BaseView.
  groupBy` is single-level (`{property, direction}`). The builder stores the
  full ordered list in the rollup note's `group_by:` frontmatter (a
  GUI-owned key, ignored by the engine) and mirrors level 1 into the base
  block's `groupBy:` so `duo rollup render` artifacts stay valid. The
  Rollups tab groups the *structured rows* client-side at every level.
  **Deferral:** teaching the shared engine + HTML/MD emitters n-level
  `groupBy` is a tracked follow-up (filed as a carry-forward in tasks.md);
  when it lands, `group_by:` folds into the base block and the mirror key
  retires.
- **D6 — Hover path, click opens.** Every rendered row carries its
  vault-relative path: hover reveals it (tooltip), click opens the note in
  Duo via the existing `duo-vault-open-note` → `openFileSmart` path.
- **D7 — CLI parity (rule 4).** New verbs, same core module as the GUI:
  `duo rollup new --type <t> [--title] [--group a,b] [--filter 'k=v']
  [--columns a,b]` (scaffold a builder-canonical rollup note),
  `duo rollup show <note>` (parsed builder model as JSON; `--json` stable),
  `duo rollup set <note> [--title|--types|--group|--filter|--columns|--sort]`
  (mutate + rewrite the canonical block), `duo rollup doctor <note>` (lint +
  parse diagnosis; prints the same repair prompt the GUI seeds). Deliberate
  asymmetry: the flip subpane's writes are the existing note-frontmatter
  write path — agents already edit frontmatter directly; no dedicated verb.
- **D8 — Filters v1 vocabulary.** `is` / `is not` / `is set` / `is not set`
  over frontmatter keys, AND-combined, serialized to engine expressions
  (`prop == "v"`, `prop != "v"`, `file.hasProperty("prop")`,
  `!file.hasProperty("prop")`). Enum-valued keys offer observed values from
  the corpus schema (`enumsByType`). Richer ops (dates, contains, OR groups)
  are deferred; hand-authored specs using them still render (D4 view-only).
- **D9 — Live save + refresh.** Builder changes persist on every commit
  (change of a select, chip add/remove) and re-evaluate immediately. The
  Refresh action re-reads the corpus (same read as opening the tab). A 30s
  poll while the tab is active (Vault-view pattern) keeps the view honest
  against external edits.
- **D10 — Renderer data path: structured rows over IPC, no HTML transport.**
  A new `vault:rollup-view` handler resolves the note, evaluates the spec
  via the shared `evaluateBaseDef`, and returns JSON-safe rows (cells
  plain-rendered via `readCol`/`plainCell`, plus per-level group values +
  vault-relative path per row). The GUI never parses rendered HTML, and the
  engine is never reimplemented in the renderer (one-engine rule).

## Non-goals (v1)

- Board/kanban view, drag interactions (retired by D2's flip model).
- Editing hand-authored specs in the builder (view-only + doctor instead).
- Engine-side n-level groupBy emitters (D5 deferral).
- Formula/summary authoring in the builder (rendered if present; authoring
  stays with the Claude loop).
- Artifact (re)rendering from the tab (the Vault tab's View ↗ / `duo rollup
  render` already own that; the GUI view is live and needs no artifact).

## Acceptance

1. With a default vault set, a **Rollups** tab sits beside Vault; without
   one, neither exists. The tab is synthesized, never persisted (session
   envelope excludes it, like Vault/Home).
2. Selecting each existing rollup renders grouped rows matching
   `duo rollup render`'s row set (single-level check) — and nested headers
   when `group_by:` has 2+ levels.
3. **+ New rollup** creates `rollups/<slug>.md` (`type: rollup`, canonical
   base block) and it immediately appears in the Vault tab's list and
   `duo rollup list`.
4. Every builder mutation rewrites the note (verified by `duo rollup show`)
   and the view updates without a manual refresh.
5. Flipping an enum/bool in the subpane rewrites ONLY that frontmatter key,
   the row re-groups live, and Undo restores the prior value.
6. Hover shows the vault-relative path; click opens the note in the editor.
7. Breaking a rollup's YAML by hand → doctor card; **Fix with Claude**
   spawns a terminal whose cwd is the vault's parent, pre-seeded with the
   repair prompt naming the note.
8. CLI: `duo rollup new|show|set|doctor` work in a bare shell (no app),
   4-surface sync green (`check:skill-currency`), `build:cli` committed.
9. typecheck + unit tests green; smoke-walk items filed for the tab.

## 11 · Requirements changed / shipped fast-follows (2026-07-02 → -03)

Owner-walk feedback landed as three fast-follow batches on the same PR;
each changed what the feature *does*, recorded here per CLAUDE.md rule 13.

- **ENH-244 — Copy as Markdown.** Both the Rollups tab header and the
  rendered HTML artifact carry a "Copy as Markdown" button producing a
  markdown table whose entity links are **GitHub blob URLs** when the vault
  sits in a repo with a GitHub remote (branch = current, path =
  vault-relative), **vault-root-relative links** otherwise. Core:
  `core/vault/rollup-markdown.ts` (repo detection via `git -C <vault>`).
- **ENH-250 (né ENH-245; renumbered — merged PR #120 claimed 245/246 first) — IA reconciliation, batch 1.** (1) Every builder save
  auto-renders + provenance-stamps the artifact
  (`core/vault/rollup-render.ts::renderAndStampRollup` — shared with the
  CLI's default path; GUI rollups are real artifacts without a terminal).
  (2) The artifact's Refresh button self-renders deterministically via a
  `vault:rollup-render` IPC (payload gained `vaultRoot`), then reloads the
  browser pane; the bus event remains for optional Claude narration.
  **Known limitation → § 12 G2:** the button's behavior is baked into each
  artifact at render time, so artifacts rendered before this fix still
  carry the old inert button. (3) "+ New rollup" focuses + selects the
  Title field. (4) A Vault-tab rollup row's *name* opens the rendered
  artifact (falls back to the note when never rendered). (5) A row "Edit"
  button jumps to the Rollups tab with that rollup selected
  (`duo-vault-edit-rollup` → `duo-rollups-select`).
- **ENH-251 (né ENH-246; same renumber) — one creation concept.** The Vault tab's "+ New rollup"
  left-click now routes to the Rollups tab's instant GUI-builder create
  (same as its own button); the seeded-Claude-authoring-session flow moved
  intact to a right-click context menu on the same button. RollupsView's
  create path hardened for never-visited-tab triggers (vaultRoot override +
  live schema fetch).
- **Also shipped in the window:** decisive doctor prompt + post-spawn
  auto-submit Enter retries (spawned sessions actually start working);
  BUG-214 (default-vault changes now broadcast to every window — the
  Vault/Rollups tabs track `duo vault default` live).

## 12 · Gap batch — 2026-07-03 owner walk (CLOSED: R2–R8 shipped + walk-2 fixes; R1/R9 closed unbuilt)

Owner: *"we are making progress but there are still issues."* Analysis +
illustrated proposals live inline in the guide
([`skill/references/rollup-guide.html`](../../skill/references/rollup-guide.html),
recommendations R1–R9); ledger entry ENH-248.

**2026-07-03 decisions + build (same-day fast-follow):** owner accepted
R2–R8 (R1 pending — revisit after walking the new refresh mechanics; R9
needed a clearer before/after, now in the guide, still awaiting decision)
plus two new requirements: **Copy as Markdown leaves the Rollups tab
header** (the artifact carries it — "genuinely useful outside of Duo"), and
**the editor shows the artifact's path under the rollup name, click-to-open**.
All built + live-verified end-to-end (guide rev 2 chips each item "shipped ·
walk to verify"). Key implementation notes: the artifact now embeds ONLY
Copy-as-Markdown — Refresh/Edit are a Duo-native browser-pane toolbar
detected via the artifact's marker comment (works on artifacts of any
vintage; 30s freshness re-probe drives the R4 grey-out); `links: github`
is note-level frontmatter honored by every render; the Entities section's
click-through evaluates an ad-hoc single-type model (`modelViewData`, no
note until "Save as rollup"); `duo rollup delete --force|duplicate` +
`render --github` + `set --links` are the CLI twins (4-surface sync green).
Deliberate asymmetry: the builder's GitHub-links checkbox appears only for
canonical (GUI-editable) rollups — hand-authored notes use `duo rollup set
--links`. Original gap list:

- **G1 — "stale" is unexplained.** It means `last_hash` ≠ current corpus
  hash (some note changed since the artifact was rendered) — but no surface
  says so. → R1: tooltip + plain-language freshness line; single shared
  staleness IPC.
- **G2 — artifact Refresh is a no-op on pre-ENH-250 artifacts.** Chrome is
  baked at render time (see § 11). → R2: Duo-native toolbar chrome overlaid
  when the browser pane detects a rollup artifact (doc-comment marker), so
  behavior ships with Duo, not with the artifact; embedded buttons stay as
  the portable fallback.
- **G3 — editor Refresh gives zero feedback.** It works (refetch list +
  view) but is indistinguishable from a no-op. → R3: last-refreshed stamp +
  spinner + row-delta feedback.
- **G4 — both Refresh buttons should grey out when fresh.** → R4: disabled
  + tooltip when `last_hash` matches the current corpus hash (drives off
  the same staleness IPC as R1).
- **G5 — hand-authored rollups dead-end in the editor.** View-only notice
  offers no path forward. → R5: "Normalize with Claude" button — seeded
  session that rewrites the spec into the builder's canonical dialect
  (semantics-preserving, lint-verified), making it GUI-editable.
- **G6 — no rollup management tools.** Rename exists (Title field); delete
  / duplicate / reveal don't. → R6: context menu + overflow menu on the
  rail rows (Delete with confirm — removes note + artifact; Duplicate;
  Reveal in navigator; Open note as markdown).
- **G7 — Vault tab underuses the corpus.** → R7: an "Entities" section
  below Inbox/Rollups — every `type:` with a live count; click seeds a
  filtered rollup view (needs per-type counts added to the schema DTO).
- **G8 — GitHub survivability of the HTML artifact is unverified.** Links
  are vault-relative `.md` hrefs — structurally intact when the vault ships
  as a unit, but Pages serves raw markdown, blob view shows HTML source,
  and the Duo-only buttons are inert there. → R8: a `--github` render
  variant (blob-URL links via ENH-244's repo detection) + hide-Duo-chrome
  when not under Duo; a verify checklist in the guide.
- **G9 (structural, owner decision pending).** The Vault tab's Rollups
  column vs the Rollups tab — recommend the column shrink to glance-only
  (freshness + open/edit) as construction now lives in the tab (open item
  (c) from ENH-250).
