import type { Meta, StoryObj } from '@storybook/react'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import type { NavPinsApi } from '../hooks/useNavPins'
import type { UserClaudeNavigatorApi } from '../hooks/useUserClaudeNavigator'
import { FilesPane } from './FilesPane'

// ENH-239 Phase 1 — file navigator column (breadcrumb + tree + rail). Heavy:
// it composes Breadcrumb / FileTree / PinnedNav / UserClaudePane and is driven
// by hook-shaped state/actions objects. This is a smoke story — minimal empty
// state + no-op actions get it to mount and render the breadcrumb, an empty
// tree, and the collapsed rail. Child trees list via files.* IPC (mocked).

// Minimal NavigatorState — empty selection, empty listings, rooted at a cwd.
const navState: NavigatorState = {
  cwd: '/Users/geoff/Documents/project',
  selectedItems: new Map(),
  selected: null,
  expanded: new Set(),
  pinned: false,
  showDotfiles: false,
  listings: new Map(),
  removedWorktree: null,
}

// Every NavigatorActions member as a no-op.
const navActions: NavigatorActions = {
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
}

const navPins: NavPinsApi = {
  pins: [],
  isPinned: () => false,
  toggle: async () => {},
}

const userClaudeNav: UserClaudeNavigatorApi = {
  showAll: false,
  setShowAll: () => {},
  state: { ...navState, cwd: '/Users/geoff/.claude' },
  actions: navActions,
  curatedRootEntries: [],
}

const meta: Meta<typeof FilesPane> = {
  title: 'Modals/FilesPane',
  component: FilesPane,
  args: {
    collapsed: false,
    focused: false,
    home: '/Users/geoff',
    state: navState,
    actions: navActions,
    userClaudeNav,
    navPins,
    onOpenFile: () => {},
    onOpenTerminalHere: () => {},
    onOpenClaudeIn: () => {},
    revealChip: null,
    onDismissRevealChip: () => {},
    onToggleCollapsed: () => {},
    onSetCollapsed: () => {},
    onActivateHome: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 480, display: 'flex', background: 'var(--duo-paper)' }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Focused: Story = { args: { focused: true } }

export const Collapsed: Story = { args: { collapsed: true } }
