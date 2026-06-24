// @vitest-environment jsdom
// ENH-231 — BUG-046 gate for the catch-up board: a hidden (inactive) Home must
// poll NOTHING, and toggling the mode must fire ZERO fetches (the board is kept
// warm by the isActive-gated effect, so a flip is a pure display switch). Also
// pins that getMode seeds the toggle and switching renders the board.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { HomeView } from './HomeView'
import type { CatchupSnapshot, HomeSnapshot, HomeMode } from '@shared/types'

const emptyCatchup: CatchupSnapshot = {
  generatedAt: 1,
  mode: 'catchup',
  columns: {
    needsYou: { full: [], compact: [] },
    working: { full: [], compact: [] },
    done: { full: [], compact: [] },
  },
}
const emptyProjects: HomeSnapshot = { generatedAt: 1, greeting: { openCount: 0 }, projects: [] }

let homeApi: {
  snapshot: ReturnType<typeof vi.fn>
  catchup: ReturnType<typeof vi.fn>
  getMode: ReturnType<typeof vi.fn>
  setMode: ReturnType<typeof vi.fn>
  onModeSet: ReturnType<typeof vi.fn>
  onHomeShow: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  homeApi = {
    snapshot: vi.fn(async () => emptyProjects),
    catchup: vi.fn(async () => emptyCatchup),
    getMode: vi.fn(async (): Promise<HomeMode> => 'projects'),
    setMode: vi.fn(async () => ({ ok: true })),
    onModeSet: vi.fn(() => () => {}),
    onHomeShow: vi.fn(() => () => {}),
  }
  ;(window as unknown as { electron: unknown }).electron = {
    home: homeApi,
    browser: { addTab: vi.fn(async () => ({ ok: true })) },
    cron: { invoke: vi.fn(async () => []), onJobsChanged: vi.fn(() => () => {}) },
  }
})
afterEach(cleanup)

describe('HomeView catch-up — BUG-046 fetch gating', () => {
  it('a hidden (inactive) Home fetches NOTHING — zero catchup AND zero snapshot', async () => {
    render(<HomeView isActive={false} />)
    // let any (incorrect) effects flush
    await new Promise((r) => setTimeout(r, 20))
    expect(homeApi.catchup).not.toHaveBeenCalled()
    expect(homeApi.snapshot).not.toHaveBeenCalled()
  })

  it('an active Home fetches both views (so a toggle is instant)', async () => {
    render(<HomeView isActive={true} />)
    await waitFor(() => expect(homeApi.catchup).toHaveBeenCalled())
    expect(homeApi.snapshot).toHaveBeenCalled()
  })

  it('toggling the mode fires ZERO new fetches and persists the pref', async () => {
    render(<HomeView isActive={true} />)
    await waitFor(() => expect(homeApi.catchup).toHaveBeenCalled())
    const catchupCalls = homeApi.catchup.mock.calls.length
    const snapshotCalls = homeApi.snapshot.mock.calls.length

    fireEvent.click(screen.getByRole('radio', { name: 'Catch-up' }))

    // the mode persisted, the board now shows…
    await waitFor(() => expect(homeApi.setMode).toHaveBeenCalledWith('catchup'))
    // …but NO new fetch fired (the board was already warm).
    expect(homeApi.catchup.mock.calls.length).toBe(catchupCalls)
    expect(homeApi.snapshot.mock.calls.length).toBe(snapshotCalls)
  })

  it('seeds the toggle from getMode and renders the board when catchup is active', async () => {
    homeApi.getMode.mockResolvedValueOnce('catchup')
    render(<HomeView isActive={true} />)
    // getMode flips it to catchup → the board (its bar) renders
    await waitFor(() => expect(screen.getByText(/full = open or needs you/)).toBeTruthy())
    expect(homeApi.catchup).toHaveBeenCalled()
  })
})
