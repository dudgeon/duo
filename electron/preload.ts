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
  DocGotoRequest,
  DocGotoResult,
  DocFindRequest,
  DocFindResult,
  HtmlOpRequest,
  HtmlOpResult,
  HtmlCommentRequest,
  HtmlCommentResult,
  HtmlCommentsListRequest,
  HtmlCommentsListResult,
  PageSelectionSnapshot,
  ThemeMode,
  ThemeStateSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot,
  WorkingAuxSnapshot,
  NewTabRequest,
  NewTabResult,
  PinEntry,
  NavPinEntry,
  ExternalRedirectedPush,
  SessionState,
  ClaudePresenceState,
  BrowserFindResult
} from '../shared/types'

// app version + dev/prod flag come from main process via
// additionalArguments on the BrowserWindow (set up in main.ts §
// createWindow). Surface in the titlebar so the user can confirm
// which build is live before walking a smoke. Without
// additionalArguments fallback, defaults to '?.?.?' to make the
// missing-wiring case obvious during dev.
function readArg(prefix: string, fallback: string): string {
  const arg = process.argv.find(a => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}
const APP_VERSION = readArg('--duo-app-version=', '?.?.?')
const IS_DEV = readArg('--duo-is-dev=', '0') === '1'
const api: ElectronAPI = {
  env: {
    HOME: process.env.HOME ?? '',
    SHELL: process.env.SHELL ?? '/bin/zsh',
    appVersion: APP_VERSION,
    isDev: IS_DEV
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

    // Phase 3c — bounds for the aux-pinned browser tab. Mirrors
    // setBounds but routes to BrowserManager.setAuxBounds.
    setAuxBounds: (bounds) =>
      ipcRenderer.send(IPC.BROWSER_AUX_BOUNDS, bounds),

    // Phase 3c — pin a browser tab into the aux slot. Returns the
    // pinned tab's url/title so the AuxBrowserSlot header can show
    // them without a second round trip.
    moveTabToAux: (id) =>
      ipcRenderer.invoke(IPC.BROWSER_MOVE_TAB_TO_AUX, id),

    // Phase 3c — release the aux-pinned tab back to the main strip.
    releaseAuxTab: () =>
      ipcRenderer.invoke(IPC.BROWSER_RELEASE_AUX_TAB),

    setOverlayMuted: (muted) =>
      ipcRenderer.send(IPC.BROWSER_OVERLAY_MUTED, { muted }),

    // ENH-028 — find-in-page. Each keystroke / next / prev resends
    // START with the new query. Main streams results back through
    // `onFindResult` so the find bar can display "n / m".
    findStart: (query, options) =>
      ipcRenderer.send(IPC.BROWSER_FIND_START, {
        query,
        findNext: options?.findNext,
        forward: options?.forward
      }),

    findStop: () =>
      ipcRenderer.send(IPC.BROWSER_FIND_STOP),

    onFindResult: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: BrowserFindResult) => cb(payload)
      ipcRenderer.on(IPC.BROWSER_FIND_RESULT, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_FIND_RESULT, handler)
    },

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

    reopenLastClosed: () =>
      ipcRenderer.invoke(IPC.BROWSER_REOPEN_LAST_CLOSED),

    historySuggest: (prefix, limit) =>
      ipcRenderer.invoke(IPC.BROWSER_HISTORY_SUGGEST, { prefix, limit }),

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
    },

    // BUG-006 — in-page pill click from the page-injected Send → Duo
    // button. v2 carries the selection snapshot in the payload (captured
    // synchronously page-side at mousedown time) so the renderer doesn't
    // race with the async selectionchange clearing the cache.
    onSendToDuoClick: (cb) => {
      const handler = (_: IpcRendererEvent, snapshot: Parameters<typeof cb>[0]) => cb(snapshot)
      ipcRenderer.on(IPC.BROWSER_SEND_TO_DUO_CLICK, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_SEND_TO_DUO_CLICK, handler)
    },

    // ENH-094 (Sprint 5) — playground action click in browser pane.
    // Page-side IIFE captures `data-duo-action` clicks; main parses +
    // applies trust gate; we receive the typed PlaygroundAction here
    // and the renderer dispatches via the same handlePlaygroundAction
    // the canvas runtime feeds.
    onPlaygroundAction: (cb) => {
      const handler = (_: IpcRendererEvent, action: Parameters<typeof cb>[0]) => cb(action)
      ipcRenderer.on(IPC.BROWSER_PLAYGROUND_ACTION, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_PLAYGROUND_ACTION, handler)
    }
  },

  files: {
    list: (p) => ipcRenderer.invoke(IPC.FILES_LIST, { path: p }),

    read: (p) => ipcRenderer.invoke(IPC.FILES_READ, { path: p }),

    write: (p, bytes) => ipcRenderer.invoke(IPC.FILES_WRITE, { path: p, bytes }),

    openExternal: (p) => ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL, { path: p }),

    revealInFinder: (p) => ipcRenderer.invoke(IPC.FILES_REVEAL_IN_FINDER, { path: p }),

    getHtmlMeta: (p) => ipcRenderer.invoke(IPC.FILES_GET_HTML_META, { path: p }),

    trash: (p) => ipcRenderer.invoke(IPC.FILES_TRASH, { path: p }),

    rename: (oldPath, newPath) => ipcRenderer.invoke(IPC.FILES_RENAME, { oldPath, newPath }),

    // BUG-039 — existence check for session-restore tab hydration.
    exists: (p) => ipcRenderer.invoke(IPC.FILES_EXISTS, { path: p }),
    dirExists: (p) => ipcRenderer.invoke(IPC.FILES_DIR_EXISTS, { path: p }),

    // ENH-016 — create a directory (navigator "New folder…").
    mkdir: (p) => ipcRenderer.invoke(IPC.FILES_MKDIR, { path: p }),

    // Stage 26 PR 3 item 8 — path-kind probe (editable breadcrumb).
    kind: (p) => ipcRenderer.invoke(IPC.FILES_KIND, { path: p }),

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
      // ENH-097 — payload may be a bare string (legacy) or
      // `{ path, mode }` (when CLI passed --canvas / --browser override).
      const handler = (_: IpcRendererEvent, payload: string | { path: string; mode?: 'canvas' | 'browser' }) => {
        if (typeof payload === 'string') cb(payload)
        else cb(payload.path, payload.mode)
      }
      ipcRenderer.on(IPC.NAV_VIEW, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_VIEW, handler)
    },

    onEdit: (cb) => {
      const handler = (_: IpcRendererEvent, payload: string | { path: string; mode?: 'canvas' | 'browser' }) => {
        if (typeof payload === 'string') cb(payload)
        else cb(payload.path, payload.mode)
      }
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
    },

    // ENH-022 (v0.5.4) — `duo doc goto` request/reply.
    onDocGoto: (cb) => {
      const handler = (_: IpcRendererEvent, req: DocGotoRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_DOC_GOTO, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_DOC_GOTO, handler)
    },

    replyDocGoto: (result: DocGotoResult) => {
      ipcRenderer.send(IPC.EDITOR_DOC_GOTO_RESULT, result)
    },

    // ENH-023 (v0.5.4) — `duo doc find` request/reply.
    onDocFind: (cb) => {
      const handler = (_: IpcRendererEvent, req: DocFindRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_DOC_FIND, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_DOC_FIND, handler)
    },

    replyDocFind: (result: DocFindResult) => {
      ipcRenderer.send(IPC.EDITOR_DOC_FIND_RESULT, result)
    }
  },

  canvas: {
    onHtmlOp: (cb) => {
      const handler = (_: IpcRendererEvent, req: HtmlOpRequest) => cb(req)
      ipcRenderer.on(IPC.PAGE_HTML_OP, handler)
      return () => ipcRenderer.removeListener(IPC.PAGE_HTML_OP, handler)
    },

    replyHtmlOp: (result: HtmlOpResult) => {
      ipcRenderer.send(IPC.PAGE_HTML_OP_RESULT, result)
    },

    pushSelection: (snapshot: PageSelectionSnapshot | null) => {
      ipcRenderer.send(IPC.PAGE_SELECTION_PUSH, snapshot)
    },

    onHtmlComment: (cb) => {
      const handler = (_: IpcRendererEvent, req: HtmlCommentRequest) => cb(req)
      ipcRenderer.on(IPC.PAGE_HTML_COMMENT, handler)
      return () => ipcRenderer.removeListener(IPC.PAGE_HTML_COMMENT, handler)
    },

    replyHtmlComment: (result: HtmlCommentResult) => {
      ipcRenderer.send(IPC.PAGE_HTML_COMMENT_RESULT, result)
    },

    onHtmlCommentsList: (cb) => {
      const handler = (_: IpcRendererEvent, req: HtmlCommentsListRequest) => cb(req)
      ipcRenderer.on(IPC.PAGE_HTML_COMMENTS_LIST, handler)
      return () => ipcRenderer.removeListener(IPC.PAGE_HTML_COMMENTS_LIST, handler)
    },

    replyHtmlCommentsList: (result: HtmlCommentsListResult) => {
      ipcRenderer.send(IPC.PAGE_HTML_COMMENTS_LIST_RESULT, result)
    },

    onCommentRequest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.PAGE_COMMENT_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.PAGE_COMMENT_REQUEST, handler)
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

  layout: {
    onSplitSet: (cb) => {
      const handler = (_: IpcRendererEvent, pct: number) => cb(pct)
      ipcRenderer.on(IPC.SPLIT_SET, handler)
      return () => ipcRenderer.removeListener(IPC.SPLIT_SET, handler)
    }
  },

  // ENH-041 / Sprint 3 — Split View ("aux") bridge. Renderer is the
  // source of truth for aux state; main pushes verbs via the four
  // `on*` listeners and the renderer pushes its current snapshot back
  // via `pushState` so the CLI's no-arg `duo split-view` query has a
  // cache to read.
  workingAux: {
    pushState: (snapshot: WorkingAuxSnapshot) => {
      ipcRenderer.send(IPC.WORKING_AUX_STATE_PUSH, snapshot)
    },
    onOpen: (cb) => {
      const handler = (_: IpcRendererEvent, path: string) => cb(path)
      ipcRenderer.on(IPC.WORKING_AUX_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.WORKING_AUX_OPEN, handler)
    },
    /** Phase 3c — main asks renderer to pin a browser tab into aux.
     *  Renderer subscribes and routes through splitViewMoveBrowserTab. */
    onOpenBrowser: (cb) => {
      const handler = (_: IpcRendererEvent, browserTabId: number) => cb(browserTabId)
      ipcRenderer.on(IPC.WORKING_AUX_OPEN_BROWSER, handler)
      return () => ipcRenderer.removeListener(IPC.WORKING_AUX_OPEN_BROWSER, handler)
    },
    onClose: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.WORKING_AUX_CLOSE, handler)
      return () => ipcRenderer.removeListener(IPC.WORKING_AUX_CLOSE, handler)
    },
    onPromote: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.WORKING_AUX_PROMOTE, handler)
      return () => ipcRenderer.removeListener(IPC.WORKING_AUX_PROMOTE, handler)
    },
    onResize: (cb) => {
      const handler = (_: IpcRendererEvent, pct: number) => cb(pct)
      ipcRenderer.on(IPC.WORKING_AUX_RESIZE, handler)
      return () => ipcRenderer.removeListener(IPC.WORKING_AUX_RESIZE, handler)
    }
  },

  // Stage 27 — DuoEvent emit hook. Renderer-side surfaces (currently
  // the canvas-action `duo:event` handler in App.tsx; later: editor /
  // browser hooks) call this to push a structured event into main's
  // EventBus. Subscribers stream via `duo events --follow`.
  events: {
    emit: (input: { source?: 'canvas' | 'editor' | 'cli' | 'main' | 'renderer'; name: string; payload?: Record<string, unknown> }) => {
      ipcRenderer.send(IPC.DUO_EVENT_EMIT, input)
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
    pushActiveId: (payload) => {
      ipcRenderer.send(IPC.TERMINAL_ACTIVE_PUSH, payload)
    },

    onClaudePresenceChange: (cb) => {
      const handler = (_: IpcRendererEvent, state: ClaudePresenceState) => cb(state)
      ipcRenderer.on(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, handler)
      return () => { ipcRenderer.removeListener(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, handler) }
    },

    claudeOnPath: () => ipcRenderer.invoke('terminal:claude-on-path'),

    onNewTabRequest: (cb) => {
      const handler = (_: IpcRendererEvent, req: NewTabRequest) => cb(req)
      ipcRenderer.on(IPC.NEW_TAB_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.NEW_TAB_REQUEST, handler)
    },

    replyNewTab: (result: NewTabResult) => {
      ipcRenderer.send(IPC.NEW_TAB_RESULT, result)
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
    },
    // ENH-098 (Sprint 9) — pane-jump from CLI (`duo focus-pane <name>`).
    // Same shape as onPaneToggleFocus but payload-bearing.
    onPaneFocusJump: (cb) => {
      const handler = (_: IpcRendererEvent, target: 'terminal' | 'main' | 'aux') => cb(target)
      ipcRenderer.on(IPC.PANE_FOCUS_JUMP, handler)
      return () => ipcRenderer.removeListener(IPC.PANE_FOCUS_JUMP, handler)
    },
    reclaimFocus: () => ipcRenderer.send(IPC.PANE_FOCUS_RECLAIM),
    onBrowserFocusGained: (cb) => {
      // Phase 3c BUG-095 — payload now carries `{ tabId, slot }` so the
      // renderer can ignore aux-slot focus events for activeWorking
      // purposes. Pre-Phase-3c the channel was payload-less.
      const handler = (_: IpcRendererEvent, payload: { tabId: number; slot: 'main' | 'aux' }) => cb(payload)
      ipcRenderer.on(IPC.BROWSER_FOCUS_GAINED, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_FOCUS_GAINED, handler)
    },
    onClaudeReadSelection: (cb) => {
      const handler = (_: IpcRendererEvent, e: { pane: 'editor' | 'browser' | 'page' }) => cb(e)
      ipcRenderer.on(IPC.CLAUDE_READ_SELECTION, handler)
      return () => ipcRenderer.removeListener(IPC.CLAUDE_READ_SELECTION, handler)
    }
  },

  pins: {
    list: () => ipcRenderer.invoke(IPC.PINS_LIST) as Promise<PinEntry[]>,
    toggle: (entry) => ipcRenderer.invoke(IPC.PINS_TOGGLE, entry) as Promise<PinEntry[]>
  },

  navPins: {
    list: () => ipcRenderer.invoke(IPC.NAV_PINS_LIST) as Promise<NavPinEntry[]>,
    toggle: (entry) => ipcRenderer.invoke(IPC.NAV_PINS_TOGGLE, entry) as Promise<NavPinEntry[]>,
    onChange: (cb) => {
      const handler = (_: IpcRendererEvent, pins: NavPinEntry[]) => cb(pins)
      ipcRenderer.on(IPC.NAV_PINS_CHANGED, handler)
      return () => { ipcRenderer.removeListener(IPC.NAV_PINS_CHANGED, handler) }
    }
  },

  sessionState: {
    load: () => ipcRenderer.invoke(IPC.SESSION_STATE_LOAD) as Promise<SessionState>,
    save: (state) => ipcRenderer.invoke(IPC.SESSION_STATE_SAVE, state) as Promise<void>
  },

  install: {
    status: () => ipcRenderer.invoke(IPC.INSTALL_STATUS),
    run: () => ipcRenderer.invoke(IPC.INSTALL_RUN),
    addToShellPath: () => ipcRenderer.invoke(IPC.INSTALL_ADD_TO_PATH)
  },

  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK)
  },

  external: {
    onRedirected: (cb) => {
      const handler = (_: IpcRendererEvent, push: ExternalRedirectedPush) => cb(push)
      ipcRenderer.on(IPC.EXTERNAL_REDIRECTED, handler)
      return () => ipcRenderer.removeListener(IPC.EXTERNAL_REDIRECTED, handler)
    }
  },

  appMenu: {
    onPastePlainRequest: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.PASTE_PLAIN_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.PASTE_PLAIN_REQUEST, handler)
    }
  },

  // ENH-050 — native NSMenu (menu.popup) + system sheet dialog
  // (dialog.confirm) primitives. Replace the in-renderer ContextMenu
  // and the trash / pinned-close confirm modals so the WCV's native
  // subview compositing rule stops occluding them. See
  // `docs/DECISIONS.md § WCV-occlusion remediation`.
  menu: {
    popup: (req) => ipcRenderer.invoke(IPC.MENU_POPUP, req)
  },
  dialog: {
    confirm: (req) => ipcRenderer.invoke(IPC.DIALOG_CONFIRM, req)
  },
  // BUG-105 (Sprint 10) — main-process clipboard write. Use this from
  // any context-menu `click` handler (Copy path / Copy URL / etc.);
  // never call `navigator.clipboard.writeText` from inside a native
  // NSMenu callback chain.
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text) as Promise<void>
  }
}

contextBridge.exposeInMainWorld('electron', api)
