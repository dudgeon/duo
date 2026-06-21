// ENH-223 Tier 2 — the create / edit dialog for a scheduled ("cron") job.
//
// Pure-UI complement to `duo cron add` / `duo cron edit` (UI/CLI parity, D7).
// Composes the recipe inputs (name · working dir · instruction · periodicity ·
// fresh/same session · catch-up) around the `window.electron.cron.invoke`
// bridge: a debounced `preview` op gives the F3 live human-readable schedule
// label + next-fire (validated in main, so the renderer doesn't re-derive the
// engine), and submit calls `add` (create) or `edit` (update). The Home list
// re-renders off the CRON_JOBS_CHANGED push, so we just close on success.
//
// Modal pattern cloned from NewVaultModal (window keydown Escape, backdrop
// dismiss, Atelier/Tailwind tokens). Enter does NOT auto-submit — the
// instruction is a textarea, so Enter inserts a newline; the user clicks Save.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CronJobView, CronSchedule, CronSessionMode } from '@shared/types'

interface NewCronJobModalProps {
  open: boolean
  /** When set, the dialog edits this job; otherwise it creates a new one. */
  editJob?: CronJobView | null
  /** Working dir to pre-fill on a create (a project root from the rail / Home
   *  "+ Schedule"); ignored in edit mode (the job's cwd wins). */
  defaultCwd?: string
  onClose: () => void
  /** Fired after a successful create/edit with the resulting view. */
  onSaved?: (job: CronJobView) => void
}

type PresetKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'cron'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Strip Electron's "Error invoking remote method 'x': Error: " IPC wrapper so
 *  the user-facing preview/save error reads as the real message. */
function cleanError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
}

const PRESETS: { value: PresetKind; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'cron', label: 'Custom' },
]

/** Decompose a persisted CronSchedule back into the form's preset + fields. */
function fromSchedule(s: CronSchedule | undefined): {
  preset: PresetKind
  at: string
  hourlyMinute: string
  weekday: string
  cronExpr: string
} {
  const base = { preset: 'daily' as PresetKind, at: '09:00', hourlyMinute: '0', weekday: '1', cronExpr: '0 9 * * 1-5' }
  if (!s) return base
  const pad = (n: number) => String(n).padStart(2, '0')
  if (s.kind === 'cron') return { ...base, preset: 'cron', cronExpr: s.expr }
  switch (s.preset) {
    case 'hourly':
      return { ...base, preset: 'hourly', hourlyMinute: String(s.minute) }
    case 'daily':
      return { ...base, preset: 'daily', at: `${pad(s.hour)}:${pad(s.minute)}` }
    case 'weekdays':
      return { ...base, preset: 'weekdays', at: `${pad(s.hour)}:${pad(s.minute)}` }
    case 'weekly':
      return { ...base, preset: 'weekly', weekday: String(s.weekday), at: `${pad(s.hour)}:${pad(s.minute)}` }
  }
  return base // defensive — a malformed / future-version persisted preset degrades to the daily form
}

export function NewCronJobModal({ open, editJob, defaultCwd, onClose, onSaved }: NewCronJobModalProps) {
  const isEdit = !!editJob
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [instruction, setInstruction] = useState('')
  const [preset, setPreset] = useState<PresetKind>('daily')
  const [at, setAt] = useState('09:00')
  const [hourlyMinute, setHourlyMinute] = useState('0')
  const [weekday, setWeekday] = useState('1')
  const [cronExpr, setCronExpr] = useState('0 9 * * 1-5')
  const [session, setSession] = useState<CronSessionMode>('fresh')
  const [catchUp, setCatchUp] = useState(false)

  const [preview, setPreview] = useState<{ label: string; nextFireAt: string | null } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // True while the latest schedule edit hasn't been previewed/validated yet —
  // gates Save so a click within the 250ms debounce can't submit an unvalidated
  // schedule (audit fix).
  const [previewPending, setPreviewPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Reset / seed on the open-transition only (don't nuke state on re-render).
  useEffect(() => {
    if (!open) return
    if (editJob) {
      const d = fromSchedule(editJob.schedule)
      setName(editJob.name)
      setCwd(editJob.cwd)
      setInstruction(editJob.instruction)
      setPreset(d.preset)
      setAt(d.at)
      setHourlyMinute(d.hourlyMinute)
      setWeekday(d.weekday)
      setCronExpr(d.cronExpr)
      setSession(editJob.session)
      setCatchUp(editJob.catchUpOnLaunch === true)
    } else {
      setName('')
      setCwd(defaultCwd ?? '')
      setInstruction('')
      setPreset('daily')
      setAt('09:00')
      setHourlyMinute('0')
      setWeekday('1')
      setCronExpr('0 9 * * 1-5')
      setSession('fresh')
      setCatchUp(false)
    }
    setPreview(null)
    setPreviewError(null)
    setError(null)
    setBusy(false)
    const h = setTimeout(() => nameRef.current?.focus(), 0)
    return () => clearTimeout(h)
  }, [open, editJob, defaultCwd])

  // Escape to close (window-level; this modal owns the gesture).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  /** The loose schedule args for the `preview` / `add` / `edit` ops. */
  const scheduleArgs = useCallback((): Record<string, string> => {
    switch (preset) {
      case 'hourly':
        return { every: 'hourly', at: `:${hourlyMinute.padStart(2, '0')}` }
      case 'daily':
        return { every: 'daily', at }
      case 'weekdays':
        return { every: 'weekdays', at }
      case 'weekly':
        return { every: 'weekly', on: weekday, at }
      case 'cron':
        return { cron: cronExpr }
    }
  }, [preset, at, hourlyMinute, weekday, cronExpr])

  // Debounced live preview (F3) — validate the draft schedule in main.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setPreviewPending(true)
    const h = setTimeout(() => {
      void window.electron.cron
        .invoke('preview', scheduleArgs())
        .then((r) => {
          if (cancelled) return
          const res = r as { scheduleLabel: string; nextFireAt: string | null }
          setPreview({ label: res.scheduleLabel, nextFireAt: res.nextFireAt })
          setPreviewError(null)
          setPreviewPending(false)
        })
        .catch((err) => {
          if (cancelled) return
          setPreview(null)
          setPreviewError(cleanError(err))
          setPreviewPending(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [open, scheduleArgs])

  if (!open) return null

  const canSave =
    !busy && !!name.trim() && !!cwd.trim() && !!instruction.trim() && !previewError && !previewPending

  // Browse… → native folder picker, seeded with the current path. Cancel keeps
  // whatever's typed.
  const onBrowseCwd = async () => {
    try {
      const picked = await window.electron.cron.pickDirectory(cwd.trim() || undefined)
      if (picked) setCwd(picked)
    } catch {
      /* picker unavailable / cancelled — leave the typed value */
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    const home = window.electron.env?.HOME ?? ''
    const expandedCwd = home ? cwd.trim().replace(/^~(?=$|\/)/, home) : cwd.trim()
    // Audit fix — require an absolute path. A relative/typo'd cwd would be
    // silently rewritten to the home dir at fire time (PtyManager fallback),
    // running the job in the wrong place with no error.
    if (!expandedCwd.startsWith('/')) {
      setError('Working directory must be an absolute path (e.g. /Users/you/project).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        cwd: expandedCwd,
        instruction: instruction.trim(),
        session,
        catchUp,
        ...scheduleArgs(),
      }
      if (isEdit && editJob) payload.id = editJob.id
      const saved = (await window.electron.cron.invoke(isEdit ? 'edit' : 'add', payload)) as CronJobView
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(cleanError(err))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'w-full px-2 py-1 bg-paper-deep border border-border rounded text-sm text-ink placeholder-ink-ghost focus:outline-accent'

  const nextRel = (() => {
    if (!preview?.nextFireAt) return null
    const ms = Date.parse(preview.nextFireAt) - Date.now()
    if (!Number.isFinite(ms) || ms <= 0) return 'soon'
    const mins = Math.floor(ms / 60_000)
    if (mins < 60) return `in ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `in ${hours}h`
    return `in ${Math.floor(hours / 24)}d`
  })()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="bg-surface-0 border border-border rounded-lg shadow-xl w-[520px] max-w-[92vw] p-5 text-ink max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink">{isEdit ? 'Edit Scheduled Job' : 'New Scheduled Job'}</h2>
          <button type="button" className="text-ink-mute hover:text-ink" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        {/* How scheduled jobs behave — interactive-only (no headless yet). */}
        <p className="mb-3 px-3 py-2 rounded text-xs bg-accent/10 border border-border text-ink-soft">
          Scheduled jobs run interactively in the terminal and require user interaction
          after the first prompt; headless (<span className="font-mono">-p</span>) execution
          is not yet supported.
        </p>

        {/* Name */}
        <label className="block text-xs text-ink-mute mb-1" htmlFor="cron-name">Name</label>
        <input
          id="cron-name"
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning triage"
          disabled={busy}
          className={`${inputCls} mb-3`}
        />

        {/* Project (working directory) — type a path or Browse to a folder. */}
        <label className="block text-xs text-ink-mute mb-1" htmlFor="cron-cwd">Project (working directory)</label>
        <div className="flex gap-2 mb-3">
          <input
            id="cron-cwd"
            type="text"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/Users/you/project"
            disabled={busy}
            className={`${inputCls} font-mono`}
          />
          <button
            type="button"
            onClick={onBrowseCwd}
            disabled={busy}
            className="shrink-0 px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50"
            title="Choose a folder"
          >
            Browse…
          </button>
        </div>

        {/* Instruction */}
        <label className="block text-xs text-ink-mute mb-1" htmlFor="cron-instruction">What should Claude do?</label>
        <textarea
          id="cron-instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="review my open PRs and summarize what needs my attention"
          disabled={busy}
          rows={2}
          className={`${inputCls} mb-3 resize-y`}
        />

        {/* Schedule — preset segmented control + conditional fields + live preview */}
        <div className="block text-xs text-ink-mute mb-1">Schedule</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              disabled={busy}
              className={[
                'px-2.5 py-1 text-xs rounded border transition-colors',
                preset === p.value ? 'border-accent bg-accent/10 text-accent' : 'border-border text-ink-soft hover:bg-accent/5',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-2">
          {preset === 'hourly' && (
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              at minute
              <input
                type="number"
                min={0}
                max={59}
                value={hourlyMinute}
                onChange={(e) => setHourlyMinute(e.target.value)}
                disabled={busy}
                className="w-16 px-2 py-1 bg-paper-deep border border-border rounded text-sm text-ink focus:outline-accent"
              />
            </label>
          )}
          {(preset === 'daily' || preset === 'weekdays' || preset === 'weekly') && (
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              at
              <input
                type="time"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                disabled={busy}
                className="px-2 py-1 bg-paper-deep border border-border rounded text-sm text-ink focus:outline-accent"
              />
            </label>
          )}
          {preset === 'weekly' && (
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              on
              <select
                value={weekday}
                onChange={(e) => setWeekday(e.target.value)}
                disabled={busy}
                className="px-2 py-1 bg-paper-deep border border-border rounded text-sm text-ink focus:outline-accent"
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </label>
          )}
          {preset === 'cron' && (
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 9 * * 1-5"
              disabled={busy}
              className={`${inputCls} font-mono flex-1 min-w-[180px]`}
              spellCheck={false}
            />
          )}
        </div>

        {/* F3 live preview */}
        <div className="mb-3 text-xs min-h-[1.25rem]">
          {previewError ? (
            <span className="duo-text-error">⚠ {previewError}</span>
          ) : preview ? (
            <span className="text-ink-mute">
              <span className="text-ink-soft">{preview.label}</span>
              {nextRel && <span> · next {nextRel}</span>}
            </span>
          ) : (
            <span className="text-ink-ghost">…</span>
          )}
        </div>

        {/* Session + catch-up */}
        <div className="flex flex-wrap items-center gap-4 mb-3">
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="text-ink-mute">Session</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="cron-session" checked={session === 'fresh'} onChange={() => setSession('fresh')} disabled={busy} className="accent-accent" />
              Fresh
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="cron-session" checked={session === 'same'} onChange={() => setSession('same')} disabled={busy} className="accent-accent" />
              Same (resume)
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
            <input type="checkbox" checked={catchUp} onChange={(e) => setCatchUp(e.target.checked)} disabled={busy} className="accent-accent" />
            Run once on next launch if missed
          </label>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded text-xs border duo-banner-error">
            <strong>Couldn't save:</strong> {error || 'no detail'}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 text-sm border border-border rounded text-ink hover:bg-accent/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create job'}
          </button>
        </div>
      </div>
    </div>
  )
}
