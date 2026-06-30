import type { Meta, StoryObj } from '@storybook/react'
import type { NavPinEntry } from '@shared/types'
import { PinnedNav } from './PinnedNav'

// ENH-239 Phase 1 — the navigator's pinned files/folders section ({ pins, home,
// selectedPath, onSelect, … }). Always renders the synthesized non-removable
// Home row (slot 0), with grouped pins below. Rendered in a navigator-width
// slot.
const PINS: NavPinEntry[] = [
  { path: '/Users/geoff/Documents/notes/inbox.md', kind: 'file', title: 'inbox.md' },
  { path: '/Users/geoff/Documents/notes/today.md', kind: 'file', title: 'today.md' },
  { path: '/Users/geoff/Documents/GitHub/duo', kind: 'folder', title: 'duo' },
]

const meta = {
  title: 'Chrome/PinnedNav',
  component: PinnedNav,
  args: {
    pins: PINS,
    home: '/Users/geoff',
    selectedPath: null,
    onSelect: () => {},
    onOpenFile: () => {},
    onOpenFolder: () => {},
    onOpenTerminalHere: () => {},
    onRevealInFinder: () => {},
    onUnpin: async () => {},
    onOpenInSplit: () => {},
    onActivateHome: () => {},
    homeActive: false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 280, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PinnedNav>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const HomeActive: Story = { args: { homeActive: true } }

// Zero persisted pins still renders the permanent Home row (ENH-212 slot 0).
export const NoPins: Story = { args: { pins: [] } }

export const Selected: Story = {
  args: { selectedPath: '/Users/geoff/Documents/notes/inbox.md' },
}
