// ENH-223 — CronStore against a real temp file (injectable baseDir).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { CronStore, emptyCronFile, CRON_FILE_VERSION } from './cron-store'
import type { CronClaudeJob, CronShellJob } from '../shared/types'

function makeJob(overrides: Partial<CronClaudeJob> = {}): CronClaudeJob {
  return {
    id: overrides.id ?? 'job_1',
    kind: 'claude',
    name: overrides.name ?? 'Morning triage',
    cwd: overrides.cwd ?? '/tmp/proj',
    instruction: overrides.instruction ?? 'review PRs',
    session: overrides.session ?? 'fresh',
    schedule: overrides.schedule ?? { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
    catchUpOnLaunch: overrides.catchUpOnLaunch ?? null,
    enabled: overrides.enabled ?? true,
    lastSessionId: overrides.lastSessionId ?? null,
    lastRunAt: overrides.lastRunAt ?? null,
    lastRunState: overrides.lastRunState ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  }
}

function makeShellJob(overrides: Partial<CronShellJob> = {}): CronShellJob {
  return {
    id: overrides.id ?? 'job_shell',
    kind: 'shell',
    name: overrides.name ?? 'Reindex docs',
    cwd: overrides.cwd ?? '/tmp/proj',
    command: overrides.command ?? 'qmd update && qmd embed',
    schedule: overrides.schedule ?? { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
    catchUpOnLaunch: overrides.catchUpOnLaunch ?? null,
    enabled: overrides.enabled ?? true,
    lastRunAt: overrides.lastRunAt ?? null,
    lastRunState: overrides.lastRunState ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  }
}

describe('CronStore', () => {
  let dir: string
  let store: CronStore

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'duo-cron-test-'))
    store = new CronStore(dir)
    await store.load()
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('starts empty with default settings', () => {
    expect(store.getJobs()).toEqual([])
    expect(store.getSettings().defaultCatchUpOnLaunch).toBe(false)
  })

  it('adds, gets, and round-trips a job across instances', async () => {
    await store.addJob(makeJob())
    expect(store.getJobs()).toHaveLength(1)
    expect(store.getJob('job_1')?.name).toBe('Morning triage')

    const reloaded = new CronStore(dir)
    await reloaded.load()
    const job = reloaded.getJob('job_1')
    expect(job?.kind).toBe('claude')
    expect(job?.kind === 'claude' ? job.instruction : null).toBe('review PRs')
  })

  it('rejects a duplicate id', async () => {
    await store.addJob(makeJob())
    await expect(store.addJob(makeJob())).rejects.toThrow(/already exists/)
  })

  it('updates a job in place', async () => {
    await store.addJob(makeJob())
    const updated = await store.updateJob('job_1', { enabled: false, lastSessionId: 'abc' })
    expect(updated?.enabled).toBe(false)
    expect(updated?.kind === 'claude' ? updated.lastSessionId : null).toBe('abc')
    expect(store.getJob('job_1')?.enabled).toBe(false)
  })

  it('updateJob returns undefined for an unknown id', async () => {
    expect(await store.updateJob('nope', { enabled: false })).toBeUndefined()
  })

  it('removes a job', async () => {
    await store.addJob(makeJob())
    expect(await store.removeJob('job_1')).toBe(true)
    expect(await store.removeJob('job_1')).toBe(false)
    expect(store.getJobs()).toEqual([])
  })

  it('persists settings', async () => {
    await store.setSettings({ defaultCatchUpOnLaunch: true })
    const reloaded = new CronStore(dir)
    await reloaded.load()
    expect(reloaded.getSettings().defaultCatchUpOnLaunch).toBe(true)
  })

  it('getJob returns a copy — callers cannot mutate the cache', async () => {
    await store.addJob(makeJob())
    const j = store.getJob('job_1')!
    j.name = 'mutated'
    expect(store.getJob('job_1')?.name).toBe('Morning triage')
  })

  it('a corrupt file degrades to empty (not a throw, not a wipe)', async () => {
    await fs.writeFile(path.join(dir, 'cron-jobs.json'), '{ not json')
    const s = new CronStore(dir)
    await s.load()
    expect(s.getJobs()).toEqual([])
  })

  it('drops malformed job entries but keeps valid ones', async () => {
    const file = {
      version: CRON_FILE_VERSION,
      jobs: [makeJob({ id: 'good' }), { id: 'bad-no-schedule' }, { name: 'no-id' }],
      settings: { defaultCatchUpOnLaunch: false },
    }
    await fs.writeFile(path.join(dir, 'cron-jobs.json'), JSON.stringify(file))
    const s = new CronStore(dir)
    await s.load()
    expect(s.getJobs().map((j) => j.id)).toEqual(['good'])
  })

  it('emptyCronFile carries the current version', () => {
    expect(emptyCronFile().version).toBe(CRON_FILE_VERSION)
  })

  // ── shell-job kind (cron shell jobs) ──────────────────────────────────────
  it('a legacy job with no `kind` loads as kind:"claude" (back-compat)', async () => {
    // Persist a record WITHOUT a `kind` field (the pre-shell-job shape).
    const legacy = {
      version: CRON_FILE_VERSION,
      jobs: [
        {
          id: 'legacy',
          name: 'Legacy job',
          cwd: '/tmp/proj',
          instruction: 'review PRs',
          session: 'fresh',
          schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
          catchUpOnLaunch: null,
          enabled: true,
          lastSessionId: null,
          lastRunAt: null,
          lastRunState: null,
          createdAt: new Date().toISOString(),
        },
      ],
      settings: { defaultCatchUpOnLaunch: false },
    }
    await fs.writeFile(path.join(dir, 'cron-jobs.json'), JSON.stringify(legacy))
    const s = new CronStore(dir)
    await s.load()
    const job = s.getJob('legacy')
    expect(job?.kind).toBe('claude')
    expect(job?.kind === 'claude' ? job.instruction : null).toBe('review PRs')
  })

  it('a shell job round-trips across instances', async () => {
    await store.addJob(makeShellJob({ command: 'qmd update && qmd embed' }))
    const reloaded = new CronStore(dir)
    await reloaded.load()
    const job = reloaded.getJob('job_shell')
    expect(job?.kind).toBe('shell')
    expect(job?.kind === 'shell' ? job.command : null).toBe('qmd update && qmd embed')
    // A shell job carries no instruction/session/lastSessionId.
    expect(job && 'instruction' in job).toBe(false)
    expect(job && 'session' in job).toBe(false)
    expect(job && 'lastSessionId' in job).toBe(false)
  })

  it('a shell job missing its command is dropped on load', async () => {
    const file = {
      version: CRON_FILE_VERSION,
      jobs: [
        // A valid shell job + a kind:"shell" job with no command (unusable).
        {
          id: 'good-shell',
          kind: 'shell',
          name: 'Good',
          cwd: '/tmp/proj',
          command: 'echo hi',
          schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
          catchUpOnLaunch: null,
          enabled: true,
          lastRunAt: null,
          lastRunState: null,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'bad-shell-no-command',
          kind: 'shell',
          name: 'Bad',
          cwd: '/tmp/proj',
          schedule: { kind: 'preset', preset: 'daily', hour: 9, minute: 0 },
          catchUpOnLaunch: null,
          enabled: true,
          lastRunAt: null,
          lastRunState: null,
          createdAt: new Date().toISOString(),
        },
      ],
      settings: { defaultCatchUpOnLaunch: false },
    }
    await fs.writeFile(path.join(dir, 'cron-jobs.json'), JSON.stringify(file))
    const s = new CronStore(dir)
    await s.load()
    expect(s.getJobs().map((j) => j.id)).toEqual(['good-shell'])
  })
})
