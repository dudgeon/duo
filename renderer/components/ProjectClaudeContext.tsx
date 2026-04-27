// Stage 22 — "Project Claude context" group at the top of the
// bottom pane.
//
// Surfaces the project-level files Claude reads when the agent is
// run from this project root: `./CLAUDE.md` (project memory),
// `./.claude/` (project-scoped skills, agents, settings), and
// `./tasks.md` (the de-facto bug + backlog file the duo project
// uses; many other projects pick up the same convention). Each
// entry that exists on disk renders as a tree-node row with the
// same interaction model as the regular tree below — click a file
// to open it in the WorkingPane, click a folder to expand it
// inline.
//
// Renders nothing if none of the candidate files exist (so the
// group doesn't pollute the navigator for projects that have no
// Claude context yet). The candidate set is intentionally small;
// future expansion (AGENTS.md, .cursorrules, etc.) can land in a
// follow-up.

import { useMemo } from 'react'
import { TreeNodes } from './FileTree'
import type { DirEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'

interface ProjectClaudeContextProps {
  state: NavigatorState
  actions: NavigatorActions
  onOpenFile: (entry: DirEntry) => void
  onOpenTerminalHere: (folderPath: string) => void
}

const CANDIDATE_NAMES = ['CLAUDE.md', '.claude', 'tasks.md', 'AGENTS.md']

export function ProjectClaudeContext({
  state,
  actions,
  onOpenFile,
  onOpenTerminalHere
}: ProjectClaudeContextProps) {
  // Pull the candidates out of the cwd's listing — same source the
  // bottom tree renders, so we avoid a second fs round-trip and stay
  // in sync with chokidar updates automatically.
  const candidates = useMemo<DirEntry[] | null>(() => {
    const root = state.listings.get(state.cwd)
    if (!root) return null
    const found: DirEntry[] = []
    for (const name of CANDIDATE_NAMES) {
      const hit = root.find(e => e.name === name)
      if (hit) found.push(hit)
    }
    return found
  }, [state.listings, state.cwd])

  // Don't render the group at all when no candidates exist — keeps
  // projects without Claude context (a fresh repo, the user's
  // ~/Downloads, etc.) from showing an empty section header.
  if (!candidates || candidates.length === 0) return null

  return (
    <div className="border-b border-paper-edge mb-1 pb-1">
      <div
        className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide uppercase text-ink-mute"
        // ENH-008 — symmetric tooltip with UserClaudePane's
        // "Your Claude settings" header. Explains what THIS group
        // shows + where the files live (in this project's repo).
        title="Files in this project's repo that apply to Claude sessions started here. CLAUDE.md, .claude/, tasks.md, AGENTS.md — Duo surfaces them here when present."
      >
        Project Claude context
      </div>
      <TreeNodes
        entries={candidates}
        depth={0}
        state={state}
        actions={actions}
        onOpenFile={onOpenFile}
        onContextMenu={(e, entry) => {
          // Folder right-click → "Open terminal here" stays useful;
          // file right-click is owned by the regular FileTree's menu
          // (we can't easily portal a context menu out of a sibling
          // without refactoring ContextMenu — TODO for the navigator
          // polish bundle). For v1 we suppress the menu and let users
          // right-click the same file in the regular tree below.
          e.preventDefault()
          if (entry.kind === 'directory') onOpenTerminalHere(entry.path)
        }}
      />
    </div>
  )
}
