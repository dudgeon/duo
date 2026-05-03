---
name: sprint-plan
description: Help the owner plan the next Duo sprint by harvesting candidates from tasks.md / active-sprint.md / session-log.md / roadmap.html, generating an interactive worksheet they prioritize (P0 / P1 / P2 / Skip), then synthesizing the result into a sprint commitment + active-sprint.md update. PROACTIVELY OFFER right after a cut lands or when the owner says "what's next?", "let's plan the next sprint", "let's triage", or signals end-of-chapter. Pairs with the `worksheet` skill (which it builds on) and `cut-version` (which it precedes).
---

# sprint-plan skill — Duo

> **Why this skill exists.** Sprint planning has been ad-hoc: scroll
> tasks.md, glance at active-sprint.md, brainstorm in chat, hope the
> right items make it into the next sprint. Captures: drift over time;
> P0 regressions sometimes get filed but not prioritized; "Other notes
> for next sprint" rows from the smoke walk get re-discovered weeks
> later. A worksheet-driven plan removes the scroll-and-remember step
> from the loop.

## When to propose a sprint plan

**Strong triggers (proactively offer):**

1. A version cut just landed and the next sprint hasn't started.
2. The owner says any of: "what's next", "let's plan", "what should
   we prioritize", "triage this list", "what's in the next sprint",
   "let's get focused".
3. A smoke walk produced FAIL rows + "Other notes for next sprint"
   carry-overs that haven't been triaged yet.
4. After significant context compaction — a fresh sprint plan
   re-grounds the next session in concrete priorities.

**Skip when:**

- The current sprint is mid-flight (don't replan; finish what's
  committed).
- The owner asks for a one-off triage of a single item ("what should
  I do about BUG-074?" — answer in chat).

## Procedure

### 1. Run the candidate gatherer

```bash
node .claude/skills/sprint-plan/gather.mjs <next-version>
```

`gather.mjs` writes the worksheet manifest to
`docs/dev/worksheets/sprint-plan-v<VERSION>.json` by default. It
pulls from:

- **`tasks.md`** — every entry whose status is 🆕 Filed / 🟡 Partial /
  ⏳ Open. Status badge appears in the per-item subtitle.
- **`docs/dev/active-sprint.md`** — the most recent walk's FAIL
  table (typically the highest-signal carry-overs) and the "Other
  notes for next sprint" table (already-triaged candidates).
- **`docs/roadmap.html`** — `🟡` in-progress stage cards (strategic
  context; only emits stages with a status-line emoji match).
- **`docs/dev/session-log.md`** — referenced in the worksheet's intro
  for the user to glance at while filling things out (parsing the
  prose log is unreliable; surfacing it as a link is better than
  emitting noise).

Items are deduped by ID; subtitle aggregates source provenance when
the same item appears in multiple sources.

### 2. Skim the manifest before generating

The gatherer can produce noisy titles for FAIL rows whose original
"Item" cell was just a bare ID — it falls back to the first sentence
of the failure cell, which can include markdown bolding. Quickly
read through `docs/dev/worksheets/sprint-plan-v<VERSION>.json` and
hand-edit titles where the auto-derivation is awkward.

You can also cull obvious P3-or-lower noise here so the worksheet
isn't 50 rows long. Aim for ~15-25 candidates.

### 3. Generate the worksheet HTML

```bash
node .claude/skills/worksheet/generate.mjs \
  docs/dev/worksheets/sprint-plan-v<VERSION>.json \
  docs/dev/worksheets/sprint-plan-v<VERSION>.html
```

### 4. Open in Duo

```bash
duo open docs/dev/worksheets/sprint-plan-v<VERSION>.html
```

Same hand-off as the smoke-walk skill — tell the user the worksheet
title (e.g. "Sprint plan · v0.6.5") so they can find it in the tab
strip if `duo open` didn't auto-focus it.

### 5. Hand off

> Sprint plan worksheet **Sprint plan · v0.6.5** is open as a
> browser tab. For each candidate: P0 if it must land in the next
> sprint, P1 if it would be great, P2 if nice-to-have, Skip to
> defer. Add notes for context, dependencies, or "this is just X
> rolled into Y." When you're done, hit **Send to Claude** at the
> bottom (or **Copy results** + paste back).

### 6. Parse the result + propose a sprint plan

When the user pastes back (or Send-to-Claude lands), parse the
result block. Group items by priority. Then write a short proposal
covering:

1. **Sprint goal** — one sentence summarizing the theme of the P0+P1
   items. "Fix v0.6.4 cut-blockers + ship Split View Phase 3c
   browser-in-aux." Pull from the user's "Other notes" if they
   wrote one.
2. **P0 commit** — list the items, with rough order. These MUST
   land before the cut.
3. **P1 stretch** — what we'll attempt after P0 lands. Optional cut
   inclusion based on time.
4. **P2 deferred** — explicitly captured as "next sprint" items so
   they don't fall off the radar.
5. **Open questions** — anything the user flagged in notes that
   needs a decision before work starts.

### 7. Persist the plan

Write the proposal into `docs/dev/active-sprint.md` as a new section
at the top, replacing the previous "next sprint" pointers in the
existing file. Pattern:

```markdown
## Sprint plan v<VERSION> — committed <date>

**Theme:** <one-line goal>

**P0 (cut blockers):**
- BUG-075 — Phase 3b chord regression (...)
- BUG-074 — Light-mode contrast (...)

**P1 (stretch):**
- ENH-083 — Move collapse-pane buttons (...)

**P2 (deferred to next sprint after this one):**
- ENH-080 — ⌘⇧A search open tabs

**Open questions:**
- ...

(see worksheet at docs/dev/worksheets/sprint-plan-v<VERSION>.html)
```

That section becomes the "what are we working on right now" answer
for the duration of the sprint. The previous active-sprint.md
content (the smoke walk results + carry-overs) moves down or gets
pruned per the file's existing pruning rules.

### 8. Suggest next session start

Hand the user a one-line cue for the next session:

> Next session, point me at sprint plan v<VERSION> and we'll start
> with the first P0 item ({first P0 item title}). I'll re-read
> active-sprint.md so we're grounded in the plan.

## Files

- `.claude/skills/sprint-plan/SKILL.md` — this file.
- `.claude/skills/sprint-plan/gather.mjs` — candidate harvester.
  Reads tasks.md / active-sprint.md / roadmap.html and writes a
  worksheet manifest.
- `docs/dev/worksheets/sprint-plan-v<VERSION>.json` — generated
  manifest (gitignored).
- `docs/dev/worksheets/sprint-plan-v<VERSION>.html` — generated
  worksheet page (gitignored).
- `docs/dev/active-sprint.md` — destination for the committed plan.
