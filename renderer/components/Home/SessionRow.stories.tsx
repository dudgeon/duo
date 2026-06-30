import type { Meta, StoryObj } from '@storybook/react'
import type { HomeSession } from '@shared/types'
import { SessionRow } from './SessionRow'

// ENH-239 Phase 1 — one session row (title + optional open/running pill +
// subPath badge + age). Pure presentational; the parent owns the click
// contract, so onActivate is a no-op here.

const baseSession: HomeSession = {
  uuid: 'sess-0001',
  title: 'Wire the catch-up board',
  titleSource: 'jsonl-firstmsg',
  modifiedAt: Date.now() - 1000 * 60 * 12,
  cwd: '/Users/you/project',
}

const meta = {
  title: 'Home/SessionRow',
  component: SessionRow,
  args: { session: baseSession, onActivate: () => {} },
} satisfies Meta<typeof SessionRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const OpenInDuo: Story = {
  args: {
    session: {
      ...baseSession,
      uuid: 'sess-0002',
      title: 'Running in a Duo terminal',
      open: { kind: 'duo', windowId: 1, tabId: 'tab-abc' },
    },
  },
}

export const RunningExternal: Story = {
  args: {
    session: {
      ...baseSession,
      uuid: 'sess-0003',
      title: 'Running outside Duo',
      open: { kind: 'external' },
    },
  },
}

export const WithSubPath: Story = {
  args: {
    session: {
      ...baseSession,
      uuid: 'sess-0004',
      title: 'Session in a worktree',
      subPath: 'worktrees/feature-x',
    },
  },
}

export const HasReplyBelow: Story = {
  args: { hasReplyBelow: true },
}
