import type { Meta, StoryObj } from '@storybook/react'
import type { DirEntry } from '@shared/types'
import type { UserClaudeNavigatorApi } from '../hooks/useUserClaudeNavigator'
import { UserClaudePane } from './UserClaudePane'

// ENH-239 Phase 1 — "Your Claude settings" pane (heavy: hosts FileTree, which
// fans out to git/file IPC). Smoke story: mount with a minimal but
// type-complete UserClaudeNavigatorApi (empty tree) so the pane renders its
// collapsible header. The pane defaults to COLLAPSED, so the FileTree body
// stays unmounted unless the user expands it — the default story is the
// least-props mount; Focused shows the focus tint.

const ROOT = '/tmp/duo-preview/.claude'

// Minimal NavigatorState — empty selection/expanded/listings so FileTree mounts
// against an empty tree without dereferencing missing keys.
const emptyNav: UserClaudeNavigatorApi = {
  showAll: false,
  setShowAll: () => {},
  state: {
    cwd: ROOT,
    selectedItems: new Map(),
    selected: null,
    expanded: new Set<string>(),
    pinned: false,
    showDotfiles: false,
    listings: new Map<string, DirEntry[] | null>([[ROOT, []]]),
    removedWorktree: null,
  },
  actions: {
    navigateTo: () => {},
    selectItem: () => {},
    toggleSelection: () => {},
    selectRange: () => {},
    selectAllVisible: () => {},
    clearSelection: () => {},
    toggleExpand: () => {},
    togglePinned: () => {},
    toggleShowDotfiles: () => {},
    refresh: () => {},
    revealAndSelect: () => {},
    setWorktreeRevertTarget: () => {},
    dismissRemovedWorktree: () => {},
  },
  curatedRootEntries: [],
}

const meta = {
  title: 'Status/UserClaudePane',
  component: UserClaudePane,
  args: {
    nav: emptyNav,
    onOpenFile: () => {},
    onOpenTerminalHere: () => {},
    focused: false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, background: 'var(--duo-paper-edge)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UserClaudePane>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Focused: Story = {
  args: { focused: true },
}
