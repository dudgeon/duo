import type { Meta, StoryObj } from '@storybook/react'
import type { CatchupCard, CatchupSnapshot } from '@shared/types'
import { CatchupBoard } from './CatchupBoard'

// ENH-239 Phase 1 — the Async Catch-Up Command Board ({ snapshot, now,
// onOpenSession, onOpenFile, onOpenUrl }). Stories cover a populated board and
// the all-empty degrade.
const NOW = Date.now()

function makeCard(over: Partial<CatchupCard> & Pick<CatchupCard, 'uuid' | 'goal' | 'state' | 'tier'>): CatchupCard {
  return {
    cwd: '/Users/geoff/code/duo',
    youAsked: 'Keep iterating on the catch-up board.',
    todos: [],
    files: [],
    artifacts: {},
    attention: null,
    gitBranch: 'main',
    lastActivityAt: NOW - 30 * 60_000,
    ...over,
  }
}

const populated: CatchupSnapshot = {
  generatedAt: NOW,
  mode: 'catchup',
  columns: {
    needsYou: {
      full: [
        makeCard({
          uuid: 'needs-1',
          goal: 'Approve the renderer refactor plan',
          state: 'needs-you',
          tier: 'full',
          attention: { reason: 'plan-to-approve' },
          open: { kind: 'duo', windowId: 1, tabId: 'tab-a' },
        }),
      ],
      compact: [],
    },
    working: {
      full: [
        makeCard({
          uuid: 'working-1',
          goal: 'Author the Home Storybook stories',
          state: 'working',
          tier: 'full',
          files: [{ path: '/Users/geoff/code/duo/renderer/components/Home/CatchupBoard.tsx', kind: 'edited' }],
          open: { kind: 'external' },
        }),
      ],
      compact: [
        makeCard({
          uuid: 'working-stalled',
          goal: 'Half-finished spike on the spine layout',
          state: 'working',
          tier: 'compact',
          lastActivityAt: NOW - 4 * 60 * 60_000,
        }),
      ],
    },
    done: {
      full: [
        makeCard({
          uuid: 'done-1',
          goal: 'Ship the mock-electron decorator',
          state: 'done',
          tier: 'full',
          artifacts: { pr: { number: 239, url: 'https://example.com/pr/239' }, tests: 'pass' },
        }),
      ],
      compact: [
        makeCard({
          uuid: 'done-stalled',
          goal: 'Abandoned experiment (worktree removed)',
          state: 'done',
          tier: 'compact',
          cwdGone: true,
          lastActivityAt: NOW - 6 * 24 * 60 * 60_000,
        }),
      ],
    },
  },
  watermarkAt: NOW - 24 * 60 * 60_000,
}

const empty: CatchupSnapshot = {
  generatedAt: NOW,
  mode: 'catchup',
  columns: {
    needsYou: { full: [], compact: [] },
    working: { full: [], compact: [] },
    done: { full: [], compact: [] },
  },
}

const meta = {
  title: 'Home/CatchupBoard',
  component: CatchupBoard,
  args: {
    snapshot: populated,
    now: NOW,
    onOpenSession: () => {},
    onOpenFile: () => {},
    onOpenUrl: () => {},
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CatchupBoard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { snapshot: empty } }
