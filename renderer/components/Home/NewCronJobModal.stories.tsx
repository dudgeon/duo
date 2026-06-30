import type { Meta, StoryObj } from '@storybook/react'
import type { CronJobView } from '@shared/types'
import { NewCronJobModal } from './NewCronJobModal'

// ENH-239 Phase 1 — HEAVY component (the create / edit cron dialog). It reads a
// debounced live `preview` op + folder picker off window.electron.cron (backed
// by the global mock-electron decorator). Smoke stories mount it open in each
// mode; the live preview line resolves from the mock.

const claudeJob: CronJobView = {
  kind: 'claude',
  id: 'job_0001',
  name: 'Morning triage',
  cwd: '/Users/you/project',
  schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
  catchUpOnLaunch: null,
  enabled: true,
  lastRunAt: null,
  lastRunState: null,
  createdAt: new Date().toISOString(),
  instruction: 'review my open PRs and summarize what needs my attention',
  session: 'fresh',
  lastSessionId: null,
  nextFireAt: null,
  scheduleLabel: 'every day at 09:00',
}

const shellJob: CronJobView = {
  kind: 'shell',
  id: 'job_0002',
  name: 'Re-index notes',
  cwd: '/Users/you/notes',
  schedule: { kind: 'cron', expr: '0 */6 * * *' },
  catchUpOnLaunch: null,
  enabled: true,
  lastRunAt: null,
  lastRunState: null,
  createdAt: new Date().toISOString(),
  command: 'qmd update && qmd embed',
  nextFireAt: null,
  scheduleLabel: 'every 6 hours',
}

const meta = {
  title: 'Home/NewCronJobModal',
  component: NewCronJobModal,
  args: { open: true, onClose: () => {} },
} satisfies Meta<typeof NewCronJobModal>

export default meta
type Story = StoryObj<typeof meta>

export const Create: Story = {}

export const CreateSeededCwd: Story = {
  args: { defaultCwd: '/Users/you/project' },
}

export const EditClaudeJob: Story = {
  args: { editJob: claudeJob },
}

export const EditShellJob: Story = {
  args: { editJob: shellJob },
}

// Closed — renders null.
export const Closed: Story = {
  args: { open: false },
}
