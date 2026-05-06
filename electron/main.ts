import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell, webContents, clipboard } from 'electron'
import type { MenuItemConstructorOptions, WebContents } from 'electron'
// electron-context-menu v4 is ESM-only; main bundles as CJS, so we
// load it via dynamic import inside app.whenReady. The lazy import
// also defers the cost off the cold-start critical path. Imported
// for its type only here; the runtime call uses await import(...)
// below.
import type { Options as ContextMenuOptions } from 'electron-context-menu'
import { join } from 'path'
import { homedir } from 'os'
import { resolveClaudeBinary } from '../core/resolve-claude'
import { expandTilde } from '../core/path-utils'
import { PtyManager } from '../core/pty-manager'
import { BrowserManager } from './browser-manager'
import { CdpBridge } from './cdp-bridge'
import { SocketServer, ensureSocketDir } from '../core/socket-server'
import { FilesService } from './files-service'
import { PinsService } from '../core/pins-service'
import { NavPinsService } from '../core/nav-pins-service'
import { InstallService } from './install-service'
import { UpdateChecker } from '../core/update-checker'
import { initAutoUpdater } from './auto-updater'
import { SessionStateService } from '../core/session-state-service'
import { ClaudePresenceProbe } from '../core/claude-presence'
import { BrowserHistoryService } from '../core/browser-history-service'
import { ExternalDomainsService } from '../core/external-domains-service'
import { EventBus, type DuoEventSource } from '../core/event-bus'
import { PackLoader } from '../core/pack-loader'
import { InstalledPacksService } from '../core/installed-packs-service'
import { IPC } from '../shared/types'
import { htmlBoilerplate } from '../shared/html-boilerplate'
import type {
  BrowserBounds,
  BrowserState,
  BrowserTab,
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
  NewTabRequest,
  NewTabResult,
  ExternalRedirectedPush,
  WorkingAuxSnapshot
} from '../shared/types'

// Last nav state snapshot the renderer pushed. Drives `duo nav state`.
// Starts with sensible defaults so a CLI call before the renderer has
// pushed anything returns a well-formed object.
let navState: NavStateSnapshot = {
  cwd: process.env.HOME ?? '/',
  selected: null,
  expanded: [],
  pinned: false
}

// Stage 11 \u00a7 D29a — most recent selection snapshot from the active editor.
// `null` means no editor tab is active or no doc is loaded.
let editorSelection: EditorSelectionSnapshot | null = null

// Stage 17c — most recent selection snapshot from the active HTML canvas.
// `null` means no canvas tab is active or no element is selected. Drives
// `duo selection --pane canvas`.
let canvasSelection: PageSelectionSnapshot | null = null

// Pending doc-write requests awaiting a renderer reply.
const docWritePending = new Map<string, (res: DocWriteResult) => void>()

// Pending doc-read requests awaiting a renderer reply.
const docReadPending = new Map<string, (res: DocReadResult) => void>()

// ENH-022 / ENH-023 (v0.5.4) — pending doc-goto / doc-find requests
// awaiting a renderer reply. Same pairing pattern as docWritePending.
const docGotoPending = new Map<string, (res: DocGotoResult) => void>()
const docFindPending = new Map<string, (res: DocFindResult) => void>()

// Stage 17b Phase C — pending `duo html *` ops awaiting a renderer reply.
const htmlOpPending = new Map<string, (res: HtmlOpResult) => void>()

// Stage 17d — pending `duo html comment` / `duo html comments` requests
// awaiting a renderer reply. Same Map-pairing pattern as htmlOpPending.
const htmlCommentPending = new Map<string, (res: HtmlCommentResult) => void>()
const htmlCommentsListPending = new Map<string, (res: HtmlCommentsListResult) => void>()

// Stage 11 \u00a7 D33d \u2014 most recent theme state pushed by the renderer.
// Drives `duo theme` reads. Renderer is the source of truth.
let themeState: ThemeStateSnapshot = { mode: 'system', effective: 'dark' }

// Stage 15 G19 — Send → Duo payload format. Renderer is the source of
// truth (persisted in localStorage); main caches the latest snapshot
// for `duo selection-format` reads. Default 'a' (quote + provenance).
let selectionFormatState: SelectionFormatStateSnapshot = { format: 'a' }

// ENH-041 / Sprint 3 — Split View aux pane snapshot cache. Renderer
// is the source of truth (App.tsx owns the aux useState); main caches
// the latest snapshot pushed via WORKING_AUX_STATE_PUSH so the no-arg
// `duo split-view` state query can answer without a renderer round-
// trip. Defaults to closed (aux: null) until first push.
let workingAuxSnapshot: WorkingAuxSnapshot = { aux: null }

// Stage 15 G17 — most recent active terminal-tab id pushed by the
// renderer. `duo send` writes payloads into this terminal's PTY.
// `null` means no terminal tabs exist (degenerate state — `duo send`
// surfaces an error).
let activeTerminalId: string | null = null

// ENH-013 — claude-presence probe. Polls the active terminal's PTY
// process tree for a live `claude` descendant; broadcasts state
// changes so the renderer's Send → Duo pill gates correctly.
const claudePresence = new ClaudePresenceProbe()

// Stage 19c D27 — pending `duo new-tab` requests awaiting a renderer
// reply. Shape mirrors docWritePending / docReadPending.
const newTabPending = new Map<string, (res: NewTabResult) => void>()

// Stage 12 — Atelier "light is hero". Was 'dark'; flipped so macOS
// chrome (menu, dialogs) matches the new design baseline at app boot
// before the renderer has a chance to push its preference.
//
// IMPORTANT (BUG-017): Electron's `nativeTheme.themeSource` governs
// BOTH native chrome AND the renderer's `prefers-color-scheme` media
// query. The earlier comment claiming "this only governs native chrome"
// was incorrect — keeping it pinned to 'light' broke the renderer's
// `system` mode (the OS preference was never visible to matchMedia).
// The renderer now pushes its mode via `IPC.THEME_STATE_PUSH` (see
// the handler below), and main updates `nativeTheme.themeSource` to
// match. Boot default stays 'light' so the splash + first paint match
// Atelier; the push runs immediately after the renderer mounts.
nativeTheme.themeSource = 'light'

let mainWindow: BrowserWindow | null = null
// ENH-081 (v0.6.4) — Finder double-click / drag-onto-Dock landing
// strip. macOS fires `app.on('open-file')` for paths the user opened
// via the OS shell. On cold start the event can fire before
// createWindow() resolves and the renderer registers IPC listeners,
// so we stash the path and replay it from `did-finish-load`. On
// warm-start (Duo already running) the send happens immediately.
// Single-pending-path is sufficient: macOS coalesces multi-file opens
// into separate event firings, but the cold-start window before
// did-finish-load is short and a user opening N files at boot is the
// edge case to come back to (file as a follow-up if it surfaces).
let pendingOpenFilePath: string | null = null
app.on('open-file', (event, path) => {
  event.preventDefault()
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Warm path — Duo is already running. Route through sendEdit (the
    // same destination FileTree double-click and `duo open` use), so
    // the Finder open lands on the right surface (markdown -> editor;
    // .html -> canvas, or browser if the file's `duo-open-in` meta
    // says so).
    sendEdit(path)
    mainWindow.focus()
  } else {
    // Cold path — stash and let the createWindow() did-finish-load
    // hook flush after the renderer is ready to receive NAV_EDIT.
    pendingOpenFilePath = path
  }
})
const ptyManager = new PtyManager(app.getVersion())
const filesService = new FilesService()
const pinsService = new PinsService()
const navPinsService = new NavPinsService()
// Issue #27 / Stage 21c Phase 3 — browser history for URL-bar autocomplete.
const browserHistory = new BrowserHistoryService()
const installService = new InstallService()
const updateChecker = new UpdateChecker(app.getVersion())
// Load the cached check at boot so the renderer's first IPC call
// can return immediately even before a network refresh completes.
// `maybeRefresh()` will then fire the network call in the background
// when the renderer asks; subsequent calls return cached results.
void updateChecker.loadCache()
const sessionStateService = new SessionStateService()
let browserManager: BrowserManager | null = null
let socketServer: SocketServer | null = null
let externalDomainsService: ExternalDomainsService | null = null

// Stage 27 — process-wide event bus. Singleton; lives forever. Any
// subsystem that wants to surface a structured event to subscribers
// (canvas-action `duo:event`, future renderer / browser hooks) calls
// `eventBus.emit(...)`. The CLI streams via `duo events --follow`.
const eventBus = new EventBus()

// Stage 18b — distro pack loader. Singleton. scan() runs on app
// boot to populate the registry; first-launch defaults + the
// `duo packs` CLI both consume it. Hot-reload deferred to Stage 18c.
const packLoader = new PackLoader()
const installedPacksService = new InstalledPacksService()

// Stage 9 — the menu's Cozy mode checkmark tracks the active tab.
// The renderer is the source of truth; main caches the last pushed value
// so the menu rebuild logic can read it synchronously.
let cozyActiveTab = false
let cozyMenuItemId: string | null = null

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // Stage 12 — Atelier paper. Pre-CSS-load flash color matches the
     // new light hero so first-paint doesn't flash dark.
     backgroundColor: '#FBF8EE',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for preload to use Node.js APIs
      // Smoke-walk diagnostic — surface the running version + dev/prod
      // flag in the titlebar so the user can confirm WHICH build they're
      // walking before validating fixes. Otherwise the previous fail of
      // "did my fix actually land" was a 30-second chore (kill app,
      // restart dev, rebuild …). Now it's a glance at the titlebar.
      additionalArguments: [
        `--duo-app-version=${app.getVersion()}`,
        `--duo-is-dev=${app.isPackaged ? '0' : '1'}`
      ]
    }
  })

  // Move A2 — PtyManager talks to the UI through an EventSink. The
  // adapter is one line in Electron (webContents.send); a future
  // extension helper would wrap a Native Messaging port write instead.
  ptyManager.setEventSink({
    send: (channel, payload) => mainWindow?.webContents.send(channel, payload)
  })

  // BUG-040 — external-domains routing service. Loaded once at boot;
  // file-watched so user edits to ~/.claude/duo/external-domains.json
  // take effect without a relaunch. Passed to BrowserManager so it
  // can intercept user-driven navigations + popups, AND retained here
  // so the agent path (openExternalUrl) can reuse the same matcher
  // for the post-redirect banner reason lookup.
  //
  // ENH-021 v2 (2026-04-30) — pass the Vite-injected bundled defaults
  // so the runtime can self-heal an empty / missing file at boot.
  // The install-service's bootstrap+merge path (ENH-021 v1) only
  // fires on user-clicked install; existing users with a populated-
  // but-empty file (a state we discovered during the v0.5.3 smoke
  // walk) never triggered it and ended up with zero routing.
  externalDomainsService = new ExternalDomainsService({
    defaults: __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__
  })
  await externalDomainsService.load()
  externalDomainsService.watch()

  // Browser manager owns WebContentsViews and forwards state to renderer.
  //
  // BUG-078 (v0.6.5 Phase 5 walk) — peek the persisted session BEFORE
  // construction so we can decide whether the constructor should open
  // its boot-default FAQ tab. If a session exists, suppress the boot
  // tab — `restoreFromSession` (called from did-finish-load below) will
  // populate from saved state. Without this peek the constructor opens
  // FAQ unconditionally; saved tabs then layer on top, and BUG-057's
  // default-pin restore re-adds the FAQ even when the user closed it
  // last session. Net was "FAQ tab opens on every launch."
  const persistedAtBoot = await sessionStateService.load().catch(() => ({ browserTabs: [], activeBrowserIndex: 0 } as { browserTabs: { url: string; title: string }[]; activeBrowserIndex: number }))
  const hasPersistedSession = persistedAtBoot.browserTabs.length > 0

  const cdpBridge = new CdpBridge()
  browserManager = new BrowserManager(
    mainWindow,
    cdpBridge,
    (state: BrowserState) => mainWindow?.webContents.send(IPC.BROWSER_STATE, state),
    (tabs: BrowserTab[]) => mainWindow?.webContents.send(IPC.BROWSER_TABS, tabs),
    browserHistory,
    externalDomainsService,
    { bootDefaultTab: !hasPersistedSession }
  )

  // ENH-039 — page-side `[data-duo-path]` link clicks (smoke-walk page,
  // future Duo-authored pages) route through the CDP binding here and
  // dispatch via sendEdit, the same path `duo open` uses. The PATH_LINK_
  // FORWARDER_IIFE in cdp-bridge.ts gates on `location.protocol === 'file:'`
  // so arbitrary http(s) sites containing [data-duo-path] markup stay inert.
  //
  // Tilde expansion: page-emitted paths commonly use `~/...` shorthand
  // (smoke-walk steps render `~/.claude/duo/help/faq.html` verbatim from
  // the manifest). The renderer's openFileSmart calls fs.stat against
  // the literal string, which yields ENOENT on `~`. Expand here, before
  // sendEdit, so the renderer always sees absolute paths. `~user/...`
  // (other-user home) is rare in this context — defer until a real
  // ask shows up.
  cdpBridge.onBrowserOpenPath((path) => {
    const expanded = expandTilde(path, homedir())
    void sendEdit(expanded)
    // BUG-071 (v0.6.4) — pull keyboard focus off the WebContentsView
    // and back onto the renderer's content view after the path-link
    // click. Without this, ⌃Tab is unresponsive until the user re-
    // clicks into the canvas because the WCV is still the native
    // first-responder even though React's focusedColumn flipped to
    // 'working'. Inverse of BUG-042's wireKeyForwarding pattern.
    mainWindow?.webContents.focus()
  })

  // Sprint 3 Phase 3a polish — split-targeted path-link clicks. Fires
  // when a page sets <meta name="duo-path-target" content="split"> or
  // a specific `<a>` carries data-duo-target="split". Routes through
  // splitViewOpen so the linked file lands in aux while the source
  // page stays visible in main. Smoke-walk pages opt in via the meta
  // so smoke-walk steps' path links open in the side without losing
  // the walk doc itself. Same tilde expansion as the main path above.
  cdpBridge.onBrowserOpenPathSplit((path) => {
    const expanded = expandTilde(path, homedir())
    void splitViewOpen(expanded)
    // BUG-071 (v0.6.4) — same focus transfer as the main-pane path.
    // The WCV is still the keyboard first-responder until we tell the
    // renderer to take it back, regardless of which pane the open
    // landed in.
    mainWindow?.webContents.focus()
  })

  // Socket server starts listening; CLI connects here
  ensureSocketDir()
  socketServer = new SocketServer(cdpBridge, browserManager, filesService, {
    getState: getNavState,
    reveal: sendReveal,
    view: sendView,
    edit: sendEdit,
    getSelection: getEditorSelection,
    getCanvasSelection: getCanvasSelection,
    docWrite: dispatchDocWrite,
    docRead: dispatchDocRead,
    docGoto: dispatchDocGoto,
    docFind: dispatchDocFind,
    getTheme: getThemeState,
    setTheme: setThemeMode,
    setSplit: setSplit,
    splitViewOpen: splitViewOpen,
    splitViewOpenBrowser: splitViewOpenBrowser,
    splitViewClose: splitViewClose,
    splitViewPromote: splitViewPromote,
    splitViewResize: splitViewResize,
    getSplitViewState: getSplitViewState,
    openExternal: openExternalUrl,
    getSelectionFormat: getSelectionFormatState,
    setSelectionFormat: setSelectionFormat,
    sendToActiveTerminal: sendToActiveTerminal,
    htmlNew: htmlNew,
    htmlOp: dispatchHtmlOp,
    htmlComment: dispatchHtmlComment,
    htmlCommentsList: dispatchHtmlCommentsList,
    newTab: dispatchNewTab,
    pushNavPinsChanged: (pins) => {
      mainWindow?.webContents.send(IPC.NAV_PINS_CHANGED, pins)
    }
  }, navPinsService, eventBus, packLoader)
  // Stage 12 close — wire the renderer event sink so the socket
  // server can push ambient cues (e.g. CLAUDE_READ_SELECTION when
  // the agent calls `duo selection`). Same one-liner adapter as
  // PtyManager's setEventSink.
  socketServer.setEventSink((channel, payload) => {
    mainWindow?.webContents.send(channel, payload)
  })
  socketServer.start()

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ENH-013 — start the claude-presence probe + wire its broadcast to
  // the renderer. Subscribed once at first load so the pill responds
  // to state changes for the lifetime of the window. The unsubscribe
  // hook isn't kept (process tear-down is the only ender).
  //
  // BUG-056 — also push the live state into the browser pane via
  // cdpBridge.setClaudeLive so the in-page Send → Duo pill gates on
  // it. State 'claude' or 'starting' = live (claude is running OR
  // about to). Anything else (no-pty / shell) = not live → pill
  // suppressed at the page-DOM level (NOT just at click-handler time
  // — the visual pill itself was the source of confusion).
  claudePresence.start()
  claudePresence.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, state)
    }
    cdpBridge.setClaudeLive(state === 'claude' || state === 'starting')
  })

  // Once the renderer reports its bounds, attach CDP to the active tab
  mainWindow.webContents.once('did-finish-load', async () => {
    if (browserManager) await browserManager.attachCdp()

    // Stage 21c Phase 2 — restore browser tabs from persisted session.
    // Done after did-finish-load so the renderer is mounted to receive
    // the resulting BROWSER_TABS broadcast. Best-effort; failure
    // doesn't block app startup. Re-uses the `persistedAtBoot` snapshot
    // captured pre-construction (BUG-078 fix) so the boot-default-tab
    // decision and the actual restore use the same data.
    if (browserManager) {
      try {
        if (hasPersistedSession) {
          await browserManager.restoreFromSession(persistedAtBoot.browserTabs, persistedAtBoot.activeBrowserIndex)
        }
      } catch (err) {
        console.warn('[main] browser-tab restore failed:', (err as Error)?.message ?? err)
      }

      // BUG-057 — auto-open pinned browser tabs that aren't in the
      // restored session. Pins.json is authoritative for "I want
      // these tabs to come back every time"; without this step,
      // closing a pinned tab drops it from session-state, and the
      // pin entry becomes a dangling reference. Owner's framing:
      // "pinned files should stay pinned and NEVER be lost between
      // sessions or after app updates/upgrades — that's the whole
      // point of the feature." Browsers (Chrome, Safari) auto-reopen
      // pinned tabs on restart; matching that convention here.
      //
      // BUG-078 (v0.6.5 Phase 5 walk) — gated on `!hasPersistedSession`.
      // The original BUG-057 design predates session-state restore
      // working reliably; with restore in place, the persisted session
      // is the authoritative source of "what tabs were open." Auto-
      // restoring default-pinned tabs (FAQ, What Duo Does — both
      // default-pinned per ENH-003) on top of the restored session
      // resurrects tabs the user explicitly closed. New rule (owner-
      // stated): "boot load only on fresh app; skip if prev tabs
      // persisted." User-explicit pins still survive across upgrades
      // because session-state survives upgrades too. This trims the
      // BUG-057 mechanism to fresh-app-only — which is when it
      // actually matters.
      if (!hasPersistedSession) {
        try {
          const pinnedEntries = await pinsService.list()
          const browserPins = pinnedEntries.filter(p => p.kind === 'browser')
          if (browserPins.length > 0) {
            // Snapshot what's currently open after session restore.
            const currentUrls = new Set(browserManager.getTabs().map(t => t.url))
            for (const pin of browserPins) {
              if (!currentUrls.has(pin.ref)) {
                browserManager.addTab(pin.ref)
              }
            }
          }
        } catch (err) {
          console.warn('[main] pinned browser tab auto-open failed:', (err as Error)?.message ?? err)
        }
      }
    }

    // Stage 18b — first-launch defaults hook. Runs AFTER session
    // restore so default tabs don't fight the user's pinned /
    // restored ones. For each pack whose `<name>@<version>` flag
    // hasn't been recorded in installed-packs.json yet, dispatch
    // NAV_EDIT for every default with `openOnFirstLaunch: true`.
    // Then mark the pack flagged so subsequent boots stay quiet.
    //
    // Trust gate: pack canvases live under ~/.claude/duo/packs/<name>/
    // which is under ~/.claude/duo/, so the canvas-action trust gate
    // automatically trusts them. No additional consent flow needed.
    try {
      const registry = packLoader.get()
      const installed = await installedPacksService.load()
      for (const loaded of registry.packs) {
        const m = loaded.manifest
        if (!m) continue                    // malformed manifest — skip
        if (!InstalledPacksService.needsFirstLaunch(installed, m.name, m.version)) {
          continue
        }
        const defaults = m.defaults ?? []
        for (const def of defaults) {
          if (!def.openOnFirstLaunch) continue
          if (def.kind !== 'canvas') continue   // editor/browser are v2
          const absPath = join(loaded.rootDir, def.path)
          // NAV_EDIT routes through the renderer's openFileSmart, which
          // honors duo-open-in meta. Most pack canvases will land in
          // the canvas tab; templates that opt into browser routing
          // get there via the meta hint without bespoke wiring here.
          mainWindow?.webContents.send(IPC.NAV_EDIT, absPath)
        }
        await installedPacksService.markFirstLaunched(m.name, m.version)
      }
    } catch (err) {
      console.warn('[main] first-launch defaults hook failed:', (err as Error)?.message ?? err)
    }

    // ENH-081 (v0.6.4) — flush a pending Finder open-file (cold start).
    // Done AFTER the first-launch defaults hook so a user-initiated
    // open wins focus over default tabs; sendEdit's NAV_EDIT activates
    // the new tab and supersedes any tab the defaults just opened.
    if (pendingOpenFilePath) {
      const p = pendingOpenFilePath
      pendingOpenFilePath = null
      sendEdit(p)
    }
  })

  // Lock the main renderer at zoom factor 1 so the WebContentsView bounds
  // we get from getBoundingClientRect (CSS pixels, zoom-affected) match
  // the window coordinate system Electron uses for setBounds. Without this,
  // Cmd+/- zooms the UI and the browser view drifts relative to its DOM
  // anchor — the "black bar on the left of the working pane" bug. Also
  // persists across relaunches so any lingering zoom from a previous run
  // gets cleared.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1)
    mainWindow?.webContents.setVisualZoomLevelLimits(1, 1)
  })
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.on('closed', () => {
    socketServer?.stop()
    browserManager?.dispose()
    externalDomainsService?.dispose()
    mainWindow = null
    browserManager = null
    socketServer = null
    externalDomainsService = null
  })
}

app.whenReady().then(async () => {
  setupIPC()
  installAppMenu()
  // ENH-031 — global right-click context menu for every WebContents
  // (main renderer + every WebContentsView Duo creates). Default items
  // cover Cut / Copy / Paste / Select All / Spell-check / Look Up /
  // Inspect (dev only). Prepended item: ENH-030 "Copy as Plain Text"
  // — uses Electron's `parameters.selectionText` which is always plain
  // (no rich-clipboard payload), parallel to the Edit menu entry's
  // ⌘⌥C accelerator. Without this, right-click in the markdown editor
  // / canvas / browser pane was a no-op (Electron renderers don't get
  // a default menu without explicit wiring).
  //
  // electron-context-menu v4 is ESM-only — load via dynamic import so
  // the CJS main bundle stays compatible. Default export comes off
  // `.default` because esbuild interops the ESM namespace.
  //
  // ENH-031 v2 — ECM auto-attaches via `app.on('browser-window-created')`
  // only, so WebContentsView's (browser tabs) don't get the menu. Fix
  // by installing on every webContents via `app.on('web-contents-created')`.
  // This catches: main BrowserWindow, every browser tab WCV (created
  // by addTab), and any future webContents (devtools, popups, etc).
  // The per-webContents call is the same as ECM's internal init path
  // for windows, so behavior is identical to the auto-installed flavor.
  try {
    const mod = await import('electron-context-menu')
    const contextMenu = (mod as { default: (opts: ContextMenuOptions) => () => void }).default
    // Attach to existing webContents and any new ones. We close over
    // each `wc` so the right-click "Comment" entry can send the IPC
    // back to the same webContents that received the click — for
    // canvas iframes this is the main BrowserWindow's wc (iframes
    // share their parent's webContents in Electron).
    const buildEcmOptions = (wc: WebContents): ContextMenuOptions => ({
      showSelectAll: true,
      showCopyLink: true,
      showSaveImageAs: true,
      showInspectElement: !app.isPackaged,
      showLookUpSelection: true,
      showSearchWithGoogle: false,
      prepend: (_defaults, parameters) => {
        const sel = parameters.selectionText.trim()
        const items: MenuItemConstructorOptions[] = []
        if (sel.length > 0) {
          items.push({
            label: 'Copy as Plain Text',
            accelerator: 'CmdOrCtrl+Alt+C',
            click: () => clipboard.writeText(parameters.selectionText)
          })
          // Sprint 6 BUG-081 + Phase 4 — "Comment" entry. Two surfaces:
          //   (a) canvas iframes (srcdoc-based) — `frameURL` is
          //       `about:srcdoc`. Routed to PageTab's listener.
          //   (b) markdown editor — selection inside contentEditable
          //       on the main BrowserWindow's renderer (NOT a WCV
          //       browser tab). Routed to MarkdownEditor's listener
          //       via the same 'duo-start-comment' window event.
          // Both share the IPC.PAGE_COMMENT_REQUEST channel; the
          // renderer-side bridge in App.tsx re-dispatches as a
          // window CustomEvent which whichever surface is active
          // listens for. Browser-tab right-clicks live in their own
          // WCV webContents so this filter never applies to them.
          const isCanvasIframe = parameters.frameURL && parameters.frameURL.startsWith('about:srcdoc')
          const isMainRenderer = mainWindow !== null && wc === mainWindow.webContents
          const isContentEditable = parameters.editFlags?.canCut === true || parameters.isEditable === true
          if (isCanvasIframe || (isMainRenderer && isContentEditable)) {
            items.push({
              label: 'Comment',
              accelerator: 'CmdOrCtrl+Alt+M',
              click: () => {
                try { wc.send(IPC.PAGE_COMMENT_REQUEST) } catch { /* wc gone */ }
              }
            })
          }
        }
        return items
      }
    })
    for (const wc of webContents.getAllWebContents()) {
      contextMenu({ ...buildEcmOptions(wc), window: wc })
    }
    app.on('web-contents-created', (_event, wc) => {
      contextMenu({ ...buildEcmOptions(wc), window: wc })
    })
  } catch (err) {
    console.warn('[main] failed to install context menu:', err)
  }
  void createWindow()

  // Stage 18b — scan distro packs once on boot. Loader is defensive
  // (missing dir = empty registry; malformed manifests surface as
  // per-pack errors; never throws). The first-launch defaults hook
  // (Sprint B Commit 3) consumes the cached registry; the `duo
  // packs` CLI does too.
  void packLoader.scan().catch((err) => {
    console.warn('[main] PackLoader.scan failed:', err)
  })

  // Stage 21c — fire-and-forget auto-update check. No-ops in dev.
  // Uses Electron's native dialogs for v1 ("Update available — Download?"
  // and "Update downloaded — Restart to install?"); future phases can
  // replace with a banner-integrated experience.
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

// Stage 21c — flush any pending session-state write before quit so
// the user's last state lands on disk even on force-quit / cmd-Q
// during a debounce window.
app.on('before-quit', () => {
  void sessionStateService.flush()
  // Issue #27 — flush pending history writes too.
  void browserHistory.flush()
  // ENH-013 — stop polling.
  claudePresence.stop()
})

app.on('window-all-closed', () => {
  ptyManager.dispose()
  void filesService.dispose()
  // Best-effort final flush — `before-quit` already fired but the
  // disk write may still be in flight.
  void sessionStateService.flush()
  void browserHistory.flush()
  if (process.platform !== 'darwin') app.quit()
})

function setupIPC(): void {
  // ── PTY ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PTY_CREATE, (_event, { id, shell, cwd }: { id: string; shell?: string; cwd?: string }) => {
    ptyManager.create(id, shell, cwd)
  })

  ipcMain.handle(IPC.PTY_WRITE, (_event, { id, data }: { id: string; data: string }) => {
    ptyManager.write(id, data)
  })

  ipcMain.handle(IPC.PTY_RESIZE, (_event, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    ptyManager.resize(id, cols, rows)
  })

  ipcMain.handle(IPC.PTY_KILL, (_event, { id }: { id: string }) => {
    ptyManager.kill(id)
  })

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_event, { url }: { url: string }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.navigate(url)
  })

  ipcMain.on(IPC.BROWSER_BACK, () => {
    browserManager?.goBack()
  })

  ipcMain.on(IPC.BROWSER_FORWARD, () => {
    browserManager?.goForward()
  })

  ipcMain.on(IPC.BROWSER_RELOAD, () => {
    browserManager?.reload()
  })

  // Renderer reports the pixel bounds of the browser content area whenever
  // the split moves or the window resizes. We reposition the WebContentsView.
  ipcMain.on(IPC.BROWSER_BOUNDS, (_event, bounds: BrowserBounds) => {
    browserManager?.setBounds(bounds)
  })

  // Phase 3c — renderer reports aux-pane bounds for the aux-pinned
  // browser tab. Mirrors BROWSER_BOUNDS but routes to the separate
  // aux-bounds slot inside BrowserManager. Pushed from the
  // AuxBrowserSlot component on mount + ResizeObserver + window
  // resize + split divider drag.
  ipcMain.on(IPC.BROWSER_AUX_BOUNDS, (_event, bounds: BrowserBounds) => {
    browserManager?.setAuxBounds(bounds)
  })

  // Phase 3c — renderer asks main to pin a browser tab into the aux
  // slot. Returns the pinned tab's url + title so the renderer can
  // render the aux header without a second round trip.
  ipcMain.handle(IPC.BROWSER_MOVE_TAB_TO_AUX, (_event, tabId: number) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not initialized' }
    return browserManager.moveTabToAux(tabId)
  })

  // Phase 3c — renderer asks main to release the aux-pinned tab back
  // to the main strip. The released tab becomes main-strip active.
  ipcMain.handle(IPC.BROWSER_RELEASE_AUX_TAB, () => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not initialized' }
    return browserManager.releaseAuxTab()
  })

  // Stage 27 — renderer → main: emit a DuoEvent into the bus. Powers
  // the canvas-action `duo:event` verb. Sender is always the renderer
  // (canvas iframes have no allow-scripts, so canvas action handler
  // is the only producer); we accept the source field but defensively
  // clamp it to a known DuoEventSource.
  ipcMain.on(IPC.DUO_EVENT_EMIT, (_event, payload: {
    source?: DuoEventSource
    name?: string
    payload?: Record<string, unknown>
  }) => {
    if (!payload || typeof payload.name !== 'string' || !payload.name) return
    const validSources: DuoEventSource[] = ['canvas', 'editor', 'cli', 'main', 'renderer']
    const source: DuoEventSource = payload.source && validSources.includes(payload.source)
      ? payload.source
      : 'renderer'
    eventBus.emit({ source, name: payload.name, payload: payload.payload })
  })

  // BUG-047 — overlay-mute toggle. Renderer sends `{ muted: true }` when
  // a renderer-DOM overlay opens that would overlap the WebContentsView
  // (e.g. browser-pane tab right-click menu). Main collapses the WCV to
  // 1×1 so the menu renders unobstructed; restores on `{ muted: false }`.
  ipcMain.on(IPC.BROWSER_OVERLAY_MUTED, (_event, payload: { muted: boolean }) => {
    browserManager?.setOverlayMuted(payload.muted)
  })

  // BUG-048 v3 — renderer-driven OS focus reclaim. The ⌘` toggle
  // computes its direction in the renderer first, then asks main to
  // pull OS focus from a WebContentsView (if needed) so a subsequent
  // renderer-side `.focus()` call on xterm or the editor lands. See
  // App.tsx § togglePaneFocus.
  ipcMain.on(IPC.PANE_FOCUS_RECLAIM, () => {
    mainWindow?.webContents.focus()
  })

  // ENH-028 — find-in-page. Renderer's find bar (in BrowserRenderer)
  // sends START on each keystroke / next / prev navigation. Main calls
  // webContents.findInPage; results are pushed back via the
  // `found-in-page` event listener wired in BrowserManager.wireEvents.
  ipcMain.on(IPC.BROWSER_FIND_START, (_event, payload: { query: string; findNext?: boolean; forward?: boolean }) => {
    browserManager?.findInPage(payload.query, {
      findNext: payload.findNext,
      forward: payload.forward
    })
  })
  ipcMain.on(IPC.BROWSER_FIND_STOP, () => {
    browserManager?.stopFindInPage()
  })

  ipcMain.handle(IPC.BROWSER_GET_STATE, () => {
    return browserManager?.getState() ?? null
  })

  ipcMain.handle(IPC.BROWSER_GET_TABS, () => {
    return browserManager?.getTabs() ?? []
  })

  ipcMain.handle(IPC.BROWSER_ADD_TAB, async (_event, { url }: { url?: string }) => {
    if (!browserManager) return { ok: false, id: -1, url: '', title: '' }
    return browserManager.openTab(url)
  })

  ipcMain.handle(IPC.BROWSER_SWITCH_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.switchTab(id)
  })

  ipcMain.handle(IPC.BROWSER_CLOSE_TAB, async (_event, { id }: { id: number }) => {
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.closeTab(id)
  })

  // BUG-027 — ⌘⇧T from browser focus pops the last-closed tab.
  ipcMain.handle(IPC.BROWSER_REOPEN_LAST_CLOSED, async () => {
    if (!browserManager) return { ok: false, reason: 'no-browser-manager' }
    return browserManager.reopenLastClosed()
  })

  // Issue #27 — URL-bar autocomplete suggestions from persisted history.
  ipcMain.handle(IPC.BROWSER_HISTORY_SUGGEST, async (_event, args: { prefix: string; limit?: number }) => {
    return browserHistory.suggest(args.prefix ?? '', args.limit ?? 8)
  })

  ipcMain.on(IPC.BROWSER_FOCUS_ACTIVE, () => {
    browserManager?.focusActive()
  })

  // ── Files (Stage 10) ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.FILES_LIST, (_event, { path: p }: { path: string }) => {
    return filesService.list(p)
  })

  ipcMain.handle(IPC.FILES_READ, (_event, { path: p }: { path: string }) => {
    return filesService.read(p)
  })

  ipcMain.handle(IPC.FILES_WRITE, (_event, { path: p, bytes }: { path: string; bytes: Uint8Array }) => {
    return filesService.write(p, bytes)
  })

  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL, (_event, { path: p }: { path: string }) => {
    return filesService.openExternal(p)
  })

  ipcMain.handle(IPC.FILES_REVEAL_IN_FINDER, (_event, { path: p }: { path: string }) => {
    filesService.revealInFinder(p)
  })

  ipcMain.handle(IPC.FILES_GET_HTML_META, (_event, { path: p }: { path: string }) => {
    return filesService.getHtmlMeta(p)
  })

  // Stage 26 item 6 — file-mutation actions (right-click Delete / Rename + CLI parity).
  ipcMain.handle(IPC.FILES_TRASH, (_event, { path: p }: { path: string }) => {
    return filesService.trash(p)
  })
  ipcMain.handle(IPC.FILES_RENAME, (_event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
    return filesService.rename(oldPath, newPath)
  })

  // BUG-039 — existence check for session-restore tab hydration.
  ipcMain.handle(IPC.FILES_EXISTS, (_event, { path: p }: { path: string }) => {
    return filesService.exists(p)
  })

  // ENH-016 — create a directory (navigator "New folder…").
  ipcMain.handle(IPC.FILES_MKDIR, (_event, { path: p }: { path: string }) => {
    return filesService.mkdir(p)
  })

  // Stage 26 PR 3 item 8 — path-kind probe (editable breadcrumb).
  ipcMain.handle(IPC.FILES_KIND, (_event, { path: p }: { path: string }) => {
    return filesService.kind(p)
  })

  // Stage 24 — pinned WorkingPane tabs.
  ipcMain.handle(IPC.PINS_LIST, () => {
    return pinsService.list()
  })
  ipcMain.handle(IPC.PINS_TOGGLE, (_event, entry: import('../shared/types').PinEntry) => {
    return pinsService.toggle(entry)
  })

  // Stage 26 PR 2 (ENH-010) — pinned files & folders in the navigator.
  ipcMain.handle(IPC.NAV_PINS_LIST, () => {
    return navPinsService.list()
  })
  ipcMain.handle(IPC.NAV_PINS_TOGGLE, async (_event, entry: import('../shared/types').NavPinEntry) => {
    const next = await navPinsService.toggle(entry)
    // BUG-030 — push to renderer so any other subscriber (or other
    // window someday) sees the change live.
    mainWindow?.webContents.send(IPC.NAV_PINS_CHANGED, next)
    return next
  })

  // ENH-050 (v0.6.3) — native NSMenu + system sheet primitives that
  // replace the renderer-DOM ContextMenu / PinnedCloseConfirm /
  // trash-confirm modals. macOS draws these at the window-server
  // level, composing correctly above the WebContentsView regardless
  // of z-index — eliminates the WCV-mute pattern's flicker. See
  // `docs/DECISIONS.md § WCV-occlusion remediation` for rationale.
  ipcMain.handle(IPC.MENU_POPUP, async (_event, req: import('../shared/types').MenuPopupRequest): Promise<import('../shared/types').MenuPopupResult> => {
    return new Promise((resolve) => {
      let chosenId: string | null = null
      const template: MenuItemConstructorOptions[] = req.items.map(item => {
        if (item.type === 'separator') return { type: 'separator' }
        return {
          label: item.label ?? '',
          accelerator: item.accelerator,
          enabled: item.enabled !== false,
          click: () => { chosenId = item.id ?? null }
        }
      })
      const menu = Menu.buildFromTemplate(template)
      const win = mainWindow ?? undefined
      const popupOpts: { window?: BrowserWindow; x?: number; y?: number; callback?: () => void } = {
        callback: () => resolve({ chosenId })
      }
      if (win) popupOpts.window = win
      if (typeof req.x === 'number') popupOpts.x = Math.round(req.x)
      if (typeof req.y === 'number') popupOpts.y = Math.round(req.y)
      menu.popup(popupOpts)
    })
  })

  ipcMain.handle(IPC.DIALOG_CONFIRM, async (_event, req: import('../shared/types').DialogConfirmRequest): Promise<import('../shared/types').DialogConfirmResult> => {
    if (!mainWindow) return { response: req.cancelId ?? 0 }
    const result = await dialog.showMessageBox(mainWindow, {
      type: req.type ?? 'warning',
      title: req.title,
      message: req.title,
      detail: req.message,
      buttons: req.buttons,
      defaultId: req.defaultId ?? 0,
      cancelId: req.cancelId ?? 0,
      noLink: true
    })
    return { response: result.response }
  })

  // Stage 21c Phase 2 — session state restored across relaunches.
  ipcMain.handle(IPC.SESSION_STATE_LOAD, () => {
    return sessionStateService.load()
  })
  ipcMain.handle(IPC.SESSION_STATE_SAVE, (_event, state: import('../shared/types').SessionState) => {
    sessionStateService.save(state)
  })

  // Stage 18 — first-launch self-install.
  ipcMain.handle(IPC.INSTALL_STATUS, () => {
    return installService.status()
  })
  ipcMain.handle(IPC.INSTALL_RUN, () => {
    return installService.run()
  })
  // ENH-017 — banner-driven "Add to PATH" action.
  ipcMain.handle(IPC.INSTALL_ADD_TO_PATH, () => {
    return installService.addToShellPath()
  })

  // v0.4.0 — GitHub Releases update checker.
  ipcMain.handle(IPC.UPDATE_CHECK, () => {
    return updateChecker.maybeRefresh()
  })

  ipcMain.handle(IPC.FILES_WATCH_START, (event, { id, paths }: { id: string; paths: string[] }) => {
    filesService.startWatch(id, paths, event.sender, IPC.FILES_CHANGED)
  })

  ipcMain.handle(IPC.FILES_WATCH_UPDATE, (_event, { id, paths }: { id: string; paths: string[] }) => {
    return filesService.updateWatchPaths(id, paths)
  })

  ipcMain.handle(IPC.FILES_WATCH_STOP, (_event, { id }: { id: string }) => {
    return filesService.stopWatch(id)
  })

  // ── Navigator state cache (Stage 10 Phase 6) ──────────────────────────────
  // Renderer pushes its navigator state on every change; main caches the last
  // snapshot for `duo nav state` to return without a renderer round-trip.

  ipcMain.on(IPC.NAV_STATE_PUSH, (_event, snapshot: NavStateSnapshot) => {
    navState = snapshot
  })

  // Stage 11 — selection snapshot push from the active editor.
  ipcMain.on(IPC.EDITOR_SELECTION_PUSH, (_event, snapshot: EditorSelectionSnapshot | null) => {
    editorSelection = snapshot
  })

  // Stage 17c — canvas selection snapshot push from the active canvas.
  ipcMain.on(IPC.PAGE_SELECTION_PUSH, (_event, snapshot: PageSelectionSnapshot | null) => {
    canvasSelection = snapshot
  })

  // Stage 11 — renderer's reply to a doc-write request.
  ipcMain.on(IPC.EDITOR_DOC_WRITE_RESULT, (_event, result: DocWriteResult) => {
    const resolver = docWritePending.get(result.reqId)
    if (resolver) {
      docWritePending.delete(result.reqId)
      resolver(result)
    }
  })

  // ENH-022 (v0.5.4) — doc-goto reply.
  ipcMain.on(IPC.EDITOR_DOC_GOTO_RESULT, (_event, result: DocGotoResult) => {
    const resolver = docGotoPending.get(result.reqId)
    if (resolver) {
      docGotoPending.delete(result.reqId)
      resolver(result)
    }
  })

  // ENH-023 (v0.5.4) — doc-find reply.
  ipcMain.on(IPC.EDITOR_DOC_FIND_RESULT, (_event, result: DocFindResult) => {
    const resolver = docFindPending.get(result.reqId)
    if (resolver) {
      docFindPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Renderer's reply to a doc-read request (live editor buffer).
  ipcMain.on(IPC.EDITOR_DOC_READ_RESULT, (_event, result: DocReadResult) => {
    const resolver = docReadPending.get(result.reqId)
    if (resolver) {
      docReadPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 17b Phase C — renderer's reply to a `duo html *` op.
  ipcMain.on(IPC.PAGE_HTML_OP_RESULT, (_event, result: HtmlOpResult) => {
    const resolver = htmlOpPending.get(result.reqId)
    if (resolver) {
      htmlOpPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 17d — renderer's reply to a `duo html comment` / `duo html comments`.
  ipcMain.on(IPC.PAGE_HTML_COMMENT_RESULT, (_event, result: HtmlCommentResult) => {
    const resolver = htmlCommentPending.get(result.reqId)
    if (resolver) {
      htmlCommentPending.delete(result.reqId)
      resolver(result)
    }
  })
  ipcMain.on(IPC.PAGE_HTML_COMMENTS_LIST_RESULT, (_event, result: HtmlCommentsListResult) => {
    const resolver = htmlCommentsListPending.get(result.reqId)
    if (resolver) {
      htmlCommentsListPending.delete(result.reqId)
      resolver(result)
    }
  })

  // Stage 11 \u00a7 D33d \u2014 theme state push from the renderer.
  // BUG-017 fix (v0.3.1) \u2014 also sync nativeTheme.themeSource with the
  // user's mode so the renderer's `prefers-color-scheme` media query
  // reflects the user's choice. Without this, hardcoding
  // `nativeTheme.themeSource = 'light'` at boot (kept here so native
  // chrome \u2014 menus, dialogs \u2014 always look light) bleeds into the
  // renderer's matchMedia result, breaking 'system' mode (the renderer
  // would always see prefers-color-scheme=light regardless of OS).
  // Per the Electron docs, themeSource governs BOTH native chrome AND
  // the renderer's matchMedia, so we have to set it dynamically:
  //   - 'system' \u2192 follow OS (renderer's media query reflects OS)
  //   - 'light' / 'dark' \u2192 force that mode
  ipcMain.on(IPC.THEME_STATE_PUSH, (_event, snapshot: ThemeStateSnapshot) => {
    themeState = snapshot
    if (snapshot.mode === 'system' || snapshot.mode === 'light' || snapshot.mode === 'dark') {
      nativeTheme.themeSource = snapshot.mode
    }
  })

  // Stage 15 G19 \u2014 Send \u2192 Duo payload format push from the renderer.
  ipcMain.on(IPC.SELECTION_FORMAT_STATE_PUSH, (_event, snapshot: SelectionFormatStateSnapshot) => {
    selectionFormatState = snapshot
  })

  // ENH-041 / Sprint 3 \u2014 Split View aux state push. Renderer (App.tsx)
  // is the source of truth; main caches the latest snapshot for the
  // CLI's no-arg state query (`duo split-view`). Defensive shape check
  // because the renderer may push during boot before persistence
  // hydrates fully.
  ipcMain.on(IPC.WORKING_AUX_STATE_PUSH, (_event, snapshot: WorkingAuxSnapshot) => {
    if (snapshot && (snapshot.aux === null || (snapshot.aux && typeof snapshot.aux.activePath === 'string'))) {
      workingAuxSnapshot = snapshot
    }
  })

  // Stage 15 G17 \u2014 active terminal-tab id push from the renderer.
  // ENH-013 \u2014 the payload also carries `kind` so the claude-presence
  // probe can arm its starting-grace window for kind=='claude' tabs.
  ipcMain.on(IPC.TERMINAL_ACTIVE_PUSH, (_event, payload: { id: string | null; kind: 'claude' | 'shell' | null }) => {
    activeTerminalId = payload.id
    const pid = payload.id ? ptyManager.getPid(payload.id) : null
    claudePresence.setTarget({ pid, kind: payload.kind })
  })

  // Stage 19c D23 \u2014 renderer asks "is `claude` on PATH?" before spawning a
  // claude tab so it can choose between auto-typing `claude\n` and the
  // install-banner fallback. Resolved synchronously per call (cheap;
  // `which` is fast) so the answer always reflects PATH at the moment of
  // the spawn \u2014 covers the case where the user `brew install`s claude
  // mid-session and then opens a tab.
  ipcMain.handle('terminal:claude-on-path', () => isClaudeOnPath())

  // Stage 19c D27 \u2014 renderer reply to a `duo new-tab` request.
  ipcMain.on(IPC.NEW_TAB_RESULT, (_event, result: NewTabResult) => {
    const resolver = newTabPending.get(result.reqId)
    if (resolver) {
      newTabPending.delete(result.reqId)
      resolver(result)
    }
  })

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────
  // Renderer pushes the active tab's cozy state so the View-menu checkmark
  // stays in sync as the user switches tabs or toggles.

  ipcMain.on(IPC.COZY_STATE_PUSH, (_event, cozy: boolean) => {
    cozyActiveTab = cozy
    const menu = Menu.getApplicationMenu()
    if (!menu || !cozyMenuItemId) return
    const item = menu.getMenuItemById(cozyMenuItemId)
    if (item) item.checked = cozy
  })
}

// ── App menu ────────────────────────────────────────────────────────────────
// Minimal menu template — only the View submenu carries product-specific
// items today (cozy toggle). Everything else follows Electron defaults so
// macOS shortcuts like Cmd+Q / Cmd+H / Cmd+M still work.

function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  cozyMenuItemId = 'cozy-toggle'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        // ENH-002 / v0.4.0 — "Paste and Match Style" with macOS-
        // standard ⌘⇧V. Both editors (markdown + HTML canvas)
        // already handle ⌘⇧V via their own keydown handlers; this
        // adds the menu surface for discoverability. Click sends a
        // `paste-plain` IPC to the active editor, which performs
        // the same plain-text insert.
        {
          label: 'Paste and Match Style',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => {
            mainWindow?.webContents.send(IPC.PASTE_PLAIN_REQUEST)
          }
        },
        // ENH-030 — "Copy as Plain Text" with ⌘⌥C as a parallel for
        // macOS's standard "Paste and Match Style" (⌘⇧V). Reads the
        // current selection from the focused webContents (works for
        // markdown editor, canvas iframe, browser pane, and any nested
        // WebContentsView) and writes it to the clipboard with no
        // formatting marks. Falls back silently if no selection is
        // accessible (selection lives in a sandboxed origin, etc.).
        {
          label: 'Copy as Plain Text',
          accelerator: 'CmdOrCtrl+Alt+C',
          click: async () => {
            const wc = webContents.getFocusedWebContents()
            if (!wc) return
            try {
              const text = await wc.executeJavaScript(
                'String(window.getSelection?.()?.toString() ?? "")',
                true
              )
              if (typeof text === 'string' && text.length > 0) {
                clipboard.writeText(text)
              }
            } catch { /* selection cross-origin / inaccessible — silent no-op */ }
          }
        },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          id: cozyMenuItemId,
          label: 'Cozy mode — current tab',
          type: 'checkbox',
          checked: cozyActiveTab,
          click: () => {
            // Renderer flips authoritative state, then echoes back via
            // COZY_STATE_PUSH so the checkmark tracks the truth.
            mainWindow?.webContents.send(IPC.COZY_TOGGLE)
          }
        },
        {
          // Menu accelerator, not just a keyboard shortcut: macOS
          // intercepts ⌘` at the system level (its built-in "cycle
          // windows of the same app"). Registering it here routes the
          // key through Electron's menu system first, so the system
          // shortcut never sees it.
          //
          // BUG-048 v3 — DON'T pull OS-level focus here. The previous
          // implementation called `mainWindow.webContents.focus()`
          // BEFORE sending PANE_TOGGLE_FOCUS, but that reclaim fires
          // the xterm helper-textarea's `focus` event in the renderer
          // BEFORE the IPC arrives — and TerminalPane's focus listener
          // then flipped `focusedColumn` to 'terminal' as a side effect.
          // togglePaneFocus's `setFocusedColumn(prev => ...)` then read
          // prev='terminal' (poisoned) and toggled to 'working' instead
          // of the user's expected 'working' → 'terminal'. Now: the
          // renderer reads its OWN authoritative state first, decides
          // direction, then requests the focus reclaim via
          // PANE_FOCUS_RECLAIM (handled below). For the working →
          // browser direction the renderer calls `browser.focusActive()`
          // directly, no main-side reclaim needed.
          label: 'Toggle pane focus',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow?.webContents.send(IPC.PANE_TOGGLE_FOCUS)
          }
        },
        { type: 'separator' },
        // ENH-014 — preset pane sizes. Accelerators use ⌘⌥<digit>
        // because ⌘<digit> is already taken by jumpTerminalTab.
        // Range matches the divider drag clamp (20–80).
        {
          label: 'Pane size',
          submenu: [
            {
              label: 'Even (50/50)',
              accelerator: 'CmdOrCtrl+Alt+2',
              click: () => setSplit(50)
            },
            {
              label: 'Terminal heavy (67/33)',
              accelerator: 'CmdOrCtrl+Alt+1',
              click: () => setSplit(67)
            },
            {
              label: 'Canvas heavy (33/67)',
              accelerator: 'CmdOrCtrl+Alt+3',
              click: () => setSplit(33)
            },
            { type: 'separator' },
            {
              label: 'Full terminal',
              accelerator: 'CmdOrCtrl+Alt+0',
              click: () => setSplit(80)
            },
            {
              label: 'Full canvas',
              accelerator: 'CmdOrCtrl+Alt+9',
              click: () => setSplit(20)
            }
          ]
        },
        { type: 'separator' },
        // BUG-084 fix (v0.6.7) — Reload + Force Reload removed.
        // Electron's default `{ role: 'reload' }` auto-binds ⌘R to
        // webContents.reload(), which destroys every terminal tab,
        // every working tab, and every iframe canvas (PtyManager
        // keeps the PTYs alive but the renderer-side wiring is gone).
        // Duo isn't a web app and has no concept of "reload for
        // fresh content" — the chord was just a data-loss footgun.
        // Dev workflow retains toggleDevTools; reload-when-truly-
        // needed is `kill npm run dev` + restart.
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        // Move "Close Window" to ⌘⇧W so plain ⌘W is reserved entirely
        // for closing the FOCUSED TAB via the renderer's globalShortcuts
        // matcher (see renderer/keyboard/globalShortcuts.ts § 'closeTab').
        // Chrome uses the same convention. Without this, the default
        // role-assigned ⌘W accelerator ALSO fires BrowserWindow.close()
        // alongside the renderer's tab-close — losing every working
        // tab + form data when the user just meant to dismiss one.
        // Discovered 2026-05-02 mid-smoke-walk (user lost ~20 min of
        // walk notes typed into smoke-walk-page textareas because the
        // window close took the form data with it).
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// Helpers exposed to SocketServer via `NavBridge` (passed below).

export function getNavState(): NavStateSnapshot {
  return navState
}

export function sendReveal(path: string): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.NAV_REVEAL, path)
  return { ok: true }
}

export function sendView(path: string, mode?: 'canvas' | 'browser'): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  // ENH-097 — when a mode override is supplied, send a {path, mode}
  // payload; otherwise keep the bare-string payload for backwards
  // compat with existing renderer subscribers (NAV_VIEW / NAV_EDIT
  // both originally took a plain `path: string`).
  mainWindow.webContents.send(IPC.NAV_VIEW, mode ? { path, mode } : path)
  return { ok: true }
}

export function sendEdit(path: string, mode?: 'canvas' | 'browser'): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.NAV_EDIT, mode ? { path, mode } : path)
  return { ok: true }
}

export function getEditorSelection(): EditorSelectionSnapshot | null {
  return editorSelection
}

// Stage 17c — drives `duo selection --pane canvas` and the auto-select
// path's html-canvas branch.
export function getCanvasSelection(): PageSelectionSnapshot | null {
  return canvasSelection
}

/**
 * Stage 11 \u2014 dispatch a doc-write request to the renderer's active editor
 * and wait for the reply. Times out at 5s to avoid CLI hangs if the
 * renderer is busy.
 */
export function getThemeState(): ThemeStateSnapshot {
  return themeState
}

export function setThemeMode(mode: ThemeMode): { ok: boolean; error?: string } {
  if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
    return { ok: false, error: `Invalid theme mode: ${mode}. Expected system|light|dark.` }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.THEME_SET, mode)
  return { ok: true }
}

// ENH-014 — `duo split <pct>` and View → Pane size menu items both
// land here. Renderer clamps to the divider drag's 20–80 range; the
// validator below mirrors that so an invalid CLI value errors at the
// socket boundary instead of a silent clamp.
export function setSplit(pct: number): { ok: boolean; pct?: number; error?: string } {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return { ok: false, error: 'split pct must be a finite number' }
  }
  const clamped = Math.min(Math.max(pct, 20), 80)
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.SPLIT_SET, clamped)
  return { ok: true, pct: clamped }
}

// ENH-041 / Sprint 3 — Split View aux pane CLI handlers. Renderer
// (App.tsx) owns the aux useState; these helpers dispatch a verb via
// IPC and rely on the renderer to push state back via
// WORKING_AUX_STATE_PUSH. The CLI's no-arg state query reads
// `workingAuxSnapshot` directly (renderer-pushed cache).

export function splitViewOpen(path: string): { ok: boolean; error?: string } {
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'split-view open requires a path' }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  // Tilde expansion for parity with sendEdit (path-link clicks via
  // ENH-039 already expand tildes; CLI callers may pass `~/...` too).
  let expanded = path
  if (expanded === '~') {
    expanded = homedir()
  } else if (expanded.startsWith('~/')) {
    expanded = join(homedir(), expanded.slice(2))
  }
  mainWindow.webContents.send(IPC.WORKING_AUX_OPEN, expanded)
  return { ok: true }
}

/** Phase 3c — pin a browser tab into the aux slot. Carries the
 *  numeric BrowserTab id (from `duo tab` listing). Renderer's
 *  WORKING_AUX_OPEN_BROWSER subscriber calls
 *  `splitViewMoveBrowserTab(id)`. */
export function splitViewOpenBrowser(browserTabId: number): { ok: boolean; error?: string } {
  if (!Number.isInteger(browserTabId) || browserTabId < 1) {
    return { ok: false, error: 'split-view open-browser requires a positive integer tab id' }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  if (!browserManager) {
    return { ok: false, error: 'BrowserManager not initialized' }
  }
  // Validate the tab exists before round-tripping — a fast CLI error
  // is friendlier than a silent renderer-side no-op.
  const tabs = browserManager.getTabs()
  if (!tabs.some(t => t.id === browserTabId)) {
    return { ok: false, error: `No browser tab with id ${browserTabId}` }
  }
  mainWindow.webContents.send(IPC.WORKING_AUX_OPEN_BROWSER, browserTabId)
  return { ok: true }
}

export function splitViewClose(): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.WORKING_AUX_CLOSE, null)
  return { ok: true }
}

export function splitViewPromote(): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.WORKING_AUX_PROMOTE, null)
  return { ok: true }
}

export function splitViewResize(pct: number): { ok: boolean; pct?: number; error?: string } {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return { ok: false, error: 'split-view resize requires a finite numeric pct (0.0–1.0)' }
  }
  // Clamp to the same 20–80 range the existing terminal/canvas
  // divider uses — locked spec § 7. Accept either decimal (0.20–0.80)
  // or percent (20–80) for caller convenience; > 1 is treated as %.
  const decimal = pct > 1 ? pct / 100 : pct
  const clamped = Math.min(Math.max(decimal, 0.20), 0.80)
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.WORKING_AUX_RESIZE, clamped)
  return { ok: true, pct: clamped }
}

export function getSplitViewState(): WorkingAuxSnapshot {
  return workingAuxSnapshot
}

// Stage 15 G19 — `duo selection-format` reads the cache; `duo
// selection-format <a|b|c>` dispatches a SET to the renderer, which
// persists to localStorage and pushes the new state back.
export function getSelectionFormatState(): SelectionFormatStateSnapshot {
  return selectionFormatState
}

export function setSelectionFormat(format: SelectionFormat): { ok: boolean; error?: string } {
  if (format !== 'a' && format !== 'b' && format !== 'c') {
    return { ok: false, error: `Invalid selection-format: ${format}. Expected a|b|c.` }
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  mainWindow.webContents.send(IPC.SELECTION_FORMAT_SET, format)
  return { ok: true }
}

// Stage 13b — doc-write timeout has to accommodate the human-in-the-loop
// case: when the buffer is dirty, the renderer surfaces a
// <WriteWarningBanner> and waits for the human to accept or decline. The
// agent's CLI is blocked on this promise the whole time, so the timeout
// has to be long enough to cover real reading + decision time. 5 minutes
// is conservative — enough for a thoughtful read, short enough that a
// genuinely abandoned write doesn't pin the agent forever. doc-read
// stays on the original 5s budget (no human gate).
const DOC_WRITE_TIMEOUT_MS = 5 * 60 * 1000

export function dispatchDocWrite(req: Omit<DocWriteRequest, 'reqId'>): Promise<DocWriteResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocWriteResult>((resolve) => {
    const timer = setTimeout(() => {
      docWritePending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${DOC_WRITE_TIMEOUT_MS / 1000}s` })
    }, DOC_WRITE_TIMEOUT_MS)
    docWritePending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_WRITE, { ...req, reqId })
  })
}

export function dispatchDocRead(req: Omit<DocReadRequest, 'reqId'>): Promise<DocReadResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocReadResult>((resolve) => {
    const timer = setTimeout(() => {
      docReadPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docReadPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_READ, { ...req, reqId })
  })
}

// ENH-022 (v0.5.4) — `duo doc goto`. Same shape as dispatchDocWrite,
// short timeout (no human gate; the renderer just resolves a target
// + scrolls into view, bounded by frame budget).
export function dispatchDocGoto(req: Omit<DocGotoRequest, 'reqId'>): Promise<DocGotoResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocGotoResult>((resolve) => {
    const timer = setTimeout(() => {
      docGotoPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docGotoPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_GOTO, { ...req, reqId })
  })
}

// ENH-023 (v0.5.4) — `duo doc find`. Read-only, fast — same 5s budget.
export function dispatchDocFind(req: Omit<DocFindRequest, 'reqId'>): Promise<DocFindResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocFindResult>((resolve) => {
    const timer = setTimeout(() => {
      docFindPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docFindPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.EDITOR_DOC_FIND, { ...req, reqId })
  })
}

// Stage 17b Phase C — dispatch a `duo html *` op to the active canvas
// tab and await its reply. 30s timeout: ample for any single DOM op
// (queries are sub-ms; writes are milliseconds at worst). If no canvas
// is active, the renderer's PageTab subscription doesn't fire and
// the timeout returns the error.
const HTML_OP_TIMEOUT_MS = 30_000

export function dispatchHtmlOp(req: Omit<HtmlOpRequest, 'reqId'>): Promise<HtmlOpResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlOpResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlOpPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlOpPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.PAGE_HTML_OP, { ...req, reqId })
  })
}

// Stage 17d — `duo html comment` / `duo html comments`. Same 30s timeout
// as html-op (DOM ops are fast; the timeout window only matters when no
// canvas is active to subscribe).
export function dispatchHtmlComment(req: Omit<HtmlCommentRequest, 'reqId'>): Promise<HtmlCommentResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.PAGE_HTML_COMMENT, { ...req, reqId })
  })
}

export function dispatchHtmlCommentsList(req: Omit<HtmlCommentsListRequest, 'reqId'>): Promise<HtmlCommentsListResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hcl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentsListResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentsListPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentsListPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.PAGE_HTML_COMMENTS_LIST, { ...req, reqId })
  })
}

// Stage 5 v2 A24 — open a URL in the system default browser. The duo
// subagent reaches for this when a target hostname is on the user's
// `~/.claude/duo/external-domains.json` list (sites that don't render
// well in the embedded WebContentsView, or that the user wants to
// keep cookied in their personal browser). We validate the URL parses
// and only honour http/https/mailto schemes — refusing file:// and
// other dangerous schemes that `shell.openExternal` would happily
// route into native handlers.
// Stage 15 G17 — `duo send <text>` writes a payload into the active
// terminal's PTY. No Enter is appended (G11) — the user (or a chained
// agent verb) confirms by hitting Enter themselves. If no terminal is
// active (no tabs, or the last tab was just killed), surface an error
// rather than silently dropping the write.
export function sendToActiveTerminal(text: string): { ok: boolean; written?: number; terminalId?: string; error?: string } {
  if (typeof text !== 'string') {
    return { ok: false, error: 'send requires a string text payload' }
  }
  if (activeTerminalId === null) {
    return { ok: false, error: 'No active terminal — open one and try again' }
  }
  try {
    ptyManager.write(activeTerminalId, text)
    return { ok: true, written: text.length, terminalId: activeTerminalId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Stage 17a — `duo html new <path>`. Writes the H17 boilerplate atomically
// via FilesService, then dispatches NAV_EDIT to the renderer; the
// renderer's classifier routes `.html` to the html-canvas tab type. Title
// defaults to the file's basename without extension. Path validation
// (must end in .html / .htm) happens in socket-server.
export async function htmlNew(absPath: string, title?: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  try {
    const base = absPath.slice(absPath.lastIndexOf('/') + 1).replace(/\.html?$/i, '')
    const docTitle = title ?? base ?? 'Untitled'
    const html = htmlBoilerplate(docTitle)
    const bytes = new TextEncoder().encode(html)
    await filesService.write(absPath, bytes)
    mainWindow.webContents.send(IPC.NAV_EDIT, absPath)
    return { ok: true, path: absPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Stage 19c D23 — does the user's shell know where `claude` is? The
// renderer uses this answer to decide between auto-typing `claude\n`
// and printing the install banner.
//
// v0.4.5: re-implemented on top of resolveClaudeBinary() (which asks
// the user's actual shell — interactive + login — so .zshrc PATH
// additions are picked up). v0.4.4 used a bare `which claude` against
// Electron's inherited PATH, which on Finder-launched apps only
// contains the macOS-default /usr/bin:/bin:/usr/sbin:/sbin and never
// the user's ~/.local/bin where the official Claude Code installer
// drops the binary. Result: every Finder-launched Duo terminal tab
// printed the "Install Claude Code" banner even when claude WAS
// installed.
async function isClaudeOnPath(): Promise<boolean> {
  return (await resolveClaudeBinary()) !== null
}

// Stage 19c D27 — dispatch a `duo new-tab` request to the renderer and
// wait for the reply. Mirrors dispatchDocWrite / dispatchDocRead.
// Renderer owns tab state, so it's the source of truth for the new tab's
// id/cwd/title; main just brokers the request and resolves on its reply.
const NEW_TAB_TIMEOUT_MS = 5000

export function dispatchNewTab(
  req: Omit<NewTabRequest, 'reqId'>
): Promise<NewTabResult> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<NewTabResult>((resolve) => {
    const timer = setTimeout(() => {
      newTabPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${NEW_TAB_TIMEOUT_MS / 1000}s` })
    }, NEW_TAB_TIMEOUT_MS)
    newTabPending.set(reqId, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    mainWindow!.webContents.send(IPC.NEW_TAB_REQUEST, { ...req, reqId })
  })
}

export async function openExternalUrl(url: string): Promise<{ ok: boolean; opened?: string; error?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `Not a valid URL: ${url}` }
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:' && scheme !== 'mailto:') {
    return { ok: false, error: `Refusing to open scheme "${scheme}" externally — only http/https/mailto allowed` }
  }
  try {
    await shell.openExternal(url)
    // Stage 25 — push a post-redirect event so the renderer can
    // surface a small "Sent <host> to your default browser" banner.
    // The renderer auto-dismisses after a few seconds; the user
    // doesn't have to interact with it.
    if (mainWindow && !mainWindow.isDestroyed() && (scheme === 'http:' || scheme === 'https:')) {
      const host = parsed.hostname
      const match = externalDomainsService?.match(host)
      const push: ExternalRedirectedPush = { host, reason: match?.reason || undefined }
      mainWindow.webContents.send(IPC.EXTERNAL_REDIRECTED, push)
    }
    return { ok: true, opened: url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Stage 25 + BUG-040 (v0.5.3) — per-domain reason lookup now lives
// on `externalDomainsService`. Both this agent path
// (`openExternalUrl`) and the BrowserManager's user-driven
// will-navigate interceptor share the same matcher + cache.
