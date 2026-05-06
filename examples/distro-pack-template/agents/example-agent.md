---
name: example-agent
description: Example subagent for the distro-pack-template. Replace this body with your organization's actual agent content. After install, this agent is reachable as `<distro-name>-example-agent` in any Claude Code session.
---

# Example agent

This file is a placeholder. Replace the frontmatter + this body with
your organization's actual subagent definition.

## After install

This agent installs to
`~/.claude/agents/<distro-name>-example-agent.md` (the `<distro-name>-`
prefix is added by Duo at copy time from `plugin.json § name`).

## Format

This file follows Claude Code's standard subagent format. See
`~/.claude/agents/duo.md` for a reference example, and the
[Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents)
for the canonical format spec.

A typical subagent body declares:
- The role (what does this agent do?)
- The tools available (which Bash / Edit / Read tools are pre-approved?)
- The voice / behavioral guardrails specific to your team
