// @vitest-environment jsdom
//
// ENH-195 A6 — the regression net for the editor↔disk reconciliation logic
// that the BUG-085 → BUG-166 conflict arc kept breaking (~11 bugs, zero CI
// coverage before this). Tests the extracted `useDiskReconciliation` hook
// directly via renderHook, asserting OBSERVABLE OUTCOMES (which injected
// callback fired, and the banner state) — never private refs — so they pin
// behavior, not implementation.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiskReconciliation, type DiskReconciliationOptions } from './useDiskReconciliation'
import { createFilesMock, installWindowElectron } from './__fixtures__/electronFilesMock'
import { normalizeForEchoCompare } from '../utils/conflictDiagnostic'
import { normalize as normalizeDuoHtml, externalStrippedDuoIds } from '../../core/html/duo-normalize'

const PATH = '/tmp/recon-test.md'

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** Build a markdown-surface hook harness. `live` is mutable so applyReload can
 *  simulate the editor adopting the reloaded content (keeping serialize() honest). */
function markdownHarness(baseline: string) {
  const files = createFilesMock()
  files.setDiskBytes(PATH, baseline)
  const restore = installWindowElectron(files.api)
  const state = { live: baseline }
  const applyReload = vi.fn((db: string) => { state.live = db })
  const onDirtyChange = vi.fn()
  const triggerSave = vi.fn()

  const opts: DiskReconciliationOptions = {
    path: PATH, isNew: false, surface: 'markdown', ready: false,
    serialize: () => state.live,
    applyReload,
    readDiskBody: (s) => s,
    isDirty: (live, base) => live !== base,
    echoEqual: (a, b) => normalizeForEchoCompare(a) === normalizeForEchoCompare(b),
    onDirtyChange,
    rebaselineAfterReload: true,
    triggerSave,
    appVersion: '0.0.0-test',
  }
  return { files, restore, state, applyReload, onDirtyChange, triggerSave, opts }
}

/** Mount + seed the baseline + flip ready=true so the watcher subscribes and
 *  its catch-up read settles to a no-op. Returns the renderHook result. */
async function mountReady(opts: DiskReconciliationOptions, serializedBaseline: string, diskBody: string) {
  const view = renderHook((p: DiskReconciliationOptions) => useDiskReconciliation(p), { initialProps: opts })
  act(() => { view.result.current.noteLoaded(serializedBaseline, diskBody) })
  view.rerender({ ...opts, ready: true })
  await flush()
  return view
}

afterEach(() => { vi.restoreAllMocks() })

describe('useDiskReconciliation — markdown', () => {
  it('clean buffer + real external rewrite → silent reload, no banner', async () => {
    const h = markdownHarness('alpha')
    const view = await mountReady(h.opts, 'alpha', 'alpha')
    h.files.setDiskBytes(PATH, 'alpha BETA added externally')
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(h.applyReload).toHaveBeenCalledWith('alpha BETA added externally', 'alpha BETA added externally')
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  it('dirty buffer + external write → conflict banner (D4 kept)', async () => {
    const h = markdownHarness('alpha')
    const view = await mountReady(h.opts, 'alpha', 'alpha')
    act(() => { h.state.live = 'alpha LOCAL unsaved edit' }) // make it dirty
    h.files.setDiskBytes(PATH, 'alpha REMOTE edit')
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(view.result.current.externalConflict).toEqual({ diskBody: 'alpha REMOTE edit', rawText: 'alpha REMOTE edit' })
    expect(h.applyReload).not.toHaveBeenCalled()
    h.restore()
  })

  it('first-save TipTap round-trip artifact (soft-break) → NO banner via byte-exact (BUG-166)', async () => {
    // Loaded: disk has a soft-break; the serialized view collapsed it to a space.
    const h = markdownHarness('line one line two')
    h.files.setDiskBytes(PATH, 'line one\nline two') // disk keeps the soft-break form
    const view = await mountReady(h.opts, 'line one line two', 'line one\nline two')
    // Disk is unchanged (still the soft-break form). chokidar fires spuriously.
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(h.applyReload).not.toHaveBeenCalled()         // stage-1 byte-exact short-circuit
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  it('D3 byte-faithful: soft-break-only external edit on a CLEAN buffer → reloads (not swallowed)', async () => {
    const h = markdownHarness('word1 word2')
    const view = await mountReady(h.opts, 'word1 word2', 'word1 word2')
    // External editor changes the space to a soft-break: normalize-EQUAL but byte-different.
    h.files.setDiskBytes(PATH, 'word1\nword2')
    await act(async () => { h.files.pushChange(PATH); await flush() })
    // The whole point of D3: disk bytes win on a clean buffer.
    expect(h.applyReload).toHaveBeenCalledWith('word1\nword2', 'word1\nword2')
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  it('rapid double-save echo (stale event for an earlier body) → no banner, no reload (BUG-099)', async () => {
    const h = markdownHarness('bodyA')
    const view = await mountReady(h.opts, 'bodyA', 'bodyA')
    // Two saves advance the byte-exact ref to bodyB; both bodies are in the echo set.
    act(() => { view.result.current.noteSaved('bodyA') })
    act(() => { view.result.current.noteSaved('bodyB') })
    // A stale chokidar event for the earlier bodyA arrives.
    h.files.setDiskBytes(PATH, 'bodyA')
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(h.applyReload).not.toHaveBeenCalled()
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  it('beforeSave returns "conflict" when disk drifted since baseline', async () => {
    const h = markdownHarness('alpha')
    const view = await mountReady(h.opts, 'alpha', 'alpha')
    h.files.setDiskBytes(PATH, 'alpha drifted externally')
    let verdict: 'proceed' | 'conflict' = 'proceed'
    await act(async () => { verdict = await view.result.current.beforeSave('alpha my new body') })
    expect(verdict).toBe('conflict')
    expect(view.result.current.externalConflict).toEqual({ diskBody: 'alpha drifted externally', rawText: 'alpha drifted externally' })
    h.restore()
  })

  it('beforeSave returns "proceed" when disk is unchanged (byte-exact)', async () => {
    const h = markdownHarness('alpha')
    const view = await mountReady(h.opts, 'alpha', 'alpha')
    let verdict: 'proceed' | 'conflict' = 'conflict'
    await act(async () => { verdict = await view.result.current.beforeSave('alpha edited') })
    expect(verdict).toBe('proceed')
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })
})

describe('useDiskReconciliation — canvas (Q2 anchor-loss)', () => {
  function canvasHarness(baseline: string) {
    const files = createFilesMock()
    files.setDiskBytes(PATH, baseline)
    const restore = installWindowElectron(files.api)
    const state = { live: baseline }
    const applyReload = vi.fn((db: string) => { state.live = db })
    const opts: DiskReconciliationOptions = {
      path: PATH, isNew: false, surface: 'canvas', ready: false,
      serialize: () => state.live,
      applyReload,
      readDiskBody: (s) => s,
      isDirty: (live, base) => live !== '' && normalizeDuoHtml(live) !== normalizeDuoHtml(base),
      echoEqual: (a, b) => normalizeDuoHtml(a) === normalizeDuoHtml(b),
      shouldBannerOnClean: (base, disk) => externalStrippedDuoIds(base, disk),
      rebaselineAfterReload: false,
      triggerSave: () => {},
      appVersion: '0.0.0-test',
    }
    return { files, restore, state, applyReload, opts }
  }

  it('external write strips data-duo-id on a clean buffer → banner (BUG-125-v2 Q2)', async () => {
    const base = '<p data-duo-id="n1">hi</p>'
    const h = canvasHarness(base)
    const view = await mountReady(h.opts, base, base)
    h.files.setDiskBytes(PATH, '<p>hi</p>') // anchors dropped
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(view.result.current.externalConflict).not.toBeNull()
    expect(h.applyReload).not.toHaveBeenCalled()
    h.restore()
  })

  it('external write changes only data-duo-* on a clean buffer → silent reload, no banner', async () => {
    const base = '<p data-duo-id="n1">hi</p>'
    const h = canvasHarness(base)
    const view = await mountReady(h.opts, base, base)
    // Same id kept; a cosmetic data-duo-* attr added → normalize-equal, no anchor loss.
    h.files.setDiskBytes(PATH, '<p data-duo-id="n1" data-duo-x="z">hi</p>')
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(h.applyReload).toHaveBeenCalled()
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  // ENH-195 v0.9.0 — the canvas clean-write false-positive regression. The two
  // tests above seed serialized + disk baselines IDENTICALLY (base, base), which
  // structurally hid this bug. Production seeds them DIVERGENT: handleReady runs
  // recon.noteLoaded(initialSerialized, lastSavedRef.current) where
  // initialSerialized is the ID-INJECTED serialized live DOM but lastSavedRef is
  // the RAW disk HTML that lacks those injected ids (PageTab.tsx:909). These two
  // tests pin the disk-vs-disk semantics: banner iff the WRITE removed ids that
  // were ON DISK — not ids Duo injected in memory.
  it('clean buffer + external CONTENT edit, disk never carried injected ids → silent reload, NO banner (v0.9.0 false-positive)', async () => {
    // serialize() (live DOM) carries an auto-injected id the on-disk bytes never had.
    const h = canvasHarness('<p data-duo-id="n1">hi</p>')
    h.files.setDiskBytes(PATH, '<p>hi</p>')                       // disk: no ids
    // Divergent seed, faithful to PageTab.tsx:909 (serialized-with-id, disk-without-id).
    const view = await mountReady(h.opts, '<p data-duo-id="n1">hi</p>', '<p>hi</p>')
    h.files.setDiskBytes(PATH, '<p>hi there</p>')                 // external content edit, still no ids
    await act(async () => { h.files.pushChange(PATH); await flush() })
    // FAILS on the old code (externalStrippedDuoIds(serialized-with-id, disk-no-id) → banner);
    // PASSES with the fix (externalStrippedDuoIds(lastSeenDisk='<p>hi</p>', …) → 0 ids → reload).
    expect(h.applyReload).toHaveBeenCalledWith('<p>hi there</p>', '<p>hi there</p>')
    expect(view.result.current.externalConflict).toBeNull()
    h.restore()
  })

  it('divergent baselines + external write strips a PERSISTED disk id → banner (fix keys off the disk ref, Q2 preserved)', async () => {
    // serialized baseline carries an extra in-memory injected attr; disk carries
    // only the PERSISTED id. Stripping the persisted id must still banner — proving
    // the fix reads lastSeenDiskRef (which holds the persisted id), not a coincidence
    // of the serialized view. (The existing (base,base) test can't show this.)
    const h = canvasHarness('<p data-duo-id="n1" data-duo-x="z">hi</p>')
    h.files.setDiskBytes(PATH, '<p data-duo-id="n1">hi</p>')      // disk: persisted id only
    const view = await mountReady(h.opts, '<p data-duo-id="n1" data-duo-x="z">hi</p>', '<p data-duo-id="n1">hi</p>')
    h.files.setDiskBytes(PATH, '<p>hi</p>')                       // external write strips the persisted id
    await act(async () => { h.files.pushChange(PATH); await flush() })
    expect(view.result.current.externalConflict).not.toBeNull()
    expect(h.applyReload).not.toHaveBeenCalled()
    h.restore()
  })
})
