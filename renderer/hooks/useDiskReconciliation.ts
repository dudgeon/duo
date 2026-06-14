// ENH-195 D5 — shared editor↔disk reconciliation primitive.
//
// Before this hook, the markdown editor (MarkdownEditor.tsx) and the HTML
// canvas (PageTab.tsx) each carried a near-identical copy of the external-
// write reconciliation state machine: a chokidar watch, a multi-stage echo
// gauntlet, a save-pre-reconcile read, the recently-written echo set, the
// byte-exact + serialized baselines, and the "changed on disk" conflict
// banner. Two divergent copies is exactly why BUG-166's byte-exact fix
// landed in markdown but silently skipped the canvas — and why the ~11-bug
// BUG-085 → BUG-166 conflict arc kept recurring. This hook is the single
// home for that logic; each surface injects its EDITING contract
// (serialize / applyReload / dirty / echo-equality) as callbacks. It touches
// ZERO editing logic, so the DECISIONS.md:620 "keep the editing surfaces
// parallel" lock stands — only the reconciliation LAYER is shared (see the
// 2026-06-05 amendment to that decision).
//
// Tier-A correctness folded in vs. the old per-surface copies:
//   A1 — the fallback compares disk against the BYTE-EXACT baseline
//        (`lastSeenDiskRef`), never against the serialized view. The
//        serialized view only feeds the dirty check + the dirty-path
//        cosmetic-touch check.
//   A2 — the canvas gains the byte-exact ref it never had (it consumes the
//        same hook).
//   A4 — each surface's `echoEqual` is used consistently in BOTH the watcher
//        and the save-pre-reconcile (canvas previously used the markdown
//        normalizer in its pre-reconcile — an internal inconsistency).
//   A5 — the echo set is bounded by COUNT and consumed deterministically on
//        the matching watcher event, not evicted on a 5s wall-clock timer
//        that could expire before chokidar fires on a large file (BUG-166's
//        1.2MB tasks.md case).
//
// ENH-195 D3 byte-faithful reload: on a CLEAN buffer, ANY disk byte
// difference reloads (the surface's applyReload paints the change-highlight).
// The normalize-echo gauntlet is reserved for (a) suppressing our OWN writes
// echoing back and (b) the DIRTY conflict-vs-cosmetic decision — it never
// swallows a real external edit on a clean buffer. This is what stops the
// "editor doesn't notice changes" class without re-introducing false banners.
//
// Locks respected: the markdown comparator `normalizeForEchoCompare` is NOT
// widened (the retired one-ref/two-purposes anti-pattern — surfaces inject
// their own `echoEqual`); no sidecar disk-hash cache (all baselines are
// in-memory refs); the canvas data-duo-id-strip still banners on a clean
// buffer via `shouldBannerOnClean` (BUG-125-v2 Q2).

import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeUtf8 } from '../components/editor/markdown-io'
import { computeFirstDiffOffset, writeConflictLog } from '../utils/conflictDiagnostic'

export type ReconcileSurface = 'markdown' | 'canvas' | 'json'

/** Bound on the recently-written echo set. Entries are consumed on the
 *  matching watcher event; the cap is only a backstop against unbounded
 *  growth if a write's chokidar event never arrives (A5 — no time eviction). */
const ECHO_CAP = 32

/** ENH-216 (U7) — how long to wait after a `removed` event before treating
 *  it as a likely out-of-band MOVE (not a transient atomic-rename save). A
 *  re-add / successful read inside this window cancels it. Generous enough
 *  to ride out an editor's write-temp-then-rename save cycle. */
const LIKELY_MOVE_DEBOUNCE_MS = 1200

export interface DiskReconciliationOptions {
  /** Absolute path being edited. */
  path: string
  /** True while the tab is an uncommitted new file (no disk file yet) — the
   *  hook installs no watcher. Markdown passes its `isNew`; canvas/json pass
   *  `false`. */
  isNew: boolean
  /** Surface tag — drives only the diagnostic log's `surface` field. */
  surface: ReconcileSurface
  /** Gate: the hook does nothing until this is true. It must become true
   *  only AFTER the surface has called `noteLoaded` for the current path, so
   *  no watcher event is processed against an unseeded baseline. Markdown:
   *  `!!editor && loaded`; canvas: `initialHtml !== null`; json: load ready. */
  ready: boolean

  // ── surface adapters (the only editing-aware code) ───────────────────────
  /** Current live buffer serialized to the SAME shape written to disk, minus
   *  frontmatter. Markdown: serializeWithCriticMarkup(editor). Canvas:
   *  canvasRef.current?.serialize() ?? ''. Json: the text save() would write. */
  serialize: () => string
  /** Reload the surface from a disk body and re-establish surface-local
   *  invariants (markdown: adopt the raw text's frontmatter/eol + setContent +
   *  re-apply CriticMarkup + paint the D3 change-highlight; canvas:
   *  setInitialHtml + bump reloadKey; json: re-parse). `rawText` is the full
   *  on-disk text (markdown uses it to re-derive frontmatter; canvas/json
   *  ignore it). MUST NOT advance baselines — the hook owns those. */
  applyReload: (diskBody: string, rawText: string) => void
  /** Strip frontmatter off a raw on-disk text → the comparable body. MUST BE
   *  PURE — it runs inside beforeSave's pre-reconcile, so a side effect here
   *  would corrupt save state (ENH-195 frontmatter-clobber regression).
   *  Markdown: splitFrontmatter(text).body. Canvas/Json: identity. */
  readDiskBody: (rawText: string) => string
  /** "Does the user have unsaved edits?" Markdown: (live, base) => live !== base.
   *  Canvas: (live, base) => live !== '' && normalizeDuoHtml(live) !== normalizeDuoHtml(base). */
  isDirty: (live: string, baseline: string) => boolean
  /** "Are these two contents the same modulo cosmetic/round-trip noise?" Used
   *  for the DIRTY-path conflict-vs-cosmetic decision and the save-pre-reconcile
   *  fallback. Markdown: normalizeForEchoCompare-equal. Canvas: normalizeDuoHtml-
   *  equal. Json: byte-equal. */
  echoEqual: (a: string, b: string) => boolean
  /** Optional. On a CLEAN buffer, return true to surface the banner ANYWAY
   *  instead of byte-faithfully reloading, when adopting the disk bytes would
   *  destroy Duo-owned data. Receives `(lastSeenDiskBody, newDiskBody)` — BOTH
   *  byte-exact disk shape, so an ID/round-trip asymmetry in the SERIALIZED
   *  view can't spuriously fire it (the ENH-195 v0.9.0 canvas false-positive).
   *  Canvas: externalStrippedDuoIds(lastSeenDisk, disk) → banner iff this write
   *  removed data-duo-ids that were ON DISK before (BUG-125-v2 Q2 anchor loss).
   *  Omitted by markdown + json. */
  shouldBannerOnClean?: (lastSeenDiskBody: string, newDiskBody: string) => boolean

  /** Mirror the surface's dirty React state. Called false after a clean
   *  reload, true after Keep-mine. */
  onDirtyChange?: (dirty: boolean) => void
  /** Called true when the watched file is deleted on disk, false when a
   *  subsequent read succeeds (B4 — the surface shows a "file removed" strip). */
  onFileRemoved?: (removed: boolean) => void
  /** ENH-216 (U7) — best-effort move detection. Fired (debounced) when the
   *  watched file is `removed` on disk and does NOT come back within
   *  {@link LIKELY_MOVE_DEBOUNCE_MS} (a re-add / successful read cancels it).
   *  An out-of-band move (Finder / git) looks exactly like this from a
   *  single-file watcher's vantage. The surface decides what to surface —
   *  in OKF mode an informational, non-blocking "links repair on next vault
   *  open or via `duo vault relink`" toast. No new IPC; informational only. */
  onLikelyMove?: () => void
  /** True when serialize() is valid SYNCHRONOUSLY right after applyReload
   *  (markdown: setContent is sync; json: re-parse is sync). False for the
   *  canvas, whose iframe remount is async — the canvas re-seeds the
   *  serialized baseline from its own post-remount handleReady via noteLoaded. */
  rebaselineAfterReload: boolean
  /** Imperative save kick used by Keep-mine. Passed in (not imported) so the
   *  hook never depends on a surface's save. Pass () => void saveRef.current(). */
  triggerSave: () => void
  /** App version for the production conflict diagnostic. */
  appVersion: string
  /** ENH-195 B2/B4 — forwarded to files.watch. The single open-file editor
   *  passes `{ ignored: [], watchParents: true }`. */
  watchOptions?: { ignored?: (string | RegExp)[]; watchParents?: boolean }
}

export interface DiskReconciliation {
  /** Banner state. null = no conflict. */
  externalConflict: { diskBody: string; rawText: string } | null
  /** Banner "Reload from disk" — adopt disk, drop local edits. */
  resolveReload: () => void
  /** Banner "Keep mine" — overwrite disk on the next (immediately kicked) save. */
  resolveKeepMine: () => void
  /** Banner "View diff" (ENH-202) — the SURFACE swaps in the disk content as
   *  accept/rejectable tracked changes (Accept-all = disk, Reject-all = yours);
   *  this only clears the banner and advances BOTH baselines to `diskBody`, so a
   *  later accept-all save is a byte-exact no-op and a reject-all save overwrites
   *  disk cleanly. No save is kicked (the surface marks the buffer dirty). */
  dismissConflict: (diskBody: string) => void
  /** Pre-save gate. Call inside save() AFTER computing `body = serialize()`
   *  and confirming the body changed, BEFORE the write IPC. Reads disk, runs
   *  the byte-exact fast-path then the echoEqual fallback, and registers the
   *  echo so the post-write watcher event is recognized. Returns 'proceed'
   *  (safe to write) or 'conflict' (banner already surfaced; caller returns
   *  without writing). Read failure → 'proceed' (let the write + its catch
   *  handle it — unchanged from the old inline behavior). */
  beforeSave: (body: string) => Promise<'proceed' | 'conflict'>
  /** Call after a SUCCESSFUL normal save: advances both baselines to `body`. */
  noteSaved: (body: string) => void
  /** Call after a load / reload: `serializedBaseline` is what serialize() will
   *  return for the just-loaded doc; `diskBody` is the raw on-disk body. */
  noteLoaded: (serializedBaseline: string, diskBody: string) => void
  /** Call after a write whose disk bytes differ from the serialized view (the
   *  markdown sidecar→inline migration write): advances the byte-exact ref +
   *  echo set only, leaving the serialized baseline untouched. */
  noteDiskWrite: (diskBody: string) => void
  /** The serialized baseline the hook holds — surfaces read it for their own
   *  dirty / bodyChanged checks instead of keeping a duplicate ref (avoids the
   *  two-refs-drift hazard). */
  getSerializedBaseline: () => string
}

export function useDiskReconciliation(opts: DiskReconciliationOptions): DiskReconciliation {
  // Latest options, read inside the long-lived watch effect to avoid stale
  // closures without re-subscribing on every render.
  const optsRef = useRef(opts)
  optsRef.current = opts
  // Primitive deps the watch + reset effects key on (declared before the
  // effects to stay out of the temporal dead zone).
  const { path, isNew, ready } = opts

  // The editor's serialized view of the last-saved/loaded doc — the dirty-check
  // baseline (round-tripped through the surface's serializer).
  const serializedBaselineRef = useRef<string>('')
  // BUG-166 — the BYTE-EXACT body last read from or written to disk. The
  // conflict/echo decision is a question about disk bytes, not the serialized
  // view, so this is the primary compare (A1).
  const lastSeenDiskRef = useRef<string>('')
  // BUG-099 — bodies we wrote recently, so a chokidar event that arrives
  // before noteSaved advances the byte-exact ref is still recognized as ours.
  // A5: keyed by an insertion SEQUENCE (not a wall clock); consumed on the
  // matching event; capped by ECHO_CAP.
  const recentlyWrittenRef = useRef<Map<string, number>>(new Map())
  const seqRef = useRef(0)

  const [externalConflict, setExternalConflict] = useState<{ diskBody: string; rawText: string } | null>(null)

  const trackWritten = useCallback((body: string) => {
    const map = recentlyWrittenRef.current
    map.set(body, ++seqRef.current)
    if (map.size > ECHO_CAP) {
      // Drop the lowest-sequence (oldest) entry. O(n) but n ≤ ECHO_CAP.
      let lowestKey: string | null = null
      let lowestSeq = Infinity
      for (const [k, s] of map) {
        if (s < lowestSeq) { lowestSeq = s; lowestKey = k }
      }
      if (lowestKey !== null) map.delete(lowestKey)
    }
  }, [])

  /** Returns true if `diskBody` is the echo of one of our own recent writes,
   *  consuming (deleting) the matched entry so it can't mask a later genuine
   *  external write of the same bytes. RAW membership only — the normalize-
   *  echo concern (cosmetic external touches) is handled on the dirty path, so
   *  the echo set never swallows a real clean-buffer external edit (D3). */
  const consumeEcho = useCallback((diskBody: string): boolean => {
    const map = recentlyWrittenRef.current
    if (map.has(diskBody)) { map.delete(diskBody); return true }
    return false
  }, [])

  /** Advance both baselines to a freshly-reloaded disk body. For markdown/json
   *  serialize() is valid synchronously post-applyReload, so re-capture the
   *  serialized view; the canvas re-seeds via its handleReady→noteLoaded. */
  const advanceAfterReload = useCallback((diskBody: string) => {
    const o = optsRef.current
    if (o.rebaselineAfterReload) serializedBaselineRef.current = o.serialize()
    lastSeenDiskRef.current = diskBody
  }, [])

  /** The shared reconcile decision — run from the watcher AND the B3 post-
   *  attach catch-up read. `rawText` is the decoded on-disk text. */
  const reconcile = useCallback((rawText: string) => {
    const o = optsRef.current
    const diskBody = o.readDiskBody(rawText)

    // Stage 1 — byte-exact fast-path. Disk equals what we last read/wrote:
    // nothing external happened (BUG-166).
    if (diskBody === lastSeenDiskRef.current) return

    // Stage 2 — our own write echoing back (raw membership; consumes the entry).
    if (consumeEcho(diskBody)) return

    // Stage 3 — dirty?
    const live = o.serialize()
    const dirty = o.isDirty(live, serializedBaselineRef.current)

    if (!dirty) {
      // CLEAN buffer. The canvas must still banner if the external write
      // dropped data-duo-id anchors that were PERSISTED ON DISK (BUG-125-v2 Q2).
      // This is a disk-vs-disk question: compare the byte-exact LAST-SEEN disk
      // body against the new disk bytes — NOT the serialized baseline.
      //
      // ENH-195 v0.9.0 fix: passing `serializedBaselineRef.current` here
      // false-positived on EVERY clean external write, because the serialized
      // view always carries auto-injected data-duo-ids (installAutoStampIds runs
      // before serialize) that the on-disk bytes legitimately lack — so
      // externalStrippedDuoIds(serialized-with-ids, disk-without-ids) always
      // reported "stripped". `lastSeenDiskRef` is the same shape as `diskBody`,
      // so the predicate fires only when a write truly removed on-disk anchors.
      // Regression-tested: useDiskReconciliation.test.ts canvas
      // "clean buffer ... external CONTENT edit ... → silent reload".
      if (o.shouldBannerOnClean?.(lastSeenDiskRef.current, diskBody)) {
        void writeConflictLog({
          ts: new Date().toISOString(), path: o.path, trigger: 'watcher-clean',
          surface: o.surface, diskLength: diskBody.length,
          baselineLength: lastSeenDiskRef.current.length, liveLength: null,
          recentlyWrittenSize: recentlyWrittenRef.current.size,
          diskHead: diskBody.slice(0, 80), baselineHead: lastSeenDiskRef.current.slice(0, 80),
          diskTail: diskBody.slice(-80), baselineTail: lastSeenDiskRef.current.slice(-80),
          firstDiffOffset: computeFirstDiffOffset(diskBody, lastSeenDiskRef.current),
          appVersion: o.appVersion
        })
        setExternalConflict({ diskBody, rawText })
        return
      }
      // ENH-195 D3 — byte-faithful: ANY remaining byte difference reloads.
      o.applyReload(diskBody, rawText)
      advanceAfterReload(diskBody)
      o.onDirtyChange?.(false)
      return
    }

    // DIRTY buffer. A cosmetic / content-preserving external touch (cloud-sync
    // BOM, CRLF, a round-trip artifact) is NOT a conflict — ignore it so we
    // neither banner nor lose the user's edits. This is where the normalize
    // gauntlet lives now (A1 — and it compares against the serialized baseline
    // only here, on the dirty path).
    if (o.echoEqual(diskBody, serializedBaselineRef.current)) return

    // Real divergence over unsaved edits → the locked BUG-085 banner (D4).
    const fd = computeFirstDiffOffset(diskBody, serializedBaselineRef.current)
    console.debug('[ENH-195 conflict] dirty buffer + diverged disk; surfacing banner', {
      path: o.path, surface: o.surface, diskLength: diskBody.length,
      baselineLength: serializedBaselineRef.current.length, liveLength: live.length,
      firstDiffOffset: fd
    })
    void writeConflictLog({
      ts: new Date().toISOString(), path: o.path, trigger: 'watcher-dirty',
      surface: o.surface, diskLength: diskBody.length,
      baselineLength: serializedBaselineRef.current.length, liveLength: live.length,
      recentlyWrittenSize: recentlyWrittenRef.current.size,
      diskHead: diskBody.slice(0, 80), baselineHead: serializedBaselineRef.current.slice(0, 80),
      diskTail: diskBody.slice(-80), baselineTail: serializedBaselineRef.current.slice(-80),
      firstDiffOffset: fd, appVersion: o.appVersion
    })
    setExternalConflict({ diskBody, rawText })
  }, [consumeEcho, advanceAfterReload])

  // ── Watch effect (B2/B4 options + B3 catch-up) ─────────────────────────────
  useEffect(() => {
    if (isNew || !ready || !path) return
    let cancelled = false
    let unwatch: (() => Promise<void>) | null = null
    // ENH-216 (U7) — debounce timer for the likely-move detection. Armed on
    // `removed`, cleared on any successful read (the file came back / was a
    // transient atomic-rename save). Fires onLikelyMove if it survives.
    let moveTimer: ReturnType<typeof setTimeout> | null = null
    const clearMoveTimer = () => {
      if (moveTimer) { clearTimeout(moveTimer); moveTimer = null }
    }

    void window.electron.files.watch([path], (event) => {
      if (cancelled || event.path !== path) return
      if (event.kind === 'removed') {
        // B4 — surface a "file removed" affordance; don't reload (the read
        // would fail). The next successful read clears it.
        optsRef.current.onFileRemoved?.(true)
        // ENH-216 (U7) — best-effort move detection: if the file doesn't
        // come back shortly, treat it as a likely out-of-band move. A
        // re-add's successful read below clears this before it fires.
        clearMoveTimer()
        moveTimer = setTimeout(() => {
          moveTimer = null
          if (!cancelled) optsRef.current.onLikelyMove?.()
        }, LIKELY_MOVE_DEBOUNCE_MS)
        return
      }
      void window.electron.files.read(path).then((res) => {
        if (cancelled) return
        clearMoveTimer()   // the file is present — not a move
        optsRef.current.onFileRemoved?.(false)
        reconcile(decodeUtf8(res.bytes))
      }).catch(() => { /* mid-rename / unreadable — ignore */ })
    }, optsRef.current.watchOptions).then((fn) => {
      if (cancelled) { void fn(); return }
      unwatch = fn
      // ENH-195 B3 — one catch-up read right after attach, to reconcile a
      // write that landed in the gap between the surface's initial load read
      // and this subscription becoming live (chokidar's ignoreInitial means
      // no synthetic event for it). The byte-exact fast-path makes this a
      // no-op when nothing drifted.
      void window.electron.files.read(path).then((res) => {
        if (cancelled) return
        reconcile(decodeUtf8(res.bytes))
      }).catch(() => {})
    }).catch(() => { /* watcher unavailable — degrade gracefully */ })

    return () => { cancelled = true; clearMoveTimer(); if (unwatch) void unwatch() }
  }, [path, ready, isNew, reconcile])

  // Reset per-path transient state (stale echo entries + a leftover banner
  // from the previously-open file). The byte-exact + serialized baselines are
  // re-seeded by the surface's noteLoaded on the new path's load.
  useEffect(() => {
    recentlyWrittenRef.current.clear()
    lastSeenDiskRef.current = ''
    setExternalConflict(null)
  }, [path])

  const beforeSave = useCallback(async (body: string): Promise<'proceed' | 'conflict'> => {
    const o = optsRef.current
    let diskBody: string
    let rawText: string
    try {
      const res = await window.electron.files.read(o.path)
      rawText = decodeUtf8(res.bytes)
      diskBody = o.readDiskBody(rawText)
    } catch {
      // Can't read disk — register the echo and let the write attempt proceed.
      trackWritten(body)
      return 'proceed'
    }
    // Byte-exact: disk hasn't drifted since we last touched it.
    if (diskBody === lastSeenDiskRef.current) { trackWritten(body); return 'proceed' }
    // Content-preserving external touch (cosmetic) — safe to overwrite.
    if (o.echoEqual(diskBody, serializedBaselineRef.current)) { trackWritten(body); return 'proceed' }
    // Real external drift since our baseline → route through the banner.
    void writeConflictLog({
      ts: new Date().toISOString(), path: o.path, trigger: 'save-pre-reconcile',
      surface: o.surface, diskLength: diskBody.length,
      baselineLength: serializedBaselineRef.current.length, liveLength: null,
      recentlyWrittenSize: recentlyWrittenRef.current.size,
      diskHead: diskBody.slice(0, 80), baselineHead: serializedBaselineRef.current.slice(0, 80),
      diskTail: diskBody.slice(-80), baselineTail: serializedBaselineRef.current.slice(-80),
      firstDiffOffset: computeFirstDiffOffset(diskBody, serializedBaselineRef.current),
      appVersion: o.appVersion
    })
    setExternalConflict({ diskBody, rawText })
    return 'conflict'
  }, [trackWritten])

  const resolveReload = useCallback(() => {
    const o = optsRef.current
    setExternalConflict((c) => {
      if (!c) return null
      o.applyReload(c.diskBody, c.rawText)
      advanceAfterReload(c.diskBody)
      o.onDirtyChange?.(false)
      return null
    })
  }, [advanceAfterReload])

  const resolveKeepMine = useCallback(() => {
    const o = optsRef.current
    setExternalConflict((c) => {
      if (!c) return null
      // Advance baselines to the disk version so the immediate save's
      // pre-reconcile passes (byte-exact), then overwrites disk with our buffer.
      serializedBaselineRef.current = c.diskBody
      lastSeenDiskRef.current = c.diskBody
      o.onDirtyChange?.(true)
      o.triggerSave()
      return null
    })
  }, [])

  // ENH-202 — "View diff" on the dirty-buffer banner. The surface has already
  // swapped the disk content into the editor as accept/rejectable tracked
  // changes; we just clear the banner and advance both baselines to the disk
  // body (mirrors resolveKeepMine's baseline move, minus the save) so the
  // eventual accept-all save is a byte-exact no-op and reject-all overwrites
  // disk cleanly.
  const dismissConflict = useCallback((diskBody: string) => {
    serializedBaselineRef.current = diskBody
    lastSeenDiskRef.current = diskBody
    setExternalConflict(null)
  }, [])

  const noteSaved = useCallback((body: string) => {
    serializedBaselineRef.current = body
    lastSeenDiskRef.current = body
    trackWritten(body)
  }, [trackWritten])

  const noteLoaded = useCallback((serializedBaseline: string, diskBody: string) => {
    serializedBaselineRef.current = serializedBaseline
    lastSeenDiskRef.current = diskBody
  }, [])

  const noteDiskWrite = useCallback((diskBody: string) => {
    lastSeenDiskRef.current = diskBody
    trackWritten(diskBody)
  }, [trackWritten])

  const getSerializedBaseline = useCallback(() => serializedBaselineRef.current, [])

  return {
    externalConflict,
    resolveReload,
    resolveKeepMine,
    dismissConflict,
    beforeSave,
    noteSaved,
    noteLoaded,
    noteDiskWrite,
    getSerializedBaseline,
  }
}
