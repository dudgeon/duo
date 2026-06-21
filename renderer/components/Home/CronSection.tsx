// ENH-223 Tier 2 — the aggregated "Scheduled" block on Home (D6). Holds only
// the jobs whose project ISN'T a surfaced hero/spine card (jobs under surfaced
// projects nest under their card instead — see HomeView's assignCronJobs split).
// Presentational: HomeView owns the live `useCronJobs` hook and hands down the
// unmatched jobs + invoke. Renders nothing when there are no unmatched jobs.

import type { CronJobView } from '@shared/types'
import { CronJobRow, NewScheduleButton, type CronInvoke } from './CronJobRow'

interface CronSectionProps {
  jobs: CronJobView[]
  invoke: CronInvoke
}

export function CronSection({ jobs, invoke }: CronSectionProps) {
  if (jobs.length === 0) return null

  return (
    <div className="duo-home-scheduled">
      <div className="duo-home-scheduled-head">
        <h3 className="duo-home-scheduled-title font-serif">Scheduled</h3>
        <NewScheduleButton label="+ New job" />
      </div>
      <div className="duo-home-cron-list">
        {jobs.map((job) => (
          <CronJobRow key={job.id} job={job} invoke={invoke} />
        ))}
      </div>
    </div>
  )
}
