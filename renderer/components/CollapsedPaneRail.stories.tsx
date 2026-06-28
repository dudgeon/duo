import type { Meta, StoryObj } from '@storybook/react'
import { CollapsedPaneRail } from './CollapsedPaneRail'

// ENH-239 Phase 1 — pure presentational rail ({ kind, onExpand }). Rendered in
// a narrow paper-toned slot to mirror its real collapsed-pane context.
const meta = {
  title: 'Chrome/CollapsedPaneRail',
  component: CollapsedPaneRail,
  args: { onExpand: () => {} },
  decorators: [
    (Story) => (
      <div style={{ height: 320, width: 44, background: 'var(--duo-paper)', border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CollapsedPaneRail>

export default meta
type Story = StoryObj<typeof meta>

export const Terminal: Story = { args: { kind: 'terminal' } }
export const Canvas: Story = { args: { kind: 'canvas' } }
