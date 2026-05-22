// ENH-167 — workspace-as-file. Round-trips a WorkspaceFile envelope
// to / from any path the user picks; the file extension is
// `.duo-workspace` but we don't enforce it on read (a user-renamed
// file should still load).
//
// Schema:
//   {
//     schemaVersion: 1,
//     name: string,
//     savedAt: string (ISO),
//     appVersion: string,
//     state: SessionState (the autosave shape from session-state-service.ts)
//   }
//
// "Workspace" = the user's collection of open terminals + tabs +
// browser pane state. Distinct from "session" which collides with
// Claude session terminology (the agent loop inside a terminal).
// Internal field name `state` reuses the Stage 21c SessionState type
// because the workspace IS the autosave shape.
//
// Atomic write — tmp + rename, mirrors session-state-service.ts so a
// crash mid-save can't leave a half-written file the user opens later.

import * as fs from 'fs/promises'
import * as path from 'path'
import type { WorkspaceFile, SessionState } from '../shared/types'
import { EMPTY_SESSION_STATE } from '../shared/types'

const SCHEMA_VERSION = 1

export class WorkspaceFileService {
  /** Write a WorkspaceFile to `filePath`. Atomic via tmp + rename. */
  async save(filePath: string, name: string, state: SessionState, appVersion: string): Promise<void> {
    const envelope: WorkspaceFile = {
      schemaVersion: SCHEMA_VERSION,
      name,
      savedAt: new Date().toISOString(),
      appVersion,
      state
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = filePath + '.duo.tmp'
    await fs.writeFile(tmp, JSON.stringify(envelope, null, 2) + '\n', 'utf8')
    await fs.rename(tmp, filePath)
  }

  /** Read a WorkspaceFile from `filePath`. Defensive validation — a
   *  malformed file returns null so the caller can surface a clean
   *  error message instead of crashing the menu click. */
  async load(filePath: string): Promise<WorkspaceFile | null> {
    let raw: string
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch {
      return null
    }
    let parsed: Partial<WorkspaceFile>
    try {
      parsed = JSON.parse(raw) as Partial<WorkspaceFile>
    } catch {
      return null
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    if (typeof parsed.name !== 'string') return null
    if (typeof parsed.savedAt !== 'string') return null
    if (typeof parsed.appVersion !== 'string') return null
    if (!parsed.state || typeof parsed.state !== 'object') return null

    // Sanitize the inner state using the same defensive defaults the
    // boot-time loader uses. Any malformed field falls through to the
    // empty value rather than poisoning the whole envelope.
    const s = parsed.state as Partial<SessionState>
    const sanitizedState: SessionState = {
      version: 1,
      savedAt: typeof s.savedAt === 'string' ? s.savedAt : '',
      appVersion: typeof s.appVersion === 'string' ? s.appVersion : '',
      terminals: Array.isArray(s.terminals)
        ? s.terminals.filter(
            (t): t is SessionState['terminals'][number] =>
              !!t &&
              typeof t.cwd === 'string' &&
              (t.kind === 'shell' || t.kind === 'claude') &&
              typeof t.title === 'string'
          )
        : [],
      activeTerminalIndex: Number.isInteger(s.activeTerminalIndex) ? (s.activeTerminalIndex as number) : -1,
      browserTabs: Array.isArray(s.browserTabs)
        ? s.browserTabs.filter(
            (b): b is SessionState['browserTabs'][number] =>
              !!b && typeof b.url === 'string' && typeof b.title === 'string'
          )
        : [],
      activeBrowserIndex: Number.isInteger(s.activeBrowserIndex) ? (s.activeBrowserIndex as number) : -1,
      fileTabs: Array.isArray(s.fileTabs)
        ? s.fileTabs.filter(
            (f): f is SessionState['fileTabs'][number] =>
              !!f && typeof f.path === 'string' && typeof f.type === 'string' && typeof f.mime === 'string'
          )
        : [],
      activeWorking: s.activeWorking && typeof s.activeWorking === 'object'
        ? (s.activeWorking.kind === 'browser' && Number.isInteger(s.activeWorking.index)
            ? { kind: 'browser', index: s.activeWorking.index }
            : s.activeWorking.kind === 'file' && typeof s.activeWorking.path === 'string'
              ? { kind: 'file', path: s.activeWorking.path }
              : null)
        : null,
      navigatorPath: typeof s.navigatorPath === 'string' ? s.navigatorPath : '',
      aux: s.aux && Array.isArray(s.aux.paths)
        ? {
            paths: s.aux.paths.filter((p): p is string => typeof p === 'string'),
            activeIndex: Number.isInteger(s.aux.activeIndex) ? s.aux.activeIndex : 0,
            splitPct: typeof s.aux.splitPct === 'number' && Number.isFinite(s.aux.splitPct)
              ? Math.min(Math.max(s.aux.splitPct, 0.20), 0.80)
              : 0.5
          }
        : null
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      name: parsed.name,
      savedAt: parsed.savedAt,
      appVersion: parsed.appVersion,
      state: sanitizedState
    }
  }

  /** Empty SessionState for "new" callers — exposed so the menu's
   *  File > New Workspace can clear the workspace without manually
   *  constructing the shape. */
  emptyState(): SessionState {
    return { ...EMPTY_SESSION_STATE }
  }
}
