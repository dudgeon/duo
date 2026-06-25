# ENH-228 PRD — Vault view: inbox + rollups, a top-level surface beside Home

> **Status:** Decisions FINAL (owner playground submission, 2026-06-24). Build not
> started. This PRD is the locked-scope record; the owner-decision artifact is
> [`docs/research/vault-inbox-rollups-view.html`](../research/vault-inbox-rollups-view.html)
> (rule 11). Ledger entry: `tasks.md` ENH-228. **Extends the ENH-229 rollup
> family** (`docs/prd/enh-229-rollup-maturity.md`).

## Summary

A new top-level **Vault** view beside the Home tab, shown while a vault is
selected. Two columns:

- **Inbox** — the vault's `inbox/` capture notes (newest first; stale >1wk
  flagged), with a **+ Capture** button (the `duo vault capture` / ⇧⌘N twin).
- **Rollups** — the vault's rollups, each a link that opens its rendered **HTML**
  artifact, with a **+ New rollup** button that spawns a Claude session seeded
  with the rollup-authoring loop.

The UI is cheap (it follows the Home pinned-tab pattern). The substantive work is
the **rollup-lifecycle change** that makes discovery reliable: a rollup becomes a
**first-class `type: rollup` note**, so the view's rollups list is a corpus query
(`type == rollup`) rather than a fragile filesystem scan.

## Background — the rollup-discovery gap (research finding)

Two Explore agents over `core/vault/**` + the renderer confirmed the owner's
intuition that rollup location is underspecified. "Rollup" is three uncoordinated
mechanisms with **no registry, no named handle**: Obsidian `.base` → `out/`; OKF
listings in `index.md`/`log.md`; ENH-229 artifacts → `rollups/`. There is no
`type: rollup`. The **inbox half is already well-defined** — capture notes land
in `inbox/` with a `captured:` frontmatter date (`core/vault/scaffold.ts`); stale
= `captured < today − 1 week` (`processing.base`).

The fix the owner chose promotes the rollup from "a rendered file somewhere" to a
**note in the graph that owns its spec and its render provenance** — discovery
becomes a corpus query, the same way every other typed entity is discovered.

## A. Decisions (FINAL — owner playground submission, 2026-06-24)

The owner walked the rendered playground and selected the recommended option on
every card. Two reverse the earlier quick-round answers; the playground
submission supersedes (it is the rule-11 decision mechanism).

- **D1 — Discovery = rollup is a first-class `type: rollup` note** (card B). A
  rollup is a typed note from a new `templates/rollup.md`, carrying its **spec**
  (an embedded ` ```base ` block or a `spec:` frontmatter key) and its **render
  provenance** (`last_generated`, `last_hash`, `out:` → the artifact path,
  `format:`). Discovery is the corpus query `type == rollup` — **no scan, no
  `index.json` sidecar.** Unifies OKF + Obsidian (both get `type: rollup` notes)
  and is backward-compatible. **§D9-clean:** the note is real vault content that
  owns its own spec; stamping provenance into its frontmatter is the note
  recording its own build, not a sidecar mirroring derivable state (same
  principle as ENH-229's artifact stamps).
- **D2 — HTML-first rollups** (owner freehand note: *"the rollups I'm most
  interested in producing are HTML based, not MD"*). The `type: rollup` template
  defaults `format: html`; the authoring loop (D4) and `duo rollup render` emit
  **HTML** into `rollups/` by default; MD stays an opt-in. *This nudges ENH-229
  D3 (which defaulted MD for OKF vaults) — fold the default-format change into
  the render work here, and cross-note it in the ENH-229 PRD.*
- **D3 — View subject = the default vault** (card "default"; reverses the
  earlier active-file choice). The view shows the `duo vault default`
  (`~/.claude/duo/vault.json`); the tab appears whenever a default is set. A
  small **vault-switcher in the view header** re-points it among `knownVaults`
  (and updates the default). Reuses an existing, persisted, single-source
  concept — no new app-level selected-vault state, no tab flicker.
- **D4 — Tab placement = pinned beside Home, shown only when a vault is
  selected** (card "pinned-when-vault"). A synthesized `type:'vault'` sentinel
  tab (the Home pattern), present whenever a default vault exists; no clutter for
  non-vault users.
- **D5 — "+ New rollup" = a prefilled Claude session** (card "claude-session").
  The button opens a Claude session seeded with the authoring loop: *get the
  corpus (`duo vault schema`) → write the `type: rollup` note + spec → `duo base
  lint` → `duo rollup render --html --open` into `rollups/`.* Inherits the
  resolved vault (D3) as cwd/`--vault`. No new form UI.
- **D6 — Inbox scope = all notes, stale flagged** (card "all-flag-stale").
  Newest-first list of `inbox/`; rows >1wk old carry an amber "stale" flag;
  clicking opens the note. *Fast-follow:* a "Process inbox" button (card option
  `all-plus-process`) handing the work-list to Claude.
- **D7 — First slice = the full slice incl. the typed-note lifecycle change**
  (card "full"). Ship the view + inbox + rollups + the `type: rollup` model
  together, so the rollups list is reliable from day one. One PRD, one ENH.

### Rejected / deferred
- **Convention + `rollups/` scan** (card A) — the earlier quick-round MVP; now
  superseded by D1's typed-note model (more robust, named handles).
- **`rollups/index.json` manifest** (card C) — a sidecar; violates CLAUDE.md §12
  / D9.
- **Active-file anchor / explicit per-window selection** (D3 alternatives) — owner
  chose the default-vault anchor.
- **Stub-then-edit / both** create paths (D5 alternatives) — Claude-session first.

## B. Implementation plan (phased)

1. **The `type: rollup` model (core + template).** Add `templates/rollup.md`
   (frontmatter: `type`, `spec`/embedded base block, `format: html`,
   `out`, `last_generated`, `last_hash`). Teach `duo rollup render <note>` to (a)
   read the spec from the note, (b) render HTML into `rollups/<slug>.html` by
   default, (c) **stamp `last_generated`/`last_hash`/`out` back into the note's
   frontmatter** (surgical frontmatter write, not a body rewrite). Add
   **`duo rollup list`** = corpus query `type == rollup` → `[{note, title, out,
   format, last_generated, last_hash, stale}]` where `stale = last_hash !==
   sourceHash(root)`. 4-surface sync (`cli/duo.ts` · `skill/SKILL.md` ·
   `agents/duo.md` · `docs/CLI-COVERAGE.md`); `npm run build:cli` + `git add
   cli/duo`.
2. **Skill/agent docs.** Update `skill/references/vault.md` +
   `skill/references/rollup.md` + `agents/duo.md`: the authoring loop now writes a
   `type: rollup` note and renders **HTML into `rollups/`**; `npm run sync:claude`.
3. **IPC — read verbs + default-vault.** `vault.listInbox({ vaultRoot })`,
   `vault.listRollups({ vaultRoot })`, and read/set of the default vault
   (`vault.getDefault` / `vault.setDefault`, reusing `core/vault/default-vault.ts`)
   in `shared/types.ts` → `electron/preload.ts` → `electron/main.ts`.
4. **Renderer — the view.** Add `'vault'` to `WorkingTabType`; synthesize the
   pinned `type:'vault'` tab after Home when a default vault exists (D3/D4);
   dispatch `<VaultView>` in `WorkingPane.renderFileTab()`; build `VaultView`
   (header vault-switcher + two columns) + a `useVaultSnapshot(vaultRoot,
   isActive)` hook mirroring `useCronJobs`. Capture → `vault.capture`; rollup row
   → open the HTML artifact; New-rollup → seed a Claude session; stale chip from
   `listRollups`.
5. **Verify** — `/smoke-walk`: tab appears with the default vault + switcher,
   inbox lists + capture, rollups list + freshness + open HTML + new-rollup
   session. Then propose a cut.

## C. Architecture seams

- **Home pattern** — `renderer/components/Home/homeTab.ts` (synthesized,
  never-persisted, pinned slot-0) is the template; the Vault tab is its sibling
  dispatched in `renderer/components/WorkingPane.tsx` (`renderFileTab`).
- **Default vault** — `core/vault/default-vault.ts` (`~/.claude/duo/vault.json`,
  `defaultVault` + `knownVaults`) is the persisted anchor (D3); already has a
  `vault.default` CLI twin and Settings → Default Vault.
- **Rollup data** — `duo rollup list` (corpus query) is the single data contract;
  the renderer never scans the filesystem.
- **Provenance stamping** — reuse `core/vault/render.ts sourceHash()`; the stamp
  written back to the note mirrors the ENH-229 artifact stamp fields.

## D. Test coverage (planned)

- `core/vault` unit: `listRollups` over a fixture vault — fresh vs stale
  (`last_hash` mismatch), notes without `out` (never rendered), empty → `[]`.
- `rollup render` stamps `last_generated`/`last_hash`/`out` into frontmatter
  surgically (body untouched; idempotent re-render updates only those keys).
- `listInbox` — folder + `captured:` parsing, stale threshold boundary.
- Renderer: vault tab appears when a default vault is set, switcher re-points +
  updates default, empty state when no default.

## E. Open follow-ups (not in the first slice)

- "Process inbox" button → Claude (D6 fast-follow).
- Both-paths create menu (guided vs blank note) once the Claude path proves out.
- Inline rollup "re-render" affordance (calls `duo rollup render`).
- Fold the HTML-default (D2) decision into the ENH-229 PRD's D3 note. ✅ done
  (ENH-229 D3 SUPERSEDED note added; `duo rollup render` default flipped to HTML).

## F. Requirements changed / fixes applied (build log)

- **2026-06-24 — where the rollup NOTE lives vs the corpus-skip of `rollups/`.**
  The PRD (B.1) renders artifacts into `rollups/<slug>.html` and (D1) discovers
  rollups via the corpus query `type == rollup`. But the *general* corpus walk
  (`core/vault/parse.ts` `SKIP_DIRS`) deliberately skips `rollups/` so that
  rendered artifacts never pollute the corpus / `sourceHash` — so a literal
  `readNotes().filter(type==rollup)` returns nothing. **Resolution (D1-faithful):**
  the rollup *note* lives in `rollups/<slug>.md` (`type: rollup`) and its *artifact*
  renders to `rollups/<slug>.html` (different extension — no collision);
  `listRollups` scopes the `type == rollup` query to the `rollups/` folder. The
  `type: rollup` filter drops rendered `.md` artifacts (they carry no `type:`) and
  `.html` artifacts are excluded by the `.md`-only read — both invariants hold,
  and discovery stays a type query (not an artifact-filename scan, not a sidecar).
  A collision guard refuses an artifact path equal to the note path (the `--md`
  edge). `core/vault/parse.ts` is untouched (zero regression to the corpus suite).
- **2026-06-24 — HTML default flipped globally (D2).** `duo rollup render` now
  defaults to HTML across the board (`--md` opt-in), honoring a `type: rollup`
  note's declared `format:` when no flag is given. This supersedes ENH-229 D3's
  MD default (cross-noted there). The `duo rollup format` preference verb is not
  built — the per-rollup default lives in the note's `format:` field (§D9-clean).
- **2026-06-24 — `templates/rollup.md` added to BOTH scaffolds.** Makes `rollup`
  a first-class corpus type (D1) for new vaults (`duo vault stub rollup`, schema
  awareness). Existing vaults work without it — `listRollups`/`resolveRollupNote`
  read `type: rollup` frontmatter directly. The template ships NO live embedded
  ```base block (so a stub never inherits a phantom query). Affected the bounded
  set of scaffold/okf type-set assertions (now a 6-type set); the static
  `graphbook-prototype` fixture is unaffected.
