# Working in a vault (ENH-208 · ENH-216)

> A **vault** is a folder of work-notes: plain markdown + YAML frontmatter +
> folders + a link graph. Duo adds capture, search, and an **agent layer**
> (you) on top. This file is how you operate in one. The end-user walkthrough
> with diagrams is the **Vault Guide** (`docs/guide/vault-guide.html` —
> `duo open` it).

**Two at-rest formats — ONE graph model, TWO serializers (ENH-216).** The
same notes/links/types form one graph; how a link is written to disk depends
on the vault's format:

| Format | Marker (source of truth) | Links at rest | Default for |
|---|---|---|---|
| **OKF** | root `index.md` with `okf_version:` frontmatter | standard markdown relative links `[Display](./<note>.md)` | the New Vault **dialog** (D2) |
| **Obsidian** | a `.obsidian/` directory | `[[wikilinks]]` | the legacy / existing behavior |

If both markers are present, **`okf_version` wins** (D4). The wikilink GESTURE
is input-only everywhere — type `[[Name]]` to pick or stub a target; on resolve
an OKF vault rewrites it to a markdown relative link, an Obsidian vault keeps
the wikilink. **No double-square-bracket link ever persists in OKF mode** (D3).

The three layers, and who owns each:

| Layer | What | Owner |
|---|---|---|
| **At rest** | markdown + YAML frontmatter + folders + a link graph (rel-md links in OKF, wikilinks in Obsidian) + `.base` rollups (Obsidian) / static listings (OKF) | format conventions — zero invention |
| **Capture** | autocomplete, ⇧⌘N quick-capture, ⌘⇧F search palette, the type-picker, `@today` tokens (shipped Phase-2 UI) | Duo UI |
| **Agent** | filing, linking, fixing frontmatter, authoring rollups, processing | **you**, via the `duo vault` / `graph` / `base` verbs + this skill |

**The cardinal rule: write what the vault's format expects — and nothing
invented.** Typed fields in YAML frontmatter, folders, no Dataview inline
fields, no invented syntax, regardless of format. Then, per format:

- **Obsidian mode (D1):** `[[wikilinks]]` in prose. If it wouldn't open
  correctly in Obsidian proper, don't write it. `.base` rollups live in the
  vault.
- **OKF mode (D3):** standard markdown relative links `[Display](./<note>.md)` in
  prose — **never** a persisted `[[wikilink]]`. Every note carries `type:` and
  a stable `id:` (D10); listings are static, generated `index.md` + `log.md`
  files (D8), not live `.base` queries.

## The verbs (all read the filesystem directly — no running app needed)

| Verb | Use it to |
|---|---|
| `duo vault init <path> --format=okf\|obsidian [--name "…"]` | scaffold a new vault. **`--format` is REQUIRED** (deliberate CLI↔dialog asymmetry, D2 — the New Vault dialog defaults to OKF). `okf` = rel-md links + `okf_version` `index.md` marker + static listings; `obsidian` = wikilinks + `.obsidian/` marker + `processing.base` + README. The fresh vault becomes the default |
| `duo vault list` | find vaults under the cwd (OKF `okf_version` index.md OR `.obsidian/`) |
| `duo vault schema [--vault p]` | get the **corpus** — types, entities, aliases, props-per-type, observed enums, templates. **Run this before authoring a base or filing a note** — it's the resolution table |
| `duo vault capture [--template t] [--text …] [--title …]` | drop an atomic inbox note (the ⇧⌘N twin — bare capture matches the chord exactly) |
| `duo vault stub <type> <name> [--open]` | create a typed entity stub from its template, D19-filed; idempotent (the type-picker's twin — same code path) |
| `duo vault default [<path>\|--clear]` | read/set the default vault (the Settings → Default Vault twin — one pref file, writes reflect live) |
| `duo vault search <query>` | full-text search (the ⌘⇧F palette's twin) |
| `duo vault mv <from> <to>` | **move a note + rewrite inbound links** (the D5 clean path — see *Moving a note* below). Prefer over `duo file rename` for OKF vault notes |
| `duo vault relink [--dry-run]` | **repair links broken by an out-of-band move** (Finder/git) — re-resolve by stable `id:` → slug, rewrite the unambiguous, report ambiguous + broken |
| `duo vault publish [--index-only\|--log-only] [--dir] [--open]` | (re)generate the OKF static listings (`index.md` + `log.md`) from the corpus (D8; OKF-mode only) |
| `duo vault promote <note> --heading "<h>" --type <t>` | split a `## section` into its own typed entity, leaving a link behind (D9 — see *Running docs & promote*) |
| `duo graph backlinks <note>` | who links to a note (wikilinks basename-resolved AND markdown rel links; scans frontmatter + body) |
| `duo graph orphans` | notes with no links in or out (a tidy-up list) |
| `duo base lint <file\|--all>` | validate a `.base` against the corpus before rendering (Obsidian-mode rollups) |
| `duo base render <file\|note> [--out p] [--open]` | render a rollup to a stamped HTML artifact |

Vault resolution order: explicit `--vault <path>` → the enclosing vault (walk
up from the cwd to the nearest marker — an OKF `okf_version` index.md or an
`.obsidian/`) → the default vault (`duo vault default`) → error. **The corpus is
computed live every time — never cache it to disk** (no-sidecar rule).

## Moving a note (D5) — links don't move themselves in OKF mode

In **Obsidian mode**, wikilinks resolve by basename, so a moved note's inbound
links survive a move untouched. In **OKF mode**, links are relative paths — a
move changes the path every inbound `[Display](./<note>.md)` points at — so a move
needs link repair. Two paths:

- **`duo vault mv <from> <to>`** — the **clean path**. Duo moves the file
  itself, so it knows every inbound markdown link: it recomputes each one for
  the new location and rewrites it byte-anchored, and re-bases the moved note's
  OWN outbound links from their new home. Throws on a dest collision (never
  clobbers). Use this instead of `duo file rename` / shell `mv` for vault notes.
- **`duo vault relink [--dry-run]`** — the **out-of-band repair**. Someone moved
  or renamed files around Duo (Finder, git, a bulk script). Relink finds every
  dangling markdown link and re-resolves each target by its stable frontmatter
  `id:` first (the primary key, minted on every OKF note at create time, D10),
  then by slug/basename fallback. It rewrites the ones that resolve
  unambiguously and **reports** ambiguous (>1 candidate) and broken (0) — never
  guesses (warn-don't-block). `--dry-run` reports without writing.
- **Auto-relink on vault open** — Duo runs `relink` automatically when a vault
  opens, so out-of-band moves self-heal as far as the keys allow; the explicit
  verb is for headless/CI runs and for inspecting the ambiguous/broken report.

## Capture by narration

The owner narrates; you write the note. "note from the pricing sync: Alice wants
the fee model by Friday" →

1. Run `duo vault schema` to see existing entities (is there an `Alice Park`? a
   `Pricing` theme? a `Pricing Revamp` initiative?).
2. Write a templated note — either `duo vault capture --template meeting --text
   "…"` for an inbox note, or directly into the right folder if you already know
   where it files.
3. **Link entities as `[[wikilinks]]`** in the prose and in typed frontmatter
   (`attendees: ["[[Alice Park]]"]`). Create stubs for any new entity (below).
4. Leave anything you're unsure about for the processing pass — capture is fast
   and lossy by design; processing is where it gets filed and fixed.

The human's no-agent path is the **⇧⌘N quick-capture chord** — exact bare
`duo vault capture` parity: an untyped inbox note in the default vault (else
the active file's vault), opened in the editor focused. Expect those notes in
the same processing work-list as yours.

## Creating an entity stub

When prose mentions a person/initiative/theme that doesn't exist yet:

1. `duo vault schema` → confirm it's genuinely new (check `aliases` too — "Alice"
   may already resolve to `Alice Park`).
2. `duo vault stub <type> <name>` — creates it from the matching template, filed
   by the D19 rules; idempotent (never clobbers an existing note). Keep it a
   **stub** — type + a few known fields; processing enriches it later.
3. Link it from wherever it was mentioned.

(The human's in-editor gesture runs the same code path: `[[New Name]]` in the
`[[` suggester offers a **New:** row → picking it completes the link and pops
the type-picker — template types + "+ new type…" — and the stub files silently;
the caret never leaves the note, Esc creates nothing.)

## Filing rules (D19) — read the templates

Folder layout is **ergonomics only** — every query is frontmatter-driven, so a
note never loses its edges when it moves. Each `templates/<type>.md` declares its
filing rule in meta keys (exposed by `duo vault schema` under `templates`):

- **Parentless types** (person, theme) — `folder:` is their registry folder
  (`people/`, `themes/`). File there.
- **Parented types** (milestone, meeting) — `filingParent:` names the frontmatter
  attribute that is the filing parent (milestone → `initiative`). The note files
  under that parent's folder. `filingLoose: true` → loose in the parent's folder;
  `false` → in a per-type subfolder (e.g. `notes/`).
- **Folder-note types** (initiative) — `folderNote: true`; the entity owns a
  folder named after it. **Only folder-note types may be filing parents.**
- **No parent yet?** A parented note with no resolvable parent files in a time
  bucket `notes/YYYY/MM/` — the residue processing assigns a parent to later.

All non-filing relationships stay links — filing loses no edges.

## Authoring a rollup (P7) — the loop

A **rollup** is a `.base` view computed from frontmatter. The loop:

1. **Understand the ask** in prose ("open milestones for this initiative, grouped
   by owner, with a due chip").
2. **Get the corpus**: `duo vault schema`. It tells you the real type names,
   entity names, and observed enum values — write the base against *those*, not
   guesses.
3. **Write the `.base`** (Obsidian Bases YAML):
   - vault-wide → a file in `bases/`.
   - per-entity → an embedded ` ```base ` block in the **type template** with a
     `… == this` filter (e.g. `initiative == this`), so **every** entity of that
     type inherits the rollup with zero per-note setup. This is the headline
     pattern — see `templates/initiative.md`.
4. **Lint until clean**: `duo base lint <file>` (or `--all`). It flags bad types,
   unresolved `[[entities]]`, off-enum values, unknown functions/view-types, each
   with a "did you mean". Lint is **advisory — it never blocks** (D15); fix what
   it finds, then render.
5. **Render**: `duo base render <file|note> --open` evaluates it over live
   frontmatter and opens the result as a tab.

**The engine is a locked subset** of Obsidian Bases — filters (`and`/`or`/`not`,
`file.inFolder`/`hasProperty`/`ext`/`name`), `if()`, link `== this`, date math,
`html()`/`icon()` cell styling, `groupBy`, summaries (`Earliest`/`Filled`/…), and
child→parent backlink rollups (which our renderer supports even where Obsidian's
is fragile). Stay inside what `duo base lint` accepts — anything else renders as
a ⚠ cell. **Presentation (table/cards/list) is Duo-owned** (D16); shape a cell
only through `html()` / `icon()` formulas, never by hand-authoring HTML.

Renders are **stamped build artifacts** (D13): generated-at + source-hash +
as-of date. Default writes to the vault's `out/`; re-render to refresh — the
source hash detects staleness. There is no live watcher in v1.

**OKF mode uses static listings, not live `.base` rollups (D8).** An OKF vault
has no `.base` files; instead `duo vault publish` (re)generates plain-markdown
**`index.md`** (a heading per type/group, then `* [Title](rel) - description`
bullets — OKF section-6) and **`log.md`** (`## YYYY-MM-DD` groups newest-first
from file mtimes — OKF section-7) from the corpus. The **root `index.md` IS the
OKF mode marker** — its `okf_version`/`title`/`type: index` frontmatter is
preserved byte-identically; publish only regenerates the body after the
`<!-- duo:listing -->` fence, and stamps it with the source hash like a render
artifact. `--index-only` / `--log-only` narrow the write; `--dir` also writes a
per-folder `index.md`; `--open` surfaces the root `index.md` as a tab. Publish
is OKF-mode-gated (it throws in an Obsidian vault — Obsidian stays
byte-identical).

## Running docs & promote (P6)

Keep low-ceremony series as one running doc — e.g.
`initiatives/Q3 Launch/Meetings.md` with one `##` section per meeting, addressed
as `[[Meetings#2026-06-09]]` (Obsidian) / `[Meetings](./<series>.md)` (OKF). No
file-per-thing churn. When a section earns its own properties or base
visibility, **promote** it with `duo vault promote <note> --heading "<h>"
--type <t>` (D9): it splits that `##` section into an entity file from the
matching template, removes the section from the source note, and leaves a
**LINK** where it was — a markdown relative link in OKF mode, a `[[wikilink]]`
in Obsidian. **It is never an `![[embed]]`-transclusion** (D9 — promote means
the section becomes a first-class note, not an inlined view).

## Processing (P8) — the agent pass

"Process my vault" → a single reviewable pass. **Never act silently — propose.**

1. **Build the work-list** (computed live): stale inbox notes (> 1 week — see
   `bases/processing.base`), untyped notes, notes missing required fields (vs
   their template), unresolved `[[links]]`, ⚠ render flags, `duo graph orphans`.
2. **Do the ops**, but as *suggestions*:
   - **File** inbox/contextless notes per the D19 rules (move under a resolved
     parent; `notes/YYYY/MM/` otherwise). List every move in the report for
     approval. In Obsidian mode wikilinks survive moves (basename-resolved); in
     OKF mode use **`duo vault mv`** so inbound markdown links are rewritten, or
     run **`duo vault relink`** afterward to repair any out-of-band moves.
   - **Fix frontmatter + links** with **CriticMarkup tracked suggestions in Duo's
     exact format** — `duo doc insert` / `duo doc substitute` (which emit
     `{++…++}` / `{~~…~>…~~}`). **Never write literal `<ins>`/`<del>` HTML** —
     Duo renders that as prose, and the owner can't accept/reject it.
   - **Promote** sections (P6) when they need properties.
   - **Propose archiving** completed initiatives (whole subtree → `archive/YYYY/`,
     D20) — in the report, **never automatically**.
   - **Propose novel connections** ("these two notes both reference X") — always
     proposals.
3. **Write a dated report note** in the vault linking every touched file + each
   proposed move. The owner accepts/rejects suggestions in the editor via `duo
   doc accept` / `duo doc reject`.

**Edit at scale through the surgical paths only** — `plainEdit` / CriticMarkup
(`duo doc insert`/`substitute`/`highlight`), never `duo doc edit` whole-document
rewrites (BUG-199 churn). After any batch, sanity-check `git diff --numstat` is
insertion-sized.

## Designed asymmetries (CLI-parity callouts)

- Obsidian-side `[[` creations land untyped in Obsidian's default folder;
  processing catches and types them. Expected — don't fight it.
- Agents write dates directly (no verb); the `@today` smart tokens in the `@`
  suggester (shipped) are the human's equivalent — they insert plain text, so
  nothing downstream can tell who wrote the date.
- The capture UX is shipped human UI with exact CLI twins: Settings → Default
  Vault ↔ `duo vault default` · ⇧⌘N quick-capture ↔ bare `duo vault capture` ·
  the ⌘⇧F palette ↔ `duo vault search` · the type-picker ↔ `duo vault stub`.
  Agents pass `--vault`, run from inside the vault, or rely on the default.
- The type-picker's "+ new type…" writes `templates/<type>.md` directly — agents
  create a type by writing the template file; there is no verb.
- **`duo vault init --format` is REQUIRED on the CLI (D2)** even though the New
  Vault dialog defaults to OKF. A deliberate asymmetry: a human picking from a
  dialog has a sensible default; an agent scripting a vault should state the
  at-rest format explicitly rather than inherit a silent default.
