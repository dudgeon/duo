// ENH-231 — the Duo-owned catch-up state (§D9-EXEMPT, NOT rebuildable from the
// transcript). Holds per-session annotations the agent or user supplies —
// `note`/`next` (agent self-narration via `duo session note|next`) and
// `reviewedAt` (mark-reviewed) — plus the "since you were away" `watermark`.
// These are concepts Claude Code never tracks, so they are legitimately
// Duo-owned (CLAUDE.md §12), and they live in a SEPARATE file from the
// rebuildable digest cache so the §D9 "delete cache → byte-identical rebuild"
// invariant stays honest. Keyed by session uuid → narrative survives after the
// session's terminal tab closes (the Done-review case).

import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { uniqueTmpPath } from './write-queue'
import type { SessionAnnotation } from '../shared/types'

const STORE_VERSION = 1
const DEFAULT_PATH = path.join(os.homedir(), '.claude', 'duo', 'home-state.json')

interface HomeStateEnvelope {
  version: number
  watermark?: number
  annotations: SessionAnnotation[]
}

export class HomeStateStore {
  private annotations = new Map<string, SessionAnnotation>()
  private watermark: number | undefined
  private writeChain: Promise<void> = Promise.resolve()
  private readonly filePath: string
  private readonly dir: string

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath
    this.dir = path.dirname(filePath)
  }

  async load(): Promise<void> {
    this.annotations.clear()
    this.watermark = undefined
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<HomeStateEnvelope>
      if (typeof parsed.watermark === 'number') this.watermark = parsed.watermark
      if (Array.isArray(parsed.annotations)) {
        for (const a of parsed.annotations) {
          if (a && typeof (a as SessionAnnotation).uuid === 'string') {
            this.annotations.set((a as SessionAnnotation).uuid, a as SessionAnnotation)
          }
        }
      }
    } catch {
      // ENOENT / corrupt — start empty.
    }
  }

  getAnnotation(uuid: string): SessionAnnotation | undefined {
    return this.annotations.get(uuid)
  }

  snapshot(): Map<string, SessionAnnotation> {
    return new Map(this.annotations)
  }

  getWatermark(): number | undefined {
    return this.watermark
  }

  async setNote(uuid: string, note: string): Promise<void> {
    await this.merge(uuid, { note: note || undefined })
  }

  async setNext(uuid: string, next: string): Promise<void> {
    await this.merge(uuid, { next: next || undefined })
  }

  async markReviewed(uuid: string, at: number): Promise<void> {
    await this.merge(uuid, { reviewedAt: at })
  }

  async setWatermark(at: number): Promise<void> {
    this.watermark = at
    await this.persist()
  }

  async whenIdle(): Promise<void> {
    await this.writeChain
  }

  /** Merge a patch into one annotation; drop the record entirely if it ends up
   *  carrying no payload (keeps the file from accumulating empty rows). */
  private async merge(uuid: string, patch: Partial<SessionAnnotation>): Promise<void> {
    const next: SessionAnnotation = { ...this.annotations.get(uuid), ...patch, uuid }
    if (next.note === undefined && next.next === undefined && next.reviewedAt === undefined) {
      this.annotations.delete(uuid)
    } else {
      this.annotations.set(uuid, next)
    }
    await this.persist()
  }

  private persist(): Promise<void> {
    const envelope: HomeStateEnvelope = {
      version: STORE_VERSION,
      ...(this.watermark !== undefined ? { watermark: this.watermark } : {}),
      annotations: [...this.annotations.values()],
    }
    this.writeChain = this.writeChain.then(() => this.writeFile(envelope)).catch(() => {})
    return this.writeChain
  }

  private async writeFile(data: HomeStateEnvelope): Promise<void> {
    const tmp = uniqueTmpPath(this.filePath, 'tmp')
    try {
      await fs.mkdir(this.dir, { recursive: true })
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      console.warn('[home-state-store] save failed:', (err as Error)?.message ?? err)
    }
  }
}
