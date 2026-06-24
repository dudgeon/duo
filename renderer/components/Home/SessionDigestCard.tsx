// ENH-231 — the full Catch-Up card (the "briefing" anatomy, PRD D2 / plan §9):
// goal · "You asked" · next-steps (todo chips) · files · artifact chips · state
// badge · narrative-or-fallback. Primary action keyed to state (D7): re-enter
// the session by default; a Done md/html product leads with the artifact; PR /
// diff are quieter secondary links. Every field is from the pre-hydrated digest
// — ZERO inference here.

import type { CatchupCard } from '@shared/types'
import {
  cardHue,
  repoLabel,
  ageShort,
  digestPrimaryAction,
  digestSecondaryAction,
  toPlainPreview,
} from './homeModel'
import { AttentionChip, ScheduledBadge, LivePill, DoneBadge, StalledBadge, FileChips, ArtifactChips, TodoChips } from './CatchupChips'

interface SessionDigestCardProps {
  card: CatchupCard
  now: number
  onOpenSession: (card: CatchupCard) => void
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
}

export function SessionDigestCard({ card, now, onOpenSession, onOpenFile, onOpenUrl }: SessionDigestCardProps) {
  const needs = card.attention != null
  const hue = cardHue(card.cwd)
  // Finished = a closed (Done-column) card that earned a full tier via a real
  // deliverable (PR / completed plan / doc). The stalled compact rows are not.
  const isFinished = card.state === 'done' && card.tier === 'full'
  const isStalled = card.state === 'done' && card.tier === 'compact'
  const cwdGone = card.cwdGone === true
  const primary = digestPrimaryAction(card)
  const secondary = digestSecondaryAction(card)
  // Plain-text, length-bounded previews — the raw snippet is full markdown
  // (fenced code, bold, paths) and the whole last turn; the card shows a clamped
  // 2-line gist (CSS also line-clamps, so this is belt-and-suspenders).
  const rawStatus = card.narrative?.note ?? card.fallbackSnippet ?? null
  const statusLine = rawStatus ? toPlainPreview(rawStatus, 200) : null
  const youAsked = card.youAsked ? toPlainPreview(card.youAsked, 160) : null
  const nextLine = card.narrative?.next ? toPlainPreview(card.narrative.next, 140) : null

  const runPrimary = () => {
    if (primary.kind === 'artifact' && primary.path) onOpenFile(primary.path)
    else onOpenSession(card)
  }
  const runSecondary = () => {
    if (!secondary) return
    if (secondary.kind === 'pr' && secondary.value) onOpenUrl(secondary.value)
    else if (secondary.kind === 'file' && secondary.value) onOpenFile(secondary.value)
    else onOpenSession(card) // 'session' | 'diff' → re-enter
  }

  return (
    <div
      className={`duo-cu-card${needs ? ' needs' : ''}`}
      style={{ borderTopColor: hue }}
      data-uuid={card.uuid}
      data-state={card.state}
    >
      {card.scheduled && (
        <div className="duo-cu-card-sched">
          <ScheduledBadge />
        </div>
      )}

      <div className={`duo-cu-goal${cwdGone ? ' duo-cu-gone' : ''}`}>{card.goal || '(untitled session)'}</div>

      <div className="duo-cu-meta">
        <LivePill open={card.open} />
        {!card.open && isFinished && <DoneBadge />}
        {!card.open && isStalled && <StalledBadge />}
        <span className="duo-cu-hue" style={{ background: hue }} />
        <span className="duo-cu-repo">{repoLabel(card.cwd)}</span>
        <span aria-hidden>·</span>
        <span className="duo-cu-age">{ageShort(Math.max(0, now - card.lastActivityAt))}</span>
        {cwdGone && (
          <span className="duo-cu-gone-tag" title={`Worktree removed — ${card.cwd} no longer exists`}>
            ⚠ worktree removed
          </span>
        )}
      </div>

      {needs && card.attention && (
        <div className="duo-cu-chiprow">
          <AttentionChip reason={card.attention.reason} />
        </div>
      )}

      {youAsked && (
        <p className="duo-cu-line duo-cu-clamp">
          <span className="duo-cu-line-label">You asked</span> {youAsked}
        </p>
      )}

      <TodoChips todos={card.todos} />

      {nextLine && (
        <p className="duo-cu-line duo-cu-next duo-cu-clamp">
          <span className="duo-cu-line-label duo-cu-next-label">Next</span> {nextLine}
        </p>
      )}

      <FileChips files={card.files} onOpen={onOpenFile} />
      <ArtifactChips artifacts={card.artifacts} />

      {statusLine && <p className="duo-cu-status duo-cu-clamp">{statusLine}</p>}

      {cwdGone ? (
        // Re-entry can't resume (the worktree's gone) — don't offer a click that
        // dead-ends in `No conversation found`. A PR link (URL-based) still works.
        <button type="button" className="duo-cu-act" disabled title={`${card.cwd} no longer exists`}>
          Worktree removed — can't resume
        </button>
      ) : (
        <button type="button" className="duo-cu-act primary" onClick={runPrimary}>
          {primary.label}
        </button>
      )}
      {secondary && (secondary.kind === 'pr' || !cwdGone) && (
        <button type="button" className="duo-cu-act sec" onClick={runSecondary}>
          {secondary.label} →
        </button>
      )}
    </div>
  )
}
