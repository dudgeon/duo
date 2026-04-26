import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/types'
import type {
  ElectronAPI,
  FileChangeEvent,
  FileWatchPush,
  ForwardedKeyEvent,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  DocWriteRequest,
  DocWriteResult,
  DocReadRequest,
  DocReadResult,
  ThemeMode,
  ThemeStateSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot
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

    focusActive: () =>
      ipcRenderer.send(IPC.BROWSER_FOCUS_ACTIVE),

    onStateChange: (cb) => {
      const handler = (_: IpcRendererEvent, state: Parameters<typeof cb>[0]) => cb(state)
      ipcRenderer.on(IPC.BROWSER_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_STATE, handler)
    },

    onTabsChange: (cb) => {
      const handler = (_: IpcRendererEvent, tabs: Parameters<typeof cb>[0]) => cb(tabs)
      ipcRenderer.on(IPC.BROWSER_TABS, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_TABS, handler)
    },

    onSelection: (cb) => {
      const handler = (_: IpcRendererEvent, push: Parameters<typeof cb>[0]) => cb(push)
      ipcRenderer.on(IPC.BROWSER_SELECTION, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_SELECTION, handler)
    }
  },

  files: {
    list: (p) => ipcRenderer.invoke(IPC.FILES_LIST, { path: p }),

    read: (p) => ipcRenderer.invoke(IPC.FILES_READ, { path: p }),

    write: (p, bytes) => ipcRenderer.invoke(IPC.FILES_WRITE, { path: p, bytes }),

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
    },

    onEdit: (cb) => {
      const handler = (_: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(IPC.NAV_EDIT, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_EDIT, handler)
    }
  },

  editor: {
    pushSelection: (snapshot: EditorSelectionSnapshot | null) => {
      ipcRenderer.send(IPC.EDITOR_SELECTION_PUSH, snapshot)
    },

    onDocWrite: (cb) => {
      const handler = (_: IpcRendererEvent, req: DocWriteRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_DOC_WRITE, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_DOC_WRITE, handler)
    },

    replyDocWrite: (result: DocWriteResult) => {
      ipcRenderer.send(IPC.EDITOR_DOC_WRITE_RESULT, result)
    },

    onDocRead: (cb) => {
      const handler = (_: IpcRendererEvent, req: DocReadRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_DOC_READ, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_DOC_READ, handler)
    },

    replyDocRead: (result: DocReadResult) => {
      ipcRenderer.send(IPC.EDITOR_DOC_READ_RESULT, result)
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
  },

  theme: {
    pushState: (snapshot: ThemeStateSnapshot) => {
      ipcRenderer.send(IPC.THEME_STATE_PUSH, snapshot)
    },

    onSet: (cb) => {
      const handler = (_: IpcRendererEvent, mode: ThemeMode) => cb(mode)
      ipcRenderer.on(IPC.THEME_SET, handler)
      return () => ipcRenderer.removeListener(IPC.THEME_SET, handler)
    }
  },

  selectionFormat: {
    pushState: (snapshot: SelectionFormatStateSnapshot) => {
      ipcRenderer.send(IPC.SELECTION_FORMAT_STATE_PUSH, snapshot)
    },

    onSet: (cb) => {
      const handler = (_: IpcRendererEvent, format: SelectionFormat) => cb(format)
      ipcRenderer.on(IPC.SELECTION_FORMAT_SET, handler)
      return () => ipcRenderer.removeListener(IPC.SELECTION_FORMAT_SET, handler)
    }
  },

  terminal: {
    pushActiveId: (id: string | null) => {
      ipcRenderer.send(IPC.TERMINAL_ACTIVE_PUSH, id)
    }
  },

  keyboard: {
    onBrowserKey: (cb) => {
      const handler = (_: IpcRendererEvent, e: ForwardedKeyEvent) => cb(e)
      ipcRenderer.on(IPC.BROWSER_KEY_FORWARD, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_KEY_FORWARD, handler)
    },
    onPaneToggleFocus: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.PANE_TOGGLE_FOCUS, handler)
      return () => ipcRenderer.removeListener(IPC.PANE_TOGGLE_FOCUS, handler)
    }
  }
}

contextBridge.exposeInMainWorld('electron', api)
