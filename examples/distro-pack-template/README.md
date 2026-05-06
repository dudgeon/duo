# Duo distro-pack template

A starter skeleton for shipping a Duo distro pack — a Claude Code
plugin folder + Duo `duo-extras/` subtree that ships your
organization's skills + agents + canvases + CLAUDE.md guidance to
end users on their canonical Duo installs.

## Quickstart

```bash
# 1. Copy the template to a new folder named for your distro:
cp -r examples/distro-pack-template ~/Documents/<your-distro-name>/

# 2. Edit the manifests:
#      .claude-plugin/plugin.json — name, version, description, author
#      duo-extras/DISTRO.json     — requiresDuoVersion + integration toggles

# 3. Replace the example skill + agent with your content:
#      skills/<your-skill-name>/SKILL.md
#      agents/<your-agent-name>.md

# 4. Validate (in a Claude Code session — the `pack-builder` skill
#    walks the validation contract):
#      "validate this distro pack: ~/Documents/<your-distro-name>/"

# 5. Distribute. For a drop-in pack:
zip -r your-distro-pack-1.0.zip <your-distro-name>/
# End user extracts the zip into ~/.claude/duo/extra-packs/<distro-name>/.
```

## Folder layout

```
distro-pack-template/
├── .claude-plugin/
│   └── plugin.json              ← Claude Code plugin manifest (identity)
├── duo-extras/
│   ├── DISTRO.json              ← Duo integration manifest (FTUX + toggles)
│   └── claude-md-snippet.md     ← merged into ~/.claude/CLAUDE.md (optional)
├── skills/
│   └── example-skill/
│       └── SKILL.md             ← installs to ~/.claude/skills/<distro>-example-skill/
└── agents/
    └── example-agent.md         ← installs to ~/.claude/agents/<distro>-example-agent.md
```

## Naming rules

Per the Stage 21d PRD + the Claude Code skill spec:

- **Distro name** (from `plugin.json § name`): lowercase + hyphens +
  numbers; **max 32 chars** (leaves room for skill names within
  Claude Code's 64-char skill folder limit).
- **Skill folder names**: same character set; combined
  `<distro>-<skill>` must be ≤64 chars.
- **Agent filenames**: same.

The `pack-builder` skill validates these at authoring time and warns
when names approach the 64-char limit (≥56 char buffer).

## What ships

When a user (or IT) drops your pack into `~/.claude/duo/extra-packs/`
on a canonical Duo install:

1. Duo discovers the pack on next launch.
2. The `requiresDuoVersion` range is checked — install hard-blocks if
   the running Duo doesn't satisfy.
3. Plugin source is decomposed into standalone destinations:
   - `skills/<name>/` → `~/.claude/skills/<distro>-<name>/`
   - `agents/<name>.md` → `~/.claude/agents/<distro>-<name>.md`
4. `duo-extras/claude-md-snippet.md` is merged into `~/.claude/CLAUDE.md`
   between distro-managed markers (coexists with Duo's own ENH-088
   block + other distros' blocks).
5. The pack appears in `duo pack list` output. A future install with
   the same distro name = atomic-replace (delete prior tracked files,
   install new contents).

## Distribution paths

Per `docs/HOW-TO-FORK.md` § Layer 2.5:

| Path | Use when | Effort |
|---|---|---|
| **Drop-in zip** | Manual download + extract; mass-deployable via Jamf / Munki | Lowest |
| **`.pkg` installer** | Bundle canonical Duo.app + your pack; signed with your distro's Developer ID Installer cert; postinstall script handles placement | Medium (cert work) |
| **Fork + compile** | Companies pre-DMG-approval; users clone your fork + `npm run dist`; pack baked into the unsigned DMG via `bundled-distros/<name>/` | Medium (fork maintenance) |

## Cross-references

- [`docs/prd/stage-21d-distro-packs.md`](../../docs/prd/stage-21d-distro-packs.md) — full PRD
- [`docs/HOW-TO-FORK.md`](../../docs/HOW-TO-FORK.md) — layered fork model (this template = Layer 2.5)
- `~/.claude/skills/duo/pack-builder/SKILL.md` — pack-builder skill (also at `skill/pack-builder/SKILL.md` in source)
- `duo pack list` / `duo pack uninstall <name>` — CLI for managing installed packs
