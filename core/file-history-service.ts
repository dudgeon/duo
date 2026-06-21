// ENH-221 — Durable local file version history.
//
// WHY THIS EXISTS
// ---------------
// Duo autosaves the editor buffer on an 800ms debounce. That is the right
// call for collision-safety (a slower debounce widens the window where an
// agent reads a stale on-disk version and writes back over unsaved edits),
// but it removes the classic "unsaved buffer" safety net: the file is
// essentially always "saved", so there is no version to roll back to. The
// in-editor TipTap undo stack is the only recourse, and it is volatile —
// in-memory, capped, and gone on tab close / file reopen / app restart.
//
// This service is the durable safety net: an append-only, content-addressed
// log of the content states Duo has observed for a file, independent of the
// volatile undo stack and independent of autosave cadence. It is the data
// layer behind `duo history list / show / restore / diff` and (future) the
// History panel.
//
// SIDECAR / DRIFT (DECISIONS.md §D9, CLAUDE.md locked-decision #12)
// ----------------------------------------------------------------
// This store lives in Duo's own state tree (~/.claude/duo/file-history/),
// NOT in a sidecar beside the user's document. It is a Duo-owned concept the
// filesystem does not track, which §D9 explicitly permits. It is structurally
// incapable of drifting from the source of truth because it is an append-only
// LOG of past states — it never claims to be the current content. The live
// file on disk remains the sole source of truth for "now".

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

/** Why a given content state was captured. Drives timeline labelling and the
 *  coalescing policy (only consecutive autosaves collapse; distinct edits
 *  from agents / restores / opens are always their own timeline points). */
export type SnapshotSource = 'save' | 'agent' | 'restore' | 'open' | 'external'

export interface Snapshot {
  /** `${ts}-${hash.slice(0,8)}` — stable, sortable, human-skimmable. */
  id: string
  /** Epoch ms when this state was captured. */
  ts: number
  /** sha256 of the content bytes (also the blob filename). */
  hash: string
  /** Byte length of the content. */
  size: number
  /** Provenance. */
  source: SnapshotSource
}

export interface FileHistoryIndex {
  version: 1
  /** Absolute path this history belongs to — a live pointer, not a mirror. */
  path: string
  /** Chronological, oldest → newest. */
  snapshots: Snapshot[]
}

/** Default cap on retained snapshots per file. Oldest are pruned first. At
 *  ~a few KB of deduped text per distinct state this is trivially small. */
export const MAX_SNAPSHOTS_PER_FILE = 200

/** Consecutive `save`-sourced captures within this window collapse into one
 *  evolving checkpoint (the latest state wins). This is what stops 800ms
 *  autosave from exploding the timeline into hundreds of entries while still
 *  preserving a ~per-90s-of-activity rollback granularity. Agent / restore /
 *  open captures are never coalesced. */
export const COALESCE_WINDOW_MS = 90_000

function defaultRoot(): string {
  // Co-located with the rest of Duo's user-facing state tree
  // (browser-history.json, workspace-history.json, pins.json, packs/ …).
  return path.join(os.homedir(), '.claude', 'duo', 'file-history')
}

function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

export class FileHistoryService {
  private readonly root: string

  constructor(root: string = defaultRoot()) {
    this.root = root
  }

  // ── on-disk layout helpers ────────────────────────────────────────────
  // index/<sha256(abspath)>.json            — per-file index
  // blobs/<sha256(abspath)>/<contentHash>   — per-file, deduped content blobs
  //
  // Blobs are namespaced per-file (not globally content-addressed) so blob GC
  // is trivially safe: a blob in a file's dir that its index no longer
  // references can be deleted without checking every other file's index.

  private pathKey(absPath: string): string {
    return sha256(path.resolve(absPath))
  }
  private indexPath(absPath: string): string {
    return path.join(this.root, 'index', `${this.pathKey(absPath)}.json`)
  }
  private blobDir(absPath: string): string {
    return path.join(this.root, 'blobs', this.pathKey(absPath))
  }
  private blobPath(absPath: string, hash: string): string {
    return path.join(this.blobDir(absPath), hash)
  }

  private async readIndex(absPath: string): Promise<FileHistoryIndex> {
    try {
      const raw = await fs.readFile(this.indexPath(absPath), 'utf8')
      const parsed = JSON.parse(raw) as FileHistoryIndex
      if (parsed && parsed.version === 1 && Array.isArray(parsed.snapshots)) return parsed
    } catch {
      // missing / corrupt → start fresh (a history store must never block a save)
    }
    return { version: 1, path: path.resolve(absPath), snapshots: [] }
  }

  private async writeIndex(absPath: string, index: FileHistoryIndex): Promise<void> {
    const dest = this.indexPath(absPath)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const tmp = dest + '.duo.tmp'
    await fs.writeFile(tmp, JSON.stringify(index, null, 2))
    await fs.rename(tmp, dest)
  }

  // ── public API ────────────────────────────────────────────────────────

  /**
   * Record a content state for `absPath`. Designed to run fire-and-forget
   * OFF the save critical path — it never throws (errors are swallowed) so a
   * history failure can never break a user's save.
   *
   * Returns the resulting Snapshot, or null when the capture was a no-op
   * (content identical to the newest snapshot, or an error occurred).
   */
  async capture(
    absPath: string,
    content: Uint8Array | string,
    opts: { source?: SnapshotSource } = {}
  ): Promise<Snapshot | null> {
    try {
      const source = opts.source ?? 'save'
      const bytes = toBytes(content)
      const hash = sha256(bytes)
      const index = await this.readIndex(absPath)
      const newest = index.snapshots[index.snapshots.length - 1]

      // No-op save: identical content to the newest state. Skip — autosave
      // fires even when nothing meaningful changed (e.g. focus churn).
      if (newest && newest.hash === hash) return null

      const ts = Date.now()
      const snap: Snapshot = { id: `${ts}-${hash.slice(0, 8)}`, ts, hash, size: bytes.byteLength, source }

      // Write the content blob (deduped by hash within this file's dir).
      await fs.mkdir(this.blobDir(absPath), { recursive: true })
      await fs.writeFile(this.blobPath(absPath, hash), bytes)

      // Coalesce a burst of autosaves into one moving checkpoint.
      const coalesce =
        newest &&
        source === 'save' &&
        newest.source === 'save' &&
        ts - newest.ts < COALESCE_WINDOW_MS
      if (coalesce) index.snapshots.pop()
      index.snapshots.push(snap)

      // Cap (drop oldest first).
      while (index.snapshots.length > MAX_SNAPSHOTS_PER_FILE) index.snapshots.shift()

      await this.writeIndex(absPath, index)
      await this.gcBlobs(absPath, index)
      return snap
    } catch {
      return null
    }
  }

  /** Chronological snapshot metadata for a file (oldest → newest). Empty if
   *  none. Never throws. */
  async list(absPath: string): Promise<Snapshot[]> {
    const index = await this.readIndex(absPath)
    return index.snapshots
  }

  /** The raw content bytes of a snapshot, or null if the snapshot id / blob
   *  is unknown. Accepts either the full snapshot id or its content hash. */
  async read(absPath: string, snapshotIdOrHash: string): Promise<Uint8Array | null> {
    try {
      const index = await this.readIndex(absPath)
      const snap =
        index.snapshots.find(s => s.id === snapshotIdOrHash) ??
        index.snapshots.find(s => s.hash === snapshotIdOrHash)
      if (!snap) return null
      return await fs.readFile(this.blobPath(absPath, snap.hash))
    } catch {
      return null
    }
  }

  /** Alias of {@link read}: returns the bytes to restore. The CALLER is
   *  responsible for writing them back through FilesService.write (so the
   *  restore is itself captured and the open editor reconciles). */
  async restore(absPath: string, snapshotIdOrHash: string): Promise<Uint8Array | null> {
    return this.read(absPath, snapshotIdOrHash)
  }

  /** Delete any blob in a file's dir not referenced by the current index.
   *  Keeps storage bounded after coalescing / capping. Best-effort. */
  private async gcBlobs(absPath: string, index: FileHistoryIndex): Promise<void> {
    try {
      const keep = new Set(index.snapshots.map(s => s.hash))
      const dir = this.blobDir(absPath)
      const entries = await fs.readdir(dir)
      await Promise.all(
        entries
          .filter(name => !keep.has(name))
          .map(name => fs.rm(path.join(dir, name)).catch(() => {}))
      )
    } catch {
      // dir missing or unreadable — nothing to GC
    }
  }
}
