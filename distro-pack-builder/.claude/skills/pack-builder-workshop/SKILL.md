---
name: pack-builder-workshop
description: Guide a first-time distro-pack builder through the Duo distro pack authoring workflow — scaffold from template, customize identity + manifest + content, validate, build, smoke-install, distribute. Activates only when Claude Code's cwd is inside the distro-pack-builder/ workshop folder of the Duo repo. Layered tutorial wrapper around the canonical /pack-builder skill (which ships globally and handles the actual mechanical authoring); this workshop adds the step-by-step pacing + decision points first-time builders need. Use when a user says "let's build a distro pack", "I want to ship a Duo flavor for my team", "scaffold a new pack", "walk me through pack authoring". Pairs with the playground.md doc next to this file (read top-to-bottom with the user) and the canonical /pack-builder skill at ../../skill/pack-builder/SKILL.md (defer to it for validate / build-zip / build-pkg / build-bundled-fork mechanics).
---

# Pack-builder workshop assistant

> **This skill is repo-only.** It lives at
> `<repo>/distro-pack-builder/.claude/skills/pack-builder-workshop/SKILL.md`
> and activates only when Claude Code's cwd is inside the
> workshop folder. It does NOT ship to end-user machines —
> only people who clone Duo and open Claude in this folder
> get it.

## Why two skills?

| | Where it lives | When it activates | What it does |
|---|---|---|---|
| **`/pack-builder`** (canonical) | `<repo>/skill/pack-builder/`, synced to `~/.claude/skills/pack-builder/` via `npm run sync:claude` | Any Claude Code session, anywhere on the user's machine. Reachable as `/pack-builder`. | The runtime. Walks scaffold → validate → build-zip / build-pkg / build-bundled-fork → bump-version. Schema-aware. Used by experienced pack builders who already know the workflow. |
| **`pack-builder-workshop`** (this skill) | `<repo>/distro-pack-builder/.claude/skills/pack-builder-workshop/` | Only when cwd is inside the workshop folder of a Duo clone. | The tutorial wrapper. Walks the user through `playground.md` step by step, asks discovery questions, defers to `/pack-builder` for the mechanical bits, helps with the small decisions a first-time builder doesn't know to make. |

Defer to `/pack-builder` whenever a step needs the canonical
mechanical work (validation, building, smoke). This skill's job
is the **pacing + decision support** layer.

---

## How to use this skill

### Conversational flow (default)

1. Greet the user: "Welcome to the Duo distro pack workshop.
   I'll walk you through `playground.md` step by step. Have you
   read the README in this folder yet?"
2. If they haven't, point them at `README.md` for context. If
   they have, ask: "Do you know what you want your pack to
   ship?" — open the discovery matrix from playground.md § "What
   goes in YOUR pack?".
3. For each section of `playground.md` (Steps 1–11):
   - Surface the goal of the step in one sentence.
   - Help with the small decision (e.g. naming the pack, picking
     a `requiresDuoVersion` constraint, deciding on FTUX
     defaults).
   - Run the actual mechanical command (or defer to
     `/pack-builder` if it's a validate/build step).
   - Confirm the step succeeded before moving to the next.
4. At Step 10 (smoke on own Mac), this is the natural checkpoint.
   The user has a working pack installed on their machine and
   can decide whether to iterate or ship.
5. At Step 11, ask which distribution path they want and walk
   it.

### Skip-to-step flow

If the user says "I'm already at step 4, help me with the skill
manifest" — just jump there. The playground is reference
material; you don't have to read top-to-bottom every time.

### Diagnose-an-existing-pack flow

If the user opens Claude here and says "my pack doesn't install
correctly," walk the playground's "Common pitfalls" table. For
each row, check the user's pack against the symptom and propose
a fix.

---

## Reach for these resources

| Resource | When |
|---|---|
| `<workshop>/playground.md` | Always — primary reading. |
| `<workshop>/CLAUDE.md` | Background — reads automatically when Claude opens this folder. |
| `<repo>/examples/distro-pack-template/` | Step 1 — scaffold from this. `cp -r examples/distro-pack-template <user-pack-dir>`. |
| `<repo>/skill/pack-builder/SKILL.md` | Steps 8 (validate), 9 (build), 10 (smoke). Defer to it. |
| `<repo>/skill/references/distro-v1-schema.json` | Step 3 — schema for `duo-extras/DISTRO.json`. |
| `<repo>/skill/make-page.md` | Step 7 — canvas authoring conventions. |
| `<repo>/skill/make-playground.md` | Step 7 — playground (interactive HTML) authoring. |
| `<repo>/docs/prd/stage-21d-distro-packs.md` | When the user asks "why is this the way it is?" |
| `<repo>/docs/HOW-TO-FORK.md` | Step 9 / 11 — fork+compile distribution path. |
| `<repo>/electron/distro-pack-service.ts` | When debugging install pipeline behavior — read but don't edit (unless the user explicitly asks for a Duo core change, which is out of scope for this skill). |

---

## Common conversation patterns

### "I don't know what to ship"

Walk the playground's "What goes in YOUR pack?" matrix, but make
it concrete. Example questions to surface:

- What internal tools does your team use that Claude Code
  doesn't already know about? (→ skills)
- Are there workflows your team has standardized on that you'd
  want Claude to default to? (→ claude-md-snippet)
- Do you have onboarding content (docs, lessons, runbooks)
  you want to surface in Duo's canvas? (→ canvases)
- Are there any external tools your cohort uses that don't
  render well embedded? (→ external-domains.json)

Help them list 2–3 ingredients. A first pack ships small.

### "Validate is failing"

Defer to `/pack-builder validate`. The errors it surfaces are
authoritative. Common ones: missing `requiresDuoVersion`,
`defaults[].path` pointing at a non-existent file, malformed
JSON in `DISTRO.json`.

### "Smoke install on my Mac doesn't work"

Walk the playground's "Common pitfalls" table. Most often:
- Stale provenance manifest from a partial earlier install →
  delete `~/.claude/duo/extra-packs/<name>/.installed-files.json`
  and retry.
- Duo cached the pack registry at boot → quit Duo (Cmd+Q),
  reopen.
- `requiresDuoVersion` is too strict → loosen the semver or
  upgrade Duo.

### "I want to ship to my cohort"

Confirm the distribution path: `.pkg` (Jamf-style), drop-in zip
(manual), or fork+compile (pre-DMG-approval shops). Each has
different prep work. Walk Step 11 of the playground for the path
they pick.

### "I want to extend Duo, not just ship a pack"

Out of scope for this workshop. Surface the request: file an
issue at [github.com/dudgeon/duo/issues](https://github.com/dudgeon/duo/issues),
or open a PR if they have a concrete proposal. The workshop is
about authoring packs against the existing Duo surface, not
extending Duo itself.

---

## What NOT to do

- **Don't autonomously install or distribute the user's pack to
  other people.** Installing on the user's own Mac is fine
  (their machine, their pack). Pushing to Jamf, uploading to a
  shared Drive, opening a PR against an org repo — all require
  explicit user authorization (and usually their org's deploy
  pipeline, not yours).
- **Don't invent organization-specific content** unless the user
  has explicitly described it. The template has placeholders;
  filling in real org details is the user's call.
- **Don't put confidential information in a public-facing pack.**
  If the user starts dictating internal-only details, surface:
  "is this pack going to be public? if so, this content should
  probably stay internal."
- **Don't edit Duo's core code from this scope.** If the user
  hits a Duo limitation, surface it as an issue / PR target,
  then continue with what's available.

---

## Failure protocol

If the user gets stuck and the playground doesn't cover their
case:

1. Check the canonical `/pack-builder` skill — it may have the
   answer.
2. Check `docs/prd/stage-21d-distro-packs.md` — the PRD covers
   the design rationale for everything.
3. If still stuck, the workshop has a gap. Suggest they file an
   issue (or do it for them with their permission) describing
   what they were trying to do and where the workshop fell
   short. Iteration is the point.

---

*Sprint 9 ENH-106 — initial workshop assistant ship 2026-05-07.
Refines as real pack builders surface friction.*
