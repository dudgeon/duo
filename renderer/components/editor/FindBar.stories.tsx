import type { Meta, StoryObj } from '@storybook/react'
import { FindBar } from './FindBar'

// ENH-239 Phase 1 — the markdown editor's find strip. It reads match counts
// from a live TipTap FindHighlight extension, but every editor access is
// null-guarded (editor?.commands.*), so the bar renders standalone with
// editor={null} — the counter just shows empty. open=false renders nothing.
const meta = {
  title: 'Editor/FindBar',
  component: FindBar,
  args: {
    editor: null,
    open: true,
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 520, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FindBar>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}

// open=false → the bar unmounts (renders null). Documents the closed state.
export const Closed: Story = { args: { open: false } }
