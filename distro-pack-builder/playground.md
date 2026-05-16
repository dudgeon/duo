# Distro Pack Builder Playground

> A guided walk for authoring your first Duo distro pack.
> Follow top-to-bottom. Each step is small. By the end you'll
> have a working pack installed on your own Mac, ready to hand
> to your cohort.

---

## Pre-reqs

- macOS with **Duo** installed (canonical signed DMG from the
  [releases page](https://github.com/dudgeon/duo/releases) — do
  NOT install your own fork yet; the workshop assumes the
  canonical install).
- A clone of [github.com/dudgeon/duo](https://github.com/dudgeon/duo)
  on disk. (You're reading this file inside that clone; this
  workshop folder is `<repo>/distro-pack-builder/`.)
- **Claude Code** running with this folder as cwd. The scoped
  `CLAUDE.md` here teaches Claude what you're doing; the
  assistant skill at `.claude/skills/pack-builder-workshop/`
  helps with the mechanical bits.
- About 30–60 minutes for the v1 walk.

---

## What a pack actually IS

A pack is a folder. The folder has:

```
my-distro-pack/                  ← any name; your cohort sees it
├── .claude-plugin/
│   └── plugin.json              ← Claude Code plugin manifest (identity)
├── duo-extras/
│   ├── DISTRO.json              ← Duo integration manifest (FTUX + version + toggles)
│   ├── claude-md-snippet.md     ← (optional) merged into ~/.claude/CLAUDE.md on install
│   ├── priming-additions.md     ← (optional) appended to ~/.claude/duo/priming.md
│   ├── external-domains.json    ← (optional) merged into external-domains.json
│   ├── canvases/                ← (optional) → ~/.claude/duo/distros/<name>/canvases/
│   ├── playgrounds/             ← (optional) → same destination
│   └── canvas-templates/        ← (optional) → same destination
├── skills/                      ← installed as ~/.claude/skills/<distro>-<name>/
│   └── example-skill/
│       └── SKILL.md
└── agents/                      ← installed as ~/.claude/agents/<distro>-<name>.md
    └── example-agent.md
```

Three things make a pack a pack:

1. **Identity** in `.claude-plugin/plugin.json` (the Claude Code
   plugin manifest spec — name, version, description, author).
2. **Duo integration** in `duo-extras/DISTRO.json` (Duo-specific:
   FTUX defaults, requiresDuoVersion, optional toggles).
3. **Content** to ship — at least one of: skills, agents, canvases,
   playgrounds, claude-md-snippet, priming-additions, external-
   domains. (A pack with NO content is technically valid but
   pointless.)

The install pipeline (`electron/distro-pack-service.ts`) reads
both manifests, validates, and decomposes the content into
standalone destinations under `~/.claude/skills/`, `~/.claude/
agents/`, and `~/.claude/duo/distros/<name>/`.

---

## What goes in YOUR pack? — discovery matrix

| You want to ship... | Pack ingredient |
|---|---|
| Custom skills your cohort uses (e.g. an internal tool wrapper, a writing-style helper, a project-templating skill) | `skills/<name>/SKILL.md` |
| Custom subagents (delegate-style helpers) | `agents/<name>.md` |
| Static canvases (HTML pages, documentation, lesson content) | `duo-extras/canvases/<name>.html` |
| Interactive playgrounds (HTML pages with `<script>` and `data-action="*"` buttons) | `duo-extras/playgrounds/<name>.html` |
| Org-specific guidance for Claude (conventions, vocab, workflows) | `duo-extras/claude-md-snippet.md` |
| Domain-specific routing (intranet sites that should open external) | `duo-extras/external-domains.json` |
| Brain priming text for new Claude Code sessions | `duo-extras/priming-additions.md` |

You do NOT need all of these. Ship what your cohort needs.

---

## Step 1 — Scaffold from the template

The template at `<repo>/examples/distro-pack-template/` is the
working starting point. Copy it to wherever you want your pack
to live.

```bash
# From the repo root:
cp -r examples/distro-pack-template /tmp/my-pack
cd /tmp/my-pack
ls
# .claude-plugin/  agents/  duo-extras/  README.md  skills/
```

The template ships with one example skill, one example agent,
and a minimal `claude-md-snippet.md`. We'll customize all three.

---

## Step 2 — Set the pack identity

Edit `.claude-plugin/plugin.json`. The current shape:

```json
{
  "name": "example-distro",
  "version": "0.1.0",
  "description": "Example distro pack — replace with your own.",
  "author": "Your Org",
  "repository": "https://github.com/your-org/your-repo"
}
```

Change all five. **Pick a `name` that's URL-safe + unique to your
org** — it becomes the prefix on installed skill/agent paths
(`~/.claude/skills/<name>-<skill>/`), so collisions matter.

```json
{
  "name": "acme-corp",
  "version": "0.1.0",
  "description": "ACME Corp's curated Duo distro for the platform team.",
  "author": "ACME Platform Team",
  "repository": "https://github.com/acme-corp/duo-distro"
}
```

---

## Step 3 — Configure the Duo integration manifest

Edit `duo-extras/DISTRO.json`. Default content:

```json
{
  "schemaVersion": "1.0",
  "requiresDuoVersion": "^0.6.0",
  "defaults": []
}
```

The two fields you'll touch most:

- **`requiresDuoVersion`** — semver constraint. The install
  pipeline hard-blocks packs that target a Duo version older
  than what's installed. Read `package.json#version` from the
  repo root and target the same major; default `^<that-version>`.

- **`defaults[]`** — what tabs auto-open the first time a user
  launches Duo with this pack installed. Empty = no FTUX. A
  typical entry:

  ```json
  {
    "kind": "canvas",
    "path": "duo-extras/canvases/welcome.html",
    "title": "Welcome to ACME Duo"
  }
  ```

  Multiple defaults open in order. Use sparingly — too many
  auto-tabs is annoying on first launch.

Validate the JSON shape against the canonical schema at
`<repo>/skill/references/distro-v1-schema.json`:

```bash
# The pack-builder skill validate step does this for you:
# Run "/pack-builder" in Claude Code and walk the validate step.
```

---

## Step 4 — Customize the example skill

Edit `skills/example-skill/SKILL.md`. The template ships a
placeholder skill named `example-skill` with frontmatter:

```yaml
---
name: example-skill
description: Replace this with your skill's description.
---
```

Rename the folder + the `name` field. After install the skill
becomes `~/.claude/skills/<distro>-<skill-name>/SKILL.md` — so
`acme-corp/skills/jira-helper/SKILL.md` ends up as
`~/.claude/skills/acme-corp-jira-helper/SKILL.md`.

The `description` field drives Claude Code's skill discovery
matching. Be specific. Bad: "Helps with Jira." Good: "Search
Jira issues, summarize sprint progress, and draft new tickets
following the ACME naming convention."

Skill body is plain markdown. Look at `<repo>/skill/SKILL.md`
for a long-form example, or any of the `.claude/skills/<name>/`
in the repo for shorter ones.

---

## Step 5 — Customize the example agent (optional)

If your distro doesn't ship a subagent, delete the
`agents/` directory entirely. If it does, edit
`agents/example-agent.md`. Same shape as a skill but invoked
differently — the file becomes `~/.claude/agents/<distro>-
<agent>.md` and Claude Code's `Task` tool routes to it by name.

---

## Step 6 — (Optional) Add a CLAUDE.md snippet

If your distro ships guidance for Claude — conventions, vocab,
workflows — put it in `duo-extras/claude-md-snippet.md`. The
install pipeline merges this content into `~/.claude/CLAUDE.md`
between distro-managed markers (Stage 21d-i atomicity), so it
coexists with Duo's own block AND any other distro packs the
user has installed.

Format: plain markdown, h2 heading per section. Example:

```markdown
## ACME conventions

- We say "deck" for slide presentations, never "presentation".
- Internal tools are at `acme.dev/<tool>`. External tools should
  open in the user's default browser.
- ACME Standard Time is Eastern; meetings default to ET unless
  someone explicitly says otherwise.
```

Avoid putting confidential or company-internal information in a
public-facing pack. The pack is whatever you ship; it's not
inherently private.

---

## Step 7 — (Optional) Ship canvases / playgrounds

If your distro has rich content — onboarding pages, lesson HTML,
playground UIs — put HTML files in `duo-extras/canvases/` (static
pages) or `duo-extras/playgrounds/` (interactive — `<script>`
runs, `data-action="*"` buttons fire). On install they land at
`~/.claude/duo/distros/<name>/canvases/` and `playgrounds/`
respectively.

For canvas authoring conventions, see
[`<repo>/skill/make-page.md`](../skill/make-page.md). For
playground authoring, see
[`<repo>/skill/make-playground.md`](../skill/make-playground.md).

If a `defaults[]` entry in DISTRO.json points at one of these
files, it auto-opens on first launch.

---

## Step 8 — Validate

Open Claude Code in your pack folder (`/tmp/my-pack`):

```bash
cd /tmp/my-pack
claude
```

Then in the Claude Code session:

```
/pack-builder
```

Walk the **validate** step. The canonical pack-builder skill
runs schema validation, checks file references, and surfaces
authoring errors. Fix anything red.

---

## Step 9 — Build a distribution artifact

Three artifact shapes (pick one or build several):

### `.pkg` installer (path 1 — IT mass-deploy)

Best for: corporate platform teams shipping to a Mac fleet via
Jamf / Munki / Kandji. Users don't unzip; the `.pkg` bundles
`Duo.app` + your pack and the postinstall script writes the pack
to `~/.claude/duo/extra-packs/<name>/` directly.

```bash
# From the Duo repo root, with the canonical signed Duo.app already
# installed at /Applications/Duo.app on this build machine:
bash scripts/build-pkg.sh --pack ~/Documents/<your-pack-dir>/
# → dist/<pack-name>-<pack-version>-installer.pkg
```

The wrapper script handles `pkgbuild` + `productbuild` and bakes a
postinstall script that drops the pack into the installing user's
`~/.claude/duo/extra-packs/<pack-name>/`. The inner `Duo.app`'s
signature + notarization travel intact inside the payload, so once
installed Gatekeeper is satisfied at every app launch.

If your org has a Developer ID **Installer** cert, pass
`--sign-identity "Developer ID Installer: ..."` to produce a signed
`.pkg`. Without that flag the `.pkg` itself is unsigned —
Gatekeeper warns at install time but right-click → Open bypasses
on a personal Mac and MDM-managed installs typically bypass
Gatekeeper anyway. See `bash scripts/build-pkg.sh --help` and
`skill/pack-builder/SKILL.md § Path 2` for the full flag list.

### Drop-in zip (path 2 — manual install)

Best for: small cohorts, OSS communities, anyone who can ask the
user to drop a folder somewhere.

```bash
# From your pack root:
zip -r ../my-pack.zip .
```

User unzips into `~/.claude/duo/extra-packs/my-pack/` and
restarts Duo.

### Bundled fork (path 3 — pre-DMG-approval shops)

Best for: orgs whose IT can't ship a third-party signed DMG. You
fork Duo, bundle your pack, ship the result as your org's signed
DMG. See [`<repo>/docs/HOW-TO-FORK.md`](../docs/HOW-TO-FORK.md)
for the procedure.

---

## Step 10 — Smoke on your own Mac

Before handing your pack to your cohort, install it on your own
Mac and verify the install pipeline accepts it.

```bash
# Path 2 (zip) install:
mkdir -p ~/.claude/duo/extra-packs/my-pack
unzip -d ~/.claude/duo/extra-packs/my-pack/ /tmp/my-pack.zip
# Then: restart Duo (Cmd+Q, reopen).
```

After Duo relaunches:

1. **`duo pack list`** — your pack should appear (name, version,
   install date, list of installed files).
2. **Skills auto-discoverable** — `~/.claude/skills/<distro>-
   <skill>/SKILL.md` should exist; `claude` in any new session
   should pick the skill up.
3. **CLAUDE.md merged** — `~/.claude/CLAUDE.md` should contain
   your snippet between distro-managed markers.
4. **FTUX defaults** — if you set them, the canvas/playground
   tabs should be open in Duo's working pane.
5. **Validate uninstall** — `duo pack uninstall <name>` should
   atomically remove every tracked file + the CLAUDE.md block,
   leaving the source pack folder intact (so the user can
   reinstall later).

If anything looks off, the workshop assistant (skill in this
folder) can help diagnose. Common gotchas: stale provenance
manifest from a partial earlier install (delete
`~/.claude/duo/extra-packs/<name>/.installed-files.json` and
retry), missing dependency between two skill files, FTUX
defaults pointing at non-existent paths.

---

## Step 11 — Distribute to your cohort

You have a working pack. The artifact is one of: `.pkg`, `.zip`,
or a forked DMG. Distribution:

- **`.pkg`:** ship through your existing Mac fleet manager
  (Jamf, Munki, Kandji). The pkg writes the pack folder to
  `~/.claude/duo/extra-packs/<name>/` for each user; Duo picks
  it up on next launch.
- **`.zip`:** post to a shared Drive / Slack / org wiki. Provide
  the unzip-into-`~/.claude/duo/extra-packs/<name>/` instruction.
- **Fork:** publish your forked DMG via the same path Duo's own
  DMG ships (signed + notarized + downloadable). Cohort
  installs your DMG instead of dudgeon/duo's.

---

## Common pitfalls

| Symptom | Likely cause |
|---|---|
| Pack doesn't appear in `duo pack list` after install | `requiresDuoVersion` mismatch — the installed Duo is older than what your pack targets. Fix the constraint or upgrade Duo. |
| Skills install but don't appear to Claude Code | Folder name mismatch between `skills/<name>/` and the SKILL.md frontmatter `name` field. They must agree. |
| FTUX canvas opens but renders blank | The `defaults[].path` is relative to the pack root and must point at a file that actually exists. Common typo: `canvases/welcome.html` (forgot `duo-extras/`). |
| Two distros installed, one's CLAUDE.md content overwrote the other | Probably a manual `~/.claude/CLAUDE.md` edit broke the distro-managed markers. Reinstall both packs to repair. |
| Uninstall leaves stale files | `c1bb133` fixed two install/uninstall bugs in v0.6.8. If you're on an older Duo, upgrade. |

---

## Where to go next

- **Iterate** — pack v1 is shipping. Add more skills, more
  canvases, refine guidance. Bump the `version` field in
  `plugin.json` each time you ship a refresh; users can
  re-install via the same pkg/zip path to upgrade.
- **Lesson packs** — for educational use cases, see
  [`<repo>/skill/examples/lesson-template/`](../skill/examples/lesson-template/)
  and the canvas modality docs. Lesson packs are distro packs
  with a specific shape (canvases auto-open in browser mode for
  interactive playgrounds).
- **Contribute back** — if you found a gap in this workshop, a
  bug in the install pipeline, or a missing primitive, file an
  issue at [github.com/dudgeon/duo/issues](https://github.com/dudgeon/duo/issues)
  or open a PR. The workshop is meant to refine as real builders
  surface friction.

---

*Last revised: Sprint 9 (2026-05-07) — initial workshop ship under
ENH-106. Refines as builders surface gaps.*
