// Navigator Claude-context fill — see docs/DECISIONS.md
// "Navigator: Claude-context surfacing & worktree indicator".
//
// A faint terracotta wash (`.bg-claude-context`, defined in globals.css)
// marks the files Claude reads as project context: the `./.claude/`
// directory + its entire subtree, and the top-level `./CLAUDE.md`. This
// is the always-on replacement for the old collapsible "Project Claude
// context" panel, and it narrows that panel's broader CANDIDATE_NAMES
// (`CLAUDE.md`, `.claude`, `tasks.md`, `AGENTS.md`) to the two
// load-bearing entries that actually get the wash.
//
// Pure + path-based on purpose: the navigator's directory listings are
// lazy (children load only on expand), so a precomputed Set of `.claude/`
// descendants can't be enumerated for unexpanded folders. A path test
// holds regardless of load state and runs only on the rows rendered.

/**
 * True when `absPath` should carry the Claude-context fill:
 *  - the `.claude/` directory at the project root, or anything inside it, or
 *  - the top-level `CLAUDE.md` at `projectRoot` (the navigator's cwd).
 *    Nested `CLAUDE.md` files are intentionally left un-washed.
 *
 * Anchored to `projectRoot` rather than matching a bare `.claude` path
 * segment: Duo worktrees live at `…/.claude/worktrees/<name>`, so a segment
 * match paints the ENTIRE tree of any worktree (every file's absolute path
 * contains `.claude/`). Root-anchoring is what prevents that.
 */
export function isClaudeContextPath(absPath: string, projectRoot: string): boolean {
  const root = projectRoot.replace(/\/+$/, '')
  // The `.claude/` directory at the root + its entire subtree. Exact-match
  // + slash-prefix also guards `…/my.claude.backup` and `…/.claude.md`.
  if (absPath === `${root}/.claude` || absPath.startsWith(`${root}/.claude/`)) return true
  // The top-level CLAUDE.md (project root).
  if (absPath === `${root}/CLAUDE.md`) return true
  return false
}
