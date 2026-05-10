// FOLLOWUP-014 (Sprint 13) — canvas paste-image v2 hydration.
//
// The canvas surface is raw `contentEditable` inside an iframe — no
// ProseMirror NodeView to plug into. Same v2 goal as the markdown
// editor: HTML source carries `<img src="image-x.png">` (relative)
// instead of `<img src="blob:http://localhost:5173/...">` (legacy v1).
//
// Strategy:
//   1. On install, walk every `<img>` already in the iframe doc; for
//      each one whose src is a non-URL (relative path or absolute fs
//      path), stash the original in `data-duo-original-src` and
//      hydrate src to a blob URL via `files.read`.
//   2. A MutationObserver catches newly-added `<img>` elements
//      (insertHTML from paste/drop, agent edits, manual user edits)
//      and runs the same hydrate pass.
//   3. The save-time serializer (`serialize.ts § attrString`)
//      detects `data-duo-original-src` on img elements and swaps the
//      src back to the original before writing to disk. The
//      data-duo-original-src attribute itself is stripped from the
//      saved output.
//
// Returns a cleanup function. Call on iframe unmount to disconnect
// the observer + revoke blob URLs.

import { ImageBlobCache } from '../editor/extensions/DuoImage'

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

export interface ImageHydrateOptions {
  /** Returns the absolute path of the canvas's HTML source on disk.
   *  null if the doc is untitled / not yet saved. */
  getDocPath: () => string | null
}

function isUrlScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src)
}

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

/** Hydrate a single img element. Idempotent — if already hydrated
 *  (data-duo-original-src present and src is a blob URL), no-op. */
function hydrateOne(img: HTMLImageElement, opts: ImageHydrateOptions, cache: ImageBlobCache): void {
  // Already hydrated? data-duo-original-src is the marker.
  if (img.hasAttribute('data-duo-original-src')) return

  const src = img.getAttribute('src') ?? ''
  if (!src || isUrlScheme(src)) {
    // No src, or already a URL scheme (http(s)://, blob:, data:,
    // duo-asset://, file://) — nothing to do. Legacy v0.6.10 docs
    // with `<img src="blob:...">` go through this branch and stay
    // broken on reload (same as before; v2 doesn't migrate them).
    return
  }

  const docPath = opts.getDocPath()
  if (!docPath && !src.startsWith('/')) {
    // Untitled doc with relative src — can't resolve. Show alt text.
    img.removeAttribute('src')
    img.alt = `[unresolved: ${src}]`
    return
  }

  const absPath = src.startsWith('/') ? src : resolveRelative(docPath!, src)
  // Stash the original src BEFORE we swap, so the serializer can
  // restore it at save time.
  img.setAttribute('data-duo-original-src', src)

  const cached = cache.get(absPath)
  if (cached) {
    img.src = cached
    return
  }

  void window.electron.files.read(absPath).then(
    (res) => {
      const safe = new Uint8Array(res.bytes)
      const blobUrl = URL.createObjectURL(new Blob([safe], { type: mimeForPath(absPath) }))
      cache.set(absPath, blobUrl)
      img.src = blobUrl
    },
    (err) => {
      img.removeAttribute('src')
      img.alt = `[load failed: ${src}]`
      img.title = err instanceof Error ? err.message : String(err)
    }
  )
}

/** Install image hydration on the canvas's iframe document. Runs an
 *  initial pass over all existing `<img>` elements + watches for new
 *  ones via MutationObserver. */
export function installImageHydrate(doc: Document, opts: ImageHydrateOptions): () => void {
  const cache = new ImageBlobCache()

  // Initial pass.
  doc.querySelectorAll('img').forEach((img) => hydrateOne(img as HTMLImageElement, opts, cache))

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType !== 1) continue
          const el = node as Element
          if (el.tagName === 'IMG') {
            hydrateOne(el as HTMLImageElement, opts, cache)
          }
          // Also catch nested img elements (e.g. when a fragment is
          // pasted that contains an img inside a wrapper).
          el.querySelectorAll?.('img').forEach((img) =>
            hydrateOne(img as HTMLImageElement, opts, cache)
          )
        }
      } else if (m.type === 'attributes' && m.attributeName === 'src') {
        const target = m.target
        if (target.nodeType === 1 && (target as Element).tagName === 'IMG') {
          // src changed externally — clear our hydration marker so the
          // next pass re-resolves. Skip if it changed BECAUSE of our
          // own hydration (blob: URL).
          const img = target as HTMLImageElement
          const newSrc = img.getAttribute('src') ?? ''
          if (!newSrc.startsWith('blob:')) {
            img.removeAttribute('data-duo-original-src')
            hydrateOne(img, opts, cache)
          }
        }
      }
    }
  })

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src']
  })

  return () => {
    observer.disconnect()
    cache.revokeAll()
  }
}
