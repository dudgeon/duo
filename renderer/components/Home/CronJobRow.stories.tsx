import type { Meta, StoryObj } from '@storybook/react'
import type { CronJobView } from '@shared/types'
import { CronJobRow, NewScheduleButton } from './CronJobRow'

// ENH-239 Phase 1 — the reusable cron-job row + the "+ Schedule" affordance.
// invoke is a no-op stub here (the live hook lives in HomeView); each story
// constructs a minimal CronJobView fixture matching the discriminated union.

const noopInvoke = async () => undefined

const claudeJob: CronJobView = {
  kind: 'claude',
  id: 'job_0001',
  name: 'Morning triage',
  cwd: '/Users/you/project',
  schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
  catchUpOnLaunch: null,
  enabled: true,
  lastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  lastRunState: 'ran',
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
  instruction: 'review my open PRs and summarize what needs my attention',
  session: 'fresh',
  lastSessionId: null,
  nextFireAt: new Date(Date.now() + 1000 * 60 * 60 * 18).toISOString(),
  scheduleLabel: 'every day at 09:00',
}

const meta = {
  title: 'Home/CronJobRow',
  component: CronJobRow,
  args: { job: claudeJob, invoke: noopInvoke },
} satisfies Meta<typeof CronJobRow>

export default meta
type Story = StoryObj<typeof meta>

export const Ran: Story = {}

export const Paused: Story = {
  args: { job: { ...claudeJob, id: 'job_0002', name: 'Nightly digest', enabled: false } },
}

export const Missed: Story = {
  args: { job: { ...claudeJob, id: 'job_0003', name: 'Weekly report', lastRunState: 'missed' } },
}

export const Errored: Story = {
  args: { job: { ...claudeJob, id: 'job_0004', name: 'Sync vault', lastRunState: 'error' } },
}

export const NeverRun: Story = {
  args: { job: { ...claudeJob, id: 'job_0005', name: 'Fresh job', lastRunAt: null, lastRunState: null } },
}

export const HideProject: Story = {
  args: { hideProject: true },
}

export const ShellJob: Story = {
  args: {
    job: {
      kind: 'shell',
      id: 'job_0006',
      name: 'Re-index notes',
      cwd: '/Users/you/notes',
      schedule: { kind: 'cron', expr: '0 */6 * * *' },
      catchUpOnLaunch: null,
      enabled: true,
      lastRunAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      lastRunState: 'ran',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      command: 'qmd update && qmd embed',
      nextFireAt: new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString(),
      scheduleLabel: 'every 6 hours',
    },
  },
}

// Secondary export: the "+ Schedule" button that opens the create dialog.
export const ScheduleButton: Story = {
  render: () => <NewScheduleButton cwd="/Users/you/project" />,
}
