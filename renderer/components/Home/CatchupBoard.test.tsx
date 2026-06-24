// @vitest-environment jsdom
// ENH-231 — CatchupBoard rendering contract: column placement, the two-tier
// full/compact split, the attention chip (class + text), the scheduled badge,
// and the primary/secondary action wiring (D7). The server is authoritative for
// column/tier assignment, so the board renders the snapshot verbatim — these
// tests pin that it does.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { CatchupBoard } from './CatchupBoard'
import type { CatchupCard, CatchupSnapshot, CatchupColumn } from '@shared/types'

afterEach(cleanup)

function card(over: Partial<CatchupCard> = {}): CatchupCard {
  return {
    uuid: 'u1',
    cwd: '/Users/x/web-app',
    goal: 'Migrate analytics to v2',
    youAsked: 'keep v1 emitting',
    todos: [],
    files: [],
    artifacts: {},
    attention: null,
    state: 'done',
    gitBranch: null,
    lastActivityAt: 1000,
    tier: 'full',
    ...over,
  }
}

const emptyCol = (): CatchupColumn => ({ full: [], compact: [] })

function snapshot(over: Partial<CatchupSnapshot['columns']> = {}): CatchupSnapshot {
  return {
    generatedAt: 10_000,
    mode: 'catchup',
    columns: { needsYou: emptyCol(), working: emptyCol(), done: emptyCol(), ...over },
  }
}

function renderBoard(snap: CatchupSnapshot, handlers: Partial<Parameters<typeof CatchupBoard>[0]> = {}) {
  return render(
    <CatchupBoard
      snapshot={snap}
      now={snap.generatedAt}
      onOpenSession={handlers.onOpenSession ?? vi.fn()}
      onOpenFile={handlers.onOpenFile ?? vi.fn()}
      onOpenUrl={handlers.onOpenUrl ?? vi.fn()}
    />,
  )
}

describe('CatchupBoard', () => {
  it('places cards in the column the server assigned, full vs compact', () => {
    const needs = card({ uuid: 'n', state: 'needs-you', attention: { reason: 'question' }, goal: 'Needs goal' })
    const working = card({ uuid: 'w', state: 'working', goal: 'Working goal', open: { kind: 'duo', windowId: 1, tabId: 't' } })
    const doneFull = card({ uuid: 'df', state: 'done', goal: 'Done full', open: { kind: 'duo', windowId: 1, tabId: 't2' } })
    const doneCompact = card({ uuid: 'dc', state: 'done', tier: 'compact', goal: 'Done compact' })
    renderBoard(
      snapshot({
        needsYou: { full: [needs], compact: [] },
        working: { full: [working], compact: [] },
        done: { full: [doneFull], compact: [doneCompact] },
      }),
    )
    const needsCol = screen.getByRole('region', { name: 'Needs you' })
    expect(within(needsCol).getByText('Needs goal')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Working' })).getByText('Working goal')).toBeTruthy()
    const doneCol = screen.getByRole('region', { name: 'Done — review' })
    expect(within(doneCol).getByText('Done full')).toBeTruthy()
    // compact row sits under the "Earlier" divider
    expect(within(doneCol).getByText('Earlier · last 7 days')).toBeTruthy()
    expect(within(doneCol).getByText('Done compact')).toBeTruthy()
  })

  it('renders the attention chip with its reason class + label', () => {
    renderBoard(
      snapshot({ needsYou: { full: [card({ uuid: 'p', state: 'needs-you', attention: { reason: 'plan-to-approve' } })], compact: [] } }),
    )
    const chip = screen.getByText('📋 plan to approve')
    expect(chip.className).toContain('duo-banner-warn')
  })

  it('renders the scheduled badge for a cron-minted card', () => {
    renderBoard(
      snapshot({ done: { full: [card({ uuid: 's', scheduled: true })], compact: [] } }),
    )
    expect(screen.getByText('🕐 scheduled')).toBeTruthy()
  })

  it('primary "Open session →" re-enters; "Review PR" opens the url (D7)', () => {
    const onOpenSession = vi.fn()
    const onOpenUrl = vi.fn()
    const c = card({ uuid: 'pr', state: 'done', artifacts: { pr: { number: 88, url: 'https://github.com/o/r/pull/88' } } })
    renderBoard(snapshot({ done: { full: [c], compact: [] } }), { onOpenSession, onOpenUrl })
    fireEvent.click(screen.getByText('Open session →'))
    expect(onOpenSession).toHaveBeenCalledWith(c)
    fireEvent.click(screen.getByText('Review PR #88 →'))
    expect(onOpenUrl).toHaveBeenCalledWith('https://github.com/o/r/pull/88')
  })

  it('a Done md product leads with the artifact (Open <file> →)', () => {
    const onOpenFile = vi.fn()
    const c = card({ uuid: 'md', state: 'done', artifacts: { createdFiles: ['/Users/x/web-app/q3.md'] } })
    renderBoard(snapshot({ done: { full: [c], compact: [] } }), { onOpenFile })
    fireEvent.click(screen.getByText('Open q3.md →'))
    expect(onOpenFile).toHaveBeenCalledWith('/Users/x/web-app/q3.md')
  })

  it('a compact row click re-enters the session', () => {
    const onOpenSession = vi.fn()
    const c = card({ uuid: 'cr', state: 'done', tier: 'compact', goal: 'Compact goal' })
    renderBoard(snapshot({ done: { full: [], compact: [c] } }), { onOpenSession })
    fireEvent.click(screen.getByText('Compact goal'))
    expect(onOpenSession).toHaveBeenCalledWith(c)
  })

  it('shows an empty marker for a column with no cards', () => {
    renderBoard(snapshot())
    // all three columns empty → three em-dashes
    expect(screen.getAllByText('—').length).toBe(3)
  })
})
