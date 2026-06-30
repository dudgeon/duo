import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { UnifiedAnnotationRail } from './UnifiedAnnotationRail'
import type { TrackedRange } from './trackedChanges'
import type { BuiltMarkdownThread } from './markdownComments'

// ENH-239 Phase 1 — the unified annotation rail that interleaves tracked
// changes + comment threads by document position under one filter row. It
// early-returns null unless editor != null && items.length > 0, so a throwaway
// TipTap editor satisfies the guard while rows render from the data props.
function useThrowawayEditor(): Editor | null {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  useEffect(() => {
    const host = document.createElement('div')
    hostRef.current = host
    const ed = new Editor({ element: host, extensions: [StarterKit], content: '' })
    setEditor(ed)
    return () => {
      ed.destroy()
    }
  }, [])
  return editor
}

const RANGES: TrackedRange[] = [
  { from: 12, to: 28, kind: 'insertion', author: 'claude', ts: '2026-06-29T10:00:00Z', text: 'inserted clause' },
  { from: 80, to: 96, kind: 'deletion', author: 'geoff', ts: '2026-06-29T10:02:00Z', text: 'struck sentence' },
]

const THREADS: BuiltMarkdownThread[] = [
  {
    threadId: 'cmt_1',
    excerpt: 'the project overview',
    resolved: false,
    documentOrderIndex: 0,
    range: { from: 4, to: 24 },
    entries: [
      {
        id: 'cmt_1',
        anchorId: 'cmt_1',
        author: 'geoff',
        ts: '2026-06-29T09:50:00Z',
        body: 'Can we tighten this intro?',
      },
    ],
  },
  {
    threadId: 'cmt_2',
    excerpt: 'the closing paragraph',
    resolved: true,
    documentOrderIndex: 1,
    range: { from: 120, to: 150 },
    entries: [
      {
        id: 'cmt_2',
        anchorId: 'cmt_2',
        author: 'claude',
        ts: '2026-06-29T09:55:00Z',
        body: 'Done — rewrote it.',
      },
    ],
  },
]

const meta = {
  title: 'Editor/UnifiedAnnotationRail',
  component: UnifiedAnnotationRail,
  args: {
    editor: null,
    ranges: [],
    threads: [],
    currentAuthor: 'geoff',
    activeThreadId: null,
    onJumpToRange: () => {},
    onJumpToThread: () => {},
    onReply: () => {},
    onResolve: () => {},
    onReopen: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 300, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UnifiedAnnotationRail>

export default meta
type Story = StoryObj<typeof meta>

// No items → the rail renders nothing (documents the hidden state).
export const Empty: Story = {}

// Interleaved comments + tracked changes (the headline case).
export const Interleaved: Story = {
  render: (args) => {
    const editor = useThrowawayEditor()
    return <UnifiedAnnotationRail {...args} editor={editor} ranges={RANGES} threads={THREADS} />
  },
}

// Tracked changes only — no comment threads.
export const TrackedOnly: Story = {
  render: (args) => {
    const editor = useThrowawayEditor()
    return <UnifiedAnnotationRail {...args} editor={editor} ranges={RANGES} threads={[]} />
  },
}

// Comment threads only — no tracked changes.
export const CommentsOnly: Story = {
  render: (args) => {
    const editor = useThrowawayEditor()
    return <UnifiedAnnotationRail {...args} editor={editor} ranges={[]} threads={THREADS} />
  },
}
