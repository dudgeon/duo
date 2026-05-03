// Stage 22 — "Your Claude settings" pane (top half of the navigator).
//
// Renders a small, opinionated view of `~/.claude/`:
//
//   - Curated mode (default): three items the user actually edits —
//     `CLAUDE.md` (file), `skills/` (folder, expandable), `agents/`
//     (folder, expandable). Other entries under `~/.claude/` (mcp/,
//     hooks/, plans/, projects/, bin/, duo/, settings.json, etc.)
//     are hidden so the surface stays focused on "the agent reads
//     these things; if you want it to behave differently, edit
//     here."
//   - Show-all mode: every entry under `~/.claude/`, for power users.
//
// The pane is collapsible. Header label is "Your Claude settings"
// (plain English, not the literal `~/.claude/` path) per the
// pedagogy goal: teach non-technical PMs that the agent reads from
// BOTH user-level and project-level context buckets without making
// them learn dotfile conventions.

import { useState } from 'react'
import { FileTree } from './FileTree'
import type { DirEntry } from '@shared/types'
import type { UserClaudeNavigatorApi } from '../hooks/useUserClaudeNavigator'

const LS_KEY_COLLAPSED = 'duo.userClaude.collapsed'

interface UserClaudePaneProps {
  nav: UserClaudeNavigatorApi
  onOpenFile: (entry: DirEntry) => void
  onOpenTerminalHere: (folderPath: string) => void
  focused: boolean
}

export function UserClaudePane({
  nav,
  onOpenFile,
  onOpenTerminalHere,
  focused
}: UserClaudePaneProps) {
  // ENH-012 (Stage 26 PR 2 fold-in) — default to COLLAPSED on first launch.
  // Most users live in the project tree; the user-claude pane is a
  // settings-discovery aid that's noisy when always-open. Default-collapsed
  // gives the project tree more vertical real estate. Users who explicitly
  // expand it have their preference persisted in localStorage. Treat
  // anything that isn't '0' as collapsed (including the previous default
  // for users upgrading mid-state).
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY_COLLAPSED) !== '0' } catch { return true }
  })

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(LS_KEY_COLLAPSED, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div
      className={[
        // The pane sits above ProjectPane; bottom border separates them.
        // ENH-086 (v0.6.5) — surface-level differentiation between
        // user-level (~/.claude/) and project-local context. The
        // user-claude pane sits on `bg-paper-edge` while the project
        // tree below stays on the parent's `bg-surface-1` (paper-deep),
        // so they read as two distinct surfaces. The divider bumps from
        // `border-paper-edge` to `border-paper-rule` (one step darker)
        // since the bg-edge would otherwise blend with the surface tone.
        // Stage 26 PR 3 item 10 first added the 2px thickness; ENH-086
        // adds the surface tint.
        'flex flex-col border-b-2 border-paper-rule shrink-0 bg-paper-edge transition-colors',
        focused ? 'bg-accent-soft' : ''
      ].join(' ')}
      aria-label="Your Claude settings"
    >
      {/* Header: collapsible label + show-all toggle. The toggle hides
          when the pane is collapsed (no contents to filter). */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className={[
          'flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium tracking-wide uppercase text-left leading-tight transition-colors',
          'text-ink-mute hover:text-accent-ink'
        ].join(' ')}
        // ENH-008 — explain what the pane shows + where the files
        // live for users who haven't grokked the dotfile convention.
        // Tooltip is the lightest surface — `title` attribute gets
        // browser-native tooltip behavior with no styling cost. A
        // future polish could replace with a custom tooltip
        // component, but title-attr is the right v1 footprint.
        title={
          collapsed
            ? 'Expand Your Claude settings'
            : 'Files at ~/.claude/ that apply to ALL of your Claude Code sessions, not just this project. Edit them to teach Claude your preferences globally.'
        }
      >
        <Chevron open={!collapsed} />
        <span className="flex-1">Your Claude settings</span>
        {!collapsed && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              nav.setShowAll(!nav.showAll)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                nav.setShowAll(!nav.showAll)
              }
            }}
            className={[
              'text-[10px] font-normal normal-case tracking-normal px-1.5 py-0.5 rounded transition-colors',
              nav.showAll
                ? 'bg-accent-soft text-accent-ink'
                : 'text-ink-ghost hover:text-accent-ink hover:bg-surface-2'
            ].join(' ')}
            title={nav.showAll
              ? 'Showing all of ~/.claude/. Click to show only the curated three.'
              : 'Showing CLAUDE.md, skills/, agents/. Click to show all of ~/.claude/.'}
          >
            {nav.showAll ? 'Curated' : 'Show all'}
          </span>
        )}
      </button>

      {/* Tree body. Hidden when collapsed; otherwise drives FileTree
          with either the curated root (when showAll=false) or the
          full `~/.claude/` listing (when showAll=true). */}
      {!collapsed && (
        <div
          // Cap the height so the project pane below always has room.
          // 36vh is roughly enough for ~12 visible rows + the toggle
          // affordance; user can scroll if their `~/.claude/` is dense.
          // A future polish item: make this resizable by dragging the
          // bottom seam.
          className="overflow-auto scrollbar-none"
          style={{ maxHeight: '36vh' }}
        >
          <FileTree
            state={nav.state}
            actions={nav.actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={onOpenTerminalHere}
            rootEntriesOverride={nav.showAll ? undefined : nav.curatedRootEntries}
          />
        </div>
      )}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 transition-transform text-ink-ghost ${open ? 'rotate-90' : ''}`}
    >
      <path d="M3.5 2.5L6.5 5l-3 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
