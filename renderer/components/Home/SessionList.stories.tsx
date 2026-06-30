import type { Meta, StoryObj } from '@storybook/react'
import type { HomeProject, HomeSession } from '@shared/types'
import { SessionList } from './SessionList'

// ENH-239 Phase 1 — a project's session list with the lazy "all N sessions"
// expander. The mock electron decorator backs window.electron.home.listSessions
// for the expander; here sessionCount === inline count so the expander stays
// hidden and the list renders from the inline fixture alone.

function session(uuid: string, title: string, overrides: Partial<HomeSession> = {}): HomeSession {
  return {
    uuid,
    title,
    titleSource: 'jsonl-firstmsg',
    modifiedAt: Date.now() - 1000 * 60 * 30,
    cwd: '/Users/you/project',
    ...overrides,
  }
}

const project: HomeProject = {
  rootPath: '/Users/you/project',
  displayName: 'project',
  colorIndex: 0,
  lastActiveAt: Date.now() - 1000 * 60 * 10,
  sessionCount: 3,
  sessions: [
    session('s1', 'Wire the catch-up board', { open: { kind: 'duo', windowId: 1, tabId: 'tab-a' } }),
    session('s2', 'Refactor the cron store'),
    session('s3', 'Fix the spine fold'),
  ],
  recentFiles: [],
}

const meta = {
  title: 'Home/SessionList',
  component: SessionList,
  args: { project, onActivateSession: () => {} },
} satisfies Meta<typeof SessionList>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithReplySnippet: Story = {
  args: {
    snippet: { sessionUuid: 's1', text: 'Done — the board now renders three columns and the fold works.' },
  },
}

export const WithExpander: Story = {
  args: {
    project: { ...project, sessionCount: 42 },
  },
}
