import type { Meta, StoryObj } from '@storybook/react'
import type { CatchupCard } from '@shared/types'
import { SessionDigestCard } from './SessionDigestCard'

// ENH-239 Phase 1 — the full Catch-Up "briefing" card. Every field comes from a
// pre-hydrated digest (zero inference), so we construct a minimal CatchupCard
// fixture per state. Callbacks are no-ops.

const base: CatchupCard = {
  uuid: 'cu-0001',
  cwd: '/Users/you/project',
  goal: 'Wire the catch-up board',
  youAsked: 'render the three columns and make the fold work',
  todos: [
    { text: 'Build the column layout', status: 'completed' },
    { text: 'Wire the fold expander', status: 'in_progress' },
    { text: 'Add the snippet reply', status: 'pending' },
  ],
  files: [
    { path: '/Users/you/project/renderer/CatchupBoard.tsx', kind: 'edited' },
    { path: '/Users/you/project/renderer/SessionDigestCard.tsx', kind: 'created' },
  ],
  artifacts: {},
  attention: null,
  state: 'working',
  fallbackSnippet: 'The board now renders, but the fold still needs the show-fewer affordance.',
  gitBranch: 'enh-231-catchup',
  lastActivityAt: Date.now() - 1000 * 60 * 8,
  tier: 'full',
}

const meta = {
  title: 'Home/SessionDigestCard',
  component: SessionDigestCard,
  args: {
    card: base,
    now: Date.now(),
    onOpenSession: () => {},
    onOpenFile: () => {},
    onOpenUrl: () => {},
  },
} satisfies Meta<typeof SessionDigestCard>

export default meta
type Story = StoryObj<typeof meta>

export const Working: Story = {}

export const NeedsYou: Story = {
  args: {
    card: {
      ...base,
      uuid: 'cu-0002',
      state: 'needs-you',
      attention: { reason: 'plan-to-approve' },
    },
  },
}

export const Done: Story = {
  args: {
    card: {
      ...base,
      uuid: 'cu-0003',
      state: 'done',
      todos: base.todos.map((t) => ({ ...t, status: 'completed' as const })),
      artifacts: { pr: { number: 142, url: 'https://github.com/owner/repo/pull/142' }, tests: 'pass' },
    },
  },
}

export const LiveInDuo: Story = {
  args: {
    card: {
      ...base,
      uuid: 'cu-0004',
      open: { kind: 'duo', windowId: 1, tabId: 'tab-a' },
    },
  },
}

export const Scheduled: Story = {
  args: {
    card: { ...base, uuid: 'cu-0005', scheduled: true },
  },
}

export const WorktreeGone: Story = {
  args: {
    card: { ...base, uuid: 'cu-0006', cwdGone: true },
  },
}
