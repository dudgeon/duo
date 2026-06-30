import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TrackedChangesRail } from './TrackedChangesRail'
import type { TrackedRange } from './trackedChanges'

// ENH-239 Phase 1 — the per-suggestion track-changes rail (insertion /
// deletion / highlight rows + author-filter chips). It early-returns null
// unless editor != null && ranges.length > 0, so a throwaway TipTap editor
// satisfies the guard while the rows render purely from the `ranges` prop.
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
  { from: 4, to: 18, kind: 'insertion', author: 'geoff', ts: '2026-06-29T10:00:00Z', text: 'the new opening line' },
  { from: 30, to: 52, kind: 'deletion', author: 'claude', ts: '2026-06-29T10:05:00Z', text: 'a paragraph that should be removed' },
  { from: 60, to: 70, kind: 'highlight', author: null, ts: null, text: 'flagged phrase' },
]

const meta = {
  title: 'Editor/TrackedChangesRail',
  component: TrackedChangesRail,
  args: {
    editor: null,
    ranges: [],
    onJumpTo: () => {},
    currentAuthor: 'geoff',
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TrackedChangesRail>

export default meta
type Story = StoryObj<typeof meta>

// ranges=[] → the rail renders nothing (documents the hidden state).
export const Empty: Story = {}

export const WithChanges: Story = {
  render: (args) => {
    const editor = useThrowawayEditor()
    return <TrackedChangesRail {...args} editor={editor} ranges={RANGES} />
  },
}

export const SingleInsertion: Story = {
  render: (args) => {
    const editor = useThrowawayEditor()
    return <TrackedChangesRail {...args} editor={editor} ranges={[RANGES[0]]} />
  },
}
