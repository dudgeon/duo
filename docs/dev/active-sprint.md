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

### Phase 1 — Foundation refactor · ENH-052 · ✅ DONE

**Single self-contained commit BEFORE any UI work.** Every other
phase touches identifiers about to be renamed; doing this first
prevents conflicts.

- **ENH-052** ✅ **Shipped** — Mechanical canvas → page/playground
  rename of internal identifiers. 177 edits across 32 files in one
  commit. `WorkingTab.kind === 'page'`; `PageTab` component;
  `playgroundActions.ts`/`PlaygroundAction` for action runtime; IPC
  channels `'page:*'`; CLAUDE.md glossary updated; active-surface
  skill/agent docs updated.
  - **Editor/canvas parity:** N/A (identifier-only; no behavior delta).
  - **Verification:** typecheck clean, Vitest 104/104 pass, production
    build succeeds.
  - **Deferred (separate follow-up):** `skill/examples/canvas-*` rename
    + pack `canvases/` subdir rename — both external API surfaces with
    backwards-compat implications. Tracked in tasks.md ENH-052 entry.

### Phase 2 — Navigator close-out · ✅ DONE

Closes out the navigator-prominence work that started in v0.6.4
(ENH-078 / ENH-079).

- **ENH-078 / BUG-074** (collapsed → P0) ✅ **Shipped** — `FileTree.tsx`
  selected branch swapped `text-zinc-50` → `text-ink` (theme-aware).
  Dark text on cream paper in light mode; light text on dark surface
  in dark mode. Background fill `bg-accent/30 font-medium` unchanged.
- **ENH-086** (P1) ✅ **Shipped (direction pivot)** — Owner walk
  flagged the original "stronger separation of stacked panes" as
  insufficient and asked for a layout reorder: move "Your Claude
  settings" to the BOTTOM of the navigator (with pinned files above
  it). Implemented: `FilesPane.tsx` reorders UserClaudePane to render
  after PinnedNav; `UserClaudePane.tsx` flips `border-b-2` →
  `border-t-2` so the divider sits above the pane. Surface tint
  `bg-paper-edge` retained.
- **ENH-087** (P2) ✅ **Shipped** — Owner picked OPT-B (small
  filled-dot glyph) from the planning worksheet. Implementation:
  `FileTree.tsx` renders a 6px `bg-ink-mute` dot inline with the
  filename for open-but-not-active rows; active-file dot still wins
  priority (single accent dot, no double glyph).

### Phase 3 — Split View Phase 3 close-out · ✅ DONE (incl. BUG-075 bonus)

All four items closed in this phase. Touched: `App.tsx`, `TabBar.tsx`,
`WorkingPane.tsx`, `WorkingTabStrip.tsx`, `globalShortcuts.ts` (+ new
regression test file).

- **ENH-083** (P0) ✅ **Shipped** — Collapse-terminal button moved to
  TabBar's new-tab cluster; collapse-canvas to WorkingTabStrip's.
  Titlebar now holds version badge / Claude presence / theme toggle
  only.
- **ENH-085** (P0) ✅ **Shipped** — AuxHeader gains right-click menu
  with: Reveal in navigator / Rename / Copy path / Move back to
  main / Move to Trash. Same NSMenu-via-IPC pattern as
  WorkingTabStrip (ENH-050). Trash uses system-sheet confirm; on
  confirm, runs `files.trash(path)` + `setAuxState(null)`.
- **ENH-084** (P1) ✅ **Shipped** — `WorkingPane` tracks
  `focusedSubpane: 'main' | 'aux'` via `onMouseDownCapture` on each
  column wrapper. AuxHeader renders the same `bg-accent-soft
  border-accent` treatment as the main strip when subpane focus is
  on it. State resets to 'main' when aux closes.
- **BUG-075** (P2 bonus) ✅ **Fixed (after re-pick)** — TWO root
  causes: (1) the matcher used `e.key === '\\'` instead of
  `e.code === 'Backslash'`, breaking the shifted form; (2) 1Password's
  system-level Cmd+\ autofill grab intercepted the chord before
  Duo saw it (most macOS users have this). Owner re-picked the
  chord: **⌘/ open + ⌘⇧/ promote**. Both forwarder
  (`browser-manager.ts`) and matcher (`globalShortcuts.ts`) now use
  `e.code === 'Slash'`. 6 regression tests in
  `renderer/keyboard/globalShortcuts.test.ts` (added a negative
  test for the old ⌘\ chord).
- **ENH-084** (P1) 🔴 **DEFECT — deferred to v0.6.6 Sprint 5.** Three
  attempts in Sprint 4 all failed (mousedownCapture missed iframe
  clicks; gate-removal sacrificed exclusivity; focusin listener
  didn't reach iframe focus events as expected). See tasks.md
  § ENH-084 for the full attempt history + hypotheses for v4. Owner
  direction: log + move on; instrument event sources before
  designing v4.

### Phase 4 — Tab cycling / focus fix · ✅ DONE

- **BUG-076** (P1) ✅ **Fixed** — Root cause was *not* in `cycleNext`
  / the keyboard registry but in `BrowserManager.switchTab()`: it
  activated the new view's bounds but didn't call `webContents.focus()`
  on it, so OS focus stayed on the previous (now-shrunk-to-1×1) view.
  Other switchTab call sites (addTab / openExisting) had been calling
  focus manually after; the bare API path used by the renderer cycle
  didn't. Fix: centralized the focus call inside `switchTab`
  (`electron/browser-manager.ts`). Every callee — renderer cycle, CLI
  tab verb, click-to-switch, openOrFocus — now gets correct OS focus
  transfer for free.

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

**Sprint state (as of 2026-05-04, post Phase 4 chord verify):**
Phases 1, 2, 3, 4 are ✅ DONE. **Phase 5 is the next action.** Three
items remain in the v0.6.5 plan (Phase 5, 6, 7) plus the cut-readiness
gate. ENH-084 was deferred to v0.6.6 with a full defect log in
tasks.md.

**Resume recipe:**
1. **Read this file FIRST.** Walk down the Phase plan; the next
   `in_progress` row is the entry point.
2. **`git log --oneline -15`** — confirm the most recent commit. If
   the head is `d063b47` (chord re-pick) or later, Phase 1–4 + the
   chord re-pick are committed and the next move is Phase 5.
3. **Phase 5 = markdown trigger family.** Three items, all in
   `markdownShortcuts.ts` / canvas trigger detection: BUG-061 +
   BUG-073 (combined — bullet-marker passthrough), BUG-072 (blockquote
   double-Enter exit). Single commit; tests in
   `Page/markdownShortcuts.test.ts` should be extended.
4. **Reload Duo before any smoke walk** — main-process changes from
   Phase 4 + the chord re-pick require Electron restart, NOT just
   renderer HMR. (Memory entry: `feedback_main_process_changes_need_restart`.)
5. **Open worksheets in the browser pane** via `duo open <path>` so
   they're focused. Don't leave stale ones up — generate a fresh
   worksheet for each verification round.

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
