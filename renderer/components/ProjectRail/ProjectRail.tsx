// ENH-182 — project rail (Phases 1 + 2 + 3).
//
// Renders the auto-derived project list as a thin vertical rail on the
// left edge of the app shell. Tiles render in the locked "quiet bloom"
// style (R1-B):
//   • Unfocused: paper-toned background, colored initials, thin
//     full-hue underline.
//   • Focused: full-hue fill, white initials, left-edge white notch.
//
// Phase 1 = read-only render. Phase 2 wires `focusedProject` + filter.
// Phase 3 (D12) adds the per-tile right-click menu: Pin/Unpin +
// "Close N terminals and M tabs". The rail stays a dumb view; all
// mutations route through callbacks the host provides (App.tsx owns
// pin toggling + bulk close + the live-process confirm).
//
// Design asset reference (do NOT redesign):
//   docs/research/assets/project-filter/rail-left.png
//   docs/research/assets/project-filter/rail-styles.png (variant B)
//   docs/research/assets/project-filter/tile-state.png (leftmost / Minimal)

import { useMemo } from 'react'
import type { Project, MenuTemplateItem } from '@shared/types'
import { computeProjectAbbreviations } from '@shared/projects'
import { PROJECT_COLOR_TOKENS } from '../../projectColors'

/** Phase 3 D12 — live counts of member tabs/terminals per project,
 *  used to build the bulk-close menu label and to confirm before
 *  closing a project with a live `claude` process. */
export interface ProjectCounts {
  terminals: number
  workingTabs: number
  /** True iff at least one member terminal is `kind: 'claude'`. The
   *  host gates the confirm dialog on this proxy; per-PID live
   *  claudePresence tracking for all terminals is a future
   *  enrichment. */
  hasClaudeKindTerminal: boolean
}

export interface ProjectRailProps {
  projects: ReadonlyArray<Project>
  /** Currently focused project root, or `null` for "All". */
  focusedProject: string | null
  /** ENH-210 — root of the project owning the single active surface
   *  (the focused terminal OR canvas/working tab). Used ONLY in All mode
   *  (`focusedProject === null`) to render a faint "you-are-here" pill on
   *  that project's tile. `null` when the active surface has no project. */
  activeProject?: string | null
  /** Called when a tile is clicked. Pass `null` for the All tile.
   *  Phase 1 may pass `undefined` to render in read-only mode (clicks
   *  are no-ops). */
  onFocus?: (root: string | null) => void
  /** Phase 3 D12 — `root → ProjectCounts` for menu label generation.
   *  Tiles whose root is absent here render the menu with `(0/0)`
   *  counts (defensive). */
  counts?: ReadonlyMap<string, ProjectCounts>
  /** Phase 3 D12 — toggle the persisted pin for `root`. */
  onTogglePin?: (root: string) => void
  /** Phase 3 D12 — bulk close every member terminal + working tab
   *  for `root`. The host owns the confirm-on-live-process dialog. */
  onCloseProject?: (root: string) => void
}

export function ProjectRail({
  projects,
  focusedProject,
  activeProject,
  onFocus,
  counts,
  onTogglePin,
  onCloseProject
}: ProjectRailProps) {
  // Word-aware, collision-free tile labels (ENH-186). Computed across
  // the whole visible set because disambiguation depends on which other
  // projects are showing. Recomputed only when the roots/names change.
  const abbreviations = useMemo(
    () => computeProjectAbbreviations(projects),
    [projects]
  )

  // Hide the rail entirely when no projects have surfaced yet. Avoids
  // an awkward empty rail on first launch / in a workspace with no
  // qualifying folders open.
  if (projects.length === 0) return null

  return (
    <aside
      role="navigation"
      aria-label="Project rail"
      className="w-[50px] shrink-0 flex flex-col items-center gap-1.5 py-2 border-r border-[color:var(--duo-paper-rule)] bg-[color:var(--duo-paper-deep)] select-none"
    >
      <AllTile focused={focusedProject === null} onClick={() => onFocus?.(null)} />
      {projects.map((p) => (
        <ProjectTile
          key={p.root}
          project={p}
          abbreviation={abbreviations.get(p.root) ?? '?'}
          focused={focusedProject === p.root}
          // ENH-210 — faint "you-are-here" pill: only in All mode, only
          // on the project owning the active surface, never when the tile
          // is already in the strong focused state.
          active={focusedProject === null && activeProject === p.root}
          onClick={() => onFocus?.(p.root)}
          counts={counts?.get(p.root)}
          onTogglePin={onTogglePin}
          onCloseProject={onCloseProject}
        />
      ))}
    </aside>
  )
}

interface AllTileProps {
  focused: boolean
  onClick: () => void
}

function AllTile({ focused, onClick }: AllTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="All projects"
      aria-pressed={focused}
      aria-label="Show all projects"
      data-project-tile="all"
      className={[
        'relative w-10 h-10 rounded-md flex items-center justify-center text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--duo-accent)]',
        focused
          ? 'bg-[color:var(--duo-accent)] text-white'
          : 'bg-[color:var(--duo-paper)] text-[color:var(--duo-ink-mute)] hover:text-[color:var(--duo-ink)] border border-[color:var(--duo-paper-rule)]'
      ].join(' ')}
    >
      All
      {focused && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-white"
        />
      )}
    </button>
  )
}

interface ProjectTileProps {
  project: Project
  /** Word-aware, collision-free tile label computed by the rail
   *  (ENH-186) — e.g. "ai-pm-tools" → "AP", or "APT" when it would
   *  otherwise collide with another `ai-pm-*` project. */
  abbreviation: string
  focused: boolean
  /** ENH-210 — render the faint "you-are-here" pill (All mode only;
   *  mutually exclusive with `focused`). */
  active?: boolean
  onClick: () => void
  counts?: ProjectCounts
  onTogglePin?: (root: string) => void
  onCloseProject?: (root: string) => void
}

function ProjectTile({
  project,
  abbreviation,
  focused,
  active = false,
  onClick,
  counts,
  onTogglePin,
  onCloseProject
}: ProjectTileProps) {
  const tint = PROJECT_COLOR_TOKENS[project.colorIndex] ?? PROJECT_COLOR_TOKENS[0]
  // ENH-210 — faint tinted fill for the active-surface tile in All mode.
  // Low-alpha mix of the project tint over transparent — same idiom family
  // as the globals.css faint tints (12%/22%). Clearly sub-focused vs the
  // focused state's full-hue fill. `active` is already gated to !focused
  // upstream. The fill itself lives in globals.css keyed off
  // data-active-surface (so hover:bg- still wins); only the per-project
  // tint flows through as a CSS custom property.

  // ENH-182 Phase 3 D12 — right-click context menu. Reuses the
  // generic menu.popup IPC (CLAUDE.md § 4 area 10 pattern), so the
  // tile stays a plain button + we get native NSMenu styling.
  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!onTogglePin && !onCloseProject) return
    const n = counts?.terminals ?? 0
    const m = counts?.workingTabs ?? 0
    const items: MenuTemplateItem[] = []
    if (onTogglePin) {
      items.push({
        id: project.pinned ? 'unpin' : 'pin',
        label: project.pinned ? 'Unpin from rail' : 'Pin to rail'
      })
    }
    if (onCloseProject && (n > 0 || m > 0)) {
      if (items.length > 0) items.push({ type: 'separator' })
      // Pluralize honestly so the menu reads naturally with edge
      // counts (1 terminal vs 2 terminals; 0 tabs hides the half).
      const termLabel = n === 1 ? '1 terminal' : `${n} terminals`
      const tabLabel = m === 1 ? '1 tab' : `${m} tabs`
      const label =
        n > 0 && m > 0
          ? `Close ${termLabel} and ${tabLabel}`
          : n > 0
            ? `Close ${termLabel}`
            : `Close ${tabLabel}`
      items.push({ id: 'close', label })
    }
    if (items.length === 0) return
    const result = await window.electron.menu.popup({
      items,
      x: e.clientX,
      y: e.clientY
    })
    if (result.chosenId === 'pin' || result.chosenId === 'unpin') {
      onTogglePin?.(project.root)
    } else if (result.chosenId === 'close') {
      onCloseProject?.(project.root)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`Project: ${project.name}`}
      aria-pressed={focused}
      aria-label={`Focus ${project.name} (${project.root})`}
      data-project-tile={project.root}
      data-active-surface={active ? 'true' : undefined}
      className={[
        'relative w-10 h-10 rounded-md flex items-center justify-center text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--duo-accent)]',
        focused
          ? 'text-white'
          : 'text-[color:var(--duo-ink)] hover:bg-[color:var(--duo-paper)]'
      ].join(' ')}
      style={
        focused
          ? { background: tint }
          : active
            ? ({ '--rail-active-tint': tint } as React.CSSProperties)
            : undefined
      }
    >
      <span style={!focused ? { color: tint } : undefined}>{abbreviation}</span>
      {/* Quiet-bloom underline — colored hint when not focused. Hidden
          on focus since the full-hue background is the bloom. */}
      {!focused && (
        <span
          aria-hidden="true"
          className="absolute bottom-1 left-2 right-2 h-[2px] rounded-full"
          style={{ background: tint }}
        />
      )}
      {/* Focused notch — white pip on the left edge per the R1-B
          mockup. */}
      {focused && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-white"
        />
      )}
      {/* Phase 3 D12 — small pin marker on pinned tiles so the user
          can tell at a glance which tiles survive close-all. Renders
          on every tile state (focused / unfocused) because pinned-
          ness is orthogonal to focus. */}
      {project.pinned && (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full"
          style={{ background: focused ? 'white' : tint }}
        />
      )}
    </button>
  )
}
