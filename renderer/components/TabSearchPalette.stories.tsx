import type { Meta, StoryObj } from '@storybook/react'
import { TabSearchPalette, type TabSearchEntry } from './TabSearchPalette'

// ENH-239 Phase 1 — the ⌘⇧A tab-search palette ({ open, entries, onPick,
// onDismiss }). A full-screen overlay; type to fuzzy-filter the entry list.
const ENTRIES: TabSearchEntry[] = [
  { id: 'f:1', title: 'inbox.md', subtitle: '/Users/geoff/Documents/notes/inbox.md', kind: 'editor' },
  { id: 'f:2', title: 'roadmap.html', subtitle: '/Users/geoff/Documents/GitHub/duo/docs/roadmap.html', kind: 'page' },
  { id: 'b:1', title: 'Anthropic', subtitle: 'https://www.anthropic.com', kind: 'browser' },
  { id: 'f:3', title: 'diagram.png', subtitle: '/Users/geoff/Pictures/diagram.png', kind: 'image', inAux: true },
]

const meta = {
  title: 'Chrome/TabSearchPalette',
  component: TabSearchPalette,
  args: {
    open: true,
    entries: ENTRIES,
    onPick: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof TabSearchPalette>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { entries: [] } }

export const Closed: Story = { args: { open: false } }
