import type { Meta, StoryObj } from '@storybook/react'
import type { DirEntry } from '@shared/types'
import type { NavigatorState, NavigatorActions } from '../hooks/useNavigator'
import { FileTree } from './FileTree'

// ENH-239 Phase 1 — navigator file tree. Heavy: its real driver is the
// `useNavigator` state machine plus a stack of git/worktree IPC effects. We
// pass `rootEntriesOverride` (a curated root listing) which short-circuits the
// git ribbon + worktree probes entirely, so the smoke story renders the row
// list without a live navigator. All NavigatorActions are no-ops.
const entries: DirEntry[] = [
  { name: 'src', path: '/proj/src', kind: 'directory' },
  { name: 'docs', path: '/proj/docs', kind: 'directory' },
  { name: 'README.md', path: '/proj/README.md', kind: 'file', size: 2048, mtimeMs: 0 },
  { name: 'package.json', path: '/proj/package.json', kind: 'file', size: 512, mtimeMs: 0 },
]

const state: NavigatorState = {
  cwd: '/proj',
  selectedItems: new Map(),
  selected: null,
  expanded: new Set(),
  pinned: false,
  showDotfiles: false,
  listings: new Map([['/proj', entries]]),
  removedWorktree: null,
}

const noop = () => {}
const actions: NavigatorActions = {
  navigateTo: noop,
  selectItem: noop,
  toggleSelection: noop,
  selectRange: noop,
  selectAllVisible: noop,
  clearSelection: noop,
  toggleExpand: noop,
  togglePinned: noop,
  toggleShowDotfiles: noop,
  refresh: noop,
  revealAndSelect: noop,
  setWorktreeRevertTarget: noop,
  dismissRemovedWorktree: noop,
}

const meta = {
  title: 'Panes/FileTree',
  component: FileTree,
  args: {
    state,
    actions,
    rootEntriesOverride: entries,
    onOpenFile: () => {},
    onOpenTerminalHere: () => {},
    onOpenClaudeIn: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 260, height: 360, background: 'var(--duo-paper)', border: '1px solid var(--duo-paper-rule)', display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileTree>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { rootEntriesOverride: [] } }
