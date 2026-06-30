import type { Meta, StoryObj } from '@storybook/react'
import type { CatchupCard } from '@shared/types'
import { CompactSessionRow } from './CompactSessionRow'

// ENH-239 Phase 1 — a compact (stalled) catch-up row ({ card, now, onToggleExpand }).
// Default is a live worktree row; the cwd-gone variant is greyed + struck.
const baseCard: CatchupCard = {
  uuid: 'sess-compact-1',
  cwd: '/Users/geoff/code/duo/.worktrees/feature-x',
  goal: 'Wire the Storybook smoke stories for the Home cluster',
  youAsked: 'Author CSF stories for every Home component.',
  todos: [],
  files: [],
  artifacts: {},
  attention: null,
  state: 'done',
  gitBranch: 'feature-x',
  lastActivityAt: Date.now() - 3 * 60 * 60_000,
  scheduled: false,
  tier: 'compact',
}

const meta = {
  title: 'Home/CompactSessionRow',
  component: CompactSessionRow,
  args: { card: baseCard, now: Date.now(), onToggleExpand: () => {} },
  decorators: [
    (Story) => (
      <div style={{ width: 360, background: 'var(--duo-paper)', padding: 8 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CompactSessionRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Scheduled: Story = {
  args: { card: { ...baseCard, scheduled: true } },
}

export const WorktreeGone: Story = {
  args: { card: { ...baseCard, cwdGone: true } },
}
