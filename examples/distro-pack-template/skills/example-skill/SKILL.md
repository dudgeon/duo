---
description: Example skill for the distro-pack-template. Replace this body with your organization's actual skill content. After install, this skill is reachable as `/example-distro-example-skill` in any Claude Code session on the user's machine (auto-discovered from `~/.claude/skills/`).
---

# Example skill

This file is a placeholder. Replace the frontmatter `description` and
this body with your organization's skill content.

## After install

This skill installs to `~/.claude/skills/<distro-name>-example-skill/SKILL.md`.
The `<distro-name>-` prefix is added by Duo's install service at copy
time using the distro name from `.claude-plugin/plugin.json § name`.

So if your `plugin.json` says `"name": "aip-corporate"`, this skill
becomes `aip-corporate-example-skill` and is invoked as
`/aip-corporate-example-skill` in Claude Code.

## Naming constraints

- The combined `<distro-name>-<skill-folder-name>` must be ≤64 chars
  (Claude Code spec).
- Lowercase letters, numbers, and hyphens only.
- The pack-builder skill validates these at authoring time.

## Supporting files

You can include supporting files in this folder (referenced from
`SKILL.md`):

```
example-skill/
├── SKILL.md             ← this file
├── reference.md         ← detailed reference; loaded only when needed
├── examples/
│   └── sample.md
└── scripts/
    └── helper.sh        ← Claude can execute via Bash if allowed
```

See `~/.claude/skills/duo/SKILL.md` for examples of structuring a
larger skill with supporting files.
