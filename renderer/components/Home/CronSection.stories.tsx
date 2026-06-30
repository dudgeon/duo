import type { Meta, StoryObj } from '@storybook/react'
import type { CronJobView } from '@shared/types'
import { CronSection } from './CronSection'

// ENH-239 Phase 1 — the aggregated "Scheduled" block. Presentational: it takes
// the unmatched jobs + a no-op invoke. Renders nothing when the list is empty.

const noopInvoke = async () => undefined

function job(id: string, name: string, overrides: Partial<CronJobView> = {}): CronJobView {
  return {
    kind: 'claude',
    id,
    name,
    cwd: '/Users/you/project',
    schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
    catchUpOnLaunch: null,
    enabled: true,
    lastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    lastRunState: 'ran',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    instruction: 'do the scheduled thing',
    session: 'fresh',
    lastSessionId: null,
    nextFireAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
    scheduleLabel: 'every day at 09:00',
    ...overrides,
  } as CronJobView
}

const meta = {
  title: 'Home/CronSection',
  component: CronSection,
  args: {
    invoke: noopInvoke,
    jobs: [
      job('job_a', 'Morning triage'),
      job('job_b', 'Weekly report', {
        enabled: false,
        schedule: { kind: 'preset', preset: 'weekly', weekday: 1, hour: 8, minute: 30 },
        scheduleLabel: 'every Monday at 08:30',
      }),
    ],
  },
} satisfies Meta<typeof CronSection>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SingleJob: Story = {
  args: { jobs: [job('job_solo', 'Sync vault')] },
}

// Renders nothing (empty job list short-circuits to null).
export const Empty: Story = {
  args: { jobs: [] },
}
