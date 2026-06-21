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
  DocEditPlainRequest,
  DocEditPlainResult,
  JsonOpRequest,
  JsonOpResult,
  HtmlOpRequest,
  HtmlOpResult,
  HtmlCommentRequest,
  HtmlCommentResult,
  HtmlCommentsListRequest,
  HtmlCommentsListResult,
  PageSelectionSnapshot,
  ThemeMode,
  ThemeStateSnapshot,
  AuthorStateSnapshot,
  ClaudeKeyPrefsSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot,
  WorkingAuxSnapshot,
  NewTabRequest,
  NewTabResult,
  PinEntry,
  NavPinEntry,
  ExternalRedirectedPush,
  SessionState,
  WorkspaceHistoryEntry,
  ActiveWorkspace,
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
// ENH-191 NFR-6.2 — true for a blank New-Window (createWindow({restore:false}));
// gates App.tsx's pin-auto-open so a new window doesn't clone the pinned file
// tabs. Read synchronously from --duo-blank (no IPC race). Default '0' (non-blank
// = the boot/restored windows).
const IS_BLANK = readArg('--duo-blank=', '0') === '1'
// ENH-210 (D1-part2) — initial nav cwd for a window opened AT a path
// (`duo window new --cwd` / "open worktree in new window"). Empty for
// normal windows. Read synchronously so useNavigator can seed from it.
const INITIAL_CWD = readArg('--duo-initial-cwd=', '')
// ENH-191 P4 — fetch THIS window's id once, synchronously, at preload time so
// window.electron.env.windowId is available BEFORE App.tsx module-eval reads
// per-window localStorage keys. Resolves to main's registry id (mainWindow.id
// via BrowserWindow.fromWebContents(event.sender)). sendSync is the idiomatic
// one-shot boot read; falls back to -1 if the handler ever isn't ready (the
// per-window key builders then degrade to a single shared key — N=1 safe).
const WINDOW_ID: number = (() => {
  try {
    const id = ipcRenderer.sendSync(IPC.WINDOW_GET_ID)
    return typeof id === 'number' && id > 0 ? id : -1
  } catch { return -1 }
})()
const api: ElectronAPI = {
  env: {
    HOME: process.env.HOME ?? '',
    SHELL: process.env.SHELL ?? '/bin/zsh',
    // BUG-138 Phase 2 — default human author identity for CriticMarkup.
    USER: process.env.USER ?? '',
    appVersion: APP_VERSION,
    isDev: IS_DEV,
    windowId: WINDOW_ID,
    blank: IS_BLANK,
    initialCwd: INITIAL_CWD
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

    liveCwd: (id) =>
      ipcRenderer.invoke(IPC.PTY_LIVE_CWD, { id }),

    liveCwds: (ids) =>
      ipcRenderer.invoke(IPC.PTY_LIVE_CWDS, { ids }),

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
    },

    // ENH-159b — element-inspect mode plumbing.
    //   - setInspectMode: renderer → main toggle/set (boolean or 'toggle').
    //   - onInspectMode: main → renderer push of the canonical state
    //     (drives the toolbar toggle button when it lands).
    //   - onInspectClick: main → renderer push of the captured element
    //     snapshot (or null = ESC exit). Renderer formats + writes
    //     to the active terminal.
    setInspectMode: (mode) =>
      ipcRenderer.send(IPC.BROWSER_INSPECT_SET_MODE, { mode }),

    onInspectMode: (cb) => {
      const handler = (_: IpcRendererEvent, active: Parameters<typeof cb>[0]) => cb(active)
      ipcRenderer.on(IPC.BROWSER_INSPECT_MODE, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_INSPECT_MODE, handler)
    },

    onInspectClick: (cb) => {
      const handler = (_: IpcRendererEvent, snapshot: Parameters<typeof cb>[0]) => cb(snapshot)
      ipcRenderer.on(IPC.BROWSER_INSPECT_CLICK, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_INSPECT_CLICK, handler)
    }
  },

  // ENH-221 — durable file version history (the History view).
  history: {
    list: (p) => ipcRenderer.invoke(IPC.HISTORY_LIST, { path: p }),
    show: (p, id) => ipcRenderer.invoke(IPC.HISTORY_SHOW, { path: p, id }),
    restore: (p, id) => ipcRenderer.invoke(IPC.HISTORY_RESTORE, { path: p, id })
  },

  files: {
    list: (p) => ipcRenderer.invoke(IPC.FILES_LIST, { path: p }),

    read: (p) => ipcRenderer.invoke(IPC.FILES_READ, { path: p }),

    write: (p, bytes, opts) =>
      ipcRenderer.invoke(IPC.FILES_WRITE, { path: p, bytes, historySource: opts?.historySource }),

    openPath: (p) => ipcRenderer.invoke(IPC.FILES_OPEN_PATH, { path: p }),

    openExternalUrl: (url) => ipcRenderer.invoke(IPC.FILES_OPEN_EXTERNAL_URL, { url }),

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

    // ENH-111 (Sprint 12) — file size + mtime for image viewer chrome.
    stat: (p) => ipcRenderer.invoke(IPC.FILES_STAT, { path: p }),

    // ENH-108 (Sprint 12) — paste-image: save bytes beside active doc.
    // ENH-129 (Sprint 14) — optional `prefix` for non-image assets
    // (e.g. 'pdf' produces `pdf-<stamp>-<hash>.pdf`).
    saveImageBeside: (activeDocPath, bytes, ext, prefix) =>
      ipcRenderer.invoke(IPC.FILES_SAVE_IMAGE_BESIDE, { activeDocPath, bytes, ext, prefix }),
    // ENH-128 (Sprint 14) — HEIC / RAW transcode via nativeImage.
    convertImageBytes: (bytes, sourceMime) =>
      ipcRenderer.invoke(IPC.FILES_CONVERT_IMAGE_BYTES, { bytes, sourceMime }),

    watch: async (paths, cb, opts) => {
      // Give every subscription its own id so pushes can be routed back to
      // the caller's callback. The id lives in the renderer; main process
      // just echoes it on each FILES_CHANGED push.
      const id = `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const handler = (_: IpcRendererEvent, push: FileWatchPush) => {
        if (push.id === id) cb(push.event)
      }
      ipcRenderer.on(IPC.FILES_CHANGED, handler)
      // ENH-195 B2/B4 — forward the optional ignored-override + parent-watch
      // flag (single open-file editors pass `{ ignored: [], watchParents: true }`).
      await ipcRenderer.invoke(IPC.FILES_WATCH_START, { id, paths, ignored: opts?.ignored, watchParents: opts?.watchParents })
      return async () => {
        ipcRenderer.removeListener(IPC.FILES_CHANGED, handler)
        await ipcRenderer.invoke(IPC.FILES_WATCH_STOP, { id })
      }
    },

    updateWatchPaths: (id, paths) =>
      ipcRenderer.invoke(IPC.FILES_WATCH_UPDATE, { id, paths })
  },

  // ENH-208 Phase 2 — vault UI affordances. Thin invoke wrappers; main
  // runs the same core/vault code paths as the `duo vault` CLI verbs.
  vault: {
    capture: (opts) => ipcRenderer.invoke(IPC.VAULT_CAPTURE, opts ?? {}),
    search: (opts) => ipcRenderer.invoke(IPC.VAULT_SEARCH, opts),
    stub: (opts) => ipcRenderer.invoke(IPC.VAULT_STUB, opts),
    types: (opts) => ipcRenderer.invoke(IPC.VAULT_TYPES, opts),
    createType: (opts) => ipcRenderer.invoke(IPC.VAULT_CREATE_TYPE, opts),
    // ENH-216 (VAULT MODE) — New Vault dialog scaffold + native dir
    // picker + renderer mode probe. Same core/vault code paths as the
    // `duo vault init` CLI verb.
    create: (opts) => ipcRenderer.invoke(IPC.VAULT_CREATE, opts),
    pickDir: () => ipcRenderer.invoke(IPC.VAULT_CREATE_PICK_DIR),
    detect: (opts) => ipcRenderer.invoke(IPC.VAULT_DETECT, opts)
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
    },

    // FOLLOWUP-020 — close-active-working-tab + close-terminal-tab
    // pushes. Renderer applies the actual close logic (pinned-tab gate,
    // tab identity resolution).
    onCloseActiveWorkingTab: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.NAV_CLOSE_ACTIVE_WORKING_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_CLOSE_ACTIVE_WORKING_TAB, handler)
    },
    onCloseTerminalTab: (cb) => {
      const handler = (_: IpcRendererEvent, payload: { n?: number } | null) => {
        cb(payload?.n)
      }
      ipcRenderer.on(IPC.NAV_CLOSE_TERMINAL_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_CLOSE_TERMINAL_TAB, handler)
    },
    // FOLLOWUP-025 — File → Clone… modal trigger.
    // v2: payload may carry an optional `path` to pre-populate the
    // modal's parent-dir input (owner Q1 right-click-wins decision).
    onOpenCloneModal: (cb) => {
      const handler = (_event: unknown, payload?: { path?: string } | null) => cb(payload ?? undefined)
      ipcRenderer.on(IPC.NAV_OPEN_CLONE_MODAL, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_OPEN_CLONE_MODAL, handler)
    },
    // FOLLOWUP-025 v2 — renderer-side trigger for "Clone GitHub repo
    // here…" from the FileTree right-click menu. Sends to main, which
    // echoes the NAV_OPEN_CLONE_MODAL IPC back to the renderer with the
    // path payload. The roundtrip keeps the modal-open logic in one
    // place (App.tsx's onOpenCloneModal subscriber).
    openCloneModal: (opts?: { path?: string }) => {
      ipcRenderer.send(IPC.NAV_OPEN_CLONE_MODAL_REQUEST, opts ?? null)
    },

    // ENH-169 (Sprint 20) — File → New File… / New Folder… clicks
    // fire these channels. Renderer's App.tsx subscribes and routes
    // to newMarkdownFile / newFolder (same callbacks the chords
    // and breadcrumb right-click menu use).
    onNewFileRequest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.NEW_FILE_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.NEW_FILE_REQUEST, handler)
    },
    onNewFolderRequest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.NEW_FOLDER_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.NEW_FOLDER_REQUEST, handler)
    },
    // ENH-210 (D1-part2) — open a new window rooted at cwd.
    openWindowAt: (cwd: string) => {
      ipcRenderer.send(IPC.WINDOW_OPEN_AT, { cwd })
    },

    // ENH-216 (VAULT MODE) — File → New Vault… menu click. Renderer's
    // App.tsx subscribes and opens the New Vault dialog (OKF default —
    // D2). Mirrors onOpenCloneModal's menu-trigger pattern.
    onOpenNewVaultModal: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.NAV_OPEN_NEW_VAULT_MODAL, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_OPEN_NEW_VAULT_MODAL, handler)
    },

    // ENH-224 D1/D18 — File → Open… menu opens the merged Open bar.
    onOpenBar: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.NAV_OPEN_BAR, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_OPEN_BAR, handler)
    },
    // ENH-224 D14 — File → Open Recent ▸ <target> reopens via the renderer.
    onOpenBarReopen: (cb: (target: string) => void) => {
      const handler = (_: IpcRendererEvent, target: string) => cb(target)
      ipcRenderer.on(IPC.NAV_OPEN_BAR_REOPEN, handler)
      return () => ipcRenderer.removeListener(IPC.NAV_OPEN_BAR_REOPEN, handler)
    }
  },

  // ENH-224 D17 — native file/folder picker behind the Open bar's Browse…
  open: {
    browse: () => ipcRenderer.invoke(IPC.OPEN_BROWSE),
  },

  // ENH-224 D14 — Open Recent store (pointers; resolved live). Backed by a
  // main-process OpenRecentsService singleton shared with `duo open`.
  recents: {
    list: () => ipcRenderer.invoke(IPC.RECENTS_LIST),
    record: (entry) => ipcRenderer.invoke(IPC.RECENTS_RECORD, entry),
    clear: () => ipcRenderer.invoke(IPC.RECENTS_CLEAR),
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

    // ENH-108 — `duo image insert` request/reply mirror.
    onImageInsert: (cb: (req: import('../shared/types').ImageInsertRequest) => void) => {
      const handler = (_: IpcRendererEvent, req: import('../shared/types').ImageInsertRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_IMAGE_INSERT, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_IMAGE_INSERT, handler)
    },

    replyImageInsert: (result: import('../shared/types').ImageInsertResult) => {
      ipcRenderer.send(IPC.EDITOR_IMAGE_INSERT_RESULT, result)
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
    },

    // ENH-195 — `duo doc edit` surgical PLAIN replace request/reply.
    onDocEditPlain: (cb: (req: DocEditPlainRequest) => void) => {
      const handler = (_: IpcRendererEvent, req: DocEditPlainRequest) => cb(req)
      ipcRenderer.on(IPC.EDITOR_DOC_EDIT_PLAIN, handler)
      return () => ipcRenderer.removeListener(IPC.EDITOR_DOC_EDIT_PLAIN, handler)
    },

    replyDocEditPlain: (result: DocEditPlainResult) => {
      ipcRenderer.send(IPC.EDITOR_DOC_EDIT_PLAIN_RESULT, result)
    }
  },

  // ENH-195 — `duo json set|merge` against the active JSON / YAML viewer.
  json: {
    onJsonOp: (cb: (req: JsonOpRequest) => void) => {
      const handler = (_: IpcRendererEvent, req: JsonOpRequest) => cb(req)
      ipcRenderer.on(IPC.JSON_OP, handler)
      return () => ipcRenderer.removeListener(IPC.JSON_OP, handler)
    },

    replyJsonOp: (result: JsonOpResult) => {
      ipcRenderer.send(IPC.JSON_OP_RESULT, result)
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

  hiddenFiles: {
    // ENH-172 (Sprint 20) — main → renderer push when the View menu
    // checkbox is clicked OR `duo hidden-files` CLI verb writes. The
    // payload's `value` is true|false|'toggle'; renderer maps 'toggle'
    // to !currentValue. NAV_STATE_PUSH (existing channel) carries
    // the new value back to main, which uses it to refresh the
    // checkmark.
    onSet: (cb: (value: boolean | 'toggle') => void) => {
      const handler = (_: IpcRendererEvent, payload: { value: boolean | 'toggle' }) => cb(payload.value)
      ipcRenderer.on(IPC.HIDDEN_FILES_SET, handler)
      return () => ipcRenderer.removeListener(IPC.HIDDEN_FILES_SET, handler)
    }
  },

  browserMode: {
    // ENH-178 (Sprint 20) — three-mode browser URL filter.
    // Renderer holds the persisted value in localStorage; on boot it
    // calls set(...) once to push the persisted value back into main
    // so browserManager.routeOffHostIfMatched picks it up. CLI changes
    // arrive via the onPush channel.
    get: () => ipcRenderer.invoke(IPC.BROWSER_MODE_GET),
    set: (mode: 'unfiltered' | 'filtered' | 'local-only') =>
      ipcRenderer.invoke(IPC.BROWSER_MODE_SET, { mode }),
    onPush: (cb: (mode: 'unfiltered' | 'filtered' | 'local-only') => void) => {
      const handler = (_: IpcRendererEvent, payload: { mode: 'unfiltered' | 'filtered' | 'local-only' }) => cb(payload.mode)
      ipcRenderer.on(IPC.BROWSER_MODE_PUSH, handler)
      return () => ipcRenderer.removeListener(IPC.BROWSER_MODE_PUSH, handler)
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

  // BUG-138 Phase 2 — author identity for CriticMarkup attribution.
  // Same shape as the theme bridge: renderer pushState (cache in
  // main); main re-broadcasts CLI overrides via onSet.
  author: {
    pushState: (snapshot: AuthorStateSnapshot) => {
      ipcRenderer.send(IPC.AUTHOR_STATE_PUSH, snapshot)
    },

    onSet: (cb: (author: string) => void) => {
      const handler = (_: IpcRendererEvent, author: string) => cb(author)
      ipcRenderer.on(IPC.AUTHOR_SET, handler)
      return () => ipcRenderer.removeListener(IPC.AUTHOR_SET, handler)
    }
  },

  // Sprint 16 / v0.6.15 — Claude-tab Enter key preferences. Mirrors
  // the theme bridge shape: renderer pushState (cache in main); main
  // re-broadcasts CLI overrides via onSet. The CLI overrides may be
  // partial (one of the two prefs), so the snapshot type is partial
  // for onSet.
  claudeKeyPrefs: {
    pushState: (snapshot: ClaudeKeyPrefsSnapshot) => {
      ipcRenderer.send(IPC.CLAUDE_KEY_PREFS_STATE_PUSH, snapshot)
    },

    onSet: (cb: (prefs: Partial<ClaudeKeyPrefsSnapshot>) => void) => {
      const handler = (_: IpcRendererEvent, prefs: Partial<ClaudeKeyPrefsSnapshot>) => cb(prefs)
      ipcRenderer.on(IPC.CLAUDE_KEY_PREFS_SET, handler)
      return () => ipcRenderer.removeListener(IPC.CLAUDE_KEY_PREFS_SET, handler)
    }
  },

  layout: {
    onSplitSet: (cb) => {
      const handler = (_: IpcRendererEvent, pct: number) => cb(pct)
      ipcRenderer.on(IPC.SPLIT_SET, handler)
      return () => ipcRenderer.removeListener(IPC.SPLIT_SET, handler)
    },
    // ENH-099 — bridge for the 3-way even chord / menu / `duo split 3way`.
    // Payload-free signal; renderer applies outer 33/67 + inner aux 50/50.
    onLayout3wayEven: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.LAYOUT_3WAY_EVEN, handler)
      return () => ipcRenderer.removeListener(IPC.LAYOUT_3WAY_EVEN, handler)
    },
    // FOLLOWUP-015 — bridge for View → View source menu.
    // Payload-free; renderer fans out to the same window event the
    // ⌘⌥V chord uses.
    onViewSourceRequest: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.VIEW_SOURCE_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.VIEW_SOURCE_REQUEST, handler)
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

  // ENH-183 C5/C6 — banner-title + message-count + prior-sessions
  // lookups against Claude's JSONL store. All stateless reads (D9
  // invariant); the renderer recomputes via these on every banner
  // render.
  session: {
    readBannerTitle: (uuid, cwd) =>
      ipcRenderer.invoke(IPC.SESSION_READ_BANNER_TITLE, { uuid, cwd }) as Promise<import('../shared/host-api').BannerTitleResult>,
    readMessageCount: (uuid, cwd) =>
      ipcRenderer.invoke(IPC.SESSION_READ_MESSAGE_COUNT, { uuid, cwd }) as Promise<number>,
    listPrior: (cwd, opts) =>
      ipcRenderer.invoke(IPC.SESSION_LIST_PRIOR, { cwd, opts: opts ?? {} }) as Promise<import('../shared/host-api').PriorSessionListing[]>
    // ENH-183 pared 2026-05-25 (Option A): maybeHydrate removed
  },

  sessionState: {
    load: () => ipcRenderer.invoke(IPC.SESSION_STATE_LOAD) as Promise<SessionState>,
    save: (state) => ipcRenderer.invoke(IPC.SESSION_STATE_SAVE, state) as Promise<void>,
    // ENH-167 — subscribe to main's snapshot-request push; reply with
    // the freshly-built SessionState. Used by Save Session to bypass
    // the autosave debounce.
    onSnapshotRequest: (cb) => {
      const handler = (_: IpcRendererEvent, payload: { reqId: string }) => cb(payload.reqId)
      ipcRenderer.on(IPC.SESSION_STATE_SNAPSHOT_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_STATE_SNAPSHOT_REQUEST, handler)
    },
    snapshotReply: (payload) => ipcRenderer.send(IPC.SESSION_STATE_SNAPSHOT_RESULT, payload),
    // ENH-223 — tell main this window finished session restore (cron start gate).
    notifyRestoreSettled: () => ipcRenderer.send(IPC.SESSION_STATE_RESTORE_SETTLED)
  },

  // ENH-167 — workspace-as-file menu actions (renderer triggers from
  // the title-bar menu or future File menu shortcuts). Save / open /
  // open-recent / list-recent / active / new / clear-recent.
  workspaceFile: {
    save: (opts?: { saveAs?: boolean }) => ipcRenderer.invoke(IPC.WORKSPACE_FILE_SAVE, opts ?? {}) as Promise<{ ok: boolean; path?: string; name?: string; error?: string }>,
    open: () => ipcRenderer.invoke(IPC.WORKSPACE_FILE_OPEN) as Promise<{ ok: boolean; path?: string; name?: string; error?: string }>,
    openRecent: (path: string) => ipcRenderer.invoke(IPC.WORKSPACE_FILE_OPEN_RECENT, { path }) as Promise<{ ok: boolean; path?: string; name?: string; error?: string }>,
    listRecent: () => ipcRenderer.invoke(IPC.WORKSPACE_FILE_LIST_RECENT) as Promise<WorkspaceHistoryEntry[]>,
    active: () => ipcRenderer.invoke(IPC.WORKSPACE_FILE_ACTIVE) as Promise<ActiveWorkspace | null>,
    newWorkspace: () => ipcRenderer.invoke(IPC.WORKSPACE_FILE_NEW) as Promise<{ ok: boolean }>,
    clearRecent: () => ipcRenderer.invoke(IPC.WORKSPACE_FILE_CLEAR_RECENT) as Promise<{ ok: boolean }>,
    // ENH-167 v1.2 — push when activeWorkspaceService changes.
    // Drives the in-app titlebar badge.
    onActiveChanged: (cb) => {
      const handler = (_: IpcRendererEvent, active: ActiveWorkspace | null) => cb(active)
      ipcRenderer.on(IPC.WORKSPACE_FILE_ACTIVE_CHANGED, handler)
      return () => { ipcRenderer.removeListener(IPC.WORKSPACE_FILE_ACTIVE_CHANGED, handler) }
    }
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
    writeText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text) as Promise<void>,
    // ENH-111 (Sprint 12) — image-to-clipboard for image viewer.
    writeImage: (p) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_IMAGE, p) as Promise<boolean>
  },
  // ENH-151 / ENH-152a — GitHub integration. status powers the
  // Navigator root chip; clone wraps gh repo clone / git clone for
  // the File → Clone… modal; ghAuth probes gh auth status.
  // ENH-182 — D2 marker probe. Companion to git.status; the renderer
  // needs both to qualify a folder as a project.
  projects: {
    hasMarker: (dir: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_HAS_MARKER, { dir }) as Promise<boolean>,
    read: () =>
      ipcRenderer.invoke(IPC.PROJECTS_READ) as Promise<import('../shared/types').ProjectsFile>,
    togglePin: (root: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_TOGGLE_PIN, { root }) as Promise<
        import('../shared/types').ProjectsFile
      >,
    onChange: (cb: (file: import('../shared/types').ProjectsFile) => void) => {
      const handler = (_e: unknown, file: import('../shared/types').ProjectsFile) => cb(file)
      ipcRenderer.on(IPC.PROJECTS_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.PROJECTS_CHANGED, handler)
    },
    // ENH-182 Phase 4 — renderer pushes rail snapshot on every
    // change; main caches for `duo project list` + name resolution.
    pushState: (snapshot: import('../shared/types').ProjectsStateSnapshot) =>
      ipcRenderer.send(IPC.PROJECTS_STATE_PUSH, snapshot),
    onSetFocus: (cb: (root: string | null) => void) => {
      const handler = (_e: unknown, payload: { root: string | null }) => cb(payload.root)
      ipcRenderer.on(IPC.PROJECTS_SET_FOCUS, handler)
      return () => ipcRenderer.removeListener(IPC.PROJECTS_SET_FOCUS, handler)
    },
    onCloseRequest: (cb: (root: string) => void) => {
      const handler = (_e: unknown, payload: { root: string }) => cb(payload.root)
      ipcRenderer.on(IPC.PROJECTS_CLOSE_REQUEST, handler)
      return () => ipcRenderer.removeListener(IPC.PROJECTS_CLOSE_REQUEST, handler)
    }
  },
  // ENH-184 (Sprint 23 / v0.8.0) — workspace-pill click-to-open-menu
  // CLI parity surface. Renderer pushes current value via pushState;
  // main pushes CLI writes via onSet.
  workspacePillMenu: {
    pushState: (enabled: boolean) =>
      ipcRenderer.send(IPC.WORKSPACE_PILL_MENU_PUSH, { enabled }),
    onSet: (cb: (enabled: boolean) => void) => {
      const handler = (_e: unknown, payload: { enabled: boolean }) => cb(payload.enabled)
      ipcRenderer.on(IPC.WORKSPACE_PILL_MENU_SET, handler)
      return () => ipcRenderer.removeListener(IPC.WORKSPACE_PILL_MENU_SET, handler)
    }
  },
  git: {
    status: (cwd) => ipcRenderer.invoke(IPC.GIT_STATUS, { cwd }),
    worktrees: (cwd) => ipcRenderer.invoke(IPC.GIT_WORKTREES, { cwd }),
    createWorktree: (req) => ipcRenderer.invoke(IPC.GIT_CREATE_WORKTREE, req),
    clone: (req) => ipcRenderer.invoke(IPC.GIT_CLONE, req),
    ghAuth: () => ipcRenderer.invoke(IPC.GH_AUTH_STATUS),
    githubUrlFor: (req) => ipcRenderer.invoke(IPC.GIT_GITHUB_URL_FOR, req),
    scanReposIn: (req) => ipcRenderer.invoke(IPC.GIT_SCAN_REPOS_IN, req),
    dirtyFilesFor: (req) => ipcRenderer.invoke(IPC.GIT_DIRTY_FILES_FOR, req),
    watchStart: (req) => ipcRenderer.invoke(IPC.GIT_WATCH_START, req),
    watchStop: () => ipcRenderer.invoke(IPC.GIT_WATCH_STOP),
    onWatchInvalidate: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.GIT_WATCH_INVALIDATE, handler)
      return () => ipcRenderer.removeListener(IPC.GIT_WATCH_INVALIDATE, handler)
    }
  },
  // ENH-212 — Home re-entry surface. Snapshot + expander + click
  // contract are pure invokes (main recomputes live every call — D9);
  // onHomeShow / onTerminalActivateTab are the `duo home` / `duo term
  // tab` push subscriptions.
  home: {
    snapshot: (limitPerProject?: number) =>
      ipcRenderer.invoke(IPC.HOME_SNAPSHOT, { limitPerProject }) as Promise<import('../shared/types').HomeSnapshot>,
    listSessions: (root: string, offset: number, limit: number) =>
      ipcRenderer.invoke(IPC.HOME_LIST_SESSIONS, { root, offset, limit }) as Promise<import('../shared/types').HomeSession[]>,
    sessionAction: (action: import('../shared/types').HomeSessionAction) =>
      ipcRenderer.invoke(IPC.HOME_SESSION_ACTION, action) as Promise<import('../shared/types').HomeSessionActionResult>,
    onHomeShow: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.HOME_SHOW, handler)
      return () => ipcRenderer.removeListener(IPC.HOME_SHOW, handler)
    },
    onTerminalActivateTab: (cb: (tabId: string) => void) => {
      const handler = (_e: unknown, payload: { tabId: string }) => cb(payload.tabId)
      ipcRenderer.on(IPC.TERMINAL_ACTIVATE_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_ACTIVATE_TAB, handler)
    },
    onTerminalCloseTab: (cb: (tabId: string) => void) => {
      const handler = (_e: unknown, payload: { tabId: string }) => cb(payload.tabId)
      ipcRenderer.on(IPC.TERMINAL_CLOSE_TAB, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_CLOSE_TAB, handler)
    },
    // ENH-225 (F2/D9) — main → renderer push when a tab's attention flag flips.
    onTerminalTabAttention: (cb: (p: import('../shared/types').TabAttentionPush) => void) => {
      const handler = (_e: unknown, payload: import('../shared/types').TabAttentionPush) => cb(payload)
      ipcRenderer.on(IPC.TERMINAL_TAB_ATTENTION, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_TAB_ATTENTION, handler)
    }
  },

  // ENH-223 Tier 2 — scheduled ("cron") sessions on Home. One invoke channel
  // delegates to CronService.handleCli; onJobsChanged streams live updates.
  cron: {
    invoke: (op, args) => ipcRenderer.invoke(IPC.CRON_INVOKE, { op, args }),
    onJobsChanged: (cb) => {
      const handler = (_: IpcRendererEvent, jobs: Parameters<typeof cb>[0]) => cb(jobs)
      ipcRenderer.on(IPC.CRON_JOBS_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.CRON_JOBS_CHANGED, handler)
    },
    onOpenNewModal: (cb) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.CRON_OPEN_NEW_MODAL, handler)
      return () => ipcRenderer.removeListener(IPC.CRON_OPEN_NEW_MODAL, handler)
    },
    // ENH-223 — the cron dialog's Browse button → native folder picker.
    pickDirectory: (defaultPath) =>
      ipcRenderer.invoke(IPC.DIALOG_PICK_DIRECTORY, defaultPath) as Promise<string | null>
  }
}

contextBridge.exposeInMainWorld('electron', api)
