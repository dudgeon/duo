// Stage 11 — rich markdown editor (PRD D1–D5, D10–D11, D21).
//
// TipTap/ProseMirror under the hood; tiptap-markdown for round-trip.
// YAML frontmatter is split off, preserved verbatim, re-attached on save.
// v1 ships: core marks + nodes (StarterKit, underline, link, image, task
// lists, tables, code blocks with syntax highlighting). Autosave (800ms
// debounce) + ⌘S + dirty dot.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Placeholder from '@tiptap/extension-placeholder'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'

import type { Editor } from '@tiptap/react'

import { EditorToolbar } from './EditorToolbar'
import { TableShortcuts } from './extensions/TableShortcuts'
import { PersistentSelection } from './extensions/PersistentSelection'
import type { EditorSelectionSnapshot } from '@shared/types'
import {
  splitFrontmatter,
  joinFrontmatter,
  decodeUtf8,
  encodeUtf8
} from './markdown-io'

interface Props {
  path: string
  /** Propagate dirty state up so the tab strip can show the unsaved dot. */
  onDirtyChange?: (dirty: boolean) => void
  /** Stage 11 § D33a — when true, the editor shows a "Name this document"
   *  interstitial bar instead of reading the file. The path prop carries a
   *  suggested filename; the user can rename freely before commit. */
  isNew?: boolean
  /** Called when the user confirms the filename for a new document. The
   *  parent should write an empty file, update the tab path/title, and
   *  drop the `isNew` flag. */
  onCommitNewFile?: (resolvedPath: string, title: string) => Promise<void>
  /** Called when the user cancels naming (Escape). Parent typically
   *  closes the tab. */
  onCancelNew?: () => void
}

const AUTOSAVE_DEBOUNCE_MS = 800

// Module-scope lowlight instance — cheap to construct, shared across tabs.
const lowlight = createLowlight(common)

export function MarkdownEditor({ path, onDirtyChange, isNew, onCommitNewFile, onCancelNew }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const hostRef = useRef<HTMLDivElement | null>(null)

  // Preserved across save cycles; body is what the editor edits.
  const frontmatterRef = useRef<string | null>(null)
  const eolRef = useRef<'\n' | '\r\n'>('\n')
  // The markdown body as it was on disk after the last successful read or
  // write. Used to compute `dirty` by diffing against the live editor content
  // and to avoid issuing identical writes.
  const lastSavedBodyRef = useRef<string>('')

  // Track the latest path we loaded, so late-arriving reads don't clobber a
  // newer tab open.
  const pathRef = useRef(path)
  pathRef.current = path

  // Track previous isNew so we can detect the new-file commit transition
  // (true \u2192 false) and hand keyboard focus to the prose, per D33f.
  const wasNewRef = useRef<boolean>(!!isNew)

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // CodeBlockLowlight replaces StarterKit's codeBlock.
        codeBlock: false,
        // StarterKit's heading defaults to levels [1..6] — leave as-is.
        // Keep history plugin (undo/redo).
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer', class: 'duo-link' }
      }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TableShortcuts,
      PersistentSelection,
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder: 'Start typing — markdown shortcuts work (`# `, `- `, `> `, `**bold**`)…' }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true
      })
    ],
    []
  )

  // ── Load file ────────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'duo-editor-prose focus:outline-none',
        spellcheck: 'true'
      }
    },
    // Content is set after the async file read lands.
    content: ''
  }, [path])

  useEffect(() => {
    if (!editor) return
    let cancelled = false
    setError(null)
    setLoaded(false)
    setDirty(false)

    // New-file mode: don't try to read disk, the file doesn't exist yet.
    // Editor stays empty until the user commits a filename.
    if (isNew) {
      frontmatterRef.current = null
      eolRef.current = '\n'
      lastSavedBodyRef.current = ''
      editor.commands.setContent('', false)
      setLoaded(true)
      return () => { cancelled = true }
    }

    window.electron.files.read(path).then(
      (res) => {
        if (cancelled || pathRef.current !== path) return
        const text = decodeUtf8(res.bytes)
        const split = splitFrontmatter(text)
        frontmatterRef.current = split.frontmatter
        eolRef.current = split.eol

        // Second-arg `false` suppresses an update event so the initial load
        // doesn't count as a user edit.
        editor.commands.setContent(split.body, false)

        // Capture the serializer's view of the loaded doc as the baseline.
        // Markdown round-trip isn't byte-exact (list markers, whitespace);
        // using what the editor itself serializes avoids a spurious "dirty"
        // state the instant the user types a single character.
        lastSavedBodyRef.current = editor.storage.markdown.getMarkdown() as string
        setLoaded(true)
      },
      (err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      }
    )
    return () => { cancelled = true }
  }, [path, editor, isNew])

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!editor) return
    if (saving) return

    // Pull current body markdown from tiptap-markdown storage.
    const body = editor.storage.markdown.getMarkdown() as string
    if (body === lastSavedBodyRef.current && !dirty) return

    setSaving(true)
    try {
      const full = joinFrontmatter(frontmatterRef.current, body, eolRef.current)
      const bytes = encodeUtf8(full)
      await window.electron.files.write(path, bytes)
      lastSavedBodyRef.current = body
      setDirty(false)
      onDirtyChange?.(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [editor, path, saving, dirty, onDirtyChange])

  // ── Dirty tracking + autosave ────────────────────────────────────────────
  const saveRef = useRef(save)
  saveRef.current = save

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editor) return

    const handler = () => {
      if (!loaded) return
      const body = editor.storage.markdown.getMarkdown() as string
      const isDirty = body !== lastSavedBodyRef.current
      setDirty(isDirty)
      if (isDirty) {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = setTimeout(() => {
          autosaveTimerRef.current = null
          void saveRef.current()
        }, AUTOSAVE_DEBOUNCE_MS)
      }
    }

    editor.on('update', handler)
    return () => {
      editor.off('update', handler)
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [editor, loaded])

  // Propagate dirty up in its own effect — never inside setState or render,
  // which would cross-update the parent component and trigger React's
  // setState-during-render warning.
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  // D33f \u2014 when a new-file tab transitions from naming to edit mode, hand
  // keyboard focus to the prose so the user can type immediately. Guarded
  // on `loaded` so we don't focus before the (empty) initial setContent.
  useEffect(() => {
    if (!editor) return
    const wasNew = wasNewRef.current
    wasNewRef.current = !!isNew
    if (wasNew && !isNew && loaded) {
      // queueMicrotask so the parent's setState (path/title update) commits
      // and the prose is fully reachable before we move focus.
      queueMicrotask(() => editor.commands.focus('end'))
    }
  }, [editor, isNew, loaded])

  // Flush pending autosave on unmount.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
        void saveRef.current()
      }
    }
  }, [])

  // ── Selection push (for `duo selection`) ────────────────────────────────
  useEffect(() => {
    if (!editor || isNew) return

    const pushSnapshot = () => {
      window.electron.editor?.pushSelection(computeSelectionSnapshot(editor, path))
    }

    pushSnapshot()
    editor.on('selectionUpdate', pushSnapshot)
    editor.on('focus', pushSnapshot)
    editor.on('blur', pushSnapshot)
    editor.on('update', pushSnapshot)

    return () => {
      editor.off('selectionUpdate', pushSnapshot)
      editor.off('focus', pushSnapshot)
      editor.off('blur', pushSnapshot)
      editor.off('update', pushSnapshot)
      // Clear the cache when this editor unmounts so `duo selection`
      // can't return stale data after the user closed/switched the tab.
      window.electron.editor?.pushSelection(null)
    }
  }, [editor, path, isNew])

  // ── Serve doc-read requests with the live buffer ────────────────────────
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocRead((req) => {
      if (req.path && req.path !== path) {
        window.electron.editor.replyDocRead({
          reqId: req.reqId,
          ok: false,
          error: `Active editor is at ${path}, not ${req.path}`
        })
        return
      }
      try {
        const body = editor.storage.markdown.getMarkdown() as string
        const full = joinFrontmatter(frontmatterRef.current, body, eolRef.current)
        const isDirty = body !== lastSavedBodyRef.current
        window.electron.editor.replyDocRead({
          reqId: req.reqId,
          ok: true,
          path,
          text: full,
          dirty: isDirty
        })
      } catch (err) {
        window.electron.editor.replyDocRead({
          reqId: req.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  // ── Apply doc-write requests from the agent ─────────────────────────────
  useEffect(() => {
    if (!editor || isNew) return
    return window.electron.editor?.onDocWrite((req) => {
      if (req.path && req.path !== path) {
        window.electron.editor.replyDocWrite({
          reqId: req.reqId,
          ok: false,
          error: `Active editor is at ${path}, not ${req.path}`
        })
        return
      }
      try {
        if (req.mode === 'replace-all') {
          // Markdown text \u2014 tiptap-markdown reparses it into PM doc.
          editor.commands.setContent(req.text, true)
        } else {
          // replace-selection: plain-text replacement of the current
          // selection (or insertion at caret if collapsed). Agents that
          // need markdown formatting should use --replace-all for v1.
          editor.chain().focus().insertContent(req.text).run()
        }
        window.electron.editor.replyDocWrite({ reqId: req.reqId, ok: true })
      } catch (err) {
        window.electron.editor.replyDocWrite({
          reqId: req.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })
  }, [editor, path, isNew])

  // ── ⌘S ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only intercept when this editor instance is the focused one. Tiptap's
      // editor element covers the doc area; guard by containment.
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return
      const root = hostRef.current
      if (!root) return
      if (!root.contains(document.activeElement)) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  // ── Render ───────────────────────────────────────────────────────────────
  const handleCommitName = useCallback((filename: string) => {
    const trimmed = filename.trim()
    if (!trimmed) return
    const finalName = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : trimmed + '.md'
    const dir = path.slice(0, path.lastIndexOf('/')) || '.'
    void onCommitNewFile?.(`${dir}/${finalName}`, finalName)
  }, [path, onCommitNewFile])

  const suggestedBaseName = (() => {
    const base = path.slice(path.lastIndexOf('/') + 1)
    return base.replace(/\.md$/i, '')
  })()

  return (
    <div
      ref={hostRef}
      data-duo-workingpane
      tabIndex={0}
      className="flex-1 flex flex-col bg-surface-0 min-h-0 focus:outline-none"
    >
      {isNew && (
        <NewFileBar
          suggestedName={suggestedBaseName}
          onCommit={handleCommitName}
          onCancel={() => onCancelNew?.()}
        />
      )}
      <EditorToolbar editor={editor} onSave={() => void save()} dirty={dirty} saving={saving} />
      {error && (
        <div className="shrink-0 px-10 py-2 text-xs text-red-400 border-b border-red-900/40 bg-red-950/20">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[760px] px-10 py-10">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

// Walk the doc up to `pos` collecting the active heading trail. Each new
// heading at level L pops the stack down to entries above L, then pushes
// itself \u2014 so the resulting list reads outermost-to-innermost.
function computeHeadingTrail(editor: Editor, pos: number): string[] {
  const stack: { level: number; text: string }[] = []
  editor.state.doc.nodesBetween(0, Math.max(0, pos - 1), (node) => {
    if (node.type.name === 'heading') {
      const level = (node.attrs.level as number) ?? 1
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }
      stack.push({ level, text: node.textContent })
      return false
    }
    return true
  })
  return stack.map(s => s.text)
}

function computeSelectionSnapshot(editor: Editor, path: string): EditorSelectionSnapshot {
  const { state } = editor
  const { from, to } = state.selection
  const text = from === to ? '' : state.doc.textBetween(from, to, '\n', ' ')
  const $from = state.doc.resolve(from)
  // Closest block ancestor (paragraph/heading/list-item content) for the
  // surrounding-context field.
  let paragraph = ''
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.isBlock && node.isTextblock) {
      paragraph = node.textContent
      break
    }
  }
  return {
    path,
    text,
    paragraph,
    heading_trail: computeHeadingTrail(editor, from),
    start: from,
    end: to
  }
}

function NewFileBar({
  suggestedName,
  onCommit,
  onCancel
}: {
  suggestedName: string
  onCommit: (filename: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(suggestedName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  return (
    <div className="shrink-0 px-4 py-3 bg-surface-2 border-b border-border flex items-center gap-2">
      <span className="text-zinc-400 text-xs uppercase tracking-wider">New document</span>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit(name)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        placeholder="my-document"
        className="flex-1 bg-surface-1 border border-border rounded px-3 py-1.5 text-zinc-100 text-sm focus:outline-none focus:border-accent"
      />
      <span className="text-zinc-500 text-xs">.md</span>
      <button
        onClick={() => onCommit(name)}
        disabled={!name.trim()}
        className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent/85 disabled:opacity-40 disabled:hover:bg-accent transition-colors"
      >
        Create
      </button>
      <button
        onClick={onCancel}
        className="px-3 py-1.5 rounded border border-border text-zinc-400 text-xs hover:border-zinc-500 hover:text-zinc-200 transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
