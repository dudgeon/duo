# Dogfooding the distro-packs pattern for Duo's own defaults

> **Tracked as:** [ENH-134](../../tasks.md) — open / planning. Surfaces
> in every smoke walk until owner closes it (per the "research reports
> must file a tracked review task" rule).
>
> **Filed:** 2026-05-10. **Author:** post-v0.6.12 cleanup conversation.
> **Owner:** Geoff. **Status:** awaiting option pick + AUQ answers.

## Context

The repo cleanup pass (Sprint 15 commits `ce74481`, `32eab90`, `e4ff756`)
surfaced an unanswered question:

> *"I am not clear what markdowns ship with the actual packaged app,
> which load as pinned in FTUX, etc. We built a `packs` pattern for
> future enterprise devs to change this type of content (plus default
> skills, etc). Propose options for how to refactor the main app distro
> to eat our own dogfood and use the packs pattern to manage the apps
> own default distro for docs, skills, agents."*

This doc inventories the current ship-with-app + install-on-launch
pipeline, contrasts it with the existing "distro pack" pattern that
enterprise teams use to ship their own defaults, and proposes four
options for unifying the two — ranked by scope.

---

## Current state

### What lives in the repo

Three top-level directories carry the "default distro" content:

| Dir | Content | Where it goes after install |
|---|---|---|
| `skill/` | `SKILL.md` + agent-facing references (make-page.md, make-playground.md, examples/, references/) + `priming.md` + `pack-builder/SKILL.md` | `~/.claude/skills/duo/` + `~/.claude/skills/pack-builder/` + `~/.claude/duo/priming.md` |
| `agents/duo.md` | The Duo subagent (Haiku-driven CLI orchestrator) | `~/.claude/agents/duo.md` |
| `help/` | `faq.html`, `what-duo-does.html`, `canvas-actions-demo.html` | `~/.claude/duo/help/` |
| `packs/` | Two lesson packs: `intro-to-duo/`, `claude-code-basics/` (each with `PACK.json` + `canvases/*.html` + `lesson-skill/SKILL.md`) | `~/.claude/duo/packs/<name>/` |

### What ships inside the packaged `.app` bundle

`electron-builder.yml`:

- `files:` — `out/**/*` (compiled main + renderer), `package.json`,
  `help/**/*`, `node_modules/**/*` (production deps for `node-pty`,
  `chokidar`, `electron-updater`).
- `extraResources:` — `skill/`, `cli/`, `agents/`.

So inside the packaged `Duo.app`:
- `Duo.app/Contents/Resources/skill/` (extraResource)
- `Duo.app/Contents/Resources/cli/` (extraResource)
- `Duo.app/Contents/Resources/agents/` (extraResource)
- `Duo.app/Contents/Resources/app.asar/help/` (asar-packed via `files`)
- `Duo.app/Contents/Resources/app.asar/packs/`
  ([electron-builder.yml](../../electron-builder.yml) DOES NOT list
  `packs/` explicitly, but `app.asar` includes it transitively via the
  `files` glob's "everything not excluded" default; the install service
  reads it from `app.getAppPath()/packs/`)

### What the install service does on first launch

The install banner in the renderer triggers
[electron/install-service.ts § run()](../../electron/install-service.ts).
That function — which is **1331 lines and entirely hand-rolled** —
performs the following operations:

| # | Operation | Source | Destination | Idempotent? |
|---|---|---|---|---|
| 1 | Copy bundled skill | `<app>/skill/` | `~/.claude/skills/duo/` | Yes (atomic-replace, preserves user-edited files via SHA compare) |
| 2 | Copy pack-builder skill | `<app>/skill/pack-builder/` | `~/.claude/skills/pack-builder/` | Yes |
| 3 | Copy subagent | `<app>/agents/duo.md` | `~/.claude/agents/duo.md` | Yes |
| 4 | Copy help files | `<app>/help/` | `~/.claude/duo/help/` (or symlink-in-dev) | Yes |
| 5 | Copy lesson packs | `<app>/packs/` | `~/.claude/duo/packs/` | Yes (preserves user edits) |
| 6 | Bootstrap external-domains.json | `fork.config.json § __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__` | `~/.claude/duo/external-domains.json` | Yes (additive merge) |
| 7 | Bootstrap priming.md | `<app>/skill/priming.md` | `~/.claude/duo/priming.md` | Yes (only-if-absent) |
| 8 | Bootstrap default pins.json | hardcoded JSON literal in install-service.ts:522-528 | `~/.claude/duo/pins.json` | Yes (only-if-absent — never clobbers a user's pin set) |
| 9 | Install SessionStart hook | hardcoded payload | `~/.claude/settings.json` (merged) | Yes |
| 10 | Merge managed Duo block into user CLAUDE.md | hardcoded snippet text in install-service.ts | `~/.claude/CLAUDE.md` (between distro-managed markers) | Yes (sticky `claudeMdManaged` flag) |
| 11 | Install PATH shim | hardcoded shell-script template | `~/.claude/bin/claude` | Yes |
| 12 | Install CLI binary | `<app>/cli/duo` | `~/.local/bin/duo` (symlink) | Yes |
| 13 | Write provenance | computed | `~/.claude/duo/installed.json` | Yes (refreshes every run) |

Operations 1–5 install **content**. Operations 6–13 install
**plumbing** (external integrations, OS-level wiring).

### The first-launch defaults hook (separate from install-service)

After `app.whenReady()` resolves session restore,
[electron/main.ts § 513](../../electron/main.ts) fires the first-launch
defaults hook:

- Iterate `~/.claude/duo/packs/<name>/` via `PackLoader`
- For each pack whose `<name>@<version>` flag isn't yet in
  `installed-packs.json`, dispatch `NAV_EDIT` for every default with
  `openOnFirstLaunch: true`
- Mark the pack flagged in `installed-packs.json` so subsequent boots
  stay quiet

**This means lesson packs ARE first-launch-aware via `PackLoader` +
`installed-packs.json`** (per-pack-version, not per-app-version). But
the OTHER content (skill, subagent, help, default pins, CLAUDE.md
block) doesn't have this hook — it's bootstrap-only-if-absent or
atomic-replace via the install-service.

### Default FTUX experience (what the user actually sees on first launch)

After clicking **Install** on the welcome banner, the user gets:

1. **Two pinned browser tabs** — `Duo — FAQ` (`~/.claude/duo/help/faq.html`)
   and `Duo — What Duo Does` (`~/.claude/duo/help/what-duo-does.html`).
   Bootstrapped via op #8 above.
2. **Lesson pack canvases** — `intro-to-duo/canvases/welcome.html`
   opens automatically (per `PACK.json § defaults[]`). The
   `claude-code-basics` pack does NOT auto-open; its 8 canvases are
   present on disk but only fire when the user invokes the lesson.
3. **The `duo` skill + subagent** — auto-discovered by any Claude Code
   session running anywhere on the machine (because they're at
   `~/.claude/skills/` + `~/.claude/agents/`, the canonical
   auto-discover paths).

So the answer to *"what markdowns ship with the app, which pin in FTUX"*
is: **two HTML files (faq.html, what-duo-does.html) get default-pinned**
+ **one HTML canvas (intro-to-duo/welcome.html) auto-opens** + **a
constellation of skill markdowns + an agent.md auto-discover via the
`~/.claude/` filesystem convention**.

### The two pack patterns we already have

There are TWO incompatible-looking pack schemas in the codebase
right now:

#### Pattern A — "Lesson packs" (Stage 28, v0.6.0+)

- Lives in: `packs/<name>/`
- Schema: `PACK.json` (defined in
  [shared/types.ts § PackManifest](../../shared/types.ts))
- Fields: `schemaVersion: 1`, `name`, `version`, `title`, `description`,
  `defaults[]` (auto-open canvases), `navPins[]` (v1 stub, not
  enforced)
- Loader: [core/pack-loader.ts](../../core/pack-loader.ts)
- Used by: the two built-in lesson packs (`intro-to-duo`,
  `claude-code-basics`)
- Built-in only — no external-author pipeline today; the lesson packs
  are part of the main Duo distro

#### Pattern B — "Distro packs" (Stage 21d, v0.6.8+)

- Lives in: `~/.claude/duo/extra-packs/<distro-name>/` after install
- Schema: TWO files —
  `.claude-plugin/plugin.json` (Claude Code plugin manifest: identity)
  + `duo-extras/DISTRO.json` (Duo integration manifest)
- Fields:
  - `plugin.json` — `name`, `version`, `description`, `author`,
    `homepage`
  - `DISTRO.json` — `requiresDuoVersion`, `openOnFirstLaunch[]`,
    `pinnedFiles[]`, `claudeMdSnippet`, `primingAdditions`,
    `externalDomainsAdditions`
- Pack structure:
  `skills/<skill>/SKILL.md` + `agents/<name>.md` + `duo-extras/`
- Loader / installer: [electron/distro-pack-service.ts](../../electron/distro-pack-service.ts)
  (different from `core/pack-loader.ts`)
- CLI: `duo pack list` / `duo pack uninstall <name>`
- Used by: external authors (enterprise teams, OSS communities)
  building their own Duo-flavored distros
- Authoring pipeline: `pack-builder` skill at
  [skill/pack-builder/SKILL.md](../../skill/pack-builder/SKILL.md);
  template at
  [examples/distro-pack-template/](../../examples/distro-pack-template/)

**The two schemas are semantically overlapping but mechanically
distinct.** Both have:
- A "this is who I am" identity block
- A "what version of Duo do I require" version constraint
- A "what to auto-open on first launch" list
- (Implicit in Pattern A; explicit in Pattern B) a way to ship skills
  and agents and doc snippets

But the field names, file shapes, loaders, and install pipelines are
different. The wholly-internal Pattern A's `PACK.json` predates the
external-author Pattern B's `plugin.json + DISTRO.json` by ~2 sprints,
and the duplication has been on the deferred-cleanup list since.

---

## The problem statement

**The main app's "default distro" — the docs (help/, skill/, agents/),
the FTUX-pinned tabs (default pins.json), the auto-opened lesson
(intro-to-duo), the CLAUDE.md snippet, the priming.md, the
external-domains seed — is hand-rolled in install-service.ts.**

**Enterprise teams who want to ship their own version of these same
things follow a wholly different pattern (DISTRO.json + plugin.json +
distro-pack-service).**

So Duo dogfooding its own pack pattern means EITHER (a) refactoring
the install service to consume the distro-pack schema for its own
defaults, or (b) keeping the two pipelines but making the Duo
defaults expressible AS a distro pack so authors have a copyable
reference, or (c) unifying just the schemas without changing pipelines,
or (d) some combination.

The cost-benefit changes a lot depending on how much of the install
service we want to subsume into the pack abstraction. Operations 1–5
(content) are obvious candidates. Operations 6–13 (plumbing) are
trickier — some are pack-expressible (CLAUDE.md snippet, external-
domains additions), others probably should stay hand-rolled (PATH
shim, SessionStart hook, CLI binary symlink, provenance file).

---

## Options

### Option A — Full dogfooding (the most ambitious)

**Convert Duo's defaults into a built-in distro pack consumed by the
same `distro-pack-service` enterprise packs use.**

- Create `packs/duo-default-distro/` (or rename `packs/` → `packs/lessons/`
  and create a sibling `packs/distro/duo-default/` for clarity)
- Inside it, mirror the Stage 21d shape:
  - `.claude-plugin/plugin.json` (`{ name: 'duo-default', version: <duo-version> }`)
  - `duo-extras/DISTRO.json` (carries `claudeMdSnippet`,
    `openOnFirstLaunch`, `pinnedFiles`, etc.)
  - `skills/duo/SKILL.md` + `skills/duo/...` (the existing skill/)
  - `skills/pack-builder/SKILL.md`
  - `agents/duo.md`
- Bundle the lesson packs (`intro-to-duo`, `claude-code-basics`) as
  ALSO consuming the distro-pack schema, deprecating PACK.json
  (Pattern A) entirely
- Refactor `install-service.ts § run()` to call `distroPackService`
  for the bundled distro pack first, then run only the
  irreducibly-hand-rolled plumbing (PATH shim, SessionStart hook, CLI
  symlink, provenance, default pins — though even default pins could
  move into DISTRO.json's `pinnedFiles[]`)
- Net result: install-service shrinks from ~1331 lines to maybe ~400.
  Pack authors see Duo's actual default distro as the canonical
  example.

**Pros:**
- One install pipeline. Bug fixes / feature adds happen once.
- Pack authors see Duo's defaults as their reference template — true
  dogfooding.
- Forks editing one config (`fork.config.json` → DISTRO.json) instead
  of patching install-service.ts.
- Schema unification (kills the PACK.json vs DISTRO.json duplication).

**Cons:**
- Big refactor. ~1331 lines of install-service to reshape.
- Need to encode currently-hardcoded behaviors into the DISTRO.json
  schema (or into a "built-in extensions" concept):
  - CLAUDE.md merge with managed markers (sort of supported via
    `claudeMdSnippet: true`, but the `installShim` PATH override is
    NOT pack-expressible)
  - SessionStart hook (definitely not pack-expressible — sensitive
    OS-level wiring)
  - PATH shim install (not pack-expressible)
  - CLI binary symlink to `~/.local/bin/duo` (not pack-expressible)
  - Provenance file (subsumes naturally — `installed-packs.json`
    already does per-pack tracking)
- Stage 21d's `distro-pack-service` was designed for SECONDARY packs
  (added on top of a working Duo). Making it ALSO the primary install
  path raises edge cases:
  - What if the bundled pack is missing? (currently impossible; Duo
    always has it)
  - Version-mismatch handling — `requiresDuoVersion >=0.6.7` — what
    does it mean for the default pack to "require" a version it
    inherits from?
  - Re-install-on-upgrade semantics for built-in vs external
- Risk of regressions during the refactor; touches the Stage 18
  load-bearing first-launch flow.

**Effort estimate:** ~3-5 days (medium-large refactor).

### Option B — Documentary mirror (the cheapest)

**Keep the main install hardcoded. Publish Duo's defaults AS a
distro-pack-shaped folder in `examples/` for reference only.**

- Create `examples/duo-default-distro/` with the full Stage 21d shape
  (`.claude-plugin/plugin.json`, `duo-extras/DISTRO.json`, `skills/`,
  `agents/`, etc.) that mirrors what install-service actually does
- Doc note: *"This is what Duo's own defaults look like, expressed as
  a distro pack. Use it as a reference when authoring your own pack."*
- Update `pack-builder` skill to point at this as the canonical
  example
- ZERO code changes to install-service.ts

**Pros:**
- Cheap. ~1 day of work to author the example folder + write the
  README.
- Documentary value — pack-builders see "this is the shape" without
  guessing.
- No regression risk.
- Reversible — easy to delete if the docs feel redundant.

**Cons:**
- TWO things to maintain (the actual install-service AND the
  documentary mirror).
- Drift risk — install-service edits won't auto-propagate to the
  example.
- Doesn't actually unify the codebase. The PACK.json vs DISTRO.json
  schema duplication remains.

**Effort estimate:** ~1 day.

### Option C — Schema unification (medium scope, high architectural value)

**Unify PACK.json and DISTRO.json into one schema. Don't refactor the
main install pipeline.**

- Pick one schema as canonical (DISTRO.json + plugin.json is the
  Stage 21d external-author pattern; probably wins because it's
  Claude-Code-plugin-spec-aligned via `.claude-plugin/plugin.json`)
- Port `intro-to-duo` and `claude-code-basics` from PACK.json shape
  to the canonical shape:
  - Add `.claude-plugin/plugin.json` to each
  - Replace `PACK.json` → `duo-extras/DISTRO.json`
  - Map `defaults[]` → `openOnFirstLaunch[]`
  - Map `navPins[]` → `pinnedFiles[]`
- Update `core/pack-loader.ts` to consume the canonical shape, OR
  retire it in favor of `distro-pack-service` (with a flag for
  "first-class built-in" vs "user-installed external")
- Leave install-service.ts hardcoded for everything else

**Pros:**
- Removes the schema-duplication confusion — pack authors only learn
  one shape.
- No big install-service refactor.
- Smaller blast radius than Option A.

**Cons:**
- Doesn't actually move the main app's docs/skills/agent into a pack
  — just unifies the lesson-pack schema with the distro-pack schema.
- Two loaders coexist (or `pack-loader.ts` dies — which IS a win,
  but the migration ripples through `main.ts § first-launch defaults
  hook`).
- The `intro-to-duo` + `claude-code-basics` ports need testing.

**Effort estimate:** ~2 days.

### Option D — Combined: schema unification + main-app dogfooding (the recommended phased approach)

**Step 1 (Sprint 15): Option C.** Unify PACK.json and DISTRO.json into
one schema. Port the two lesson packs to the canonical shape. Retire
`pack-loader.ts` if possible (or keep it as a thin built-in-pack
front for backwards compatibility).

**Step 2 (Sprint 16+, owner-pick): Option A subset.** Express Duo's
own defaults (skill, subagent, help, default pins) AS the
"duo-default" distro pack using the canonical schema. Refactor
install-service.ts to consume it via the same
`distro-pack-service` install path. Keep the irreducibly-hand-rolled
plumbing operations (PATH shim, SessionStart hook, CLI symlink,
provenance) in install-service.ts — they don't belong in pack
schemas.

**Step 3 (later, if pain emerges): Option A polish.** Move whichever
of those plumbing operations turn out to be expressible as
`duo-extras` post-install hooks into DISTRO.json's schema.

**Pros:**
- Phased — Sprint 15's Option C is reversible if Step 2 looks bad.
- Each step gates on the previous and can be evaluated at a
  smoke-walk.
- Final state is a true single install pipeline + a dogfooded default
  distro.

**Cons:**
- Requires owner buy-in across two sprints.
- Step 2 is the biggest piece — needs a fresh PRD-style scoping
  discussion before code work.

**Effort estimate:** ~2 days (Sprint 15) + 3-5 days (Sprint 16+).

---

## Recommendation

**Option D — phased.** Specifically:

1. **Sprint 15:** ship Option C (schema unification — PACK.json →
   DISTRO.json + plugin.json). Removes the duplication confusion.
   ~2 days.
2. **Sprint 15 close-out / Sprint 16 plan:** owner-decision-gate on
   Step 2 (full dogfood). Smoke-walk page should ask the four AUQs
   below.
3. **Sprint 16+:** Step 2 (main-app dogfooding) per Sprint 15
   close-out decisions.

**Why not Option A directly?** Two reasons:
- The schema duplication (PACK.json vs DISTRO.json) is a real source
  of confusion *today* and worth fixing regardless of whether we go
  on to Option A. If we skip directly to Option A, we're doing both
  pieces of work in one big sprint with no fallback.
- The owner question that prompted this doc is half "what ships" (an
  inventory, answered above) and half "should we use the pack
  pattern" (a design choice). Option C answers the inventory side
  fully and gives us a stable substrate for the design choice.

**Why not Option B?** Documentary value alone doesn't justify the
maintenance burden of a second mirror.

**Why not Option C alone?** It doesn't actually answer the dogfooding
question. The user asked "should the main app use the pack pattern?"
— Option C is preparation, not commitment.

---

## Open AUQs for owner — answer before Step 2 starts

If owner agrees to the phased plan above, these are the questions
that gate Step 2 (full dogfood). Don't answer them yet; surface them
at Sprint 15's close-out via a smoke-walk decision-gate page:

1. **Q1 — pack location for Duo's own defaults.** Should the
   built-in distro pack live at:
   - **(a)** `packs/duo-default/` (sibling of lesson packs;
     simplest)
   - **(b)** `<repo-root>/duo-default/` (top-level marker, so
     `packs/` stays "user-facing content packs" only)
   - **(c)** `examples/duo-default/` (treated as "the
     reference template that's also the actual default")
   - Recommended: **(a)** — minimizes re-org churn.

2. **Q2 — install-service simplification scope.** When converting
   Duo's defaults to a built-in distro pack, which currently-
   hand-rolled operations also collapse into the pack consumer?
   - **(a)** Content only — operations 1–5 (skill, subagent, help,
     packs, default pins). Plumbing stays in install-service.
   - **(b)** Content + soft plumbing — operations 1–5 + 6 (external-
     domains seed) + 10 (CLAUDE.md merge). Hard plumbing (PATH shim,
     SessionStart hook, CLI symlink) stays.
   - **(c)** Aggressive — try to pack-express ALL operations,
     including PATH shim and SessionStart hook (probably impossible
     for v1; ambitious target).
   - Recommended: **(b)** — sweet spot between simplification and
     leaving load-bearing OS-level wiring untouched.

3. **Q3 — version-coupling of the built-in pack.** Does the
   built-in distro pack carry its own version (independent of Duo's
   `package.json` version), or always inherit Duo's version?
   - **(a)** Independent — pack version bumps on changes to the
     pack content (skill, agent, help). Lets us re-fire first-launch
     defaults without bumping Duo. But two version numbers to track.
   - **(b)** Inherited — pack version always = Duo's version. One
     number. But every Duo bump re-fires first-launch defaults
     (unless we add an "only if pack content changed" hash check).
   - Recommended: **(b)** with hash-check for first-launch
     re-firing. Single version number; first-launch effects only
     trigger on actual content drift.

4. **Q4 — backwards-compat for PACK.json.** Step 1 (Option C)
   migrates the two lesson packs to the canonical schema. Should
   `core/pack-loader.ts` keep PACK.json reader logic for a few
   versions for BC, or hard-cut?
   - **(a)** Hard-cut. PACK.json is internal-only (only Duo's two
     bundled lesson packs use it); we control all consumers; remove
     the reader.
   - **(b)** Soft-deprecate. Keep PACK.json reader logic but emit a
     deprecation warning; remove in v0.7.x.
   - Recommended: **(a)** — internal-only schema, no external
     consumers, safe to hard-cut.

---

## Cross-references

- Stage 18 PRD — first-launch installer:
  [docs/prd/stage-18b-distro-packs.md](../prd/stage-18b-distro-packs.md)
- Stage 21d PRD — distro pack mechanism:
  [docs/prd/stage-21d-distro-packs.md](../prd/stage-21d-distro-packs.md)
- Stage 28 PRD — lesson packs:
  [docs/prd/stage-28-lesson-packs.md](../prd/stage-28-lesson-packs.md)
- Pack manifest schema:
  [shared/types.ts § PackManifest](../../shared/types.ts)
- Pack loader (lesson packs):
  [core/pack-loader.ts](../../core/pack-loader.ts)
- Distro pack service (enterprise packs):
  [electron/distro-pack-service.ts](../../electron/distro-pack-service.ts)
- Install service (the hand-rolled defaults):
  [electron/install-service.ts](../../electron/install-service.ts)
- Distro pack template (external-author starting point):
  [examples/distro-pack-template/](../../examples/distro-pack-template/)
- Pack builder skill:
  [skill/pack-builder/SKILL.md](../../skill/pack-builder/SKILL.md)
- Built-in lesson packs:
  [packs/intro-to-duo/PACK.json](../../packs/intro-to-duo/PACK.json),
  [packs/claude-code-basics/PACK.json](../../packs/claude-code-basics/PACK.json)
- Default pins bootstrap:
  [electron/install-service.ts § 522-528](../../electron/install-service.ts)
- First-launch defaults hook:
  [electron/main.ts § 513-547](../../electron/main.ts)

---

## Pending follow-ups

If owner agrees to the phased plan, file these as Sprint 15+
sub-items under ENH-134:

- **ENH-134a (Sprint 15)** — Option C: unify PACK.json + DISTRO.json
  into one schema. Port `intro-to-duo` + `claude-code-basics`. Decide
  fate of `core/pack-loader.ts` per Q4. Smoke walk: open the two
  ported packs, verify first-launch behavior unchanged, verify
  `duo pack list` shows both.
- **ENH-134b (Sprint 16+, gated by Q1-Q4 answers)** — Step 2: build
  a `duo-default` distro pack carrying skill/, agents/duo.md, help/,
  default pins. Refactor install-service.ts to consume it. Preserve
  load-bearing plumbing operations (per Q2 answer).
- **ENH-134c (later)** — Step 3 polish: post-install hooks in
  DISTRO.json schema (if Q2 stayed at (b) and pain emerges with the
  separation).
