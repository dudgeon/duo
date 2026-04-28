/**
 * File-system service for Duo Web.
 *
 * Direct port of `electron/files-service.ts`. The two differences:
 *
 *   1. `openExternal` / `revealInFinder` — no `electron.shell` here.
 *      We shell out to `open` / `xdg-open` instead. (Linux only has
 *      `xdg-open`; mac has `open`; we try both.)
 *
 *   2. `trash` — without `electron.shell.trashItem`, falls back to
 *      `fs.unlink`. Lossy compared to the Electron build; v1 R&D
 *      accepts that.
 *
 *   3. The watch sink is an emitter callback instead of a `WebContents`.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { spawn } from 'child_process'
import chokidar, { type FSWatcher } from 'chokidar'
import type {
  DirEntry,
  FileReadResult,
  FileWriteResult,
  FileChangeEvent,
  HtmlFileMeta
} from '../../../shared/types'

const MAX_READ_BYTES = 10 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  css: 'text/css',
  scss: 'text/x-scss',
  js: 'text/javascript',
  jsx: 'text/jsx',
  ts: 'text/typescript',
  tsx: 'text/tsx',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  sh: 'text/x-shellscript',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/toml',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/vnd.microsoft.icon',
  pdf: 'application/pdf'
}

function mimeFor(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export type WatchEmitter = (id: string, event: FileChangeEvent) => void

export class FilesService {
  private watchers = new Map<string, FSWatcher>()

  async list(absPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(absPath, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const e of entries) {
      const full = path.join(absPath, e.name)
      const kind: DirEntry['kind'] = e.isDirectory() ? 'directory' : 'file'
      let size: number | undefined
      let mtimeMs: number | undefined
      if (kind === 'file') {
        try {
          const st = await fs.stat(full)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          /* symlink target missing, etc — entry still listed */
        }
      }
      results.push({ name: e.name, path: full, kind, size, mtimeMs })
    }
    results.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return results
  }

  async read(absPath: string): Promise<FileReadResult> {
    const st = await fs.stat(absPath)
    if (st.size > MAX_READ_BYTES) {
      throw new Error(
        `File too large for in-app preview (${st.size} bytes; limit ${MAX_READ_BYTES}).`
      )
    }
    const bytes = await fs.readFile(absPath)
    return {
      bytes: new Uint8Array(bytes),
      mime: mimeFor(absPath),
      size: st.size,
      mtimeMs: st.mtimeMs
    }
  }

  async getHtmlMeta(absPath: string): Promise<HtmlFileMeta> {
    const HEAD_BYTES = 4096
    let head: string
    try {
      const fh = await fs.open(absPath, 'r')
      try {
        const buf = Buffer.alloc(HEAD_BYTES)
        const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
        head = buf.subarray(0, bytesRead).toString('utf8')
      } finally {
        await fh.close()
      }
    } catch {
      return {}
    }
    const meta: HtmlFileMeta = {}
    const openIn = head.match(
      /<meta\s+[^>]*name\s*=\s*["']duo-open-in["'][^>]*content\s*=\s*["'](browser|canvas)["']/i
    )
    if (openIn) meta.openIn = openIn[1].toLowerCase() as 'browser' | 'canvas'
    const editable = head.match(
      /<meta\s+[^>]*name\s*=\s*["']duo-editable["'][^>]*content\s*=\s*["'](true|false)["']/i
    )
    if (editable) meta.editable = editable[1].toLowerCase() === 'true'
    return meta
  }

  async write(absPath: string, bytes: Uint8Array): Promise<FileWriteResult> {
    if (bytes.byteLength > MAX_READ_BYTES) {
      throw new Error(
        `File too large to write in-app (${bytes.byteLength} bytes; limit ${MAX_READ_BYTES}).`
      )
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    const tmp = absPath + '.duo.tmp'
    await fs.writeFile(tmp, bytes)
    await fs.rename(tmp, absPath)
    const st = await fs.stat(absPath)
    return { ok: true, size: st.size, mtimeMs: st.mtimeMs }
  }

  async openExternal(absPath: string): Promise<void> {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    await new Promise<void>((resolve, reject) => {
      const child = spawn(opener, [absPath], { detached: true, stdio: 'ignore' })
      child.on('error', reject)
      child.on('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }

  async revealInFinder(absPath: string): Promise<void> {
    if (process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('open', ['-R', absPath], { detached: true, stdio: 'ignore' })
        child.on('error', reject)
        child.on('spawn', () => {
          child.unref()
          resolve()
        })
      })
    } else {
      // Best-effort: open the parent directory.
      await this.openExternal(path.dirname(absPath))
    }
  }

  /** v1 — no native trash. Falls back to unlink. R&D acceptable. */
  async trash(absPath: string): Promise<void> {
    const st = await fs.stat(absPath)
    if (st.isDirectory()) await fs.rm(absPath, { recursive: true, force: true })
    else await fs.unlink(absPath)
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath)
  }

  startWatch(id: string, paths: string[], emit: WatchEmitter): void {
    const fsw = chokidar.watch(paths, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      usePolling: false
    })
    const send = (kind: FileChangeEvent['kind'], p: string) => {
      emit(id, { kind, path: p })
    }
    fsw.on('add', (p) => send('added', p))
    fsw.on('change', (p) => send('changed', p))
    fsw.on('unlink', (p) => send('removed', p))
    fsw.on('addDir', (p) => send('added', p))
    fsw.on('unlinkDir', (p) => send('removed', p))
    fsw.on('error', (err) => {
      console.warn('[FilesService] watch error:', err instanceof Error ? err.message : err)
    })
    this.watchers.set(id, fsw)
  }

  async updateWatchPaths(id: string, paths: string[]): Promise<void> {
    const w = this.watchers.get(id)
    if (!w) return
    const prev = new Set<string>(
      Object.entries(w.getWatched()).flatMap(([dir, names]) =>
        names.length === 0 ? [dir] : names.map((n) => path.join(dir, n))
      )
    )
    const next = new Set(paths)
    for (const p of prev) if (!next.has(p)) w.unwatch(p)
    for (const p of next) if (!prev.has(p)) w.add(p)
  }

  async stopWatch(id: string): Promise<void> {
    const w = this.watchers.get(id)
    if (!w) return
    await w.close()
    this.watchers.delete(id)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.watchers.values()].map((w) => w.close()))
    this.watchers.clear()
  }
}
