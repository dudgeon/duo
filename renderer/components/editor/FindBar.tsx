// ENH-023 (v0.5.4) — Find bar for the markdown editor.
//
// Mounts above the prose surface when `open === true`. Reads
// match-count + current-index from the FindHighlight extension's
// storage; controls the extension via `setFindQuery` / `findNext` /
// `findPrev` / `closeFind` commands.
//
// Keyboard inside the find input (capture-phase so the global
// shortcut matcher doesn't pre-empt them):
//   - ↩          → next match
//   - ⇧↩         → previous match
//   - ↓ / ↑      → next / previous match (BUG-043 — natural
//                  arrow-key affordance to match the ▼ / ▲ buttons
//                  while focus is in the input)
//   - ⎋          → close the bar
//   - ⌘F         → re-focus + select-all (matches Chrome's behavior)
//   - ⌘G         → next match (works even when input has focus)
//   - ⌘⇧F        → previous match
//
// Layout: a thin chrome strip, paper-deep bg, sits between the
// editor toolbar and the prose surface. Inputs:
//   [text input]  [Aa toggle]  [3/17]  [▲]  [▼]  [✕]

import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor | null
  open: boolean
  onClose: () => void
}

export function FindBar({ editor, open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  // Re-render tick — FindHighlight.storage isn't reactive on its own,
  // so we bump this on every editor update so total/current refresh.
  const [, setTick] = useState(0)

  // Focus + select on open. If already open + ⌘F is pressed again,
  // re-select the existing query (Chrome parity).
  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open])

  // Push query updates to the extension on every keystroke.
  useEffect(() => {
    if (!editor || !open) return
    editor.commands.setFindQuery({ query, caseSensitive })
  }, [editor, query, caseSensitive, open])

  // Subscribe to editor updates so the match counter stays live as
  // the doc / find state changes.
  useEffect(() => {
    if (!editor) return
    const handler = () => setTick(t => t + 1)
    editor.on('transaction', handler)
    return () => { editor.off('transaction', handler) }
  }, [editor])

  // On unmount / close, clear the extension's state so highlights
  // disappear immediately.
  useEffect(() => {
    if (!open && editor) editor.commands.closeFind()
  }, [open, editor])

  if (!open) return null

  const total = editor ? (editor.storage.findHighlight?.total as number ?? 0) : 0
  const current = editor ? (editor.storage.findHighlight?.current as number ?? -1) : -1
  const counterLabel = total === 0
    ? (query ? '0/0' : '')
    : `${current + 1}/${total}`

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ⌘F while the input has focus: re-select (Chrome parity).
    if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      inputRef.current?.select()
      return
    }
    // ⌘⇧F → previous match.
    if (e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      editor?.commands.findPrev()
      return
    }
    // ⌘G → next match.
    if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      e.stopPropagation()
      editor?.commands.findNext()
      return
    }
    // ↩ → next match (⇧↩ → previous).
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) editor?.commands.findPrev()
      else editor?.commands.findNext()
      return
    }
    // BUG-043 — ↓ / ↑ → next / previous match. Mirrors the ▼ / ▲
    // buttons in the bar so users reach for the arrows naturally
    // (Chrome's find bar behaves identically). preventDefault keeps
    // the input from inserting a control character or moving the
    // caret around the input itself.
    if (e.key === 'ArrowDown' && !e.metaKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      editor?.commands.findNext()
      return
    }
    if (e.key === 'ArrowUp' && !e.metaKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      editor?.commands.findPrev()
      return
    }
    // ⎋ → close.
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-paper-edge bg-paper-deep shrink-0"
      data-duo-findbar="1"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in document"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="flex-1 min-w-0 px-2 py-0.5 text-[12px] bg-paper border border-paper-rule rounded text-ink placeholder-ink-ghost outline-none focus:border-accent focus:bg-white"
      />
      <button
        type="button"
        onClick={() => setCaseSensitive(v => !v)}
        title={caseSensitive ? 'Case sensitive (on)' : 'Case sensitive (off)'}
        className={[
          'shrink-0 w-7 h-6 flex items-center justify-center rounded text-[11px] font-medium transition-colors',
          caseSensitive
            ? 'bg-accent text-white'
            : 'bg-paper text-ink-mute hover:text-ink hover:bg-paper-edge'
        ].join(' ')}
      >
        Aa
      </button>
      <span className="shrink-0 text-[11px] text-ink-mute tabular-nums min-w-[44px] text-right">
        {counterLabel}
      </span>
      <button
        type="button"
        onClick={() => editor?.commands.findPrev()}
        disabled={total === 0}
        title="Previous match (⌘⇧F)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ▲
      </button>
      <button
        type="button"
        onClick={() => editor?.commands.findNext()}
        disabled={total === 0}
        title="Next match (⌘G)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge disabled:opacity-30 disabled:hover:bg-transparent"
      >
        ▼
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (⎋)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-paper-edge"
      >
        ✕
      </button>
    </div>
  )
}
