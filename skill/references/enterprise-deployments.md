# Duo in enterprise / managed Claude Code installs

> **What this is.** A reference for Duo users (and their admins)
> running Claude Code in policy-restricted environments — hooks
> disabled, locked-down `settings.json`, managed `~/.claude/`
> directories, restrictive `permissions.deny` rules. Documents what
> Duo features work, what's policy-dependent, and what to do when
> something doesn't fire as expected.
>
> Companion to `references/sandbox-troubleshooting.md` (which covers
> the inverse case — `duo` CLI commands hanging because of Claude
> Code's Bash tool sandbox blocking Unix-socket I/O).

## Contents

- [Mechanism dependency map](#mechanism-dependency-map)
- [Common enterprise restrictions](#common-enterprise-restrictions)
- [What still works (the hook-free path)](#what-still-works-the-hook-free-path)
- [Reporting a Duo issue from a managed install](#reporting-a-duo-issue-from-a-managed-install)
- [Cross-references](#cross-references)

---

## Mechanism dependency map

Duo's onboarding stack reaches the user's Claude through four
mechanisms with different dependencies:

| Mechanism | Hook-dependent? | Settings.json-dependent? | Fires when |
|---|---|---|---|
| Managed block in `~/.claude/CLAUDE.md` | **No** | **No** | Always (Claude Code's core context loader reads CLAUDE.md every session) |
| PATH shim (`~/.claude/duo/bin/claude`) | No | No | `DUO_SESSION=1` Duo PTYs (the shim is what runs `claude` inside Duo) |
| SessionStart hook (`~/.claude/settings.json`) | **Yes** | **Yes** | `DUO_SESSION=1` Duo PTYs, when hooks aren't disabled |
| `~/.claude/skills/duo/` registry | No | No | Always (skill discovery is filesystem-based) |
| `~/.claude/agents/duo.md` registry | No | No | Always (subagent discovery is filesystem-based) |

**Load-bearing path** (always works in any Claude Code install): the
managed CLAUDE.md block + the skill / agent registries. Together
they let any Claude Code session reach for the `duo` skill or the
`duo` subagent when the user references Duo's surfaces, regardless
of policy.

**Best-effort enhancements**: the SessionStart hook (priming for
in-Duo PTYs) and the PATH shim (load-bearing for in-Duo PTYs only).
Both fail open — if they don't run, Duo still works; the agent just
doesn't get the priming context until it triggers a skill load.

---

## Common enterprise restrictions

### Hooks disabled

Some managed Claude Code installs run with all hooks suppressed via
policy. Symptom: `~/.claude/settings.json` may have hook entries
(including Duo's tagged `_duo: managed-vX.Y.Z` SessionStart entry),
but they don't fire. The `duo events --follow` output is unaffected
(events flow through Duo's own bus, not Claude Code's hooks); only
the priming-on-session-start path is silenced.

**Impact on Duo:** none for in-Duo sessions (the PATH shim is the
load-bearing priming path; the hook is the redundant safety net).
None for non-Duo Claude Code sessions either, because the managed
block in `~/.claude/CLAUDE.md` reaches them via the core context
loader instead.

**Action:** none. Document in the user's setup notes that Duo
priming relies on filesystem mechanisms, not hooks.

### Restrictive `permissions.deny` (Bash tool allowlist)

Managed installs commonly restrict the Bash tool to an explicit
allowlist. If `Bash(duo:*)` isn't in the allowlist, every `duo` CLI
call from inside a Claude Code session is denied. This is the
sandbox issue described in
`references/sandbox-troubleshooting.md`, but with a policy lock
rather than a session-scoped sandbox.

**Symptom:** the agent reports `duo` calls hang or return
"permission denied"; the Bash tool denial may surface as no output
at all.

**Action:** the user's admin needs to add an explicit allowlist
entry for `Bash(duo:*)` in the organization-level Claude Code
settings. The entry can be narrow (specific verbs like
`Bash(duo url:*)`, `Bash(duo edit:*)`) if a blanket allow is
unacceptable.

### Locked-down `~/.claude/` directory

Some installs use a managed skills directory (e.g. mounted
read-only, or synced from a central template). Duo's installer
writes to `~/.claude/skills/duo/`, `~/.claude/agents/duo.md`,
`~/.claude/duo/`, and `~/.claude/CLAUDE.md` — all of which require
the user's Claude home to be writable.

**Symptom:** Duo's install banner reports a write failure with the
specific path. The skill / agent registry remains uninstalled.

**Action:** the user needs write access to those locations. Most
managed environments leave `~/.claude/` user-writable even when
specific subdirectories (like `~/.claude/policies/`) are locked.
File a Duo issue with the specific path that was rejected.

### Custom CLAUDE.md authority

Enterprise users may have an organization-mandated
`~/.claude/CLAUDE.md` (e.g. internal coding standards, prohibited
APIs). Duo's managed-block insert treats this case correctly:

- If the file exists and contains the `<!-- duo:managed-v* -->`
  marker, Duo's installer version-replaces only that block; the
  org-mandated content is untouched.
- If the file exists and lacks the marker, Duo's installer
  appends the block (preserving the org content above).
- The user can remove the block at any time; once
  `claudeMdManaged: true` is recorded in
  `~/.claude/duo/installed.json`, future Duo installs respect that
  removal and never re-add the block.

**Action:** none. The merge logic is designed to coexist with
org-mandated CLAUDE.md content.

---

## What still works (the hook-free path)

Even with hooks disabled, restrictive Bash policies, and a managed
skills directory blocking the registry install, the **managed
CLAUDE.md block reaches every session**. Duo's surfaces (the
browser pane, the editor, the file tree, the canvas) are still
referenced by name; Claude knows where to look for the skill once
it can see the registry. If the registry is also blocked, the
user's CLAUDE.md block is enough to point Claude at the project
docs (`https://github.com/dudgeon/duo`).

**Concretely working in a fully-locked install:**

- The user opens Claude Code in any terminal and asks "what's
  selected in my Duo browser?"
- Claude has read the managed CLAUDE.md block; knows Duo exists.
- Claude can read the project docs at the GitHub link.
- Claude still can't run `duo` CLI verbs (Bash policy block) — so
  it reports "I see Duo is installed but I can't drive it; ask
  your admin to add `Bash(duo:*)` to the allowlist, or paste the
  selection here manually."

That last fallback is the floor — even when nothing else works,
the user has a path forward.

---

## Reporting a Duo issue from a managed install

If Duo isn't behaving as expected in a managed environment, the
following information helps diagnose:

1. **Which mechanism failed?** PATH shim, SessionStart hook,
   managed CLAUDE.md block, skill registry, agent registry, CLI
   call. The dependency map above tells you which is responsible
   for each behavior.
2. **What does `duo` CLI report?**
   ```bash
   duo doctor      # version, cli location, and whether the bridge is reachable from this terminal
   ```
3. **Which paths are writable?**
   ```bash
   ls -la ~/.claude/ | head
   ```
   A short `ls -la` is usually enough to confirm whether the user
   has write access to the relevant locations.
4. **What policies are in effect?** Your admin can tell you which
   Bash allowlist rules apply, whether hooks are disabled
   org-wide, and whether `~/.claude/` has any read-only mounts.
5. **What does Duo's install banner say?** First-launch installer
   surfaces specific failures (cli copy denied, settings.json
   write denied, etc.). Copy that text into the issue.

File issues at `https://github.com/dudgeon/duo/issues` with the
above. Tag with `enterprise` so they sort correctly. Attach the
specific Claude Code error text — "the agent said it can't run
`duo` here" with no further detail is much harder to diagnose
than the actual stderr / Bash-tool-denial output.

---

## Cross-references

- **Sandbox + transport issues** — `references/sandbox-troubleshooting.md`
  (the session-scoped Bash sandbox version of the policy issue
  above).
- **Duo installer source** — `electron/install-service.ts § install`
  in the source repo. The four-scenario CLAUDE.md merge logic
  lives in the exported `planClaudeMdMerge` function next to
  `composeManagedClaudeMdBlock`. Unit tests cover the four
  scenarios.
