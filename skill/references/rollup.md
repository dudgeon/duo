# Rollups — `duo rollup` (ENH-229 · ENH-228)

A **rollup** is a view computed from vault frontmatter — "open tasks for each
initiative, grouped by status, with an owner." This is the companion to
`base lint` / `base render` (see [vault.md](vault.md) for the corpus + base
authoring); `duo rollup` is the product verb that emits a **shareable
artifact** with three things base render alone doesn't give you: a **format
choice** (HTML or Markdown), **entity links** on every row, and an optional
**change summary** on regenerate.

**A rollup is a first-class `type: rollup` NOTE (ENH-228 D1).** Don't think of a
rollup as "a rendered file somewhere" — it's a typed note (from
`templates/rollup.md`, filed in `rollups/`) that owns its **spec** (an embedded
` ```base ` block OR a `spec:` frontmatter path to a `.base`) and its **render
provenance** (`out`, `last_generated`, `last_hash`, stamped back on each
render). That makes discovery a corpus query — `duo rollup list` — instead of a
fragile scan, and powers the Vault view's Rollups column. **HTML is the default
output** (D2 — the owner is HTML-first); `--md` is opt-in.

## When the user wants one

Triggers (any vault — OKF or Obsidian): *"roll up my tasks"*, *"make a
[markdown|page] of all my <type> grouped by <field>"*, *"give me a board of
open initiatives with a link to each"*, *"and tell me what changed since last
time"*. Reach for `duo rollup`, not a hand-built table.

## The authoring loop (ENH-228) — write the note, render HTML

The headline path. The Vault view's **"+ New rollup"** button drops you into a
seeded Claude session that runs exactly this:

1. **Derive the corpus** — `duo vault schema` (real type names, entity names,
   observed enum values). Write the spec against *those*, not guesses.
2. **Write a `type: rollup` note** in `rollups/<slug>.md` (from
   `templates/rollup.md`). Put the query in an embedded ` ```base ` block in the
   body (or set `spec:` to a `.base` path), and leave `format: html`.
3. **Lint** — `duo base lint <note>` until clean (advisory; fix what it flags).
4. **Render + stamp** — `duo rollup render <note> --html --open`. HTML is the
   default for a rollup note (D2); the render writes the artifact to the note's
   `out:` (default `rollups/<slug>.html`) and stamps `out`/`last_generated`/
   `last_hash` back into the note **surgically** (your spec + body are
   untouched). The Vault view's Rollups column now lists it with a freshness
   chip.

## The two variants (pick ONE per rollup)

```
duo rollup render <note|base> --html   # a stamped, Atelier-styled HTML artifact (DEFAULT)
duo rollup render <note|base> --md     # GitHub-portable Markdown (opt-in)
```

Mutually exclusive — one file per call (never one file with a toggle). **HTML is
the default** (ENH-228 D2); a `type: rollup` note's own `format:` is honored
when no flag is given. Rollups default to **`<vault>/rollups/`** (`--out <path>`
writes elsewhere); `--open` surfaces it as a tab. Every artifact opens with an
agent-visible HTML comment explaining it's a generated rollup + how to
regenerate it — so a fresh agent that finds the file isn't confused. The
`rollups/` (and `out/`) folders are excluded from the corpus, so a rollup never
rolls up into itself (the rollup NOTES in `rollups/` are still discovered by
`duo rollup list`, a `type == rollup` query — they're typed notes, not
artifacts).

**Rendering a bare `.base` (no note) still works** — the legacy ENH-229 path:
author a `.base` (or an embedded ` ```base ` block in any note), `duo base lint`
until clean, then `duo rollup render <base> --html`. You just don't get the
typed-note discovery / provenance stamp unless the target is a `type: rollup`
note.

**OKF vaults included — a `.base` is just the query.** The common agent
mistake: *"this is an OKF vault, it has no `.base` files, so `duo rollup render`
won't work — I'll hand-build the HTML."* **Wrong, and it's the #1 way agents
fumble this.** OKF doesn't *auto-render* `.base` files at rest (that's an
Obsidian-live behavior; OKF's at-rest listings are `index.md`/`log.md` via
`duo vault publish`) — but a `.base` is just a **query definition**, and
`duo rollup render <base> --md|--html` evaluates it over the corpus in **both**
modes (entity links resolve to OKF rel-md paths — verified). So when the user
asks for a *"rich HTML rollup / dashboard"* of an OKF vault: author a `.base`,
then `duo rollup render <base> --html --open`. **Never hand-build the HTML** —
the rendered artifact already carries the Refresh button + the staleness stamp.
(For an expressive *in-vault* `index.md` instead — the canonical listing a
reader opens — give it a `listing:` spec and `duo vault publish`; see
[vault.md](vault.md).)

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
3. `duo rollup render <note|base> --summary "<your prose>"` — embeds it as the
   latest **"What changed"** (pinned at the top); the prior summary drops into a
   collapsible history. `--no-summary` turns the whole feature off. (Format
   follows the rollup note's `format:` / the HTML default; add `--md` for the
   Markdown variant.)
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
      duo rollup render "$target" --summary "$summary"   # HTML default; add --md for Markdown
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

You would: confirm the vault + corpus (`duo vault schema`), write a
`type: rollup` note `rollups/tasks.md` with an embedded `type == "task"` base
grouped by `initiative` (columns `file.name`, `status`, `owner`), `duo base lint`
it, then `duo rollup render tasks --md --open` (the user asked for a *markdown*
page — otherwise HTML is the default), then watch `rollup:refresh` and run the
diff→summarize→re-render loop on each refresh.

## Verbs

| Verb | Use it to |
|---|---|
| `duo rollup render <note\|base> [--html\|--md] [--style <css>] [--summary "<text>"\|--no-summary] [--out <p>] [--open]` | Render the spec → one variant (HTML default — D2; `--md` opt-in) with entity links. For a `type: rollup` note: stamps `out`/`last_generated`/`last_hash` back surgically + defaults out to the note's `out:`. `--summary` adds the latest "What changed" (history kept), `--no-summary` disables it, `--style` layers CSS (HTML only) |
| `duo rollup list [--vault <path>]` | The rollup inventory — every `type: rollup` note with `{note, title, out, format, last_generated, last_hash, stale}` (`stale = last_hash !== the live source hash`). A corpus query, no scan, no sidecar (D1) — the Vault view's Rollups column |
| `duo rollup diff <note\|base> [--against <prior-artifact>] [--vault <path>]` | Deterministic JSON delta vs the prior artifact's embedded snapshot (newest of the two formats by default) — the material you turn into a narrative |

All read the filesystem directly (no running app); only `--open` reaches the
app to surface a tab.
