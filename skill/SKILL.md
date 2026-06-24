---
name: duo
description: Work with whatever is open in Duo — the browser pane, the markdown editor and the user's selection, the file navigator, the HTML canvas — and the user's work-notes vault (Duo's "graphbook" knowledge surface) — by driving the `duo` CLI. Use when the user references Duo's surfaces, asks to read or transform what's open or selected, open a local file, drive Google Docs / Sheets / Figma / Notion live, build an interactive page or playground, OR work with their knowledge vault / notes — capturing notes, filing or linking by type, querying the link graph (backlinks / orphans), or building rollup views (a saved query over note frontmatter — e.g. "roll up all my open tasks", "list every note of type X", "what links here").
---

# duo — driving Duo's live surfaces from a terminal

This skill teaches you to use the `duo` CLI to read and drive the Duo
desktop app's surfaces from inside a terminal tab: the **browser pane**
(the live authenticated web the user is looking at), the **markdown
editor** (their live buffer and selection), the **file navigator**, and
the **HTML canvas**. When the user says "summarize the doc open in my
browser", "shorten the selected paragraph", "add a bullet to the risks
section", "open this PRD", "show me a quick prototype" — reach for `duo`.
It is the only tool that touches those live surfaces.

It also drives the user's **work-notes vault** — a folder of markdown +
frontmatter notes that Duo treats as a typed knowledge graph (the product
name is **"graphbook"**; the internal/CLI name is **"vault"**). When the
user says "capture a note", "file this under type X", "what links to this
note", or **"roll up all my open tasks"** — that's the vault, driven by the
`duo vault` / `graph` / `base` verbs. See [Working with the vault
(graphbook)](#working-with-the-vault-graphbook) below.

This file is a **router**: the short, always-read hub. The full verb
inventory and the deep workflow patterns live one level deep under
[Going deeper](#going-deeper) — load the specific file you need.

## Contents

- [Safety — never circumvent the user's controls](#safety--never-circumvent-the-users-controls)
- [CRITICAL — edit open files THROUGH duo, never around it](#critical--edit-open-files-through-duo-never-around-it)
- [Prefer delegating to the duo subagent](#prefer-delegating-to-the-duo-subagent)
- [Am I in Duo?](#am-i-in-duo)
- [When NOT to use duo](#when-not-to-use-duo)
- [Web routing — Duo by default; configured exceptions go external](#web-routing--duo-by-default-configured-exceptions-go-external)
- [Most-used verbs](#most-used-verbs)
- [open vs edit — the verb cheat sheet](#open-vs-edit--the-verb-cheat-sheet)
- [Always --reveal after you CREATE something](#always---reveal-after-you-create-something)
- [Working with the vault (graphbook)](#working-with-the-vault-graphbook)
- [Going deeper](#going-deeper)
- [Version](#version)

## Safety — never circumvent the user's controls

Duo may run on a managed or corporate Mac. Never enable `duo browser-mode unfiltered`, `dangerouslyDisableSandbox`, or any host / IT / sandbox control to work around a block on the user's behalf — surface the block to the user and stop. Never send the user's files, credentials, or page contents to an external destination. When a `duo` call is blocked or hangs, run `duo doctor` to diagnose and report the cause; do not bypass it.

## CRITICAL — edit open files THROUGH duo, never around it

Two hard rules. Read them before any `Edit`/`Write` — they protect the
user's live work from silent clobbering.

> **CRITICAL — never `Write`/`Edit` a markdown file the user has open in
> Duo's rich editor.** Mutate it through `duo` instead: `duo doc edit
> --find/--replace` for a surgical change, `duo doc write
> --replace-selection` for a piece, `duo doc write --replace-all` for the
> whole body. A direct filesystem write bypasses the editor's live state,
> so the user keeps seeing the OLD content while disk has moved on — and
> the editor's autosave can silently clobber your write the moment the
> user types. **Run `duo status` first** — it lists every open file tab
> with its `path` / `kind` / `dirty` flag. (Do NOT use `duo nav state` for
> this — that's the file-TREE snapshot and has no open-tab field.)

> **CRITICAL — same rule for `.html` files open in Duo's canvas.** Mutate
> the live canvas through the `duo html` verbs (`set` replaces innerHTML,
> `replace` replaces outerHTML; plus `append` / `remove` / `attr` against
> `data-duo-id` anchors). A filesystem `Write`/`Edit` against an open
> canvas has the same silent-overwrite hazard, and skips the
> highlighted-edit visual that shows the user what you changed. If you're
> regenerating an entire HTML document and the verbs are awkward, close
> the tab first (`duo status` to find it, then `duo close <n>`), `Write`
> the file, then `duo edit <path>` to reopen in canvas mode.

> **And the same for `.json` / `.yaml`.** Use `duo json set <file>
> <dotpath> <value>` or `duo json merge <file> <patch.json>` for a file
> that might be open in the JSON/YAML viewer-editor — not `Edit`/`Write`.

## Prefer delegating to the duo subagent

Duo workflows fan out into several CLI round-trips (url, title, wait, ax,
verify; or nav state, edit, doc read, doc write, verify). Running them
inline bloats this conversation with CLI noise the user doesn't need, and
burns Sonnet/Opus turns on orchestration a cheaper model can do. Unless
the request is a genuine one-liner ("what URL is open?", "what's
selected?"), **delegate to the `duo` subagent** with a high-level goal and
the content — let it execute and return only the outcome.

The subagent (`~/.claude/agents/duo.md`) covers the full `duo` CLI
surface: browser, editor, file navigator, selection, theme. Your job is to
draft *what* to do (the rewrite text, the URL to extract from, the files
to scan); the agent applies it. Use this hub's direct calls when the agent
isn't available or you're doing a single simple call.

**Only delegate if you're inside a Duo terminal.** Check first:

```bash
[ -n "$DUO_SESSION" ] && echo in_duo
```

Without `DUO_SESSION`, the agent refuses cleanly anyway — checking just
saves a round-trip — and you fall back to `Read` / `Bash` / `WebFetch`.

## Am I in Duo?

Every PTY Duo spawns sets four environment variables, so you can tell
without heuristics whether you're inside a Duo terminal:

- `DUO_SESSION=1` — presence is the signal.
- `DUO_SOCKET=<path>` — the live socket the `duo` CLI talks to.
- `DUO_VERSION=<x.y.z>` — the Duo app version.
- `TERM_PROGRAM=Duo` — alongside the usual terminal values.

Quick check: `[ -n "$DUO_SESSION" ] && echo "in Duo" || echo "not in Duo"`.
If `DUO_SESSION` is unset you're in a plain shell — `duo` commands fail
with `Cannot connect: Duo app is not running`; ask the user to launch Duo
or fall back to non-`duo` tools.

If a `duo` call hangs or fails with `connect EPERM` / `ECONNREFUSED` /
`Timeout waiting for response`, **run `duo doctor` first** — don't retry
blindly. The usual cause is Claude Code's sandbox blocking Unix sockets;
see [references/sandbox-troubleshooting.md](references/sandbox-troubleshooting.md).
If `duo: command not found` despite `DUO_SESSION`/`DUO_SOCKET` being set,
the binary is installed but off `$PATH` — invoke it by full path
(`~/.claude/duo/bin/duo …`); see
[references/install-troubleshooting.md](references/install-troubleshooting.md).

## When NOT to use duo

- Public web page with no auth — use `WebFetch`.
- Local files on disk you only need to read — use `Read`.
- Terminal or shell state — not `duo`'s job.
- Content that's already in your context.

## Web routing — Duo by default; configured exceptions go external

Every web URL goes through Duo (`duo open` for a new tab, `duo navigate`
for the active tab) **unless** its hostname is on a user-curated exception
list at `~/.claude/duo/external-domains.json`. Hostnames on that list route
to the macOS default browser via `duo external <url>`. The list ships
empty; the user populates it with sites that don't render well in the
embedded browser (Claude.ai, ChatGPT, banking, sites that block Electron
UAs). Empty / missing / malformed file = everything goes through Duo (the
safe default). The `duo` subagent owns the routing decision — you rarely
read this file directly.

## Most-used verbs

The everyday dozen. For everything else — the browser-pane verbs, the
canvas verbs, track-changes, workspaces, projects, sessions, the **Home**
re-entry surface (`duo home` / `duo session open` / `duo term tab`), the async
**Catch-Up** board (`duo home mode catchup` · `duo home catchup`) — see the
full inventory in [references/cli-reference.md](references/cli-reference.md).

> **Catch-Up narration (ENH-231).** Duo's Catch-Up Home shows the user a card
> per recent session — goal, "You asked", todos, files, and a one-line
> narrative. The narrative is **yours to write**: at natural stopping points
> (a turn that finishes a unit of work, hits a decision, or pauses for the
> user) call `duo session note <tab> "<what just happened>"` and
> `duo session next <tab> "<the single most useful next action>"`. They're
> keyed by session and survive the tab closing, so a walk-away review reads
> your words instead of the raw last message. `<tab>` is `$DUO_TAB`.

| Verb | What it does |
|---|---|
| `duo open <path-or-url> [--reveal]` | Open a file or URL. HTML → browser pane (interactive); `.md` → editor; image/pdf → viewer; URL → browser tab. A **GitHub file URL** (`…/blob/<ref>/<path>`, `/raw/`, `raw.githubusercontent.com`) → if that repo is already cloned in a navigator project (D6) opens YOUR file from the clone (`--checkout` forces a managed checkout); else pulled into an opaque managed checkout under `~/.claude/duo/checkouts/` and opened like a local file ("open just this doc"); a bare repo URL still → browser tab. The default for "show me X". Successful opens land in Open Recent (`duo recent`). |
| `duo recent [--json]` | List the last ~10 Open-bar targets (local paths + GitHub URLs) — the CLI twin of File ▸ Open Recent + the empty ⌘O bar. Reopen by re-passing a target to `duo open`. |
| `duo edit <path> [--reveal]` | Open a file to modify its source. HTML → canvas mode (editable, scripts blocked); `.md` → rich editor. The default for "let's change this". |
| `duo view <path>` | Open a local file in the working pane (legacy — prefer `open`/`edit`). `.md`→editor, image/pdf→viewer, JSON/YAML→tree view. |
| `duo status` | Read-only JSON of every open working-pane tab (`kind`, `path`, `dirty`, `active`, …). The reliable "is this file open?" probe — run it BEFORE any `Edit`/`Write`. |
| `duo selection [--pane auto\|editor\|browser\|canvas]` | The active surface's selection. Use when the user says "this", "the selected paragraph", "this section", "here". |
| `duo doc read [path]` | Print the active editor's live buffer (frontmatter + body, including unsaved edits). |
| `duo doc write --replace-selection \| --replace-all` | Swap the user's selection (`--replace-selection`, reads stdin or `--text`) or replace the whole body (`--replace-all`, markdown preserved). |
| `duo doc edit <file> --find "X" --replace "Y" [--all]` | Surgical plain-markdown find/replace. Reconciles into the live buffer when open, edits disk when closed. Use this — not `Edit` — for markdown that might be open. |
| `duo reveal <path>` | Move the file navigator to a path (a chip tells the user why the tree jumped). This is the navigator-move verb — NOT `duo navigate`. |
| `duo ls [path]` | List a directory's contents (defaults to the navigator's current folder). |
| `duo text [--selector <css>]` | Visible text of the browser pane (DOM `innerText`). Simplest read for classic DOM pages. |
| `duo ax [--selector <css>] [--format md\|json]` | Accessibility tree — the read for `<canvas>` apps (Google Docs/Sheets/Slides, Figma, newer Notion) where `duo text` returns nothing. |

**Suggesting edits / track-changes on markdown** → use `duo doc insert` / `delete` / `substitute` / `highlight` (they write CriticMarkup that renders as accept/reject suggestions in the editor's rail). **Never write literal `<ins>` / `<del>` / `<s>` HTML — Duo renders raw tags as plain prose, not tracked changes.** Full lifecycle: [references/comments.md](references/comments.md).

## open vs edit — the verb cheat sheet

Modality is **verb-driven**. The same HTML file flips surface by verb:

- `duo open <path>` — show the user the rendered/running thing. HTML →
  **browser pane** (interactive, scripts run, buttons fire). `.md` →
  editor. Image → viewer. Web URL → browser tab. The default for "make me
  X and show me."
- `duo edit <path>` — modify the source. HTML → **canvas mode**
  (source-editable, scripts blocked). `.md` → the rich editor (same as
  `open` for `.md` — markdown has one editor surface). The default when
  you or the user plans to mutate the file.

Rare overrides: `duo open --canvas <path>` (inspect a playground's source
without firing scripts) · `duo edit --browser <path>` (the symmetric
override). The legacy `<meta name="duo-open-in">` declaration is no longer
consulted (harmless if present).

## Always --reveal after you CREATE something

When you write a file, doc, or playground **for the user**, pass
`--reveal` so Duo auto-expands the working pane (if collapsed) and focuses
it. Without it, the file can open into a hidden / collapsed pane and the
user has to hunt for it.

```bash
duo edit --reveal /tmp/summary.md       # created a markdown doc
duo open --reveal /tmp/calculator.html  # created an interactive playground
duo edit --reveal /tmp/notes.html       # scaffolded HTML to read-and-edit in canvas
```

Idempotent (a no-op for the layout when the pane is already visible at a
reasonable ratio) — cheap to over-use, expensive to forget. **Default for
any "make me X" request:** scaffold the file, then open with `--reveal`.
The user shouldn't have to ask "where did it go?"

## Working with the vault (graphbook)

The user's **vault** is a folder of markdown notes with YAML frontmatter,
treated as a typed link graph. Product name: **graphbook**. CLI/internal
name: **vault**. What you can do from the CLI (all verbs read the
filesystem directly — no running app needed):

| Want to… | Verb |
|---|---|
| see the live schema (types, entities, props, enums) | `duo vault schema` |
| drop an inbox note | `duo vault capture [--template t] [--text …]` |
| create a typed entity | `duo vault stub <type> <name>` |
| full-text search | `duo vault search <query>` |
| find what links to a note / dangling notes | `duo graph backlinks <note>` · `duo graph orphans` |
| **build a rollup view** (a saved query over frontmatter) | `duo base lint` + `duo base render` (Obsidian mode) · `duo vault publish` (OKF mode) |
| move/rename a note without breaking links | `duo vault mv <from> <to>` |

**Vocabulary — read this first (it's the usual stumbling block):**
- The typing key is **`type:`** in frontmatter, **not `class:`**. "Notes of
  class task" means notes with `type: task`. A rollup of tasks filters
  `type == "task"`.
- A **rollup** is a saved view computed from frontmatter. There are **two
  mechanisms, chosen by the vault's format** (run `duo vault list` /
  `duo vault schema` to see which you're in):
  - **Obsidian mode** → live **`.base`** files (Obsidian Bases YAML),
    rendered with `duo base render`.
  - **OKF mode** → **static listings** (`index.md` / `log.md`)
    (re)generated with `duo vault publish`. OKF vaults have **no `.base`
    files** — don't author one there.

### Authoring a rollup — the loop

A **rollup** is a view computed from frontmatter. The loop:

1. **Understand the ask** in prose ("open tasks for this initiative, grouped
   by owner, with a due chip").
2. **Get the corpus**: `duo vault schema`. It tells you the real type names,
   entity names, and observed enum values — write the view against *those*,
   not guesses. (This is also where you confirm the typing key is `type:`.)
3. **In Obsidian mode — write the `.base`** (Obsidian Bases YAML):
   - vault-wide → a file in `bases/`.
   - per-entity → an embedded ` ```base ` block in the **type template**
     with a `… == this` filter (e.g. `initiative == this`), so **every**
     entity of that type inherits the rollup with zero per-note setup — the
     headline pattern.
4. **Lint until clean**: `duo base lint <file>` (or `--all`) — flags bad
   types, unresolved `[[entities]]`, off-enum values, unknown functions,
   each with a "did you mean". Advisory, never blocks; fix, then render.
5. **Render**: `duo base render <file|note> --open` evaluates it over live
   frontmatter and opens the result as a tab.

**In OKF mode there are no `.base` files** — instead `duo vault publish`
(re)generates the static `index.md` (a section per type) + `log.md` from the
corpus. Same intent ("show me all the X"), different mechanism.

The render engine is a **locked subset** of Obsidian Bases (filters,
`if()`, link `== this`, date math, `groupBy`, summaries, child→parent
backlink rollups); stay inside what `duo base lint` accepts. Presentation
(table/cards/list) is Duo-owned — shape a cell only via `html()` / `icon()`
formulas, never hand-authored HTML. Full detail, the OKF/Obsidian format
differences, filing rules, and the processing pass are in
[references/vault.md](references/vault.md).

## Going deeper

Each pointer loads a complete file — open the one that matches your task.

**Full CLI**
- [references/cli-reference.md](references/cli-reference.md) — every `duo`
  verb, grouped by surface, with flags and output shapes.

**Workflow patterns**
- [references/patterns-browser.md](references/patterns-browser.md) — read a
  page, fill and submit a form, diagnose a failing interaction
  (`console` / `errors` / `network`), iterate on an artifact.
- [references/patterns-editor.md](references/patterns-editor.md) — transform
  the user's selection, rewrite a whole doc, open a file to read/edit.
- [references/patterns-canvas.md](references/patterns-canvas.md) — working
  with the HTML canvas as a surface.
- [references/comments.md](references/comments.md) — leave comments and
  track-changes on a markdown file with attribution (anchor, reply,
  accept/reject, on-disk shape).
- [references/google-docs.md](references/google-docs.md) — read/edit a
  Google Doc (the `export?format=md` read; the `<canvas>` traps; the
  keyboard-input limits).
- [references/debugging.md](references/debugging.md) — the visibility
  cluster and error-recovery playbook for failing selectors / silent
  clicks.

**Authoring pages & playgrounds**
- [make-page.md](make-page.md) — author a **page** (HTML in canvas mode —
  source-editable, scripts blocked).
- [make-playground.md](make-playground.md) — author an interactive
  **playground** (HTML in browser mode — scripts run, buttons fire);
  includes the REQUIRED "Send to Claude" + "Copy output" defaults.
- [playground-interaction.md](playground-interaction.md) — drive and read
  an existing playground (the `duo events --follow` subscription pattern,
  the "button isn't firing" playbook).
- [lesson-runtime.md](lesson-runtime.md) — the lesson-pack runtime.
- [lesson-flythrough.md](lesson-flythrough.md) — walking a lesson end to
  end.

**Working in a vault (ENH-208 · ENH-216)**
- [references/vault.md](references/vault.md) — work-notes vault conventions:
  the `duo vault` / `graph` / `base` verbs, capture by narration, entity
  stubbing, the D19 filing rules, the rollup authoring loop (corpus → `.base`
  → lint → render), and the processing pass. **Two at-rest formats** (one
  graph, two serializers): **OKF** (standard markdown relative links
  `[Display](./<note>.md)`, the New Vault dialog default) and **Obsidian**
  (wikilinks `[[Display]]`, the legacy default). `duo vault init <path>
  --format=okf|obsidian` scaffolds either (`--format` required on the CLI;
  add `--no-default` so a throwaway scaffold doesn't hijack the active vault).
  In OKF mode a move changes link paths, so use `duo vault mv` (clean move +
  inbound-link rewrite) or `duo vault relink` (repairs out-of-band moves
  slug-first, with `id:` as a same-slug tiebreak); `duo vault publish`
  (re)generates the static
  `index.md` + `log.md` listings; `duo vault promote` splits a section into
  its own entity, leaving a markdown link. The end-user walkthrough with
  diagrams ships with this skill — open it with `duo open
  ~/.claude/skills/duo/references/vault-guide.html`.
- [references/rollup.md](references/rollup.md) — the `duo rollup` product verb
  (ENH-229): render a rollup as **Markdown OR HTML** (one variant per call),
  with **entity links** on every row, and a **change summary** on regenerate
  (`duo rollup diff` → narrative+notables → `duo rollup render --summary`).
  Reach for this when the user says "roll up my <type>" / "and tell me what
  changed." Includes the sample prompt + the refresh loop.

**Install, environment & house style**
- [references/install-troubleshooting.md](references/install-troubleshooting.md)
  — `duo: command not found`, install paths, the boot-time self-heal.
- [references/sandbox-troubleshooting.md](references/sandbox-troubleshooting.md)
  — the Claude Code sandbox blocking Unix sockets, and the two fixes.
- [references/enterprise-deployments.md](references/enterprise-deployments.md)
  — managed / restrictive Claude Code installs (hooks disabled, locked
  permissions).
- [references/vocabulary.md](references/vocabulary.md) — canonical
  user-facing vocabulary (page / playground / lesson / canvas / start-tab).
- [references/atelier-css.md](references/atelier-css.md) — the Atelier CSS
  kernel + class library for any HTML you build.

## Version

This skill ships with the Duo app — there is no separate version to pin.
The running app's version is in the `DUO_VERSION` env var (or run
`duo --version`). If a verb in [references/cli-reference.md](references/cli-reference.md)
isn't recognized, the app is older than the skill; ask the user to update
Duo.
