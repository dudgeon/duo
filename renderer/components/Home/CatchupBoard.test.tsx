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
  it('places cards in the column the server assigned (In progress: live full + closed compact)', () => {
    const needs = card({ uuid: 'n', state: 'needs-you', attention: { reason: 'question' }, goal: 'Needs goal' })
    const live = card({ uuid: 'w', state: 'working', goal: 'Live goal', open: { kind: 'duo', windowId: 1, tabId: 't' } })
    const closed = card({ uuid: 'cl', state: 'working', tier: 'compact', goal: 'Closed goal' })
    const done = card({ uuid: 'df', state: 'done', goal: 'Done goal' })
    renderBoard(
      snapshot({
        needsYou: { full: [needs], compact: [] },
        working: { full: [live], compact: [closed] },
        done: { full: [done], compact: [] },
      }),
    )
    expect(within(screen.getByRole('region', { name: 'Needs you' })).getByText('Needs goal')).toBeTruthy()
    const inProgress = screen.getByRole('region', { name: 'In progress' })
    expect(within(inProgress).getByText('Live goal')).toBeTruthy()
    // closed sessions are the compact tier under In progress
    expect(within(inProgress).getByText('Closed · click to resume')).toBeTruthy()
    expect(within(inProgress).getByText('Closed goal')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('Done goal')).toBeTruthy()
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

  it('a compact row EXPANDS into a full card on click; the card re-enters', () => {
    const onOpenSession = vi.fn()
    const c = card({ uuid: 'cr', state: 'done', tier: 'compact', goal: 'Compact goal' })
    renderBoard(snapshot({ done: { full: [], compact: [c] } }), { onOpenSession })
    // collapsed: clicking the row expands it (does NOT immediately re-enter)
    fireEvent.click(screen.getByText('Compact goal'))
    expect(onOpenSession).not.toHaveBeenCalled()
    // now the full card is shown — its primary action re-enters the session
    fireEvent.click(screen.getByText('Open session →'))
    expect(onOpenSession).toHaveBeenCalledWith(c)
    // and a collapse control appears
    expect(screen.getByText('▾ collapse')).toBeTruthy()
  })

  it('a Duo-hosted live session shows the green "live" pill + "Focus session →"', () => {
    const c = card({ uuid: 'd', goal: 'Live one', open: { kind: 'duo', windowId: 1, tabId: 't1' } })
    renderBoard(snapshot({ working: { full: [c], compact: [] } }))
    expect(screen.getByText('● live')).toBeTruthy()
    expect(screen.getByText('Focus session →')).toBeTruthy()
  })

  it('an external-live session shows the amber "running" pill + "Open session →" (forks)', () => {
    const c = card({ uuid: 'e', goal: 'External one', open: { kind: 'external' } })
    renderBoard(snapshot({ working: { full: [c], compact: [] } }))
    expect(screen.getByText('● running')).toBeTruthy()
    expect(screen.getByText('Open session →')).toBeTruthy()
  })

  it('a worktree-gone card is struck through + offers no re-entry (reason on hover)', () => {
    const c = card({ uuid: 'g', goal: 'Gone one', cwd: '/Users/x/repo/.claude/worktrees/wt', state: 'done', tier: 'full', cwdGone: true })
    renderBoard(snapshot({ done: { full: [c], compact: [] } }))
    const goal = screen.getByText('Gone one')
    expect(goal.className).toContain('duo-cu-gone') // grey + strikethrough
    expect(goal.getAttribute('title')).toMatch(/Worktree removed/) // reason on hover
    // no re-entry button (it would dead-end) + no scary flag
    expect(screen.queryByText('Open session →')).toBeNull()
    expect(screen.queryByText(/worktree removed/i)).toBeNull() // no visible ⚠ tag
  })

  it('shows a worktree subpath badge (⑂ slug) for a worktree session', () => {
    const c = card({ uuid: 'wt', goal: 'WT one', cwd: '/Users/x/duo/.claude/worktrees/my-slug' })
    renderBoard(snapshot({ done: { full: [c], compact: [] } }))
    expect(screen.getByText('⑂ my-slug')).toBeTruthy()
    expect(screen.getByText('duo')).toBeTruthy() // repo label, not the slug
  })

  it('shows an empty marker for a column with no cards', () => {
    renderBoard(snapshot())
    // all three columns empty → three em-dashes
    expect(screen.getAllByText('—').length).toBe(3)
  })
})
