// ENH-182 Phase 1 — read-only project rail.
//
// Renders the auto-derived project list as a thin vertical rail on the
// left edge of the app shell. Tiles render in the locked "quiet bloom"
// style (R1-B):
//   • Unfocused: paper-toned background, colored initials, thin
//     full-hue underline.
//   • Focused: full-hue fill, white initials, left-edge white notch.
//
// Phase 1 is read-only — the rail receives `focusedProject` as a prop
// but doesn't yet toggle it. The `onFocus` callback is wired through
// so Phase 2 can drop in the actual filter behavior without touching
// this component.
//
// Design asset reference (do NOT redesign):
//   docs/research/assets/project-filter/rail-left.png
//   docs/research/assets/project-filter/rail-styles.png (variant B)
//   docs/research/assets/project-filter/tile-state.png (leftmost / Minimal)

import type { Project } from '@shared/types'

/** Map colorIndex (0..5) → CSS var. Mirrors the six `--duo-project-*`
 *  tokens in `renderer/styles/globals.css` (which themselves mirror the
 *  Atelier kernel at `skill/references/duo-atelier.css`). */
const PROJECT_COLOR_TOKENS = [
  'var(--duo-project-pine)',
  'var(--duo-project-harbor)',
  'var(--duo-project-iris)',
  'var(--duo-project-plum)',
  'var(--duo-project-rose)',
  'var(--duo-project-moss)'
] as const

export interface ProjectRailProps {
  projects: ReadonlyArray<Project>
  /** Currently focused project root, or `null` for "All". */
  focusedProject: string | null
  /** Called when a tile is clicked. Pass `null` for the All tile.
   *  Phase 1 may pass `undefined` to render in read-only mode (clicks
   *  are no-ops). */
  onFocus?: (root: string | null) => void
}

export function ProjectRail({ projects, focusedProject, onFocus }: ProjectRailProps) {
  // Hide the rail entirely when no projects have surfaced yet. Avoids
  // an awkward empty rail on first launch / in a workspace with no
  // qualifying folders open.
  if (projects.length === 0) return null

  return (
    <aside
      role="navigation"
      aria-label="Project rail"
      className="w-14 shrink-0 flex flex-col items-center gap-1.5 py-2 border-r border-[color:var(--duo-paper-rule)] bg-[color:var(--duo-paper-deep)] select-none"
    >
      <AllTile focused={focusedProject === null} onClick={() => onFocus?.(null)} />
      {projects.map((p) => (
        <ProjectTile
          key={p.root}
          project={p}
          focused={focusedProject === p.root}
          onClick={() => onFocus?.(p.root)}
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
  focused: boolean
  onClick: () => void
}

function ProjectTile({ project, focused, onClick }: ProjectTileProps) {
  const tint = PROJECT_COLOR_TOKENS[project.colorIndex] ?? PROJECT_COLOR_TOKENS[0]
  // Up to two characters from the project name. Strip a leading dot
  // (".claude" should never qualify on its own but be defensive) and
  // collapse to a single uppercase initial if the name is one char.
  const cleaned = project.name.replace(/^\./, '')
  const initials = (cleaned.slice(0, 2) || '?').toUpperCase()

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${project.name}\n${project.root}`}
      aria-pressed={focused}
      aria-label={`Focus ${project.name}`}
      data-project-tile={project.root}
      className={[
        'relative w-10 h-10 rounded-md flex items-center justify-center text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--duo-accent)]',
        focused
          ? 'text-white'
          : 'text-[color:var(--duo-ink)] hover:bg-[color:var(--duo-paper)]'
      ].join(' ')}
      style={focused ? { background: tint } : undefined}
    >
      <span style={!focused ? { color: tint } : undefined}>{initials}</span>
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
    </button>
  )
}
