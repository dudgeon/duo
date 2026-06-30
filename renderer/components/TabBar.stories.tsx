import type { Meta, StoryObj } from '@storybook/react'
import type { TabSession } from '@shared/types'
import { TabBar } from './TabBar'

// ENH-239 Phase 1 — the terminal tab strip ({ tabs, activeTabId, onSelect,
// onNewClaude, onNewShell, onClose, … }). Heavy (per-tab worktree-badge hook +
// drag-reorder + native context menu), so this is a minimal smoke story that
// mounts the strip with a small static tab set; per-tab git probing degrades to
// no badge under the global mock decorator.
const TABS: TabSession[] = [
  { id: 't1', title: 'claude · duo', cwd: '/Users/geoff/Documents/GitHub/duo', kind: 'claude' },
  { id: 't2', title: 'zsh', cwd: '/Users/geoff/Documents/GitHub/duo', kind: 'shell' },
]

const meta = {
  title: 'Chrome/TabBar',
  component: TabBar,
  args: {
    tabs: TABS,
    activeTabId: 't1',
    onSelect: () => {},
    onNewClaude: () => {},
    onNewShell: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof TabBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Focused: Story = { args: { focused: true } }

export const TerminalCollapsed: Story = {
  args: { isTerminalCollapsed: true, onToggleTerminalCollapsed: () => {} },
}

export const SingleTab: Story = {
  args: { tabs: [TABS[0]], activeTabId: 't1' },
}
