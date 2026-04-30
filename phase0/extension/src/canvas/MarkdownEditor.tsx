// Phase 4b — minimal TipTap editor that round-trips markdown.
//
// Scope is deliberately narrow: validate that the same TipTap stack
// the Electron renderer uses (StarterKit + tiptap-markdown) builds
// and runs inside an MV3 extension page. Feature parity with the
// Electron MarkdownEditor.tsx (toolbars, slash menus, autosave UI)
// is out of scope for this phase — the question being answered is
// "does the architecture work in this shape", not "is it shippable".

import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { useEffect } from 'react'

interface Props {
  value: string
  onChange: (markdown: string) => void
}

export function MarkdownEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        breaks: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown() as string
      onChange(md)
    },
  })

  // External value changes (load file, switch file): replace editor content.
  // Equality check prevents the round-trip md→tiptap→md→onChange→state→md
  // from triggering an infinite re-render loop.
  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown.getMarkdown() as string
    if (current !== value) {
      editor.commands.setContent(value, false)
    }
  }, [editor, value])

  return <EditorContent editor={editor} className="md-editor" />
}
