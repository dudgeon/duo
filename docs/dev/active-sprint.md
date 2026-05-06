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

**Reframed 2026-05-06** after AUQ session post-v0.6.7 cut. Original
21d (socket auth + agent-driven-nav notifications + early-adopter
README) was scoped before Stage 27/28 introduced playgrounds + lesson
packs + canvas-action runtime. New framing: **distro packs as
plugin-loaded customization on the canonical signed DMG.**

**Full PRD: [docs/prd/stage-21d-distro-packs.md](../prd/stage-21d-distro-packs.md).**

**Owner-locked decisions** (from AUQ rounds 1+2+3+4):
- All three personas (corporate IT / education / OSS community);
  no rebrand required ⇒ plugin pack is primary path, recompile
  fork is optional.
- Distros pin to specific Duo versions; test + republish manually.
- Strictly additive — no overrides of Duo's bundled content.
- Install = consent; no pack-signature requirement.
- `requiresDuoVersion` is a hard block (refuse to install on
  unsupported Duo).
- Project-level CLAUDE.md injection: out of scope (user-level only).
- Pack lifecycle: atomic replace (wipe old version's tracked files,
  install new).
- **Source format = Claude Code plugin format** (round 4): pack
  authors against the canonical plugin layout
  (`.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` +
  `agents/<name>.md`) plus a `duo-extras/` subfolder for
  Duo-specific content (canvases, playgrounds, FTUX manifest, etc.).
- **Install destinations = standalone skills** with `<distro>-`
  prefix added at install time (`~/.claude/skills/<distro>-<name>/`,
  `~/.claude/agents/<distro>-<name>.md`). Auto-discovered by
  Claude Code in every session; model-invokable by default off the
  skill's `description` frontmatter. v2 evolution path: convert
  same source format to plugin-install for `/<distro>:<skill>`
  namespacing once Duo can drive Claude Code's plugin manager.

**Three distribution paths (mutually compatible):**

1. **`.pkg` installer** — distro bundles canonical `Duo.app` +
   their pack + postinstall script; signed with distro's cert
   (Duo.app inside keeps upstream signature). Mass-deployable via
   Jamf / Munki.
2. **Drop-in folder** — pack zip published as download / git repo;
   user/IT places at `~/.claude/duo/extra-packs/<distro-name>/`.
   Auto-discovered.
3. **Fork + compile** — distro maintains a fork with their pack
   pre-baked into `bundled-distro/<name>/`; users clone + `npm run
   dist` get an unsigned DMG with pack bundled. Early-adopter path
   for companies pre-DMG-approval.

**Sub-stages (21d-i through 21d-iv in the PRD):**

#### 21d-i — Distro pack discovery + install pipeline (load-bearing)

- Auto-discover packs at `~/.claude/duo/extra-packs/` on launch +
  bundled-distros at `Duo.app/Contents/Resources/bundled-distros/`.
- DISTRO.json schema + validator.
- `requiresDuoVersion` hard-block enforcement.
- Atomic-replace install: provenance manifest tracks every file
  Duo creates per pack; uninstall + reinstall on version change.
- Multi-distro CLAUDE.md merge: extends ENH-088 to support
  multiple `<!-- distro:<name>-managed-vX.Y.Z -->` blocks
  alongside Duo's own.
- FTUX re-fire: when a new pack is detected (post-original-FTUX),
  open `openOnFirstLaunch[]` canvases on next launch.

#### 21d-ii — Pack-builder skill (the canonical spec)

- New skill at `skill/pack-builder.md` shipping with default Duo
  via `npm run sync:claude`.
- Capabilities: scaffold / validate / build-zip / build-pkg /
  build-bundled-fork / bump-version.
- Schema reference at `skill/references/distro-v1-schema.json`.
- Distros use this skill to author + maintain their packs.

#### 21d-iii — CLI surface

- `duo pack list` — installed distro packs (name, version, install date).
- `duo pack uninstall <distro-name>` — atomic uninstall via
  provenance manifest.
- (`duo pack install <url>` deferred to FOLLOWUP-010 per AUQ.)

#### 21d-iv — Sample distro + early-adopter README

- `examples/distro-pack-template/` — working copy-and-customize
  starting point.
- HOW-TO-FORK.md gains "Layer 2.5 — distro packs" between Layer 2
  (drop-in) and Layer 3 (build-time partial fork).
- README early-adopter section: distribution paths, when to
  choose each, pack-builder skill, Duo upgrade handling.

**Original 21d goals: deferred to follow-ups.**
- Cross-machine socket auth → FOLLOWUP-011 (revisit when real
  cross-machine demand surfaces; local multi-user safety addressable
  via socket file permissions).
- Agent-driven-nav notifications → FOLLOWUP-012 (not distro-specific;
  rides along in 21d-iv if useful for the early-adopter cohort).

**Acceptance for the whole anchor:** A distro builder can run the
pack-builder skill to scaffold a pack containing a skill + a
playground + a welcome canvas + a CLAUDE.md snippet, build a `.pkg`,
ship it to a non-Geoff machine, observe: pack installs on next Duo
launch, FTUX fires opening the welcome canvas, the CLAUDE.md block
appears in the user's `~/.claude/CLAUDE.md`, the skill is reachable
from a Claude Code session under `~/.claude/skills/<distro>/`, and
`duo pack list` reports the install. Re-running the install with a
new pack version atomic-replaces. `duo pack uninstall <distro>`
cleanly removes everything.

### Phase 3a — ENH-096: Obsidian-vault-friendly editor

**Added 2026-05-06** after research pass on what would work / break if a user opened their Obsidian vault in Duo. Full research doc at [docs/prd/obsidian-vault-research.md](../prd/obsidian-vault-research.md); concise PRD body in [tasks.md § ENH-096](../../tasks.md).

**Why now:** Obsidian is the most-deployed personal-knowledge-management tool in Duo's audience adjacency. The Stage 11 + Sprint 6 work already gives us a sound markdown round-trip foundation (frontmatter pass-through, external-write reconciliation, dotfile-hidden navigator). What's missing is the visual + invocation layer — wikilinks rendered as text, no vault-wide quick switcher, sidecars without user-facing docs. ENH-096 closes the gap with one focused enhancement that pairs with already-in-sprint items (ENH-080 + FOLLOWUP-009).

**Scope:**
- **Tier A defensive baseline (XS, all four):**
  - A1: faq.html + what-duo-does.html doc explaining `<note>.md.duo.json` sidecar convention; recommend `*.duo.json` in `.gitignore` for git-tracked vaults.
  - A3: vitest fixtures for Obsidian-style YAML round-trip (folds into FOLLOWUP-009).
  - A4: `.obsidian/` ignore rule on Duo's file watcher (separate from navigator hide).
  - A5: smoke-walk verification that `[[…]]` round-trips through tiptap-markdown cleanly.
- **Tier B distinctive features (M each, share a fuzzy-palette base):**
  - B1: wikilink rendering as Atelier-styled clickable spans; `cmd+click` opens linked file.
  - B2: wikilink autocomplete on `[[` (fuzzy vault note search; Tab/Enter insert).
  - B4: `⌘O` vault quick switcher (fuzzy file search across vault; distinct from ENH-080 tab search).

**Pairs with:**
- ENH-080 (tab-search palette): same fuzzy-palette primitive; B2 + B4 reuse the base.
- FOLLOWUP-009 (testing-library/react infra): A3 fixtures land in the new test directory.
- Stage 21d (distro packs): future "obsidian-companion" distro pack ships Obsidian-tuned skills + templates after the editor affordances land.

**Deferred to Sprint 9+:** B3 inline tag rendering, B5 full-text vault search panel, all of Tier C (backlinks panel, outline panel, daily notes shortcut, callout extension, math/mermaid rendering, frontmatter properties panel — Stage 11 D15). Tier D (graph view, `.canvas` files, reading mode, embed rendering, block references, plugin/theme compatibility) is indefinitely deferred.

**Open questions to settle before coding** (from research doc § Open questions):
1. Vault root detection algorithm (walk up to `.obsidian/` vs. navigator CWD vs. persisted mark).
2. Wikilink resolution semantics (Obsidian's name-first vault-wide vs. Duo's relative-path).
3. Sidecar location for vaults (same-folder vs. centralized in `.obsidian/duo-comments/`).
4. Hotkey conflict policy (`⌘O`: Obsidian quick-switcher vs. Duo's existing chord).

**Acceptance:** the 8-point checklist in [tasks.md § ENH-096](../../tasks.md).

### Phase 3b — ENH-080: ⌘⇧A tab-search palette

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
