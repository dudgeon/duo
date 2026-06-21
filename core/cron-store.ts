// ENH-221 — persistence for scheduled ("cron") Claude sessions.
//
// App-global store at ~/.claude/duo/cron-jobs.json (D1). Modeled on
// SettingsService / ProjectsService: an injectable `baseDir` (os.homedir()
// is import-time-bound, so a $HOME override never takes effect — tests pass
// a temp dir), best-effort/corrupt-tolerant load, atomic tmp+rename write
// via uniqueTmpPath, and read-modify-write serialized through a write queue
// so the CLI (socket) and the scheduler can't lost-update each other.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { uniqueTmpPath, createWriteQueue } from './write-queue'
import type { CronJob, CronJobsFile } from '../shared/types'

export const CRON_FILE_VERSION = 1
const DEFAULT_DIR = path.join(os.homedir(), '.claude', 'duo')

export function emptyCronFile(): CronJobsFile {
  return { version: CRON_FILE_VERSION, jobs: [], settings: { defaultCatchUpOnLaunch: false } }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Validate + coerce one persisted job, returning null if it's unusable.
 *  Lenient: a bad job is dropped (with a warning), not a load-crashing throw. */
function coerceJob(raw: unknown): CronJob | null {
  if (!isObj(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : null
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : null
  const schedule = raw.schedule
  if (!id || !cwd || !isObj(schedule)) return null
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    cwd,
    instruction: typeof raw.instruction === 'string' ? raw.instruction : '',
    session: raw.session === 'same' ? 'same' : 'fresh',
    schedule: schedule as CronJob['schedule'],
    catchUpOnLaunch: typeof raw.catchUpOnLaunch === 'boolean' ? raw.catchUpOnLaunch : null,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    lastSessionId: typeof raw.lastSessionId === 'string' ? raw.lastSessionId : null,
    lastRunAt: typeof raw.lastRunAt === 'string' ? raw.lastRunAt : null,
    lastRunState: (raw.lastRunState as CronJob['lastRunState']) ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  }
}

function normalizeFile(parsed: unknown): CronJobsFile {
  if (!isObj(parsed)) return emptyCronFile()
  const version = typeof parsed.version === 'number' ? parsed.version : CRON_FILE_VERSION
  if (version !== CRON_FILE_VERSION) {
    console.warn(`[cron] schema version ${String(version)} != ${CRON_FILE_VERSION}; reading best-effort`)
  }
  const rawJobs = Array.isArray(parsed.jobs) ? parsed.jobs : []
  const jobs: CronJob[] = []
  for (const r of rawJobs) {
    const j = coerceJob(r)
    if (j) jobs.push(j)
    else console.warn('[cron] dropping malformed job entry on load')
  }
  const settings = isObj(parsed.settings) ? parsed.settings : {}
  return {
    version: CRON_FILE_VERSION,
    jobs,
    settings: {
      defaultCatchUpOnLaunch:
        typeof settings.defaultCatchUpOnLaunch === 'boolean' ? settings.defaultCatchUpOnLaunch : false,
    },
  }
}

function cloneJob(j: CronJob): CronJob {
  return { ...j }
}

export class CronStore {
  private cache: CronJobsFile = emptyCronFile()
  private loaded = false
  private readonly file: string
  private readonly dir: string
  private readonly enqueue = createWriteQueue()

  constructor(baseDir: string = DEFAULT_DIR) {
    this.dir = baseDir
    this.file = path.join(baseDir, 'cron-jobs.json')
  }

  /** Best-effort load; ENOENT (first launch) and corrupt files both degrade
   *  to an empty file rather than throwing or wiping. */
  async load(): Promise<CronJobsFile> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      this.cache = normalizeFile(JSON.parse(raw))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') console.warn('[cron] load failed:', (err as Error)?.message ?? err)
      this.cache = emptyCronFile()
    }
    this.loaded = true
    return this.snapshot()
  }

  isLoaded(): boolean {
    return this.loaded
  }

  /** A deep-ish copy of the whole file (callers never get the live cache). */
  snapshot(): CronJobsFile {
    return {
      version: this.cache.version,
      settings: { ...this.cache.settings },
      jobs: this.cache.jobs.map(cloneJob),
    }
  }

  getJobs(): CronJob[] {
    return this.cache.jobs.map(cloneJob)
  }

  getJob(id: string): CronJob | undefined {
    const j = this.cache.jobs.find((x) => x.id === id)
    return j ? cloneJob(j) : undefined
  }

  getSettings(): CronJobsFile['settings'] {
    return { ...this.cache.settings }
  }

  async addJob(job: CronJob): Promise<CronJob> {
    return this.enqueue(async () => {
      if (this.cache.jobs.some((j) => j.id === job.id)) {
        throw new Error(`cron: job id already exists: ${job.id}`)
      }
      this.cache.jobs.push(cloneJob(job))
      await this.persist()
      return cloneJob(job)
    })
  }

  /** Patch a job in place. Returns the updated job, or undefined if absent. */
  async updateJob(id: string, patch: Partial<Omit<CronJob, 'id'>>): Promise<CronJob | undefined> {
    return this.enqueue(async () => {
      const idx = this.cache.jobs.findIndex((j) => j.id === id)
      if (idx === -1) return undefined
      this.cache.jobs[idx] = { ...this.cache.jobs[idx], ...patch, id }
      await this.persist()
      return cloneJob(this.cache.jobs[idx])
    })
  }

  async removeJob(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const before = this.cache.jobs.length
      this.cache.jobs = this.cache.jobs.filter((j) => j.id !== id)
      const removed = this.cache.jobs.length < before
      if (removed) await this.persist()
      return removed
    })
  }

  async setSettings(patch: Partial<CronJobsFile['settings']>): Promise<CronJobsFile['settings']> {
    return this.enqueue(async () => {
      this.cache.settings = { ...this.cache.settings, ...patch }
      await this.persist()
      return { ...this.cache.settings }
    })
  }

  /** Resolves once every queued write has settled. The no-op enqueues AFTER
   *  all pending ops (the queue serializes), so awaiting it drains the queue.
   *  Tests await this before removing the temp dir (else a late persist can
   *  ENOTEMPTY the rmdir); also a clean graceful-shutdown hook. */
  async whenIdle(): Promise<void> {
    await this.enqueue(async () => {})
  }

  private async persist(): Promise<void> {
    const tmp = uniqueTmpPath(this.file, 'tmp')
    try {
      await fs.mkdir(this.dir, { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      await fs.rename(tmp, this.file)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      console.warn('[cron] save failed:', (err as Error)?.message ?? err)
    }
  }
}
