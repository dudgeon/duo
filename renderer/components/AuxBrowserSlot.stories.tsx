import type { Meta, StoryObj } from '@storybook/react'
import { AuxBrowserSlot } from './AuxBrowserSlot'

// ENH-239 Phase 1 — aux-pane browser slot header + bounds host. The web content
// itself lives in a main-process WebContentsView (positioned over the empty
// host div via setAuxBounds IPC, mocked by the decorator); only the header band
// is real DOM here. Wrapped in a sized slot so the flex-fill host has a height.
const meta = {
  title: 'Modals/AuxBrowserSlot',
  component: AuxBrowserSlot,
  args: {
    browserTabId: 3,
    url: 'https://example.com/some/page',
    title: 'Example — a pinned browser tab',
    onClose: () => {},
    onPromote: () => {},
    focused: false,
  },
  decorators: [
    (Story) => (
      <div style={{ height: 320, width: 480, background: 'var(--duo-paper)', border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AuxBrowserSlot>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Focused: Story = { args: { focused: true } }

export const FileUrl: Story = {
  args: {
    url: 'file:///Users/geoff/Documents/notes/plan.html',
    title: 'plan.html',
  },
}

export const Loading: Story = {
  args: { url: '', title: '' },
}
