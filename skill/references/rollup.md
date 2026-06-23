# Rollups — `duo rollup` (ENH-229)

A **rollup** is a view computed from vault frontmatter — "open tasks for each
initiative, grouped by status, with an owner." This is the companion to
`base lint` / `base render` (see [vault.md](vault.md) for the corpus + base
authoring); `duo rollup` is the product verb that emits a **shareable
artifact** with three things base render alone doesn't give you: a **format
choice** (Markdown OR HTML), **entity links** on every row, and an optional
**change summary** on regenerate.

## When the user wants one

Triggers (any vault — OKF or Obsidian): *"roll up my tasks"*, *"make a
[markdown|page] of all my <type> grouped by <field>"*, *"give me a board of
open initiatives with a link to each"*, *"and tell me what changed since last
time"*. Reach for `duo rollup`, not a hand-built table.

## The two variants (pick ONE per rollup)

```
duo rollup render <note|base> --md     # GitHub-portable Markdown (the OKF default)
duo rollup render <note|base> --html   # a stamped, Atelier-styled HTML artifact
```

Mutually exclusive — one file per call (never one file with a toggle). Default
is `--md`. Rollups default to **`<vault>/rollups/`** (`--out <path>` writes
elsewhere); `--open` surfaces it as a tab. Every artifact opens with an
agent-visible HTML comment explaining it's a generated rollup + how to
regenerate it — so a fresh agent that finds the file isn't confused. The
`rollups/` (and `out/`) folders are excluded from the corpus, so a rollup never
rolls up into itself.

**Authoring the rollup** is the same loop as a base (derive the corpus with
`duo vault schema`, write a `.base` or an embedded ` ```base ` block, `duo base
lint` until clean). Then render it with `duo rollup render` instead of `base
render` to get the variant choice + the features below.

## Entity links (always on)

Every row links the entities it rolls up: the row's own note (the `file.name`
column), any `Link`-valued frontmatter (`owner`, `initiative`), and grouped
headers. Works in **both** formats and in **both** vault modes — including OKF
vaults where refs are stored as standard-markdown rel links
(`owner: "[Display](./people/<slug>.md)"`), not just `[[wikilinks]]`.
Unresolved values stay plain text (never a fabricated link).

## Custom style (HTML only)

```
duo rollup render <note> --html --style ./my-theme.css
```

Layers a local CSS file over the Atelier base (so a partial sheet still leaves
the artifact usable). Default is Atelier. Markdown has no stylesheet — `--style`
with `--md` errors. Remote URLs aren't fetched (local files only).

## Change summary on regenerate (the headline feature)

A rendered artifact **self-embeds** a rows snapshot + a summary log inside HTML
comments (valid + invisible in both formats, and on GitHub — no sidecar file).
On regenerate, you diff against that snapshot and add a narrative.

**The loop (you, interactive — never `claude -p`):**

1. `duo rollup diff <note|base>` → a deterministic JSON delta vs the prior
   artifact's embedded snapshot: `{ views:[{added, removed, changed:[{key,
   fields:[{col, from, to}]}]}], totals, firstRun }`.
2. From that delta, write a short **narrative + notables** — what's worth
   attention, positive or negative (a slipped date, a cleared blocker). On
   `firstRun` (no prior), just say "initial rollup."
3. `duo rollup render <note|base> --md --summary "<your prose>"` — embeds it as
   the latest **"What changed"** (pinned at the top); the prior summary drops
   into a collapsible history. `--no-summary` turns the whole feature off.
4. If a tab is open on the artifact, it reloads on the rewrite.

**Reacting to a Refresh.** Both the HTML rollup's Refresh button AND the
Markdown rollup's `[↻ Refresh](duo://rollup/refresh?base=…)` link (clicked in
Duo's editor) emit the same `rollup:refresh` event with payload `{ base }`.
Subscribe and run the loop above:

```bash
duo events --follow | while IFS= read -r line; do
  case "$(jq -r '.name // empty' <<< "$line")" in
    rollup:refresh)
      target=$(jq -r '.payload.base' <<< "$line")
      diff=$(duo rollup diff "$target")
      # …read $diff, compose a narrative + notables…
      duo rollup render "$target" --md --summary "$summary"
      ;;
  esac
done
```

"The user just accepts" — you regenerate + summarize; the artifact reloads with
the new summary. No blocking approval. The MD refresh link fires on a plain
click in Duo's editor (it's an action affordance, not navigation); on GitHub or
any other viewer the `duo:` link is simply inert.

## Sample prompt (how a user invokes this skill)

> **"Roll up all my open tasks grouped by initiative as a markdown page — link
> each task and owner — and from now on, whenever I refresh it, summarize
> what changed."**

You would: confirm the vault + corpus (`duo vault schema`), author/confirm a
`type == "task"` base grouped by `initiative` with `file.name`, `status`,
`owner` columns, `duo rollup render tasks --md --open`, then watch
`rollup:refresh` and run the diff→summarize→re-render loop on each refresh.

## Verbs

| Verb | Use it to |
|---|---|
| `duo rollup render <note\|base> --md\|--html [--style <css>] [--summary "<text>"\|--no-summary] [--out <p>] [--open]` | Emit one variant with entity links; `--summary` adds the latest "What changed" (history kept), `--no-summary` disables it, `--style` layers CSS (HTML only) |
| `duo rollup diff <note\|base> [--against <prior-artifact>] [--vault <path>]` | Deterministic JSON delta vs the prior artifact's embedded snapshot (newest of the two formats by default) — the material you turn into a narrative |

Both read the filesystem directly (no running app); only `--open` reaches the
app to surface a tab.
