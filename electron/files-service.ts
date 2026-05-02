// Stage 10 Phase 1: main-process file-system service.
//
// Provides the IPC surface for the file navigator + per-type previewers:
//   - list    → directory entries (one level)
//   - read    → file contents + mime (with a size cap for IPC sanity)
//   - watch   → chokidar-backed change events
//   - openExternal / revealInFinder → macOS `open` passthroughs
//
// Identity / safety posture: runs as the user's UID; no extra path policy.
// File access succeeds iff the user themselves could read the file from a
// shell. EACCES / ENOENT surface as typed errors that the renderer can show.

import * as fs from 'fs/promises'
import * as path from 'path'
import { shell } from 'electron'
import type { WebContents } from 'electron'
import chokidar, { FSWatcher } from 'chokidar'
import type { DirEntry, FileReadResult, FileWriteResult, FileChangeEvent, HtmlFileMeta } from '../shared/types'

// Prevent accidentally shipping 50MB of log file over IPC. Renderer should
// use `openExternal` for payloads this big.
const MAX_READ_BYTES = 10 * 1024 * 1024 // 10 MB

// Small built-in mime table. If we need comprehensive detection later we can
// pull in `mime-types`, but this covers everything Stage 10 renders natively.
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

export class FilesService {
  // Map subscription id → watcher + target webContents. Each renderer-side
  // `watch()` call gets its own id so multiple nav views / preview panes can
  // watch overlapping paths without interfering.
  private watchers = new Map<string, { fsw: FSWatcher; wc: WebContents }>()

  async list(absPath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(absPath, { withFileTypes: true })
    const results: DirEntry[] = []
    for (const e of entries) {
      const full = path.join(absPath, e.name)
      const kind: DirEntry['kind'] = e.isDirectory() ? 'directory' : 'file'
      let size: number | undefined
      let mtimeMs: number | undefined
      // stat() per entry is expensive on big dirs. Skip for directories; cheap
      // for files we'll probably want the info on.
      if (kind === 'file') {
        try {
          const st = await fs.stat(full)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch {
          /* symlink target missing, permission issue — entry still listed */
        }
      }
      results.push({ name: e.name, path: full, kind, size, mtimeMs })
    }
    // Directories first, then files; each group alphabetical and
    // case-insensitive to match Finder's default ordering.
    results.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return results
  }

  /** BUG-039 — lightweight existence check used by session-restore
   *  hydration to drop tabs whose files were deleted between
   *  sessions. Returns true if the path exists AND is a regular
   *  file. Symbolic links resolve through to the target via
   *  `fs.stat` (vs `fs.lstat`); a broken symlink reports false. */
  async exists(absPath: string): Promise<boolean> {
    try {
      const st = await fs.stat(absPath)
      return st.isFile()
    } catch {
      return false
    }
  }

  async read(absPath: string): Promise<FileReadResult> {
    const st = await fs.stat(absPath)
    if (st.size > MAX_READ_BYTES) {
      throw new Error(
        `File too large for in-app preview (${st.size} bytes; limit ${MAX_READ_BYTES}). Use Open with default app.`
      )
    }
    const bytes = await fs.readFile(absPath)
    return {
      bytes: new Uint8Array(bytes), // serializable over IPC
      mime: mimeFor(absPath),
      size: st.size,
      mtimeMs: st.mtimeMs
    }
  }

  /**
   * Read just the head of an HTML file (~4KB) and parse Duo's routing
   * meta tags. Used by the renderer's file-open dispatcher to decide
   * between browser-tab and canvas-tab routing for `.html` files
   * without paying the cost of a full read for every click.
   *
   * Returns an empty object on read failure or when neither meta is
   * present. Caller falls through to its default.
   */
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
    const openIn = head.match(/<meta\s+[^>]*name\s*=\s*["']duo-open-in["'][^>]*content\s*=\s*["'](browser|canvas)["']/i)
    if (openIn) meta.openIn = openIn[1].toLowerCase() as 'browser' | 'canvas'
    const editable = head.match(/<meta\s+[^>]*name\s*=\s*["']duo-editable["'][^>]*content\s*=\s*["'](true|false)["']/i)
    if (editable) meta.editable = editable[1].toLowerCase() === 'true'
    // Stage 27 (ENH-034) — soft-default editable hint. Distinct from
    // the hard-lock `duo-editable` above: when this is `false`, the
    // canvas mounts read-only but the toolbar toggle stays available
    // so the user can flip it back. Tutorial canvases use this so
    // click handlers fire on first load instead of being intercepted
    // by contentEditable's cursor placement.
    const defaultEditable = head.match(/<meta\s+[^>]*name\s*=\s*["']duo-default-editable["'][^>]*content\s*=\s*["'](true|false)["']/i)
    if (defaultEditable) meta.defaultEditable = defaultEditable[1].toLowerCase() === 'true'
    return meta
  }

  /**
   * Atomic write: write to `<path>.duo.tmp` then rename. Creates parent
   * dirs as needed. Callers already have the absolute path from either the
   * open-file identity or the `duo edit` CLI resolution.
   */
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

  /** ENH-016 — create a directory (recursive — parents created if
   *  missing). Used by the navigator's "New folder…" context-menu
   *  entry. Errors if the path already exists as a file. */
  async mkdir(absPath: string): Promise<void> {
    await fs.mkdir(absPath, { recursive: true })
  }

  /** Stage 26 PR 3 item 8 — path-kind probe for the editable
   *  breadcrumb's resolution logic. Returns `'file'` / `'folder'` /
   *  `null` (path doesn't exist or isn't a regular file/dir).
   *  Symlinks resolve through to the target. */
  async kind(absPath: string): Promise<'file' | 'folder' | null> {
    try {
      const st = await fs.stat(absPath)
      if (st.isFile()) return 'file'
      if (st.isDirectory()) return 'folder'
      return null
    } catch {
      return null
    }
  }

  async openExternal(absPath: string): Promise<void> {
    // shell.openPath resolves with '' on success, error string on failure
    const err = await shell.openPath(absPath)
    if (err) throw new Error(err)
  }

  revealInFinder(absPath: string): void {
    shell.showItemInFolder(absPath)
  }

  /**
   * Stage 26 item 6 — move a file or folder to the macOS Trash.
   * `shell.trashItem` is recoverable from Finder. Throws on failure
   * (file not found, permission denied, special folders that resist
   * trashing). Caller is responsible for the user confirm.
   */
  async trash(absPath: string): Promise<void> {
    await shell.trashItem(absPath)
  }

  /**
   * Stage 26 item 6 — rename / move a file or folder. Both paths must
   * be absolute. `fs.rename` is atomic within a filesystem; cross-fs
   * moves require a copy + unlink (defer until needed).
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath)
  }

  /**
   * Start watching a set of paths. Caller keeps the returned `id`; events are
   * pushed back to the renderer on channel FILES_CHANGED with { id, event }.
   */
  startWatch(
    id: string,
    paths: string[],
    wc: WebContents,
    pushChannel: string
  ): void {
    // Do not watch recursively by default — Stage 10 v1 only watches the
    // currently-visible subtree. Recursive watches on e.g. node_modules are a
    // CPU + event-rate disaster. Callers pass the specific directories they
    // want observed (current nav folder + expanded descendants).
    const fsw = chokidar.watch(paths, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      },
      // Filesystem-level watchers; no polling except on network mounts.
      usePolling: false
    })

    const send = (kind: FileChangeEvent['kind'], p: string) => {
      if (wc.isDestroyed()) return
      const event: FileChangeEvent = { kind, path: p }
      wc.send(pushChannel, { id, event })
    }

    fsw.on('add', p => send('added', p))
    fsw.on('change', p => send('changed', p))
    fsw.on('unlink', p => send('removed', p))
    fsw.on('addDir', p => send('added', p))
    fsw.on('unlinkDir', p => send('removed', p))
    fsw.on('error', err => {
      // Don't crash on transient fs events (e.g. deleted directory under watch)
      console.warn('[FilesService] watch error:', err instanceof Error ? err.message : err)
    })

    this.watchers.set(id, { fsw, wc })
  }

  async updateWatchPaths(id: string, paths: string[]): Promise<void> {
    const w = this.watchers.get(id)
    if (!w) return
    // Chokidar's incremental add/unwatch is cheaper than close + re-create.
    const prev = new Set<string>(
      // FSWatcher.getWatched returns { dir → filenames[] }; flatten to paths.
      Object.entries(w.fsw.getWatched()).flatMap(([dir, names]) =>
        names.length === 0 ? [dir] : names.map(n => path.join(dir, n))
      )
    )
    const next = new Set(paths)
    for (const p of prev) if (!next.has(p)) w.fsw.unwatch(p)
    for (const p of next) if (!prev.has(p)) w.fsw.add(p)
  }

  async stopWatch(id: string): Promise<void> {
    const w = this.watchers.get(id)
    if (!w) return
    await w.fsw.close()
    this.watchers.delete(id)
  }

  /** Tear down all watchers (on app quit or window close). */
  async dispose(): Promise<void> {
    await Promise.all([...this.watchers.values()].map(w => w.fsw.close()))
    this.watchers.clear()
  }
}
