# Graphbook prototype — Obsidian Bases at the edge

A working miniature graphbook (ENH-208, intent round 1.5) built to answer one
question: **is Obsidian Bases expressive enough to be the rollup definition
format (playground decision D1-A)?** It is a real Obsidian vault — open this
folder in Obsidian (File → Open folder as vault; Bases is core, on by
default) and every `.base` file and embedded block renders live.

Syntax verified against the official help docs as of Obsidian **1.13.0**
(2026-05-28). A few constructs are deliberate *edge probes* (marked below)
where the docs stop short — the point is to find the boundary empirically.

## What to look at, in order

1. **`initiatives/Q3 Launch/Q3 Launch.md`** — the headline pattern. The
   embedded ` ```base ` block filters `initiative == this`, so the *same
   verbatim block* lives in `templates/initiative.md`: every new initiative
   gets a live milestone rollup with zero per-initiative configuration.
   Compare [[Pricing Revamp]] — identical block, different rows.
2. **`bases/milestones.base`** — vault-wide milestone board. Three views
   (grouped table / blocked-only / list). Formulas show the styling range:
   `html()` status chips (colored pills), `icon()` Lucide marks, date math
   (`due.relative()`, numeric days-left), per-group summaries
   (`Earliest` due, `Filled` count).
3. **`bases/portfolio.base`** — initiatives overview, table + cards, and the
   **child→parent rollup edge probes** (see below).
4. **`bases/people-load.base`** — open milestones grouped by a *link-valued*
   property (owner). "Who is carrying what."
5. **`bases/processing.base`** — the processing pass as a dashboard: stale inbox
   notes (`captured < today() - "1 week"`), untyped notes, milestones
   missing `due`. Every row is a TODO for the processor (human or Claude).

## The Duo-side renderer (mini-SSG prototype)

`render.mjs` is the other half of the D1-A bet: proof that a third-party
renderer can parse the *same* `.base` files Obsidian reads and emit richer
HTML — the "deterministic mini-SSG" from the sidecar discussion.

```
node render.mjs   →  out/graphbook.html
```

It walks the vault, parses frontmatter + every `.base` file + every embedded
` ```base ` block (with correct `this` = host-note context), evaluates the
expression subset these fixtures use (and/or/not filters, link equality vs
`this`, `if()`, `html()` chips, `icon()`, date math, `groupBy`, summaries),
and writes ONE stamped artifact: generated-at, source hash, and the as-of
date for relative formulas — the build-artifact framing that keeps it on the
right side of the no-sidecar rule. It deliberately **exceeds** Obsidian in
one place: the `probe_a`/`probe_b` child→parent rollups always work here,
demonstrating "same definition file, more capable renderer."

## Edge probes — what renders vs. what breaks

| Probe | Where | Expected |
|---|---|---|
| `initiative == this` in an embedded block | initiative notes | Documented (`author == this`); should work. THE load-bearing feature for D1-A. |
| `html()` styled chips | milestones.base | Documented (added 1.10). Colored status pills in-table. |
| `(due - today()) / 86400000` | milestones.base `days_left` | Date−date→ms is documented; numeric division of the result is lightly documented. |
| `file.backlinks.length` | portfolio.base `mentions` | Documented, but flagged performance-heavy + not auto-refreshed. |
| `probe_a` / `probe_b` (count done milestones from the parent) | portfolio.base | **UNVERIFIED by docs.** If either renders a correct count, Bases can do child→parent rollups (fragile); if both fail, that's the boundary. |
| `groupBy` a link property | people-load.base, milestones.base | Probably fine; checks how link groups render. |

## The boundary (per official docs, June 2026)

Confirmed limits that no amount of clever YAML escapes:

- **No joins, no subqueries** — one filtered result set per base.
- **Summaries are terminal** — a column aggregate can't feed a formula,
  filter, or another note. No pivot tables.
- **Child→parent aggregation is not a supported path** — `file.backlinks` is
  the only reach-across, and the docs flag it heavy + stale.
- **No published schema or external rendering API** — the in-app plugin API
  (`registerBasesView`) is Obsidian-only; a third-party renderer (Duo) parses
  the YAML against the help-page spec.
- Layout-specific settings (card size, image property, row height) have **no
  documented YAML keys** — set them once in Obsidian's UI and copy what it
  serializes.

## How this maps to the D1 decision

If the probes hold, Bases covers: per-entity rollups (via template-embedded
`this` blocks), global boards, processing dashboards, styled cells, group
aggregates — i.e. **everything in the round-1 rollup mock except
cross-entity computed rollups** (initiative health derived from its
milestones). That last gap is either (a) denormalized — processing writes a
`health` property onto the initiative, Bases displays it — or (b) where a
Duo renderer goes beyond the spec while reading the same `.base` files.

*Generic fixture data only — no real people, projects, or employers.*
