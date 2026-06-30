import type { Meta, StoryObj } from '@storybook/react'
import type { Project } from '@shared/types'
import { ProjectRail } from './ProjectRail'

// ENH-239 Phase 1 — the auto-derived project rail (ENH-182). A thin vertical
// rail of tinted tiles on the left edge of the shell. Pure view: all
// mutations route through host callbacks. Rendered against the paper-deep
// rail tone in a tall slot to mirror its real context.
const PROJECTS: Project[] = [
  { root: '/Users/preview/code/duo', name: 'duo', isGitRoot: true, hasMarker: true, colorIndex: 0, pinned: false },
  { root: '/Users/preview/code/home-brain', name: 'home-brain', isGitRoot: true, hasMarker: true, colorIndex: 1, pinned: true },
  { root: '/Users/preview/code/agents', name: 'agents', isGitRoot: false, hasMarker: true, colorIndex: 2, pinned: false },
]

const meta = {
  title: 'Page/ProjectRail',
  component: ProjectRail,
  args: {
    projects: PROJECTS,
    focusedProject: null,
    onFocus: () => {},
    onTogglePin: () => {},
    onCloseProject: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 360, display: 'inline-flex' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectRail>

export default meta
type Story = StoryObj<typeof meta>

// "All" tile focused (focusedProject === null).
export const AllFocused: Story = {}

// A specific project focused → full-hue fill + white initials + left notch.
export const ProjectFocused: Story = {
  args: { focusedProject: '/Users/preview/code/duo' },
}

// All mode with a faint "you-are-here" pill on the active-surface tile.
export const ActiveSurfacePill: Story = {
  args: { focusedProject: null, activeProject: '/Users/preview/code/agents' },
}

// Empty project set → the rail hides itself entirely (renders null).
export const Empty: Story = { args: { projects: [] } }
