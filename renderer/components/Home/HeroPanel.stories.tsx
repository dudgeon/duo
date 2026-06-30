import type { Meta, StoryObj } from '@storybook/react'
import type { HomeProject, CronJobView } from '@shared/types'
import type { CronInvoke } from './CronJobRow'
import { HeroPanel } from './HeroPanel'

// ENH-239 Phase 1 — a rich hero project panel ({ project, cronJobs, cronInvoke,
// onActivateSession, onOpenFile }). Stories cover a project with sessions +
// recent files + a nested cron job, and a minimal single-session one.
const NOW = Date.now()
const cronInvoke: CronInvoke = async () => undefined

const project: HomeProject = {
  rootPath: '/Users/geoff/code/duo',
  displayName: 'duo',
  colorIndex: 0,
  lastActiveAt: NOW - 12 * 60_000,
  sessionCount: 3,
  snippet: { sessionUuid: 'sess-1', text: 'Wired the Storybook harness and the first CSF stories.' },
  sessions: [
    {
      uuid: 'sess-1',
      title: 'Storybook harness for the renderer',
      titleSource: 'customTitle',
      modifiedAt: NOW - 12 * 60_000,
      cwd: '/Users/geoff/code/duo',
      open: { kind: 'duo', windowId: 1, tabId: 'tab-a' },
    },
    {
      uuid: 'sess-2',
      title: 'Catch-up board column polish',
      titleSource: 'aiTitle',
      modifiedAt: NOW - 3 * 60 * 60_000,
      cwd: '/Users/geoff/code/duo',
    },
  ],
  recentFiles: [
    { path: '/Users/geoff/code/duo/renderer/components/Home/HeroPanel.tsx', mtime: NOW - 10 * 60_000 },
    { path: '/Users/geoff/code/duo/.storybook/preview.tsx', mtime: NOW - 40 * 60_000 },
  ],
}

const cronJobs: CronJobView[] = [
  {
    kind: 'claude',
    id: 'job_1',
    name: 'Morning catch-up',
    cwd: '/Users/geoff/code/duo',
    schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
    catchUpOnLaunch: null,
    enabled: true,
    lastRunAt: null,
    lastRunState: null,
    createdAt: new Date(NOW - 24 * 60 * 60_000).toISOString(),
    instruction: 'Summarize overnight activity',
    session: 'fresh',
    lastSessionId: null,
    nextFireAt: new Date(NOW + 3 * 60 * 60_000).toISOString(),
    scheduleLabel: 'every day at 09:00',
  },
]

const meta = {
  title: 'Home/HeroPanel',
  component: HeroPanel,
  args: {
    project,
    cronJobs,
    cronInvoke,
    onActivateSession: () => {},
    onOpenFile: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeroPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const NoCronNoFiles: Story = {
  args: {
    project: {
      ...project,
      displayName: 'home-brain',
      colorIndex: 2,
      sessionCount: 1,
      snippet: undefined,
      sessions: [project.sessions[0]],
      recentFiles: [],
    },
    cronJobs: [],
  },
}
