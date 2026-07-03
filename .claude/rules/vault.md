---
paths:
  - "core/vault/**"
  - "core/markdown/vaultLinks.ts"
  - "skill/references/vault.md"
---

# Vault / graphbook

Loaded when touching the vault core or its agent reference. The vault
(product name **"graphbook"**, internal/CLI name **"vault"**) is Duo's
typed work-notes knowledge graph. The *user-facing* model + agent
operating manual is [`skill/references/vault.md`](../../skill/references/vault.md);
the PRD is `docs/prd/enh-208-vault.md`; the verb inventory is
`docs/CLI-COVERAGE.md` § Vault. This file is the mechanical contract.

## One graph model, two serializers (ENH-216)

The same notes/links/types form ONE graph; how a link is written to disk
depends on the vault's format. The format marker is the source of truth:

| Format | Marker | Links at rest | Rollups |
|---|---|---|---|
| **OKF** | root `_index.md` (or legacy `index.md`) with `okf_version:` frontmatter | standard markdown rel links `[Display](./<note>.md)` | static `_index.md`/`index.md` + `_log.md`/`log.md` listings via `duo vault publish` (ENH-230: a `listing:` base spec in the root index's frontmatter drives the index body through the SHARED engine — same `evaluateBaseDef` + `render-markdown.ts` as the `.base` path) |
| **Obsidian** | a `.obsidian/` directory | `[[wikilinks]]` | live `.base` files via `duo base render` |

`okf_version` wins if both markers are present (D4). The `[[Name]]` GESTURE
is input-only everywhere; on resolve, OKF rewrites it to a rel-md link,
Obsidian keeps the wikilink. **No `[[wikilink]]` ever persists in OKF mode.**

**Dual index/log filename convention (ENH-245).** `_index.md`/`_log.md` is the
default for any listing Duo writes fresh (sorts to the top of a folder, reads
unambiguously as generated); `index.md`/`log.md` is the legacy ENH-216/D4/D8
pair, still detected and honored for vaults that already use it. Detection
always checks both; a vault never gets a mixed pair (a legacy `index.md` root
still resolving to `log.md`, not `_log.md`, on first publish). The single
source of truth is `core/vault/okf-filenames.ts` — every other vault module
(`detect.ts`, `scaffold.ts`, `listings.ts`, `render.ts`, `cli/duo.ts`) resolves
the filename through it rather than hardcoding either string.

## Vocabulary contract — the two recurring traps

1. **The typing key is `type:`, NOT `class:`.** `core/vault/corpus.ts`
   reads `frontmatter.type` (falling back to the basename). "class:task"
   from a user means `type: task`. There is no `class:` field — never
   introduce one.
2. **"Rollup" is format-dependent — but `.base` works in BOTH modes.** In
   Obsidian mode a `.base` is a *live* view rendered by `duo base render`; in
   OKF mode the at-rest listings are `index.md`/`log.md` via `duo vault
   publish`. **OKF doesn't *auto-render* `.base` files at rest — but a `.base`
   is just a query, so you still author one and render a shareable artifact on
   demand with `duo rollup render <base> --md|--html` (verified, BOTH modes —
   the way to make a rich HTML rollup from an OKF vault).** Never tell an agent
   OKF "can't use `.base`" or "authoring one is a no-op" — that misconception
   makes agents hand-build bespoke HTML instead of `duo rollup render --html`
   (the photo'd failure). Distinguish the at-rest *listing* from the on-demand
   *artifact*.
   **The query ENGINE is shared (ENH-230):** an OKF root `index.md` may
   carry a `listing:` base spec in its frontmatter, and `writeListings`
   evaluates it via the same `evaluateBaseDef`/`renderBaseMarkdown` the `.base`
   path uses (`engineIndexBody` in `listings.ts`). One engine, two sinks
   (live artifact vs materialized markdown) — `listings.ts` calls the engine,
   never reimplements grouping. No `listing:` spec → the group-by-`type`
   default, byte-identical.

## Invariants (don't regress these)

- **The corpus IS the schema — never cache it (no-sidecar, § D9).** The
  corpus (types/entities/aliases/props/enums) is a pure live function over
  frontmatter, computed every call. Do not persist it to a sidecar file;
  read the filesystem each time.
- **Filesystem-direct, sandbox-tolerant.** The vault verbs run in-process
  in the CLI bundle (no socket / running app). Because `cli/duo` bundles a
  build-time snapshot of `core/`, a change to a verb's `core/vault/**` code
  needs `npm run build:cli` + `git add cli/duo`, or the CLI shows stale
  behavior while the live app is fixed.
- **Moves rewrite links.** In OKF mode a move changes link paths — use
  `duo vault mv` (rewrites inbound) / `duo vault relink` (repairs
  out-of-band moves), never a bare `mv` / `duo file rename` for notes.
- **`duo base lint` is advisory (D15)** — warn-and-render, never block.
- **Presentation is Duo-owned (D16)** — shape a base cell only via
  `html()` / `icon()` formulas, never hand-authored HTML.

## If you change a vault verb's signature

It's a CLI verb — honor the 4-surface sync (`.claude/rules/cli-plumbing.md`):
`cli/duo.ts`, `skill/SKILL.md` (+ `skill/references/vault.md`),
`agents/duo.md`, `docs/CLI-COVERAGE.md`. Then `npm run build:cli` +
`npm run sync:claude`. `npm run check:skill-currency` is the backstop.
