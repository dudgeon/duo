# Tasks ↔ Roadmap reconciliation plan

> **Status:** 🆕 Proposal — drafted 2026-04-30 (post-v0.5.4 sub-sprint).
> Awaiting owner sign-off before any execution. Filed here rather than
> `tasks.md` because it's a meta-process change, not a feature.

## The problem

Duo currently tracks open work in two artifacts that grew up
independently:

| Artifact | Shape | Strengths | Drift risk |
|---|---|---|---|
| `tasks.md` | Flat numbered ledger of `BUG-*`/`ENH-*`/`MISSING-*`/`PROCESS-*`/`FOLLOWUP-*` entries with root-cause writeups | Optimized for "search by symptom or fix family"; recurring-class bugs (BUG-038's 5 instances) live in one place | Items can become stale once the underlying stage ships |
| `docs/roadmap.html` (canonical) + `ROADMAP.md` (synced grep view) | Stage-numbered plan, nested checklists for sub-phases | Optimized for "what stage are we in, what's next"; multi-PR scope; forward-looking | Bug-class details get crammed into stage prose; small ENHs get filed in tasks but never linked back |
| `CHANGELOG.md` | Semver-versioned what-shipped | Canonical version inventory | Doesn't carry "why it broke / what we learned" |
| `docs/RELEASES.md` | Per-version prose | Release-note voice | Doesn't carry forward-looking context |
| `docs/dev/session-log.md` | Session-by-session prose | Captures sequencing + decisions in real time | Not indexed; doesn't replace forward planning |

The first two — `tasks.md` and `roadmap.html`/`ROADMAP.md` — are
the ones that overlap and drift. Examples of the drift today:

1. **ENH-027** filed in `tasks.md`. Referenced in Stage 17e of both
   roadmap files as "pull in: ENH-027". This cross-link works
   because I added it deliberately during this sub-sprint, but
   nothing enforces the convention.
2. **BUG-038** has 5 instances spanning multiple stages. The bug
   ledger captures the recurring-class history, but no roadmap
   stage references it — so a future planner reading the roadmap
   alone wouldn't know "⌃Tab cycle has been a tar pit."
3. **Roadmap "Backlog rough cuts"** (e.g. *Tab numbers in unified
   strip*, *`duo reload`* CLI verb, *Pane-aware ⌘+/- zoom*) are
   `- [ ]` checklist items in `ROADMAP.md` with no corresponding
   `ENH-*` ID. They're effectively shadow tasks — when an agent
   asks "what's open?" via a tasks.md grep, these don't appear.
4. **Stage 14a** (markdown editor's CommentRail binding) is
   referenced from `MISSING-001`'s "Suggested next step." But
   Stage 14 itself doesn't link back — so a planner working
   bottom-up from the roadmap doesn't see that there's an open
   user-facing gap blocked behind the stage.

The drift isn't catastrophic — both artifacts mostly tell true
stories — but it costs time on every planning loop and hides
work-in-flight across sprints.

## Goals

1. **Lossless** — no information lost from either side. Both
   artifacts keep their voice and shape; we add cross-references
   rather than merging.
2. **Queryable** — given any open ID (`ENH-027`) or stage
   (`Stage 17e`), I can find ALL related items in a single grep.
3. **Self-healing** — when a new bug or ENH is filed, the
   convention makes it obvious whether it should also touch the
   roadmap, and vice versa.
4. **Doesn't break the existing tooling** — `cut-version` skill,
   `smoke-walk` skill, `sync:claude` script all continue to work.

## Proposed convention

### A. Mandatory cross-reference fields

**On every `tasks.md` entry** — if the work belongs to a
roadmap stage, add a `**Stage:**` field directly below the
existing `**Status:**` and `**Priority:**` fields:

```md
### ENH-027: Local HTML defaults to canvas, not browser

**Status:** 🆕 Filed · held until Stage 17e
**Priority:** Medium-High
**Filed:** 2026-04-30
**Stage:** [Stage 17e — Polish + scripts + source view](../ROADMAP.md#phase-17e--polish--scripts--source-view-2-prs)
```

When the work is a free-floating ENH/BUG with no obvious stage
home (small UX tweak, isolated bug fix), the field is omitted —
that's the signal that it lives entirely in `tasks.md`.

**On every roadmap stage card** (HTML) and table row (Markdown) —
add a "Linked items" footer enumerating the BUG/ENH IDs that
block-on / block-this stage:

```md
| **17** | ... | 🟡 ... | **Linked items:** [ENH-027](tasks.md#enh-027), [MISSING-001](tasks.md#missing-001) |
```

For the HTML roadmap, the card gets a small `<ul class="linked">`
section with the same list.

### B. Promote shadow tasks to typed IDs

Walk through `ROADMAP.md`'s checklist items (`- [ ]` lines under
backlog headings, deferred-from-stage notes) and decide for each:

- **Discrete actionable** (specific bug, specific small ENH)
  → file as `ENH-*` / `BUG-*` in `tasks.md`, link both ways.
- **Scope-of-stage detail** (a sub-phase of a multi-PR stage)
  → keep in roadmap, but add a stage-internal anchor so the
  detail can be cross-referenced.
- **Strategic open question** (e.g. "First-launch install
  dialog" → Stage 18 already covers this) → keep in roadmap;
  no separate ID needed.

Initial migration list (estimated, walking the current open
items):

| Today's roadmap entry | Proposed disposition |
|---|---|
| "Tab numbers in unified strip" (Stage 20) | New `ENH-028` |
| "Terminal selection / clipboard refinements" (Stage 20) | New `ENH-029` (consolidate the cluster) |
| "`duo reload`" CLI verb (Stage 20) | New `ENH-030` |
| "Pane-aware `⌘+/-` zoom" (Stage 20) | Already issues #22/#23 — link from a new `ENH-031` for searchability |
| "PTY-side sandbox audit" (Stage 20) | Already issue #12 — new `PROCESS-002` |
| "`⌘[` parent-folder navigation" (Stage 20) | **Defer** — conflicts with ENH-025 (just shipped ⌘[ for editor outdent); needs a re-spec |
| "Google Docs keyboard path is broken" (Backlog rough cuts) | New `BUG-046` |
| "No Docs REST API escalation path yet" (Backlog) | New `ENH-032` |
| "First-launch install dialog" (Backlog) | Already implied as Stage 18 — no separate ID |
| "`duo wait --timeout` race fix" (Backlog) | Already shipped 2026-04-26 (Stage 20) — close out |
| 21d socket auth + Trailblazers README (Stage 21) | New `ENH-033` (Trailblazers cohort distribution) |
| Stage 10 dangling backlog items (lines 391–429) | Audit individually next pass |

### C. Document the convention in CLAUDE.md

Two-paragraph addition under "Working style," roughly:

> **Tasks vs. roadmap.** When a new bug/enhancement comes up,
> file it in `tasks.md` as a `BUG-XXX` / `ENH-XXX` entry with
> root cause + repro. If the work belongs to a roadmap stage,
> add a `**Stage:**` field linking to that stage AND update the
> stage's "Linked items" footer in `ROADMAP.md` (and the matching
> HTML card if you're touching `docs/roadmap.html`). Stage-level
> work (multi-PR scope, new surface, locked decision) stays in
> the roadmap as the canonical source; bug-class detail stays in
> `tasks.md`. The two cross-reference each other.
>
> **Avoid shadow tasks.** Don't park action items as bare `- [ ]`
> lines in `ROADMAP.md` without a `BUG-*`/`ENH-*` ID — those
> entries are invisible to `grep "Status:"` and stale fast.
> Promote each line either into the parent stage's spec (if it's
> stage-scope detail) or into `tasks.md` (if it's a discrete
> actionable).

### D. Periodic sync check (optional, future)

A small `scripts/check-tasks-roadmap-sync.mjs` that:

- Scans `tasks.md` for `**Stage:**` references and confirms each
  cited stage exists in `ROADMAP.md` and links back.
- Scans `ROADMAP.md` "Linked items" lists and confirms each cited
  ID exists in `tasks.md`.
- Flags any `tasks.md` entry that references a stage by prose
  (e.g. "see Stage 17e") but doesn't have the structured field.

Run it from a `pre-commit` hook or just on demand. Cheap insurance.

## Sequencing

If you accept this plan, executing it in order:

1. **(15 min)** Add the `**Stage:**` field to all currently-open
   `tasks.md` entries that obviously map to a stage (5–8 entries
   based on tonight's survey).
2. **(20 min)** Add the "Linked items:" footer to every active
   roadmap stage card / table row that has known BUG/ENH IDs.
3. **(45 min)** Walk the migration table in section B, file the
   new BUG/ENH entries, update both sides.
4. **(10 min)** CLAUDE.md docs addendum.
5. **(deferred)** The sync-check script — defer until friction
   warrants it.

Total ~1.5 hours one-shot, then ongoing adherence is small marginal
cost per new task.

## What this DOESN'T change

- `tasks.md` keeps its current shape — flat numbered ledger,
  status field, root-cause writeups, recurring-class summaries.
  No rename, no restructure.
- Roadmap stages keep their current shape — staged PR plan, nested
  sub-phases, owner-side comment fields, status-line wedges.
- `cut-version` skill — unchanged. Already reads from CHANGELOG +
  RELEASES.md; doesn't depend on this.
- `smoke-walk` skill — unchanged. Operates on its own JSON manifest.
- `sync:claude` — unchanged. Operates on `skill/` + `agents/`.

## Open questions for the owner

1. Want me to execute this in one pass, or would you rather see
   each section land as a discrete commit so you can review the
   convention as it's applied?
2. Should the migration in section B promote the rough cuts to
   `ENH-*` even when they're admittedly speculative? Risk: some
   of those rough cuts might never ship and become noise. Benefit:
   they're at least findable via grep.
3. Should `MISSING-*` IDs collapse into `ENH-*`? `MISSING-001` is
   the only one — keeping it separate feels like overhead.
