// ENH-231 — a compact catch-up row: the rest of the last-7-days that aren't
// live and don't need you. One line — state dot · goal · scheduled badge ·
// repo · age — clicking re-enters the session (the same click contract as a
// full card's primary).

import type { CatchupCard } from '@shared/types'
import { repoLabel, ageShort, compactDotClass } from './homeModel'

interface CompactSessionRowProps {
  card: CatchupCard
  now: number
  onOpenSession: (card: CatchupCard) => void
}

export function CompactSessionRow({ card, now, onOpenSession }: CompactSessionRowProps) {
  return (
    <button
      type="button"
      className="duo-cu-crow"
      data-uuid={card.uuid}
      title="Open session →"
      onClick={() => onOpenSession(card)}
    >
      <span className={`duo-cu-cdot ${compactDotClass(card)}`} />
      <span className="duo-cu-cgoal">{card.goal || '(untitled session)'}</span>
      {card.scheduled && (
        <span className="duo-cu-cclock" aria-label="scheduled">
          🕐
        </span>
      )}
      <span className="duo-cu-cage">
        {repoLabel(card.cwd)} · {ageShort(Math.max(0, now - card.lastActivityAt))}
      </span>
    </button>
  )
}
