import type { Meta, StoryObj } from '@storybook/react'
import { Breadcrumb } from './Breadcrumb'

// ENH-239 Phase 1 — the navigator's top breadcrumb bar ({ cwd, home,
// onNavigate, … }). Rendered in a navigator-width slot so the segment
// truncation + pan-right behavior read in context.
const meta: Meta<typeof Breadcrumb> = {
  title: 'Chrome/Breadcrumb',
  component: Breadcrumb,
  args: {
    cwd: '/Users/geoff/Documents/GitHub/duo',
    home: '/Users/geoff',
    onNavigate: () => {},
    onRevealFile: () => {},
    onSegmentContextMenu: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AtHome: Story = { args: { cwd: '/Users/geoff' } }

export const DeepPath: Story = {
  args: { cwd: '/Users/geoff/Documents/GitHub/duo/renderer/components/editor' },
}

export const OutsideHome: Story = {
  args: { cwd: '/tmp/scratch/project' },
}
