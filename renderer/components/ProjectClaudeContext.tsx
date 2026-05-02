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
// future expansion (.cursorrules, etc.) can land in a follow-up.
//
// ENH-045a (v0.6.3) — collapsible + dynamic project name.
// Default collapsed (per owner: "should default to collapsed");
// click the header to toggle. Section title resolves to the
// project's name: package.json `name` field if present, otherwise
// the last segment of cwd. Toggle state persists across sessions
// in localStorage. ENH-045b (gh status) and ENH-045c (project
// promote / sync) are deliberately out of this commit's scope.

import { useEffect, useMemo, useState } from 'react'
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
const COLLAPSED_KEY = 'duo:project-claude-context:collapsed'

function loadCollapsed(): boolean {
  // Default collapsed (per ENH-045a) — only return false when the
  // user has explicitly expanded.
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* private mode / quota — best-effort */
  }
}

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

  // ENH-045a — resolve the project's display name. Precedence:
  //   1. package.json `name` field at cwd (if file exists + valid)
  //   2. Last segment of cwd (folder name)
  // Cached per cwd so the name doesn't flicker between resolutions.
  // Fallback name is the folder; package.json read is async + may
  // upgrade the displayed name once it lands.
  const folderName = useMemo(() => {
    const cwd = state.cwd
    const trimmed = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd
    const idx = trimmed.lastIndexOf('/')
    return idx === -1 ? trimmed : trimmed.slice(idx + 1)
  }, [state.cwd])

  const [pkgName, setPkgName] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setPkgName(null)
    const pkgPath = `${state.cwd.replace(/\/$/, '')}/package.json`
    void window.electron.files.read(pkgPath).then(result => {
      if (cancelled || !result || !result.bytes) return
      try {
        const text = new TextDecoder().decode(result.bytes)
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed.name === 'string' && parsed.name.length > 0) {
          setPkgName(parsed.name)
        }
      } catch {
        /* not JSON / no name field — fall back to folderName */
      }
    }).catch(() => {
      /* no package.json — fine, fall back */
    })
    return () => { cancelled = true }
  }, [state.cwd])

  const projectName = pkgName ?? folderName

  // Collapsed state — initialized from localStorage (default true).
  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed)
  useEffect(() => { saveCollapsed(collapsed) }, [collapsed])

  // Don't render the group at all when no candidates exist — keeps
  // projects without Claude context (a fresh repo, the user's
  // ~/Downloads, etc.) from showing an empty section header.
  if (!candidates || candidates.length === 0) return null

  return (
    <div className="border-b border-paper-edge mb-1 pb-1">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        // ENH-045a — header is now a clickable toggle. Tooltip
        // explains the group + names the source files.
        title={`Files in this project that apply to Claude sessions started here: ${CANDIDATE_NAMES.join(', ')}. Click to ${collapsed ? 'expand' : 'collapse'}.`}
        className="w-full flex items-center gap-1 px-2 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide uppercase text-ink-mute hover:text-ink-soft transition-colors"
        aria-expanded={!collapsed}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          aria-hidden="true"
          className={[
            'shrink-0 transition-transform',
            collapsed ? '' : 'rotate-90'
          ].join(' ')}
        >
          <path d="M2.5 1.5l3 2.5-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="truncate">{projectName} Claude context</span>
      </button>
      {!collapsed && (
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
      )}
    </div>
  )
}
