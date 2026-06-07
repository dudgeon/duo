import * as pty from 'node-pty'
import { DEFAULT_SHELL, DEFAULT_CWD, TERMINAL_DEFAULTS, SOCKET_PATH, SHIM_DIR } from './constants'
import { resolveExistingCwd } from './cwd-utils'
import { IPC } from '../shared/types'
import { routeSend, disposeForWindow as disposeSessionsForWindow, listIdsByCwdOwned } from './pty-owner'

interface Session {
  id: string
  pty: pty.IPty
  /** ENH-183 C9 — track cwd so main-side trigger paths (T2/T3) can
   *  match enriched-state terminals back to live tab ids. */
  cwd: string
  /** ENH-191 P3-S4 — the window that owns this PTY (whose terminal spawned
   *  it). Routes PTY_DATA/EXIT to the owner (S5), scopes disposeForWindow (S6)
   *  + owner-filters listIdsByCwd (S7). -1 == no resolved owner (falls back to
   *  the sole window). */
  ownerWindowId: number
}

// ENH-191 P3-S5 — minimal window shape for owner-routed sends, redeclared
// locally so this core module imports zero Electron (the WindowRegistry +
// WindowLike live in electron/; main.ts passes resolver closures in).
interface RouteWindow {
  isDestroyed(): boolean
  webContents: { isDestroyed(): boolean; send(channel: string, data: unknown): void }
}

export class PtyManager {
  private sessions = new Map<string, Session>()
  // BUG-191 — ids whose shell has EXITED. `sessions` is deleted on exit
  // (so getPid returns null), which is indistinguishable from a tab whose
  // PTY hasn't spawned yet. Tracking exited ids lets `getLiveness` tell
  // "dead shell" (drop its project tile) from "pending" (keep the launch
  // cwd) — see `getLiveness`.
  private exited = new Set<string>()
  private resolveOwnerWindow: (windowId: number) => RouteWindow | undefined = () => undefined
  private resolveDefaultWindow: () => RouteWindow | undefined = () => undefined

  constructor(private readonly appVersion: string) {}

  // ENH-191 P3-S5 — wire owner-routed sends. resolveOwner maps a session's
  // ownerWindowId to its window; resolveDefault is the sole-window fallback
  // (the cold-start drop guard). Replaces the single app-wide eventSink so
  // PTY_DATA/EXIT land in the OWNING window, not always the default.
  setOwnerRouting(routing: {
    resolveOwner: (windowId: number) => RouteWindow | undefined
    resolveDefault: () => RouteWindow | undefined
  }): void {
    this.resolveOwnerWindow = routing.resolveOwner
    this.resolveDefaultWindow = routing.resolveDefault
  }

  // Route a per-session event to its OWNING window (fallback: the sole window),
  // guarded against a destroyed window/webContents (BUG-190).
  private send(sessionId: string, channel: string, data: unknown): void {
    const target = routeSend(this.sessions, sessionId, this.resolveOwnerWindow, this.resolveDefaultWindow)
    if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send(channel, data)
    }
  }

  create(id: string, shell: string = DEFAULT_SHELL, cwd: string = DEFAULT_CWD, ownerWindowId = -1): void {
    if (this.sessions.has(id)) return
    // A re-create for this id means it's live again, not exited.
    this.exited.delete(id)

    // Stage 18 Phase 18a — env signals (D1–D3).
    // Every PTY Duo spawns is tagged so child processes (Claude Code,
    // shell prompts, the `duo` CLI) can detect "I'm in Duo" without
    // heuristics. See docs/prd/stage-18-duo-detection.md § Layer 1.
    //
    // Stage 19b — prepend SHIM_DIR to PATH so any `claude` invocation
    // inside this PTY hits Duo's wrapper (which calls real-claude with
    // --append-system-prompt pointing at ~/.claude/duo/priming.md).
    // The shim is a no-op pass-through outside Duo (DUO_SESSION unset),
    // so it's safe even if some downstream process strips DUO_SESSION
    // and later sees SHIM_DIR on PATH. Prepending (rather than
    // appending) ensures the shim wins over any user-installed claude
    // higher up the lookup. If the shim hasn't been installed yet
    // (e.g. fresh user before clicking Install), the dir simply
    // doesn't resolve — `claude` falls through to the next PATH entry.
    const userPath = (process.env.PATH ?? '')
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: `${SHIM_DIR}:${userPath}`,
      DUO_SESSION: '1',
      DUO_SOCKET: SOCKET_PATH,
      // ENH-191 P3-S4 — DORMANT window stamp: the owning window's id, set but
      // NOT consumed yet (CLI default-resolution is P5; a reverted CLI ignores it).
      DUO_WINDOW: String(ownerWindowId),
      DUO_VERSION: this.appVersion,
      TERM_PROGRAM: 'Duo'
    }

    // A PTY spawned into a missing cwd makes its child exit immediately —
    // the terminal shows "[process exited]" and never recovers, even on
    // restart, because the saved tab keeps pointing at the dead path.
    // Triggered when the user deletes the directory the terminal is
    // sitting in. Spawn in the nearest surviving directory instead.
    const { cwd: resolvedCwd, substituted } = resolveExistingCwd(cwd, DEFAULT_CWD)

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: TERMINAL_DEFAULTS.cols,
      rows: TERMINAL_DEFAULTS.rows,
      cwd: resolvedCwd,
      env
    })

    ptyProcess.onData((data) => {
      this.send(id, IPC.PTY_DATA(id), data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.send(id, IPC.PTY_EXIT(id), exitCode)
      this.sessions.delete(id)
      this.exited.add(id) // BUG-191 — remember it died (vs never-spawned)
    })

    this.sessions.set(id, { id, pty: ptyProcess, cwd: resolvedCwd, ownerWindowId })

    if (substituted) {
      // Tell the user why the shell didn't open where the tab expected.
      // Sent synchronously before any async shell output, so it lands
      // above the first prompt; the renderer's onData listener is wired
      // before it calls create(), so the message is never dropped.
      //
      // Strip ESC from the interpolated paths first: a path legally
      // containing 0x1b (POSIX permits it) would otherwise subvert the
      // color reset or inject arbitrary terminal sequences.
      const safe = (s: string) => s.replace(/\x1b/g, '?')
      const note = `\x1b[33m[duo] ${safe(cwd)} no longer exists — opened ${safe(resolvedCwd)} instead.\x1b[0m\r\n`
      this.send(id, IPC.PTY_DATA(id), note)
    }
  }

  /** ENH-183 C9 — list live tab ids matching a cwd (in insertion order). Used
   *  by main-side hydration triggers to find the PTY to write `/rename` into for
   *  a given saved-state terminal.
   *  ENH-191 P3-S7 — optionally owner-filtered: the C9 positional cwd→tabId
   *  match must stay within ONE window's tabs (the shared pool interleaves
   *  same-cwd terminals across windows). undefined ownerWindowId ⇒ all owners
   *  (byte-identical to the pre-P3 unfiltered list + insertion order). */
  listIdsByCwd(cwd: string, ownerWindowId?: number): string[] {
    return listIdsByCwdOwned(this.sessions, cwd, ownerWindowId)
  }

  /** ENH-183 C12 — get a tab's cwd from its id. Used by CLI verbs
   *  that take a tabId arg (`duo session hydrate <tabId>`) and need
   *  to resolve the cwd to reach Claude's project storage. */
  getCwd(tabId: string): string | null {
    return this.sessions.get(tabId)?.cwd ?? null
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    // BUG-156 (2026-05-24) — refuse 0×0 or negative resizes. A
    // zero-dimension resize forces the child process (e.g. Claude
    // Code's TUI) to operate on a degenerate terminal and bail
    // out with SIGHUP. Cascade: PTY's child claude sees 0×0 →
    // exits → zsh sees child SIGHUPed → xterm host shows
    // "[process exited]". Surfaced when ENH-183's flex-column
    // wrapper let the xterm host transiently shrink to 0 height
    // during SessionHeader layout reflow; the ResizeObserver
    // path didn't have a size guard. Defense-in-depth: guard the
    // renderer call sites AND this main-side entry point.
    if (cols < 1 || rows < 1) return
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  /** ENH-013 — return the PTY's child process pid for a tab. The
   *  ClaudePresenceProbe walks this pid's descendant tree to detect a
   *  live `claude` process. */
  getPid(id: string): number | null {
    return this.sessions.get(id)?.pty.pid ?? null
  }

  /** BUG-191 — liveness for the project-rail live-cwd batch.
   *   • 'live'    — session exists; safe to lsof its pid for the cwd.
   *   • 'exited'  — the shell process exited; the tab keeps no project
   *                 membership (drops a ghost tile).
   *   • 'unknown' — no session and never recorded as exited (PTY not
   *                 spawned yet, or create failed) → caller falls back to
   *                 the tab's launch cwd rather than dropping its tile. */
  getLiveness(id: string): 'live' | 'exited' | 'unknown' {
    if (this.sessions.has(id)) return 'live'
    if (this.exited.has(id)) return 'exited'
    return 'unknown'
  }

  dispose(): void {
    for (const { pty: p } of this.sessions.values()) {
      p.kill()
    }
    this.sessions.clear()
  }

  /** ENH-191 P3-S6 — kill + delete only the sessions OWNED by `windowId` (the
   *  workspace-swap path: a swap in window A must not nuke window B's terminals).
   *  Does NOT mark ids exited — parity with dispose() (these PTYs are torn down
   *  for replacement, not dead shells; the onExit handler records `exited`). At
   *  N=1 windowId is the sole owner ⇒ this kills the same set dispose() did. */
  disposeForWindow(windowId: number): void {
    disposeSessionsForWindow(this.sessions, windowId)
  }
}
