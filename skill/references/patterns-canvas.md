# Patterns — canvas & local files

How to show the user a local file, the always-`--reveal`-after-you-create
habit, the `duo open` vs `duo edit` verb cheat sheet, authoring or driving
an HTML canvas, and generating a worksheet.

## Contents

- [Show the user a local file](#show-the-user-a-local-file-open-this-prd-preview-that-image)
- [Always pass --reveal after you CREATE something](#when-youve-just-created-something-for-the-user--always-pass---reveal)
- [Verb cheat sheet — duo open vs duo edit](#verb-cheat-sheet--duo-open-vs-duo-edit)
- [Navigate the user's file browser](#navigate-the-users-file-browser-show-me-where-that-lives)
- [Discover files without opening them](#discover-files-without-opening-them)
- [Author or interact with an HTML canvas](#author-or-interact-with-an-html-canvas)
- [Generate a worksheet](#generate-a-worksheet-for-structured-user-feedback)

## Show the user a local file ("open this PRD", "preview that image")

Lead with the verb-driven openers — they pick the right surface from the
file type and the intent:

```bash
duo open ~/Documents/prd.md       # markdown → rendered editor (read)
duo open /tmp/chart.png           # image → inline preview
duo open ~/tmp/notes.pdf          # pdf → Electron's native viewer
duo edit ~/projects/foo/prd.md    # markdown → editor, intent to modify
```

- `duo open <path>` — show the user the rendered/running thing (the
  default for "show me this file").
- `duo edit <path>` — open with intent to modify the source.

The full open-vs-edit decision (HTML especially flips surface by verb) is
the [verb cheat sheet](#verb-cheat-sheet--duo-open-vs-duo-edit) below.

The tab uses the filename as its title; the path is in the tooltip. If the
file is already open in a tab, the opener activates that tab rather than
creating a duplicate. Unknown types (`.xlsx`, `.mov`, etc.) show a card
with an "Open with default app" button — don't grind; tell the user.

**JSON / YAML tabs.** Files with `.json`, `.jsonl`, `.har`,
`.webmanifest`, `.yml`, or `.yaml` extensions open in a collapsible tree
view (`@uiw/react-json-view`) with click-to-edit values. A toolbar
**Source** button flips to a CodeMirror raw-text editor with syntax
highlighting + inline parse-error markers; the **Tree** button flips back
(rejecting the switch if the source is unparseable). Single tab kind for
both formats — format is implicit from the extension. YAML round-trip is
content-only: comments + anchor names are stripped on save (mention this
when handing the user a YAML edit). Files >1 MB drop to a read-only source
view (tree render cost is prohibitive at scale). Save semantics match the
markdown editor: autosave on debounce, the normalize-trailing-whitespace
contract, and `files.write` underneath. Saving from source mode parses the
input first and refuses to write if invalid (catches the "missing closed
quote / bracket" case).

> **Legacy:** `duo view <path>` still opens any local file in the
> Viewer/Editor column (markdown → rendered preview, image → inline, pdf →
> native viewer, `.json`/`.jsonl`/`.har`/`.webmanifest`/`.yml`/`.yaml` →
> the JsonView tree above). Prefer the verb-driven `duo open` / `duo edit`
> for new work; `duo view` is kept for back-compat.

## When you've just CREATED something for the user — always pass `--reveal`

When you write a file, doc, or playground for the user (`duo edit
foo.md` after creating it, `duo open playground.html` after generating
it, `duo edit notes.html` after scaffolding HTML to mutate), pass
**`--reveal`** so Duo auto-expands the working pane (if collapsed)
and focuses the main pane. Without it, the file may open into a
hidden / collapsed canvas and the user has to hunt for it.

```bash
# Created a markdown doc → make sure the user sees it
duo edit --reveal /tmp/summary.md

# Created an interactive playground → reveal the browser pane
duo open --reveal /tmp/calculator.html

# Created an HTML page meant to be read-and-edited in canvas mode
duo edit --reveal /tmp/notes.html
```

Idempotent: if the working pane is already visible at a reasonable
ratio (`splitPct < 75`), `--reveal` is a no-op for the layout but still
focuses main. Cheap to over-use; expensive to forget.

**Default for any "make me X" request:** scaffold the file, then open
with `--reveal`. The user shouldn't have to ask "where did it go?"

For HTML playgrounds you build, also follow the **REQUIRED defaults**
in [`make-playground.md`](../make-playground.md) — every playground
includes a "Send to Claude" button + a "Copy output" button so the user
can round-trip without manual select-and-copy.

## Verb cheat sheet — duo open vs duo edit

- `duo open <path>` — show the user the rendered/running thing. HTML
  → browser pane (interactive). `.md` → markdown editor. Image → viewer.
  This is the default for "make me X and show me." Web URLs land in
  a browser tab.
- `duo edit <path>` — modify the source. HTML → canvas mode (source-
  editable, scripts blocked). `.md` → TipTap editor (same as `duo open`
  for `.md`; markdown has only one editor surface). Use when the user
  (or you) plans to mutate the file.

Rare overrides:
- `duo open --canvas <path>` — inspect a playground's HTML source
  without firing its scripts.
- `duo edit --browser <path>` — symmetric override; rarely needed.

## Navigate the user's file browser ("show me where that lives")

If you've just modified a file and want the user to see it in their
navigator, use `duo reveal`:

```bash
duo reveal ~/Documents/prd.md
```

The navigator jumps to that folder and a chip appears so the user knows
the tree moved because of you. Pair with `duo open` when you want to both
open a file and surface its location.

## Discover files without opening them

```bash
duo ls                          # contents of the user's current nav folder
duo ls ~/Documents              # specific path
duo nav state                   # { cwd, selected, expanded, pinned }
```

Good for deciding what to do next without guessing; cheaper than asking
the user.

## Author or interact with an HTML canvas

The canvas surface splits on a single question — are you CREATING markup,
or are you DRIVING existing markup?

- **Authoring a page** (source-editable HTML in canvas mode, scripts
  blocked — a read-and-mark surface): see
  [`make-page.md`](../make-page.md).

- **Authoring an interactive playground** (scripts run, buttons fire — a
  tutorial, dashboard, quiz, click-through form): see
  [`make-playground.md`](../make-playground.md) for the full action-verb
  vocabulary, `data-duo-pane` repaint regions, `data-payload-from` form
  bindings, anti-patterns, and a worked example. Copy-paste templates
  live at [`examples/canvas-templates/`](../examples/canvas-templates/).

- **Driving or reading an existing playground** — `duo edit` / `duo open`
  smart routing, `duo html` query/read + paint verbs, the `duo events
  --follow` subscription pattern for reacting to user clicks, and a
  debugging playbook for "the button isn't firing" / "events aren't
  reaching me" / "paint doesn't show up": see
  [`playground-interaction.md`](../playground-interaction.md).

The drive-by cheat sheet at
[`examples/canvas-actions.md`](../examples/canvas-actions.md) is the right
tab when you need ONE verb's signature; the references above are the right
tabs when you're working with canvases as a whole.

## Generate a worksheet for structured user feedback

When you need the user to respond to **N items** with **a structured
per-item answer + free notes**, and you want the response back in a
parseable form, reach for the **worksheet** primitive. The smoke-walk
and sprint-plan skills are both consumers; future retros / triage /
prioritization forms become JSON manifests, not new HTML generators.

```bash
# 1. Author a manifest (see .claude/skills/worksheet/SKILL.md for
#    the schema — items + radio options + textarea + result format).
node .claude/skills/worksheet/generate.mjs \
  docs/dev/worksheets/<name>.json \
  docs/dev/worksheets/<name>.html

# 2. Open in the browser pane (clipboard.writeText needs full Chromium;
#    canvas mode would trap the Copy button click as a cursor placement).
duo open docs/dev/worksheets/<name>.html

# 3. Hand off — the user fills it in, hits "Send to Claude" or
#    "Copy results", you parse the response.
```

The worksheet HTML emits BOTH a "Copy results" button (clipboard) AND
a "Send to Claude" button. The Send path calls
`window.duoSendResult(text, { worksheet })`, a CDP-injected binding
parallel to `window.duoOpenPath`. When the binding is wired (Duo
build supporting it), the result lands directly in the active Claude
terminal — no paste step. When it isn't, the Send button falls back
to clipboard + tells the user to paste.

The worksheet sub-skill at `.claude/skills/worksheet/SKILL.md` has
the full manifest schema, the result-format spec for parsing, and
authoring tips. Two consumers ship today:

- **`.claude/skills/smoke-walk/`** — pass/fail/skip per shipped item.
- **`.claude/skills/sprint-plan/`** — P0/P1/P2/skip per backlog
  candidate, fed by a gatherer that harvests tasks.md +
  active-sprint.md + roadmap.html.

When you'd otherwise build a long bullet-list in chat asking the
user "which of these…", consider whether a worksheet is the right
shape. ~5 items is too few; ~30 is enough.
