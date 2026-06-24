// ENH-231 — the rebuildable digest cache (§D9 materialized index). Holds ONLY
// transcript-derived `SessionDigest`s. It is NEVER authority: a caller can
// delete this file and rebuild every entry from the session JSONL via
// `extractSessionDigest` (the §D9 invariant, gated by a test). Agent narrative
// + review state live in `HomeStateStore`, NOT here. Mirrors SettingsService's
// atomic tmp+rename write + a serialized write-chain (CLI / Stop-hook race).

import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { uniqueTmpPath } from './write-queue'
import type { SessionDigest } from '../shared/types'

const STORE_VERSION = 1
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'duo', 'session-digests.json')

interface DigestEnvelope {
  version: number
  digests: SessionDigest[]
}

export class SessionDigestStore {
  private cache = new Map<string, SessionDigest>()
  private writeChain: Promise<void> = Promise.resolve()
  private readonly filePath: string
  private readonly dir: string

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
    this.dir = path.dirname(filePath)
  }

  /** Load from disk. Best-effort: missing / corrupt file → empty cache. */
  async load(): Promise<void> {
    this.cache.clear()
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<DigestEnvelope>
      if (Array.isArray(parsed.digests)) {
        for (const d of parsed.digests) {
          if (d && typeof (d as SessionDigest).uuid === 'string') {
            this.cache.set((d as SessionDigest).uuid, d as SessionDigest)
          }
        }
      }
    } catch {
      // ENOENT (first launch) or corrupt — start empty; the cache rebuilds.
    }
  }

  getDigest(uuid: string): SessionDigest | undefined {
    return this.cache.get(uuid)
  }

  /** A copy of the current cache (callers must not mutate the live map). */
  snapshot(): Map<string, SessionDigest> {
    return new Map(this.cache)
  }

  async setDigest(uuid: string, digest: SessionDigest): Promise<void> {
    this.cache.set(uuid, digest)
    await this.persist()
  }

  async deleteDigest(uuid: string): Promise<boolean> {
    const had = this.cache.delete(uuid)
    if (had) await this.persist()
    return had
  }

  async clearAll(): Promise<void> {
    this.cache.clear()
    await this.persist()
  }

  /** Drain queued writes — for tests + the CLI/Stop-hook write race. */
  async whenIdle(): Promise<void> {
    await this.writeChain
  }

  private persist(): Promise<void> {
    const envelope: DigestEnvelope = { version: STORE_VERSION, digests: [...this.cache.values()] }
    this.writeChain = this.writeChain.then(() => this.writeFile(envelope)).catch(() => {})
    return this.writeChain
  }

  private async writeFile(data: DigestEnvelope): Promise<void> {
    const tmp = uniqueTmpPath(this.filePath, 'tmp')
    try {
      await fs.mkdir(this.dir, { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      console.warn('[session-digest-store] save failed:', (err as Error)?.message ?? err)
    }
  }
}
