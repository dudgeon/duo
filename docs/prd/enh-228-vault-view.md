# ENH-228 PRD — Vault view: inbox + rollups, a top-level surface beside Home

> **Status:** Decisions locked (owner, 2026-06-24). Build not started. This PRD is
> the locked-scope record; the owner-decision artifact is
> [`docs/research/vault-inbox-rollups-view.html`](../research/vault-inbox-rollups-view.html)
> (rule 11). Ledger entry: `tasks.md` ENH-228.

## Summary

A new top-level **Vault** view that sits beside the Home tab and is shown while
the active file resolves to a vault. Two columns:

- **Inbox** — the vault's `inbox/` capture notes (newest first; stale >1wk
  flagged), with a **+ Capture** button (the `duo vault capture` / ⇧⌘N twin).
- **Rollups** — the vault's rollups, each a link that opens its rendered
  artifact, with a **+ New rollup** button that spawns a Claude session seeded
  with the rollup-authoring loop.

The UI is cheap (it follows the Home pinned-tab pattern). The substantive work is
making **rollup discovery reliable**, which today it is not: "rollup" is three
uncoordinated mechanisms with no registry (see *Background*). The owner chose the
**MVP path** — discovery by scanning the `rollups/` directory — gated on one real
convention change: **the skill + agent must always render rollups into `rollups/`**,
so a scan is authoritative.

## Background — the rollup-discovery gap (research finding)

Two Explore agents over `core/vault/**` + the renderer confirmed the owner's
intuition that rollup location is underspecified. "Rollup" is three mechanisms:

1. **Obsidian `.base`** (`duo base render`) — source in `bases/*.base` + embedded
   ` ```base ` blocks in notes/templates; renders to **`out/*.html`** (transient).
2. **OKF static listings** (`duo vault publish`) — `index.md` / `log.md` bodies.
3. **ENH-229 rollup artifacts** (`duo rollup render`) — render to **`rollups/*.{md,html}`**,
   stamped with source-hash + generated-at + embedded snapshot/diff history.

There is no `type: rollup`, no index, no named handle. The inconsistency that
breaks a reliable view: `duo base render` defaults to `out/` but `duo rollup
render` (the mature path) defaults to `rollups/`. The **inbox half is already
well-defined**: capture notes land in `inbox/` with a `captured:` frontmatter
date (`core/vault/scaffold.ts`); stale = `captured < today − 1 week`
(`processing.base`).

## A. Decisions (locked via the AskUserQuestion round + playground, 2026-06-24)

- **D1 — Discovery model = scan `rollups/` (MVP), made authoritative by
  convention.** No `type: rollup` note, no manifest, no sidecar. The view reads a
  new **`duo rollup list`** verb that scans the vault's `rollups/` directory live
  every call (§D9-clean — pure function over the filesystem, never cached) and,
  for each artifact, reads the embedded stamp (source-hash, generated-at) to
  report freshness vs the live corpus hash. *Owner:* *"as long as the agent/skill
  will know to make rollups in the `rollups/` dir, I think this is a solid MVP."*
  → the load-bearing change is **D2 below**.
- **D2 — `rollups/` is the canonical rollup home (the one lifecycle change).**
  Update `skill/references/vault.md`, `skill/references/rollup.md`, and
  `agents/duo.md` so the rollup-authoring loop always emits into `rollups/`
  (i.e. steer through `duo rollup render`, whose default `--out` is already
  `rollups/`; reserve `out/` for transient `duo base render` previews). The
  agent/skill instruction is explicit: **a rollup the user should be able to find
  lives in `rollups/`.** This is what makes D1's scan authoritative.
- **D3 — View subject = the active file's enclosing vault** (owner choice; *not*
  the default vault). Resolve via the existing `findVaultRootAndMode()`
  (`renderer/components/editor/wikilinkResolver.ts`) walking up from the active
  working tab's path. The Vault tab is shown while the active file resolves to a
  vault and **retargets** as the active file changes vaults. *State-and-proceed
  (rule 6):* to avoid a pinned tab that flickers away, the tab is **sticky to the
  last-resolved vault** when the active file is not in a vault, and shows a "open
  a file in a vault" empty state only until the first vault is seen in the session.
  Flagged for the owner to confirm during the smoke-walk.
- **D4 — "+ New rollup" = a prefilled Claude session** (owner choice). The button
  opens a terminal/Claude session seeded with the authoring-loop prompt: *get the
  corpus (`duo vault schema`) → write the `.base`/spec → `duo base lint` → `duo
  rollup render --open` into `rollups/`.* Matches the vault's agent-layer design;
  no new form UI. The session inherits the resolved vault (D3) as cwd/`--vault`.
- **D5 — Inbox scope = all inbox notes, stale flagged** (playground rec, not
  re-asked). Newest-first list of `inbox/`; rows >1wk old (the `processing.base`
  threshold) carry an amber "stale" flag. Clicking a row opens the note in the
  editor. *Fast-follow candidate:* a "Process inbox" button handing the work-list
  to Claude (pairs with D4).
- **D6 — First slice = the whole view with scan-based discovery** (consistent
  with the MVP lifecycle choice). Ship the view + inbox + rollups together;
  rollup discovery is the `rollups/` scan. A later upgrade to declared/typed
  rollups stays possible without changing the view's data contract (it always
  speaks `duo rollup list`).

### Rejected / deferred
- **Typed-note rollups** (`type: rollup`) — the cleaner long-term model (discovery
  = corpus query) but more than the MVP needs; deferred, not foreclosed.
- **`rollups/index.json` manifest** — a sidecar; violates CLAUDE.md §12 / D9.
- **Anchoring on the default vault** — owner chose active-file-follow instead.

## B. Implementation plan (phased)

1. **CLI — `duo rollup list` (+ 4-surface sync).** Scan `<vault>/rollups/` for
   `*.{md,html}`; for each, parse the embedded stamp (source-hash, generated-at,
   view names) and compute `stale = embeddedHash !== sourceHash(root)`. JSON out:
   `[{path, title, format, generatedAt, sourceHash, stale}]`. Reuse
   `core/vault/render.ts sourceHash()` + the ENH-229 stamp parser. Sync
   `cli/duo.ts` · `skill/SKILL.md` · `agents/duo.md` · `docs/CLI-COVERAGE.md`;
   `npm run build:cli` + `git add cli/duo`.
2. **Docs — codify `rollups/` (D2).** Edit `skill/references/vault.md` (the
   rollup-authoring loop section), `skill/references/rollup.md`, and
   `agents/duo.md`; `npm run sync:claude`.
3. **IPC — two read verbs.** `vault.listInbox({ vaultRoot })` and
   `vault.listRollups({ vaultRoot })` in `shared/types.ts` (IPC enum) →
   `electron/preload.ts` → `electron/main.ts` (delegating to `core/vault`,
   same code paths as the CLI).
4. **Renderer — the view.** Add `'vault'` to `WorkingTabType`; synthesize a
   pinned `type:'vault'` tab after Home keyed on the resolved vault (D3);
   dispatch `<VaultView>` in `WorkingPane.renderFileTab()`; build `VaultView`
   (two columns) + a `useVaultSnapshot(vaultRoot, isActive)` hook mirroring
   `useCronJobs`. Capture button → `vault.capture`; rollup row → open artifact;
   New-rollup → seed a Claude session.
5. **Verify** — `/smoke-walk` (UI surface): tab appears/retargets with the active
   vault, inbox lists + capture works, rollups list + freshness chips + open +
   new-rollup session. Then propose a cut.

## C. Architecture seams

- **Home pattern** — `renderer/components/Home/homeTab.ts` (synthesized,
  never-persisted, pinned slot-0) is the template; the Vault tab is its sibling
  in `renderer/components/WorkingPane.tsx` (`renderFileTab` dispatch).
- **Vault resolution** — `findVaultRootAndMode()` already walks up to the nearest
  marker (`.obsidian/` or `okf_version` `index.md`); reuse it on the active tab's
  path. No new app-level selected-vault state is introduced (D3).
- **Vault IPC** — existing `window.electron.vault.*` bridge (preload →
  `ipcMain.handle` → `core/vault`); add the two read verbs alongside `capture` /
  `search` / `stub` / `schema`.
- **Rollup data** — `duo rollup list` is the single data contract; the view never
  scans the filesystem itself, so a future discovery upgrade (typed notes) is
  invisible to the renderer.

## D. Test coverage (planned)

- `core/vault` unit: `listRollups` over a fixture vault — fresh vs stale (hash
  mismatch), md+html dedupe by stem, empty `rollups/` → `[]`.
- `listInbox` — folder + `captured:` parsing, stale threshold boundary.
- Renderer: vault tab appears when active file is in a vault, retargets on vault
  change, sticky-last behavior (D3), empty state.

## E. Open follow-ups (not in the first slice)

- "Process inbox" button → Claude (D5 fast-follow).
- Typed-note rollups (`type: rollup`) as the durable-handle upgrade (supersedes
  the scan while keeping the `duo rollup list` contract).
- Default-vault pin option, if active-file-follow proves jarring in the walk (D3).
- Inline rollup freshness "re-render" affordance (calls `duo rollup render`).
