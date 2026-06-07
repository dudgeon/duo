// Stage 21c Phase 2 — session state restored across Duo relaunches.
//
// Persists `~/.claude/duo/session-state.json` so closing Duo and
// reopening it picks up where the user left off — terminal tabs at
// the same CWDs, file tabs reopened, browser tabs restored, file
// navigator pointed at the same path.
//
// Closes [issue #24](https://github.com/dudgeon/duo/issues/24).
//
// Schema: ENH-191 P4 moved the on-disk doc from a FLAT single-window
// SessionState (v1) to a `{ version:2, windows: WindowState[] }` envelope
// (`SessionEnvelope` in `shared/types.ts`). A v1 flat doc migrates into a
// one-window envelope on read (core/session-envelope.ts). The renderer IPC
// and `.duo-workspace` file contract stay FLAT v1 SessionState — the envelope
// is purely this file's on-disk shape, so callers still save/load a flat
// per-window state and the service composes/decomposes the envelope.
//
// Concurrency model: a SINGLE serialized writer (the `writing` flag) composes
// the latest state of EVERY live window into one atomic write (tmp + rename,
// unique tmp suffix). The per-window map is NOT keyed by a per-window writing
// flag — that would let two windows' flushes race the shared file (lost
// update). Reads are best-effort — a corrupt or missing file returns
// `EMPTY_SESSION_STATE` so first launch and corrupt-file recovery look
// identical to the renderer.
//
// Storage shape choice: same `~/.claude/duo/` dir as pins.json,
// external-domains.json, priming.md, update-check.json, installed.json.
// That's Duo's "user-visible state lives here" convention; users can
// inspect / reset state from outside the app.
//
// Downgrade safety (NFR-8.2): the v2 doc stamps `version: 2`; an OLD (v1)
// binary's load guard sees `version !== 1` and returns empty — no crash, no
// destructive overwrite. Before the FIRST v2 write, the pre-migration v1 doc
// is copied to `session-state.json.v1.bak` (write-once) so a downgrade can
// recover the prior single-window state by hand.
//
// What survives, what doesn't:
//
// - **Terminal CWDs:** the SPAWN cwd is captured; live `cd` movement
//   inside the shell is NOT tracked (Duo would need a shell-side hook
//   like Starship's prompt-string injection). Restore lands the user
//   back where they started the tab — close enough for v1; full
//   live-cwd tracking is a follow-on.
// - **File tab buffers:** we persist the path + type, NOT the
//   in-memory edited content. Unsaved edits at quit time are LOST.
//   This matches how every other macOS native app handles
//   force-quit; full autosave-recovery is a future enhancement.
// - **Browser scroll / form state:** not captured. `WebContentsView`
//   has no convenient state-snapshot API short of a screenshot.
//   Restore just navigates to the URL fresh.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import type {
  SessionState,
  WindowState,
  WindowBounds,
  ActiveWorkspace,
} from '../shared/types'
import { EMPTY_SESSION_STATE } from '../shared/types'
import { uniqueTmpPath } from './write-queue'
import {
  composeEnvelope,
  readEnvelopeWindows,
  flatToWindowState,
  windowStateToFlat,
  SESSION_ENVELOPE_VERSION,
} from './session-envelope'

const SESSION_DIR = path.join(os.homedir(), '.claude', 'duo')
const SESSION_PATH = path.join(SESSION_DIR, 'session-state.json')

/** Single-flight write coalescing. The renderer can spam saves
 *  during e.g. tab drags; we coalesce all pending writes into one
 *  on-disk update by debouncing in main and discarding intermediate
 *  payloads. The renderer also debounces — this is belt + braces. */
const WRITE_DEBOUNCE_MS = 250

export class SessionStateService {
  // ENH-191 P4 — latest-known restorable state per LIVE window. flush()
  // composes the WHOLE map into one envelope behind the single writer below;
  // the map is NOT cleared on flush (a window persists until it closes — P5
  // adds the explicit-close / restore-by-order orchestration). At N=1 this
  // holds exactly one entry, so the composed envelope round-trips
  // byte-identically to the old flat single-window save.
  private windows = new Map<number, WindowState>()
  // Doc-level meta (savedAt/appVersion live at the envelope level, not
  // per-window). Updated on each save; the latest saver across windows wins.
  private meta: { savedAt: string; appVersion: string } = { savedAt: '', appVersion: '' }
  // A change awaits flush. Replaces the old `pending` payload — the payload
  // now lives in `windows`; this is just the dirty bit the debounce gates on.
  private dirty = false
  private writeTimer: NodeJS.Timeout | null = null
  private writing = false
  // ENH-191 P4 — guards the one-time pre-migration v1 backup (see backupV1Once).
  private v1BackupDone = false
  // ENH-167 v1.2 — optional secondary write hook. Called inside
  // flush() with the same (flat) state that was just written for a
  // window, so the active .duo-session can mirror the autosave
  // (owner-stated: "auto save should continue to function, updating
  // the current session if saved or unsaved"). Hook is optional;
  // null = no mirroring (default).
  private mirrorHook: ((state: SessionState) => Promise<void>) | null = null
  // ENH-177 (Sprint 20 / v0.7.7) — optional pre-persist enrichment.
  // Called inside flush() BEFORE the state is stringified, so the
  // hook can decorate the state (e.g. populate lastClaudeSession on
  // terminals by scanning ~/.claude/projects/). Returns the
  // potentially-enriched state. Failures are logged + the original
  // state is used (best-effort — never block the autosave).
  // ENH-191 P4 — kept FLAT-typed; flush() runs it per-window by round-tripping
  // each WindowState through windowStateToFlat. [N=1 note: the hook's
  // per-window presence context (tabsThatHostedClaude / owner-filtered PTYs)
  // is the sole window's; P5 must thread windowId so window 2's terminals
  // enrich against window 2's presence, not window 1's.]
  private enrichBeforePersistHook: ((state: SessionState) => Promise<SessionState>) | null = null
  // ENH-191 P4 seam 6 (item 8) — resolves a window's LIVE active-workspace
  // pointer at compose time so it persists PER WINDOW in the envelope (the
  // standalone active-workspace.json is a single slot two windows would
  // clobber). Read live from main's WindowContext (no stored copy → no drift,
  // per CLAUDE.md rule 12). null = no resolver set (the WindowState keeps
  // whatever it carried).
  private activeWorkspaceResolver: ((windowId: number) => ActiveWorkspace | null) | null = null

  // ENH-191 P4 — the on-disk paths are injectable (default = the real
  // ~/.claude/duo/session-state.json) so the node-env tests can point the
  // service at an isolated temp dir with REAL fs (no mocking — the actual
  // write/migrate/backup path is exercised). Production constructs
  // `new SessionStateService()` and gets the default.
  private readonly sessionPath: string
  private readonly sessionDir: string
  private readonly v1BakPath: string

  constructor(sessionPath: string = SESSION_PATH) {
    this.sessionPath = sessionPath
    this.sessionDir = path.dirname(sessionPath)
    this.v1BakPath = sessionPath + '.v1.bak'
  }

  setMirrorHook(fn: ((state: SessionState) => Promise<void>) | null): void {
    this.mirrorHook = fn
  }

  setEnrichBeforePersistHook(fn: ((state: SessionState) => Promise<SessionState>) | null): void {
    this.enrichBeforePersistHook = fn
  }

  setActiveWorkspaceResolver(fn: ((windowId: number) => ActiveWorkspace | null) | null): void {
    this.activeWorkspaceResolver = fn
  }

  /** Read the envelope into validated WindowState[] + doc meta. Single read
   *  shared by load() and loadWindows(). Best-effort — a corrupt / missing /
   *  unknown-version file yields [] (caller falls back to empty state). */
  private async readDoc(): Promise<{ windows: WindowState[]; meta: { savedAt: string; appVersion: string } }> {
    try {
      const raw = await fs.readFile(this.sessionPath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      const version = (parsed as { version?: unknown } | null)?.version
      if (version !== 1 && version !== SESSION_ENVELOPE_VERSION) {
        console.warn(`[session-state] schema version mismatch (got ${String(version)}, want ${SESSION_ENVELOPE_VERSION} or 1 to migrate); returning empty state`)
      }
      // readEnvelopeWindows: v2 → windows; v1 → migrate to one-window list;
      // unknown/absent → []. The service still field-validates each window.
      const rawWindows = readEnvelopeWindows(parsed)
      const meta = {
        savedAt: typeof (parsed as { savedAt?: unknown })?.savedAt === 'string' ? (parsed as { savedAt: string }).savedAt : '',
        appVersion: typeof (parsed as { appVersion?: unknown })?.appVersion === 'string' ? (parsed as { appVersion: string }).appVersion : '',
      }
      return { windows: rawWindows.map((w, i) => this.validateWindowState(w, i + 1)), meta }
    } catch (err) {
      // ENOENT on first launch is the normal path; log other errors
      // for diagnosis but don't reject the promise.
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.warn('[session-state] load failed:', (err as Error)?.message ?? err)
      }
      return { windows: [], meta: { savedAt: '', appVersion: '' } }
    }
  }

  /** All persisted windows, field-validated. P5 restore-by-order consumes the
   *  full list; load() (below) returns just the sole/first window flat. */
  async loadWindows(): Promise<WindowState[]> {
    return (await this.readDoc()).windows
  }

  /** Read the persisted state for the sole / first restored window as a flat
   *  v1 SessionState (the renderer + .duo-workspace contract stays flat).
   *  Multi-window restore-by-order is P5; at N=1 windows[0] IS the single
   *  restored window. Best-effort: corrupt / missing file → empty state. */
  async load(): Promise<SessionState> {
    const { windows, meta } = await this.readDoc()
    if (!windows.length) return { ...EMPTY_SESSION_STATE }
    return windowStateToFlat(windows[0], meta)
  }

  /** Schedule a debounced write of `state` for `windowId`. Only the latest
   *  state per window is kept; flush() composes ALL live windows. windowId is
   *  resolved by the caller — event.sender for a renderer save, the sole
   *  window (defaultWindowId) for main-driven workspace flows. */
  save(state: SessionState, windowId: number): void {
    this.windows.set(windowId, flatToWindowState(state, windowId, this.windows.get(windowId)))
    this.meta = { savedAt: state.savedAt, appVersion: state.appVersion }
    this.dirty = true
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS)
  }

  /** Force the pending write to disk now. Call from `app.before-quit`
   *  to ensure the user's last state lands before the process exits.
   *  Composes EVERY live window into one envelope behind the single
   *  serialized writer (never per-window flags — that would race). */
  async flush(): Promise<void> {
    if (this.writing) return // a flush is already in flight; let it complete
    if (!this.dirty) return // nothing changed since the last successful write
    // Empty map can't happen while dirty (dirty is only set by save(), which
    // always inserts a window) — but guard anyway so a stray flush never wipes
    // a freshly-restored-but-not-yet-resaved file with windows:[].
    if (this.windows.size === 0) return

    this.dirty = false
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writing = true

    try {
      // Preserve the pre-migration v1 doc once, before the first v2 overwrite.
      await this.backupV1Once()

      // ENH-177 — run the enrichment hook (if set) per window INSIDE the single
      // flush (never concurrently), round-tripping each WindowState through flat
      // so the existing flat hook (lastClaudeSession decoration) applies. The
      // round-trip preserves windowId/bounds/activeWorkspace (prev = the
      // original window state).
      const composed: WindowState[] = []
      for (const ws of this.windows.values()) {
        let w = ws
        if (this.enrichBeforePersistHook) {
          try {
            const enriched = await this.enrichBeforePersistHook(windowStateToFlat(w, this.meta))
            w = flatToWindowState(enriched, w.windowId, w)
          } catch (err) {
            console.warn('[session-state] enrichBeforePersist hook failed:', (err as Error)?.message ?? err)
          }
        }
        // ENH-191 P4 seam 6 — overlay the LIVE per-window active-workspace
        // pointer (item 8) so it round-trips in the envelope. The resolver is
        // authoritative: a null result means "no/cleared workspace" (NOT "keep
        // the stale value"), so a clear persists correctly.
        if (this.activeWorkspaceResolver) {
          w = { ...w, activeWorkspace: this.activeWorkspaceResolver(w.windowId) }
        }
        composed.push(w)
      }

      const envelope = composeEnvelope(composed, this.meta)

      // Phase H (ENH-191 Cut 0) — unique tmp suffix so two atomic writes
      // (e.g. two Duo processes) never race the same rename target. The
      // `writing` flag above serializes flushes WITHIN this process; the
      // unique tmp covers the cross-process case.
      const tmp = uniqueTmpPath(this.sessionPath, 'tmp')
      try {
        await fs.mkdir(this.sessionDir, { recursive: true })
        await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), 'utf8')
        await fs.rename(tmp, this.sessionPath)
        // ENH-167 v1.2 — mirror the sole/first window's flat state to the
        // active .duo-workspace if one is loaded. [N=1; P5 mirrors
        // per-window-workspace once each window owns its own workspace.]
        if (this.mirrorHook && composed.length) {
          try {
            await this.mirrorHook(windowStateToFlat(composed[0], this.meta))
          } catch (err) {
            console.warn('[session-state] mirror hook failed:', (err as Error)?.message ?? err)
          }
        }
      } catch (err) {
        // Phase H — best-effort cleanup so a failed write doesn't orphan
        // the unique tmp file.
        await fs.rm(tmp, { force: true }).catch(() => {})
        // Persistent failure — log and move on. We don't bubble; the
        // renderer doesn't have a meaningful response to "save failed."
        console.warn('[session-state] save failed:', (err as Error)?.message ?? err)
      }
    } finally {
      this.writing = false
      // If a new save came in during the write, a fresh flush is scheduled by
      // that save()'s own timer; only schedule here if dirty with no timer
      // pending (avoids leaking a second timer).
      if (this.dirty && !this.writeTimer) {
        this.writeTimer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS)
      }
    }
  }

  /** ENH-191 P4 — copy the pre-migration v1 doc to `session-state.json.v1.bak`
   *  exactly once, before the first v2 write overwrites it, so a downgrade can
   *  recover the prior single-window state. Idempotent across restarts (skips
   *  if the backup already exists); a non-v1 / missing file is a no-op. */
  private async backupV1Once(): Promise<void> {
    if (this.v1BackupDone) return
    this.v1BackupDone = true
    try {
      await fs.access(this.v1BakPath)
      return // already backed up in a prior run — true write-once
    } catch { /* no backup yet — fall through */ }
    try {
      const existing = await fs.readFile(this.sessionPath, 'utf8')
      if ((JSON.parse(existing) as { version?: unknown })?.version === 1) {
        await fs.writeFile(this.v1BakPath, existing, 'utf8')
        console.log('[session-state] backed up v1 session to session-state.json.v1.bak before v2 migration')
      }
    } catch { /* no existing file / not v1 / unreadable — nothing to back up */ }
  }

  /** ENH-191 P4 — field-by-field defensive copy of one window's persisted
   *  state. A single bad field shouldn't wipe everything — defaults fill in
   *  for anything missing or wrong-typed. Mirrors the old flat-load validation
   *  plus the per-window windowId / bounds / activeWorkspace fields. */
  private validateWindowState(raw: unknown, fallbackId: number): WindowState {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<WindowState>
    return {
      windowId: typeof r.windowId === 'number' && Number.isInteger(r.windowId) ? r.windowId : fallbackId,
      bounds: this.validateBounds(r.bounds ?? null),
      activeWorkspace: this.validateActiveWorkspace(r.activeWorkspace ?? null),
      terminals: Array.isArray(r.terminals)
        ? r.terminals
            .filter(
              (t) =>
                t &&
                typeof t.cwd === 'string' &&
                (t.kind === 'shell' || t.kind === 'claude') &&
                typeof t.title === 'string',
            )
            // ENH-177 — preserve `lastClaudeSession` shape (or null) when
            // present + valid; drop the field silently otherwise so the
            // load path stays defensive about stored data.
            .map((t) => {
              const s = (t as { lastClaudeSession?: unknown }).lastClaudeSession
              if (
                s &&
                typeof s === 'object' &&
                typeof (s as { id?: unknown }).id === 'string' &&
                typeof (s as { capturedAt?: unknown }).capturedAt === 'number'
              ) {
                return {
                  ...t,
                  lastClaudeSession: { id: (s as { id: string }).id, capturedAt: (s as { capturedAt: number }).capturedAt }
                }
              }
              return t
            })
        : [],
      activeTerminalIndex: Number.isInteger(r.activeTerminalIndex)
        ? (r.activeTerminalIndex as number)
        : -1,
      browserTabs: Array.isArray(r.browserTabs)
        ? r.browserTabs.filter(
            (b) => b && typeof b.url === 'string' && typeof b.title === 'string',
          )
        : [],
      activeBrowserIndex: Number.isInteger(r.activeBrowserIndex)
        ? (r.activeBrowserIndex as number)
        : -1,
      fileTabs: Array.isArray(r.fileTabs)
        ? r.fileTabs.filter(
            (f) =>
              f &&
              typeof f.path === 'string' &&
              typeof f.type === 'string' &&
              typeof f.mime === 'string',
          )
        : [],
      activeWorking: this.validateActiveWorking(r.activeWorking ?? null),
      navigatorPath: typeof r.navigatorPath === 'string' ? r.navigatorPath : '',
      aux: this.validateAux(r.aux ?? null),
    }
  }

  /** ENH-191 P4 — per-window geometry, null unless every coord is finite. */
  private validateBounds(raw: WindowBounds | null | undefined): WindowBounds | null {
    if (!raw || typeof raw !== 'object') return null
    const { x, y, width, height } = raw as WindowBounds
    if ([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return { x, y, width, height }
    }
    return null
  }

  /** ENH-191 P4 — per-window active-workspace pointer (seam 6 populates it).
   *  Defensive: null unless it carries a string `path` + `name`. */
  private validateActiveWorkspace(raw: ActiveWorkspace | null | undefined): ActiveWorkspace | null {
    if (!raw || typeof raw !== 'object') return null
    const w = raw as ActiveWorkspace
    if (typeof w.path === 'string' && typeof w.name === 'string') return w
    return null
  }

  private validateActiveWorking(
    raw: SessionState['activeWorking'],
  ): SessionState['activeWorking'] {
    if (!raw) return null
    if (raw.kind === 'browser' && Number.isInteger(raw.index)) {
      return { kind: 'browser', index: raw.index }
    }
    if (raw.kind === 'file' && typeof raw.path === 'string') {
      return { kind: 'file', path: raw.path }
    }
    return null
  }

  /** Sprint 3 Phase 3c — defensively coerce the optional aux field.
   *  Old saves without the field arrive as null. Bad shapes (non-array
   *  paths, NaN splitPct) coerce to null so a single bad field doesn't
   *  poison the rest of the restore. splitPct is clamped to the divider
   *  drag range [0.20, 0.80] (matches WorkingPane's clamp). */
  private validateAux(
    raw: SessionState['aux'] | null | undefined,
  ): SessionState['aux'] {
    if (!raw) return null
    if (!Array.isArray(raw.paths)) return null
    const paths = raw.paths.filter((p): p is string => typeof p === 'string')
    if (paths.length === 0) return null
    const activeIndex =
      Number.isInteger(raw.activeIndex) && raw.activeIndex >= 0 && raw.activeIndex < paths.length
        ? raw.activeIndex
        : 0
    const rawPct = typeof raw.splitPct === 'number' && Number.isFinite(raw.splitPct) ? raw.splitPct : 0.5
    const splitPct = Math.min(Math.max(rawPct, 0.20), 0.80)
    return { paths, activeIndex, splitPct }
  }
}
