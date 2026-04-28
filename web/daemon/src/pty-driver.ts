/**
 * PTY driver for Duo Web.
 *
 * Lifted from `electron/pty-manager.ts` with the WebContents dependency
 * abstracted behind a `Sink` interface so the same code can drive
 * either an Electron renderer (ipc) or a WebSocket client.
 */

import * as pty from 'node-pty'
import { DEFAULT_SHELL, DEFAULT_CWD, TERMINAL_DEFAULTS } from './constants'

export interface PtySink {
  /** Called for each chunk of PTY output. Channel matches the Electron
   *  build's `pty:data:<id>` for shim parity. */
  emit: (channel: string, payload: unknown) => void
}

interface Session {
  id: string
  pty: pty.IPty
}

export class PtyDriver {
  private sessions = new Map<string, Session>()
  private sink: PtySink | null = null

  setSink(sink: PtySink | null): void {
    this.sink = sink
  }

  create(
    id: string,
    shell: string = DEFAULT_SHELL,
    cwd: string = DEFAULT_CWD,
    env: Record<string, string> = {}
  ): void {
    if (this.sessions.has(id)) return

    const merged: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...env,
      // Mirrors Electron build's signal so child processes know they're
      // inside Duo even though the runtime is "web". The CLI reads
      // DUO_PORT_FILE to find the daemon's TCP port.
      DUO_SESSION: '1',
      DUO_RUNTIME: 'web',
      TERM_PROGRAM: 'Duo'
    }
    if (process.env.DUO_PORT_FILE) merged.DUO_PORT_FILE = process.env.DUO_PORT_FILE

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: TERMINAL_DEFAULTS.cols,
      rows: TERMINAL_DEFAULTS.rows,
      cwd,
      env: merged
    })

    ptyProcess.onData((data) => {
      this.sink?.emit(`pty:data:${id}`, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sink?.emit(`pty:exit:${id}`, exitCode)
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
      try {
        p.kill()
      } catch {
        /* already exited */
      }
    }
    this.sessions.clear()
  }
}
