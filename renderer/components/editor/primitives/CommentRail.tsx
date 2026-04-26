// Stage 17d / Stage 11d (future) — Comment rail (editor-agnostic primitive).
//
// Right-side rail showing threaded comments anchored to ranges in the
// host document. Visual layer only — data storage + anchor positioning
// are surface-specific:
//
//   - HTML canvas binding (ships in Stage 17d): reads/writes
//     `<file>.duo.json § comments[]`; anchors are `data-duo-id` on
//     iframe elements.
//   - Markdown editor binding (Stage 11d / 14): parses CriticMarkup
//     `{>>[author · ts] body<<}` from the doc; anchors are PM ranges
//     wrapped in a TipTap mark.
//
// Both surfaces transform their native data model into `CommentThread`
// records and pass them in. Both surfaces own their own anchor-badge
// painting (canvas paints DOM chips; markdown paints TipTap
// decorations). The rail itself only knows about threads + clicks.
//
// Per `primitives/README.md`: no editor imports, no IPC, no singleton
// state. The host owns the wire; the primitive owns the chrome.

import { useEffect, useRef, useState } from 'react'

/** A single message inside a thread. Comments thread by anchor — same
 *  anchor → same thread. The primitive renders entries in the order
 *  the host supplies (typically chronological per thread). */
export interface CommentEntry {
  /** Stable id per entry. Host generates when persisting (canvas:
   *  `cmt_<ulid>`; markdown: a stable hash of the CriticMarkup span). */
  id: string
  /** Author display name. `'claude'` triggers the ✨ agent badge. */
  author: string
  /** ISO 8601 timestamp. Rendered as relative time ("2m ago"). */
  ts: string
  /** Comment body. Plain text in v1; markdown rendering is deferred. */
  body: string
}

/** A thread is one or more entries against a single anchor. */
export interface CommentThread {
  /** Stable thread id — typically the anchor's id (canvas: the anchor
   *  element's `data-duo-id`; markdown: a thread-id minted by the
   *  CriticMarkup parser). */
  id: string
  /** Numeric label shown in the body badge AND the rail header.
   *  1-indexed; host sorts threads in document order. */
  number: number
  /** Optional human-readable preview of what the thread anchors to —
   *  e.g. the first ~40 chars of the anchored element's textContent.
   *  Helps the user recognise threads without scrolling to each. */
  excerpt?: string
  /** Threads collapse to a single line + count when resolved.
   *  Hosts store this in their persistence layer; primitive only
   *  reflects state. */
  resolved?: boolean
  /** Entries in chronological order. */
  entries: CommentEntry[]
}

export interface CommentRailProps {
  /** Pre-sorted threads (by document order). Empty array → rail
   *  renders the empty state; pass `null` to hide entirely. */
  threads: CommentThread[] | null
  /** Currently focused thread (e.g. user clicked an anchor badge in
   *  the body). The rail scrolls this entry into view + paints a
   *  highlight ring. */
  activeThreadId?: string | null
  /** User clicked the thread header in the rail — host should scroll
   *  the document to the anchor + flash a highlight. */
  onJumpTo: (threadId: string) => void
  /** User submitted a reply. Host appends to the thread + persists. */
  onReply: (threadId: string, body: string) => void
  /** User clicked Resolve on a thread. Host marks resolved + persists. */
  onResolve: (threadId: string) => void
  /** Optional: user clicked Reopen on a resolved thread. If omitted,
   *  resolved threads only show their resolved state — no reopen UX. */
  onReopen?: (threadId: string) => void
}

export function CommentRail({
  threads,
  activeThreadId,
  onJumpTo,
  onReply,
  onResolve,
  onReopen
}: CommentRailProps) {
  if (threads === null) return null

  return (
    <aside className="duo-comment-rail" aria-label="Comments">
      <div className="duo-comment-rail__header">
        <span className="duo-comment-rail__count">
          {threads.length === 0
            ? 'No comments'
            : `${threads.length} comment${threads.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="duo-comment-rail__threads">
        {threads.length === 0 ? (
          <div className="duo-comment-rail__empty">
            Select text + click <strong>Comment</strong> to start a thread.
          </div>
        ) : (
          threads.map((t) => (
            <CommentThreadCard
              key={t.id}
              thread={t}
              active={activeThreadId === t.id}
              onJumpTo={onJumpTo}
              onReply={onReply}
              onResolve={onResolve}
              onReopen={onReopen}
            />
          ))
        )}
      </div>
    </aside>
  )
}

interface CardProps {
  thread: CommentThread
  active: boolean
  onJumpTo: CommentRailProps['onJumpTo']
  onReply: CommentRailProps['onReply']
  onResolve: CommentRailProps['onResolve']
  onReopen?: CommentRailProps['onReopen']
}

function CommentThreadCard({ thread, active, onJumpTo, onReply, onResolve, onReopen }: CardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')

  // Scroll into view when activated by an external click (anchor badge
  // in body). Threshold check avoids the jarring scroll on every
  // render where activeThreadId is set but the card is already visible.
  useEffect(() => {
    if (!active || !cardRef.current) return
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const submit = () => {
    const body = replyText.trim()
    if (!body) return
    onReply(thread.id, body)
    setReplyText('')
    setReplyOpen(false)
  }

  return (
    <div
      ref={cardRef}
      className={[
        'duo-comment-thread',
        active && 'duo-comment-thread--active',
        thread.resolved && 'duo-comment-thread--resolved'
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="duo-comment-thread__header"
        onClick={() => onJumpTo(thread.id)}
        aria-label={`Jump to comment ${thread.number}`}
      >
        <span className="duo-comment-thread__number">{thread.number}</span>
        {thread.excerpt && (
          <span className="duo-comment-thread__excerpt" title={thread.excerpt}>
            {thread.excerpt}
          </span>
        )}
      </button>
      {!thread.resolved && (
        <div className="duo-comment-thread__entries">
          {thread.entries.map((e) => (
            <CommentEntryRow key={e.id} entry={e} />
          ))}
        </div>
      )}
      {thread.resolved ? (
        <div className="duo-comment-thread__resolved-line">
          <span>Resolved · {thread.entries.length} reply{thread.entries.length === 1 ? '' : 's'}</span>
          {onReopen && (
            <button
              type="button"
              className="duo-comment-thread__action-link"
              onClick={() => onReopen(thread.id)}
            >
              Reopen
            </button>
          )}
        </div>
      ) : (
        <div className="duo-comment-thread__actions">
          {!replyOpen ? (
            <>
              <button
                type="button"
                className="duo-comment-thread__action-link"
                onClick={() => setReplyOpen(true)}
              >
                Reply
              </button>
              <button
                type="button"
                className="duo-comment-thread__action-link"
                onClick={() => onResolve(thread.id)}
              >
                Resolve
              </button>
            </>
          ) : (
            <div className="duo-comment-thread__reply-form">
              <textarea
                className="duo-comment-thread__reply-input"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Reply…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit()
                  } else if (e.key === 'Escape') {
                    setReplyOpen(false)
                    setReplyText('')
                  }
                }}
              />
              <div className="duo-comment-thread__reply-actions">
                <button
                  type="button"
                  className="duo-comment-thread__action-link"
                  onClick={() => { setReplyOpen(false); setReplyText('') }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="duo-comment-thread__btn-primary"
                  onClick={submit}
                  disabled={replyText.trim().length === 0}
                >
                  Reply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CommentEntryRow({ entry }: { entry: CommentEntry }) {
  const isAgent = entry.author === 'claude'
  return (
    <div className="duo-comment-entry">
      <div className="duo-comment-entry__meta">
        <span className={`duo-comment-entry__author${isAgent ? ' duo-comment-entry__author--agent' : ''}`}>
          {isAgent && <span aria-hidden="true">✨</span>} {entry.author}
        </span>
        <span className="duo-comment-entry__ts" title={entry.ts}>{relativeTime(entry.ts)}</span>
      </div>
      <div className="duo-comment-entry__body">{entry.body}</div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(then).toLocaleDateString()
}
