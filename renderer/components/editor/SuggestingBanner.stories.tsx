import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { SuggestingBanner } from './SuggestingBanner'

// ENH-239 Phase 1 — the bulk "N suggestions · Accept all · Reject all" banner.
// It early-returns null unless editor != null && count > 0, so stories spin up
// a throwaway TipTap editor (the banner only needs a live instance for its
// Accept-all / Reject-all handlers; the count is supplied directly).
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

const meta = {
  title: 'Editor/SuggestingBanner',
  component: SuggestingBanner,
  args: { editor: null, count: 0 },
  decorators: [
    (Story) => (
      <div style={{ width: 520, border: '1px solid var(--duo-paper-rule)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SuggestingBanner>

export default meta
type Story = StoryObj<typeof meta>

// count=0 → the banner renders nothing (documents the hidden state).
export const Hidden: Story = {}

export const OneSuggestion: Story = {
  render: () => {
    const editor = useThrowawayEditor()
    return <SuggestingBanner editor={editor} count={1} />
  },
}

export const ManySuggestions: Story = {
  render: () => {
    const editor = useThrowawayEditor()
    return <SuggestingBanner editor={editor} count={7} />
  },
}
