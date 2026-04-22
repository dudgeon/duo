// Convenience hook — wraps the electron PTY IPC API for use in components.
// TerminalPane.tsx uses this directly; extracted here for testability.

import { useEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

interface Options {
  tabId: string
  cwd: string
  isActive: boolean
  term: Terminal | null
  fit: FitAddon | null
}

export function useTerminalIPC({ tabId, cwd, isActive, term, fit }: Options) {
  const startedRef = useRef(false)

  useEffect(() => {
    if (!term || startedRef.current) return
    startedRef.current = true

    const offData = window.electron.pty.onData(tabId, (data) => term.write(data))
    const offExit = window.electron.pty.onExit(tabId, () => {
      term.writeln('\r\n\x1b[2m[process exited]\x1b[0m')
    })

    term.onData((data) => window.electron.pty.write(tabId, data))
    window.electron.pty.create(tabId, undefined, cwd)

    return () => {
      offData()
      offExit()
      window.electron.pty.kill(tabId)
      startedRef.current = false
    }
  }, [tabId, cwd, term])

  useEffect(() => {
    if (!isActive || !fit || !term) return
    const id = requestAnimationFrame(() => {
      fit.fit()
      window.electron.pty.resize(tabId, term.cols, term.rows)
      term.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [isActive, tabId, term, fit])
}
