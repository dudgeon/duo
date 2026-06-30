import type { Meta, StoryObj } from '@storybook/react'
import { WriteWarningBanner } from './WriteWarningBanner'

// ENH-239 Phase 1 — the warn-before-overwrite banner. Pure presentational:
// host plumbs the action label, optional preview + agent, and accept/decline
// callbacks. Rendered in a constrained width to mirror its in-pane context.

const meta = {
  title: 'Editor/Primitives/WriteWarningBanner',
  component: WriteWarningBanner,
  args: {
    action: 'Replace the whole document',
    onAccept: () => {},
    onDecline: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 520 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WriteWarningBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithPreview: Story = {
  args: {
    action: 'Insert at the caret',
    preview: '## New section\n\nThe agent proposes appending this block to the end of the document…',
  },
}

export const CustomAgent: Story = { args: { agent: 'Codex' } }

export const WithExtra: Story = {
  args: { extra: <a href="#" className="duo-comment-thread__action-link">Save first</a> },
}
