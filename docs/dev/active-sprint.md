# Active sprint state — Stage 27 (Sprint A)

> **What this file is.** Running scratchpad for the active sprint.
> Updated as work progresses. Other doc files (`ROADMAP.md`,
> `docs/prd/stage-27-canvas-authoring.md`, `docs/prd/stage-28-lesson-packs.md`)
> are the formal record. This file is the "where am I right now" file.
>
> **For future Claude instances:** if you're picking up after a context
> compaction, READ THIS FILE FIRST. It points at the formal plan
> + says exactly what's been done and what's next.
>
> **Update cadence:** at the end of each commit (mark the row done,
> note any deviations, update "next" pointer).

---

## Current state — last updated 2026-05-01

**Active sprint:** Stage 27 — Canvas authoring vocabulary + skill.
**Active commit:** Commit 4 (`<meta name="duo-default-editable">` —
ENH-034).
**Branch:** `main` (all work on main; no worktree).
**Status:** Commits 1–3 landed. Commit 3 = `data-payload-from`
form-input binding inside the canvas-action click handler;
`captureFormValue(doc, selector)` is the helper. Typecheck clean.

## Big-picture initiative

Three sprints, all anchored on the next cut **v0.6.0**:

- **Sprint A — Stage 27** (now): the primitives (action verbs, event
  bus, form bindings, default-editable, skill, templates).
- **Sprint B — Stage 18b** (next): distro pack format + install
  machinery + first-launch defaults hook.
- **Sprint C — Stage 28** (after): the two lesson packs
  (intro-to-duo + claude-code-basics).

## Where the formal plan lives

| Document | Purpose |
|---|---|
| `docs/prd/stage-27-canvas-authoring.md` | Sprint A PRD — full commit-by-commit sequence, decisions, verification punch list |
| `docs/prd/stage-28-lesson-packs.md` | Sprint C PRD — both lesson packs + FTUX surfacing |
| `ROADMAP.md` lines 184-185 | One-line stage entries |
| `docs/roadmap.html#s27` and `#s28` | Stage cards (matching ROADMAP.md content) |

## Pending v0.5.5 fixes — folded into v0.6.0 at next cut

The drafted v0.5.5 release notes are stashed in
`docs/RELEASES.md § Pending — not yet cut`. Includes:
- BUG-006 (Send → Duo pill on browser pane — Path b CDP injection + v2 race fix)
- BUG-049 (trash dialog wording fix)
- BUG-050 (markdown editor tab context menu portal-to-body)
- BUG-047 class-closed
- ENH-032 (terminal locale — FAQ + duo doctor probe)
- BUG-028 (verified live)
- `shared/feature-flags.ts` + `FEATURE_AUTO_INJECT_IDS = false`
- Smoke-walk generator emits `<meta name="duo-open-in" content="browser">`

These all shipped in code but were not version-cut. They fold into the
v0.6.0 cut at the end of the three-sprint arc.

## Stage 27 commit checklist

| # | Commit | Status | Notes |
|---|---|---|---|
| 1 | Six new action verbs in canvasActions.ts | ⬜ Pending | Start here. See PRD § 4 + § 10 |
| 2 | `core/event-bus.ts` + `duo events --follow` | ⬜ Pending | See PRD § 5 |
| 3 | `data-payload-from` form-input binding | ⬜ Pending | See PRD § 6 |
| 4 | `<meta name="duo-default-editable">` (ENH-034) | ⬜ Pending | See PRD § 7 |
| 5 | Authoring skill at `skill/canvas-authoring.md` | ⬜ Pending | See PRD § 8 |
| 6 | Five reference templates | ⬜ Pending | See PRD § 9 |

## Sprint A end-of-sprint deliverable

A hand-built test canvas at `docs/dev/smoke-walks/v0.6.0-stage-27-rev1.html`
that exercises every primitive. Smoke walk on real hardware. Any gaps
surface as Stage 27.5 follow-ups before Sprint B starts.

## Pre-flight before starting Commit 1

- [x] PRD written (`docs/prd/stage-27-canvas-authoring.md`)
- [x] Roadmap entry (`ROADMAP.md` line 184)
- [x] Roadmap card (`docs/roadmap.html#s27`)
- [ ] CLAUDE.md "Where to look" updated with PRD + this active-sprint pointer
- [ ] Read `docs/prd/stage-23-canvas-actions.md` (if exists) before touching `canvasActions.ts`
- [ ] Read `renderer/components/HtmlCanvas/canvasActions.ts` to confirm dispatcher shape
- [ ] Confirm Stage 23's `claude:spawn` / `terminal:send` / `browser:open` are in the same file (not split)

## Decisions log (additions in-flight)

(empty — additions during work get appended here with date and rationale)

## Open questions to resolve in-flight

(see PRD § 15 for Stage 27 + PRD § 9 for Stage 28)

## How to resume after compaction

1. Read this file first.
2. Read `docs/prd/stage-27-canvas-authoring.md`.
3. `git status` + `git log --oneline -10` to see what's actually committed.
4. Cross-check against the commit checklist above.
5. Continue from the next ⬜ row.
