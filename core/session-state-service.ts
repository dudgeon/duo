// Stage 21c Phase 2 — session state restored across Duo relaunches.
//
// Persists `~/.claude/duo/session-state.json` so closing Duo and
// reopening it picks up where the user left off — terminal tabs at
// the same CWDs, file tabs reopened, browser tabs restored, file
// navigator pointed at the same path.
//
// Closes [issue #24](https://github.com/dudgeon/duo/issues/24).
//
// Schema (v1) — see `SessionState` in `shared/types.ts`.
//
// Concurrency model: writes are atomic (tmp file + rename, same
// pattern as `pins-service.ts`). Reads are best-effort — a corrupt
// or missing file returns `EMPTY_SESSION_STATE` so first launch and
// corrupt-file recovery look identical to the renderer.
//
// Storage shape choice: same `~/.claude/duo/` dir as pins.json,
// external-domains.json, priming.md, update-check.json, installed.json.
// That's Duo's "user-visible state lives here" convention; users can
// inspect / reset state from outside the app.
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
import type { SessionState } from '../shared/types'
import { EMPTY_SESSION_STATE } from '../shared/types'

const SESSION_DIR = path.join(os.homedir(), '.claude', 'duo')
const SESSION_PATH = path.join(SESSION_DIR, 'session-state.json')
const SCHEMA_VERSION = 1

/** Single-flight write coalescing. The renderer can spam saves
 *  during e.g. tab drags; we coalesce all pending writes into one
 *  on-disk update by debouncing in main and discarding intermediate
 *  payloads. The renderer also debounces — this is belt + braces. */
const WRITE_DEBOUNCE_MS = 250

export class SessionStateService {
  private pending: SessionState | null = null
  private writeTimer: NodeJS.Timeout | null = null
  private writing = false

  /** Read the persisted state. Best-effort: corrupt / missing file
   *  resolves with the empty state so the renderer doesn't crash. */
  async load(): Promise<SessionState> {
    try {
      const raw = await fs.readFile(SESSION_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<SessionState>

      // Defensive validation. Schema bumps would land here as version
      // checks → migration; for v1 we just reject mismatches.
      if (parsed.version !== SCHEMA_VERSION) {
        console.warn(`[session-state] schema version mismatch (got ${parsed.version}, want ${SCHEMA_VERSION}); returning empty state`)
        return { ...EMPTY_SESSION_STATE }
      }

      // Field-by-field defensive copy. A single bad field shouldn't
      // wipe everything — we fill in defaults for anything missing
      // or wrong-typed.
      return {
        version: 1,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
        appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : '',
        terminals: Array.isArray(parsed.terminals)
          ? parsed.terminals.filter(
              (t) =>
                t &&
                typeof t.cwd === 'string' &&
                (t.kind === 'shell' || t.kind === 'claude') &&
                typeof t.title === 'string',
            )
          : [],
        activeTerminalIndex: Number.isInteger(parsed.activeTerminalIndex)
          ? (parsed.activeTerminalIndex as number)
          : -1,
        browserTabs: Array.isArray(parsed.browserTabs)
          ? parsed.browserTabs.filter(
              (b) => b && typeof b.url === 'string' && typeof b.title === 'string',
            )
          : [],
        activeBrowserIndex: Number.isInteger(parsed.activeBrowserIndex)
          ? (parsed.activeBrowserIndex as number)
          : -1,
        fileTabs: Array.isArray(parsed.fileTabs)
          ? parsed.fileTabs.filter(
              (f) =>
                f &&
                typeof f.path === 'string' &&
                typeof f.type === 'string' &&
                typeof f.mime === 'string',
            )
          : [],
        activeWorking: this.validateActiveWorking(parsed.activeWorking ?? null),
        navigatorPath: typeof parsed.navigatorPath === 'string' ? parsed.navigatorPath : '',
      }
    } catch (err) {
      // ENOENT on first launch is the normal path; log other errors
      // for diagnosis but don't reject the promise.
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        console.warn('[session-state] load failed:', (err as Error)?.message ?? err)
      }
      return { ...EMPTY_SESSION_STATE }
    }
  }

  /** Schedule a debounced write of `state`. Only the latest pending
   *  state is kept — older debounced calls are discarded. */
  save(state: SessionState): void {
    this.pending = state
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => void this.flush(), WRITE_DEBOUNCE_MS)
  }

  /** Force the pending write to disk now. Call from `app.before-quit`
   *  to ensure the user's last state lands before the process exits. */
  async flush(): Promise<void> {
    if (this.writing) return // a flush is already in flight; let it complete
    if (!this.pending) return

    const state = this.pending
    this.pending = null
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    this.writing = true

    try {
      await fs.mkdir(SESSION_DIR, { recursive: true })
      const tmp = SESSION_PATH + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
      await fs.rename(tmp, SESSION_PATH)
    } catch (err) {
      // Persistent failure — log and move on. We don't bubble; the
      // renderer doesn't have a meaningful response to "save failed."
      console.warn('[session-state] save failed:', (err as Error)?.message ?? err)
    } finally {
      this.writing = false
      // If a new save came in during the write, schedule another
      // flush so we don't lose it.
      if (this.pending) {
        this.save(this.pending)
      }
    }
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
}
