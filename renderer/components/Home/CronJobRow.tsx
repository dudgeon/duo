// ENH-223 Tier 2 — the reusable cron-job row + the live job hook, shared by the
// aggregated "Scheduled" block (CronSection) AND the per-project nesting under
// hero/spine cards (D6). Each row owns its own busy + delete-confirm state so it
// drops in anywhere. `useCronJobs` fetches once then tracks the CRON_JOBS_CHANGED
// push (cron state only ever changes through Duo, so no polling).

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

export type CronInvoke = (op: string, args?: Record<string, unknown>) => Promise<unknown>

/** Fetch the job list once, then track it live off the CRON_JOBS_CHANGED push. */
export function useCronJobs(): { jobs: CronJobView[]; invoke: CronInvoke } {
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
  const invoke = useCallback<CronInvoke>((op, args) => window.electron.cron.invoke(op, args), [])
  return { jobs, invoke }
}

/** Open the create dialog seeded with a project cwd (the per-card "+ Schedule",
 *  D7), or the generic create (no seed → App falls back to the focused project). */
export function openCronCreate(defaultCwd?: string): void {
  window.dispatchEvent(new CustomEvent('duo-open-cron-modal', { detail: defaultCwd ? { defaultCwd } : {} }))
}

/** Open the dialog in edit mode for an existing job. */
export function openCronEdit(job: CronJobView): void {
  window.dispatchEvent(new CustomEvent('duo-open-cron-modal', { detail: { editJob: job } }))
}

/** The "+ Schedule" affordance for a project card (D7). */
export function NewScheduleButton({ cwd, label = '+ Schedule' }: { cwd?: string; label?: string }) {
  return (
    <button
      type="button"
      className="duo-home-cron-btn duo-home-cron-schedule"
      onClick={() => openCronCreate(cwd)}
      title="Schedule a Claude session for this project"
    >
      {label}
    </button>
  )
}

interface CronJobRowProps {
  job: CronJobView
  invoke: CronInvoke
  /** Hide the per-row project name (redundant when nested under a project card). */
  hideProject?: boolean
}

export function CronJobRow({ job, invoke, hideProject }: CronJobRowProps) {
  const [busy, setBusy] = useState(false)
  // Per-row delete confirm — a mechanical guard so a single click can't drop a
  // job (the destructive-op guard from CLAUDE.md). Cleared on a short timeout.
  const [armed, setArmed] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    },
    []
  )

  const act = useCallback(
    async (op: string) => {
      setBusy(true)
      try {
        await invoke(op, { id: job.id })
      } catch {
        /* the push refreshes on success; a failure leaves the row as-is */
      } finally {
        setBusy(false)
      }
    },
    [invoke, job.id]
  )

  const armDelete = useCallback(() => {
    setArmed(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setArmed(false), 4000)
  }, [])

  const st = statusOf(job)
  const next = job.enabled ? untilShort(job.nextFireAt) : ''

  return (
    <div className="duo-home-cron-row">
      <div className="duo-home-cron-text">
        <div className="duo-home-cron-head">
          <span className="duo-home-cron-name">{job.name}</span>
          <span className={`duo-home-cron-chip ${st.cls}`}>{st.label}</span>
        </div>
        <div className="duo-home-cron-meta">
          <span className="duo-home-cron-sched">{job.scheduleLabel}</span>
          {next && <span className="duo-home-cron-next">· {next}</span>}
          {!hideProject && <span className="duo-home-cron-proj">· {basename(job.cwd)}</span>}
        </div>
      </div>
      <div className="duo-home-cron-actions">
        <button
          type="button"
          className="duo-home-cron-btn"
          disabled={busy}
          onClick={() => act('run')}
          title="Run this job now"
        >
          Run now
        </button>
        {job.enabled ? (
          <button
            type="button"
            className="duo-home-cron-btn"
            disabled={busy}
            onClick={() => act('pause')}
            title="Pause — stop firing without deleting"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            className="duo-home-cron-btn"
            disabled={busy}
            onClick={() => act('resume')}
            title="Resume scheduling"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          className="duo-home-cron-btn"
          disabled={busy}
          onClick={() => openCronEdit(job)}
          title="Edit this job"
        >
          Edit
        </button>
        <button
          type="button"
          className={`duo-home-cron-btn is-delete${armed ? ' is-armed' : ''}`}
          disabled={busy}
          onClick={() => (armed ? act('rm') : armDelete())}
          title={armed ? 'Click again to delete' : 'Delete this job'}
        >
          {armed ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
