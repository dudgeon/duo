# Codex Instructions

`CLAUDE.md` is canonical for this repository. Read it before substantive work
and follow it, translating Claude-specific mechanics to Codex equivalents.

## Claude-to-Codex translations

- `AskUserQuestion`: ask concise questions only when needed; otherwise state
  assumptions and proceed.
- Claude skills under `.claude/skills/**`: read the relevant `SKILL.md`
  directly and follow the workflow manually.
- `/smoke-walk`: use `.claude/skills/smoke-walk/SKILL.md`.
- Path-scoped rules under `.claude/rules/**`: read the relevant rule when
  touching matching files listed in `CLAUDE.md`.

## Canonical skills

The canonical skill sources are:

- `.claude/skills/cut-version/SKILL.md`
- `.claude/skills/smoke-walk/SKILL.md`
- `.claude/skills/sprint-plan/SKILL.md`
- `.claude/skills/worksheet/SKILL.md`

Do not mirror these into a second Codex-specific skill tree unless there is a
clear runtime need. Update `.claude/skills/**` instead.

## Maintenance rule

Do not duplicate project rules here. Update `CLAUDE.md`, `.claude/rules/**`,
and `.claude/skills/**` as the source of truth.
