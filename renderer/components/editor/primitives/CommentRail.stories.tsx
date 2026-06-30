import type { Meta, StoryObj } from '@storybook/react'
import { CommentRail, type CommentThread } from './CommentRail'

// ENH-239 Phase 1 — the editor-agnostic comment rail. Pure presentational:
// it takes pre-sorted threads + click callbacks and renders the right-side
// rail chrome. Rendered in a fixed-width slot to mirror its real context.

const openThread: CommentThread = {
  id: 'thr_1',
  number: 1,
  excerpt: 'the quick brown fox jumps over…',
  resolved: false,
  entries: [
    { id: 'e1', author: 'Geoff', ts: '2026-06-29T14:00:00.000Z', body: 'Should this sentence be tighter?' },
    { id: 'e2', author: 'claude', ts: '2026-06-29T14:02:00.000Z', body: 'I can trim the clause — want me to?' },
  ],
}

const secondThread: CommentThread = {
  id: 'thr_2',
  number: 2,
  excerpt: 'consider splitting this paragraph',
  resolved: false,
  entries: [
    { id: 'e3', author: 'Geoff', ts: '2026-06-29T13:30:00.000Z', body: 'Two ideas here — split?' },
  ],
}

const resolvedThread: CommentThread = {
  id: 'thr_3',
  number: 3,
  excerpt: 'typo fixed',
  resolved: true,
  entries: [
    { id: 'e4', author: 'Geoff', ts: '2026-06-29T12:00:00.000Z', body: 'Typo on line 4.' },
    { id: 'e5', author: 'claude', ts: '2026-06-29T12:01:00.000Z', body: 'Fixed.' },
  ],
}

const meta = {
  title: 'Editor/Primitives/CommentRail',
  component: CommentRail,
  args: {
    threads: [openThread, secondThread],
    activeThreadId: null,
    onJumpTo: () => {},
    onReply: () => {},
    onResolve: () => {},
    onReopen: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ height: 420, width: 280, background: 'var(--duo-paper)', border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommentRail>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const ActiveThread: Story = { args: { activeThreadId: 'thr_1' } }

export const Empty: Story = { args: { threads: [] } }

export const AllResolved: Story = { args: { threads: [resolvedThread] } }

export const Mixed: Story = { args: { threads: [openThread, resolvedThread] } }
