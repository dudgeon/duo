// ENH-231 — a compact catch-up row: a STALLED session (closed, no deliverable)
// in the Done column. One line — expand caret · state dot · goal · scheduled ·
// age. Clicking the row EXPANDS it into the full SessionDigestCard in place
// (owner: collapsed rows need an expanded state that mirrors the cards); a gone
// worktree is struck through.

import type { CatchupCard } from '@shared/types'
import { repoLabel, ageShort, compactDotClass } from './homeModel'

interface CompactSessionRowProps {
  card: CatchupCard
  now: number
  onToggleExpand: (uuid: string) => void
}

export function CompactSessionRow({ card, now, onToggleExpand }: CompactSessionRowProps) {
  const cwdGone = card.cwdGone === true
  return (
    <button
      type="button"
      className="duo-cu-crow"
      data-uuid={card.uuid}
      title="Click to expand"
      aria-expanded={false}
      onClick={() => onToggleExpand(card.uuid)}
    >
      <span className="duo-cu-cexpand" aria-hidden>
        ▸
      </span>
      <span className={`duo-cu-cdot ${compactDotClass(card)}`} />
      <span className={`duo-cu-cgoal${cwdGone ? ' duo-cu-gone' : ''}`}>{card.goal || '(untitled session)'}</span>
      {card.scheduled && (
        <span className="duo-cu-cclock" aria-label="scheduled">
          🕐
        </span>
      )}
      {cwdGone && (
        <span className="duo-cu-cgone" aria-label="worktree removed" title={`${card.cwd} no longer exists`}>
          ⚠
        </span>
      )}
      <span className="duo-cu-cage">
        {repoLabel(card.cwd)} · {ageShort(Math.max(0, now - card.lastActivityAt))}
      </span>
    </button>
  )
}
