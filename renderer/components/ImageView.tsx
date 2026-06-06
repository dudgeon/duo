// ENH-111 (Sprint 12) — image viewer v2: toolbar chrome around the
// existing image tab. Replaces the bare `<img>` previewer that
// lived in FileRenderers.tsx through Sprint 11. PM-persona benefit:
// dragging a screenshot from Slack into Duo currently shows a small
// image; with chrome the user can zoom in to UI mockups, copy the
// image to paste into Notion, or jump to Finder/Preview without
// leaving Duo.

import { useEffect, useRef, useState, useCallback } from 'react'
import type { WorkingTab, MenuTemplateItem, FileReadResult } from '@shared/types'

const ZOOM_MIN = 0.05
const ZOOM_MAX = 32
const ZOOM_STEP = 1.25

type Mode = 'fit' | 'manual'

interface Dims {
  w: number
  h: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ImageView({ tab }: { tab: WorkingTab }) {
  const path = tab.path ?? ''
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [mode, setMode] = useState<Mode>('fit')
  const [manualScale, setManualScale] = useState(1)
  const [dims, setDims] = useState<Dims | null>(null)
  const [bytes, setBytes] = useState<number | null>(null)
  const [containerSize, setContainerSize] = useState<Dims>({ w: 0, h: 0 })
  const [copyFlash, setCopyFlash] = useState<'idle' | 'ok' | 'fail'>('idle')
  // ENH-111 walk-rev3 fix v2 — load via files.read IPC + blob URL. The
  // duo-asset:// custom protocol returned 200/correct-bytes from a
  // file:// origin (verified via fetch from the smoke-walk page) but
  // images would not render in the renderer at http://localhost:5173/
  // even with corsEnabled + Access-Control-Allow-Origin: *. Chromium
  // appears to silently block cross-origin image renders for custom
  // schemes regardless of CORS. Blob URLs sidestep all of that by
  // staying same-origin to the renderer.
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  // ENH-195 (B6) — the currently-live object URL, shared between the
  // mount-load effect and the disk watcher so whichever sets a new URL
  // revokes the previous one through a single owner (no double-revoke).
  const liveUrlRef = useRef<string | null>(null)

  // File size readout via files.stat (cheap — no payload transfer).
  useEffect(() => {
    let cancelled = false
    if (!path) return
    void window.electron.files.stat(path).then((s) => {
      if (cancelled) return
      setBytes(s?.size ?? null)
    })
    return () => { cancelled = true }
  }, [path])

  // ENH-195 (B6) — swap in a freshly-read frame: build the blob URL,
  // revoke whatever liveUrlRef pointed at, then publish the new one.
  // Shared by the mount-load effect and the disk watcher so neither can
  // double-revoke the other's URL.
  const applyFrame = useCallback((res: FileReadResult) => {
    // Slice into a fresh ArrayBuffer-backed Uint8Array — IPC may return
    // SharedArrayBuffer-backed bytes which BlobPart typing rejects.
    const safe = new Uint8Array(res.bytes)
    const blob = new Blob([safe], { type: res.mime })
    const u = URL.createObjectURL(blob)
    if (liveUrlRef.current) URL.revokeObjectURL(liveUrlRef.current)
    liveUrlRef.current = u
    setImgUrl(u)
    setBytes(res.size)
  }, [])

  // Load the image via files.read → Blob → object URL. Re-runs on path
  // change. Cleanup revokes the live object URL to avoid leaks.
  useEffect(() => {
    let cancelled = false
    if (!path) {
      setImgUrl(null)
      return
    }
    void window.electron.files.read(path).then((res) => {
      if (cancelled) return
      applyFrame(res)
    }).catch((err) => {
      console.warn('[ImageView] files.read failed for', path, err)
      if (!cancelled) setImgUrl(null)
    })
    return () => {
      cancelled = true
      if (liveUrlRef.current) {
        URL.revokeObjectURL(liveUrlRef.current)
        liveUrlRef.current = null
      }
    }
  }, [path, applyFrame])

  // ENH-195 (B6) — read-only disk watcher: re-read + repaint when the
  // file is re-saved on disk (e.g. an export overwrites it). Mirrors the
  // markdown editor's reconcile-on-change while staying read-only —
  // 'removed' leaves the last frame in place (parity with the editor
  // ignoring deletes), and 'added'/'changed' both reload via files.read,
  // reusing res.size so no extra files.stat round-trip is needed.
  useEffect(() => {
    if (!path) return
    let cancelled = false
    let unwatch: (() => Promise<void>) | null = null
    void window.electron.files.watch([path], (ev) => {
      if (ev.path !== path) return
      if (ev.kind === 'removed') return
      void window.electron.files.read(path).then((res) => {
        if (cancelled) return
        applyFrame(res)
      }).catch((err) => {
        console.warn('[ImageView] reload after change failed for', path, err)
      })
    }).then((fn) => {
      if (cancelled) { void fn() } else { unwatch = fn }
    })
    return () => {
      cancelled = true
      if (unwatch) void unwatch()
    }
  }, [path, applyFrame])

  // Track container size so 'fit' mode can compute a percentage
  // readout that matches what the user sees.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect
        setContainerSize({ w: cr.width, h: cr.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onImgLoad = useCallback(() => {
    const el = imgRef.current
    if (!el) return
    setDims({ w: el.naturalWidth, h: el.naturalHeight })
  }, [])

  // Effective scale shown in the toolbar + driving manual-mode sizing.
  const fitScale = (() => {
    if (!dims || containerSize.w === 0 || containerSize.h === 0) return 1
    return Math.min(containerSize.w / dims.w, containerSize.h / dims.h, 1)
  })()
  const effectiveScale = mode === 'fit' ? fitScale : manualScale

  // Image element style — for 'fit' mode, defer to CSS object-contain.
  // For manual mode, set explicit pixel dimensions so the container
  // overflows naturally, enabling pan via scroll.
  const imgStyle: React.CSSProperties = mode === 'fit'
    ? {
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        userSelect: 'none',
        pointerEvents: 'none'
      }
    : dims
      ? {
          width: dims.w * manualScale,
          height: dims.h * manualScale,
          maxWidth: 'none',
          maxHeight: 'none',
          userSelect: 'none',
          pointerEvents: 'none'
        }
      : { userSelect: 'none', pointerEvents: 'none' }

  // ── actions ────────────────────────────────────────────────────────
  const setZoomManual = useCallback((nextScale: number) => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextScale))
    setManualScale(clamped)
    setMode('manual')
  }, [])

  const zoomIn = useCallback(() => {
    setZoomManual(effectiveScale * ZOOM_STEP)
  }, [effectiveScale, setZoomManual])

  const zoomOut = useCallback(() => {
    setZoomManual(effectiveScale / ZOOM_STEP)
  }, [effectiveScale, setZoomManual])

  const setFit = useCallback(() => {
    setMode('fit')
  }, [])

  const setActualSize = useCallback(() => {
    setManualScale(1)
    setMode('manual')
  }, [])

  const copyImage = useCallback(async () => {
    if (!path) return
    try {
      const ok = await window.electron.clipboard.writeImage(path)
      setCopyFlash(ok ? 'ok' : 'fail')
    } catch {
      setCopyFlash('fail')
    }
    setTimeout(() => setCopyFlash('idle'), 1200)
  }, [path])

  const copyPath = useCallback(() => {
    if (!path) return
    void window.electron.clipboard.writeText(path)
  }, [path])

  const openInDefault = useCallback(() => {
    if (!path) return
    void window.electron.files.openPath(path)
  }, [path])

  const revealInFinder = useCallback(() => {
    if (!path) return
    void window.electron.files.revealInFinder(path)
  }, [path])

  // ── pan via drag ───────────────────────────────────────────────────
  const dragState = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null)
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = containerRef.current
    if (!el) return
    if (mode === 'fit') return
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: el.scrollLeft,
      startTop: el.scrollTop
    }
    el.style.cursor = 'grabbing'
  }, [mode])
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ds = dragState.current
      const el = containerRef.current
      if (!ds || !el) return
      el.scrollLeft = ds.startLeft - (e.clientX - ds.startX)
      el.scrollTop = ds.startTop - (e.clientY - ds.startY)
    }
    function onUp() {
      const el = containerRef.current
      if (!el) return
      dragState.current = null
      el.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Wheel zoom with ⌘ / ⌃ modifier (matches Preview.app + browsers).
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    setZoomManual(effectiveScale * factor)
  }, [effectiveScale, setZoomManual])

  // Right-click → native context menu.
  const onContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!path) return
    const items: MenuTemplateItem[] = [
      { id: 'copy-image', label: 'Copy image' },
      { id: 'copy-path', label: 'Copy path' },
      { type: 'separator' },
      { id: 'open-default', label: 'Open in default app' },
      { id: 'reveal', label: 'Reveal in Finder' },
      { type: 'separator' },
      { id: 'fit', label: 'Fit to window' },
      { id: 'actual', label: 'Actual size (1:1)' }
    ]
    const res = await window.electron.menu.popup({ items, x: e.clientX, y: e.clientY })
    switch (res.chosenId) {
      case 'copy-image': void copyImage(); break
      case 'copy-path': copyPath(); break
      case 'open-default': openInDefault(); break
      case 'reveal': revealInFinder(); break
      case 'fit': setFit(); break
      case 'actual': setActualSize(); break
    }
  }, [path, copyImage, copyPath, openInDefault, revealInFinder, setFit, setActualSize])

  const zoomPct = Math.round(effectiveScale * 100)
  const dimsLabel = dims ? `${dims.w} × ${dims.h}` : '—'
  const sizeLabel = bytes != null ? formatBytes(bytes) : '—'

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-0">
      {/* Toolbar */}
      <div className="flex items-center h-8 shrink-0 bg-surface-2 border-b border-border px-2 gap-1 text-[11px] text-ink-mute">
        <ToolbarButton onClick={zoomOut} title="Zoom out (⌘−)" disabled={effectiveScale <= ZOOM_MIN + 0.001}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolbarButton>
        <button
          type="button"
          onClick={() => setMode(mode === 'fit' ? 'manual' : 'fit')}
          className="min-w-[3.5rem] px-1.5 h-6 rounded text-ink-mute hover:text-ink hover:bg-surface-3 tabular-nums transition-colors"
          title="Click to toggle fit/manual"
        >
          {zoomPct}%
        </button>
        <ToolbarButton onClick={zoomIn} title="Zoom in (⌘+)" disabled={effectiveScale >= ZOOM_MAX - 0.001}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolbarButton>
        <span aria-hidden="true" className="w-px h-4 bg-paper-rule mx-1" />
        <ToolbarButton onClick={setFit} title="Fit to window" active={mode === 'fit'}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 4V2h2M10 4V2H8M2 8v2h2M10 8v2H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ToolbarButton>
        <ToolbarButton onClick={setActualSize} title="Actual size (1:1)" active={mode === 'manual' && Math.abs(manualScale - 1) < 0.001}>
          <span className="text-[10px] font-medium tracking-tight">1:1</span>
        </ToolbarButton>
        <span aria-hidden="true" className="w-px h-4 bg-paper-rule mx-1" />
        <ToolbarButton
          onClick={copyImage}
          title="Copy image to clipboard"
          flash={copyFlash}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 8V2.5C2 2.22 2.22 2 2.5 2H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </ToolbarButton>

        <div className="ml-auto flex items-center gap-2 tabular-nums text-ink-ghost">
          <span title="Image dimensions">{dimsLabel}</span>
          <span aria-hidden="true">·</span>
          <span title="File size">{sizeLabel}</span>
        </div>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        className={[
          'flex-1 overflow-auto',
          mode === 'fit' ? 'flex items-center justify-center' : '',
          mode === 'manual' ? 'cursor-grab' : ''
        ].join(' ')}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
        // Checker pattern hints transparency (useful for PNGs / SVGs).
        style={{
          backgroundImage:
            'linear-gradient(45deg, rgba(120,120,120,0.06) 25%, transparent 25%, transparent 75%, rgba(120,120,120,0.06) 75%),' +
            'linear-gradient(45deg, rgba(120,120,120,0.06) 25%, transparent 25%, transparent 75%, rgba(120,120,120,0.06) 75%)',
          backgroundSize: '14px 14px',
          backgroundPosition: '0 0, 7px 7px'
        }}
      >
        {imgUrl && (
          <img
            ref={imgRef}
            src={imgUrl}
            alt={tab.title}
            onLoad={onImgLoad}
            style={imgStyle}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}

interface ToolbarButtonProps {
  onClick: () => void
  title: string
  children: React.ReactNode
  disabled?: boolean
  active?: boolean
  flash?: 'idle' | 'ok' | 'fail'
}

function ToolbarButton({ onClick, title, children, disabled, active, flash = 'idle' }: ToolbarButtonProps) {
  const flashCls =
    flash === 'ok' ? 'text-accent' : flash === 'fail' ? 'text-rose-400' : ''
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={[
        'w-6 h-6 flex items-center justify-center rounded transition-colors',
        active
          ? 'bg-accent text-white'
          : 'text-ink-mute hover:text-ink hover:bg-surface-3',
        disabled ? 'opacity-40 cursor-default hover:bg-transparent hover:text-ink-mute' : '',
        flashCls
      ].join(' ')}
    >
      {children}
    </button>
  )
}
