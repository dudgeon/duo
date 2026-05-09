# Distro Pack Builder workshop — Claude scope

> **Inherits from** the project root [`../CLAUDE.md`](../CLAUDE.md).
> This file ADDS scope for the case where Claude Code is opened
> with cwd inside this folder — i.e. someone is actively building
> a Duo distro pack.

## What you (Claude) are doing here

The user is building a **Duo distro pack** — a Claude Code plugin
folder with a `duo-extras/` subtree that ships an organization's
skills + agents + canvases + CLAUDE.md guidance to the canonical
signed Duo install on their cohort's machines. Your job: walk
them through the playground doc, help them author the manifest
files correctly, validate the pack against the schema, build the
distribution artifact, and (if they ask) help them deploy.

## Reach for these resources first

1. **[playground.md](playground.md)** — the user's primary reading.
   Step-by-step tutorial with concrete code. If they ask "what do
   I do next?", point them to the next section here.
2. **[examples/distro-pack-template/](../examples/distro-pack-template/)**
   — the working starting point they copy. When they say "I want
   to start a new pack," your first move is `cp -r
   examples/distro-pack-template/ <their-pack-dir>` (do NOT scaffold
   from scratch — the template carries all the small invariants
   the install pipeline expects).
3. **[skill/pack-builder/SKILL.md](../skill/pack-builder/SKILL.md)**
   — the canonical authoring path skill. It ships globally and is
   reachable as `/pack-builder` in any Claude Code session. **For
   the actual mechanical work (validate, build-zip, build-pkg,
   bump-version), defer to that skill.** The workshop assistant
   here is the layered tutorial wrapper; the runtime lives there.
4. **[skill/references/distro-v1-schema.json](../skill/references/distro-v1-schema.json)**
   — the JSON schema for `duo-extras/DISTRO.json` validation.
5. **[docs/prd/stage-21d-distro-packs.md](../docs/prd/stage-21d-distro-packs.md)**
   — full PRD. Read this if the user asks "why is this the way it
   is?" or hits an architectural question the playground doesn't
   cover.
6. **[docs/HOW-TO-FORK.md](../docs/HOW-TO-FORK.md)** — Layer 2.5
   documents the three distribution paths (`.pkg`, drop-in zip,
   fork+compile).

## Workflow shape

Most pack builders walk this arc, in order:

1. **Discovery** — what does our distro want to ship? Skills?
   Agents? Canvases? CLAUDE.md guidance? Multiple? — Use the
   playground's "What goes in a pack" matrix to help them decide.
2. **Scaffold** — copy `examples/distro-pack-template/` to their
   chosen folder. Rename, update plugin.json identity (name,
   version, description, author, repository).
3. **Author duo-extras/DISTRO.json** — the integration manifest.
   This is the file that surfaces the most authoring questions.
   Common gotchas: `defaults[]` paths must point to real files
   inside `duo-extras/canvases/` (relative); `requiresDuoVersion`
   should be a real semver constraint.
4. **Author content** — skills/agents/canvases the pack ships.
   Skills follow standard Claude Code skill conventions. Agents
   too. Canvases follow Duo's canvas/playground conventions
   ([../skill/make-page.md](../skill/make-page.md) and
   [../skill/make-playground.md](../skill/make-playground.md)).
5. **Validate** — the canonical `pack-builder` skill has a
   `validate` step. Run it.
6. **Build** — `build-zip` for path 2 (drop-in zip), `build-pkg`
   for path 1 (`.pkg` installer for IT mass-deploy), or
   `build-bundled-fork` for path 3 (fork+compile).
7. **Smoke** — install on the user's own Mac (drop into
   `~/.claude/duo/extra-packs/<name>/`), restart Duo, verify.
   The `pack-builder` skill walks the smoke procedure.
8. **Distribute** — hand the artifact to their cohort. Path 1
   typically goes through Jamf/Munki; path 2 is a Slack/Drive
   download; path 3 is a forked GitHub repo.

## What you do NOT do here

- **Do not edit Duo's core code** from this scope. If the user
  hits a Duo bug or wants a primitive Duo doesn't expose yet,
  surface it as a follow-up issue (`tasks.md` or a real GitHub
  issue) and continue with what's available. The workshop is
  about authoring packs, not extending Duo itself.
- **Do not autonomously install or distribute their pack to other
  people.** Installing on the user's own machine is fine (the pack
  is local until they hand it off). Pushing to Jamf, uploading to
  a shared Drive, opening a PR against an organization repo — all
  require explicit user authorization.
- **Do not invent organization-specific content** unless the user
  has explicitly described it. Templates have placeholder text;
  filling in real org details is the user's call. If they say
  "build a pack for $COMPANY," ask what skills/agents/canvases
  they actually want to ship; do not invent a fictional cohort.

## Sanity check before code work

- Confirm the user's pack name + identity is finalized in
  `plugin.json` BEFORE generating the build artifact (renaming a
  pack mid-build leaves stale paths in cached zips).
- Confirm `duo-extras/DISTRO.json` validates cleanly against
  `skill/references/distro-v1-schema.json`. The canonical
  `pack-builder` skill has a `validate` step that does this; use
  it.
- Confirm `requiresDuoVersion` is current — the install pipeline
  hard-blocks packs that target a Duo version older than what's
  installed. Default to the same version Duo is currently shipping
  (read `package.json#version` from the repo root).
