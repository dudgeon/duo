import type { Meta, StoryObj } from '@storybook/react'
import type { CatchupCard, DigestTodo } from '@shared/types'
import {
  AttentionChip,
  ScheduledBadge,
  LivePill,
  DoneBadge,
  ClosedBadge,
  FileChips,
  ArtifactChips,
  TodoChips,
} from './CatchupChips'

// ENH-239 Phase 1 — the catch-up card's small atoms. This file exports many
// presentational pieces; meta.component is the primary (AttentionChip, one
// story per AttentionReason) and the rest get their own render-arrow stories.
const meta = {
  title: 'Home/CatchupChips',
  component: AttentionChip,
  args: { reason: 'plan-to-approve' },
} satisfies Meta<typeof AttentionChip>

export default meta
type Story = StoryObj<typeof meta>

// AttentionChip — one per discriminant (AttentionReason).
export const PlanToApprove: Story = { args: { reason: 'plan-to-approve' } }
export const Question: Story = { args: { reason: 'question' } }
export const Blocked: Story = { args: { reason: 'blocked' } }

// The badges / pills (no props or single-prop).
export const Scheduled = { render: () => <ScheduledBadge /> }
export const Done = { render: () => <DoneBadge /> }
export const Closed = { render: () => <ClosedBadge /> }

// LivePill — present per open.kind, absent when closed (renders nothing).
export const LiveDuo = {
  render: () => <LivePill open={{ kind: 'duo', windowId: 1, tabId: 'tab-1' }} />,
}
export const LiveExternal = { render: () => <LivePill open={{ kind: 'external' }} /> }

// Chip rows — minimal CatchupCard-shaped slices.
const files: CatchupCard['files'] = [
  { path: '/repo/renderer/App.tsx', kind: 'edited' },
  { path: '/repo/renderer/Home/HeroPanel.tsx', kind: 'created' },
]
export const Files = {
  render: () => <FileChips files={files} onOpen={() => {}} />,
}

const artifacts: CatchupCard['artifacts'] = {
  pr: { number: 239, url: 'https://example.com/pr/239' },
  tests: 'pass',
  createdFiles: ['a.tsx', 'b.tsx'],
}
export const Artifacts = { render: () => <ArtifactChips artifacts={artifacts} /> }

const todos: DigestTodo[] = [
  { text: 'Read the reference stories', status: 'completed' },
  { text: 'Author the Home cluster stories', status: 'in_progress' },
  { text: 'Run the typecheck', status: 'pending' },
]
export const Todos = { render: () => <TodoChips todos={todos} /> }
