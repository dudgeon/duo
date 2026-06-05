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
import { realpathSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { shell } from 'electron'
import type { WebContents } from 'electron'
import chokidar, { FSWatcher } from 'chokidar'
import type { DirEntry, FileReadResult, FileWriteResult, FileChangeEvent, FileStatResult, HtmlFileMeta } from '../shared/types'
import type { FileSaveImageBesideResult } from '../shared/host-api'

const execFileAsync = promisify(execFile)

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
  private watchers = new Map<
    string,
    {
      fsw: FSWatcher
      wc: WebContents
      // FOLLOWUP-019 → BUG-125. Map from realpath → caller's input path.
      // chokidar follows symlinks by default and emits events with the
      // resolved path (e.g. /private/tmp/foo on macOS, where /tmp is a
      // symlink to /private/tmp). The renderer-side `event.path !== path`
      // guards in PageTab + MarkdownEditor would drop those events and
      // the canvas/editor would stay stale. Resolving once at watch-start
      // and remapping events back to the caller's string keeps the guard
      // honest without forcing every renderer to realpath() its own paths.
      resolvedToOriginal: Map<string, string>
    }
  >()

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

  /** ENH-096 v2 (Sprint 9 walk-1 fix) — directory-aware existence
   *  check for the wikilink vault-root walker. `files.exists` strictly
   *  returns true only for regular files (BUG-039 semantic); the
   *  walker needs to detect `.obsidian/` which is a directory. Symlinks
   *  resolve via `fs.stat`; a broken symlink reports false. */
  async dirExists(absPath: string): Promise<boolean> {
    try {
      const st = await fs.stat(absPath)
      return st.isDirectory()
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

  /** ENH-111 (Sprint 12) — file size + mtime probe for the image
   *  viewer chrome. Returns null when the path doesn't exist or
   *  isn't a regular file (we don't surface directory size). */
  async stat(absPath: string): Promise<FileStatResult | null> {
    try {
      const st = await fs.stat(absPath)
      if (!st.isFile()) return null
      return { size: st.size, mtimeMs: st.mtimeMs }
    } catch {
      return null
    }
  }

  /** ENH-108 (Sprint 12) — paste-image: write a clipboard image
   *  alongside the active doc with a generated filename. Filename
   *  format `image-<YYYYMMDD-HHMMSS>-<4charhash>.<ext>` is sortable
   *  (timestamp prefix groups same-session pastes together) and
   *  collision-free even on rapid successive pastes (4-char hex
   *  random suffix → 65k options). Returns absolute + relative
   *  paths so the caller can serialize `![](relPath)` into the doc
   *  while the image stays adjacent on disk. */
  async saveImageBeside(activeDocPath: string, bytes: Uint8Array, ext: string, prefix: string = 'image'): Promise<FileSaveImageBesideResult> {
    const parentDir = path.dirname(activeDocPath)
    const safeExt = ext.replace(/^\./, '').toLowerCase()
    const safePrefix = prefix.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'asset'
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const hash = crypto.randomBytes(2).toString('hex')
    const filename = `${safePrefix}-${stamp}-${hash}.${safeExt}`
    const absPath = path.join(parentDir, filename)
    await fs.mkdir(parentDir, { recursive: true })
    await fs.writeFile(absPath, bytes)
    const st = await fs.stat(absPath)
    return { absPath, relPath: filename, size: st.size }
  }

  /**
   * ENH-128 — transcode HEIC / HEIF / RAW (or other Electron-decodable
   * formats) to PNG or JPEG. Layered fallback:
   *
   * 1. `nativeImage.createFromBuffer` — fast path, handles every format
   *    Electron's bundled decoder understands.
   * 2. **macOS sips fallback** for HEIC/HEIF/RAW that nativeImage rejects.
   *    Walk-3 surfaced (2026-05-10) that owner-supplied iPhone HEIC bytes
   *    return empty from `createFromBuffer` — likely a NSImage-vs-ImageIO
   *    mismatch in HEVC framework wiring. `sips` uses ImageIO directly
   *    and decodes the same bytes reliably.
   * 3. Throw if both paths fail; renderer surfaces the error.
   *
   * Format choice: HEIC/HEIF (lossy → JPEG @ 90), everything else → PNG
   * (lossless preserves the source). Owner pick (ENH-118 conversation
   * 2026-05-10): convert HEIC to JPEG to match Apple's typical export.
   */
  async convertImageBytes(bytes: Uint8Array, sourceMime: string): Promise<{ bytes: Uint8Array; ext: string }> {
    // Lazy import — `nativeImage` is only available in main process.
    const { nativeImage } = await import('electron')
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))

    if (!img.isEmpty()) {
      const isHeic = /^image\/(heic|heif)$/i.test(sourceMime)
      if (isHeic) {
        const jpeg = img.toJPEG(90)
        return { bytes: new Uint8Array(jpeg), ext: 'jpg' }
      }
      const png = img.toPNG()
      return { bytes: new Uint8Array(png), ext: 'png' }
    }

    // ENH-128 walk-4 fallback — sips on macOS for HEIC/HEIF/RAW.
    const isHeicLike = /^image\/(heic|heif|x-canon-cr2|x-nikon-nef|x-sony-arw|x-adobe-dng|x-fuji-raf)$/i.test(sourceMime)
    if (process.platform === 'darwin' && isHeicLike) {
      return await this.transcodeViaSips(bytes, sourceMime)
    }

    throw new Error(`Could not decode image bytes (source MIME: ${sourceMime}). HEIC requires macOS 10.13+; some RAW formats are platform-dependent.`)
  }

  /**
   * ENH-128 walk-4 — macOS-only HEIC/RAW transcode via `sips`. Writes
   * bytes to a temp file, runs `sips -s format jpeg <in> --out <out>`,
   * reads the converted bytes back. Both temps are cleaned in finally.
   * Throws with the sips stderr if the tool itself fails (e.g. the
   * format is genuinely unsupported even by ImageIO).
   *
   * Why temp files: `sips` is path-based — no stdin variant. The cost
   * (one disk round-trip) is irrelevant for paste/drop workflows.
   */
  private async transcodeViaSips(bytes: Uint8Array, sourceMime: string): Promise<{ bytes: Uint8Array; ext: string }> {
    const stamp = `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`
    // Pick a sensible input extension so sips reads the file with the
    // right format hint. ImageIO is content-sniffing-tolerant but the
    // hint helps in edge cases.
    const inExt = /heic/i.test(sourceMime) ? 'heic'
      : /heif/i.test(sourceMime) ? 'heif'
      : sourceMime.replace(/^image\//, '').replace(/[^a-z0-9]/gi, '') || 'bin'
    const tmpDir = os.tmpdir()
    const inPath = path.join(tmpDir, `duo-convert-in-${stamp}.${inExt}`)
    const outPath = path.join(tmpDir, `duo-convert-out-${stamp}.jpg`)
    try {
      await fs.writeFile(inPath, bytes)
      await execFileAsync('sips', ['-s', 'format', 'jpeg', inPath, '--out', outPath])
      const outBytes = await fs.readFile(outPath)
      return { bytes: new Uint8Array(outBytes), ext: 'jpg' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`sips transcode failed (source MIME: ${sourceMime}): ${msg}`)
    } finally {
      await fs.unlink(inPath).catch(() => {})
      await fs.unlink(outPath).catch(() => {})
    }
  }

  /** FOLLOWUP-026 — renamed from openExternal. Opens a local file
   *  path via shell.openPath (OS picks the default app for the
   *  extension). For URLs, use the agent-side openExternalUrl helper
   *  in main.ts (which routes through shell.openExternal with scheme
   *  validation) — the two are NOT interchangeable. */
  async openPath(absPath: string): Promise<void> {
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
    pushChannel: string,
    opts?: { ignored?: (string | RegExp)[]; watchParents?: boolean }
  ): void {
    // ENH-195 B4 — a single open-file editor passes `watchParents:true` so we
    // also watch each path's parent dir at depth 0. Some external editors save
    // by writing a temp file then renaming over the target (atomic replace),
    // which chokidar surfaces as unlink+add on the FILE path within the parent
    // dir's watch rather than a `change` on the inode — without the parent
    // watch the editor would go deaf after such a save. The renderer's
    // `event.path !== path` filter drops sibling-file noise cheaply.
    const watchParents = opts?.watchParents ?? false
    const watchPaths = watchParents
      ? [...new Set([...paths, ...paths.map(p => path.dirname(p))])]
      : paths

    // Do not watch recursively by default — Stage 10 v1 only watches the
    // currently-visible subtree. Recursive watches on e.g. node_modules are a
    // CPU + event-rate disaster. Callers pass the specific directories they
    // want observed (current nav folder + expanded descendants).
    // FOLLOWUP-019 → BUG-125. Build the realpath→original map BEFORE handing
    // paths to chokidar. realpathSync throws on a path that doesn't exist
    // yet (e.g. a fresh `duo edit` for a file we're about to create); the
    // identity fallback handles that case + any non-symlinked path. Either
    // way, the original string is always a valid lookup key.
    const resolvedToOriginal = new Map<string, string>()
    for (const p of watchPaths) {
      try {
        resolvedToOriginal.set(realpathSync(p), p)
      } catch {
        // ignore — fall through to identity mapping
      }
      resolvedToOriginal.set(p, p)
    }

    const fsw = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      },
      // Filesystem-level watchers; no polling except on network mounts.
      usePolling: false,
      // ENH-096 (A4) — Obsidian vaults' `.obsidian/` directory is
      // written constantly by Obsidian (`workspace.json`, plugin
      // state, etc.). Even though the navigator already hides
      // dotfiles by default (Stage 10), the file watcher would still
      // emit change events for these writes if a user manually
      // expanded the navigator's hidden-files toggle. Pre-emptive
      // ignore at the watcher level keeps event noise bounded
      // regardless of UI visibility. The `.git/` ignore is a
      // long-standing convention for the same reason (any
      // git-tracked vault would also benefit).
      //
      // ENH-195 B2 — a caller can override `ignored` (the single open-file
      // editor passes `[]`) so a file the user explicitly opened that lives
      // under a `.git`/`.obsidian`/`node_modules` path still emits change
      // events. The default below stays for the navigator's directory watch.
      ignored: opts?.ignored ?? [/\.obsidian(\/|$)/, /\.git(\/|$)/, /node_modules(\/|$)/]
    })

    const send = (kind: FileChangeEvent['kind'], p: string) => {
      if (wc.isDestroyed()) return
      // BUG-125 — map back to the caller's input path so renderer-side
      // equality checks survive symlink resolution. Fallback to the raw
      // chokidar path if we never saw it at watch-start (subscribers using
      // a single-path watcher don't go through updateWatchPaths anyway).
      const original = resolvedToOriginal.get(p) ?? p
      const event: FileChangeEvent = { kind, path: original }
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

    this.watchers.set(id, { fsw, wc, resolvedToOriginal })
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

    // BUG-125 — keep resolvedToOriginal in sync. Rebuild from the new path
    // set so stale mappings (from a path that was removed) don't shadow a
    // fresh subscription to the same realpath.
    w.resolvedToOriginal.clear()
    for (const p of paths) {
      try {
        w.resolvedToOriginal.set(realpathSync(p), p)
      } catch {
        // ignore — identity fallback below covers it
      }
      w.resolvedToOriginal.set(p, p)
    }
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
