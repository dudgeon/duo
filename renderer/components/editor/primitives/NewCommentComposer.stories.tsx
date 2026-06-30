import type { Meta, StoryObj } from '@storybook/react'
import { NewCommentComposer } from './NewCommentComposer'

// ENH-239 Phase 1 — the shared "new comment" composer popover. It portals to
// document.body and anchors below the selection rect; the fixture rect places
// it near the top-left so it's visible in the Storybook canvas.

const meta = {
  title: 'Editor/Primitives/NewCommentComposer',
  component: NewCommentComposer,
  args: {
    anchorRect: { top: 40, bottom: 60, right: 360 },
    excerpt: 'the quick brown fox jumps over the lazy dog',
    onSubmit: () => {},
    onCancel: () => {},
  },
} satisfies Meta<typeof NewCommentComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoExcerpt: Story = { args: { excerpt: '' } }
