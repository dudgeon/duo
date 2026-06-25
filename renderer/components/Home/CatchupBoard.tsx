// ENH-231 — the Async Catch-Up Command Board: three attention columns (Needs
// you · Working · Done), each with full SessionDigestCards then a "last 7 days"
// tier of CompactSessionRows. The server (electron/home-snapshot.ts) is
// authoritative for column + tier assignment; this component renders the
// CatchupSnapshot verbatim.

import { useState, useCallback } from 'react'
import type { CatchupCard, CatchupColumn, CatchupSnapshot } from '@shared/types'
import { SessionDigestCard } from './SessionDigestCard'
import { CompactSessionRow } from './CompactSessionRow'

interface CatchupBoardProps {
  snapshot: CatchupSnapshot
  now: number
  onOpenSession: (card: CatchupCard) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
}

const COLUMNS: { key: keyof CatchupSnapshot['columns']; label: string; attn: boolean }[] = [
  { key: 'needsYou', label: 'Needs you', attn: true },
  { key: 'working', label: 'In progress', attn: false },
  { key: 'done', label: 'Done', attn: false },
]

function columnCount(col: CatchupColumn): number {
  return col.full.length + col.compact.length
}

export function CatchupBoard({ snapshot, now, onOpenSession, onOpenFile, onOpenUrl }: CatchupBoardProps) {
  const { columns } = snapshot
  // GAP-expand — which stalled compact rows are expanded into full cards in place.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleExpand = useCallback((uuid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })
  }, [])
  const total =
    columnCount(columns.needsYou) + columnCount(columns.working) + columnCount(columns.done)

  return (
    <div className="duo-cu-board-wrap">
      <div className="duo-cu-board-bar">
        <span className="duo-cu-digest">
          <b>{total}</b> {total === 1 ? 'session' : 'sessions'}
          {columnCount(columns.needsYou) > 0 && (
            <>
              {' · '}
              <span className="duo-cu-need">{columnCount(columns.needsYou)} need you</span>
            </>
          )}
        </span>
        <span className="duo-cu-bar-hint">full = needs you · working · finished · compact = stalled (unfinished)</span>
      </div>

      <div className="duo-cu-board">
        {COLUMNS.map(({ key, label, attn }) => {
          const col = columns[key]
          const count = columnCount(col)
          return (
            <section key={key} className={`duo-cu-col${attn ? ' attn' : ''}`} aria-label={label}>
              <div className="duo-cu-col-h">
                <span>{label}</span>
                <span className="duo-cu-col-cnt">{count}</span>
              </div>

              {col.full.map((card) => (
                <SessionDigestCard
                  key={card.uuid}
                  card={card}
                  now={now}
                  onOpenSession={onOpenSession}
                  onOpenFile={onOpenFile}
                  onOpenUrl={onOpenUrl}
                />
              ))}

              {col.compact.length > 0 && (
                <>
                  <div className="duo-cu-compact-divider">
                    {key === 'working' ? 'Closed · click to resume' : 'Worktree removed'}
                  </div>
                  {col.compact.map((card) =>
                    expanded.has(card.uuid) ? (
                      <div key={card.uuid} className="duo-cu-expanded">
                        <button
                          type="button"
                          className="duo-cu-collapse"
                          aria-expanded
                          onClick={() => toggleExpand(card.uuid)}
                        >
                          ▾ collapse
                        </button>
                        <SessionDigestCard
                          card={card}
                          now={now}
                          onOpenSession={onOpenSession}
                          onOpenFile={onOpenFile}
                          onOpenUrl={onOpenUrl}
                        />
                      </div>
                    ) : (
                      <CompactSessionRow key={card.uuid} card={card} now={now} onToggleExpand={toggleExpand} />
                    ),
                  )}
                </>
              )}

              {count === 0 && <div className="duo-cu-empty">—</div>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
