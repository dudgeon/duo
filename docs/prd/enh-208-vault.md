# ENH-208 PRD — Vault: networked work-notes on plain Obsidian conventions

**Status:** Draft for owner sign-off · 2026-06-09 **Owner:** Geoff · **Tracker:** `tasks.md` § ENH-208 **Intent artifacts:** `docs/research/graphbook-intent.html` (decision playground, rounds 1–2 walked) · `docs/research/graphbook-prototype/` (working vault + renderer + linter) **Naming note:** per D17 the user-facing name is **vault** everywhere; "graphbook" survives only in historical research filenames.

---

## 1 · Problem & vision

Work topics form a messy graph — initiatives, people, themes, meetings — that rarely fits one parent:child hierarchy. The owner wants to capture notes fast, have entities autocomplete as he types, see live rollups of child-entity state, and have Claude periodically *process* the corpus (file, link, fix, propose connections) — all stored in git as plain files intelligible to humans and agents that have **no concept of this feature**.

The design resolves into three layers; Obsidian covers only the first:

| Layer | What | Who owns it |
| --- | --- | --- |
| **At rest** | A strict Obsidian vault: markdown + `[[wikilinks]]` + YAML frontmatter + folders + `.base` files. Zero invention. | Obsidian conventions |
| **Capture affordances** | Autocomplete (shipped), type-picker entity creation, quick-capture, rollup tabs | Duo UI (mostly fast-follow) |
| **Agent layer** | Processing, synthesis, rollup authoring from prose, validation — everything Obsidian users need a plugin zoo for | Claude + `duo` CLI verbs + the skill |

**Vault compat is strict (D1):** the same folder opens correctly in Obsidian proper at all times. That is the escape hatch that keeps Duo's UI investment minimal and the data permanently portable.

## 2 · Glossary

| Term | Meaning |
| --- | --- |
| **vault** | A folder containing `.obsidian/`; detected by walking up from any file (shipped: `vaultIndex.ts`). |
| **entity** | A note representing a thing (person, initiative, theme, milestone, meeting), declared by folder + frontmatter `type:` (D3). |
| **type template** | `templates/<type>.md` — soft schema: frontmatter declares `type`, destination `folder`, expected `fields` (D5). Nothing enforces; processing validates. |
| **base / rollup** | A `.base` file or embedded ```` ```base ```` block (Obsidian Bases YAML): filters/formulas/views over frontmatter. "Rollup" = a base scoped to a parent entity via `… == this` (D8). |
| **corpus** | The vault-derived schema — types, entities, aliases, properties-per-type, observed enum values. A pure function over frontmatter, computed live (L0). **The vault IS the schema.** |
| **processing** | The agent pass (formerly "grooming"): file inbox notes, link entities, fix frontmatter, promote sections, propose connections — via CriticMarkup suggestions + a report note (D10). |
| **promote** | The processing op that splits a `##` section of a running doc into its own entity file, leaving an `![[embed]]` behind (D18). |
| **artifact** | A persisted render: stamped with generated-at + source hash + as-of date. A build product, not a sidecar — staleness is detectable (D13). |

## 3 · Locked decisions (D-numbered; sources in parentheses)

| \# | Decision | Choice |
| --- | --- | --- |
| D1 | At-rest format | Strict Obsidian vault; opens correctly in Obsidian always (r1 AUQ) |
| D2 | Edge syntax | Wikilinks in prose + typed fields in YAML frontmatter; no Dataview inline fields, no invented syntax (r1 AUQ) |
| D3 | Entity typing | Folders **and** frontmatter `type:`, both stamped by templates (r1 AUQ) |
| D4 | Entity creation | **Silent stub** — `[[New Name]]` ⇥ → type picker popover → file created from template in background; caret never leaves the note; "+ new type…" is the rare deliberate branch (r1 AUQ) |
| D5 | Schemas | `templates/` folder (Obsidian-standard, query-excluded); template frontmatter = `type` / `folder` / `fields` (r1 AUQ) |
| D6 | Capture grain | Atomic notes → `inbox/`; processing files them (r1 AUQ) |
| D7 | Layout | Vault lives anywhere (root marked by `.obsidian/`); **per-initiative folders** — no flat M×N milestone folder; folder layout is ergonomics only, queries are frontmatter-driven (r1.5) |
| D8 | Rollup definitions | **Obsidian Bases** `.base` files + embedded blocks; pre-validated by prototype (r2 walk) |
| D9 | Rollup surface | Affordance on the entity note → opens as a tab; **must work in both canvas and split-view** (owner note); CLI twin `duo base render/open` (r2 walk) |
| D10 | Processing interaction | CriticMarkup tracked suggestions **in Duo's exact format** (`core/markdown/criticmarkup.ts`, `duo doc insert/substitute` — no variants) + a dated report note; file moves listed in the report for approval (r2 walk) |
| D11 | Capture entry | Quick-capture: Duo settings gains a **default vault** field; chord **⇧⌘N** creates a templated inbox note (owner re-pick 2026-06-09 — the original ⌥⌘N collides with shipped New Window; New Window keeps ⌥⌘N) (owner re-pick 2026-06-10 — **⇧⌘N reassigned from New Folder/ENH-169**, which moves to **⌥⇧⌘N**). **Default-vault model (owner AUQ 2026-06-10):** the value is **machine-global** — one `~/.claude/duo/vault.json`, persistent across windows / workspaces / restarts, read live (no per-window cache). The picker is **window-independent**: it lists the **known vaults** (every vault ever set-as-default or `vault init`'d, self-healed against the live filesystem) ∪ the current default, plus Choose Vault… — the same rows in every window, not a per-cwd scan. Clearing the default **keeps** the known list (an out-of-workspace vault is never stranded). (r2 walk + r3 AUQ + r-final AUQ) |
| D12 | Build order | **Skill-first, zero new UI**; capture UX is the fast-follow ("not useful til I'm in the habit") (r2 walk) |
| D13 | Persistence | **Both** — live render in Duo + stamped artifact on demand (r2 walk) |
| D14 | Base authoring | Claude-from-prose + validator first; editor autocomplete in base blocks deferred (new CodeMirror work); form-builder deferred further (r1.5 AUQ) |
| D15 | Invalid references | **Warn + render anyway** — loud ⚠ with corpus-driven "did you mean"; never blocks; processing proposes fixes later (r1.5 AUQ) |
| D16 | Presentation | Rendered HTML (table/cards/list) is **Duo-owned, never user-authored**; cell styling only via `html()`/`icon()` formulas (r1.5) |
| D17 | Naming | The feature set is **"vault"** — settings, verbs, skill section; no graphbook noun user-facing (r3 AUQ) |
| D18 | Nested entities | **Running doc + promote-on-demand**; editable transclusion is the deferred Duo-native upgrade (r3 AUQ) |
| D19 | Filing model | **Per-type filing rule in the template, two shapes:** parentless types (person, theme) file in their type registry folder; parented types designate **one frontmatter attribute as the filing parent** (e.g. milestone → `initiative:`) and live under that parent's folder, with a per-type loose-vs-subfolder knob (milestones loose, notes in `notes/`). **Only folder-note types (initiatives) can be parents** — themes/people are link targets, never filing axes. Contextless parented files fall back to **time buckets** `notes/YYYY/MM/` — the residue after processing assigns parents; re-filed if a parent emerges later. All non-primary relationships remain links: filing loses no edges (r4 AUQ) |
| D20 | Archive | **Processing proposes archiving** completed initiatives (whole subtree → `archive/YYYY/`) in the report note — **never automatic**. Active tree shows only active work; wikilinks survive moves (basename-resolved); bases include/exclude `archive/` per view (r4 AUQ) |
| D21 | Smart insertions | **`@today`-style tokens inside the shipped `@` mention suggester** — smart tokens (today, tomorrow, yesterday, now/datetime) rank alongside file results in the existing AtMention popover; selecting inserts plain text (ISO `2026-06-09` default; long-form + time variants as sibling entries). **Extensible via a token-provider registry** (dates now; future providers register entries without new triggers). `/` stays reserved for a possible future block-insert menu. Deliberate CLI asymmetry: agents just write dates — no verb needed (r5 AUQ) |
| D22 | Vault search | **⌘⇧F searches the default vault** (D11 setting; falls back to the active file's vault) — full-text, in a palette reusing the TabSearchPalette UI shell (same `useKeyboardShortcuts` → window-event → overlay wiring as ⌘⇧A); results open file-at-line. Verified non-colliding: the find-bar's ⌘⇧F (find-previous) is input-local and stops propagation. (Owner re-pick 2026-06-10 — the **global** find-previous binding is retired in favor of the palette; the find-bar-local ⌘⇧F find-previous is retained.) CLI twin: `duo vault search <query>` (parity rule) (r5, owner spec) |

**Owner directive (r2 walk):** every shipped verb lands the full 4-surface sync (`cli/duo.ts` · `skill/SKILL.md` · `agents/duo.md` · `docs/CLI-COVERAGE.md`) **plus** a `what-duo-does.html` entry. This is restated as acceptance criteria in every phase below.

## 4 · The primitives

Each primitive below specifies: what the **user** does, what **Claude** does, the **CLI** surface, and the **files** touched. The Guide (§ 6) documents each one step-by-step with visuals.

### P1 · Vault establishment & detection

- **User:** "set up a vault in `~/work/notes`" (or runs the verb). Later: picks the default vault in settings (fast-follow).
- **Claude/CLI:** `duo vault init <folder>` scaffolds `.obsidian/` + `templates/` (starter person/initiative/milestone/meeting/theme) + `inbox/` + `bases/processing.base` + a one-page README. `duo vault list` enumerates vaults detected in the workspace (folders containing `.obsidian/`). Detection logic = the shipped `vaultIndex.ts` walk-up.
- **Files:** the scaffold; nothing outside the chosen folder.

### P2 · Entity types & templates (soft schemas)

- **User:** edits `templates/<type>.md` like any note; adds a new type by adding a template.
- **Claude:** reads templates as the authority for what fields a type expects; processing validates notes against them ("[Alice.md](http://Alice.md) missing `role`") — advisory only (D15 spirit).
- **CLI:** `duo vault schema` (the L0 corpus: types, entities, aliases, props-per-type, observed enums — JSON). Computed live from frontmatter; **never cached to disk** (no-sidecar).

### P3 · Entity creation (silent stub) — *fast-follow UI; skill does it conversationally in v1*

- **User (v1):** mentions a new person/initiative in prose to Claude → Claude creates the stub from the template and links it.
- **User (fast-follow):** types `[[Jordan Lee]]` ⇥ → type-picker popover (extends shipped `WikilinkSuggestion.ts`/`wikilinkCreate.ts`) → stub created from template in the type's folder; caret stays. Obsidian-side creations land untyped in Obsidian's default folder — processing catches and types them (designed asymmetry, called out per CLI-parity rule).

### P4 · Capture

- **User (v1):** narrates to Claude ("note from the pricing sync: …") → Claude writes a templated inbox note with entities linked.
- **User (fast-follow):** chord (OPEN-1) → new timestamped inbox note in the default vault, template-loaded, editor focused.
- **CLI:** `duo vault capture [--template meeting] [--text "…"]` — the chord's twin (parity rule).

### P5 · Linking, autocomplete & navigation

- **Shipped already:** `[[`/`@` suggesters, ⌘O quick switcher, cmd+click hops, create-on-unresolved.
- **New (this PRD):** bases as navigation hubs (rollup rows click through to source notes — D9/D16); **vault search** — ⌘⇧F full-text over the default vault in a TabSearchPalette-style overlay, results open file-at-line (D22); `duo vault search <query>` for the agent; `duo graph backlinks <note>` / `duo graph orphans`.
- **New (this PRD, capture-side):** **smart insertion tokens** — `@today` etc. in the shipped `@` suggester via a token-provider registry (D21).
- **Deferred:** backlinks UI panel; entity-typed `@` ranking; `/` block-insert menu (namespace reserved by D21).

### P6 · Nested entities (running docs + promote)

- **User:** keeps e.g. `initiatives/Q3 Launch/Meetings.md` with one `##` section per meeting; links sections as `[[Meetings#2026-06-09]]`. No file-flipping.
- **Claude (processing op "promote"):** when a section needs properties or base visibility — splits it into an entity file from the matching template, replaces the section body with `![[<new note>]]`, preserves the heading anchor. Reversible (inline the embed back).
- **CLI:** none needed v1 (skill choreography over existing file ops + `duo doc` verbs); `duo vault promote` is a candidate verb if the op proves frequent.
- **Deferred:** editable transclusion (inline-editable embeds; nested-ProseMirror).

### P7 · Rollups (author → lint → render → refresh)

The full lifecycle is illustrated in the intent playground and reproduced in the Guide.

- **Author:** user describes the view in prose → Claude derives the corpus (P2's `duo vault schema`) → writes the `.base` (vault-wide → `bases/`; per-entity → embedded block in the **type template** with `… == this`, so every entity inherits it) → `duo base lint` loops until clean → render.
- **Lint (L1):** `duo base lint <file|--all>` — structural (YAML keys, view types) + expression (DSL parses; `if` keyword handling) + corpus checks (types, `[[entities]]`, enum values, function names) each with Levenshtein "did you mean". JSON output for agents; pretty for humans. **Warn-and-render (D15): lint never blocks.**
- **Render:** `duo base render <file|note> [--out <path>] [--open]` — evaluates filters/formulas over live frontmatter; emits Duo-owned HTML (D16). Two modes per D13: *live* (temp render, opened as a tab, not persisted) and *artifact* (written to the vault's `output/` (or legacy `out/`, ENH-246) or `--out`, stamped: generated-at · source-hash · as-of date).
- **Refresh:** vault changes make the artifact's source hash stale **detectably**. v1 trigger: on demand. Fast-follow: re-render on tab focus. Deferred: chokidar watcher; scheduled processing job re-renders + flags.
- **Engine scope (locked by prototype):** the expression subset proven in `render.mjs`/`lint.mjs` — and the known extension points: `if`→ternary transform, date-only YAML = local midnight, `file.name` = extension-less. Child→parent rollups (backlink property chains) are **supported in our renderer** even where Obsidian's support is fragile.

### P8 · Processing

- **Trigger:** v1 on demand ("process my vault" / skill command). Deferred: scheduled headless job (same skill, zero new infra — D10's report-note model is what makes unattended runs reviewable).
- **Work-list:** computed live — stale inbox (&gt; 1 week), untyped notes, missing required fields (vs templates), unresolved links, ⚠ render flags. (`bases/processing.base` renders the same list for the human.)
- **Ops:** file inbox notes per the **D19 filing rules** (parent folder where a parent attribute resolves; `notes/YYYY/MM/` residue otherwise; re-file when a parent emerges later — moves listed in report for approval); add/repair frontmatter + links (CriticMarkup, exact Duo format — D10); promote sections (P6); **propose archiving** completed initiatives per D20; propose novel connections (always proposals, never silent).
- **Output:** a dated report note in the vault linking every touched file + each proposed move; suggestions accepted/rejected in the editor via the shipped `duo doc accept/reject` flow.
- **Hard dependency:** BUG-199 (`duo doc edit` whole-document churn) **must be fixed or routed around** before processing edits notes at scale — processing must use the surgical `plainEdit`/CriticMarkup paths exclusively and verify diffs are insertion-sized.

## 5 · CLI surface (v1 verb cluster)

| Verb | Does | Output |
| --- | --- | --- |
| `duo vault init <folder>` | Scaffold a vault (P1) | created paths |
| `duo vault list` | Vaults detected in workspace | JSON |
| `duo vault schema [--vault <path>]` | L0 corpus (P2) | JSON |
| `duo vault capture [--template t] [--text …]` | New inbox note (P4) | path |
| `duo graph backlinks <note>` / `duo graph orphans` | Reverse links / unlinked notes (P5) | JSON |
| `duo vault search <query> [--vault <path>]` | Full-text search — ⌘⇧F's CLI twin (P5, D22) | JSON hits (file, line, excerpt) |
| `duo base lint <file|--all>` | Validate (P7) | JSON findings |
| `duo base render <file|note> [--out] [--open]` | Render live or artifact (P7) | path / tab id |

Each verb: 4-surface sync + CLI-COVERAGE row + what-duo-does entry (owner directive). Settings "default vault" (fast-follow UI) ships with its CLI twin `duo vault default [path]` per the parity rule.

## 6 · The Vault Guide — explicit deliverable

**A step-by-step, illustrated guide covering every primitive end-to-end** — the owner-mandated artifact for learning and reference, built **in Phase 1**(not after), because the skill-first slice succeeds only if the habit forms.

- **Form:** one scrolling Atelier HTML page, `skill/references/vault-guide.html` (moved here from `docs/guide/` in ENH-228 so it ships in the DMG with the skill; duo-openable at `~/.claude/skills/duo/references/vault-guide.html`; linked from `what-duo-does.html`). Visual language reuses the intent playground's proven components: anatomy diagrams (`pre.diagram`), actor-coded lifecycle lanes (YOU / CLAUDE / SCRIPT / FILES), 3-step flow mocks, rendered-rollup mocks.
- **Chapters (one per primitive, each = steps × actors + at least one visual):**
   1. What a vault is — anatomy diagram (P1)
   2. Establishing a vault & setting the default — init lifecycle lanes (P1)
   3. Types, templates & filing rules — schema diagram: template → filing rule (registry vs parent-attribute) → frontmatter (P2, D19/D20 incl. archive) (P2)
   4. Creating entities while you type — the 3-step silent-stub mock (P3)
   5. Capturing a note — inbox flow now, ⇧⌘N chord + `@today` smart tokens fast-follow (P4, D21)
   6. Finding things — the navigation modes side-by-side, incl. ⌘⇧F vault search (P5, D22)
   7. Running docs & promoting a section — before/after split visual (P6)
   8. **Generating a rollup** — prose → corpus → `.base` → lint loop → render → open, the full Generate lane (P7)
   9. **Refreshing a rollup** — change → stale hash → re-render; live vs artifact (P7, D13)
  10. Processing — trigger → work-list → ops → CriticMarkup review → report note (P8)
- **Acceptance:** every chapter names the exact user action, the exact Claude behavior, and the exact verb; every chapter has ≥1 visual; the guide is walked in the phase's smoke-walk; updated in the same commit as any behavior change it documents (structural-change audit rule).

## 7 · Development approach

### Phase 1 — the skill-first slice (v1, per D12)

*Goal: the owner lives in a real vault within days; zero renderer/editor UI work.*

1. **Promote the prototype scripts to real verbs** — port `lint.mjs` + `render.mjs` + corpus extraction into `cli/duo.ts` as the § 5 cluster (`vault init/list/schema/capture`, `graph backlinks/orphans`, `base lint/render`). The prototype is the reference implementation and stays as fixtures for regression tests (lint findings, render row-counts, the `if`/date/`this` transforms).
2. **The vault skill** — new section/reference in `skill/SKILL.md` (+ agent + coverage sync): conventions, capture-by-narration, entity stubbing, rollup authoring loop, the full processing pass incl. promote. `npm run sync:claude` after.
3. **The Vault Guide** (§ 6) — built alongside the skill, from the same source of truth.
4. **what-duo-does.html entry** + CLI-COVERAGE rows.
5. **Owner setup:** init the real work vault, set up starter types with Geoff, author the first two rollups from prose.
6. **Smoke-walk** (verbs + skill flows + guide), then propose a cut.

*Exit criteria:* owner captures daily notes by narration; first processing pass reviewed via CriticMarkup; one portfolio base + one template-embedded rollup live; `duo base lint --all` clean on the real vault. *Effort: M.*

### Phase 2 — capture UX (fast-follow, per D12/D11)

**Status: shipped 2026-06-10** — Settings → Default Vault picker · ⇧⌘N quick-capture · ⌘⇧F vault-search palette · `@today` smart tokens · silent-stub type-picker.

Settings "default vault" selector (+ `duo vault default`); the capture chord **⇧⌘N** → templated inbox note; the type-picker silent-stub flow on ⇥ (extends `WikilinkSuggestion`/`wikilinkCreate`); **smart insertion tokens** — `@today` family in the `@` suggester via the token-provider registry (D21, extends shipped `AtMention.ts`); **vault search** — ⌘⇧F → `VaultSearchPalette` (clones the ⌘⇧A TabSearchPalette wiring: `useKeyboardShortcuts` → window event → overlay; main-process full-text scan over the default vault) + `duo vault search` (D22). Smoke-walk; cut. *Effort: M–L.*

### Phase 3 — rollups in the app (D9/D13)

"Rollup" affordance on entity notes (canvas **and** split-view per owner note) opening the live render as a tab; re-render on tab focus; artifact "publish" action. Renderer moves from CLI-spawn to a shared module. *Effort: M–L.*

### Phase 4 — deferred ledger (explicitly not now)

Chokidar watcher freshness · scheduled processing (cron/headless) · backlinks panel · entity-typed `@` ranking · editor autocomplete inside base blocks (CodeMirror mode) · editable transclusion (nested ProseMirror) · property write-back in rendered tables (Obsidian parity) · `#tag` rendering · `duo vault promote` verb.

## 8 · Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **BUG-199** — doc-edit churn corrupts notes during processing | Blocker for P8 at scale: fix BUG-199 or constrain processing to `plainEdit`/CriticMarkup paths + post-edit `git diff --numstat` guard (insertion-sized or revert) |
| Bases spec drift (Obsidian ships new syntax) | Pin "verified against 1.13.0" in the lint vocabulary; lint treats unknown functions as **warn** not error (D15); re-verify on Obsidian majors |
| Expression-engine scope creep | The engine implements the documented subset + what lint accepts — lint and render share one vocabulary table; anything else renders as ⚠ cell |
| In-Obsidian probe results pending (OPEN-2) | Doesn't gate Phase 1 (our renderer covers the gap); walk the probes before Phase 3 invests in app UI |
| Vault scale / index staleness | Corpus computed per-invocation in v1 (vault ≪ 5k-file BFS cap); watcher is Phase 4 |
| iCloud-Documents dataless eviction (known trap) | `vault init` README warns if the vault is under `~/Documents` with Optimize Storage; reuse `check-materialization` pattern |
| Vocabulary bloat | D17: "vault" only; [vocabulary.md](http://vocabulary.md) gains the term in Phase 1 (4-surface sync includes it) |

## 9 · Open items

- **~~OPEN-1 · capture chord~~** — **RESOLVED 2026-06-09: ⇧⌘N** for capture; New Window keeps ⌥⌘N (folded into D11).
- **OPEN-2 · in-Obsidian probe walk:** `initiative == this` embeds, `html()` chips, `probe_a/b` — owner opens the prototype vault in Obsidian and reports. Gates Phase 3 polish only.
- **OPEN-3 · layout YAML keys:** card size / image / row height have no documented keys; author once in Obsidian's UI and copy serialized output when needed.

## 10 · Requirements changed / fixes applied (dated notes)

**2026-07-02 (ENH-245) — dual `_index.md`/`index.md` + `_log.md`/`log.md` OKF filename convention.** D4/D8's original OKF marker filename (`index.md`, section 3's Glossary + D4 row) is now ONE of two supported conventions, not the only one: the owner switched the primary work vault's convention to the underscore-prefixed `_index.md`/`_log.md` (sorts to the top of a folder, reads unambiguously as "generated"). Owner AUQ (2026-07-02): (1) Duo detects **either** convention per-vault — never breaks an existing `index.md` vault; (2) new vaults and any freshly-written listing default to the underscore-prefixed form; (3) `log.md` gets the same treatment, always **paired** with whichever index convention the vault root already uses (a legacy `index.md` vault's first `publish` writes `log.md`, never a mixed `index.md` + `_log.md`); (4) this is Duo's **global default**, not a per-vault opt-in flag. Implementation: `core/vault/okf-filenames.ts` is the new single source of truth (was ~6 scattered hardcoded string literals across `detect.ts`/`scaffold.ts`/`listings.ts`/`render.ts`/`default-vault.ts`/`cli/duo.ts`, including two independently-drifted "is this generated" checks that this also unified). Every place in this PRD that says `index.md` (the P1 glossary, D4, D8, P7's `duo vault publish` description, § 5's CLI-surface table) should be read as "root index — `_index.md` default, `index.md` legacy, both detected," not the literal filename.

**2026-07-02 (ENH-246) — rendered-artifact folder renamed `out/` → `output/` (same session, same dual-convention pattern).** The Glossary's "artifact" entry and P7/§5's "written to the vault's `out/`" language now mean `output/` by default, with legacy `out/` still detected and honored per-vault (new `core/vault/output-dir.ts`, mirroring `okf-filenames.ts`'s pattern exactly — resolve-what's-on-disk, default-to-new-for-fresh-vaults, never split one vault across both names). Mode-agnostic — applies to both OKF and Obsidian vaults, since `duo base render`/`duo rollup render` write there in either mode.

**2026-07-09 (ENH-266) — frontmatter entity references are now markdown links in OKF mode, REVERSING FOLLOWUP-051.** FOLLOWUP-051 (2026-06-14, folded into this PRD's D7 → wikilink flip) made a typed frontmatter field naming another note (`owner:`, `initiative:`, `attendees:`, `themes:`, …) persist as `[[Title]]` in BOTH vault modes, on the premise that a bare, un-bracketed relative path in a YAML value (`owner: "./people/alice-park.md"`, no brackets) is invisible to every link parser — Duo's own reader AND Obsidian's. That premise about bare paths is still correct, but this session ran a LIVE empirical validation (a real OKF vault opened in a real installed Obsidian 1.12.7) and found the FOLLOWUP-051 fix itself was wrong: a title-based `owner: "[[Alice Park]]"` value creates an **unresolved PHANTOM NODE** in Obsidian's graph, not a link to the real note — OKF filenames are SLUGS (`alice-park.md`), and Obsidian's frontmatter-wikilink resolver matches by **filename only**, never by `title:`, never by an `aliases:` entry either (both were tested and both fail). A proper markdown-link VALUE, `owner: "[Alice Park](../people/alice-park.md)"` — the same syntax prose already uses — resolves CORRECTLY in Obsidian (clickable in Properties, a real backlink), independent of Obsidian's "Use wikilinks" setting, AND Duo's own reader already accepted this syntax with **zero code changes**: `core/markdown/vaultLinks.ts`'s `extractLinkRefs` and `core/vault/corpus.ts`'s `engineEntityRefs` already scan both wikilink and markdown-link syntax for any `.md`-suffixed target (this was ENH-229/ENH-258 groundwork, unrelated to this fix, that happened to already cover it).

Decision (D7, superseding the FOLLOWUP-051 flip): **OKF mode writes a QUOTED standard markdown relative link for a frontmatter entity reference; Obsidian mode is UNCHANGED** (still `[[Title]]` — Obsidian-mode filenames ARE the titles, so basename resolution works fine there; the phantom-node failure is OKF-specific). The quoting is load-bearing: a frontmatter VALUE starting with `[` is otherwise read by YAML as a flow-sequence opener, not a string (`owner: [[Alice Park]]` unquoted parses to a nested array, invisible to `corpus.ts`'s `entityRefsByType`/`engine.ts`'s `parseLinkish` — though still found by the raw-regex `VaultFile.links`/backlinks scan, which is YAML-agnostic; the two systems silently diverge on this bug class). New serializer: `serializeOkfFrontmatterLink`/`frontmatterLinkSerializerFor` in `core/markdown/vaultLinks.ts`, routed through every frontmatter write site (the `useFrontmatterWikilink` gesture in the Properties panel raw-YAML editor). Migration for a vault authored before this date: `duo vault relink --frontmatter [--dry-run]` (OKF-only; **as of 2026-07-13 this migration also runs AUTOMATICALLY on vault open — see the dated note below; the description here reflects the original 2026-07-09 opt-in-only design**), covering four categories: (a) frontmatter wikilink values → quoted markdown links; (b) frontmatter BARE unbracketed rel-paths (the original FOLLOWUP-051 concern, now also a first-class migration target since a bare path IS resolvable when it happens to point at a real file) → quoted markdown links; (c) leftover prose-body wikilinks (from hand-editing in Obsidian) → markdown links; (d) alias backfill for entities whose `title:` differs from their slug filename. Ambiguous/unresolvable targets in any category are reported and left untouched, never guessed (D15 warn-don't-block spirit). Tracker: `tasks.md` ENH-266 (4-PR execution: core cluster · GUI cluster · docs/migration polish · smoke-walk verification).

**2026-07-13 (ENH-266 follow-up) — the frontmatter migration now runs AUTOMATICALLY on vault open, superseding the 2026-07-09 opt-in-only design.** The 2026-07-09 note above deliberately kept `migrateFrontmatterLinks` an explicit, opt-in `duo vault relink --frontmatter` verb, never wired into the auto-relink-on-vault-open hook — consistent with the vault's "never silently rewrite note content" instinct. The owner rejected that as failing the stated *backward-compatibility* bar: requiring a human to discover and run a CLI command means a legacy OKF vault does NOT "just work" in Obsidian, which was the entire goal. After being shown the exact mechanism and its risk in a structured decision (four options: one-time-confirm / fully-automatic-silent / automatic-with-summary / UI-button), the owner explicitly chose **fully automatic, always silent**. Implementation: `maybeAutoRelinkVault` (`electron/main.ts`) now calls `migrateFrontmatterLinks` as a peer to `relinkVault`, under the IDENTICAL gating already proven safe for relink — OKF-mode only, D5 foreign-bundle-guarded (a loopkit/brainkit `loop.manifest.json` bundle is never touched automatically), deduped, deferred off the critical-path, and using the same write/report split (the boot-into-default-vault path WRITES; a live vault-switch only reports, matching relink's PR#98-F5 policy). The `duo vault relink --frontmatter` verb is unchanged and remains available for a `--dry-run` preview or headless/CI use. Safety net is the same as every other on-open rewrite: file-history capture (fires on every write) + git for tracked vaults. **Process note (kept deliberately, as a real lesson):** two earlier delegated-workflow attempts to ship this failed — the first because the authorization wasn't specific enough, the second because a follow-up prompt conflated *design authorization* with a false claim that *implementation already existed*, and separately would have published docs describing unshipped behavior. This version was built directly, under supervision, with the docs updated ONLY after the code was written, tested, and verified against a real vault — the ordering that prevents docs-ahead-of-code drift. See `tasks.md` § ENH-266 for the full incident record.