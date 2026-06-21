// ENH-223 — the scheduled-cron orchestrator (main-process, but Electron-free
// so it unit-tests with fake timers + a mock runner).
//
// Owns: the in-app tick scheduler (fires jobs WHILE DUO IS OPEN — the F1/PRD
// hard constraint), the fresh/same-session decision (D3), the headless gate
// (D4), missed-run catch-up on launch (D5), and the `duo cron` CLI dispatch.
// Everything Electron-specific (resolving the landing window per D10, opening
// the terminal tab, checking whether a prior session's JSONL exists) is
// injected via CronRunner + sessionExists, so this module has no Electron deps.

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { CronJob, CronJobView, CronRunState, CronSessionMode, CronSchedule } from '../shared/types'
import { CronStore } from './cron-store'
import { nextFireAfterSchedule, describeSchedule, parseScheduleArgs } from './cron-schedule'
import {
  mintSessionId,
  buildFreshRunCommand,
  buildResumeRunCommand,
  assertInteractiveCommand,
} from './cron-command'

/** The Electron-side executor: spawn the interactive run. Implemented in
 *  electron/main.ts (resolves the D10 landing window, then
 *  dispatchNewTabToWindow({ kind:'shell', cwd, cmd })). */
export interface CronRunner {
  spawn(input: { cwd: string; command: string; jobId: string; jobName: string }): Promise<{
    ok: boolean
    error?: string
    /** D10(3) — the occurrence came due with NO Duo window open. Not a spawn
     *  failure: it's a "missed" run governed by D5 catch-up. */
    reason?: 'no-window'
  }>
}

export interface CronServiceDeps {
  store: CronStore
  runner: CronRunner
  /** Does a prior session's JSONL still exist for (cwd, sessionId)? (D3 resume-or-fallback). */
  sessionExists: (cwd: string, sessionId: string) => Promise<boolean>
  /** FEATURE_HEADLESS_CRON (D4). */
  headlessAllowed: boolean
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number
  /** Scheduler tick interval. Defaults to 30s. */
  tickMs?: number
  /** Optional logger. */
  log?: (msg: string) => void
}

const DEFAULT_TICK_MS = 30_000

export class CronService {
  private readonly store: CronStore
  private readonly runner: CronRunner
  private readonly sessionExists: (cwd: string, sessionId: string) => Promise<boolean>
  private readonly headlessAllowed: boolean
  private readonly now: () => number
  private readonly tickMs: number
  private readonly log: (msg: string) => void

  private timer: ReturnType<typeof setInterval> | null = null
  /** jobId → next-fire epoch ms. Absent = not scheduled (disabled / unschedulable). */
  private readonly nextFireAt = new Map<string, number>()
  /** jobs currently mid-fire — guards against a slow run overlapping its own next tick. */
  private readonly firing = new Set<string>()
  /** Tier 2 — listeners notified (with fresh views) after any job mutation, so
   *  the Home surface re-renders live without polling. */
  private readonly changeListeners = new Set<(jobs: CronJobView[]) => void>()

  constructor(deps: CronServiceDeps) {
    this.store = deps.store
    this.runner = deps.runner
    this.sessionExists = deps.sessionExists
    this.headlessAllowed = deps.headlessAllowed
    this.now = deps.now ?? (() => Date.now())
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS
    this.log = deps.log ?? (() => {})
  }

  /** Start scheduling. Call AFTER store.load(). Computes each job's next fire,
   *  kicks the missed-run catch-up (D5), and starts the tick loop. */
  start(): void {
    this.scheduleAll()
    void this.runCatchUp()
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.tick(), this.tickMs)
    // Don't keep the event loop alive solely for the tick (parity with how the
    // app's other timers behave); harmless under fake timers in tests.
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      ;(this.timer as { unref: () => void }).unref()
    }
  }

  /** Stop the tick loop (before-quit). Jobs remain persisted. */
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ── scheduling ────────────────────────────────────────────────────────────

  private scheduleAll(): void {
    const after = new Date(this.now())
    for (const job of this.store.getJobs()) this.rescheduleJob(job, after)
  }

  private rescheduleJob(job: CronJob, after: Date): void {
    if (!job.enabled) {
      this.nextFireAt.delete(job.id)
      return
    }
    let next: Date | null = null
    try {
      next = nextFireAfterSchedule(job.schedule, after)
    } catch {
      next = null
    }
    if (next) this.nextFireAt.set(job.id, next.getTime())
    else this.nextFireAt.delete(job.id)
  }

  /** D5 — on launch, fire each catch-up-enabled job ONCE if an occurrence was
   *  due while Duo was closed (collapsing multiple missed occurrences). */
  async runCatchUp(): Promise<void> {
    const t = this.now()
    const settings = this.store.getSettings()
    for (const job of this.store.getJobs()) {
      if (!job.enabled) continue
      const wantCatchUp = job.catchUpOnLaunch ?? settings.defaultCatchUpOnLaunch
      if (!wantCatchUp) continue
      const sinceStr = job.lastRunAt ?? job.createdAt
      const since = Date.parse(sinceStr)
      if (Number.isNaN(since)) continue
      let due: Date | null = null
      try {
        due = nextFireAfterSchedule(job.schedule, new Date(since))
      } catch {
        due = null
      }
      if (due && due.getTime() <= t) {
        this.log(`[cron] catch-up firing "${job.name}" (missed while closed)`)
        await this.fireJob(job.id, { reason: 'catch-up' })
      }
    }
  }

  private async tick(): Promise<void> {
    const t = this.now()
    for (const [jobId, at] of [...this.nextFireAt.entries()]) {
      if (at <= t) await this.fireJob(jobId, { reason: 'scheduled' })
    }
  }

  // ── firing a run ────────────────────────────────────────────────────────────

  /**
   * Fire a job now — the shared path for scheduled, catch-up, and manual runs.
   * Decides fresh vs resume (D3), builds + gates the command (D2/D4), spawns
   * the interactive run, records last-run state, and reschedules.
   */
  async fireJob(
    jobId: string,
    opts: { reason: 'scheduled' | 'manual' | 'catch-up' }
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.firing.has(jobId)) return { ok: false, error: 'a run for this job is already starting' }
    const job = this.store.getJob(jobId)
    if (!job) return { ok: false, error: `no such job: ${jobId}` }

    this.firing.add(jobId)
    try {
      let sessionId: string
      let command: string
      let runState: CronRunState

      const canResume =
        job.session === 'same' &&
        !!job.lastSessionId &&
        (await this.sessionExists(job.cwd, job.lastSessionId))

      if (canResume) {
        sessionId = job.lastSessionId as string
        command = buildResumeRunCommand(sessionId, job.instruction)
        runState = 'ran'
      } else {
        sessionId = mintSessionId()
        command = buildFreshRunCommand(sessionId, job.instruction)
        // A "same" job whose prior session vanished falls back to fresh (D3).
        runState = job.session === 'same' && job.lastSessionId ? 'fresh-fallback' : 'ran'
      }

      // D4 gate (no-op for our builders, load-bearing for any future raw cmd).
      assertInteractiveCommand(command, { headlessAllowed: this.headlessAllowed })

      const result = await this.runner.spawn({ cwd: job.cwd, command, jobId: job.id, jobName: job.name })
      const at = new Date(this.now()).toISOString()

      if (result.ok) {
        await this.store.updateJob(jobId, { lastSessionId: sessionId, lastRunAt: at, lastRunState: runState })
      } else if (result.reason === 'no-window') {
        // D10(3) — the occurrence came due with no Duo window open. That's a
        // "missed" run governed by D5 (catch-up on next launch), NOT a spawn
        // failure. Record the state but DON'T advance lastRunAt: catch-up
        // anchors on the last *real* run, so the missed occurrence stays
        // recoverable on relaunch instead of being silently consumed.
        this.log(`[cron] "${job.name}" came due with no window open — recorded missed (D5 catch-up applies)`)
        await this.store.updateJob(jobId, { lastRunState: 'missed' })
      } else {
        this.log(`[cron] run for "${job.name}" failed to spawn: ${result.error ?? 'unknown'}`)
        await this.store.updateJob(jobId, { lastRunAt: at, lastRunState: 'error' })
      }

      const fresh = this.store.getJob(jobId)
      if (fresh) this.rescheduleJob(fresh, new Date(this.now()))
      this.emitChange()
      return result
    } catch (err) {
      // Most likely the D4 gate, or a store-persist I/O failure thrown from
      // updateJob. Record nothing as "ran"; surface the error.
      const message = err instanceof Error ? err.message : String(err)
      this.log(`[cron] run for job ${jobId} blocked: ${message}`)
      // Audit fix — every other terminal branch reschedules; this one must too,
      // else a THROW (e.g. a disk-full persist) leaves nextFireAt anchored in
      // the past and every 30s tick re-fires + re-throws (tight retry loop).
      const fresh = this.store.getJob(jobId)
      if (fresh) this.rescheduleJob(fresh, new Date(this.now()))
      return { ok: false, error: message }
    } finally {
      this.firing.delete(jobId)
    }
  }

  // ── views ────────────────────────────────────────────────────────────────

  private toView(job: CronJob): CronJobView {
    let nextFireAt: string | null = null
    if (job.enabled) {
      try {
        const next = nextFireAfterSchedule(job.schedule, new Date(this.now()))
        nextFireAt = next ? next.toISOString() : null
      } catch {
        nextFireAt = null
      }
    }
    let scheduleLabel: string
    try {
      scheduleLabel = describeSchedule(job.schedule)
    } catch {
      scheduleLabel = 'invalid schedule'
    }
    return { ...job, nextFireAt, scheduleLabel }
  }

  listViews(): CronJobView[] {
    return this.store
      .getJobs()
      .map((j) => this.toView(j))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Tier 2 — subscribe to job-list changes (add / mutate / run / remove). The
   *  callback receives the fresh view list; returns an unsubscribe fn. */
  onJobsChanged(cb: (jobs: CronJobView[]) => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }

  /** Notify listeners with a fresh snapshot. Called after every mutation. */
  private emitChange(): void {
    if (this.changeListeners.size === 0) return
    const views = this.listViews()
    for (const cb of this.changeListeners) {
      try {
        cb(views)
      } catch {
        /* a bad listener must never break the scheduler */
      }
    }
  }

  // ── CLI dispatch (`duo cron <op>`) ───────────────────────────────────────────

  async handleCli(op: string, args: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'list':
        return this.listViews()

      case 'show': {
        const id = str(args.id)
        if (!id) throw new Error('cron show requires <id>')
        const job = this.store.getJob(id)
        if (!job) throw new Error(`no such job: ${id}`)
        return this.toView(job)
      }

      case 'add':
        return this.addFromArgs(args)

      case 'run': {
        const id = str(args.id)
        if (!id) throw new Error('cron run requires <id>')
        const r = await this.fireJob(id, { reason: 'manual' })
        if (!r.ok) throw new Error(r.error ?? 'run failed')
        const job = this.store.getJob(id)
        return job ? this.toView(job) : { ok: true }
      }

      case 'pause':
      case 'resume': {
        const id = str(args.id)
        if (!id) throw new Error(`cron ${op} requires <id>`)
        const updated = await this.store.updateJob(id, { enabled: op === 'resume' })
        if (!updated) throw new Error(`no such job: ${id}`)
        this.rescheduleJob(updated, new Date(this.now()))
        this.emitChange()
        return this.toView(updated)
      }

      case 'rm': {
        const id = str(args.id)
        if (!id) throw new Error('cron rm requires <id>')
        const removed = await this.store.removeJob(id)
        if (!removed) throw new Error(`no such job: ${id}`)
        this.nextFireAt.delete(id)
        this.emitChange()
        return { ok: true, removed: id }
      }

      case 'edit': {
        const id = str(args.id)
        if (!id) throw new Error('cron edit requires <id>')
        const patch = this.buildPatchFromArgs(args)
        if (Object.keys(patch).length === 0) {
          throw new Error('cron edit: nothing to change (pass --name/--cwd/--say/--every|--cron/--at/--on/--session/--catch-up|--no-catch-up)')
        }
        const updated = await this.store.updateJob(id, patch)
        if (!updated) throw new Error(`no such job: ${id}`)
        this.rescheduleJob(updated, new Date(this.now()))
        this.emitChange()
        return this.toView(updated)
      }

      // UI helper (not a documented CLI verb) — validate a draft schedule and
      // return its human label + next-fire, for the create dialog's live
      // preview (F3). Throws a readable error on a bad cron expression.
      case 'preview': {
        const schedule = parseScheduleArgs({
          cron: str(args.cron),
          every: str(args.every),
          at: str(args.at),
          on: str(args.on),
        })
        const next = nextFireAfterSchedule(schedule, new Date(this.now()))
        // Audit fix — an unschedulable expression (e.g. Feb 30) parses but never
        // fires. Surface it in the F3 preview rather than letting the user save
        // a silently-dead job.
        if (!next) throw new Error('this schedule never fires (impossible date — e.g. Feb 30)')
        return { scheduleLabel: describeSchedule(schedule), nextFireAt: next.toISOString() }
      }

      default:
        throw new Error(`Unknown cron op: ${op}. Expected list|add|run|pause|resume|rm|show|edit.`)
    }
  }

  /** Build a partial-update patch from loose `cron edit` args — only the fields
   *  present are touched. Schedule is replaced wholesale if ANY schedule arg is
   *  given (parseScheduleArgs builds a complete schedule). */
  private buildPatchFromArgs(args: Record<string, unknown>): Partial<Omit<CronJob, 'id'>> {
    const patch: Partial<Omit<CronJob, 'id'>> = {}
    const name = str(args.name)
    if (name) patch.name = name
    const cwd = str(args.cwd)
    if (cwd) {
      assertCwdAbsolute(cwd)
      patch.cwd = cwd
    }
    const instruction = str(args.instruction)
    if (instruction) patch.instruction = instruction
    const sessionRaw = str(args.session)
    if (sessionRaw === 'same' || sessionRaw === 'fresh') patch.session = sessionRaw
    if (str(args.cron) || str(args.every) || str(args.at) || str(args.on)) {
      const schedule = parseScheduleArgs({
        cron: str(args.cron),
        every: str(args.every),
        at: str(args.at),
        on: str(args.on),
      })
      this.assertSchedulable(schedule)
      patch.schedule = schedule
    }
    // catch-up: true → on; false → inherit the global default (null); absent → unchanged.
    if (args.catchUp === true || args.catchUp === 'true') patch.catchUpOnLaunch = true
    else if (args.catchUp === false || args.catchUp === 'false') patch.catchUpOnLaunch = null
    return patch
  }

  /** Create a job from `duo cron add` args. */
  private async addFromArgs(args: Record<string, unknown>): Promise<CronJobView> {
    const name = str(args.name)
    const cwd = str(args.cwd)
    const instruction = str(args.instruction)
    if (!name) throw new Error('cron add requires --name')
    if (!cwd) throw new Error('cron add requires --cwd')
    if (!instruction) throw new Error('cron add requires --say "<instruction>"')
    assertCwdAbsolute(cwd)

    const schedule = parseScheduleArgs({
      cron: str(args.cron),
      every: str(args.every),
      at: str(args.at),
      on: str(args.on),
    })
    this.assertSchedulable(schedule)

    const sessionRaw = str(args.session)
    const session: CronSessionMode = sessionRaw === 'same' ? 'same' : 'fresh'
    const catchUpOnLaunch = args.catchUp === true || args.catchUp === 'true' ? true : null

    const job: CronJob = {
      id: `job_${randomUUID()}`,
      name,
      cwd,
      instruction,
      session,
      schedule,
      catchUpOnLaunch,
      enabled: true,
      lastSessionId: null,
      lastRunAt: null,
      lastRunState: null,
      createdAt: new Date(this.now()).toISOString(),
    }

    const added = await this.store.addJob(job)
    this.rescheduleJob(added, new Date(this.now()))
    this.emitChange()
    return this.toView(added)
  }

  /** Reject a schedule that parses but has no occurrence (e.g. Feb 30) so we
   *  don't persist an enabled-but-silently-dead job (audit fix). */
  private assertSchedulable(schedule: CronSchedule): void {
    if (!nextFireAfterSchedule(schedule, new Date(this.now()))) {
      throw new Error('cron: this schedule never fires (impossible date — e.g. Feb 30)')
    }
  }
}

/** A cron job's cwd must be absolute — a relative/typo'd path would be silently
 *  rewritten to the user's home dir at fire time (PtyManager fallback), running
 *  the job in the wrong directory with no error. The CLI absolutizes via
 *  resolveFilePath; this guards the IPC/modal path to the same invariant. */
function assertCwdAbsolute(cwd: string): void {
  if (!isAbsolute(cwd)) {
    throw new Error(`cron: working directory must be an absolute path, got "${cwd}"`)
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
