import type { Meta, StoryObj } from '@storybook/react'
import type { HomeProject, CronJobView } from '@shared/types'
import type { CronInvoke } from './CronJobRow'
import { SpineRow } from './SpineRow'

// ENH-239 Phase 1 — a compact spine row ({ project, expanded, cronJobs,
// cronInvoke, onToggle, onActivateSession }). Collapsed by default; the
// Expanded story reveals the nested SessionList + cron block.
const NOW = Date.now()
const cronInvoke: CronInvoke = async () => undefined

const project: HomeProject = {
  rootPath: '/Users/geoff/code/agents',
  displayName: 'agents-for-everyone',
  colorIndex: 1,
  lastActiveAt: NOW - 2 * 24 * 60 * 60_000,
  sessionCount: 2,
  sessions: [
    {
      uuid: 'sess-a',
      title: 'Docs pass on the skills catalog',
      titleSource: 'aiTitle',
      modifiedAt: NOW - 2 * 24 * 60 * 60_000,
      cwd: '/Users/geoff/code/agents',
    },
    {
      uuid: 'sess-b',
      title: 'Triage the inbox',
      titleSource: 'jsonl-firstmsg',
      modifiedAt: NOW - 5 * 24 * 60 * 60_000,
      cwd: '/Users/geoff/code/agents',
    },
  ],
  recentFiles: [],
}

const cronJobs: CronJobView[] = [
  {
    kind: 'shell',
    id: 'job_shell_1',
    name: 'Nightly index',
    cwd: '/Users/geoff/code/agents',
    schedule: { kind: 'cron', expr: '0 2 * * *' },
    catchUpOnLaunch: null,
    enabled: false,
    lastRunAt: new Date(NOW - 24 * 60 * 60_000).toISOString(),
    lastRunState: 'ran',
    createdAt: new Date(NOW - 7 * 24 * 60 * 60_000).toISOString(),
    command: 'qmd update && qmd embed',
    nextFireAt: null,
    scheduleLabel: 'at 02:00 daily',
  },
]

const meta = {
  title: 'Home/SpineRow',
  component: SpineRow,
  args: {
    project,
    expanded: false,
    cronJobs,
    cronInvoke,
    onToggle: () => {},
    onActivateSession: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpineRow>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const Expanded: Story = { args: { expanded: true } }

export const NoCron: Story = { args: { cronJobs: [] } }
