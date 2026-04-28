/**
 * window.electron shim for Duo Web.
 *
 * Implements the full ElectronAPI surface from `shared/types.ts` against
 * a single WebSocket back to the daemon. The shim's job is purely
 * transport translation:
 *
 *   ipcRenderer.invoke(channel, args) → wire request/response
 *   ipcRenderer.send(channel, args)   → wire event (no reply)
 *   ipcRenderer.on(channel, cb)       → register a listener; the wire
 *                                       dispatcher fans out events on
 *                                       the matching channel
 *
 * The renderer code (`renderer/`) sees the same `window.electron`
 * surface it's used to. No upstream changes needed.
 */

import type {
  ElectronAPI,
  FileChangeEvent,
  FileWatchPush,
  FileReadResult,
  IPC as IPCType
} from '../../../shared/types'
import { IPC } from '../../../shared/types'
import { isWireMessage, type WireMessage } from '../../shared/protocol'

type Listener = (payload: unknown) => void

interface BootstrapResponse {
  token: string
  version: string
  runtime: 'web'
}

/**
 * Connection state. Held module-scoped — the shim is a singleton.
 */
let socket: WebSocket | null = null
let connected = false
let env: { HOME: string; SHELL: string } = { HOME: '', SHELL: '/bin/zsh' }
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<Listener>>()
const queue: WireMessage[] = []
let connectedResolve: (() => void) | null = null
const connectedPromise = new Promise<void>((resolve) => {
  connectedResolve = resolve
})

/** Public: wait until the shim is fully connected + auth'd. */
export function whenConnected(): Promise<void> {
  return connectedPromise
}

export function getEnv(): { HOME: string; SHELL: string } {
  return env
}

export async function connect(): Promise<void> {
  // Bootstrap: ask the daemon for our token + runtime info. Same-origin,
  // so this lands as a simple fetch.
  const res = await fetch('/api/bootstrap', { credentials: 'omit' })
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`)
  const boot = (await res.json()) as BootstrapResponse

  const wsUrl =
    (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/renderer'
  socket = new WebSocket(wsUrl)

  socket.onopen = () => {
    socket?.send(JSON.stringify({ kind: 'auth', token: boot.token } satisfies WireMessage))
  }

  socket.onmessage = (e) => {
    let msg: WireMessage
    try {
      const parsed = JSON.parse(typeof e.data === 'string' ? e.data : '')
      if (!isWireMessage(parsed)) return
      msg = parsed
    } catch {
      return
    }
    if (msg.kind === 'auth-ok') {
      connected = true
      env = msg.env
      // Drain queue.
      while (queue.length > 0) {
        const m = queue.shift()!
        socket?.send(JSON.stringify(m))
      }
      connectedResolve?.()
      return
    }
    if (msg.kind === 'response') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error))
      return
    }
    if (msg.kind === 'event') {
      const set = listeners.get(msg.channel)
      if (set) for (const cb of set) cb(msg.payload)
      return
    }
  }

  socket.onclose = () => {
    connected = false
    socket = null
    for (const p of pending.values()) p.reject(new Error('socket closed'))
    pending.clear()
  }
}

function sendWire(msg: WireMessage): void {
  if (connected && socket) socket.send(JSON.stringify(msg))
  else queue.push(msg)
}

let nextId = 1
function invoke<T = unknown>(channel: string, payload: unknown = {}): Promise<T> {
  const id = `r${nextId++}`
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject })
    sendWire({ kind: 'request', id, channel, payload })
  })
}

function emit(channel: string, payload: unknown = {}): void {
  sendWire({ kind: 'event', channel, payload })
}

function on(channel: string, cb: Listener): () => void {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (set!.size === 0) listeners.delete(channel)
  }
}

/** Re-decode `{ __bytesB64: "..." }` shapes the daemon emits in place
 *  of Uint8Array. Handles `files:read` whose serialized form is
 *  `{ bytesB64, mime, size, mtimeMs }`. */
function decodeFileRead(raw: unknown): FileReadResult {
  const r = raw as {
    bytesB64: string
    mime: string
    size: number
    mtimeMs: number
  }
  const bin = atob(r.bytesB64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime: r.mime, size: r.size, mtimeMs: r.mtimeMs }
}

function encodeBytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

/** Build the full ElectronAPI from the channel constants in
 *  `shared/types.ts`. We touch every method on every namespace so
 *  the renderer's `window.electron.*` accesses don't crash. Some
 *  surfaces are stubbed (browser pane is dropped in the web build). */
export function buildElectronApi(): ElectronAPI {
  const noopUnsub = () => {}
  return {
    env,
    pty: {
      create: (id, shell, cwd) => invoke<void>(IPC.PTY_CREATE, { id, shell, cwd }),
      write: (id, data) => invoke<void>(IPC.PTY_WRITE, { id, data }),
      resize: (id, cols, rows) => invoke<void>(IPC.PTY_RESIZE, { id, cols, rows }),
      kill: (id) => invoke<void>(IPC.PTY_KILL, { id }),
      onData: (id, cb) => on(IPC.PTY_DATA(id), (data) => cb(data as string)),
      onExit: (id, cb) =>
        on(IPC.PTY_EXIT(id), (code) => cb(code as number))
    },
    browser: {
      // The web build drops the embedded browser; methods resolve to
      // safe stubs so renderer code that touches them doesn't blow up.
      navigate: async () => ({ ok: false, url: '', title: '' }),
      back: () => undefined,
      forward: () => undefined,
      reload: () => undefined,
      setBounds: () => undefined,
      getState: async () => ({
        url: '',
        title: '',
        canGoBack: false,
        canGoForward: false,
        isLoading: false
      }),
      getTabs: async () => [],
      addTab: async () => ({ ok: false, id: -1, url: '', title: '' }),
      switchTab: async () => ({ ok: false, error: 'web mode: no embedded browser' }),
      closeTab: async () => ({ ok: false, error: 'web mode: no embedded browser' }),
      focusActive: () => undefined,
      onStateChange: () => noopUnsub,
      onTabsChange: () => noopUnsub,
      onSelection: () => noopUnsub
    },
    files: {
      list: (p) => invoke(IPC.FILES_LIST, { path: p }),
      read: async (p) => decodeFileRead(await invoke(IPC.FILES_READ, { path: p })),
      write: (p, bytes) =>
        invoke(IPC.FILES_WRITE, { path: p, bytesB64: encodeBytes(bytes) }),
      openExternal: (p) => invoke<void>(IPC.FILES_OPEN_EXTERNAL, { path: p }),
      revealInFinder: (p) => invoke<void>(IPC.FILES_REVEAL_IN_FINDER, { path: p }),
      getHtmlMeta: (p) => invoke(IPC.FILES_GET_HTML_META, { path: p }),
      trash: (p) => invoke<void>(IPC.FILES_TRASH, { path: p }),
      rename: (oldPath, newPath) => invoke<void>(IPC.FILES_RENAME, { oldPath, newPath }),
      watch: async (paths, cb) => {
        const id = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const off = on(IPC.FILES_CHANGED, (push) => {
          const p = push as FileWatchPush
          if (p.id === id) cb(p.event)
        })
        await invoke<void>(IPC.FILES_WATCH_START, { id, paths })
        return async () => {
          off()
          await invoke<void>(IPC.FILES_WATCH_STOP, { id })
        }
      },
      updateWatchPaths: (id, paths) =>
        invoke<void>(IPC.FILES_WATCH_UPDATE, { id, paths })
    },
    nav: {
      pushState: (snapshot) => emit(IPC.NAV_STATE_PUSH, snapshot),
      onReveal: (cb) => on(IPC.NAV_REVEAL, (path) => cb(path as string)),
      onView: (cb) => on(IPC.NAV_VIEW, (path) => cb(path as string)),
      onEdit: (cb) => on(IPC.NAV_EDIT, (path) => cb(path as string))
    },
    editor: {
      pushSelection: (snap) => emit(IPC.EDITOR_SELECTION_PUSH, { snapshot: snap }),
      onDocWrite: (cb) => on(IPC.EDITOR_DOC_WRITE, (req) => cb(req as never)),
      replyDocWrite: (result) => emit(IPC.EDITOR_DOC_WRITE_RESULT, result),
      onDocRead: (cb) => on(IPC.EDITOR_DOC_READ, (req) => cb(req as never)),
      replyDocRead: (result) => emit(IPC.EDITOR_DOC_READ_RESULT, result)
    },
    canvas: {
      onHtmlOp: (cb) => on(IPC.CANVAS_HTML_OP, (req) => cb(req as never)),
      replyHtmlOp: (result) => emit(IPC.CANVAS_HTML_OP_RESULT, result),
      pushSelection: (snap) => emit(IPC.CANVAS_SELECTION_PUSH, { snapshot: snap }),
      onHtmlComment: (cb) => on(IPC.CANVAS_HTML_COMMENT, (req) => cb(req as never)),
      replyHtmlComment: (result) => emit(IPC.CANVAS_HTML_COMMENT_RESULT, result),
      onHtmlCommentsList: (cb) => on(IPC.CANVAS_HTML_COMMENTS_LIST, (req) => cb(req as never)),
      replyHtmlCommentsList: (result) => emit(IPC.CANVAS_HTML_COMMENTS_LIST_RESULT, result)
    },
    cozy: {
      onToggle: (cb) => on(IPC.COZY_TOGGLE, () => cb()),
      pushState: (cozy) => emit(IPC.COZY_STATE_PUSH, cozy)
    },
    theme: {
      pushState: (snap) => emit(IPC.THEME_STATE_PUSH, snap),
      onSet: (cb) => on(IPC.THEME_SET, (mode) => cb(mode as never))
    },
    selectionFormat: {
      pushState: (snap) => emit(IPC.SELECTION_FORMAT_STATE_PUSH, snap),
      onSet: (cb) => on(IPC.SELECTION_FORMAT_SET, (fmt) => cb(fmt as never))
    },
    terminal: {
      pushActiveId: (id) => emit(IPC.TERMINAL_ACTIVE_PUSH, { id }),
      claudeOnPath: () => invoke<boolean>('terminal:claude-on-path'),
      onNewTabRequest: (cb) => on(IPC.NEW_TAB_REQUEST, (req) => cb(req as never)),
      replyNewTab: (result) => emit(IPC.NEW_TAB_RESULT, result)
    },
    keyboard: {
      onBrowserKey: () => noopUnsub,
      onPaneToggleFocus: (cb) => on(IPC.PANE_TOGGLE_FOCUS, () => cb())
    },
    pins: {
      list: () => invoke(IPC.PINS_LIST),
      toggle: (entry) => invoke(IPC.PINS_TOGGLE, entry as unknown as Record<string, unknown>)
    },
    navPins: {
      list: () => invoke(IPC.NAV_PINS_LIST),
      toggle: (entry) =>
        invoke(IPC.NAV_PINS_TOGGLE, entry as unknown as Record<string, unknown>)
    },
    sessionState: {
      load: () => invoke(IPC.SESSION_STATE_LOAD),
      save: (state) => invoke<void>(IPC.SESSION_STATE_SAVE, state as unknown as Record<string, unknown>)
    },
    install: {
      status: () => invoke(IPC.INSTALL_STATUS),
      run: () => invoke(IPC.INSTALL_RUN)
    },
    update: {
      check: () => invoke(IPC.UPDATE_CHECK)
    },
    external: {
      onRedirected: (cb) => on(IPC.EXTERNAL_REDIRECTED, (push) => cb(push as never))
    },
    appMenu: {
      onPastePlainRequest: (cb) => on(IPC.PASTE_PLAIN_REQUEST, () => cb())
    }
  }
}

// Avoid "unused import" warning — re-export the IPC type for callers.
export type { IPCType }
