import type { Meta, StoryObj } from '@storybook/react'
import { AddressBar } from './AddressBar'

// ENH-239 Phase 1 — the browser-pane address bar ({ url, onNavigate,
// isLoading }). Its input text is tuned for the dark top chrome, so it's
// rendered on a sized dark titlebar swatch.
const meta = {
  title: 'Chrome/AddressBar',
  component: AddressBar,
  args: {
    url: 'https://www.anthropic.com',
    onNavigate: () => {},
    isLoading: false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, padding: 24, background: '#1a1611' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AddressBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = { args: { isLoading: true } }

export const LocalFile: Story = {
  args: { url: 'file:///Users/geoff/Documents/notes/inbox.md' },
}
