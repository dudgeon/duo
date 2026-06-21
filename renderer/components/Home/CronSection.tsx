// ENH-221 Tier 2 — the "Scheduled" block on Home. Lists every cron job with a
// status chip + next-fire + row actions (run-now / pause / resume / delete),
// driven live by the main-process CronService (fetch once, then the
// CRON_JOBS_CHANGED push keeps it fresh — cron state only ever changes through
// Duo, so no polling). A first increment toward D6: this is the aggregated
// block; per-project nesting under hero/spine cards is a follow-up.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CronJobView } from '@shared/types'
import { ageShort } from './homeModel'

function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

/** Short relative label for a future fire time ("in 3h", "in 2d", "soon"). */
function untilShort(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 60_000) return 'soon'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.floor(hours / 24)
  return `in ${days}d`
}

interface CronStatus {
  label: string
  cls: string
}
function statusOf(job: CronJobView): CronStatus {
  if (!job.enabled) return { label: 'paused', cls: 'is-paused' }
  switch (job.lastRunState) {
    case 'ran':
      return {
        label: job.lastRunAt ? `ran ${ageShort(Date.now() - Date.parse(job.lastRunAt))}` : 'ran',
        cls: 'is-ran',
      }
    case 'fresh-fallback':
      return { label: 'ran · fresh', cls: 'is-ran' }
    case 'missed':
      return { label: 'missed', cls: 'is-missed' }
    case 'error':
      return { label: 'error', cls: 'is-error' }
    default:
      return { label: 'never run', cls: 'is-never' }
  }
}

/** Fetch the job list once, then track it live off the CRON_JOBS_CHANGED push. */
export function useCronJobs(): {
  jobs: CronJobView[]
  invoke: (op: string, args?: Record<string, unknown>) => Promise<unknown>
} {
  const [jobs, setJobs] = useState<CronJobView[]>([])
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    void (window.electron.cron.invoke('list') as Promise<CronJobView[]>)
      .then((list) => {
        if (aliveRef.current && Array.isArray(list)) setJobs(list)
      })
      .catch(() => {})
    const unsub = window.electron.cron.onJobsChanged((list) => {
      if (aliveRef.current) setJobs(list)
    })
    return () => {
      aliveRef.current = false
      unsub()
    }
  }, [])
  const invoke = useCallback(
    (op: string, args?: Record<string, unknown>) => window.electron.cron.invoke(op, args),
    []
  )
  return { jobs, invoke }
}

export function CronSection() {
  const { jobs, invoke } = useCronJobs()
  const [busyId, setBusyId] = useState<string | null>(null)
  // Per-row delete confirm — a mechanical guard so a single click can't drop a
  // job (the destructive-op guard from CLAUDE.md). Cleared on a short timeout.
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const act = useCallback(
    async (op: string, id: string) => {
      setBusyId(id)
      try {
        await invoke(op, { id })
      } catch {
        /* the push refreshes on success; a failure leaves the row as-is */
      } finally {
        setBusyId((cur) => (cur === id ? null : cur))
      }
    },
    [invoke]
  )

  const armDelete = useCallback((id: string) => {
    setConfirmId(id)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmId(null), 4000)
  }, [])

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  if (jobs.length === 0) return null

  return (
    <div className="duo-home-scheduled">
      <h3 className="duo-home-scheduled-title font-serif">Scheduled</h3>
      <div className="duo-home-cron-list">
        {jobs.map((job) => {
          const st = statusOf(job)
          const next = job.enabled ? untilShort(job.nextFireAt) : ''
          const busy = busyId === job.id
          const armed = confirmId === job.id
          return (
            <div key={job.id} className="duo-home-cron-row">
              <div className="duo-home-cron-text">
                <div className="duo-home-cron-head">
                  <span className="duo-home-cron-name">{job.name}</span>
                  <span className={`duo-home-cron-chip ${st.cls}`}>{st.label}</span>
                </div>
                <div className="duo-home-cron-meta">
                  <span className="duo-home-cron-sched">{job.scheduleLabel}</span>
                  {next && <span className="duo-home-cron-next">· {next}</span>}
                  <span className="duo-home-cron-proj">· {basename(job.cwd)}</span>
                </div>
              </div>
              <div className="duo-home-cron-actions">
                <button
                  type="button"
                  className="duo-home-cron-btn"
                  disabled={busy}
                  onClick={() => act('run', job.id)}
                  title="Run this job now"
                >
                  Run now
                </button>
                {job.enabled ? (
                  <button
                    type="button"
                    className="duo-home-cron-btn"
                    disabled={busy}
                    onClick={() => act('pause', job.id)}
                    title="Pause — stop firing without deleting"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    className="duo-home-cron-btn"
                    disabled={busy}
                    onClick={() => act('resume', job.id)}
                    title="Resume scheduling"
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  className={`duo-home-cron-btn is-delete${armed ? ' is-armed' : ''}`}
                  disabled={busy}
                  onClick={() => (armed ? act('rm', job.id) : armDelete(job.id))}
                  title={armed ? 'Click again to delete' : 'Delete this job'}
                >
                  {armed ? 'Confirm?' : 'Delete'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
