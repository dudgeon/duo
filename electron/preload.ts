import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'
import type { ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  env: {
    HOME: process.env.HOME ?? '',
    SHELL: process.env.SHELL ?? '/bin/zsh'
  },

  pty: {
    create: (id, shell?, cwd?) =>
      ipcRenderer.invoke(IPC.PTY_CREATE, { id, shell, cwd }),

    write: (id, data) =>
      ipcRenderer.invoke(IPC.PTY_WRITE, { id, data }),

    resize: (id, cols, rows) =>
      ipcRenderer.invoke(IPC.PTY_RESIZE, { id, cols, rows }),

    kill: (id) =>
      ipcRenderer.invoke(IPC.PTY_KILL, { id }),

    onData: (id, cb) => {
      const handler = (_: IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on(IPC.PTY_DATA(id), handler)
      return () => ipcRenderer.removeListener(IPC.PTY_DATA(id), handler)
    },

    onExit: (id, cb) => {
      const handler = (_: IpcRendererEvent, code: number) => cb(code)
      ipcRenderer.once(IPC.PTY_EXIT(id), handler)
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT(id), handler)
    },

    onTitle: (id, cb) => {
      const handler = (_: IpcRendererEvent, title: string) => cb(title)
      ipcRenderer.on(IPC.PTY_TITLE(id), handler)
      return () => ipcRenderer.removeListener(IPC.PTY_TITLE(id), handler)
    }
  },

  browser: {
    navigate: (url) =>
      ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, { url }),

    back: () =>
      ipcRenderer.send(IPC.BROWSER_BACK),

    forward: () =>
      ipcRenderer.send(IPC.BROWSER_FORWARD),

    reload: () =>
      ipcRenderer.send(IPC.BROWSER_RELOAD),

    setBounds: (bounds) =>
      ipcRenderer.send(IPC.BROWSER_BOUNDS, bounds),

    onStateChange: (cb) => {
      const handler = (_: IpcRendererEvent, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.BROWSER_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_STATE, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electron', api)
