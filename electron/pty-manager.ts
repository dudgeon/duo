import * as pty from 'node-pty'
import { app, type WebContents } from 'electron'
import { DEFAULT_SHELL, DEFAULT_CWD, TERMINAL_DEFAULTS, SOCKET_PATH } from './constants'
import { IPC } from '../shared/types'

interface Session {
  id: string
  pty: pty.IPty
}

export class PtyManager {
  private sessions = new Map<string, Session>()
  private webContents: WebContents | null = null

  setWebContents(wc: WebContents): void {
    this.webContents = wc
  }

  create(id: string, shell: string = DEFAULT_SHELL, cwd: string = DEFAULT_CWD): void {
    if (this.sessions.has(id)) return

    // Stage 18 Phase 18a — env signals (D1–D3).
    // Every PTY Duo spawns is tagged so child processes (Claude Code,
    // shell prompts, the `duo` CLI) can detect "I'm in Duo" without
    // heuristics. See docs/prd/stage-18-duo-detection.md § Layer 1.
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: TERMINAL_DEFAULTS.cols,
      rows: TERMINAL_DEFAULTS.rows,
      cwd,
      env: {
        ...(process.env as Record<string, string>),
        DUO_SESSION: '1',
        DUO_SOCKET: SOCKET_PATH,
        DUO_VERSION: app.getVersion(),
        TERM_PROGRAM: 'Duo'
      }
    })

    ptyProcess.onData((data) => {
      this.webContents?.send(IPC.PTY_DATA(id), data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.webContents?.send(IPC.PTY_EXIT(id), exitCode)
      this.sessions.delete(id)
    })

    this.sessions.set(id, { id, pty: ptyProcess })
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session) {
      session.pty.kill()
      this.sessions.delete(id)
    }
  }

  dispose(): void {
    for (const { pty: p } of this.sessions.values()) {
      p.kill()
    }
    this.sessions.clear()
  }
}
