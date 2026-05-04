// Stage 17d / Sprint 6 Phase 4 — shared "new comment" composer popover.
// Both the canvas (PageTab) and the markdown editor (MarkdownEditor)
// open this when the user invokes the Comment affordance (toolbar
// button, ⌘⌥M, or right-click). The popover floats above the
// document, anchored below the user's selection rect, with the
// excerpt shown for context.
//
// Lives at the primitives layer because the visual surface is
// identical between the two hosts. Hosts plumb their own onSubmit /
// onCancel and a PillAnchorRect for positioning (which they also
// already use for the SendToDuoPill — same coordinate space).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PillAnchorRect } from './SendToDuoPill'

interface Props {
  anchorRect: PillAnchorRect
  excerpt: string
  onSubmit: (body: string) => void
  onCancel: () => void
}

export function NewCommentComposer({ anchorRect, excerpt, onSubmit, onCancel }: Props) {
  const [body, setBody] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { taRef.current?.focus() }, [])

  // Position below the selection so the user can still see what
  // they're commenting on.
  const top = anchorRect.bottom + 8
  const left = Math.max(8, Math.min(anchorRect.right - 320, window.innerWidth - 340))

  return createPortal(
    <div
      className="duo-comment-composer"
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: 320,
        background: 'var(--duo-paper)',
        border: '1px solid var(--duo-paper-edge)',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(20, 14, 8, 0.18)',
        padding: 10,
        zIndex: 60
      }}
    >
      {excerpt && (
        <div style={{
          fontSize: 11,
          color: 'var(--duo-ink-mute)',
          marginBottom: 6,
          fontStyle: 'italic',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          “{excerpt}”
        </div>
      )}
      <textarea
        ref={taRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        style={{
          width: '100%',
          minHeight: 64,
          background: 'var(--duo-paper)',
          border: '1px solid var(--duo-paper-edge)',
          borderRadius: 4,
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: 12,
          color: 'var(--duo-ink)',
          resize: 'vertical'
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit(body)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="duo-comment-thread__action-link"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="duo-comment-thread__btn-primary"
          onClick={() => onSubmit(body)}
          disabled={body.trim().length === 0}
        >
          Comment
        </button>
      </div>
    </div>,
    document.body
  )
}
