# Stage 21d — Distro packs (cohort distribution)

> **Status:** Draft, 2026-05-06. Sprint 8 (v0.6.8) anchor. Supersedes
> the original 21d framing (socket auth + agent-driven-nav notifications
> + early-adopter README) by absorbing those goals into the broader
> distro-pack architecture this PRD defines.
>
> **Why a fresh framing.** Original 21d was scoped before Sprint 5
> introduced playgrounds + lesson packs + the canvas-action vocabulary
> (Stage 27 / 28). Distro builders today have meaningfully more
> surface to ship than 21d originally anticipated: not just skills +
> CLAUDE.md snippets but also playground instances, canvas templates,
> lesson packs, FTUX defaults, and the full canvas-action runtime.
> This PRD redesigns 21d around that expanded surface while staying
> compatible with the Stage 18b (distro packs format) + Stage 21e
> (fork-friendly architecture) work that already shipped.

---

## Goal

**Let an enterprise distro builder ship a customized Duo experience
to users without forcing a recompile or a rebrand,** with low LOE
per Duo release on the distro side.

The motivating example: a corporate platform team (e.g. a Cap One
AIP-style group, or an internal training program) wants every team
member's Duo to ship with the team's skills, playgrounds, canvas
templates, FTUX welcome canvases, and CLAUDE.md guidance — without
the team having to maintain a fork of the Duo source code.

---

## Scope (what's in / what's out)

### In scope (the distro-controllable surface)

A distro pack can ship:

1. **Skills** — `.md` files that install to `~/.claude/skills/<distro>/`
2. **Agents** — `.md` subagent definitions to `~/.claude/agents/<distro>-*.md`
3. **Lesson packs** — full Stage 28 lesson-pack format (multi-canvas + paired skill) to `~/.claude/duo/packs/<distro>-<lesson-pack>/`
4. **Canvas templates** — reference HTML templates for `~/.claude/duo/distros/<distro>/canvas-templates/`
5. **Playground instances** — interactive HTML pages (Stage 27 vocabulary) to `~/.claude/duo/distros/<distro>/playgrounds/`
6. **Canvas instances** — non-interactive HTML pages to `~/.claude/duo/distros/<distro>/canvases/`
7. **CLAUDE.md snippet** — distro-managed block injected into `~/.claude/CLAUDE.md` (alongside Duo's `<!-- duo:managed -->` block)
8. **Priming additions** — appended to `~/.claude/duo/priming.md`
9. **External-domain seeds** — additive entries into `~/.claude/duo/external-domains.json`
10. **Pinned files** — entries merged into `~/.claude/duo/pins.json`
11. **FTUX defaults** — which canvases / playgrounds auto-open on first launch (and re-fire when a new pack is detected post-original-FTUX)

### Out of scope (forced-recompile territory)

Anything that requires a distinct macOS binary identity stays in
Layer 4 / Stage 21e fork land:

- Custom `appId` / bundle identifier
- Custom auto-update channel (your own GitHub Releases feed)
- Custom productName, app icon, DMG background (visual rebrand)
- Custom signing certificate

Distros that need any of these maintain a Layer 4 fork of the Duo
repo (and HOW-TO-FORK.md already documents that path). Most
distros — including the AIP-style motivating example — don't need
any of these. Owner-confirmed (2026-05-06): no rebrand required.

### Deferred to a later stage

- **Project-level CLAUDE.md injection** — distros stay at user
  level. Per-repo CLAUDE.md remains the developer's responsibility.
- **Pack signing / mandatory verification** — install = consent.
  The trust boundary matches today's `~/.claude/skills/` posture
  (whoever can write to that folder is trusted).
- **Cross-machine socket auth** — original 21d goal; deferred to
  a future stage if cross-machine becomes a real need. Local
  multi-user safety can be addressed at the OS level (file
  permissions on the socket).

---

## Distribution paths (how the pack reaches the user)

Three first-class paths, mutually compatible (a distro can pick
any combination based on its audience):

### Path 1 — `.pkg` installer (corporate IT, polished UX)

Distro builds a macOS `.pkg` that bundles:
- Canonical signed `Duo.app` (downloaded from upstream releases —
  unmodified, signature intact)
- The distro's pack folder (DISTRO.json + content)
- A postinstall script that:
  1. Copies `Duo.app` into `/Applications` (idempotent)
  2. Copies the pack folder into `~/.claude/duo/extra-packs/<distro-name>/`
  3. Does NOT auto-launch Duo (FTUX fires on next user launch)

The `.pkg` is signed with the **distro's** Developer ID (theirs,
not Duo's). `Duo.app` inside keeps the upstream signature. Mass
deployment via Jamf / Munki / standard MDM pipelines.

**Effort per Duo release:** distro re-builds the `.pkg` against the
new canonical `Duo.app` (download + bundle + sign). Pack contents
unchanged unless distro chooses to update them.

### Path 2 — Drop-in folder (manual or MDM-pushed)

Distro publishes the pack folder as a downloadable zip / git repo /
shared drive location. User (or MDM) places it at
`~/.claude/duo/extra-packs/<distro-name>/`. Duo discovers on next
launch; runs the install pipeline (described below).

**Effort per Duo release:** zero (assuming pack contents stay
compatible with the running Duo per `requiresDuoVersion`).

### Path 3 — Fork + compile (early-adopter / pre-DMG-approval)

Distro maintains a public/private fork of `dudgeon/duo` with their
pack pre-baked into a `bundled-distro/<distro-name>/` directory at
the repo root. Build pipeline includes:

- `npm run dist` discovers `bundled-distro/` and copies its contents
  into `Duo.app/Contents/Resources/bundled-distros/`
- On first launch, Duo's install service treats bundled distros
  identically to extra-packs — copies them into the user's
  `~/.claude/duo/extra-packs/<distro-name>/` and runs the install
  pipeline
- Users who clone + `npm run dist` get an unsigned DMG with the
  pack baked in

**Effort per Duo release:** distro merges upstream Duo into their
fork (typical git merge; usually no conflicts because the distro
only adds `bundled-distro/<distro-name>/` and never touches
upstream files). Re-runs `npm run dist`. Ships the new unsigned DMG.

**Why this path matters:** companies that haven't yet greenlit the
upstream signed DMG (security review pending, custom MDM needs)
can still onboard early adopters via clone-and-compile from a
trusted internal repo.

---

## Pack format

### Folder layout (Option 4: plugin source format, standalone install destinations)

**Locked 2026-05-06** after walking the standalone-skills + plugin-format trade-off space. The chosen design uses Claude Code's [plugin file format](https://code.claude.com/docs/en/plugins) as the canonical source format that distros author against, and Duo's install service decomposes it into standalone-skill destinations under `~/.claude/skills/` (with a `<distro-name>-` prefix added at install time).

**Why this shape:**
- **Source** is the Anthropic-canonical plugin layout — distros author against the standard structure, the pack-builder skill is a thin wrapper around plugin tooling, and the same artifact can be republished as a marketplace-installed plugin in v2 with no restructuring.
- **Install** is `~/.claude/skills/<distro>-<skill>/SKILL.md` top-level folders — auto-discovered by Claude Code in **every session** on the machine (Duo-launched, Terminal.app, iTerm, agent worktrees), live-change-detection works, no plugin manager involvement required, model-invocation works by default off the skill's `description` field.
- The `<distro>-` prefix added at install time guarantees cross-distro collision is physically impossible while keeping the source folder names natural (author writes `make-page/`, install lands at `aip-corporate-make-page/`).

**Pack source layout (what the distro builder authors):**

```
<distro-pack-root>/
├── .claude-plugin/
│   └── plugin.json                   # Claude Code plugin manifest (canonical schema)
├── duo-extras/                        # Duo-specific subtree (Claude Code doesn't read this)
│   ├── DISTRO.json                    # FTUX / integration toggles
│   ├── canvas-templates/
│   │   └── corp-poster.html
│   ├── playgrounds/
│   │   └── dashboard.html
│   ├── canvases/
│   │   └── welcome.html
│   ├── claude-md-snippet.md           # → user CLAUDE.md (managed block)
│   ├── priming-additions.md           # → appended to priming.md
│   └── external-domains.json          # → additive entries
├── skills/                            # plugin-format skills (each its own folder)
│   ├── make-page/
│   │   ├── SKILL.md                   # required entrypoint (uppercase per Claude Code spec)
│   │   └── examples/                  # optional supporting files
│   ├── corp-onboarding/
│   │   └── SKILL.md
│   └── quickstart/
│       └── SKILL.md
├── agents/                            # plugin-format agents
│   └── compliance-reviewer.md         # filename naturalized; Duo prefixes at install
├── hooks/                             # OPTIONAL — Claude Code plugin hook surface
│   └── hooks.json
├── monitors/                          # OPTIONAL — background monitor configs
│   └── monitors.json
├── .mcp.json                          # OPTIONAL — MCP server configs
├── .lsp.json                          # OPTIONAL — LSP server configs
└── duo-packs/                         # OPTIONAL — Stage 28 lesson packs (Duo-specific)
    └── quickstart-lesson/
        ├── PACK.json
        ├── canvases/
        └── lesson-skill/
```

**`.claude-plugin/plugin.json`** — exactly the [Claude Code plugin manifest schema](https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema):

```json
{
  "name": "aip-corporate",
  "version": "1.0.0",
  "description": "AIP Platform team's Duo customization pack",
  "author": { "name": "AIP Platform Team", "email": "aip-platform@example.com" },
  "homepage": "https://internal.example.com/aip/duo-pack"
}
```

This serves as the **canonical identity** for the pack — `name` is the distro identifier, `version` drives the `requiresDuoVersion` compat check, etc.

**`duo-extras/DISTRO.json`** — Duo-specific integration toggles:

```json
{
  "$schema": "https://duo.dev/schemas/distro-v1.json",
  "requiresDuoVersion": ">=0.6.7 <0.8",

  "openOnFirstLaunch": [
    "canvases/welcome.html",
    "playgrounds/dashboard.html"
  ],
  "pinnedFiles": [
    { "path": "canvases/welcome.html", "title": "AIP Welcome" }
  ],
  "claudeMdSnippet": true,
  "primingAdditions": true,
  "externalDomainsAdditions": true
}
```

Note: identity fields (`name`, `version`, `description`, `author`) live in `.claude-plugin/plugin.json` and are NOT duplicated here. DISTRO.json carries only Duo-specific behavior.

**Install destinations** (where each source piece lands on the user's filesystem after Duo's install pipeline runs):

| Source path                         | Install destination                                                                              | Discovery |
| :---------------------------------- | :----------------------------------------------------------------------------------------------- | :-------- |
| `skills/<name>/`                    | `~/.claude/skills/<distro>-<name>/`                                                              | Claude Code auto-discovers (every session, live watch); model-invokable |
| `agents/<name>.md`                  | `~/.claude/agents/<distro>-<name>.md`                                                            | Claude Code auto-discovers |
| `hooks/hooks.json`                  | merged into `~/.claude/settings.json § hooks`                                                    | Claude Code applies via standard hook discovery |
| `.mcp.json`                         | merged into `~/.claude/.mcp.json` (additive entries with `<distro>-<name>` keys)                 | Claude Code reads via standard MCP discovery |
| `.lsp.json`                         | merged into `~/.claude/.lsp.json` (additive)                                                     | Claude Code reads via standard LSP discovery |
| `monitors/monitors.json`            | merged into `~/.claude/duo/distros/<distro>/monitors.json` (Duo-managed, not Claude Code's)      | Duo-specific reader (Claude Code monitors are plugin-loaded only) |
| `duo-packs/<lesson-pack>/`          | `~/.claude/duo/packs/<distro>-<lesson-pack>/`                                                    | Duo's PackLoader scans `~/.claude/duo/packs/` |
| `duo-extras/canvas-templates/`      | `~/.claude/duo/distros/<distro>/canvas-templates/`                                               | Duo-specific reader |
| `duo-extras/playgrounds/`           | `~/.claude/duo/distros/<distro>/playgrounds/`                                                    | Duo-specific reader |
| `duo-extras/canvases/`              | `~/.claude/duo/distros/<distro>/canvases/`                                                       | Duo-specific reader |
| `duo-extras/claude-md-snippet.md`   | merged into `~/.claude/CLAUDE.md` between `<!-- distro:<name>-managed-vX.Y.Z -->` markers        | Claude Code reads CLAUDE.md natively |
| `duo-extras/priming-additions.md`   | appended to `~/.claude/duo/priming.md` between distro markers                                    | Duo's `--append-system-prompt` path |
| `duo-extras/external-domains.json`  | additive merge into `~/.claude/duo/external-domains.json`                                        | Duo's external-link router |

**Naming rules (Duo enforces during install; pack-builder validates at author time):**

- **Skill destination folders** = `<distro>-<source-skill-folder-name>`. Both halves lowercase + numbers + hyphens; combined max 64 chars (Claude Code constraint). Pack-builder warns if `<distro>-<name>` ≥56 chars (8-char buffer for safety).
- **Agent destination filenames** = `<distro>-<source-agent-filename>`. Same character constraints.
- **Distro name** (from `.claude-plugin/plugin.json § name`) becomes the prefix everywhere. Lowercase letters, numbers, hyphens; max 32 chars to leave room for skill/agent names.
- **Internal collision** (two source skills with the same folder name in the same pack) is caught by Claude Code's plugin format itself + pack-builder validates.
- **Cross-distro collision** is physically impossible — different `<distro>` prefix means different destination paths.

**SKILL.md frontmatter (required by Claude Code; the pack-builder validates):**

```yaml
---
description: Single-sentence "what + when to invoke." Truncated at 1,536 chars combined with when_to_use. Put the key use case first.
disable-model-invocation: false   # default false — Claude can auto-invoke. Set true for skills the user must explicitly invoke.
allowed-tools: Read Grep          # optional — pre-approved tools when this skill is active.
---

(skill body)
```

The `name` field is optional — if omitted, the folder name is used. Since Duo prefixes the folder name at install (`make-page/` → `aip-corporate-make-page/`), the resulting skill name will be `aip-corporate-make-page`. Authors can override by setting `name` explicitly in the frontmatter, but this defeats namespacing — pack-builder warns if a frontmatter `name` is set without the distro prefix.

**Model invocation surface:** under this layout, every distro skill is auto-discovered in every Claude Code session and is model-invokable by default — Claude reads each skill's `description` at session start and chooses when to invoke based on the user's task. Same exact mechanics as Duo's bundled skills (`/duo`, `/cut-version`, `/smoke-walk`).

**Future evolution to plugin-install (v2, deferred):** Once Duo can drive Claude Code's plugin install (either via a Duo-published marketplace, an `--plugin-dir` injection on Duo-launched sessions, or a future API), the SAME pack source format can be installed as a real plugin instead of decomposed to standalone skills. Distros wouldn't have to re-author. Skills would gain `/<distro>:<skill>` namespacing instead of the v1 hyphen-joined form. The pack source format is forward-compat by construction.

### Manifest semantics (split between two files)

**`.claude-plugin/plugin.json`** — Claude Code's canonical plugin
manifest schema. Owns identity:

- `name` — kebab-case distro identifier. Namespaces every install
  destination (`<distro>-<skill-folder>` etc.). Lowercase letters,
  numbers, hyphens; max 32 chars (leaves room for skill names
  within Claude Code's 64-char skill folder limit).
- `version` — semver of the pack (independent of Duo's version).
- `description`, `author`, `homepage`, `repository`, `license` —
  standard plugin metadata.

**`duo-extras/DISTRO.json`** — Duo-specific integration toggles.
Owns Duo behaviors only (no identity duplication):

- `requiresDuoVersion` — npm-style range. **Hard-blocks install
  if Duo doesn't satisfy.** Banner: "AIP Pack 1.0 requires Duo
  ≥0.6.7 <0.8; running 0.8.0. Update the pack or downgrade Duo."
- `openOnFirstLaunch` — relative paths (under `duo-extras/`) that
  auto-open as canvas / playground tabs on FIRST detection of
  this pack. Re-fires if a new pack is detected post-original-FTUX.
- `pinnedFiles` — paths added to `~/.claude/duo/pins.json` (first
  install only; respects user removal in subsequent updates).
- `claudeMdSnippet` / `primingAdditions` / `externalDomainsAdditions`
  — booleans that gate whether the corresponding files at
  `duo-extras/` get installed/merged. Owner can opt out of any
  subset even if the source file is present.

---

## Install pipeline

When Duo discovers a pack at `~/.claude/duo/extra-packs/<distro>/`
(via auto-discovery on launch, OR by direct copy from a `.pkg`
postinstall, OR from the bundled-distro path):

1. **Read & validate manifests.**
   - `.claude-plugin/plugin.json` — schema check against Claude
     Code's plugin manifest spec. Extract `name`, `version`,
     `description`. Fail with clear message if invalid or `name`
     missing.
   - `duo-extras/DISTRO.json` — schema check against the v1
     distro schema. Fail if `requiresDuoVersion` is malformed.

2. **Check `requiresDuoVersion`.** If unsatisfied, banner the user,
   leave the pack folder in place, exit. Pack stays inert until
   either Duo or the pack updates.

3. **Atomic replace** (owner-locked semantic):
   - If a pack with the same `name` is already installed, remove
     all files Duo previously installed for that pack (tracked via
     provenance manifest at `~/.claude/duo/extra-packs/<distro>/
     .installed-files.json`).
   - Install the new pack's contents into the namespaced
     destinations described above (skills get the `<distro>-`
     prefix added at this step).
   - Write a fresh provenance manifest.

4. **Decompose plugin source to standalone install destinations:**
   - For each `skills/<name>/` source folder, copy the entire
     subtree (SKILL.md + supporting files) to
     `~/.claude/skills/<distro>-<name>/`.
   - For each `agents/<name>.md`, copy to
     `~/.claude/agents/<distro>-<name>.md`.
   - If `hooks/hooks.json` is present, merge into
     `~/.claude/settings.json § hooks` (preserving any non-distro
     hooks).
   - If `.mcp.json` is present, merge entries with `<distro>-` key
     prefix into `~/.claude/.mcp.json`.
   - If `.lsp.json` is present, merge entries with `<distro>-` key
     prefix into `~/.claude/.lsp.json`.

5. **Merge Duo integration files:**
   - `duo-extras/claude-md-snippet.md` (if `claudeMdSnippet: true`)
     → upserts a `<!-- distro:<name>-managed-vX.Y.Z -->` block in
     `~/.claude/CLAUDE.md`. Coexists with Duo's own managed block
     and any other distros' blocks. Same merge logic as ENH-088.
   - `duo-extras/priming-additions.md` (if `primingAdditions: true`)
     → appended to `~/.claude/duo/priming.md` between
     `<!-- distro:<name>-priming-start -->` /
     `<!-- distro:<name>-priming-end -->` markers.
   - `duo-extras/external-domains.json` (if
     `externalDomainsAdditions: true`) → entries union-merged into
     the user's list.

6. **Copy Duo-specific content:**
   - `duo-extras/canvas-templates/` → `~/.claude/duo/distros/<distro>/canvas-templates/`
   - `duo-extras/playgrounds/` → `~/.claude/duo/distros/<distro>/playgrounds/`
   - `duo-extras/canvases/` → `~/.claude/duo/distros/<distro>/canvases/`
   - `duo-packs/<lesson-pack>/` → `~/.claude/duo/packs/<distro>-<lesson-pack>/`

7. **FTUX:**
   - If this is the FIRST EVER install of this pack (tracked via
     `~/.claude/duo/installed.json § distroFtuxFired[<name>]`),
     fire FTUX: open every `openOnFirstLaunch[]` entry as a tab on
     next visible launch; add `pinnedFiles[]` to pins.
   - Updates of an existing pack do NOT re-fire FTUX (already-fired
     flag stays true).

8. **Notify:** banner / toast: "AIP Corporate pack 1.0 installed —
   N new canvases, M new skills." Skills are immediately available
   in any running Claude Code session via Claude Code's live skill
   watcher (no restart required).

### Uninstall pipeline

User runs `duo pack uninstall <distro-name>` OR removes the pack
folder from `~/.claude/duo/extra-packs/`.

1. Read provenance manifest.
2. Delete every file in the manifest from the standalone install
   destinations (skills, agents, mcp/lsp entries, Duo-specific
   content).
3. Remove the distro's CLAUDE.md block (matched by marker).
4. Remove the distro's priming markers + content.
5. Remove the distro's external-domains entries.
6. Pinned files: leave in place if user has interacted with them
   (per pin-history); remove if untouched.
7. Banner: "AIP Corporate pack removed."

User-customized files (e.g. user edited the installed
`~/.claude/skills/aip-corporate-make-page/SKILL.md` after install)
are detected via content-hash comparison; the user's edited version
is preserved at
`~/.claude/skills/.user-modified/aip-corporate-make-page/` so the
work isn't lost. Mirror of Stage 21e-iii's provenance pattern.

### Update pipeline

User updates the pack (drops a new version into extra-packs OR
runs the new `.pkg` OR pulls + rebuilds the fork).

Atomic replace per owner-locked semantic:
1. Uninstall the old version (steps above).
2. Install the new version.
3. FTUX does NOT re-fire (pack-name already in
   `distroFtuxFired[]`). Banner: "AIP Corporate pack updated to 1.1."

If the pack-name changes (rare; e.g. fork rename), the install
pipeline treats it as a fresh install and FTUX fires.

---

## CLI surface

Three new verbs on the `duo` CLI:

```bash
duo pack list
# Lists installed distro packs with name, version, install date.

duo pack uninstall <distro-name>
# Runs the uninstall pipeline above.

duo pack install <path-or-url>
# Optional / aspirational. Fetches a pack from a path or URL,
# verifies hashes if the source provides them, copies into
# extra-packs/. Owner deferred this in the AUQ — file as
# FOLLOWUP-010 if user demand surfaces.
```

`pack install` is **deferred to a follow-up stage** per the AUQ
result. v1 ships with `list` + `uninstall` + auto-discovery only.

---

## The pack-builder skill (ships with default Duo)

A new skill at `skill/pack-builder.md` (synced to
`~/.claude/skills/duo/pack-builder.md` via `npm run sync:claude`).
Lives in the canonical Duo distribution so every distro builder has
it available without extra setup.

### What the skill does

1. **Scaffold a new pack.** `Build me an AIP corporate distro pack`
   → Claude follows the skill to create a folder structure with:
   - `.claude-plugin/plugin.json` (canonical Claude Code manifest;
     scaffolded with stub identity fields).
   - `duo-extras/DISTRO.json` (Duo integration manifest; toggles
     start at sensible defaults).
   - Empty `skills/`, `agents/`, `duo-extras/canvases/`, etc.
     directories with README files explaining conventions.
2. **Validate an existing pack.**
   - Schema-check `.claude-plugin/plugin.json` against Claude
     Code's plugin manifest spec (uses Anthropic's published
     schema).
   - Schema-check `duo-extras/DISTRO.json` against the v1 distro
     schema.
   - Validate skill folders: each `skills/<name>/` must contain a
     `SKILL.md` with valid YAML frontmatter; the `description`
     field must be present and non-empty (warns if missing).
   - Validate the combined-name length: `<plugin-name>-<skill-name>`
     must be ≤64 chars (Claude Code skill folder constraint); warn
     at ≥56 chars (8-char buffer).
   - Validate naming: lowercase letters + numbers + hyphens only.
   - Parse `requiresDuoVersion`; warn if syntax invalid.
   - Verify `openOnFirstLaunch[]` paths resolve to actual files
     under `duo-extras/`.
   - Verify `pinnedFiles[]` paths resolve.
   - Warn if a SKILL.md frontmatter sets `name` explicitly without
     the distro prefix (would defeat namespacing).
3. **Build distribution artifacts.**
   - `pack-builder zip` — produces a zip of the pack folder for
     Path 2 (drop-in) distribution.
   - `pack-builder pkg` — produces a macOS `.pkg` for Path 1
     (.pkg installer) distribution. Bundles canonical
     `Duo.app` (downloaded from the configured upstream Releases
     URL — defaults to `dudgeon/duo`) + the pack + a postinstall
     script. Signs the `.pkg` if `DEVELOPER_ID_INSTALLER` env var
     is set; warns clearly if not.
   - `pack-builder bundled-fork` — copies the pack into
     `bundled-distro/<name>/` of a Duo source checkout, ready
     for Path 3 (fork + compile).
4. **Update version.**
   - Bumps `.claude-plugin/plugin.json § version` (semver-aware:
     --patch / --minor / --major).
   - Updates the marker version in the pack's
     `duo-extras/claude-md-snippet.md` (so the post-install
     marker `<!-- distro:<name>-managed-vX.Y.Z -->` matches).
5. **Future-evolution helper.**
   - `pack-builder publish-marketplace` (v2; deferred) — generates
     a Claude Code marketplace entry for the pack so it can be
     installed via `claude plugin install` with `/<distro>:<skill>`
     namespacing instead of v1's `/<distro>-<skill>` form.

### Why this skill ships with default Duo

Distros are downstream of Duo by definition. If the pack-builder
lived in a separate repo (or in each distro's own tooling),
distros would all reinvent it differently. Shipping a canonical
authoring skill keeps distro packs uniform — the pack-builder
skill IS the spec, in the same way the smoke-walk skill is the
smoke-walk spec.

The skill is hook-independent (works in any Claude Code session
where `~/.claude/skills/duo/pack-builder.md` is reachable —
which, after Duo's first-launch install, is every session).

---

## What this means for low-LOE-per-Duo-release

Owner asked: "low LOE per duo release." The mechanics:

| Distro action | Frequency | Effort |
|---|---|---|
| Bump pack version on a Duo bump | Only if `requiresDuoVersion` excludes the new Duo | Bump + test + republish |
| Re-build `.pkg` on a Duo bump (Path 1) | Every Duo release the distro chooses to track | ~5 min: download new canonical Duo.app, run pack-builder pkg, sign, ship |
| Update bundled fork (Path 3) | Every Duo release the distro chooses to track | git merge upstream + npm run dist + sign + ship |
| Drop-in path (Path 2) | Only on pack content updates | Zero per-Duo-release work |

**The per-release work is bounded by the `requiresDuoVersion` range
the distro declared.** A pack that declares `>=0.6.7 <0.8` carries
through every patch release in the 0.6.x and 0.7.x lines without
distro action.

The two things that DO require per-Duo-release work:
1. **MAJOR/MINOR Duo bumps that exit the declared range** — distro
   tests against the new Duo, expands the range, republishes.
2. **`.pkg` Path 1 distribution** — distro re-bundles the new
   canonical `Duo.app` into a fresh `.pkg`. ~5 min job; can be
   automated in a CI workflow.

Owner's preferred upgrade flow (from the AUQ): pin specific Duo
versions, test, republish manually. This PRD's design supports
that flow as the default; the `requiresDuoVersion` hard-block
guarantees a pack never silently runs on an untested Duo.

---

## Stage 21d sub-stages (sprint 8 phasing)

**21d-i — Distro pack discovery + install pipeline (the core).**
- `~/.claude/duo/extra-packs/` discovery on launch.
- Bundled-distro discovery from `Duo.app/Contents/Resources/bundled-distros/`.
- Both manifests parsed: `.claude-plugin/plugin.json` (identity)
  + `duo-extras/DISTRO.json` (Duo integration toggles).
- `requiresDuoVersion` hard-block enforcement.
- Plugin-source decomposition: walk `skills/<name>/` and
  `agents/<name>.md`, copy to standalone `~/.claude/skills/<distro>-<name>/`
  and `~/.claude/agents/<distro>-<name>.md` destinations with
  prefix added at copy time.
- Atomic-replace install pipeline; provenance manifest writer.
- Multi-distro CLAUDE.md merge logic (extension of ENH-088).
- FTUX re-fire on first detection of a new pack.
- Optional: `hooks/hooks.json`, `.mcp.json`, `.lsp.json` merging
  (additive, namespaced via `<distro>-` prefix on entry keys).

**21d-ii — Pack-builder skill (the spec).**
- New skill at `skill/pack-builder/SKILL.md` (its own folder, per
  Claude Code's spec) synced via `npm run sync:claude`.
- Capabilities: scaffold (creates `.claude-plugin/plugin.json` +
  `duo-extras/DISTRO.json` skeletons + content folders) / validate
  (both manifest schemas, skill folder names, frontmatter
  descriptions, combined-name length) / build (zip + pkg +
  bundled-fork) / version-bump.
- DISTRO v1 schema lives at `skill/references/distro-v1-schema.json`.
- Plugin manifest validation reuses Claude Code's published plugin
  schema (linked from the skill's reference docs).

**21d-iii — CLI surface.**
- `duo pack list` (shows installed distro packs).
- `duo pack uninstall <name>` (atomic uninstall).
- (Deferred: `duo pack install <url>` — file as FOLLOWUP-010.)

**21d-iv — Sample distro + early-adopter README.**
- Build `examples/distro-pack-template/` as a working
  copy-and-customize starting point (also published as a separate
  GitHub repo so distros can fork it).
- Update HOW-TO-FORK.md to include "Layer 2.5 — distro packs"
  between the existing Layer 2 (drop-in) and Layer 3 (build-time
  partial fork).
- README "early-adopter" section covering: which distribution
  paths exist, when to choose each, what the pack-builder skill
  does, how to handle Duo upgrades.

**Total estimated effort:** ~2-3 PRDs of work spread across the
sprint. 21d-i is the load-bearing one; 21d-ii + 21d-iii layer on
top once the discovery + install pipeline is in place.

---

## Open questions for next-sprint pickup

1. **Cross-machine socket auth** (the ORIGINAL 21d goal). Deferred
   here; revisit when a real cross-machine use case surfaces.
   File as FOLLOWUP-011.
2. **Agent-driven-nav notifications** (also from original 21d). The
   "your agent just navigated to /path/foo.md" toast pattern. Not
   distro-specific; should land independently. File as
   FOLLOWUP-012; can ride along in 21d-iv if owner wants the
   early-adopter cohort to see it.
3. **Pack signing model** (deferred per owner answer). If the
   ecosystem grows to where strangers ship packs to each other,
   revisit. v1 is "install = consent."
4. **`duo pack install <url>` CLI** (deferred). File as
   FOLLOWUP-010. Adds a network/security model; not v1.
5. **Project-level CLAUDE.md** (out of scope per owner). Distros
   stay user-level. Revisit if a strong demand surfaces.

---

## Cross-references

- [HOW-TO-FORK.md](../HOW-TO-FORK.md) — the layer model this PRD
  slots into between Layer 2 and Layer 3.
- [Stage 18b PRD](stage-18b-distro-packs.md) — original distro
  pack format spec; this PRD supersedes by absorbing.
- [Stage 19e PRD](stage-19e-user-context-onboarding.md) — managed
  CLAUDE.md block (ENH-088); this PRD extends to per-distro blocks.
- [Stage 21e roadmap entry](../roadmap.html#s21) — fork-friendly
  architecture; this PRD lives downstream.
- `fork.config.default.json` — upstream Duo's default fork config;
  parallel to (but distinct from) DISTRO.json.
- [active-sprint.md](../dev/active-sprint.md) — Sprint 8 phasing.
