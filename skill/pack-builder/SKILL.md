---
name: pack-builder
description: Author, validate, and build a Duo distro pack — a Claude Code plugin folder with a Duo `duo-extras/` subtree that ships an organization's skills + agents + canvases + CLAUDE.md guidance to a canonical signed Duo install. Use when a user says "build a distro pack for X", "make an Acme-flavored Duo", "package my team's skills as a Duo plugin", or "scaffold a new distro pack." Pairs with the duo-pack-service install pipeline and the `duo pack list / uninstall` CLI verbs.
---

# Pack-builder skill — Duo distro packs

> **Why this skill exists.** A distro pack is the artifact a corporate
> platform team / educational program / OSS community group ships to
> end users so their canonical Duo install picks up org-specific
> skills, agents, canvases, playgrounds, and CLAUDE.md guidance —
> without forcing users to recompile Duo. The pack format is the
> canonical Claude Code plugin layout (`.claude-plugin/plugin.json`
> + `skills/<name>/SKILL.md` + `agents/<name>.md`) plus a `duo-extras/`
> subtree for Duo-specific content (canvases, playgrounds, integration
> manifest, CLAUDE.md snippet, etc.). Distro builders shouldn't have
> to remember the format from scratch every time — this skill is
> the canonical authoring path.

---

## What a distro pack contains

```
my-distro-pack/                           ← the pack root (any name)
├── .claude-plugin/
│   └── plugin.json                       ← Claude Code plugin manifest (identity)
├── duo-extras/
│   └── DISTRO.json                       ← Duo integration manifest (FTUX + toggles)
│   └── claude-md-snippet.md              ← (optional) merged into ~/.claude/CLAUDE.md
│   └── priming-additions.md              ← (optional) appended to ~/.claude/duo/priming.md
│   └── external-domains.json             ← (optional) merged into external-domains.json
│   └── canvases/                         ← (optional) → ~/.claude/duo/distros/<name>/canvases/
│   └── playgrounds/                      ← (optional) → ~/.claude/duo/distros/<name>/playgrounds/
│   └── canvas-templates/                 ← (optional) → ~/.claude/duo/distros/<name>/canvas-templates/
├── skills/                               ← installed as ~/.claude/skills/<distro>-<name>/
│   └── example-skill/
│       ├── SKILL.md                      ← required entrypoint per Claude Code plugin spec
│       └── (optional supporting files)
├── agents/                               ← installed as ~/.claude/agents/<distro>-<name>.md
│   └── example-agent.md
└── (optional: hooks/, .mcp.json, .lsp.json — v2 routing)
```

**A reference template** ships at
[`examples/distro-pack-template/`](examples/distro-pack-template/) in the
Duo source repo. Copy that folder; fill in the manifests; replace the
example skills/agents with your content; ship the result as a folder
the user (or IT) drops into `~/.claude/duo/extra-packs/<distro-name>/`.

---

## Naming rules (hard)

- **Distro name** (`.claude-plugin/plugin.json § name`): lowercase
  letters + numbers + hyphens only. Max 32 characters. This name
  becomes the prefix on every install destination.
- **Skill folder names** (`skills/<name>/`): same character set.
  Combined `<distro>-<skill>` must be ≤64 characters (Claude Code
  spec). The pack-builder warns at ≥56 chars (8-char buffer for
  defensive headroom).
- **Agent filenames** (`agents/<name>.md`): same character set on
  the basename. Combined `<distro>-<name>.md` must be ≤64 characters.

These constraints are surfaced by `pack-builder validate` (below).

---

## Authoring checklist (manual — agent walks it)

1. **Decide the distro name.** Lowercase, kebab-case, ≤32 chars.
   Example: `aip-corporate`, `course-bootcamp-2026`,
   `foss-community-pack`.
2. **Copy the template:** `cp -r examples/distro-pack-template/
   ~/Documents/<distro-name>/`.
3. **Fill in `.claude-plugin/plugin.json`:**
   - `name`: the distro name from step 1.
   - `version`: semver (`"1.0.0"` for first release).
   - `description`: one-sentence what this pack contains and who it's
     for.
   - `author`: `{ name, email }` or just `name`.
   - `homepage` / `repository` / `license`: optional; helpful for
     downstream discoverability.
4. **Fill in `duo-extras/DISTRO.json`:**
   - `requiresDuoVersion`: range (e.g. `">=0.6.7 <0.8"`). HARD BLOCK
     — Duo refuses to install a pack on an unsupported version.
   - `openOnFirstLaunch`: array of relative paths under `duo-extras/`
     (canvases / playgrounds) that should auto-open as tabs on FIRST
     detection of this pack. Re-fires once per pack-name.
   - `pinnedFiles`: array of `{ path, title }` entries for the
     navigator's pin list (first-install-only merge).
   - `claudeMdSnippet` / `primingAdditions` / `externalDomainsAdditions`:
     booleans. Default to true if the corresponding file is present.
5. **Author skills under `skills/<name>/SKILL.md`:** standard Claude
   Code skill format. The pack-builder validates the YAML frontmatter
   (description present, `name` not overriding the distro prefix).
6. **Author agents under `agents/<name>.md`:** standard Claude Code
   agent format. Same naming rules as skills.
7. **(Optional) Author Duo-specific content:**
   - `duo-extras/canvases/<file>.html` — read-only HTML pages.
   - `duo-extras/playgrounds/<file>.html` — interactive HTML
     pages (declare `<meta name="duo-open-in" content="browser">`
     per the modality lock — see `make-playground.md`).
   - `duo-extras/canvas-templates/<file>.html` — reusable templates
     for `make-page` / `make-playground` consumers.
   - `duo-extras/claude-md-snippet.md` — a managed block for
     `~/.claude/CLAUDE.md`. Sits alongside Duo's own managed block;
     never overrides it.
   - `duo-extras/priming-additions.md` — appended to
     `~/.claude/duo/priming.md`.
   - `duo-extras/external-domains.json` — additive entries.
8. **Validate** the pack with `pack-builder validate <pack-folder>`
   (see § "Validate an existing pack" below).
9. **Distribute** by zipping the folder + posting to a download
   location, or by mass-deploying via Jamf / Munki / similar to
   `~/.claude/duo/extra-packs/<distro-name>/`. End users' Duo
   install service picks the pack up on next launch.

---

## Validate an existing pack

Run a structural + manifest check before distributing:

```bash
# Pack-builder is a skill, not a binary — Claude walks the validation
# steps based on this skill's contract. Trigger it with prompts like:
#   "validate this distro pack: ~/Documents/aip-corporate/"
#   "is the Acme pack ready to ship?"
```

Validation steps the skill walks:

1. `.claude-plugin/plugin.json` exists + parses + has a valid `name`
   field (lowercase + hyphens + numbers, ≤32 chars).
2. `duo-extras/DISTRO.json` exists OR is intentionally absent (a
   manifestless pack is treated as defaults — claude-md-snippet etc.
   auto-detected by file presence).
3. Every `skills/<name>/` folder contains a `SKILL.md` (required by
   Claude Code's plugin spec).
4. Every `SKILL.md` has a `description` field in frontmatter.
5. Combined `<distro>-<skill>` length ≤64 chars (warn at ≥56).
6. Every agent file is a `.md` with valid frontmatter.
7. `requiresDuoVersion` (if set) parses as `>=A.B.C <X.Y.Z` form
   (the parser falls open on other forms with a warn).
8. `openOnFirstLaunch` paths resolve to actual files under
   `duo-extras/`.
9. `pinnedFiles` paths resolve.
10. No SKILL.md frontmatter sets `name` explicitly without the
    distro prefix (would defeat the namespacing convention).

---

## Build distribution artifacts

Three distribution paths per the PRD:

### Path 1 — Drop-in zip (Jamf / Munki / manual download)

```bash
# Pack folder ready? Zip it:
cd ~/Documents/<distro-name>/..
zip -r <distro-name>-pack-<version>.zip <distro-name>/
```

End user (or IT) extracts the zip into `~/.claude/duo/extra-packs/`.
Duo discovers + installs on next launch. Lowest packaging effort;
no signing.

### Path 2 — `.pkg` installer (corporate IT, polished UX)

Build a macOS Installer `.pkg` that bundles the canonical signed
`Duo.app` (copied from `/Applications/Duo.app` on the build machine —
the inner code signature + notarization travel intact inside the
payload) plus the pack folder. A postinstall script in the `.pkg`
drops the pack into the installing user's
`~/.claude/duo/extra-packs/<pack-name>/`, and Duo's install service
picks it up on next launch.

The `scripts/build-pkg.sh` wrapper handles `pkgbuild` + `productbuild`:

```bash
# 1. Install the canonical signed Duo DMG on the build machine so
#    /Applications/Duo.app is what you want to bundle.
# 2. From the Duo repo root:
bash scripts/build-pkg.sh --pack ~/Documents/<pack-name>/
# 3. Output lands in dist/<pack-name>-<pack-version>-installer.pkg.
```

Flags (see `bash scripts/build-pkg.sh --help`):

- `--pack <dir>` (required) — pack folder; reads name + version from
  `.claude-plugin/plugin.json`.
- `--output <path>` — override default output location.
- `--identifier <rdns>` — package identifier; default
  `com.duo.distro.<pack-name>.installer`.
- `--sign-identity <name>` — Developer ID **Installer** cert common
  name. Omit for an unsigned `.pkg`.
- `--duo-app <path>` — source `Duo.app` if not at the default
  `/Applications/Duo.app` (e.g. forks with a renamed bundle).

**Signed vs. unsigned `.pkg`.** The `.pkg`'s own signature is
independent of the inner `Duo.app`'s signature. Without
`--sign-identity` the produced `.pkg` is unsigned: Gatekeeper will
warn at install (`"unidentified developer"`), but right-click → Open
bypasses on a personal Mac and MDM-managed installs (Jamf / Munki /
Kandji) typically bypass Gatekeeper anyway. The inner `Duo.app`
remains signed + notarized regardless, so Gatekeeper is happy at app
launch every time. Producing an unsigned `.pkg` is the normal path
when the build machine can't get a Developer ID Installer cert.

**Notarization.** Not supported by an unsigned `.pkg`. If you have
the Installer cert, sign with `--sign-identity` then notarize
manually with `xcrun notarytool submit <pkg> --apple-id ... --wait`
followed by `xcrun stapler staple <pkg>`. Not wrapped by this script
because notarization credential management is org-specific.

### Path 3 — Fork + compile (early-adopter / pre-DMG-approval)

For companies whose security review hasn't blessed the upstream
signed DMG yet:

```bash
# 1. Fork dudgeon/duo (or maintain a private fork internally).
# 2. Drop your pack folder into a new top-level `bundled-distros/<distro-name>/`.
# 3. (Future follow-up — Duo's build pipeline copies bundled-
#    distros/ contents into Duo.app/Contents/Resources/bundled-distros/
#    on package time.)
# 4. Users clone the fork + `npm run dist` get an unsigned DMG with
#    the pack baked in. On first launch, Duo's install service finds
#    the bundled distro AND copies it to ~/.claude/duo/extra-packs/<name>/
#    so it joins the regular install flow.
```

---

## Update version

When you publish a new pack version:

1. Bump `.claude-plugin/plugin.json § version` (semver: patch / minor / major).
2. Update the marker version in the pack's `claude-md-snippet.md`
   automatically — Duo's CLAUDE.md merge logic uses the version
   in the manifest's marker, so there's nothing to edit by hand.
3. Re-validate.
4. Re-distribute (zip / .pkg / fork-merge).

End users' Duo install service detects the new version on next
launch (the install pipeline is atomic-replace: previous version's
tracked files are deleted before the new pack contents land). Owner
note: Duo never re-fires FTUX (`openOnFirstLaunch`) for an update —
only on first detection of a new pack name.

---

## Cross-references

- **PRD**: [`docs/prd/stage-21d-distro-packs.md`](../../../docs/prd/stage-21d-distro-packs.md)
- **Sample template**: [`examples/distro-pack-template/`](../../../examples/distro-pack-template/)
- **HOW-TO-FORK** § Layer 2.5 (drop-in distro packs):
  [`docs/HOW-TO-FORK.md`](../../../docs/HOW-TO-FORK.md)
- **Make a playground** (modality lock + browser-default): `make-playground.md`
- **Make a page** (canvas-default reference content): `make-page.md`
- **CLI surface**: `duo pack list` / `duo pack uninstall <name>`
