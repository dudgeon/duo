# Comments and tracked changes — reference

This page covers the full lifecycle of agent-driven comments and
tracked changes on a markdown file open in Duo's editor. Pair with
the cheat-sheet in [`SKILL.md § Leave a comment or track-change`](../SKILL.md).

## Where is the comment? — surface decision

Duo has TWO comment systems on different surfaces. Always run
`duo layout` first to pick the right verb cluster:

| `duo layout § main.kind` | Path | Surface | Verbs |
|---|---|---|---|
| `editor` | `.md` | Markdown editor (TipTap) | `duo doc comment` / `doc accept` / `doc reject` |
| `page` | `.html` | HTML canvas (source-edit) | `duo html comment` |
| `browser` | `file://…html` | HTML canvas (playground mode) | `duo html comment` (browser-pane comment overlay is ENH-157, partial) |
| anything else | — | not a commentable surface | — |

This reference covers the **markdown editor** case (CriticMarkup-based,
inline-stored). For the HTML canvas case see `duo html comment --help`.

## On-disk shape (CriticMarkup)

Comments and tracked changes are stored as inline CriticMarkup tokens
in the markdown file itself — no sidecar required:

| Kind | Token shape | Example |
|---|---|---|
| Insertion | `{++X++}` | `{++new phrase++}` |
| Deletion | `{--X--}` | `{--obsolete text--}` |
| Substitution | `{~~OLD~>NEW~~}` | `{~~TBD~>2026-Q3~~}` |
| Highlight | `{==X==}` | `{==important phrase==}` |
| Anchored comment | `{==anchor==}{>>id:c-xyz\|author:A\|ts:T\|body<<}` | `{==ship Q2==}{>>id:c-abc\|author:claude\|ts:2026-05-19T10:00:00Z\|Q2 has 8 weeks<<}` |
| Standalone comment | `{>>id:...\|author:...\|ts:...\|body<<}` | `{>>id:c-def\|author:claude\|ts:2026-05-19T10:01:00Z\|note in margin<<}` |

**Reply format** — replies do NOT get their own token. They append
inside the parent's `{>>…<<}` body using the `↪ @author ts: body`
separator joined by a newline:

```
{==ship Q2==}{>>id:c-abc|author:dudgeon|ts:t1|lead comment
↪ @claude t2: first reply
↪ @dudgeon t3: second reply<<}
```

The editor's `parseRepliesFromBody` splits the joined body back into
separate entries at render time. As an agent, **you don't construct
this format by hand** — use `duo doc comment --reply-to <id>`.

## Add a NEW top-level comment

```bash
DUO_AUTHOR=claude duo doc comment <file> \
  --anchor "the text to wrap as the anchor" \
  --body "the comment body"
```

Returns `{ok: true, changed: true, op: "comment", path: ...}`. The
new token gets an auto-minted id of shape `c-<base36-ts>-<rand>`. Read
the file back via `duo doc read <file>` to harvest the new id if you
need it for a downstream reply.

**Constraints:**

- `--anchor` must match the text in the all-suggestions-accepted view
  (the matcher strips existing CriticMarkup tokens before matching).
- `--anchor` must NOT overlap an existing CriticMarkup token. If it
  does, the verb returns `changed: false, reason: "anchor overlaps
  existing CriticMarkup — split the operation"`. Split the comment
  into two anchors at non-overlapping text.
- `--occurrence N` (1-indexed) picks the Nth match when the anchor
  text appears multiple times.

## Reply to an existing comment (BUG-143, v0.7.3+)

```bash
DUO_AUTHOR=claude duo doc comment <file> \
  --reply-to <parent-comment-id> \
  --body "the reply text"
```

**No `--anchor` required** — the server finds the parent token by id
and appends `\n↪ @<author> <ts>: <body>` inside its `{>>…<<}` body.

If the id isn't found, returns `changed: false, reason: "comment with
id '<id>' not found"`. The `<id>` is the value of the `id:` field
inside the parent's `{>>…<<}`; harvest it from `duo doc read <file>`
output or from the live rail.

**Pre-v0.7.3 workaround** (FOR HISTORICAL CONTEXT ONLY — do NOT use
on v0.7.3+): agents used to pass the parent id as `--anchor` text,
which created a corrupt `{==id==}{>>NEW<<}` token nested inside the
parent. v0.7.3 fixed the path; just use `--reply-to` alone.

## List comments / threads on a file

There's no dedicated `duo doc comments` verb. Read the file and grep:

```bash
duo doc read <file> | grep -oE '\{>>[^<]*<<\}' | head -20
```

Or to extract just the ids:

```bash
duo doc read <file> | grep -oE 'id:[a-z0-9_-]+' | sort -u
```

For richer parsing, read the file and feed it to your own
CriticMarkup parser (the canonical implementation lives in
[`core/markdown/criticmarkup.ts § parseCriticMarkup`](../../core/markdown/criticmarkup.ts)).

## Accept / reject a tracked change or comment

```bash
# Accept: insertion = keep text; deletion = drop text; substitution =
# keep NEW; highlight = strip wrapper; comment = strip wrapper, keep
# anchor text inline.
duo doc accept <file> (--id <c-id> | --match "<text>")

# Reject: insertion = drop; deletion = keep; substitution = keep OLD;
# highlight = strip wrapper; comment = strip the comment token but
# keep the anchor text + any inline replies' bodies are also dropped.
duo doc reject <file> (--id <c-id> | --match "<text>")
```

`--id` works only for comments (since only comments have ids). For
ins / del / sub / highlight, use `--match` with the inner text. Pass
`--occurrence N` when `--match` matches multiple ops.

## How the live editor refreshes

The verbs above write to disk via the socket-server's `files.write`.
The editor watches its open file via chokidar (BUG-085 family):

- **Clean buffer** (no unsaved edits) → silent reload + re-apply
  CriticMarkup marks. Your write is visible within ~50ms.
- **Dirty buffer** (user has unsaved edits) → conflict banner with
  reload-or-keep-mine choices. The user picks.

You don't need to `duo edit <file>` first — the file doesn't need to
be open. But if it IS open, the user sees your write immediately.

## Common-task cheat-sheet (the 3-call expected path, post-BUG-143)

The bug report that drove v0.7.3's cluster (BUG-142..147) showed an
agent burning 16 shell calls + ~2 minutes to add a single reply. The
expected post-fix path is **three calls**:

```bash
# 1. Confirm the surface (markdown editor, not the HTML canvas).
duo layout

# 2. Find the parent comment id.
duo doc read | grep -oE 'id:[a-z0-9_-]+' | head -5

# 3. Append the reply.
DUO_AUTHOR=claude duo doc comment <file> --reply-to <id> --body "X"
```

~10 seconds total, the editor refreshes automatically.

## Discoverability

- `duo doc --help` — all doc subcommands (focused, ~15 lines).
- `duo doc comment --help` — just the comment-verb signature.
- This reference page — full lifecycle + on-disk shape.

The global `duo --help` is exhaustive but ~200 lines; prefer the
focused per-verb help for first-encounter agents.
