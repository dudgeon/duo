// FOLLOWUP-014 (Sprint 13) — paste-image v2.
//
// Custom Image extension that stores RELATIVE filenames in markdown source
// (`![](image-<stamp>-<hash>.png)`) and hydrates a displayable blob URL at
// mount time via `files.read`. Closes the v0.6.10 v1 trade-off where the
// markdown source carried `blob:http://localhost:5173/<uuid>` URLs that
// were renderer-process-scoped and died on doc reload.
//
// Architecture: extends `@tiptap/extension-image` (so all of TipTap's
// image command + parse + serialize logic is inherited unchanged) and
// adds a NodeView. The NodeView renders an `<img>` whose `src` is set
// asynchronously after the resolution completes — async-aware design,
// chosen over a pre-mount precompute pass because:
//   1. Re-renders on src changes happen naturally (the update hook
//      re-runs resolution).
//   2. Doesn't couple the editor's mount path to a synchronous batch
//      file-read of every image in the doc.
//   3. Mirrors cleanly to the canvas surface (a separate post-load
//      pass is still needed there because canvas uses raw
//      contentEditable, not ProseMirror — out of scope for this file).
//
// Cache lifecycle: a per-editor `ImageBlobCache` (passed via options)
// holds blob URLs keyed by absolute path. Same image referenced N times
// in a doc yields one blob URL. The cache's `revokeAll` is called from
// the editor's useEffect cleanup so blob URLs don't leak when the tab
// unmounts.
//
// Backward-compat: legacy v0.6.10 docs with `<img src="blob:...">` in
// source still render the same way (broken on reload — same as before).
// The NodeView treats any src that looks like an absolute URL or
// absolute path as opaque and passes it through unchanged.

import Image from '@tiptap/extension-image'
import type { NodeViewRenderer } from '@tiptap/core'

const MIME_FOR_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  ico: 'image/vnd.microsoft.icon'
}

/** Per-doc cache of resolved blob URLs. One instance per editor mount. */
export class ImageBlobCache {
  private map = new Map<string, string>()

  get(absPath: string): string | undefined {
    return this.map.get(absPath)
  }

  set(absPath: string, url: string): void {
    this.map.set(absPath, url)
  }

  revokeAll(): void {
    for (const url of this.map.values()) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* best-effort */
      }
    }
    this.map.clear()
  }
}

export interface DuoImageOptions {
  /** Returns the absolute path of the doc the editor is currently
   *  editing, or null if there's no path yet (untitled / isNew).
   *  Called every time the NodeView resolves a relative `src`. */
  getDocPath: () => string | null
  /** Per-editor blob URL cache. Caller is responsible for `revokeAll()`
   *  on editor unmount to avoid leaking blob URLs. */
  cache: ImageBlobCache
  /** Inherits HTMLAttributes from base Image extension. */
  HTMLAttributes: Record<string, unknown>
  inline: boolean
  allowBase64: boolean
}

/** True if `src` is a non-relative URL scheme that the browser can
 *  load directly (or is a "soft passthrough" for legacy v0.6.10
 *  blob URLs). These are passed straight to `<img src>` without
 *  going through `files.read`. Absolute filesystem paths (`/tmp/x.png`)
 *  are NOT URL schemes — they go through the relative-path branch
 *  and get resolved + read via `files.read`, otherwise the browser
 *  would resolve them against the renderer's origin
 *  (`http://localhost:5173/tmp/x.png` → 404). */
function isUrlScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src)
}

/** Resolve a relative path against the doc's parent directory. Hand-rolled
 *  to avoid URL-encoding mishaps with filenames containing spaces or other
 *  characters that browser URL parsers would percent-encode. */
function resolveRelative(docPath: string, relPath: string): string {
  if (relPath.startsWith('/')) return relPath
  const lastSlash = docPath.lastIndexOf('/')
  const dir = lastSlash > 0 ? docPath.substring(0, lastSlash) : ''
  const parts = (dir + '/' + relPath).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return '/' + out.join('/')
}

function mimeForPath(absPath: string): string {
  const dot = absPath.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = absPath.substring(dot + 1).toLowerCase()
  return MIME_FOR_EXT[ext] ?? 'application/octet-stream'
}

const buildNodeView = (options: { getDocPath: () => string | null; cache: ImageBlobCache }): NodeViewRenderer => {
  return ({ node, HTMLAttributes }) => {
    const dom = document.createElement('img')

    // Copy non-src HTMLAttributes onto the img element. ProseMirror
    // passes the merged attribute set (node attrs + extension's
    // HTMLAttributes options), respecting the parent extension's
    // serializer. We override `src` ourselves below.
    for (const [key, value] of Object.entries(HTMLAttributes)) {
      if (key === 'src' || value == null) continue
      dom.setAttribute(key, String(value))
    }

    let currentSrc = node.attrs.src as string

    const resolveAndSet = (src: string) => {
      if (!src) {
        dom.removeAttribute('src')
        return
      }
      if (isUrlScheme(src)) {
        // file://, http(s)://, data:, blob:, duo-asset:// — pass
        // through unchanged. Backward-compat with v0.6.10 docs that
        // stored `blob:http://localhost:5173/...` URLs (which die on
        // reload — that's the trade-off this v2 closes for new docs).
        dom.src = src
        return
      }
      // Relative or absolute filesystem path — resolve + read via
      // files.read. The IPC's main-process file-system service can
      // load any path the user has read access to.
      const docPath = options.getDocPath()
      if (!docPath && !src.startsWith('/')) {
        // Untitled doc with relative src — can't resolve. Show alt
        // text + don't crash. (Shouldn't happen in practice — the
        // insert sites refuse to insert into untitled docs.)
        dom.removeAttribute('src')
        dom.alt = `[unresolved: ${src}]`
        return
      }
      const absPath = src.startsWith('/') ? src : resolveRelative(docPath!, src)
      const cached = options.cache.get(absPath)
      if (cached) {
        dom.src = cached
        return
      }
      void window.electron.files.read(absPath).then(
        (res) => {
          if (currentSrc !== src) return // src changed mid-flight; later resolve wins
          const safe = new Uint8Array(res.bytes)
          const blobUrl = URL.createObjectURL(new Blob([safe], { type: mimeForPath(absPath) }))
          options.cache.set(absPath, blobUrl)
          dom.src = blobUrl
        },
        (err) => {
          if (currentSrc !== src) return
          dom.removeAttribute('src')
          dom.alt = `[load failed: ${src}]`
          dom.title = err instanceof Error ? err.message : String(err)
        }
      )
    }

    resolveAndSet(currentSrc)

    return {
      dom,
      update: (newNode) => {
        if (newNode.type.name !== 'image') return false
        const newSrc = newNode.attrs.src as string
        // Update non-src attrs in-place.
        const merged = { ...HTMLAttributes, ...newNode.attrs }
        for (const [key, value] of Object.entries(merged)) {
          if (key === 'src') continue
          if (value == null) dom.removeAttribute(key)
          else dom.setAttribute(key, String(value))
        }
        if (newSrc !== currentSrc) {
          currentSrc = newSrc
          resolveAndSet(newSrc)
        }
        return true
      },
      destroy: () => {
        // Per-NodeView cleanup is unnecessary — blob URLs are owned
        // by the per-editor cache and revoked on editor unmount.
        // The same blob URL may back multiple NodeViews if the doc
        // references the image twice; revoking here would break the
        // other reference.
      }
    }
  }
}

export const DuoImage = Image.extend<DuoImageOptions>({
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      getDocPath: () => null,
      cache: new ImageBlobCache()
    }
  },

  addNodeView() {
    return buildNodeView({
      getDocPath: this.options.getDocPath,
      cache: this.options.cache
    })
  }
})
