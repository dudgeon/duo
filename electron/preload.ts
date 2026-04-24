import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'
import type {
  ElectronAPI,
  FileChangeEvent,
  FileWatchPush,
  NavStateSnapshot
} from '../shared/types'

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

    getState: () =>
      ipcRenderer.invoke(IPC.BROWSER_GET_STATE),

    getTabs: () =>
      ipcRenderer.invoke(IPC.BROWSER_GET_TABS),

    addTab: (url) =>
      ipcRenderer.invoke(IPC.BROWSER_ADD_TAB, { url }),

    switchTab: (id) =>
      ipcRenderer.invoke(IPC.BROWSER_SWITCH_TAB, { id }),

    closeTab: (id) =>
      ipcRenderer.invoke(IPC.BROWSER_CLOSE_TAB, { id }),

    onStateChange: (cb) => {
      const handler = (_: IpcRendererEvent, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.BROWSER_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_STATE, handler)
    },

    onTabsChange: (cb) => {
      const handler = (_: IpcRendererEvent, tabs: Parameters<typeof cb>[0]) => cb(tabs)
      ipcRenderer.on(IPC.BROWSER_TABS, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_TABS, handler)
    }
  },

  files: {
    list: (p) => ipcRenderer.invoke(IPC.FILES_LIST, { path: p }),

    read: (p) => ipcRenderer.invoke(IPC.FILES_READ, { path: p }),

    openExternal: (p) => ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL, { path: p }),

    revealInFinder: (p) => ipcRenderer.invoke(IPC.FILES_REVEAL_IN_FINDER, { path: p }),

    watch: async (paths, cb) => {
      // Give every subscription its own id so pushes can be routed back to
      // the caller's callback. The id lives in the renderer; main process
      // just echoes it on each FILES_CHANGED push.
      const id = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const handler = (_: IpcRendererEvent, push: FileWatchPush) => {
        if (push.id === id) cb(push.event)
      }
      ipcRenderer.on(IPC.FILES_CHANGED, handler)
      await ipcRenderer.invoke(IPC.FILES_WATCH_START, { id, paths })
      return async () => {
        ipcRenderer.removeListener(IPC.FILES_CHANGED, handler)
        await ipcRenderer.invoke(IPC.FILES_WATCH_STOP, { id })
      }
    },

    updateWatchPaths: (id, paths) =>
      ipcRenderer.invoke(IPC.FILES_WATCH_UPDATE, { id, paths })
  },

  nav: {
    pushState: (snapshot: NavStateSnapshot) => {
      ipcRenderer.send(IPC.NAV_STATE_PUSH, snapshot)
    },

    onReveal: (cb) => {
      const handler = (_: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(IPC.NAV_REVEAL, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_REVEAL, handler)
    },

    onView: (cb) => {
      const handler = (_: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(IPC.NAV_VIEW, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_VIEW, handler)
    }
  },

  cozy: {
    onToggle: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.COZY_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IPC.COZY_TOGGLE, handler)
    },

    pushState: (cozy: boolean) => {
      ipcRenderer.send(IPC.COZY_STATE_PUSH, cozy)
    }
  }
}

contextBridge.exposeInMainWorld('electron', api)
