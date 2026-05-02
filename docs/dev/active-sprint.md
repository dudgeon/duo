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

**Active sprint:** Sprint B — Stage 18b (distro skill packs).
**Active commit:** Sprint B Commit 1 (PACK.json schema + format spec).
**Branch:** `main` (all work on main; no worktree).
**Status:** Sprint A complete. Six commits (c11d999 → 11d484c).
Smoke-walk page authored at
`docs/dev/smoke-walks/v0.6.0-stage-27-rev1.html` (gitignored). The
autonomous walk attempt was **blocked-on-visual-walk** — dev-app
restart left the BrowserWindow not visible to computer-use after
the prior orphaned Electron got cleaned up. CLI surface verified
(events command recognized, ring empty, snapshot mode parses); UI
verbs need a human walker before any cut. Walk + manifest stay in
`docs/dev/smoke-walks/` for that pickup.

## Sprint B — Stage 18b plan

| # | Commit | Files |
|---|---|---|
| 1 | `PACK.json` schema spec — `name`, `version`, `defaults[]` (FTUX tabs), `pins[]` (pre-pinned navigator entries), `extra-skills/` directory convention | `docs/prd/stage-18b-distro-packs.md` (NEW), `shared/types.ts` (PackManifest), `core/pack-loader.ts` (NEW) |
| 2 | Pack discovery + parse — scan `~/.claude/duo/packs/<name>/PACK.json`; build registry | `core/pack-loader.ts`, `electron/main.ts` (wire into install hooks), `~/.claude/duo/installed-packs.json` provenance |
| 3 | First-launch defaults hook — open each `defaults[].path` as a tab on first boot per pack; never re-open if user closed | `electron/main.ts`, `core/session-state-service.ts` (per-pack first-launch flag), `electron/install-service.ts` |
| 4 | Pack install via `cp -r` — manual install for v1 (Stage 18b proper machinery deferred); document at `docs/prd/stage-18b-distro-packs.md § Install` | docs only |
| 5 | Smoke-walk for Stage 18b primitives (FTUX defaults open, dismiss persists, pack registry visible to `duo` CLI) | `docs/dev/smoke-walks/v0.6.0-stage-18b-rev1.{html,json}` |

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
