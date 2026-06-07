# Patterns — markdown editor

How to transform the user's selected text, rewrite a whole markdown
document, open a `.md` file, leave attributed comments / tracked changes,
and read or edit a Google Doc through Duo's rich editor.

## Contents

- [Never write around the editor](#never-write-around-the-editor)
- [Transform the user's selected text](#transform-the-users-selected-text-in-the-markdown-editor)
- [Rewrite an entire markdown document](#rewrite-an-entire-markdown-document)
- [Open a markdown file](#open-a-markdown-file-for-the-user-to-read-or-edit)
- [Leave a comment or track-change (with attribution)](#leave-a-comment-or-track-change-on-a-markdown-file-with-attribution)
- [Read or edit a Google Doc](#read-or-edit-a-google-doc)

## Never write around the editor

> **CRITICAL — never `Write`/`Edit` a markdown file the user has open in
> Duo's rich editor.** Mutate it through `duo doc write`
> (`--replace-selection` for a piece of the doc, `--replace-all` for the
> whole body). Direct filesystem writes bypass the editor's live TipTap
> state, so the user keeps seeing the OLD content while disk has moved on;
> worse, the editor's autosave can silently overwrite your fs write the
> moment the user types anything (a banner now warns for the dirty case,
> but the right path is still to never go around the editor in the first
> place). If you're unsure whether the file is open, run `duo status`
> first — it lists every open file tab with its `path` / `kind` / `dirty`
> flag. (Do NOT reach for `duo nav state`: that's the file-TREE selection
> snapshot and has no `working` field — checking it for open tabs never
> worked.)

## Transform the user's selected text in the markdown editor

This is the canonical "summarize this / shorten this / rewrite this"
flow when the user has a `.md` file open in Duo's rich editor.

1. Call `duo selection`. If it returns `null`, there's no editor tab
   active — tell the user to open the file with `duo edit <path>` or
   click into the editor first.
2. If `text` is empty, the selection is collapsed at the caret — in
   that case ask the user to select the thing they mean, unless the
   request is clearly about the surrounding `paragraph` or the whole
   section described by `heading_trail`.
3. Do the transform in-process (think, don't tool-call unnecessarily),
   then:

```bash
# Replace the user's selection with the transformed text.
echo "the new text" | duo doc write --replace-selection
```

The selection overlay stays visible even while the terminal has focus,
so the user can see exactly what range you're operating on.

**Send → Duo (future, not yet shipped):** when the user clicks a
"Send → Duo" button next to a selection (or hits the keyboard
shortcut), the selection is injected into your terminal as a quoted
block plus a one-line provenance ("from /path/to/foo.md · Risks > Market"),
ready for you to read alongside the user's typed verb. The injection
format is itself runtime-configurable via `duo selection-format`:

- `duo selection-format` — print the current format (default `a`).
- `duo selection-format c` — switch to opaque tokens like
  `<<duo-sel-abc123>>` for the rest of the session. Useful when
  you're going to do many transforms in a row and the quoted blocks
  would clutter your context.
- `duo selection-format a` — switch back to the human-readable
  default.

Format `c` requires you to call `duo selection` to read what the
token refers to. Format `a` (default) gives you the text inline plus
a `duo selection` round-trip available if you want richer context
(line range, heading trail).

## Rewrite an entire markdown document

When the user says "restructure this PRD" or "convert this outline into
prose", use `replace-all` so you can emit markdown (headings, lists,
tables). The editor's frontmatter is preserved automatically.

```bash
cat <<'EOF' | duo doc write --replace-all
# Rewritten doc

Your new content here, with **bold**, `code`, lists, tables…
EOF
```

## Open a markdown file for the user to read or edit

```bash
duo edit ~/projects/foo/prd.md
```

Opens in the rich editor with a centered prose column, toolbar, and
auto-discovered frontmatter. Internal links to other `.md` files are
followed as new editor tabs.

## Leave a comment or track-change on a markdown file (with attribution)

When you want to **suggest** an edit, **leave a note**, or **flag a
question** in a `.md` file without overwriting the user's prose, use
the CriticMarkup verbs. They write inline tokens (`{++ins++}`,
`{--del--}`, `{~~old~>new~~}`, `{>>comment<<}`) that render as
suggestions in the editor — the user accepts or rejects each one
from the right-side rail.

> **The full lifecycle lives in [comments.md](comments.md)** — anchoring,
> replying, accept/reject, on-disk CriticMarkup shape, and one runnable
> example per pattern. This section is just the surface-disambiguation
> map + attribution reminder; reach for `comments.md` for the how.

**"Comment" disambiguation — two systems, look at the surface first.**

The user's word "canvas" or "this document" is ambiguous. Run `duo layout`
and consult `main.kind`:

| `main.kind` | Surface | Comment system | Verbs |
|---|---|---|---|
| `editor` (and path ends `.md`) | Markdown editor (TipTap) | CriticMarkup tokens stored INLINE in the file | `duo doc comment` / `doc accept` / `doc reject` |
| `page` (and path ends `.html`) | HTML canvas (source-edit) | Sidecar JSON annotations on DOM elements | `duo html comment` / `duo html comments` |
| `browser` (`file://…html`) | HTML canvas (playground mode) | Browser-pane comment overlay (partial — the markdown editor remains the primary canonical comment surface) | `duo html comment` (planned) |

If you're unsure → `duo layout` FIRST, then pick the verb cluster. Do not
guess from the user's wording; the same file can be opened in either
surface depending on which verb was used (`duo edit` → editor, `duo open`
→ browser).

**Attribution is via the `DUO_AUTHOR` env var on the calling shell.**
Default is `agent` if unset. Set it once per session (or per call) so the
comments/marks are clearly stamped as YOURS, not the user's. The full
example set (anchor a new comment, reply to a thread with `--reply-to`,
suggest an insertion / substitution) is in
[comments.md](comments.md); the one-line reminder:

```bash
# Anchor a NEW comment to specific text. Author = `claude` here.
DUO_AUTHOR=claude duo doc comment ~/projects/foo/prd.md \
  --anchor "we'll ship this Q2" \
  --body "Stretch — Q2 has only 8 working weeks after the offsite."
```

**Rules of thumb:**

- **Use comments** when the change is a *question* or *opinion* the
  user should weigh in on (a comment never alters their prose).
- **Use track-changes (insert / delete / substitute)** when you have
  a concrete proposed edit. The user accepts/rejects per-suggestion.
- **Always pass `DUO_AUTHOR`** with a meaningful name (`claude`,
  `claude-research`, etc.) so the user sees a ✨ agent badge in the
  rail and can filter your suggestions vs. their own.
- **Replies use `--reply-to <comment-id>` alone** (no `--anchor`). Pull
  the id from the live rail OR from a prior verb's JSON output.

The verbs are disk-only — when the user has the file open in Duo, the
editor's chokidar watcher detects the on-disk change and reloads
transparently (silent on clean buffer; banner-prompted on dirty buffer).
You don't need to `duo edit` first; you can drive the comment flow
from a side terminal while the user is reading.

**Get focused help:** `duo doc --help` lists the doc subcommands;
`duo doc comment --help` gives just the comment-verb signature.

## Read or edit a Google Doc

Google Docs renders into a `<canvas>`, so the usual extractors (`duo
text`, `duo dom`) return chrome or empty — this is the same canvas-text
trap that makes `duo ax` necessary (see
[debugging.md § The canvas-text trap](debugging.md#the-canvas-text-trap-why-ax-exists)).

The canonical read is a same-origin `/export?format=md` fetch, and
editing is limited to plain-text insertion via `duo type` (format chords
like cmd+B are silent no-ops because Docs routes keyboard input through a
hidden iframe CDP can't reach). The full read pattern, the offline
fallbacks, the list of canvas traps to avoid (the `<noscript>` red
herring, the `export?format=txt` download trap), and the keyboard-input
limitation in detail are in
[references/google-docs.md](google-docs.md).
