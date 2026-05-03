# Active sprint state — Sprint 4 (v0.6.4 → v0.6.5 cut)

> **What this file is.** Running scratchpad for the active sprint
> arc. The historical record (Sprint 3 walk results, v0.6.4
> chapter shape, worksheet primitive spike) lives in
> [docs/dev/session-log.md](session-log.md) — most recent at the
> top. The sprint-plan worksheet that produced this plan is at
> `docs/dev/worksheets/sprint-plan-v0.6.5.{json,html}`.
>
> **For future Claude instances:** if you're picking up after a
> compaction, READ THIS FILE FIRST. It points at the plan, the
> walk results, and the owner's clustering instructions. The plan
> below is path-dependency-ordered — start at Phase 1.
>
> **Update cadence:** at the end of each commit (mark a phase row
> done; flip the "next" pointer; add deviations).

---

## Sprint goal

**Polish + close-out.** Three partially-shipped surfaces close in
this sprint (navigator prominence, Split View Phase 3, smoke-walk →
worksheet ecosystem) and the small bug backlog clears. No major new
features; no architectural decisions pending. The deliverable is a
**v0.6.5 cut** that resolves the two v0.6.4 cut blockers
(ENH-078/BUG-074 light-mode contrast; BUG-075 chord regression as a
P2 bonus or carry-over) plus a clean polish pass.

**Cut path:** v0.6.4 was never released. This sprint's work cuts as
v0.6.5 directly. Package.json bumps to `0.6.5` at cut time per
`cut-version § Step 7`.

---

## Phase plan (ordered for path-dependency + clustering)

### Phase 1 — Foundation refactor · ENH-052

**Single self-contained commit BEFORE any UI work.** Every other
phase touches identifiers about to be renamed; doing this first
prevents conflicts.

- **ENH-052** (owner P1, sprint P0-sequenced) — Mechanical canvas →
  page/playground rename of internal identifiers. `WorkingTab.kind ===
  'html-canvas'` → `'page'`; `CanvasTab` component → `PageTab` (or
  similar); CSS class names; type names; references in skill / agent
  docs.
  - **Editor/canvas parity:** N/A (identifier-only; no behavior delta).
  - **Scope expectation:** ~50–100 file touches; typecheck passes;
    Vitest stays green.
  - **Risk:** wide blast radius; do NOT mix with feature work in the
    same commit.

### Phase 2 — Navigator close-out · single FileTree.tsx session

Closes out the navigator-prominence work that started in v0.6.4
(ENH-078 / ENH-079). Three items, one cluster:

- **ENH-078 / BUG-074** (collapsed → P0) — Light-mode text contrast
  in selected-row treatment. `text-zinc-50` (near-white) on
  `bg-accent/30` over the cream-paper background is illegible. Fix:
  theme-aware text color in `FileTree.tsx`'s selected branch — reads
  on cream in light, on dark bg in dark.
- **ENH-086** (P1) — Visual separation between user-claude (top) and
  project-files (bottom) sections of the navigator. Likely a divider
  style change.
- **ENH-087** (P2) — "Open file" bold-text styling discoverability
  (tooltip + FAQ entry).
  - **BEFORE writing code:** generate a /tmp planning artifact at
    `/tmp/enh-087-open-file-indicator-options.html` showing 3–4
    visual options (current bold vs. dot indicator vs. small glyph
    vs. color tint vs. italics). Get the owner's pick before
    implementing. *(Owner explicit ask in the sprint walk notes.)*

### Phase 3 — Split View Phase 3 close-out · WorkingPane / aux chrome

Closes out the work queued from Sprint 3 Phase 3b/c. All touch
WorkingPane / WorkingTabStrip / aux chrome:

- **ENH-083** (P0) — Move collapse-pane buttons from titlebar to the
  new-tab clusters (terminal cluster gets terminal-collapse; canvas
  cluster gets canvas-collapse).
- **ENH-085** (P0) — Split pane title bar context-click parity. Same
  right-click verbs as the main canvas tab: Move to Trash, Reveal in
  navigator, Rename, Copy path, Move back to main.
- **ENH-084** (P1) — Aux pane focus indicator parity. Orange glow
  when active; matches main pane's accent treatment.
- **BUG-075** (P2 bonus) — Phase 3b ⌘\\ + ⌘⇧\\ chord regression.
  Likely a callback ref dropped in commit `511d8b8`'s
  `splitViewClose → splitViewPromote` rename. Cheap restoration if it
  surfaces during Phase 3 work; carry over to v0.6.6 P2 if it
  doesn't.

### Phase 4 — Tab cycling / focus fix · BUG-076

- **BUG-076** (P1) — `⌃⇧\`` tab-cycle doesn't reach faq.html after
  `duo open` switches focus to a new browser tab. Adjacent to
  ENH-036 (the duo-open-into-view fix that landed in v0.6.4); same
  cycle code in `cycleNext` / the keyboard registry.

### Phase 5 — Markdown trigger family · single commit

All in `markdownShortcuts.ts` / canvas trigger detection:

- **BUG-061** (P1) + **BUG-073** (P2) — Combined: bullet rendering
  refinement. Detect the trigger source character (`-` vs. `*` vs.
  `+`) and pass it through to `list-style` so `-` produces a dashed
  marker, not the default round bullet.
- **BUG-072** (P2) — Blockquote double-Enter exit. Parity with
  bullet/ordered-list exit gesture (the `ListIndentShortcuts`
  family).

### Phase 6 — Worksheet ecosystem alignment

- **ENH-043** (P1) — Smoke-walk skill re-buildable via canvas /
  template primitives.
  - **Owner note quoted:** *"I thought you already finished this;
    when you take it on, please consider the new form primitives
    you just built and ensure we're working from a single, cohesive
    toolset."*
  - **Action:** scope-clarification first. The new worksheet
    primitive (`.claude/skills/worksheet/`) DOES factor out the
    rendering — but it's still a JS-driven Node generator, not a
    canvas-template. Decide: (a) is the worksheet primitive
    sufficient (mark ENH-043 done with scope evolution), or (b)
    does the worksheet primitive need a canvas-template wrapper
    too. Generate a tiny worksheet to gather owner's preference if
    needed.
- **ENH-080** (P1) — `⌘⇧A` search open tabs (working pane + browser
  tab strip). Same UI primitives as the chord registry; pairs with
  ENH-043 in keyboard surface area.
- **ENH-075** (P1) — Canvas glyph alternative options (collapse rail
  + canvas-tab type icon). Same chrome polish surface as Phase 3.

### Phase 7 — Validation + measurement

- **FOLLOWUP-004** (P1) — Visual smoke of Stage 5 v2 + Stage 15.1
  (CLI half + pill UI) via computer-use. Owner-side computer-use
  approval needed; deferred from prior session.
- **FOLLOWUP-003** (P2) — Re-measure Class B perf with
  cumulative-context methodology.

---

## Stretch (if Phases 1–7 land before cut)

- **ENH-077** (P2) — System dialog icon production verification.
  Needs DMG build cycle.
- **ENH-047** (P2) — `duo events` listener auto-spawn for smoke walks.
- **ENH-048** (P2) — Smoke walk V14 instructions clarity.

---

## Skipped this sprint (carry-over to v0.6.6)

- **ENH-027** — Local HTML defaults to canvas, not browser
  (`<meta name="duo-open-in">` opt-out). Owner asked for a planning
  surface. **Action this sprint:** generate a worksheet at
  `docs/dev/worksheets/enh-027-routing-options.{json,html}` that
  surfaces the design questions (default behavior, per-page opt-out
  via meta, agent-driven preference, owner override) and gathers
  owner preferences. Result feeds v0.6.6 sprint planning. Five
  minutes of agent work to set up.
- **ENH-082** — Terminal Context Bar. Needs scope/PRD before code.
  Carry to v0.6.6+.
- **FOLLOWUP-002** — Harden agents/duo.md session guard against
  Bash-allowlist denial. **Owner asked for education** — see the
  callout below.
- **FOLLOWUP-006** — Autosave delay test knob. Already SKIP'd by
  owner; unblocks Phase 3c-iii smoke testing if/when we revisit
  dirty-replace.

---

## Education callout — FOLLOWUP-002 isn't security, it's robustness

Owner walk note: *"I don't understand this one; is this the concern
that arbitrary clients could use duo cli? I don't think this is a
big concern, but you may just need to educate me on some of the
scary use cases/possible attacks."*

**There's no scary attack vector here.** The session guard at the
top of `agents/duo.md` runs:

```bash
[ -n "$DUO_SESSION" ] && echo in_duo
```

The agent checks the result before doing any duo work. The concern
in FOLLOWUP-002 is what happens when **Claude Code's Bash tool
denies that command** because the user's allowlist is restrictive.
Two ways the agent can mishandle the denial:

1. **No answer treated as "not in Duo"** — the agent declines a job
   it could have done.
2. **No answer treated as "in Duo"** — the agent attempts duo
   commands that fail with `ECONNREFUSED`.

Hardening means: detect the "Bash tool denied" failure shape
specifically and surface it (*"can't tell if I'm in Duo because
Bash denied the env-var check"*) rather than silently picking one
interpretation. Low-priority polish — only matters if a user has an
unusual allowlist that blocks the env-var check. Defer indefinitely
unless someone actually hits this; close as won't-do if it never
surfaces.

Cross-machine duo CLI access (the "arbitrary clients" framing the
owner asked about) is a separate concern, tracked under Stage 21d
(socket auth). Not this item.

---

## Cut readiness gate for v0.6.5

After Phases 1–7 land:

1. **BUG-074 / ENH-078 resolved** (Phase 2; cut-blocker from
   v0.6.4).
2. **BUG-075** resolved as Phase 3 bonus, OR explicitly carried
   over to v0.6.6 P2 with a note that right-click + CLI Split View
   paths still work — chord is degraded but the feature is usable.
3. **No new regressions** introduced this sprint (smoke walk
   catches them).
4. **Vitest** suite passes (currently 41 tests; expect more after
   ENH-052 + Phase 5).
5. **package.json** bumps to `0.6.5`.
6. Cut via `cut-version` skill.

If Phase 7 (FOLLOWUP-004 / FOLLOWUP-003) doesn't land, that's fine —
they're validation/measurement, not cut blockers.

---

## Worksheet-driven planning artifacts owed this sprint

Three planning surfaces that the owner asked for in walk notes,
generated as worksheets so they round-trip cleanly:

1. **`/tmp/enh-087-open-file-indicator-options.html`** — Phase 2,
   before implementing ENH-087. Visual options for the open-file
   indicator (current bold vs. alternatives). Worksheet manifest;
   owner picks one option.
2. **`docs/dev/worksheets/enh-027-routing-options.{json,html}`** —
   independent of phases (skip-tier item). Gathers owner preferences
   on local HTML default routing. Feeds v0.6.6 sprint planning.
3. **`docs/dev/worksheets/enh-043-scope.{json,html}`** — Phase 6,
   if scope is unclear. Asks owner whether the worksheet primitive
   subsumes ENH-043 or whether a canvas-template wrapper is also
   wanted.

---

## How to resume after compaction

1. **Read this file FIRST.** Phase 1 is the next action — ENH-052
   mechanical rename, single commit, before any other UI work.
2. **Check `git log --oneline -10`** — confirm where we are in the
   phase sequence.
3. **Check `docs/dev/worksheets/sprint-plan-v0.6.5.html`** — the
   walked priorities are the source of truth.
4. **If a phase is mid-flight,** check this file's "Phase plan" rows
   for status flips and the latest commit's message for what just
   landed.

---

## Cross-reference index

| File | Purpose |
|---|---|
| [docs/dev/worksheets/sprint-plan-v0.6.5.html](worksheets/sprint-plan-v0.6.5.html) | The walked sprint plan (source of priority decisions) |
| [docs/dev/session-log.md](session-log.md) § 2026-05-03 (evening) | v0.6.4 walk results + worksheet spike + this sprint planning recap |
| [.claude/skills/worksheet/SKILL.md](../../.claude/skills/worksheet/SKILL.md) | Worksheet primitive (built this session; powers smoke-walk + sprint-plan) |
| [.claude/skills/sprint-plan/SKILL.md](../../.claude/skills/sprint-plan/SKILL.md) | Sprint planning workflow (built this session) |
| [tasks.md § FOLLOWUP-007](../../tasks.md) | Send-to-Claude binding plumbing (parallel to `duoOpenPath`); not blocking this sprint |
| [tasks.md § ENH-052](../../tasks.md) | Mechanical canvas → page rename (Phase 1 source-of-truth) |
| [tasks.md § ENH-078 / BUG-074](../../tasks.md) | Light-mode contrast (Phase 2 source-of-truth) |
| [tasks.md § ENH-083 / ENH-084 / ENH-085](../../tasks.md) | Phase 3 source-of-truth |
| [docs/DECISIONS.md § Editor / canvas convergence](../DECISIONS.md) | Phase 2 ADR (Path A — mirror) — applies to any editor/canvas work this sprint |
| [CLAUDE.md § Plumbing checklists](../../CLAUDE.md) | Mandatory plumbing rules; ENH-052 will touch many |
