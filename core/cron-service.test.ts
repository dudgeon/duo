// ENH-221 — CronService orchestration: fresh/resume decision (D3), catch-up
// (D5), CLI dispatch, and the tick scheduler.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { CronStore } from './cron-store'
import { CronService, type CronRunner } from './cron-service'

interface SpawnCall {
  cwd: string
  command: string
  jobId: string
}

function makeRunner(result: { ok: boolean; error?: string; reason?: 'no-window' } = { ok: true }) {
  const calls: SpawnCall[] = []
  const runner: CronRunner = {
    async spawn(input) {
      calls.push({ cwd: input.cwd, command: input.command, jobId: input.jobId })
      return result
    },
  }
  return { runner, calls }
}

describe('CronService', () => {
  let dir: string
  let store: CronStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-cron-svc-test-'))
    store = new CronStore(dir)
    await store.load()
  })
  afterEach(async () => {
    // Real timers + drain the store's write queue BEFORE removing the temp
    // dir. A tick's fire-and-forget fireJob can leave a persist in flight
    // (kicked off under fake timers); without the drain it lands mid-rmdir →
    // ENOTEMPTY flake.
    vi.useRealTimers()
    await store.whenIdle()
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function addJob(svc: CronService, over: Record<string, unknown> = {}) {
    return svc.handleCli('add', {
      name: 'Job',
      cwd: '/tmp/proj',
      instruction: 'review PRs',
      every: 'daily',
      at: '09:00',
      ...over,
    })
  }

  it('add → list returns a view with a label and next-fire', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    await addJob(svc)
    const list = svc.listViews()
    expect(list).toHaveLength(1)
    expect(list[0].scheduleLabel).toBe('every day at 09:00')
    expect(list[0].nextFireAt).toBeTruthy()
    expect(list[0].enabled).toBe(true)
  })

  it('a fresh job runs `claude --session-id` and records the minted id', async () => {
    const { runner, calls } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc, { session: 'fresh' })) as { id: string }
    await svc.fireJob(view.id, { reason: 'manual' })

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toMatch(/^claude --session-id [0-9a-f-]{36} 'review PRs'\n$/)
    const job = store.getJob(view.id)!
    expect(job.lastSessionId).toBeTruthy()
    expect(job.lastRunState).toBe('ran')
  })

  it('a "same" job resumes when the prior session still exists', async () => {
    const { runner, calls } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => true, headlessAllowed: false })
    const view = (await addJob(svc, { session: 'same' })) as { id: string }

    // First run: no prior session → fresh, captures an id.
    await svc.fireJob(view.id, { reason: 'manual' })
    const firstId = store.getJob(view.id)!.lastSessionId!
    expect(calls[0].command).toContain('--session-id')

    // Second run: prior session exists → resume the SAME id.
    await svc.fireJob(view.id, { reason: 'manual' })
    expect(calls[1].command).toBe(`claude --resume ${firstId} 'review PRs'\n`)
    expect(store.getJob(view.id)!.lastSessionId).toBe(firstId)
    expect(store.getJob(view.id)!.lastRunState).toBe('ran')
  })

  it('a "same" job falls back to fresh when the prior session is gone (D3)', async () => {
    const { runner, calls } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc, { session: 'same' })) as { id: string }

    await svc.fireJob(view.id, { reason: 'manual' }) // first run, fresh
    const firstId = store.getJob(view.id)!.lastSessionId!
    await svc.fireJob(view.id, { reason: 'manual' }) // prior gone → fresh-fallback

    expect(calls[1].command).toContain('--session-id')
    expect(calls[1].command).not.toContain('--resume')
    const job = store.getJob(view.id)!
    expect(job.lastRunState).toBe('fresh-fallback')
    expect(job.lastSessionId).not.toBe(firstId) // a new id was minted
  })

  it('records error state when the runner fails to spawn', async () => {
    const { runner } = makeRunner({ ok: false, error: 'window not ready' })
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc)) as { id: string }
    const r = await svc.fireJob(view.id, { reason: 'manual' })
    expect(r.ok).toBe(false)
    expect(store.getJob(view.id)!.lastRunState).toBe('error')
  })

  it('records "missed" (not error) when the run comes due with no window open (D10/D5)', async () => {
    const { runner } = makeRunner({ ok: false, reason: 'no-window', error: 'no Duo window open' })
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc)) as { id: string }
    const r = await svc.fireJob(view.id, { reason: 'scheduled' })
    expect(r.ok).toBe(false)
    const job = store.getJob(view.id)!
    expect(job.lastRunState).toBe('missed')
    // A missed fire must NOT advance lastRunAt — D5 catch-up anchors on the
    // last *real* run, so the occurrence stays recoverable on relaunch.
    expect(job.lastRunAt).toBeNull()
  })

  it('onJobsChanged fires with fresh views on add / run / pause / rm (Tier 2)', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const counts: number[] = []
    const unsub = svc.onJobsChanged((jobs) => counts.push(jobs.length))
    const view = (await addJob(svc)) as { id: string } // add → 1 job
    await svc.fireJob(view.id, { reason: 'manual' })    // run → status change, still 1
    await svc.handleCli('pause', { id: view.id })        // pause → 1
    await svc.handleCli('rm', { id: view.id })           // rm → 0
    unsub()
    await addJob(svc)                                    // no emit after unsubscribe
    expect(counts).toEqual([1, 1, 1, 0])
  })

  it('edit patches fields + reparses the schedule, leaving others intact (Tier 2)', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc)) as { id: string }
    const edited = (await svc.handleCli('edit', {
      id: view.id,
      name: 'Renamed',
      every: 'weekly',
      on: 'fri',
      at: '18:00',
      session: 'same',
    })) as { name: string; session: string; scheduleLabel: string }
    expect(edited.name).toBe('Renamed')
    expect(edited.session).toBe('same')
    expect(edited.scheduleLabel).toBe('every Friday at 18:00')
    expect(store.getJob(view.id)!.cwd).toBe('/tmp/proj') // untouched
  })

  it('edit rejects an empty patch and a bad id (Tier 2)', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc)) as { id: string }
    await expect(svc.handleCli('edit', { id: view.id })).rejects.toThrow(/nothing to change/)
    await expect(svc.handleCli('edit', { id: 'nope', name: 'x' })).rejects.toThrow(/no such job/)
  })

  it('preview returns a label + next-fire and rejects a bad cron (Tier 2)', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const p = (await svc.handleCli('preview', { every: 'daily', at: '07:15' })) as {
      scheduleLabel: string
      nextFireAt: string | null
    }
    expect(p.scheduleLabel).toBe('every day at 07:15')
    expect(p.nextFireAt).toBeTruthy()
    await expect(svc.handleCli('preview', { cron: 'not a valid cron' })).rejects.toThrow()
  })

  it('pause stops scheduling; resume restores it; rm deletes', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    const view = (await addJob(svc)) as { id: string }

    const paused = (await svc.handleCli('pause', { id: view.id })) as { enabled: boolean; nextFireAt: string | null }
    expect(paused.enabled).toBe(false)
    expect(paused.nextFireAt).toBeNull()

    const resumed = (await svc.handleCli('resume', { id: view.id })) as { enabled: boolean; nextFireAt: string | null }
    expect(resumed.enabled).toBe(true)
    expect(resumed.nextFireAt).toBeTruthy()

    await svc.handleCli('rm', { id: view.id })
    expect(svc.listViews()).toEqual([])
  })

  it('handleCli surfaces errors for unknown ids and ops', async () => {
    const { runner } = makeRunner()
    const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
    await expect(svc.handleCli('show', { id: 'nope' })).rejects.toThrow(/no such job/)
    await expect(svc.handleCli('bogus', {})).rejects.toThrow(/Unknown cron op/)
    await expect(svc.handleCli('add', { name: 'x', cwd: '/t' })).rejects.toThrow(/--say/)
  })

  describe('catch-up (D5)', () => {
    it('fires a catch-up-enabled job whose occurrence was missed while closed', async () => {
      vi.useFakeTimers()
      // "Now" is well past 09:00; the job was created yesterday and never ran.
      vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0))
      const { runner, calls } = makeRunner()
      const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
      await addJob(svc)
      // Force catchUp on the stored job + an old createdAt.
      const id = store.getJobs()[0].id
      await store.updateJob(id, { catchUpOnLaunch: true, createdAt: new Date(2026, 0, 1, 0, 0, 0).toISOString() })

      await svc.runCatchUp()
      expect(calls).toHaveLength(1)
      expect(store.getJob(id)!.lastRunState).toBe('ran')
    })

    it('does NOT catch up when the per-job toggle is off (default skip)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 2, 12, 0, 0))
      const { runner, calls } = makeRunner()
      const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
      await addJob(svc)
      const id = store.getJobs()[0].id
      await store.updateJob(id, { createdAt: new Date(2026, 0, 1, 0, 0, 0).toISOString() })

      await svc.runCatchUp()
      expect(calls).toHaveLength(0)
    })

    it('does NOT catch up when the last run already covered the latest occurrence', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 2, 9, 30, 0)) // just after today's 09:00
      const { runner, calls } = makeRunner()
      const svc = new CronService({ store, runner, sessionExists: async () => false, headlessAllowed: false })
      await addJob(svc)
      const id = store.getJobs()[0].id
      await store.updateJob(id, {
        catchUpOnLaunch: true,
        createdAt: new Date(2026, 0, 1, 0, 0, 0).toISOString(),
        lastRunAt: new Date(2026, 0, 2, 9, 0, 30).toISOString(), // already ran at today's 09:00
      })

      await svc.runCatchUp()
      expect(calls).toHaveLength(0)
    })
  })

  describe('tick scheduler', () => {
    it('fires a job when its scheduled minute arrives', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 1, 8, 59, 30))
      const { runner, calls } = makeRunner()
      const svc = new CronService({
        store,
        runner,
        sessionExists: async () => false,
        headlessAllowed: false,
        tickMs: 60_000, // one tick per minute keeps the time math obvious
      })
      await addJob(svc) // daily 09:00; nextFire computed = 09:00 today
      svc.start()

      // Advance one minute → a tick lands at ~09:00:30, past the 09:00 fire.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toHaveLength(1)

      // Another minute → next fire is tomorrow; must NOT refire today.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toHaveLength(1)

      svc.stop()
    })
  })
})
