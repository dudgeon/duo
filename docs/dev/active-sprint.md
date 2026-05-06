# Active sprint state — Sprint 8 (v0.6.8)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record (Sprint 6/7 close-out + v0.6.7 cut +
> rev6/rev7 walk results) lives in [docs/dev/session-log.md](session-log.md) —
> most recent at the top.
>
> **Update cadence:** at the end of each commit (mark a phase row
> done; flip the "next" pointer; add deviations).

---

## Sprint goal

**"Ship Duo to real users."** v0.6.7 closed the comment-system arc;
v0.6.8 is the cut that turns Duo from a personal tool into something
an early-adopter cohort can actually run cross-machine. Stage 21d
is the anchor (socket auth + agent-driven-nav notifications +
early-adopter README), with three bugs and three polish items
layered around it.

**Cut path:** v0.6.8 cuts when Stage 21d's distribution path is
walkable (a non-Geoff machine can install + run signed Duo + use
the agent loop end-to-end), the three bug fixes pass smoke, and
the polish items either ship or get formally deferred.

---

## Phase plan (path-dependency-ordered)

### Phase 0 — Quick wins (parallel-safe, can land first day)

Three small items that don't depend on the anchor. Picking these off
early unblocks any future contributor who hits them and clears the
"what about that thing?" backlog noise.

#### ENH-091 — Caret placement on freshly-created canvas

Owner ask 2026-05-04. Fresh canvas opens with the caret in the
titlebar (or nowhere); should land in the document body so the
user can start typing immediately. Touch points: PageTab mount
path, possibly the boilerplate's empty-`<p>` cursor seed.

**Acceptance:** `duo html new /tmp/foo.html` → cursor lands in the
empty paragraph below the H1. Type "x" → text appears in the
paragraph, not the heading.

#### BUG-097 — Markdown placeholder wraps narrow on first load

Visual paper cut. Empty `.md` opens with the placeholder text
"Start typing — markdown shortcuts work…" wrapping at ~3-4
characters per line. Suspected `float: left; height: 0` rule at
[globals.css:371](renderer/styles/globals.css) interacting with
some unidentified left-floated chip element. Type any character
and the placeholder disappears, so the bug is empty-state-only.

**Acceptance:** `touch /tmp/foo.md && duo edit /tmp/foo.md` → the
placeholder text renders in normal full-width prose, not a narrow
column.

#### FOLLOWUP-008 — Accent token RGB-triplet migration

Currently the `--duo-accent` CSS custom property holds a hex
literal (`#C66A2E`), which means Tailwind's opacity modifiers
(`bg-accent/30`, `bg-accent/50`) silently fail — they need the
RGB triplet form (`198 106 46`) to compose with the alpha channel.
Migrate the token to `r g b` form, update the Tailwind config,
audit existing `var(--duo-accent)` usages for any that need to
go through `rgba()` explicitly.

**Acceptance:** `bg-accent/30` actually renders at 30% opacity in
the running app (currently no-ops or falls through to no color).
Existing `bg-accent` solid uses unchanged.

### Phase 1 — FOLLOWUP-009: testing-library/react + comment-anchor regression

Priors: Stage 14a's comment-anchor reconciliation logic (excerpt +
context match on file load) has no regression coverage today
because the project's vitest config excludes React component
rendering. Per the recurring-regression feedback memory, this is
the kind of class that wants durable tests.

Steps:
1. Add `@testing-library/react` + `@testing-library/jest-dom` as
   devDeps; extend `vitest.config.ts` to include component-render
   tests in a new directory (`renderer/components/Page/__tests__/`
   or similar).
2. Write the load-bearing regression: open a file with a sidecar
   that has 3 comments at known anchor IDs, simulate iframe
   ready + sidecar resolve in both orderings (sidecar-first,
   iframe-first), assert rail mounts with all 3 threads + correct
   excerpts.
3. Add a second test for the duplicate-id-on-clone fix that
   shipped in v0.6.7: simulate the contentEditable Enter-clone
   shape (parent `<ul>` with two `<li>` sharing an id), call
   `installAutoStampIds`, assert the second `<li>` re-stamps to
   a new ULID while the first keeps its original.

**Acceptance:** `npm test` runs both regressions green; CI (when
it lands) catches a regression in either path.

### Phase 2 — Stage 21d: cohort distribution (the anchor)

**Three coordinated pieces.**

#### 2a — Socket auth model

Today the Unix socket at `~/Library/Application Support/duo/socket`
trusts any local connection. Fine for personal use; not fine when
distributing to a cohort where multiple users on a shared dev box
might inadvertently cross streams, or when an agent on machine A
is asked about machine B.

Approach (need PRD before coding):
- Generate a per-install bearer token; persist in `installed.json`.
- Socket server requires the token in a handshake message before
  routing commands.
- CLI reads the token from the same `installed.json` (CLI binary
  installed alongside the app already knows where this is).
- Cross-machine SSH-tunneled connections negotiate the token
  from `~/.duo/auth.json` on the remote side (queued, not v1).

**Open question for owner:** is v1 just per-install token (single
machine, multi-user safety) or also cross-machine (the agent on my
laptop talks to Duo on my desktop)? The cross-machine case
substantially expands scope.

#### 2b — Agent-driven-nav notifications

When the CLI navigates to a destination tab the user wasn't looking
at (e.g. `duo edit /path/foo.md` from a backgrounded terminal),
the user should see a toast / glow / banner that tells them what
the agent just did. Today the navigation is silent and surprising.

Touch points: `App.tsx` `setActiveWorking` path, possibly a
notification primitive in `renderer/components/`.

#### 2c — Early-adopter README

Plain-prose document covering: install, first-launch banner, what
to expect from the FAQ + vocabulary + enterprise-deployments
references, how to file feedback. Lives at the repo root or
`docs/EARLY-ADOPTERS.md`.

**Acceptance for the whole anchor:** a non-Geoff machine can
install signed Duo from the GitHub Release, complete first-launch,
run a `duo` command from a Claude Code session, see the agent-nav
notifications on navigation events. README points readers to the
right places when something breaks.

### Phase 3 — ENH-080: ⌘⇧A tab-search palette

Research doc landed in v0.6.5
([docs/prd/canvas-tab-search-research.md](../prd/canvas-tab-search-research.md)).
Recommended path: native child window, pre-created at boot.
Implementation queued.

The palette searches across: open file tabs (working pane), open
browser tabs (browser pane), pinned files / folders, recently
closed tabs. Filter by typing; arrow keys + Enter to switch.

**Why now:** Stage 21d puts Duo in front of users with more tabs
open than Geoff usually runs. ⌘⇧A is muscle memory from VS Code
/ Slack; not having it is a daily friction point for new users.

**Acceptance:** ⌘⇧A from anywhere opens the palette; typing
filters; Enter switches focus to the chosen tab; Esc dismisses.
Survives WCV occlusion (the whole reason for the native-child-
window approach).

### Phase 4 — BUG-093: right-click crash root-cause

Instrumentation landed in v0.6.7 (ErrorBoundary inline + label +
Try-again, `[BUG-093]` traces in `splitViewMoveTabByPath`).
Sprint 8 hunts the actual repro against the v0.6.7+ build.

Plan: open Duo dev with devtools; filter console on `[BUG-093]`
and `[ErrorBoundary:WorkingPane]`; type bullets in a fresh canvas;
add a comment on one bullet; right-click the canvas tab → Move to
Split View. If it crashes:
1. Read the last `[BUG-093]` log — names the phase that was
   running.
2. Read the `[ErrorBoundary:WorkingPane]` log — names the failing
   component.
3. Cross-reference the two; the combination usually identifies
   the bug.

**Acceptance:** clean repro recorded with logs OR a one-time fix
based on the trace. If the bug refuses to reproduce, file
FOLLOWUP-010 with a hypothesis and move on.

---

## Phase ordering rationale

Quick wins go first so they don't get crowded out. FOLLOWUP-009
goes early because Stage 14b (next sprint) will want regression
coverage for tracked-change marks too — landing the
testing-library/react infra now is leverage. Stage 21d is the
anchor and gets the bulk of the sprint's planning energy. ENH-080
slots in after the anchor because it's the kind of sprint-end
addition that ships with a smoke walk, not a separate cut. BUG-093
is opportunistic — it depends on getting a clean repro, which
means it goes wherever the trigger naturally fires.

---

## Stretch (if Phases 0–4 land before cut)

- **Stage 14b** — track changes (CriticMarkup insertion / deletion
  / substitution / highlight marks). Big; probably its own sprint.
- **Stage 21b** — DMG background image. Cosmetic; no installer
  blocker.
- **BUG-079** — ⌃⇧\` cycle multi-second latency. Recurring class.
- **ENH-084** — aux pane focus glow. Three v0.6.5 attempts
  failed; needs fresh design before retry.

---

## Cross-reference index

| File | Purpose |
|---|---|
| [tasks.md § Stage 21d](../../tasks.md) | Cohort distribution scoping (still needs a PRD page) |
| [tasks.md § BUG-093](../../tasks.md) | Right-click crash, instrumented |
| [tasks.md § BUG-097](../../tasks.md) | Markdown placeholder wrap |
| [tasks.md § FOLLOWUP-008](../../tasks.md) | Accent RGB-triplet migration |
| [tasks.md § FOLLOWUP-009](../../tasks.md) | testing-library/react infra |
| [tasks.md § ENH-080](../../tasks.md) | ⌘⇧A tab-search palette |
| [tasks.md § ENH-091](../../tasks.md) | Caret on fresh canvas |
| [docs/prd/canvas-tab-search-research.md](../prd/canvas-tab-search-research.md) | ENH-080 architecture options |
| [docs/dev/cert-procurement.md](cert-procurement.md) | Stage 21 cert tracker |
| [README.md](../../README.md) | Where the early-adopter section will land |
