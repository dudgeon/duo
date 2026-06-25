// ENH-231 — a compact catch-up row: a STALLED session (closed, no deliverable)
// in the Done column. One line — expand caret · state dot · title · worktree ·
// scheduled · age. Clicking the row EXPANDS it into the full SessionDigestCard
// in place (owner: collapsed rows need an expanded state that mirrors the
// cards). A gone worktree is greyed + struck through, with the reason on hover.

import type { CatchupCard } from '@shared/types'
import { worktreeInfo, ageShort, compactDotClass } from './homeModel'

interface CompactSessionRowProps {
  card: CatchupCard
  now: number
  onToggleExpand: (uuid: string) => void
}

export function CompactSessionRow({ card, now, onToggleExpand }: CompactSessionRowProps) {
  const cwdGone = card.cwdGone === true
  const heading = card.goal || '(untitled session)' // already the title ladder (extractGoal)
  const { repo, worktree } = worktreeInfo(card.cwd)
  return (
    <button
      type="button"
      className="duo-cu-crow"
      data-uuid={card.uuid}
      title={cwdGone ? `Worktree removed — ${card.cwd} no longer exists, so this session can't be resumed` : 'Click to expand'}
      aria-expanded={false}
      onClick={() => onToggleExpand(card.uuid)}
    >
      <span className="duo-cu-cexpand" aria-hidden>
        ▸
      </span>
      <span className={`duo-cu-cdot ${compactDotClass(card)}`} />
      <span className={`duo-cu-cgoal${cwdGone ? ' duo-cu-gone' : ''}`}>{heading}</span>
      {card.scheduled && (
        <span className="duo-cu-cclock" aria-label="scheduled">
          🕐
        </span>
      )}
      <span className="duo-cu-cage">
        {repo}
        {worktree ? ` ⑂ ${worktree}` : ''} · {ageShort(Math.max(0, now - card.lastActivityAt))}
      </span>
    </button>
  )
}
