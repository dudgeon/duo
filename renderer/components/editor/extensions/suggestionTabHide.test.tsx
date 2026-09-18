// @vitest-environment jsdom
// BUG-271 — end-to-end through a REAL TipTap editor + ReactRenderer portal:
// open a '[[' session, hide the editor the way WorkingPane hides an
// inactive tab, and assert nothing is left floating in document.body.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { WikilinkSuggestion } from './WikilinkSuggestion'
import { AtMention } from './AtMention'

let laidOut = true
const realRect = Element.prototype.getBoundingClientRect

beforeEach(() => {
  laidOut = true
  // jsdom has no layout: every rect is zero. Report a real caret rect while
  // "visible" and the all-zero rect Chromium reports under display:none.
  Element.prototype.getBoundingClientRect = function () {
    const v = laidOut ? { x: 100, y: 200, width: 12, height: 18 } : { x: 0, y: 0, width: 0, height: 0 }
    return { ...v, top: v.y, left: v.x, right: v.x + v.width, bottom: v.y + v.height, toJSON: () => v } as DOMRect
  }
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  cleanup()
})

let editorRef: Editor | null = null
function Host({ loading }: { loading: boolean }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      WikilinkSuggestion.configure({ getItems: () => [], isLoading: () => loading, rank: (i) => i }),
      AtMention.configure({ getItems: () => [], isLoading: () => loading, rank: (i) => i })
    ],
    content: '<p>test 123</p>'
  })
  editorRef = editor
  return <EditorContent editor={editor} />
}

const popovers = () => document.body.querySelectorAll('.duo-suggestion-popover')
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

async function openSession(trigger: string) {
  const view = render(<Host loading />)
  await settle()
  await act(async () => { editorRef!.chain().focus('end').insertContent(trigger).run() })
  await settle()
  return view
}

describe.each([
  ['[[', 'wikilinkSuggestion'],
  [' @', 'atMention']
])('tab-hide with an open %s session (BUG-271)', (trigger, storageKey) => {
  it('opens a popover while visible (test sanity)', async () => {
    await openSession(trigger)
    expect(popovers()).toHaveLength(1)
    expect(popovers()[0].textContent).toContain('Searching vault')
  })

  it('suspend() removes the popover from document.body', async () => {
    await openSession(trigger)
    await act(async () => { editorRef!.storage[storageKey].suspend() })
    await settle()
    expect(popovers()).toHaveLength(0)
  })

  it('resumes at the caret when the user comes back and types on', async () => {
    await openSession(trigger)
    await act(async () => { editorRef!.storage[storageKey].suspend() })
    await settle()
    await act(async () => { editorRef!.chain().focus('end').insertContent('a').run() })
    await settle()
    expect(popovers()).toHaveLength(1)
  })

  it('guard: a re-render against a hidden (zero-rect) anchor paints nothing', async () => {
    const view = await openSession(trigger)
    laidOut = false
    // Any ancestor re-render re-evaluates clientRect() — this is what pinned
    // the orphan to the top-left corner before the guard.
    view.rerender(<Host loading={false} />)
    await act(async () => { editorRef!.chain().insertContent('b').run() })
    await settle()
    expect(popovers()).toHaveLength(0)
  })
})
