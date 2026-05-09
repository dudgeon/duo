# Distro Pack Builder Workshop

> **For people building a Duo distro pack** — corporate platform
> team, educational program, OSS community group, or anyone who
> wants to ship a custom-flavored Duo to a cohort without forking
> the binary.

This folder is a **guided workshop**, not the runtime — the
runtime lives at [`../skill/pack-builder/`](../skill/pack-builder/SKILL.md)
(canonical authoring path, ships globally) and the install pipeline
lives at [`../electron/distro-pack-service.ts`](../electron/distro-pack-service.ts).

The workshop wraps both with a **scoped CLAUDE.md** + a
**project-only assistant skill** + **step-by-step playground docs**
so a first-time pack builder can clone Duo, open Claude Code in
this folder, and have a working pack at the end of an afternoon.

## Start here

1. **[playground.md](playground.md)** — the tutorial. Walk through
   primitives, build a pack from the template, install it on your
   own machine, validate, ship to your cohort.
2. **[CLAUDE.md](CLAUDE.md)** — the scoped instructions Claude Code
   reads when you open this folder as cwd. You don't need to read
   it; Claude does. (Read it if you're curious about *how* the
   workshop assistant knows what to do.)
3. **[.claude/skills/pack-builder-workshop/](.claude/skills/pack-builder-workshop/SKILL.md)**
   — the assistant skill that activates inside this folder. Walks
   you through manifest authoring, validation, building, smoke
   testing. Not synced to `~/.claude/`; it lives here so it only
   activates for actual pack builders, not every Duo user.

## How this relates to the rest of Duo

| Where | What |
|---|---|
| `distro-pack-builder/` (this folder) | **Guided tutorial.** Scoped CLAUDE.md + assistant skill + playground docs. Repo-only — clones get it, end users don't. |
| `examples/distro-pack-template/` | Working copy-and-customize starting point. Plugin manifest + `duo-extras/` integration + sample skill + sample agent. The thing you copy when you start a new pack. |
| `skill/pack-builder/SKILL.md` | The **canonical authoring path** that ships globally to every Duo user via `~/.claude/skills/pack-builder/`. Reachable as `/pack-builder` in any Claude Code session on the user's machine. The runtime; the workshop's assistant defers to it for the actual mechanics. |
| `electron/distro-pack-service.ts` | The install pipeline. Auto-scans `~/.claude/duo/extra-packs/` on Duo launch, validates manifests, decomposes packs into standalone destinations under `~/.claude/skills/<distro>-<name>/` and `~/.claude/agents/<distro>-<name>.md`. |
| `docs/prd/stage-21d-distro-packs.md` | Full PRD — the design rationale + open questions. |
| `docs/HOW-TO-FORK.md` | Layer 2.5 documents the three distribution paths: `.pkg` installer (mass-deploy via Jamf / Munki), drop-in zip, fork+compile. |

## Three distribution paths your cohort can use

Your end users don't need to compile Duo. They install the canonical
signed DMG, then drop your distro pack in via one of:

1. **`.pkg` installer** — mass-deployable via Jamf / Munki / your IT
   tool of choice. The pkg writes the pack to
   `~/.claude/duo/extra-packs/<name>/`; Duo picks it up on next
   launch.
2. **Drop-in zip** — your user unzips into
   `~/.claude/duo/extra-packs/<name>/`. Same end result; manual.
3. **Fork + compile** — for shops pre-DMG approval who can't ship
   the canonical signed DMG. See [HOW-TO-FORK.md](../docs/HOW-TO-FORK.md).

Most cohorts do path 1 or 2. Path 3 is the escape hatch.

## Status

ENH-106 — Sprint 9 P1 (2026-05-07). Workshop scaffolding shipped;
playground content seeded with the v1 walk. Assistant skill ships
with the workshop; refines as real builders surface gaps.
