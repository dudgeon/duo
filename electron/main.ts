import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, protocol, session, shell, webContents, clipboard } from 'electron'
import type { MenuItemConstructorOptions, WebContents } from 'electron'
import * as nodeFs from 'fs/promises'
import { watch as fsWatchSync, mkdirSync as fsMkdirSync, existsSync as fsExistsSync, realpathSync as fsRealpathSync } from 'fs'
import * as nodePath from 'path'
import { execSync, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// BUG-148 — suppress EPIPE on stdout/stderr. When the parent process
// (npm / electron-vite / the launching terminal) detaches or closes
// its pipe, the next write throws EPIPE → uncaught exception → a
// user-visible "JavaScript error occurred in the main process"
// dialog. The dev console-forwarder at the bottom of createMainWindow
// fires once per renderer console.log, so a closed pipe makes the
// dialog re-appear after every dismissal until the app is killed.
// This is the canonical Node-on-broken-pipe pattern (mirror of what
// `node script.js | head` needs to survive head's early exit).
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})

// ENH-108 / ENH-111 (Sprint 12 walk-1 fix) — register the `duo-asset://`
// custom protocol BEFORE app.whenReady so the renderer can load local
// files via `<img src="duo-asset://abs/path/to/file.png">`. The renderer
// runs at `http://localhost:5173/` in dev (electron-vite dev server) so
// `file://` images are blocked by Chromium's same-origin policy. The
// existing `<img src="file://...">` pattern in ImageView (and the
// pre-Sprint-12 ImagePreview) was a latent bug that only worked in
// production where the renderer is also at `file://`. duo-asset:// works
// in both surfaces. Schema rules: `secure: true` lets it load on https /
// http origins; `standard: true` enables URL parsing; `supportFetchAPI`
// + `stream` enable fetch() and Response streams.
protocol.registerSchemesAsPrivileged([
  // `corsEnabled: true` is required for the renderer (running at
  // http://localhost:5173 in dev) to issue cross-origin requests for
  // duo-asset:// URLs — without it, Chromium blocks `<img src>`
  // requests across origin scheme boundaries even with `secure: true`.
  // `bypassCSP: true` covers any future CSP we add to the renderer.
  // `allowServiceWorkers: true` is harmless even without SW use.
  { scheme: 'duo-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }
])
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
import { makeSafeSend } from './safe-send'
import { WindowRegistry, type WindowContext } from './window-registry'
import { makeOnceGuard } from './once-guard'
import { resolveDefault, resolveBySender, broadcastAll } from './window-resolve'
import { WindowKeyedCache, defaultWindowId } from './cache-key'
import { PendingRegistry } from './reqid-validate'
import { routeAmbientCue } from './eventsink-route'
import { makeWindowTeardown } from './window-teardown'
import { SocketServer, ensureSocketDir } from '../core/socket-server'
import { FilesService } from './files-service'
import { PinsService } from '../core/pins-service'
import { NavPinsService } from '../core/nav-pins-service'
import { ProjectsService } from '../core/projects-service'
import { InstallService } from './install-service'
import {
  discoverPacks,
  installPack,
  mergeDistroClaudeMd,
  setManifestClaudeMdFlag,
  uninstallPack,
  listInstalledPacks
} from './distro-pack-service'
import { UpdateChecker } from '../core/update-checker'
import { initAutoUpdater } from './auto-updater'
import { SessionStateService } from '../core/session-state-service'
import { SettingsService } from '../core/settings-service'
import { WorkspaceFileService } from '../core/workspace-file-service'
import { WorkspaceHistoryService } from '../core/workspace-history-service'
import { ActiveWorkspaceService } from '../core/active-workspace-service'
import { BROWSER_SESSION_PARTITION } from '../core/constants'
import { ClaudePresenceProbe, mapLiveClaudeOwners } from '../core/claude-presence'
import { buildResumeCommand, detectLatestClaudeSession, encodeProjectDir, listTopLevelSessions } from './claude-session-tracker'
import { CronStore } from '../core/cron-store'
import { CronService } from '../core/cron-service'
import { deepestEnclosingRoot } from '../shared/projects'
import { FEATURE_HEADLESS_CRON } from '../shared/feature-flags'
import { buildHomeSnapshot, listHomeSessions, attributeOpenSessions, type OpenByUuid, type LiveCwdGroup } from './home-snapshot'
import { BrowserHistoryService } from '../core/browser-history-service'
import { ExternalDomainsService } from '../core/external-domains-service'
import { EventBus, type DuoEventSource } from '../core/event-bus'
import { PackLoader } from '../core/pack-loader'
import { InstalledPacksService } from '../core/installed-packs-service'
// ENH-208 Phase 2 — main runs the same vault core the CLI bundles, so the
// renderer UI (⇧⌘N capture · ⌘⇧F search · type-picker · Settings picker)
// produces byte-identical artifacts to `duo vault capture|search|stub|default`.
import * as vaultCore from '../core/vault'
import { IPC, EMPTY_SESSION_STATE } from '../shared/types'
import { htmlBoilerplate } from '../shared/html-boilerplate'
import { abbreviateHome } from '../shared/path-display'
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
  SelectionFormat,
  SelectionFormatStateSnapshot,
  NewTabRequest,
  NewTabResult,
  ExternalRedirectedPush,
  WorkingAuxSnapshot,
  HomeSnapshot,
  HomeSession,
  HomeSessionAction,
  HomeSessionActionResult
} from '../shared/types'

// Last nav state snapshot the renderer pushed. Drives `duo nav state`.
// Starts with sensible defaults so a CLI call before the renderer has
// pushed anything returns a well-formed object.
const navStateCache = new WindowKeyedCache<NavStateSnapshot>(() => ({
  cwd: process.env.HOME ?? '/',
  selected: null,
  expanded: [],
  pinned: false,
  // ENH-172 — showDotfiles defaults to false; gets overwritten by
  // the first NAV_STATE_PUSH from the renderer (which reads the
  // persisted value out of localStorage).
  showDotfiles: false
}))

// Stage 11 \u00a7 D29a — most recent selection snapshot from the active editor.
// `null` means no editor tab is active or no doc is loaded.
const editorSelectionCache = new WindowKeyedCache<EditorSelectionSnapshot | null>(() => null)

// Stage 17c — most recent selection snapshot from the active HTML canvas.
// `null` means no canvas tab is active or no element is selected. Drives
// `duo selection --pane canvas`.
const canvasSelectionCache = new WindowKeyedCache<PageSelectionSnapshot | null>(() => null)

// Pending doc-write requests awaiting a renderer reply.
const docWritePending = new PendingRegistry<DocWriteResult>()

// Pending doc-read requests awaiting a renderer reply.
const docReadPending = new PendingRegistry<DocReadResult>()

// ENH-022 / ENH-023 (v0.5.4) — pending doc-goto / doc-find requests
// awaiting a renderer reply. Same pairing pattern as docWritePending.
const docGotoPending = new PendingRegistry<DocGotoResult>()
const docFindPending = new PendingRegistry<DocFindResult>()

// Stage 17b Phase C — pending `duo html *` ops awaiting a renderer reply.
const htmlOpPending = new PendingRegistry<HtmlOpResult>()

// ENH-195 — pending `duo doc edit` (PLAIN replace) requests awaiting a
// renderer reply. Same Map-pairing pattern as docWritePending.
const docEditPlainPending = new PendingRegistry<DocEditPlainResult>()

// ENH-195 — pending `duo json set|merge` ops awaiting a renderer reply.
// Same Map-pairing pattern as htmlOpPending.
const jsonOpPending = new PendingRegistry<JsonOpResult>()

// ENH-108 (Sprint 12) — pending `duo image insert` requests awaiting
// a renderer reply. Same Map-pairing pattern as docWritePending.
const imageInsertPending = new PendingRegistry<import('../shared/types').ImageInsertResult>()

// Stage 17d — pending `duo html comment` / `duo html comments` requests
// awaiting a renderer reply. Same Map-pairing pattern as htmlOpPending.
const htmlCommentPending = new PendingRegistry<HtmlCommentResult>()
const htmlCommentsListPending = new PendingRegistry<HtmlCommentsListResult>()

// ENH-167 — pending snapshot requests. main asks the renderer for the
// live SessionState (bypassing the autosave debounce) before writing a
// .duo-workspace file (legacy: was ".duo-session", renamed v1.3).
const sessionSnapshotPending = new PendingRegistry<import('../shared/types').SessionState>()

// Stage 11 \u00a7 D33d \u2014 most recent theme state pushed by the renderer.
// Drives `duo theme` reads. Renderer is the source of truth.
const themeStateCache = new WindowKeyedCache<ThemeStateSnapshot>(() => ({ mode: 'system', effective: 'dark' }))

// Sprint 16 / v0.6.15 \u2014 most recent Claude-tab Enter key prefs pushed
// by the renderer. Drives `duo claude-return` / `duo shift-return`
// reads. Defaults here mirror the renderer hook's defaults
// (claudeReturn='submit', shiftReturn='newline'); the renderer
// overwrites on first pushState after mount.
const claudeKeyPrefsStateCache = new WindowKeyedCache<import('../shared/types').ClaudeKeyPrefsSnapshot>(() => ({
  claudeReturn: 'submit',
  shiftReturn: 'newline'
}))

// BUG-138 Phase 2 \u2014 author identity (CriticMarkup attribution).
// Renderer owns localStorage('duo:author') + pushes the current value
// on mount. Default '' until the renderer's first pushState arrives.
// `duo author` reads from this cache; `duo author "<name>"` re-emits
// to the renderer over AUTHOR_SET which then persists to localStorage.
const authorStateCache = new WindowKeyedCache<import('../shared/types').AuthorStateSnapshot>(() => ({
  author: ''
}))

// Stage 15 G19 — Send → Duo payload format. Renderer is the source of
// truth (persisted in localStorage); main caches the latest snapshot
// for `duo selection-format` reads. Default 'a' (quote + provenance).
const selectionFormatStateCache = new WindowKeyedCache<SelectionFormatStateSnapshot>(() => ({ format: 'a' }))

// ENH-041 / Sprint 3 — Split View aux pane snapshot cache. Renderer
// is the source of truth (App.tsx owns the aux useState); main caches
// the latest snapshot pushed via WORKING_AUX_STATE_PUSH so the no-arg
// `duo split-view` state query can answer without a renderer round-
// trip. Defaults to closed (aux: null) until first push.
const workingAuxSnapshotCache = new WindowKeyedCache<WorkingAuxSnapshot>(() => ({ aux: null }))

// Stage 15 G17 — most recent active terminal-tab id pushed by the
// renderer. `duo send` writes payloads into this terminal's PTY.
// `null` means no terminal tabs exist (degenerate state — `duo send`
// surfaces an error).
const activeTerminalIdCache = new WindowKeyedCache<string | null>(() => null)

// ENH-013 / ENH-191 P3-S8 — claude-presence is now PER-WINDOW. Each window's
// createWindow constructs its own ClaudePresenceProbe into ctx.presence (polls
// THAT window's active terminal's PTY tree for a live `claude` descendant and
// gates THAT window's Send → Duo pill). No module global — TERMINAL_ACTIVE_PUSH
// routes setTarget to the owning window's probe by event.sender.

// ENH-183 (post-walk-1 owner directive) — per-Duo-session set of tab
// ids that have ever hosted a live Claude process. The workspace-save
// enrichment hook consults this so it only captures
// `lastClaudeSession.id` for tabs that *actually* ran Claude during
// this Duo run — fresh shell tabs in a CWD with recent JSONLs no
// longer inherit a UUID just by being there. Without this gate, the
// enrichment hook over-captures and S3's "This tab had: …" banner
// fires on tabs that never *had* anything. Reset on Duo restart by
// construction (in-memory only, D9 invariant); on the next run, only
// tabs whose lastClaudeSession was persisted to workspace state from
// a prior run survive as S3-eligible.
// ENH-191 P3-S8c — now PER-WINDOW (ctx.tabsThatHostedClaude), seeded in
// createWindow + written by THIS window's presence fan-out, so the shared PTY
// pool can't leak S3 eligibility across windows. No module global.

// Stage 19c D27 — pending `duo new-tab` requests awaiting a renderer
// reply. Shape mirrors docWritePending / docReadPending.
const newTabPending = new PendingRegistry<NewTabResult>()

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

// ENH-191 P2 — the registry-of-one spine (Map<windowId, WindowContext>)
// REPLACES the former `let mainWindow` global. Holds EXACTLY ONE context
// through P0-P4, so registry.only() resolves byte-identically to the old
// mainWindow until a second window can open (P5a). createWindow() builds the
// sole window as a local const + registers its context; the 'closed' handler
// unregisters by id. Every main->renderer read resolves through the registry:
// safeSend + resolveDefault (sends), liveMainWindow (dialog/title/devtools),
// liveBrowser/liveCdp (managers), broadcastAll (shared-state fan-out).
const registry = new WindowRegistry()

// BUG-190 — a webContents.send that's safe to call from async callbacks
// (PTY data, socket events, CDP-driven browser state) that can fire
// mid-quit. `mainWindow?.` guards only null; during teardown `mainWindow`
// is still set but its webContents is already destroyed, so the bare send
// throws "Object has been destroyed". On quit, `before-quit` kills the
// PTYs, which flush a final burst of onData — each throwing send was an
// uncaught exception, and node-pty kept emitting buffered output, so the
// crash dialog looped until force-quit. Route every async-callback sink
// through this guard. Pure-logic factory lives in ./safe-send so it can
// be exercised from a vitest node env (see safe-send.test.ts).
const safeSend = makeSafeSend(() => resolveDefault(registry) ?? null)

// ENH-191 P5a — the FOCUSED-window resolution seam for app-menu commands. The
// native app menu is a single app-global NSMenu, but its per-window items (the
// checkbox `checked:` reads + the menu-click sends) must target the window the
// user is looking at. We track the last-focused window id via the
// `browser-window-focus` app event (registered in whenReady), which HANDS us
// the focused window — so there is NO ad-hoc focus query (the kind the routing
// grep-gate bans), keeping that gate at 0 and honoring the cardinal rule (menu
// commands resolve by registry IDENTITY, not an ad-hoc focus query). The
// fallback focusedWindowId() below
// back to the primary (lowest-id) window when the tracked id is stale/unset, so
// a menu fired before any focus event still resolves deterministically.
let lastFocusedWindowId: number | null = null
function focusedWindowId(): number | undefined {
  if (lastFocusedWindowId != null && registry.get(lastFocusedWindowId)) {
    return lastFocusedWindowId
  }
  return defaultWindowId(registry)
}
// A safeSend bound to the FOCUSED window — the menu-click analog of `safeSend`
// (which targets the primary). For app-menu items that act on "the window the
// user is in" (New File/Folder, Paste-plain, Cozy toggle, pane focus, View
// source). Falls back to the primary window via focusedWindowId().
const safeSendFocused = makeSafeSend(() => {
  const id = focusedWindowId()
  return id != null ? (registry.get(id)?.window ?? null) : null
})

// ENH-191 P5a (Tier-3/S4) — the per-CLI-request target window. SocketServer.
// handle() sets this from req.windowId (the terminal's DUO_WINDOW stamp / an
// explicit --window N) synchronously BEFORE dispatching each command, and every
// CLI helper reads it synchronously at its entry (before any await), so there's
// no interleave window even under concurrent connections. Reset per request
// (undefined when unstamped → primary fallback). Never persisted; pure in-memory
// request context (DECISIONS.md rule #12 allows in-memory session state).
let cliTargetWindowId: number | undefined

// ENH-191 P5a — resolve a target window: an EXPLICIT id (the app-menu's
// focusedWindowId(), a caller's chosen id) wins; else the per-CLI-request
// cliTargetWindowId (DUO_WINDOW, set by SocketServer.handle); else the primary
// (lowest-id) window. Never focus-resolved here (ids are resolved by the
// caller). The dual-use helpers (setSplit / setHiddenFiles / setClaudeReturnMode
// / setLayout3wayEven / openCloneModal) call this with the menu's explicit id OR
// undefined (CLI → cliTargetWindowId); the ~31 CLI-only NavBridge helpers call
// windowByIdOrPrimary(undefined) so a `duo --window N` verb hits window N.
function windowByIdOrPrimary(windowId?: number): BrowserWindow | null {
  const id = windowId ?? cliTargetWindowId
  if (id != null) return (registry.get(id)?.window as BrowserWindow | undefined) ?? null
  return liveMainWindow()
}

// ENH-191 P5a (Tier-3) — the addressed window id for CLI cache READERS: the
// per-request cliTargetWindowId (DUO_WINDOW / --window N) else the primary
// (lowest-id). Cache readers use `cache.getOrDefault(cliDefaultWindowId())` so
// `duo --window N theme|nav-state|selection|…` reads window N's slot. Resolved
// by IDENTITY, never focus. (defaultWindowId stays CLI-context-free — it also
// backs class-(i) sends + cache eager-writes that must not pick up the CLI
// target.)
function cliDefaultWindowId(): number | undefined {
  return cliTargetWindowId ?? defaultWindowId(registry)
}

// ENH-191 P5a (Tier-3) — the ADDRESSED window's BrowserManager for CLI nav verbs
// that drive the browser pane WITHOUT going through the socket's getBrowser
// thunk (devtools --browser-pane, split-view open-browser). cliDefaultWindowId()
// = cliTargetWindowId ?? primary; never throws (registry.get). So `duo --window
// N devtools --browser-pane` opens window N's pane, matching the verb's `win`.
function cliBrowserManager(): BrowserManager | null {
  const id = cliDefaultWindowId()
  return (id != null ? (registry.get(id)?.browserManager as BrowserManager | undefined) : undefined) ?? null
}

// ENH-191 P1c — single teardown orchestrator for the whole app lifecycle.
// MUST be module scope: the closed handler AND before-quit share its
// appTornDown / tornDownWindows guards — that shared state is what makes the
// closed→before-quit double-stop impossible. Do NOT move inside createWindow.
const windowTeardown = makeWindowTeardown()

// ENH-191 P2 (item 8) — run-once guard for the app-scoped duo-asset protocol
// registration. Module scope (survives a reentrant createWindow / dock-reopen)
// so the persist:duo-browser partition handler can never be registered twice
// (Electron throws an opaque duplicate-handler error). See once-guard.ts.
const registerDuoAssetOnce = makeOnceGuard()
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
  // ENH-191 P5a — an OS event (Finder) with no window origin + no CLI context;
  // resolve the primary window directly (never the cliTargetWindowId path).
  const primaryWin = liveMainWindow()
  if (primaryWin && !primaryWin.isDestroyed()) {
    // Warm path — Duo is already running. Route through sendEdit (the
    // same destination FileTree double-click and `duo open` use), so
    // the Finder open lands on the right surface (markdown -> editor;
    // .html -> canvas, or browser if the file's `duo-open-in` meta
    // says so).
    sendEdit(path)
    primaryWin.focus()
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
// ENH-182 Phase 3 — persisted projects.json (pins + color overrides).
// Mutations broadcast PROJECTS_CHANGED so the renderer + future CLI
// subscribers stay in sync without polling.
const projectsService = new ProjectsService()
function broadcastProjectsChanged(file: import('../shared/types').ProjectsFile): void {
  // ENH-191 P2 (class-ii) — a shared projects.json change must repaint EVERY
  // window's project rail, not just the originator. broadcastAll guards each
  // window's destroyed-state and no-ops on an empty registry. N=1: one window.
  // ENH-191 P3-S12 (item 12) — the per-window-keyed projectsState READ-model
  // (P3-S1a/S2c) honors this fan-out for free: each window's renderer, on
  // receiving PROJECTS_CHANGED, recomputes + re-pushes PROJECTS_STATE, which
  // keys ITS OWN slot by event.sender — so every window's slot repaints, not
  // just the originator's. (No per-window PIN cache: PINS_LIST / NAV_PINS_LIST
  // read the shared JSON live each call — window-agnostic, already correct; a
  // pin cache would be a CLAUDE.md §12 sidecar.) Fan-out asserted in
  // cache-key.test.ts (item-12 block).
  broadcastAll(registry, IPC.PROJECTS_CHANGED, file)
}
// ENH-182 Phase 4 — cached renderer snapshot for the `duo project`
// CLI family. Updated by PROJECTS_STATE_PUSH (renderer → main) on
// every rail re-render. `getProjectsState()` returns it; the CLI
// reads via socket-server.
const projectsStateCache = new WindowKeyedCache<import('../shared/types').ProjectsStateSnapshot>(() => ({
  projects: [],
  focusedProject: null,
  counts: {}
}))
export function getProjectsState(): import('../shared/types').ProjectsStateSnapshot {
  return projectsStateCache.getOrDefault(cliDefaultWindowId())
}

// ENH-221 (D10) — resolve which window a scheduled run lands in. Preference:
// if EXACTLY ONE open window's focused project encloses the job's cwd, use it;
// otherwise the primary window (lowest-id, identity — never focus). Returns
// undefined when no window is open (the run is then a "missed" run — D5).
// Realpaths both sides so a symlinked cwd (e.g. /tmp → /private/tmp) matches.
function realpathTolerant(p: string): string {
  try {
    return fsRealpathSync(p)
  } catch {
    return p
  }
}
function resolveCronLandingWindow(jobCwd: string): number | undefined {
  const realCwd = realpathTolerant(jobCwd)
  const matches: number[] = []
  for (const ctx of registry.all()) {
    const snap = projectsStateCache.get(ctx.id)
    if (!snap?.focusedProject) continue
    const roots = new Set(snap.projects.map((p) => realpathTolerant(p.root)))
    const target = deepestEnclosingRoot(realCwd, roots)
    if (target && target === realpathTolerant(snap.focusedProject)) matches.push(ctx.id)
  }
  if (matches.length === 1) return matches[0]
  return registry.primary()?.id
}
export function setProjectFocus(
  root: string | null
): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.PROJECTS_SET_FOCUS, { root })
  return { ok: true }
}
export function requestProjectClose(
  root: string
): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.PROJECTS_CLOSE_REQUEST, { root })
  return { ok: true }
}
// ENH-184 (Sprint 23 / v0.8.0) — workspace-pill click-to-open-menu
// CLI parity. Renderer pushes flag changes via WORKSPACE_PILL_MENU_PUSH;
// CLI reads return the cached value; CLI writes push back via
// WORKSPACE_PILL_MENU_SET (renderer applies + re-pushes for symmetry).
const workspacePillMenuEnabledCache = new WindowKeyedCache<boolean>(() => false)
export function getWorkspacePillMenuEnabled(): boolean {
  return workspacePillMenuEnabledCache.getOrDefault(cliDefaultWindowId())
}
export function setWorkspacePillMenuEnabledCli(
  enabled: boolean
): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.WORKSPACE_PILL_MENU_SET, { enabled })
  return { ok: true }
}
/** Resolve a name-or-root argument against the cached project list.
 *  Exact root match wins; otherwise case-insensitive name match.
 *  Returns an object so callers can distinguish "no match" vs
 *  "ambiguous" (BUG-163 — both used to return null and the error
 *  message misled the user about which case fired). */
export function resolveProjectRef(
  ref: string
): { root: string } | { ambiguous: string[] } | null {
  if (!ref) return null
  const ps = projectsStateCache.getOrDefault(cliDefaultWindowId())
  // Exact root path match wins regardless of name collisions.
  const exact = ps.projects.find((p) => p.root === ref)
  if (exact) return { root: exact.root }
  // Case-insensitive name match. Unique → resolve; multiple →
  // surface the candidates so the user can pick by full root path.
  const lower = ref.toLowerCase()
  const byName = ps.projects.filter((p) => p.name.toLowerCase() === lower)
  if (byName.length === 1) return { root: byName[0].root }
  if (byName.length > 1) return { ambiguous: byName.map((p) => p.root) }
  return null
}
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
// ENH-191 P5a (S1/S3) — app settings (the multiWindow flag, default ON).
// Loaded at boot; gates openNewWindow (the "New Window" menu + `duo window new`).
const settingsService = new SettingsService()
// ENH-167 — workspace-as-file singletons. workspaceFileService is
// stateless (just save/load a .duo-workspace envelope);
// workspaceHistoryService lazy-loads on first read;
// activeWorkspaceService loads at boot in createWindow so the title
// bar can reflect the loaded workspace name.
const workspaceFileService = new WorkspaceFileService()
const workspaceHistoryService = new WorkspaceHistoryService()
const activeWorkspaceService = new ActiveWorkspaceService()
// ENH-221 — scheduled ("cron") Claude sessions. App-global store
// (~/.claude/duo/cron-jobs.json); the CronService (the in-app tick scheduler)
// is created in whenReady once the store is loaded + windows are restored, and
// torn down in before-quit. Runs are interactive only (FEATURE_HEADLESS_CRON
// gates headless, default off).
const cronStore = new CronStore()
let cronService: CronService | null = null

// ENH-167 v1.2 — autosave mirror. Every flush of session-state.json
// also writes the active .duo-workspace if one is loaded. The hook
// runs inside sessionStateService.flush(), so it's debounced by the
// same 250ms — no extra debouncer needed. Owner directive: "auto
// save should continue to function, updating the current workspace
// if saved or unsaved."
sessionStateService.setMirrorHook(async (state) => {
  const active = activeWorkspaceService.get()
  if (!active) return
  await workspaceFileService.save(active.path, active.name, state, app.getVersion())
})

// ENH-191 P4 seam 6 (item 8) — the session envelope is the per-window
// persistence home for the active-workspace pointer. Resolve it LIVE from each
// window's WindowContext at compose time (registry.get(windowId)) so it rides
// into THAT window's WindowState on every flush. Read live → no drift vs the
// standalone active-workspace.json, which stays written for back-compat /
// Cut-3 revert. At N=1 this resolves the sole window.
sessionStateService.setActiveWorkspaceResolver(
  (windowId) => registry.get(windowId)?.activeWorkspace ?? null
)

// ENH-177 (Sprint 20 / v0.7.7) — enrich each terminal entry with the
// latest detected Claude session ID for its cwd before persisting.
// Runs inside sessionStateService.flush() (debounced 250ms) so it
// rides into BOTH the autosave file AND the mirror-hook payload.
// Stale-cap at 24h so a months-old session-jsonl doesn't keep
// surfacing the Resume banner.
const CLAUDE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
sessionStateService.setEnrichBeforePersistHook(async (state, windowId) => {
  // Best-effort: scan in parallel. Empty terminals list short-circuits.
  if (!state.terminals.length) return state

  // ENH-183 (post-walk-1 owner directive) — only capture
  // `lastClaudeSession.id` for tabs that ACTUALLY ran Claude during
  // this Duo session. Pre-fix, the hook captured the most-recent
  // JSONL UUID for every tab whose cwd had ANY recent JSONL — fresh
  // shell tabs in `/docs` inherited a UUID just by being in that
  // CWD when an autosave fired, causing S3 ("This tab had: …") to
  // mis-fire on tabs that never *had* anything. Eligibility is now:
  //   1. The tab id is in `tabsThatHostedClaude` (claudePresence
  //      transitioned to 'claude' or 'starting' on this tab during
  //      this Duo run), OR
  //   2. The tab carries a prior `lastClaudeSession` from disk — the
  //      workspace restored a tab that hosted Claude in a previous
  //      run, and we preserve that pointer so S3 still surfaces on
  //      restore.
  // Anything else gets `lastClaudeSession: null`. The C9 hydration
  // trigger (T3) also moves behind the same gate — Duo only
  // /rename-injects sessions that this tab actually hosts.
  // POSITIONAL MATCHING — `state.terminals[]` carries cwd/kind/title
  // but no tabId, so we resolve each entry to a live PTY id via cwd
  // lookup. Multiple tabs in the same cwd (e.g. 5 shells all in
  // /docs) all share the same `listIdsByCwd` result; without ordered
  // consumption every entry would map to the FIRST tab and the gate
  // would over-capture (rev2 walk regression). Track a `consumed`
  // set so each terminals[i] claims a distinct tabId. Both arrays
  // are in tab-creation order (renderer snapshot + PtyManager.Map
  // preserve insertion), so positional matching aligns correctly.
  const consumedTabIds = new Set<string>()
  // ENH-191 P5a (Tier-4) — owner-filter the positional cwd→tabId match to THIS
  // window's tabs (the windowId the flush loop threads), so the shared PTY pool's
  // same-cwd terminals from OTHER windows can't be claimed by this enrichment.
  // Was registry.only()?.id, which THREW at N>1 — silently aborting capture for
  // ALL windows the moment a 2nd opened.
  const ownerWindowId = windowId
  // ENH-191 P3-S8c — THIS window's S3-eligibility set (per-window); a foreign
  // window's hosted tabs can't grant eligibility in this enrichment.
  const hostedSet = ownerWindowId != null ? registry.get(ownerWindowId)?.tabsThatHostedClaude : undefined
  const findTabIdInState = (cwd: string): string | null => {
    const all = ptyManager.listIdsByCwd(cwd, ownerWindowId)
    const next = all.find((id) => !consumedTabIds.has(id))
    if (next) consumedTabIds.add(next)
    return next ?? null
  }

  const enriched = await Promise.all(
    state.terminals.map(async (t) => {
      const tabId = findTabIdInState(t.cwd)
      const tabHostedClaude = tabId ? (hostedSet?.has(tabId) ?? false) : false
      const hadPriorCapture = t.lastClaudeSession?.id != null

      if (!tabHostedClaude && !hadPriorCapture) {
        // Tab never ran Claude this session AND has no prior
        // captured pointer from disk. Leave null — S1 pills will
        // surface for this tab if its cwd has prior JSONLs.
        return { ...t, lastClaudeSession: null as null }
      }

      const detected = await detectLatestClaudeSession(t.cwd, CLAUDE_SESSION_MAX_AGE_MS)
      if (!detected) {
        // Preserve a prior stored value if scan failed transiently.
        if (t.lastClaudeSession) return t
        return { ...t, lastClaudeSession: null as null }
      }

      // ENH-183 pared 2026-05-25 (Option A) — T3 auto-hydration dropped.
      // Haiku covers ~80% of session titles; Duo's force-rename added
      // risk (BUG-156) for marginal coverage. Capture stays; injection
      // gone. See tasks.md § ENH-183 status table.
      return {
        ...t,
        lastClaudeSession: { id: detected.id, capturedAt: detected.capturedAt }
      }
    })
  )
  return { ...state, terminals: enriched }
})
let socketServer: SocketServer | null = null
let externalDomainsService: ExternalDomainsService | null = null

// ENH-191 P2/P5a — the per-window BrowserManager + CdpBridge live in the
// WindowContext (NOT module globals). These nullable accessors are the single
// resolution point: they cast the context's structurally-typed (unknown) fields
// back to their real types in ONE place, so window-registry.ts stays
// Electron-free. They resolve the PRIMARY (lowest-id) window's bridges — the
// windowId-less DEFAULT for app-global callers (the socket thunks' fallback when
// no DUO_WINDOW is set; devtools / split-view defaults). P0–P4 used
// registry.only() here, which THREW at N>1 as the pre-P5 fail-loud placeholder;
// P5a resolves the deterministic primary window. Per-window callers pass an
// explicit id via registry.get — see resolveCdpBridge/resolveBrowserManager.
function liveCdp(): CdpBridge | null {
  return (registry.primary()?.cdpBridge as CdpBridge | undefined) ?? null
}
function liveBrowser(): BrowserManager | null {
  return (registry.primary()?.browserManager as BrowserManager | undefined) ?? null
}
// ENH-191 P5a (Tier-1) — per-window resolution for IPC handlers that arrive
// FROM a specific window's renderer (event.sender). At N>1 the only()-backed
// liveBrowser/liveCdp THROW (the fail-loud placeholder); these resolve THIS
// window's BrowserManager by the sender's window id (registry.get NEVER throws),
// so window 2's browser ops hit window 2 — never window 1, never an uncaught
// crash. Byte-identical at N=1 (sender === the sole window).
function browserForSender(event: { sender: WebContents }): BrowserManager | null {
  const id = BrowserWindow.fromWebContents(event.sender)?.id
  return (id != null ? (registry.get(id)?.browserManager as BrowserManager | undefined) : undefined) ?? null
}
// ENH-191 P2 — the sole window typed as the real BrowserWindow, for the
// non-send reads (dialog parents, setTitle, focus, devtools wc, did-finish
// once/reload, reqId sends) that need methods beyond the minimal WindowLike
// send-interface. registry.only() holds the real window; cast in ONE place.
function liveMainWindow(): BrowserWindow | null {
  return (resolveDefault(registry) as BrowserWindow | undefined) ?? null
}

// ENH-191 P1b/P2 — the app-scoped SocketServer's getter-thunks. The socket is
// constructed once in app.whenReady (before any window); these resolve the
// CURRENT window's per-window bridges lazily, per CLI command, inside
// handle(). They throw only on a programming error (a command arriving before
// createWindow has registered a context) — contained by handle()'s try/catch
// as a clean {ok:false}. P2 repointed them from the deleted module globals to
// registry.only() via the accessors above.
function resolveCdpBridge(): CdpBridge {
  // ENH-191 P5a (Tier-3) — the ADDRESSED window's CdpBridge (cliTargetWindowId,
  // set by SocketServer.handle from DUO_WINDOW), else the primary window's
  // (liveCdp). registry.get never throws; so `duo --window N <cdp-verb>` drives
  // window N's browser pane.
  const c = cliTargetWindowId != null
    ? ((registry.get(cliTargetWindowId)?.cdpBridge as CdpBridge | undefined) ?? null)
    : liveCdp()
  if (!c) {
    throw new Error('[main] SocketServer.getCdp() ran before createWindow registered a cdpBridge')
  }
  return c
}
function resolveBrowserManager(): BrowserManager {
  // ENH-191 P5a (Tier-3) — the ADDRESSED window's BrowserManager, else primary.
  const b = cliTargetWindowId != null
    ? ((registry.get(cliTargetWindowId)?.browserManager as BrowserManager | undefined) ?? null)
    : liveBrowser()
  if (!b) {
    throw new Error('[main] SocketServer.getBrowser() ran before createWindow registered a browserManager')
  }
  return b
}

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
const cozyActiveTabCache = new WindowKeyedCache<boolean>(() => false)
let cozyMenuItemId: string | null = null

// ENH-172 (Sprint 20) — the View → Show Hidden Files checkmark
// reflects `navState.showDotfiles` (renderer-authoritative, pushed
// via NAV_STATE_PUSH). No separate cache needed — read from navState.
let hiddenFilesMenuItemId: string | null = null

// ENH-170 v2 (Sprint 20) — top-level Settings → "Cmd+Return for
// Claude submit" checkmark reflects claudeKeyPrefsState.claudeReturn
// (renderer-authoritative, pushed via CLAUDE_KEY_PREFS_STATE_PUSH).
// Updated in the push handler below.
let claudeReturnMenuItemId: string | null = null

async function createWindow(opts: { restore?: boolean; restoreIndex?: number; initialCwd?: string } = {}): Promise<WindowContext> {
  // ENH-191 P5a (S3/Tier-3) — `restore` (default true) is the BOOT path: restore
  // the persisted session (browser tabs, pins, active workspace, geometry). The
  // boot loop passes restoreIndex i so window i hydrates the i-th persisted
  // WindowState (default 0 = the sole/first window). A New-Window open passes
  // restore:false for a BLANK window (NFR-6.2 — not cloning window 1's content).
  const restore = opts.restore ?? true
  const restoreIndex = opts.restoreIndex ?? 0
  const initialCwd = opts.initialCwd ?? ''
  const mainWindow = new BrowserWindow({
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
        `--duo-is-dev=${app.isPackaged ? '0' : '1'}`,
        // ENH-191 NFR-6.2 — a blank New-Window (restore:false) must NOT clone
        // the pinned FILE tabs (App.tsx pin-auto-open). Read synchronously in
        // preload (no IPC race) into env.blank; the restored/boot windows are
        // non-blank. Known at construction, so additionalArguments is the seam.
        `--duo-blank=${restore ? '0' : '1'}`,
        // ENH-210 (D1-part2) — seed the new window's navigator cwd when
        // opened AT a path. Empty for normal windows; useNavigator falls
        // back to it only when this (blank) window has no per-window LS.
        `--duo-initial-cwd=${initialCwd}`
      ]
    }
  })

  // ENH-191 P2 — register the registry-of-one context as soon as the window
  // exists, BEFORE any boot-time send (applyWindowTitle below resolves its
  // target via the registry). winId is read here while the window is alive
  // (the 'closed' event fires after native destroy). The per-window managers
  // attach to this same context object after their construction below, so
  // resolveDefault(registry) / liveBrowser() / liveCdp() are valid from here.
  const winId = mainWindow.id
  const ctx: WindowContext = { id: winId, window: mainWindow }
  registry.register(ctx)

  // ENH-191 P5a (S2) — per-window send funnel. The per-window callbacks defined
  // below (browser state/tabs, the presence onChange, did-finish-load opens)
  // fire for THIS window's events, so they must send to THIS window — NOT the
  // default `safeSend`, which resolves `registry.only()` and THROWS once a
  // second window registers (the P3 fail-loud placeholder this seam consumes).
  // Byte-identical at N=1: ctx IS the sole window, so ctxSend hits the same
  // target `safeSend` did.
  const ctxSend = makeSafeSend(() => ctx.window)

  // ENH-191 P5a (Tier-1) — mark a blank New-Window BEFORE loadURL (race-free):
  // its SESSION_STATE_LOAD must return empty, not window 1's full session. (Was
  // marked in openNewWindow AFTER createWindow returned — i.e. after loadURL had
  // already kicked off the renderer — a latent full-session clone race.)
  if (!restore) blankWindowIds.add(winId)

  // ENH-191 P2 (item 7) — snapshot the cold-boot Finder open-file stash into a
  // per-window local and clear the module global immediately, so a reentrant
  // createWindow (window 2, P5a) can't replay window 1's pending open. The
  // did-finish-load hook below consumes this local. Zero-change at N=1.
  const pendingOpenForWindow = pendingOpenFilePath
  pendingOpenFilePath = null

  // ENH-167 — load active-workspace pointer and reflect into the window
  // title. The boot-time load is synchronous-feeling because we
  // `await` it before any other window setup; subsequent updates
  // (after Save / Open) call applyWindowTitle() to mutate live.
  await activeWorkspaceService.load()
  // ENH-191 P3-S10 / P4 seam 6 (item 8) — seed THIS window's per-window
  // active-workspace pointer before the first title paint. P4 makes the SESSION
  // ENVELOPE the persistence home (the standalone active-workspace.json is a
  // single slot two windows would clobber), so prefer the envelope's per-window
  // pointer; fall back to the shared service for back-compat (pre-v2 installs /
  // Cut-3 revert). [N=1: createWindow runs once so windows[0] IS this window;
  // P5's reentrant createWindow must select windows[restoreIndex] instead.]
  // ENH-191 P5a (S3) — a blank New-Window has no persisted workspace.
  const restoredWindows = restore ? await sessionStateService.loadWindows() : []
  const restoredWindow = restore ? restoredWindows[restoreIndex] : undefined
  // ENH-191 P5a (Tier-3) — re-key THIS window's persisted session slot to its
  // NEW live id (Electron reassigns ids each launch) BEFORE loadURL, so the
  // renderer's saves hit the same slot — no stale duplicate (the Tier-1
  // data-loss fix's 2N-growth hazard). The boot loop restores in ascending
  // persisted-id order, so fresh live ids (1,2,…) never collide. Also apply the
  // persisted geometry (the ctor 1440×900 above is the no-bounds fallback).
  if (restoredWindow) {
    sessionStateService.reassignWindowId(restoredWindow.windowId, winId)
    if (restoredWindow.bounds) mainWindow.setBounds(restoredWindow.bounds)
  }
  ctx.activeWorkspace = restore
    ? (restoredWindow?.activeWorkspace ?? activeWorkspaceService.get())
    : null
  applyWindowTitle(ctx)

  // ENH-191 P1 — `ptyManager` owner-routing wiring + the `ExternalDomainsService`
  // construction were lifted OUT of createWindow() to app-boot scope
  // (app.whenReady, just before the createWindow call) so a reentrant
  // createWindow (P2) can't re-register the PTY sink or re-construct the
  // external-domains watcher. Behavior-identical at N=1. This invariant
  // documents the new ordering contract (whenReady constructs it first)
  // AND re-narrows the `| null` module global for the BrowserManager arg.
  if (!externalDomainsService) {
    throw new Error('[main] createWindow ran before app-boot externalDomainsService init')
  }

  // Browser manager owns WebContentsViews and forwards state to renderer.
  //
  // BUG-057 + BUG-078 (preserved through ENH-135) — peek the persisted
  // session BEFORE construction so the BUG-057 pin-restore loop below
  // can decide whether to fire. The historical bootDefaultTab arg went
  // away with ENH-135 (no more boot-default FAQ tab); the persisted-
  // session peek stays because BUG-057 still uses it to gate the
  // pin-restore on fresh-app boot only.
  // ENH-191 P5a (Tier-3) — THIS window's persisted slice (loadFlatForWindow reads
  // the in-memory map keyed by winId post-reassign), not load() (always
  // windows[0]). EMPTY for a blank window / first launch (no slot).
  const persistedAtBoot = restore ? sessionStateService.loadFlatForWindow(winId) : { ...EMPTY_SESSION_STATE }
  const hasPersistedSession = persistedAtBoot.browserTabs.length > 0

  // ENH-191 P2 — createWindow-local consts (were module globals through P1).
  // The in-createWindow reads + the 'closed' handler below capture these via
  // closure; the registered WindowContext holds them for everything outside
  // createWindow (resolved via liveBrowser()/liveCdp() -> registry.only()).
  const cdpBridge = new CdpBridge()
  const browserManager = new BrowserManager(
    mainWindow,
    cdpBridge,
    (state: BrowserState) => ctxSend(IPC.BROWSER_STATE, state),
    (tabs: BrowserTab[]) => ctxSend(IPC.BROWSER_TABS, tabs),
    browserHistory,
    externalDomainsService
  )
  // ENH-191 P2 — attach the per-window managers to the already-registered
  // context so liveBrowser()/liveCdp() (registry.only()) resolve them.
  ctx.browserManager = browserManager
  ctx.cdpBridge = cdpBridge
  // ENH-191 P3-S8 — this window's own claude-presence probe (no module global).
  // TERMINAL_ACTIVE_PUSH routes setTarget here by event.sender; the onChange
  // fan-out below captures THIS window's createWindow-local cdpBridge/browserManager.
  const presence = new ClaudePresenceProbe()
  ctx.presence = presence
  // ENH-191 P3-S8c — this window's S3-eligibility set (the presence fan-out
  // below adds to it; the enrich-before-persist hook reads it per window).
  ctx.tabsThatHostedClaude = new Set()

  // ENH-039 — page-side `[data-duo-path]` link clicks (smoke-walk page,
  // future Duo-authored pages) route through the CDP binding here and
  // dispatch via sendEdit, the same path `duo open` uses. The PATH_LINK_
  // FORWARDER_IIFE in cdp-bridge.ts gates on `location.protocol === 'file:'`
  // so arbitrary http(s) sites containing [data-duo-path] markup stay inert.
  //
  // Tilde expansion: page-emitted paths commonly use `~/...` shorthand
  // (smoke-walk steps render `~/.claude/duo/packs/...` verbatim from
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

  // ENH-191 P1b — the SocketServer (construct + setEventSink + start) was
  // LIFTED OUT of createWindow to app-boot scope (app.whenReady, just before
  // the createWindow call) so it is app-lifetime, not per-window. Keeping it
  // here would re-bind the socket on every dock-reopen (app.activate →
  // createWindow) and break the CLI bridge. See whenReady below.

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
  presence.start()
  const unsubPresence = presence.onChange((state) => {
    // ENH-183 (post-walk-1) — record any tab that ever hosts Claude.
    // The enrichment hook (sessionStateService below) gates UUID
    // capture on membership in this set; without it, S3 fires on
    // tabs that never actually ran Claude.
    // ENH-191 P5a (S2) — THIS window's active terminal (not registry.only(),
    // which throws at N>1). Byte-identical at N=1 (winId === the sole window).
    const activeId = activeTerminalIdCache.getOrDefault(winId)
    if ((state === 'claude' || state === 'starting') && activeId) {
      ctx.tabsThatHostedClaude?.add(activeId)
    }
    ctxSend(IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED, state)
    const live = state === 'claude' || state === 'starting'
    // ENH-191 P1b — cdpBridge is now a nullable module global; a presence
    // tick after a window close would TypeError on a bare call. Optional-
    // chain mirrors the existing 'if (browserManager)' guard below.
    cdpBridge?.setClaudeLive(live)
    // BUG-133 — also broadcast to ALL browser tabs (not just the
    // CdpBridge-attached one). Fixes the stale `__duoClaudeLive` gate
    // on non-active panes (main pane keeps showing the pill after
    // user switches away from a Claude terminal because CDP attach
    // points elsewhere — usually aux or the last-switched main tab).
    if (browserManager) browserManager.broadcastClaudeLive(live)
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
        if (restore && hasPersistedSession) {
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
      // restoring default-pinned tabs (today: What Duo Does only,
      // post-ENH-135 — FAQ retired; default pin seed lives in
      // install-service op #8) on top of the restored session
      // resurrects tabs the user explicitly closed. New rule (owner-
      // stated): "boot load only on fresh app; skip if prev tabs
      // persisted." User-explicit pins still survive across upgrades
      // because session-state survives upgrades too. This trims the
      // BUG-057 mechanism to fresh-app-only — which is when it
      // actually matters.
      if (restore && !hasPersistedSession) {
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
      // ADR (2026-05-10) — pack-canvas / pinned-tab idempotency contract.
      // If a pack default's `file://` URL is already in pins.json, the
      // pin-restore mechanism (BUG-057, line 491+) owns the open — skip
      // the NAV_EDIT to avoid double-tabs on fresh install.
      //
      // Why this matters:
      // - Fresh install: op #8 in install-service.ts seeds pins.json with
      //   the pack's canvas URL (the WDD pin today). BUG-057 pin-restore
      //   opens that URL as a pinned tab on first boot. Without this
      //   skip, the first-launch hook would NAV_EDIT the same canvas —
      //   user sees TWO WDD tabs (one pinned via pin-restore, one fresh
      //   via NAV_EDIT).
      // - v0.6.12 → v0.6.13 upgrade: pins.json has the OLD URL
      //   (`~/.claude/duo/help/what-duo-does.html`), NOT the new pack
      //   location. The new pack URL is NOT in pins.json. The hook
      //   fires NAV_EDIT, opening the new content as a fresh tab.
      //   User sees the updated WDD even though their stale pin still
      //   points at the v0.6.12 file (left on disk by install-service).
      //
      // Pin-tracking lives in pins.json (read at boot); installed-packs.json
      // tracks the per-pack-version first-launch flag (fire once per
      // pack version per user). These two records cooperate, neither
      // double-opens nor misses content on upgrade. See
      // docs/DECISIONS.md § "Pack canvas / pinned tab idempotency".
      const pinUrlSet = new Set((await pinsService.list()).map(p => p.ref))
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
          const fileUrl = `file://${absPath}`
          if (pinUrlSet.has(fileUrl)) {
            // Pin-restore owns this URL on fresh-install boots; skip the
            // NAV_EDIT here so we don't double-open. On boots where
            // pin-restore is skipped (persisted session exists), the
            // tab is already in the restored session — same result.
            continue
          }
          // NAV_EDIT routes through the renderer's openFileSmart, which
          // honors duo-open-in meta. Most pack canvases will land in
          // the canvas tab; templates that opt into browser routing
          // get there via the meta hint without bespoke wiring here.
          ctxSend(IPC.NAV_EDIT, absPath)
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
    if (pendingOpenForWindow) {
      sendEdit(pendingOpenForWindow)
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

  // ENH-121 (Sprint 12 walk-rev3 retro fix) — forward renderer console
  // messages to dev stdout. Without this, agent debugging the renderer
  // is blind to the most basic signal (every other surface logs into
  // the dev terminal but the renderer's console only goes to DevTools).
  // Today's image-render diagnosis spent ~90 minutes inventing in-DOM
  // debug overlays + colored boxes to surface state that a single
  // `console.log` would have made visible immediately. Dev only —
  // packaged builds don't surface DevTools-style noise.
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const labels = ['[renderer:log]', '[renderer:warn]', '[renderer:error]'] as const
      const label = labels[level] ?? '[renderer]'
      // Strip Vite-noise the dev terminal already echoes (HMR + Electron
      // security warning). Keep everything else.
      if (message.startsWith('[vite]')) return
      if (message.includes('Electron Security Warning')) return
      const where = sourceId ? ` (${sourceId.split('/').slice(-2).join('/')}:${line})` : ''
      console.log(`${label}${where} ${message}`)
    })
  }

  // ENH-191 P5a (Tier-3) — persist THIS window's geometry so it restores next
  // launch (bounds aren't in the renderer's SessionState snapshot). Debounced —
  // resize/move fire rapidly during a drag. updateBounds no-ops until the window
  // has a session slot (a restored window has one post-reassign; a fresh window
  // gets one after its first renderer save). flatToWindowState carries bounds
  // across renderer saves (prev.bounds), so the value survives.
  let boundsSaveTimer: NodeJS.Timeout | null = null
  const saveBoundsDebounced = (): void => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed()) sessionStateService.updateBounds(winId, mainWindow.getBounds())
    }, 400)
  }
  mainWindow.on('resize', saveBoundsDebounced)
  mainWindow.on('moved', saveBoundsDebounced)

  // ENH-191 P2 — winId + the registry context are captured/registered early
  // (right after window creation, above). The 'closed' handler reuses that
  // same winId; reading mainWindow.id here would risk 'Object has been
  // destroyed' since 'closed' fires after the native window is gone.
  mainWindow.on('closed', () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    // Per-window teardown — ALWAYS, idempotent per id. Detaches CDP then
    // disposes the BrowserManager (dispose() also calls cdp.detach(), which
    // is idempotent via its isAttached() guard — the extra detach no-ops).
    // browserManager + cdpBridge are createWindow-local consts captured here
    // (non-null since construction); the registered context holds them too.
    windowTeardown.teardownWindow(winId, { browserManager, cdpBridge })
    // ENH-191 P3-S8 — stop THIS window's claude-presence probe + unsubscribe
    // its listener so a closed window's 500ms interval doesn't linger. The
    // probe is per-window (ctx.presence), constructed in createWindow;
    // before-quit stops any that survive (app-quit without a prior close).
    unsubPresence()
    presence.stop()
    // App-scoped singletons (socket, external-domains) are NOT torn down
    // here. On macOS, closing the only window does NOT quit (window-all-
    // closed no-ops on darwin); the user can dock-reopen via app.on(
    // 'activate') → createWindow(). Stopping the socket here would leave the
    // CLI bridge permanently DOWN after the first close — it's whenReady-
    // scoped now, not re-created per window. App teardown lives ONLY in
    // before-quit. See ENH-191 P1 PRD / DECISIONS.md.
    // ENH-191 P2 — mainWindow / browserManager / cdpBridge are createWindow-
    // local consts now (no module globals to null); unregistering the context
    // drops the
    // window's hold on them. Idempotent; unregister no-ops if absent. At N=1
    // this empties the registry, so registry.only() is undefined until the
    // next createWindow (dock-reopen).
    registry.unregister(winId)
    // ENH-191 P5a (S3) — drop any blank-window marker for this id.
    blankWindowIds.delete(winId)
    // ENH-191 P5a (Tier-1) — drop this window's session slice so an EXPLICITLY
    // closed window doesn't resurrect on relaunch. On app-quit, before-quit has
    // already flushed the full map and dropWindow schedules no flush, so this
    // can't shrink the persisted envelope mid-quit.
    sessionStateService.dropWindow(winId)
    // ENH-191 P5a (Tier-4) — purge THIS window's slot from every per-window
    // read-model cache so a closed window's snapshot can't linger past unregister
    // (slot leak). WindowKeyedCache.delete is idempotent. The 12 caches below are
    // the full set (grep `new WindowKeyedCache`); keep in sync if one is added.
    // (PendingRegistry families are keyed by reqId, not windowId, and self-reap
    // via per-family timeouts — no per-window purge needed.)
    for (const cache of [
      navStateCache, editorSelectionCache, canvasSelectionCache, themeStateCache,
      claudeKeyPrefsStateCache, authorStateCache, selectionFormatStateCache,
      workingAuxSnapshotCache, activeTerminalIdCache, projectsStateCache,
      workspacePillMenuEnabledCache, cozyActiveTabCache
    ]) {
      cache.delete(winId)
    }
  })

  // ENH-191 P2 — the context was registered early (right after window creation)
  // with its managers attached at construction; just return it.
  return ctx
}

// ENH-191 P5a (S3) — windowIds opened BLANK via openNewWindow (not boot
// restore). Their renderer's SESSION_STATE_LOAD returns empty so a new window
// doesn't clone window 1's session (NFR-6.2). Cleared on window close.
const blankWindowIds = new Set<number>()

// ENH-191 P5a (S3) — the reentrant "New Window" entry. Gated on the multiWindow
// setting (default ON; user can disable in Settings). Returns a structured
// result so the CLI verb (`duo window new`) reports a clean "disabled" error
// rather than a silent no-op (CLI-parity, CLAUDE.md §4). The menu item AND the
// verb both call THIS, so behavior is identical. New window opens blank
// (restore:false) to its default cwd. [Behavior-changing — needs the
// two-window smoke-walk; not autonomously verifiable.]
async function openNewWindow(opts: { initialCwd?: string } = {}): Promise<{ ok: boolean; error?: string }> {
  if (!settingsService.get().multiWindow) {
    return { ok: false, error: 'multi-window is disabled (enable it in Settings)' }
  }
  // ENH-191 P5a (Tier-1) — createWindow({restore:false}) marks blankWindowIds
  // itself BEFORE loadURL (race-free); no post-hoc add here.
  // ENH-210 (D1-part2) — initialCwd seeds the new window's navigator when
  // opened AT a worktree (still a blank window: restore:false).
  await createWindow({ restore: false, initialCwd: opts.initialCwd })
  return { ok: true }
}

app.whenReady().then(async () => {
  // ENH-108 / ENH-111 — install the duo-asset:// handler. URL form is
  // `duo-asset:///abs/path/to/file.ext`. Path is decoded from the URL's
  // pathname (`encodeURI` on the renderer side handles spaces / unicode).
  // Refuses anything that doesn't resolve to an existing regular file —
  // returns a 404 Response so the `<img>` shows the broken-icon glyph
  // and the error is visible in DevTools rather than a silent hang.
  // ENH-108 / ENH-111 walk-1 fix v2 — register on BOTH the default
  // session (renderer pane uses this) AND the persist:duo-browser
  // session (BrowserManager's WebContentsViews use this). protocol.handle
  // is per-session; without registering on both, browser-pane <img> tags
  // referencing duo-asset:// fail with ERR_UNKNOWN_URL_SCHEME.
  // URL form is `duo-asset://local/abs/path/to/file.ext` — the constant
  // `local` host is required because the scheme is registered with
  // `standard: true`, which makes Chromium normalize triple-slash forms
  // (`duo-asset:///tmp/foo`) into `duo-asset://tmp/foo` with `tmp` as
  // the host. Using an explicit `local` authority keeps the abs path
  // intact in the pathname.
  const duoAssetHandler = async (req: Request) => {
    try {
      const u = new URL(req.url)
      const filePath = decodeURIComponent(u.pathname)
      const abs = filePath.startsWith('/') ? filePath : '/' + filePath
      const st = await nodeFs.stat(abs)
      if (!st.isFile()) return new Response('Not a file', { status: 404 })
      const data = await nodeFs.readFile(abs)
      const ext = nodePath.extname(abs).slice(1).toLowerCase()
      const mime = ({
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', tiff: 'image/tiff',
        ico: 'image/vnd.microsoft.icon', pdf: 'application/pdf'
      } as Record<string, string>)[ext] ?? 'application/octet-stream'
      return new Response(data, {
        headers: {
          'Content-Type': mime,
          'Content-Length': String(data.byteLength),
          // Explicit CORS allow — corsEnabled scheme privilege opens
          // the gate for the request to be sent; without an
          // Access-Control-Allow-Origin response header, Chromium may
          // still block image rendering across origin scheme boundaries
          // (http://localhost → duo-asset://).
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      })
    } catch (err) {
      return new Response(`duo-asset error: ${err instanceof Error ? err.message : String(err)}`, { status: 404 })
    }
  }
  // ENH-191 P2 (item 8) — register the duo-asset handler EXACTLY once for the
  // app lifetime. These protocol.handle calls live in whenReady (runs once
  // today), but the once-guard makes the invariant durable: if a future
  // reentrant path ever re-drives this, the second call no-ops instead of
  // crashing with Electron's duplicate-handler error. The per-window
  // BrowserManager shares this ONE registration + the ONE partition session —
  // it never re-registers (verified: browser-manager.ts only fromPartition()s).
  registerDuoAssetOnce(() => {
    // Default session — used by the main BrowserWindow's renderer.
    protocol.handle('duo-asset', duoAssetHandler)
    // Browser-pane session (WebContentsViews / Stage 2 BrowserManager).
    session.fromPartition(BROWSER_SESSION_PARTITION).protocol.handle('duo-asset', duoAssetHandler)
  })

  setupIPC()
  installAppMenu()
  // ENH-167 — populate File > Open Recent with persisted entries.
  // installAppMenu() above runs synchronously with whatever is in
  // workspaceHistoryService.getEntriesSync() (empty before
  // ensureLoaded()); the async rebuild here repaints the submenu
  // once the file is parsed.
  void rebuildAppMenu()
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
        // ENH-191 P5a — classify by the window that OWNS the right-clicked wc,
        // never liveMainWindow()/only() (which crashes AND misclassifies window
        // 2's renderer at N>1). isMainRenderer is true only when wc is its
        // OWNING window's main renderer; a canvas iframe shares that renderer's
        // wc, and a browser-pane WCV's wc never equals it (→ treated as browser
        // pane). Resolved ONCE here for both the Comment + Select-element gates.
        const ownerWin = BrowserWindow.fromWebContents(wc)
        const isMainRenderer = ownerWin !== null && wc === ownerWin.webContents
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
        // ENH-159 v2 walk-rev3 — "Select element" right-click entry on
        // browser pane. Owner Q4 picked: right-click → State B (enters
        // inspect mode, no pre-frozen element). User then clicks-to-
        // freeze the element under cursor normally. Owner walk-rev3:
        // *"right click >> inspect element loads the default browser
        // tools ... it also makes me wonder if we should use a
        // different term, like 'select element'."* — we adopt
        // "Select element" to avoid colliding with Chromium's native
        // "Inspect Element" devtools menu item (which we already hide
        // via showInspectElement: !app.isPackaged in prod).
        //
        // Show only on browser-pane WCVs (not main renderer, not
        // canvas iframes): both are skipped here so the menu item
        // doesn't appear in surfaces where inspect mode doesn't apply.
        const isCanvasIframeForInspect = parameters.frameURL && parameters.frameURL.startsWith('about:srcdoc')
        const isBrowserPane = !isMainRenderer && !isCanvasIframeForInspect
        // ENH-191 P5a — the inspect target is the OWNING window's BrowserManager
        // (registry.get by ownerWin.id), never liveBrowser()/only() — which
        // crashes at N>1 and would drive window 1's pane from a right-click in
        // window 2. A null/unresolvable owner → item omitted (graceful), never
        // wrong-window.
        const browserManager = ownerWin
          ? ((registry.get(ownerWin.id)?.browserManager as BrowserManager | undefined) ?? null)
          : null
        if (isBrowserPane && browserManager) {
          const bm = browserManager
          items.push({
            label: 'Select element',
            click: () => {
              try { bm.setInspectMode(true) } catch { /* manager gone */ }
            }
          })
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
  // ENH-191 P1 — window-independent services lifted out of createWindow()
  // to app-boot scope: construct ONCE so a reentrant createWindow (P2)
  // can't re-register the PTY sink or re-construct the external-domains
  // watcher. Behavior-identical at N=1.
  //
  // ENH-191 P3-S5 — PtyManager owner-routing. Each PTY_DATA/EXIT routes to the
  // session's OWNING window (resolveBySender), falling back to the sole window
  // (resolveDefault) when the owner is transiently unresolved (the cold-start
  // drop guard). Registering before any window exists is safe — both resolve to
  // undefined and the send no-ops. At N=1 the owner IS the sole window, so this
  // is byte-identical to the old single safeSend funnel.
  ptyManager.setOwnerRouting({
    resolveOwner: (windowId) => resolveBySender(registry, windowId),
    resolveDefault: () => resolveDefault(registry)
  })
  // BUG-040 / ENH-021 v2 — external-domains routing service (file-watched;
  // self-heals an empty/missing file from the Vite-injected defaults).
  externalDomainsService = new ExternalDomainsService({
    defaults: __DUO_BOOTSTRAP_EXTERNAL_DOMAINS__
  })
  await externalDomainsService.load()
  externalDomainsService.watch()

  // ENH-191 P1b — SocketServer lifted here from createWindow. App-scoped:
  // constructed ONCE, before any window. The per-window CdpBridge /
  // BrowserManager are resolved lazily via the resolveCdpBridge /
  // resolveBrowserManager getter-thunks (the makeSafeSend(() => mainWindow)
  // seam) — at P2 these swap to the window registry with zero churn here.
  // Stopped ONLY in before-quit (app-lifetime), so a dock-reopen
  // (app.activate → createWindow) keeps the CLI bridge alive. DECISIONS.md
  // locks single-construction; SocketServer.start() is idempotent as
  // belt-and-suspenders. `ping` / `duo doctor` answers mid-boot (it never
  // touches cdp/browser); any other command arriving before createWindow
  // assigns the bridges resolves to a clean {ok:false} via handle()'s catch.
  ensureSocketDir()
  socketServer = new SocketServer(resolveCdpBridge, resolveBrowserManager, filesService, {
    getState: getNavState,
    reveal: sendReveal,
    view: sendView,
    edit: sendEdit,
    getSelection: getEditorSelection,
    getCanvasSelection: getCanvasSelection,
    docWrite: dispatchDocWrite,
    // ENH-195 — `duo doc edit` PLAIN replace (open-file path).
    docEditPlain: dispatchDocEditPlain,
    docRead: dispatchDocRead,
    imageInsert: dispatchImageInsert,
    docGoto: dispatchDocGoto,
    docFind: dispatchDocFind,
    getTheme: getThemeState,
    setTheme: setThemeMode,
    // BUG-138 Phase 2 — author identity (CriticMarkup attribution).
    getAuthor: getAuthorState,
    setAuthor: setAuthor,
    // Sprint 16 / v0.6.15 — Claude-tab Enter key prefs.
    getClaudeKeyPrefs: getClaudeKeyPrefsState,
    setClaudeReturn: setClaudeReturnMode,
    setShiftReturn: setShiftReturnMode,
    // ENH-172 (Sprint 20) — show/hide hidden-files toggle.
    setHiddenFiles: setHiddenFiles,
    // ENH-178 (Sprint 20) — browser-mode push (CLI → renderer echo).
    pushBrowserMode: pushBrowserMode,
    setSplit: setSplit,
    setLayout3wayEven: setLayout3wayEven,
    queryRendererDom: queryRendererDom,
    openDevTools: openDevToolsForTarget,
    getLayout: getLayoutSnapshot,
    // ENH-195 — `duo status` high-level app snapshot.
    getStatus: getStatusSnapshot,
    revealMainPaneIfCollapsed: revealMainPaneIfCollapsed,
    // ENH-191 P5a (S3c) — `duo window new` → the same openNewWindow the menu
    // item calls (flag-gated; identical behavior, CLAUDE.md §4 parity).
    openWindow: (opts) => openNewWindow({ initialCwd: opts?.cwd }),
    splitViewOpen: splitViewOpen,
    splitViewOpenBrowser: splitViewOpenBrowser,
    splitViewClose: splitViewClose,
    closeActiveWorkingTab: closeActiveWorkingTab,
    closeTerminalTab: closeTerminalTab,
    openCloneModal: openCloneModal,
    splitViewPromote: splitViewPromote,
    splitViewResize: splitViewResize,
    getSplitViewState: getSplitViewState,
    openExternal: openExternalUrl,
    getSelectionFormat: getSelectionFormatState,
    setSelectionFormat: setSelectionFormat,
    sendToActiveTerminal: sendToActiveTerminal,
    htmlNew: htmlNew,
    htmlOp: dispatchHtmlOp,
    // ENH-195 — `duo json set|merge` (open-file path).
    jsonOp: dispatchJsonOp,
    // ENH-183 C12 — Claude session lifecycle CLI verbs.
    sessionList: async (cwd) => {
      const { listPriorSessions } = await import('./claude-session-tracker')
      return listPriorSessions(cwd)
    },
    sessionResume: (tabId, uuid) => {
      const cwd = ptyManager.getCwd(tabId)
      if (cwd === null) return { ok: false, error: `tabId not found: ${tabId}` }
      if (!/^[0-9a-f-]{36}$/.test(uuid)) return { ok: false, error: `uuid must be a UUID, got: ${uuid}` }
      ptyManager.write(tabId, `claude --resume ${uuid}\n`)
      return { ok: true }
    },
    // ENH-183 pared 2026-05-25 (Option A): sessionRename + sessionHydrate
    // removed. Force-rename unnecessary (Haiku covers it); inline rename
    // surface dropped with S2. Users type `/rename` directly in Claude.
    // ENH-212 (Home) — `duo session open <uuid>` full click contract.
    sessionOpen: sessionOpenForCli,
    // ENH-221 — `duo cron <op>` scheduled-session management. Delegates to the
    // main-process CronService (created in whenReady). App-global state, so it
    // ignores --window; a run's landing window is resolved from the job's cwd.
    cron: (op, args) => {
      if (!cronService) throw new Error('cron service is not ready yet')
      return cronService.handleCli(op, args)
    },
    // ENH-212 (Home) — `duo home` + `duo term tabs|tab` CLI parity.
    showHome: showHomeForCli,
    getHomeState: getHomeStateForCli,
    listTerminalTabs: listTerminalTabsForCli,
    activateTerminalTab: activateTerminalTabForCli,
    closeTerminalTabById: closeTerminalTabForCli,
    htmlComment: dispatchHtmlComment,
    htmlCommentsList: dispatchHtmlCommentsList,
    newTab: dispatchNewTab,
    // ENH-098 (Sprint 9) — `duo focus-pane <name>` bridge. Renderer's
    // focusPane() owns the actual focus shift; main just pushes the
    // target name over PANE_FOCUS_JUMP. The bridge return value is
    // synchronous {ok: true} — the renderer's no-aux-open guard fires
    // a console.info hint there rather than a sync error here (split-
    // view state lives on the renderer side).
    focusPane: (target) => {
      const win = windowByIdOrPrimary(undefined)
      if (!win) return { ok: false, error: 'main window not ready' }
      win.webContents.send(IPC.PANE_FOCUS_JUMP, target)
      return { ok: true, target }
    },
    pushNavPinsChanged: (pins) => {
      // ENH-191 P2 (class-ii) — nav-pins.json is shared; fan out to all windows.
      broadcastAll(registry, IPC.NAV_PINS_CHANGED, pins)
    },
    // ENH-167 — workspace-as-file CLI parity.
    workspaceSave: async (opts) => saveWorkspaceFile(opts),
    workspaceOpen: async (path) => openWorkspaceFile(path, { skipPrompt: true }),
    workspaceListRecent: async () => workspaceHistoryService.listSorted(),
    workspaceCurrent: async () => {
      // ENH-191 P5a — the default (primary) window's pointer; primary() never
      // throws at N>1 (Tier-3 can refine to DUO_WINDOW). Fallback: shared service.
      const ctx = registry.primary()
      if (ctx && ctx.activeWorkspace !== undefined) return ctx.activeWorkspace
      await activeWorkspaceService.load()
      return activeWorkspaceService.get()
    },
    workspaceNew: async () => newWorkspaceReset({ skipPrompt: true }),
    // ENH-182 Phase 4 — project rail CLI parity.
    getProjectsState: () => getProjectsState(),
    resolveProjectRef: (ref: string) => resolveProjectRef(ref),
    setProjectFocus: (root: string | null) => setProjectFocus(root),
    requestProjectClose: (root: string) => requestProjectClose(root),
    projectsTogglePin: async (root: string) => {
      const next = await projectsService.togglePin(root)
      broadcastProjectsChanged(next)
      return next
    },
    // ENH-184 (Sprint 23 / v0.8.0) — workspace-pill menu CLI parity.
    getWorkspacePillMenuEnabled: () => getWorkspacePillMenuEnabled(),
    setWorkspacePillMenuEnabled: (enabled: boolean) => setWorkspacePillMenuEnabledCli(enabled),
    // ENH-191 P5a (Tier-3) — cross-window addressing + enumeration. handle()
    // calls setTargetWindow(req.windowId) synchronously before each command, so
    // the resolver helpers above pick up the addressed window. windowCount feeds
    // `duo doctor`; listWindows backs `duo windows`.
    setTargetWindow: (id?: number) => { cliTargetWindowId = id },
    windowCount: () => registry.count(),
    listWindows: () => {
      const primaryId = registry.primary()?.id
      return registry.all()
        .map((c) => ({
          id: c.id,
          primary: c.id === primaryId,
          focused: c.id === lastFocusedWindowId,
          activeWorkspace: (c.activeWorkspace ?? null) as import('../shared/types').ActiveWorkspace | null
        }))
        .sort((a, b) => a.id - b.id)
    }
  }, navPinsService, eventBus, packLoader, app.getVersion())
  // Stage 12 close / ENH-191 P3-S11a — wire the renderer event sink so the
  // socket server can push ambient cues (the read-glow + the duo-open
  // supplemental focus push). The cue's addressed window (3rd arg, resolved by
  // the getAddressedWindowId thunk) routes it to THAT window via routeAmbientCue
  // — at N=1 the sole window; at N>1 each cue lands where it was addressed.
  // ENH-191 P5a (Tier-3) — the thunk now returns the per-request cliTargetWindowId
  // (the DUO_WINDOW / --window N target), so an ambient cue from `duo --window N
  // selection` glows window N. undefined when unstamped → routeAmbientCue falls
  // back to the primary (resolveDefault). (Was registry.only() in a try/catch —
  // a fail-loud placeholder that degraded every N>1 cue to window 1.)
  socketServer.setEventSink(
    (channel, payload, addressedWindowId) => routeAmbientCue(registry, addressedWindowId, channel, payload),
    () => cliTargetWindowId
  )
  socketServer.start()

  // ENH-191 P4 — a renderer asks for ITS window id synchronously at preload
  // (sendSync) so per-window localStorage keys namespace by the SAME id the
  // registry routes by. Registered ONCE here at app-boot scope (NOT inside
  // createWindow) so a reentrant createWindow / dock-reopen (P5) doesn't
  // double-register; event.sender resolves the calling window every time.
  ipcMain.on(IPC.WINDOW_GET_ID, (event) => {
    event.returnValue = BrowserWindow.fromWebContents(event.sender)?.id ?? -1
  })

  // ENH-210 (D1-part2) — renderer → main: open a new window rooted at a
  // worktree (the navigator Worktrees dropdown). Same openNewWindow the
  // menu + `duo window new --cwd` use; no-ops with a warn when multi-
  // window is off (the dropdown affordance is best-effort, not gated UI).
  ipcMain.on(IPC.WINDOW_OPEN_AT, (_event, { cwd }: { cwd: string }) => {
    void openNewWindow({ initialCwd: cwd }).then((r) => {
      if (!r.ok) console.warn('[main] WINDOW_OPEN_AT:', r.error)
    })
  })

  // ENH-191 P5a — track the focused window for app-menu resolution (see
  // focusedWindowId / safeSendFocused). The event HANDS us the focused window,
  // so there is no ad-hoc focus query (the routing grep-gate stays 0).
  // Rebuild the menu on focus so the per-window checkbox checkmarks (Cozy /
  // Show Hidden Files / ⌘Return-for-Claude-submit) track whichever window the
  // user just switched to. Registered ONCE at boot, before the first
  // createWindow, so window 1's initial focus is captured.
  app.on('browser-window-focus', (_e, win) => {
    lastFocusedWindowId = win.id
    void rebuildAppMenu()
  })

  // ENH-191 P5a (S1/S3) — load the multiWindow flag before any window opens,
  // then refresh the menu so the "Allow Multiple Windows" checkbox reflects the
  // saved value (the initial menu build at boot ran before this load).
  await settingsService.load()
  // ENH-208 — reflect CLI `duo vault default` writes in the Settings menu.
  installDefaultVaultPrefWatcher()
  void rebuildAppMenu()
  // ENH-216 (U-RELINK, D5) — auto-relink the current default vault on app
  // start (OKF only; deferred + deduped, so it can't slow boot). PR#98 F5 —
  // boot is the one path that WRITES (no dirty buffers yet, user is opening
  // their own default vault); a live vault-switch only reports (dry-run).
  maybeAutoRelinkVault(vaultCore.readDefaultVault(), { write: true })

  // ENH-191 P5a (Tier-1) — seed the per-window session map from disk BEFORE the
  // first window's renderer can save, so a single-window save can't overwrite a
  // persisted multi-window envelope (DATA LOSS). Dormant windows survive until
  // explicitly closed.
  await sessionStateService.seedWindowsFromDisk()

  // ENH-191 P5a (Tier-3) — N-window boot restore. Reopen EVERY persisted window,
  // each hydrating its own slice (geometry + tabs + active workspace). Restore
  // in ASCENDING persisted-id order so the fresh BrowserWindow ids (1,2,…) line
  // up with the reassign in createWindow → collision-free re-keying (see
  // SessionStateService.reassignWindowId). When "Allow Multiple Windows" is OFF,
  // clamp to the first window (the rest stay dormant in the map — re-enabling +
  // relaunch brings them back, never lost). Empty / first launch → one default
  // window.
  {
    const persistedWindows = await sessionStateService.loadWindows()
    const restoreCount = settingsService.get().multiWindow ? persistedWindows.length : Math.min(persistedWindows.length, 1)
    if (restoreCount <= 1) {
      void createWindow() // restoreIndex 0 (the sole/first window) — or first launch
    } else {
      const order = persistedWindows
        .map((_, i) => i)
        .slice(0, restoreCount)
        .sort((a, b) => persistedWindows[a].windowId - persistedWindows[b].windowId)
      // Awaited sequentially so live ids are assigned in ascending order
      // (1,2,…) matching the ascending persisted-id processing — the invariant
      // reassignWindowId relies on to never collide.
      for (const idx of order) {
        await createWindow({ restore: true, restoreIndex: idx })
      }
    }
  }

  // BUG-124 — ensure ~/.claude/duo/logs/ exists at boot so the renderer's
  // writeConflictLog (renderer/utils/conflictDiagnostic.ts) can write to it
  // without flooding dev stderr with ENOENT noise on first conflict. The
  // FilesService.write path already does mkdir-p of the parent dir on each
  // call, but this lifts the guarantee up to boot-time so the dir is
  // present even before any first conflict surfaces. Fire-and-forget;
  // failure here is recorded by the FilesService write retry.
  void nodeFs.mkdir(
    join(homedir(), '.claude', 'duo', 'logs'),
    { recursive: true }
  ).catch((err) => {
    console.warn('[main] BUG-124 logs-dir mkdir failed:', err?.message ?? err)
  })

  // ENH-158 — boot-time self-heal for ~/.claude/duo/bin/duo (SHIM_DIR
  // CLI shim). Independent of FirstLaunchBanner so upgrades + non-
  // banner-clicked installs still get a working `duo` reachable by
  // bare name inside every Duo PTY (PtyManager prepends SHIM_DIR to
  // PATH at spawn). Fire-and-forget; the only consequence of a
  // failure here is bare `duo` not resolving on the next PTY spawn,
  // and the failure is recorded at ~/.claude/duo/logs/install-shim.log.
  // See docs/DECISIONS.md → "Boot-time self-healing CLI shim".
  void installService.ensureCliShim().then((result) => {
    if (!result.ok) {
      console.warn('[main] ensureCliShim:', result.action, result.error)
    } else if (result.action !== 'no-op') {
      console.log(`[main] ensureCliShim: ${result.action} ${result.shimPath} → ${result.target}`)
    }
  }).catch((err) => {
    console.warn('[main] ensureCliShim threw:', err)
  })

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

  // ENH-221 — load the cron store + start the in-app scheduler now that
  // services exist and windows are restored (so run-landing resolution sees
  // live windows + their focused projects). The runner spawns an INTERACTIVE
  // run via the existing shell-tab path (kind:'shell' + a full `claude …\n`
  // command); D4 headless gate lives in CronService (FEATURE_HEADLESS_CRON).
  try {
    await cronStore.load()
    cronService = new CronService({
      store: cronStore,
      headlessAllowed: FEATURE_HEADLESS_CRON,
      // D3 — does a prior session's JSONL still exist for (cwd, sessionId)?
      sessionExists: async (cwd, sessionId) => {
        const p = nodePath.join(homedir(), '.claude', 'projects', encodeProjectDir(cwd), `${sessionId}.jsonl`)
        return fsExistsSync(p)
      },
      runner: {
        spawn: async ({ cwd, command }) => {
          const windowId = resolveCronLandingWindow(cwd) // D10
          // D10(3) — no window open at all (registry empty → primary() is
          // undefined). The run is "missed", governed by D5 catch-up, NOT a
          // spawn error; CronService records it accordingly.
          if (windowId == null) {
            return { ok: false, reason: 'no-window' as const, error: 'no Duo window open — run deferred to next launch (D5)' }
          }
          // F1 — a scheduled run lands in a BACKGROUND tab (no focus steal);
          // the F2/ENH-223 attention badge is how the user discovers it.
          const r = await dispatchNewTabToWindow(windowId, { kind: 'shell', cwd, cmd: command, background: true })
          return { ok: r.ok, error: r.error }
        }
      },
      log: (msg) => console.log(msg)
    })
    // ENH-221 — start the scheduler only AFTER the primary window's renderer
    // has finished session restore. Two launch races, both surfaced in the live
    // walk: (1) firing at whenReady races renderer mount and the new-tab IPC
    // times out; (2) firing at did-finish-load races session restore, whose
    // wholesale setTabs(restored) CLOBBERS a launch catch-up's background tab —
    // the tab is created (run records 'ran') then wiped, so claude never runs.
    // The renderer fires SESSION_STATE_RESTORE_SETTLED once its restore chain
    // completes; a catch-up lands in the primary window, so we gate on THAT
    // window's signal. A timeout fallback guarantees the scheduler always starts
    // (e.g. a renderer that errored before signalling, or a headless boot).
    let cronStarted = false
    const startCronOnce = (): void => {
      if (cronStarted) return
      cronStarted = true
      ipcMain.removeAllListeners(IPC.SESSION_STATE_RESTORE_SETTLED)
      cronService?.start()
    }
    ipcMain.on(IPC.SESSION_STATE_RESTORE_SETTLED, (event) => {
      const senderId = BrowserWindow.fromWebContents(event.sender)?.id
      if (senderId != null && senderId === registry.primary()?.id) startCronOnce()
    })
    setTimeout(startCronOnce, 20_000)
  } catch (err) {
    console.warn('[main] cron scheduler failed to start:', err)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

// BUG-119 — `filesService.dispose()` (chokidar.close → fsevents
// threadsafe-function release) MUST run before Node env teardown.
// On darwin `window-all-closed` doesn't fire on Cmd+Q, so disposing
// there leaks the watcher into env shutdown and `fse_instance_destroy`
// SIGABRTs against an already-destroyed mutex. `before-quit` is the
// earliest reliable quit hook on every platform; do all teardown here.
//
// Also flushes session-state + browser-history here (Stage 21c +
// issue #27) so a force-quit during a debounce window doesn't lose
// the user's last state.
app.on('before-quit', async () => {
  for (const c of registry.all()) {
    const probe = c.presence as ClaudePresenceProbe | undefined
    probe?.stop()
  }
  // ENH-221 — stop the cron tick loop (jobs stay persisted in cron-jobs.json;
  // each mutation already persisted synchronously through the store's queue, so
  // no flush is owed here).
  cronService?.stop()
  cronService = null
  ptyManager.dispose()
  // ENH-191 P1c — app-scoped teardown on the ONLY quit path. On darwin
  // window-all-closed does NOT fire on Cmd+Q (BUG-119 above), and the closed
  // handler deliberately does NOT stop the socket (app-lifetime), so THIS is
  // the sole place the socket + external-domains are torn down. teardownApp's
  // appTornDown latch keeps it single-firing even if a non-darwin window-all-
  // closed→quit path also reaches it. Synchronous + before the first await so
  // socket.stop happens regardless of window-close interleaving.
  windowTeardown.teardownApp({
    socket: socketServer ?? undefined,
    external: externalDomainsService ?? undefined
  })
  socketServer = null
  externalDomainsService = null
  await filesService.dispose()
  await sessionStateService.flush()
  await browserHistory.flush()
  await workspaceHistoryService.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function setupIPC(): void {
  // ENH-191 P2 (item 5) — per-window-addressed (class-iii) handler routing.
  // P2 establishes the MECHANISM; no class-(iii) sends exist among the 41 at
  // N=1 (all resolve via registry.only() / safeSend today). When P3 keys the
  // caches + reqId families per window, a handler that must reply to ITS
  // invoking window resolves the target by event.sender, NOT registry.only():
  //
  //   import { resolveBySender } from './window-resolve'
  //   ipcMain.handle(CH, (event, args) => {
  //     const id = BrowserWindow.fromWebContents(event.sender)?.id
  //     const win = id != null ? resolveBySender(registry, id) : undefined
  //     win?.webContents.send(REPLY, ...)   // only the invoking window
  //   })
  //
  // The canonical live exemplar already in this file is FilesService.startWatch
  // (IPC.FILES_WATCH_START below) — it threads event.sender straight through as
  // the per-renderer watch target. Full cache-keying by sender lands in P3.

  // ── PTY ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.PTY_CREATE, (event, { id, shell, cwd }: { id: string; shell?: string; cwd?: string }) => {
    // ENH-191 P3-S4 — the owning window is the one whose renderer requested the
    // PTY (event.sender). DUO_WINDOW stamp is dormant; S5/S6/S7 use the owner.
    const ownerId = BrowserWindow.fromWebContents(event.sender)?.id ?? -1
    ptyManager.create(id, shell, cwd, ownerId)
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

  // ENH-187 — best-effort live cwd lookup for a PTY. The renderer's
  // `newTab` calls this synchronously on ⌘T so the new tab inherits the
  // focused terminal's CURRENT shell cwd rather than its launch cwd
  // (which is what nav.cwd tracks via follow-mode). Mirrors the live-
  // cwd-on-active-tab logic that the workspace-new flow already uses.
  ipcMain.handle(IPC.PTY_LIVE_CWD, (_event, { id }: { id: string }): string | null => {
    const pid = ptyManager.getPid(id)
    if (!pid) return null
    return getLiveCwdForPid(pid)
  })

  // BUG-191 — batched, non-blocking live-cwd + liveness for the project
  // rail's ghost-tile fix. The renderer polls this on an interval; see
  // getLiveCwdsForIds.
  ipcMain.handle(IPC.PTY_LIVE_CWDS, (_event, { ids }: { ids: string[] }) =>
    getLiveCwdsForIds(ids)
  )

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (event, { url }: { url: string }) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.navigate(url)
  })

  // ENH-178 — three-mode browser URL filter. Renderer reads + writes
  // through these handlers; the persisted source-of-truth is the
  // renderer's localStorage (so the value survives across Duo
  // launches without an extra main-process JSON file). On boot the
  // renderer pushes its persisted value via BROWSER_MODE_SET; main
  // mirrors it onto browserManager.setBrowserMode.
  ipcMain.handle(IPC.BROWSER_MODE_GET, async (event): Promise<{ mode: import('../shared/types').BrowserMode }> => {
    return { mode: browserForSender(event)?.getBrowserMode() ?? 'local-only' }
  })
  ipcMain.handle(IPC.BROWSER_MODE_SET, async (event, { mode }: { mode: import('../shared/types').BrowserMode }) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    if (mode !== 'unfiltered' && mode !== 'filtered' && mode !== 'local-only') {
      return { ok: false, error: `Invalid browser mode: ${String(mode)}` }
    }
    browserManager.setBrowserMode(mode)
    return { ok: true, mode }
  })

  ipcMain.on(IPC.BROWSER_BACK, (event) => {
    browserForSender(event)?.goBack()
  })

  ipcMain.on(IPC.BROWSER_FORWARD, (event) => {
    browserForSender(event)?.goForward()
  })

  ipcMain.on(IPC.BROWSER_RELOAD, (event) => {
    browserForSender(event)?.reload()
  })

  // Renderer reports the pixel bounds of the browser content area whenever
  // the split moves or the window resizes. We reposition the WebContentsView.
  // ENH-191 P5a — resolve by event.sender so window 2's bounds hit window 2's
  // WebContentsView (this fires automatically on mount/resize — the #1
  // window-2 mount crasher when it resolved only()).
  ipcMain.on(IPC.BROWSER_BOUNDS, (event, bounds: BrowserBounds) => {
    browserForSender(event)?.setBounds(bounds)
  })

  // Phase 3c — renderer reports aux-pane bounds for the aux-pinned
  // browser tab. Mirrors BROWSER_BOUNDS but routes to the separate
  // aux-bounds slot inside BrowserManager. Pushed from the
  // AuxBrowserSlot component on mount + ResizeObserver + window
  // resize + split divider drag.
  ipcMain.on(IPC.BROWSER_AUX_BOUNDS, (event, bounds: BrowserBounds) => {
    browserForSender(event)?.setAuxBounds(bounds)
  })

  // Phase 3c — renderer asks main to pin a browser tab into the aux
  // slot. Returns the pinned tab's url + title so the renderer can
  // render the aux header without a second round trip.
  ipcMain.handle(IPC.BROWSER_MOVE_TAB_TO_AUX, (event, tabId: number) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, error: 'BrowserManager not initialized' }
    return browserManager.moveTabToAux(tabId)
  })

  // Phase 3c — renderer asks main to release the aux-pinned tab back
  // to the main strip. The released tab becomes main-strip active.
  ipcMain.handle(IPC.BROWSER_RELEASE_AUX_TAB, (event) => {
    const browserManager = browserForSender(event)
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
  ipcMain.on(IPC.BROWSER_OVERLAY_MUTED, (event, payload: { muted: boolean }) => {
    browserForSender(event)?.setOverlayMuted(payload.muted)
  })

  // ENH-159b — element-inspect-mode toggle. Renderer calls this when the
  // user fires ⌘⇧C (or, in a follow-up, clicks the toolbar toggle).
  // Accepts a boolean or 'toggle' so the renderer doesn't need to read
  // current state first. BrowserManager.setInspectMode pushes
  // BROWSER_INSPECT_MODE back to the renderer with the new state.
  ipcMain.on(IPC.BROWSER_INSPECT_SET_MODE, (event, payload: { mode: boolean | 'toggle' }) => {
    browserForSender(event)?.setInspectMode(payload.mode)
  })

  // BUG-048 v3 — renderer-driven OS focus reclaim. The ⌘` toggle
  // computes its direction in the renderer first, then asks main to
  // pull OS focus from a WebContentsView (if needed) so a subsequent
  // renderer-side `.focus()` call on xterm or the editor lands. See
  // App.tsx § togglePaneFocus.
  // ENH-191 P5a — focus THIS window's renderer; event.sender IS its webContents
  // (was liveMainWindow()→only(), an uncaught ipcMain.on crash at N>1).
  ipcMain.on(IPC.PANE_FOCUS_RECLAIM, (event) => {
    event.sender.focus()
  })

  // ENH-028 — find-in-page. Renderer's find bar (in BrowserRenderer)
  // sends START on each keystroke / next / prev navigation. Main calls
  // webContents.findInPage; results are pushed back via the
  // `found-in-page` event listener wired in BrowserManager.wireEvents.
  ipcMain.on(IPC.BROWSER_FIND_START, (event, payload: { query: string; findNext?: boolean; forward?: boolean }) => {
    browserForSender(event)?.findInPage(payload.query, {
      findNext: payload.findNext,
      forward: payload.forward
    })
  })
  ipcMain.on(IPC.BROWSER_FIND_STOP, (event) => {
    browserForSender(event)?.stopFindInPage()
  })

  ipcMain.handle(IPC.BROWSER_GET_STATE, (event) => {
    return browserForSender(event)?.getState() ?? null
  })

  ipcMain.handle(IPC.BROWSER_GET_TABS, (event) => {
    return browserForSender(event)?.getTabs() ?? []
  })

  ipcMain.handle(IPC.BROWSER_ADD_TAB, async (event, { url }: { url?: string }) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, id: -1, url: '', title: '' }
    return browserManager.openTab(url)
  })

  ipcMain.handle(IPC.BROWSER_SWITCH_TAB, async (event, { id }: { id: number }) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.switchTab(id)
  })

  ipcMain.handle(IPC.BROWSER_CLOSE_TAB, async (event, { id }: { id: number }) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, error: 'BrowserManager not ready' }
    return browserManager.closeTab(id)
  })

  // BUG-027 — ⌘⇧T from browser focus pops the last-closed tab.
  ipcMain.handle(IPC.BROWSER_REOPEN_LAST_CLOSED, async (event) => {
    const browserManager = browserForSender(event)
    if (!browserManager) return { ok: false, reason: 'no-browser-manager' }
    return browserManager.reopenLastClosed()
  })

  // Issue #27 — URL-bar autocomplete suggestions from persisted history.
  ipcMain.handle(IPC.BROWSER_HISTORY_SUGGEST, async (_event, args: { prefix: string; limit?: number }) => {
    return browserHistory.suggest(args.prefix ?? '', args.limit ?? 8)
  })

  ipcMain.on(IPC.BROWSER_FOCUS_ACTIVE, (event) => {
    browserForSender(event)?.focusActive()
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

  ipcMain.handle(IPC.FILES_OPEN_PATH, (_event, { path: p }: { path: string }) => {
    return filesService.openPath(p)
  })

  // BUG-132 — distinct from FILES_OPEN_PATH (which is shell.openPath
  // for local files). This routes URLs through shell.openExternal with
  // the same scheme guard the agent path uses (openExternalUrl). The
  // Navigator's right-click "Open on GitHub" came through here.
  ipcMain.handle(IPC.FILES_OPEN_EXTERNAL_URL, (_event, { url }: { url: string }) => {
    return openExternalUrl(url)
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

  // ENH-096 v2 (Sprint 9 walk-1 fix) — directory-aware existence
  // probe for the wikilink vault-root walker.
  ipcMain.handle(IPC.FILES_DIR_EXISTS, (_event, { path: p }: { path: string }) => {
    return filesService.dirExists(p)
  })

  // ENH-016 — create a directory (navigator "New folder…").
  ipcMain.handle(IPC.FILES_MKDIR, (_event, { path: p }: { path: string }) => {
    return filesService.mkdir(p)
  })

  // Stage 26 PR 3 item 8 — path-kind probe (editable breadcrumb).
  ipcMain.handle(IPC.FILES_KIND, (_event, { path: p }: { path: string }) => {
    return filesService.kind(p)
  })

  // ENH-111 (Sprint 12) — file-size + mtime probe for image viewer chrome.
  ipcMain.handle(IPC.FILES_STAT, (_event, { path: p }: { path: string }) => {
    return filesService.stat(p)
  })

  // ENH-108 (Sprint 12) — paste-image: write clipboard image bytes to
  // disk beside the active doc. Filename is generated by the service
  // (timestamp + 4-char hex hash), insertion-relative path is returned
  // for the editor to compose the markdown link.
  ipcMain.handle(IPC.FILES_SAVE_IMAGE_BESIDE, (_event, { activeDocPath, bytes, ext, prefix }: { activeDocPath: string; bytes: Uint8Array; ext: string; prefix?: string }) => {
    return filesService.saveImageBeside(activeDocPath, bytes, ext, prefix)
  })

  // ENH-128 — HEIC / RAW transcode via nativeImage. Renderer hands
  // main the source bytes + sourceMime; main returns converted bytes
  // + ext for FILES_SAVE_IMAGE_BESIDE.
  ipcMain.handle(IPC.FILES_CONVERT_IMAGE_BYTES, (_event, { bytes, sourceMime }: { bytes: Uint8Array; sourceMime: string }) => {
    return filesService.convertImageBytes(bytes, sourceMime)
  })

  // ENH-208 Phase 2 — vault UI IPC. Thin adapters over core/vault so the
  // renderer affordances (⇧⌘N quick-capture, the ⌘⇧F vault-search palette,
  // the silent-stub type-picker) share the EXACT code paths of the
  // `duo vault capture|search|stub` CLI verbs. UI vault resolution is
  // default-first (D11/D22): the default vault, else the active file's
  // enclosing vault, else a clear "set a default vault" error. Handlers
  // are window-agnostic (global pref + fs), so no sender resolution.
  const NO_VAULT_ERROR =
    'No vault found — set one in Settings → Default Vault, or open a file inside a vault.'
  ipcMain.handle(IPC.VAULT_CAPTURE, (_event, { activePath }: { activePath?: string | null }) => {
    try {
      const root = vaultCore.resolveVaultForUi(activePath)
      if (!root) return { ok: false, error: NO_VAULT_ERROR }
      // Untyped capture — exact parity with bare `duo vault capture`;
      // typing happens later via processing (D6) or `--template` from the CLI.
      const result = vaultCore.captureNote(root, {})
      return { ok: true, path: result.path, absPath: result.absPath, root }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    IPC.VAULT_SEARCH,
    async (_event, { query, activePath, limit }: { query: string; activePath?: string | null; limit?: number }) => {
      try {
        const root = vaultCore.resolveVaultForUi(activePath)
        if (!root) return { ok: false, error: NO_VAULT_ERROR }
        // Async + yielded: the palette fires per debounced keystroke, and a
        // sync vault walk here would jank EVERY window's IPC at N>1. The
        // limit defaults to the core cap shared with `duo vault search`
        // (CLI-parity: same code path, same arguments) and echoes back so
        // the palette can flag truncation.
        const effectiveLimit = limit ?? vaultCore.VAULT_SEARCH_DEFAULT_LIMIT
        const hits = await vaultCore.searchAsync(root, query, effectiveLimit)
        return { ok: true, root, hits, limit: effectiveLimit }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
  ipcMain.handle(
    IPC.VAULT_STUB,
    (_event, { vaultRoot, type, name }: { vaultRoot: string; type: string; name: string }) => {
      try {
        if (!vaultCore.isVaultRoot(vaultRoot)) {
          return { ok: false, error: `not a vault (no okf_version index.md or .obsidian/): ${vaultRoot}` }
        }
        const result = vaultCore.createEntityStub(vaultRoot, type, name)
        return { ok: true, ...result }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
  ipcMain.handle(IPC.VAULT_TYPES, (_event, { vaultRoot }: { vaultRoot: string }) => {
    try {
      if (!vaultCore.isVaultRoot(vaultRoot)) {
        return { ok: false, error: `not a vault (no okf_version index.md or .obsidian/): ${vaultRoot}` }
      }
      const types = vaultCore
        .loadTemplates(vaultRoot)
        .map((t) => t.type)
        .sort()
      return { ok: true, types }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    IPC.VAULT_CREATE_TYPE,
    (_event, { vaultRoot, type }: { vaultRoot: string; type: string }) => {
      try {
        if (!vaultCore.isVaultRoot(vaultRoot)) {
          return { ok: false, error: `not a vault (no okf_version index.md or .obsidian/): ${vaultRoot}` }
        }
        // createType returns the CANONICAL type name — the caller must stub
        // with `type` from this result, not its raw filter text:
        // createEntityStub matches template types strictly, so a raw
        // "Meeting Note" against the normalized "meeting note" template
        // would dead-end on `unknown type` forever.
        return { ok: true, ...vaultCore.createType(vaultRoot, type) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // ENH-216 (VAULT MODE) — File → New Vault… dialog backend. The renderer
  // (Stage 4) collects { folder, format, name? } and calls VAULT_CREATE; we
  // scaffold via the SAME core/vault path the `duo vault init` CLI verb runs
  // (initVault → rememberVault → setDefaultVault). `format` is required from
  // the dialog (the dialog defaults to OKF per D2; initVault's own default is
  // also OKF, so an omitted format is harmless). `openPath` is what Stage 4
  // opens after a successful create: the OKF root index.md when present
  // (D4/D8), else the legacy README.md (Obsidian mode), absolute either way.
  ipcMain.handle(
    IPC.VAULT_CREATE,
    (_event, { folder, format, name }: { folder: string; format?: import('../core/vault').VaultMode; name?: string }) => {
      try {
        const result = vaultCore.initVault(folder, { format, name })
        // Register in the picker, then make it the default (parity with the
        // CLI verb). setDefaultVault validates the freshly-scaffolded root,
        // which fires the pref-file watcher → single menu rebuild trigger.
        vaultCore.rememberVault(result.root)
        vaultCore.setDefaultVault(result.root)
        const indexPath = nodePath.join(result.root, 'index.md')
        const openPath = fsExistsSync(indexPath)
          ? indexPath
          : nodePath.join(result.root, 'README.md')
        return {
          ok: true,
          root: result.root,
          created: result.created,
          warnings: result.warnings,
          openPath,
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )
  // The dialog's "Choose folder…" button. Mirrors chooseDefaultVaultViaDialog's
  // picker, but scoped to the sender's window and allowing folder creation in
  // the panel (D1 — pick a not-yet-existing target). Returns the chosen dir or
  // null on cancel.
  ipcMain.handle(IPC.VAULT_CREATE_PICK_DIR, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return null
    const result = await dialog.showOpenDialog(win, {
      title: 'New Vault Location',
      message: 'Pick (or create) a folder for the new vault',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // (ENH-216) The renderer editor's per-vault mode probe. wikilinkResolver's
  // findVaultRootAndMode calls this to decide whether the [[ ]] gesture serializes
  // as Obsidian wikilinks or OKF markdown rel links (D3/D4). Returns the live
  // marker-derived mode ('okf' when a root index.md carries okf_version, else
  // 'obsidian' for a .obsidian/ vault, else null); the renderer falls back to
  // 'obsidian' on null/throw. Must exist or OKF mode never activates in the editor.
  ipcMain.handle(IPC.VAULT_DETECT, (_event, { vaultRoot }: { vaultRoot: string }) => {
    try {
      return vaultCore.detectVaultMode(vaultRoot)
    } catch {
      return null
    }
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
    // BUG-030 / ENH-191 P2 (class-ii) — nav-pins.json is shared; the "(or other
    // window someday)" is now: fan out to EVERY window's navigator pinned rail.
    broadcastAll(registry, IPC.NAV_PINS_CHANGED, next)
    return next
  })

  // ENH-050 (v0.6.3) — native NSMenu + system sheet primitives that
  // replace the renderer-DOM ContextMenu / PinnedCloseConfirm /
  // trash-confirm modals. macOS draws these at the window-server
  // level, composing correctly above the WebContentsView regardless
  // of z-index — eliminates the WCV-mute pattern's flicker. See
  // `docs/DECISIONS.md § WCV-occlusion remediation` for rationale.
  ipcMain.handle(IPC.MENU_POPUP, async (event, req: import('../shared/types').MenuPopupRequest): Promise<import('../shared/types').MenuPopupResult> => {
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
      // ENH-191 P5a — parent the native popup on the INVOKING window (the
      // renderer that fired MENU_POPUP), not liveMainWindow()/only() — which
      // crashed at N>1 and would popup on window 1 from a window-2 right-click.
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const popupOpts: { window?: BrowserWindow; x?: number; y?: number; callback?: () => void } = {
        callback: () => resolve({ chosenId })
      }
      if (win) popupOpts.window = win
      if (typeof req.x === 'number') popupOpts.x = Math.round(req.x)
      if (typeof req.y === 'number') popupOpts.y = Math.round(req.y)
      menu.popup(popupOpts)
    })
  })

  // BUG-105 (Sprint 10) — main-process clipboard write. Renderer's
  // `navigator.clipboard.writeText` silently rejects when called from
  // a native NSMenu's `click` handler (no user-gesture context once
  // the menu opens). Use this from any "Copy path" / "Copy URL" /
  // similar context-menu wiring instead.
  ipcMain.handle(IPC.CLIPBOARD_WRITE_TEXT, (_event, text: string): void => {
    if (typeof text !== 'string') return
    clipboard.writeText(text)
  })

  // ENH-111 (Sprint 12) — copy an image file to the system clipboard.
  // Loads via `nativeImage.createFromPath` (handles every codec
  // Electron can decode: png/jpg/gif/webp/bmp/ico). Returns false
  // when the path doesn't decode — caller can surface a toast.
  ipcMain.handle(IPC.CLIPBOARD_WRITE_IMAGE, (_event, p: string): boolean => {
    if (typeof p !== 'string' || !p) return false
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })

  ipcMain.handle(IPC.DIALOG_CONFIRM, async (event, req: import('../shared/types').DialogConfirmRequest): Promise<import('../shared/types').DialogConfirmResult> => {
    // ENH-191 P5a — parent the confirm sheet on the INVOKING window (the
    // renderer that fired DIALOG_CONFIRM), not liveMainWindow()/only() — which
    // crashed at N>1 and would sheet onto window 1 from a window-2 action.
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { response: req.cancelId ?? 0 }
    const result = await dialog.showMessageBox(win, {
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

  // ENH-152a — git status probe for the Navigator root chip.
  ipcMain.handle(IPC.GIT_STATUS, async (_event, { cwd }: { cwd: string }) => {
    const { getGitStatus } = await import('../core/git/status')
    return getGitStatus(cwd)
  })

  // ENH-210 — list the git worktrees of the repo at cwd (main first,
  // cwd's worktree flagged isCurrent). Powers the navigator Worktrees
  // section. Returns [] for non-repos / git errors.
  ipcMain.handle(IPC.GIT_WORKTREES, async (_event, { cwd }: { cwd: string }) => {
    const { listWorktrees } = await import('../core/git/worktree')
    // ENH-210 (D4) — the navigator dropdown shows per-worktree dirty /
    // ahead-behind chips, so enrich with status. The CLI `duo worktree`
    // calls listWorktrees directly (cheap, no status).
    return listWorktrees(cwd, { withStatus: true })
  })

  // ENH-182 — D2 marker probe (renderer → main). Returns true if
  // `dir` contains a CLAUDE.md file or a .claude/ subdirectory.
  // Used by useProjects to detect project markers for dirs the
  // navigator hasn't scanned (e.g. ~/.claude when the user opens a
  // file under it without navigating there first).
  ipcMain.handle(IPC.PROJECTS_HAS_MARKER, async (_event, { dir }: { dir: string }) => {
    const { hasMarker } = await import('../core/projects-service')
    return hasMarker(dir)
  })

  // ENH-182 Phase 3 — persisted projects.json (pins + color overrides).
  // Singleton service; every mutation broadcasts PROJECTS_CHANGED so
  // subscribers (the renderer + any future CLI listener) update
  // without polling. Phase 4 CLI verbs reuse these same handlers via
  // socket-server routing.
  ipcMain.handle(IPC.PROJECTS_READ, async () => {
    return projectsService.read()
  })
  ipcMain.handle(IPC.PROJECTS_TOGGLE_PIN, async (_event, { root }: { root: string }) => {
    const next = await projectsService.togglePin(root)
    broadcastProjectsChanged(next)
    return next
  })
  // ENH-151 — clone wrapper (gh + git fallback) + gh-auth probe.
  ipcMain.handle(IPC.GIT_CLONE, async (_event, req: import('../shared/host-api').CloneRequest) => {
    const { runClone } = await import('../core/git/clone')
    return runClone(req)
  })
  ipcMain.handle(IPC.GH_AUTH_STATUS, async () => {
    const { probeGhAuth } = await import('../core/git/auth')
    return probeGhAuth()
  })

  // ENH-155 — compose a GitHub URL for a file/folder. Renderer
  // right-click handler calls this with absPath + isFolder; main
  // shells out to git remote + composes via composeGitHubUrl.
  ipcMain.handle(IPC.GIT_GITHUB_URL_FOR, async (_event, req: {
    cwd: string
    workTreeRoot: string
    branch: string
    absPath: string
    isFolder: boolean
  }) => {
    const { gitHubUrlFor } = await import('../core/git/remote-url')
    return gitHubUrlFor(req)
  })

  // ENH-152a v2 (peer-repos) — batch probe of which children of
  // `parentDir` are git repo roots. Returns a record of
  // { childName: GitStatusSnapshot } for repo-children only.
  ipcMain.handle(IPC.GIT_SCAN_REPOS_IN, async (_event, req: {
    parentDir: string
    childNames: string[]
  }) => {
    const { scanReposIn } = await import('../core/git/scan')
    const m = await scanReposIn(req.parentDir, req.childNames)
    return Object.fromEntries(m)
  })

  // ENH-152b — per-file dirty status + line-diff for a work-tree.
  // Returns a record of { absPath: { status, plus, minus } }.
  ipcMain.handle(IPC.GIT_DIRTY_FILES_FOR, async (_event, req: {
    workTreeRoot: string
  }) => {
    const { getDirtyFilesFor } = await import('../core/git/scan')
    const m = await getDirtyFilesFor(req.workTreeRoot)
    return Object.fromEntries(m)
  })

  // ENH-152c — fsevents-driven invalidation. Single watcher per
  // renderer (the navigator only shows one repo at a time). Renderer
  // calls START with the work-tree path; we replace any prior watcher
  // and emit INVALIDATE on debounced file events. STOP tears down.
  let gitWatcher: import('chokidar').FSWatcher | null = null
  let gitWatcherTimer: NodeJS.Timeout | null = null
  let gitWatchedPath: string | null = null
  // ENH-191 P5a (Tier-1) — the window that armed the watch. INVALIDATE routes to
  // THIS window, not safeSend→resolveDefault→only() (which throws UNCAUGHT inside
  // the chokidar fs-event callback at N>1 → main crash on any tracked-file change).
  let gitWatcherOwnerId: number | null = null
  const stopGitWatcher = async () => {
    if (gitWatcher) {
      try { await gitWatcher.close() } catch { /* ignore */ }
      gitWatcher = null
    }
    if (gitWatcherTimer) {
      clearTimeout(gitWatcherTimer)
      gitWatcherTimer = null
    }
    gitWatchedPath = null
    gitWatcherOwnerId = null
  }
  ipcMain.handle(IPC.GIT_WATCH_START, async (event, req: { workTreeRoot: string; cwd: string }) => {
    if (!req.workTreeRoot || !req.cwd) return { ok: false }
    // ENH-191 P5a (Tier-1) — the arming window owns INVALIDATE delivery. Single
    // module watcher, so last-armer wins (per-window watchers are a P5b refinement);
    // routing to a concrete window id is what avoids the only() crash.
    gitWatcherOwnerId = BrowserWindow.fromWebContents(event.sender)?.id ?? null
    // Watch ONLY the current navigator cwd at depth 1 — exactly the
    // rows the user can see. NOT the full workTreeRoot, because that
    // can be enormous (e.g. user has ~/Documents as a git repo →
    // recursive watch would overwhelm chokidar with thousands of
    // inotify watches and lock up the IPC socket under load).
    //
    // Trade-off: changes deeper than the current cwd don't trigger
    // an immediate refresh. The existing window-focus poll picks
    // those up when the user tab-switches back.
    if (gitWatchedPath === req.cwd) return { ok: true, reused: true }
    await stopGitWatcher()
    gitWatchedPath = req.cwd
    const chokidar = await import('chokidar')
    const fsw = chokidar.watch(req.cwd, {
      ignoreInitial: true,
      depth: 1,
      ignored: [
        /(^|[/\\])\.git([/\\]|$)/,
        /(^|[/\\])node_modules([/\\]|$)/,
        /(^|[/\\])\.next([/\\]|$)/,
        /(^|[/\\])\.cache([/\\]|$)/,
        /(^|[/\\])\.turbo([/\\]|$)/,
        /(^|[/\\])dist([/\\]|$)/,
        /(^|[/\\])build([/\\]|$)/,
        /(^|[/\\])out([/\\]|$)/,
        /(^|[/\\])\.duo([/\\]|$)/,
        /(^|[/\\])\.obsidian([/\\]|$)/,
        /\.DS_Store$/,
        /\.log$/
      ],
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      },
      usePolling: false
    })
    const fireInvalidate = () => {
      // ENH-191 P5a (Tier-1) — send to the arming window directly. registry.get
      // never throws (unlike safeSend's resolveDefault→only()), so a tracked-file
      // change at N>1 no longer crashes main from this chokidar callback.
      const ownerWin = gitWatcherOwnerId != null ? registry.get(gitWatcherOwnerId)?.window : undefined
      if (ownerWin && !ownerWin.isDestroyed() && !ownerWin.webContents.isDestroyed()) {
        ownerWin.webContents.send(IPC.GIT_WATCH_INVALIDATE)
      }
    }
    const scheduleInvalidate = () => {
      if (gitWatcherTimer) clearTimeout(gitWatcherTimer)
      gitWatcherTimer = setTimeout(fireInvalidate, 250)
    }
    fsw.on('add', scheduleInvalidate)
    fsw.on('change', scheduleInvalidate)
    fsw.on('unlink', scheduleInvalidate)
    fsw.on('addDir', scheduleInvalidate)
    fsw.on('unlinkDir', scheduleInvalidate)
    fsw.on('error', (err) => {
      console.warn('[ENH-152c] git watcher error:', err instanceof Error ? err.message : err)
    })
    gitWatcher = fsw
    return { ok: true, reused: false }
  })
  ipcMain.handle(IPC.GIT_WATCH_STOP, async () => {
    await stopGitWatcher()
    return { ok: true }
  })

  // Stage 21c Phase 2 — session state restored across relaunches.
  ipcMain.handle(IPC.SESSION_STATE_LOAD, (event) => {
    // ENH-191 P5a (S3) — a blank New-Window gets empty state so it doesn't
    // clone window 1's session (NFR-6.2). Byte-identical at N=1.
    const wid = BrowserWindow.fromWebContents(event.sender)?.id
    if (wid !== undefined && blankWindowIds.has(wid)) {
      return { ...EMPTY_SESSION_STATE }
    }
    // ENH-191 P5a (Tier-3) — each restored window loads ITS slice (the in-memory
    // map slot, re-keyed to this live id by reassignWindowId in createWindow),
    // not always windows[0] (load()). Unknown id (fromWebContents miss) → load().
    return wid !== undefined ? sessionStateService.loadFlatForWindow(wid) : sessionStateService.load()
  })
  ipcMain.handle(IPC.SESSION_STATE_SAVE, (event, state: import('../shared/types').SessionState) => {
    // ENH-191 P4 — key the per-window save by the CALLING renderer's window
    // (event.sender). At N=1 this resolves the sole window (== defaultWindowId);
    // the fallback covers the edge where fromWebContents misses.
    const wid = BrowserWindow.fromWebContents(event.sender)?.id ?? defaultWindowId(registry) ?? 1
    sessionStateService.save(state, wid)
  })

  // ENH-183 C5 — banner-title + message-count lookups against Claude's
  // JSONL store. Both are pure reads (D9 invariant — no caching, no
  // sidecars). Imports lazy because claude-session-tracker is read-only
  // and the IPC fires per banner render.
  ipcMain.handle(IPC.SESSION_READ_BANNER_TITLE, async (_event, payload: { uuid: string; cwd: string }) => {
    const { readBannerTitle } = await import('./claude-session-tracker')
    return readBannerTitle(payload.uuid, payload.cwd)
  })
  ipcMain.handle(IPC.SESSION_READ_MESSAGE_COUNT, async (_event, payload: { uuid: string; cwd: string }) => {
    const { readMessageCount } = await import('./claude-session-tracker')
    return readMessageCount(payload.uuid, payload.cwd)
  })
  ipcMain.handle(IPC.SESSION_LIST_PRIOR, async (_event, payload: { cwd: string; opts?: { limit?: number; excludeUuid?: string } }) => {
    const { listPriorSessions } = await import('./claude-session-tracker')
    return listPriorSessions(payload.cwd, payload.opts)
  })

  // ENH-183 pared 2026-05-25 (Option A): SESSION_MAYBE_HYDRATE IPC
  // dropped along with the hydrator + S2 inline-rename surface.

  // ENH-167 — workspace-as-file IPC handlers (renderer menu-clicks land
  // here; CLI verbs reach the same helpers via NavBridge).
  ipcMain.handle(IPC.WORKSPACE_FILE_SAVE, async (event, opts: { saveAs?: boolean }) => {
    // ENH-191 P5a — save the INVOKING window (renderer IPC → event.sender), not
    // the primary; a window-2 renderer must save window 2.
    return saveWorkspaceFile({ saveAs: opts?.saveAs === true, windowId: BrowserWindow.fromWebContents(event.sender)?.id })
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_OPEN, async (event) => {
    return openWorkspaceFileWithDialog(BrowserWindow.fromWebContents(event.sender)?.id)
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_OPEN_RECENT, async (event, opts: { path: string }) => {
    return openWorkspaceFile(opts.path, { windowId: BrowserWindow.fromWebContents(event.sender)?.id })
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_LIST_RECENT, () => {
    return workspaceHistoryService.listSorted()
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_ACTIVE, async (event) => {
    // ENH-191 P3-S10 — return THIS window's pointer (resolved by event.sender),
    // falling back to the shared service for an unseeded/unknown window.
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    const ctx = id != null ? registry.get(id) : undefined
    if (ctx && ctx.activeWorkspace !== undefined) return ctx.activeWorkspace
    await activeWorkspaceService.load()
    return activeWorkspaceService.get()
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_NEW, async (event) => {
    return newWorkspaceReset({ windowId: BrowserWindow.fromWebContents(event.sender)?.id })
  })
  ipcMain.handle(IPC.WORKSPACE_FILE_CLEAR_RECENT, async () => {
    await workspaceHistoryService.clear()
    await workspaceHistoryService.flush()
    void rebuildAppMenu()
    return { ok: true }
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

  // Stage 21d-i — distro pack discovery + install on launch.
  // Each pack at ~/.claude/duo/extra-packs/<name>/ is read; if its
  // requiresDuoVersion accepts the running Duo, the plugin source
  // is decomposed into standalone-skill destinations and the
  // CLAUDE.md snippet (if present) is merged. Atomic-replace
  // semantics — the previous version's tracked files are removed
  // before re-installation. Errors are logged but don't block the
  // launch path; users see the pack-install summary in `duo pack list`.
  void scanAndInstallDistroPacks()

  // v0.4.0 — GitHub Releases update checker.
  ipcMain.handle(IPC.UPDATE_CHECK, () => {
    return updateChecker.maybeRefresh()
  })

  ipcMain.handle(IPC.FILES_WATCH_START, (event, { id, paths, ignored, watchParents }: { id: string; paths: string[]; ignored?: (string | RegExp)[]; watchParents?: boolean }) => {
    // ENH-195 B2/B4 — thread the optional ignored-override + parent-watch flag
    // through to the single open-file editor's watcher.
    filesService.startWatch(id, paths, event.sender, IPC.FILES_CHANGED, { ignored, watchParents })
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

  // ENH-182 Phase 4 — renderer pushes the rail snapshot on every
  // change. Cached for `duo project list` + name→root resolution.
  ipcMain.on(IPC.PROJECTS_STATE_PUSH, (event, snapshot: import('../shared/types').ProjectsStateSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    projectsStateCache.set(id, snapshot)
  })

  // ENH-184 Phase 4 — renderer pushes the workspace-pill flag on
  // every change. Cached for `duo workspace-pill-menu` read.
  ipcMain.on(IPC.WORKSPACE_PILL_MENU_PUSH, (event, payload: { enabled: boolean }) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    workspacePillMenuEnabledCache.set(id, !!payload?.enabled)
  })

  ipcMain.on(IPC.NAV_STATE_PUSH, (event, snapshot: NavStateSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    navStateCache.set(id, snapshot)
    // ENH-172 — keep the View → Show Hidden Files checkmark in sync
    // with the authoritative renderer state. The renderer pushes
    // NAV_STATE_PUSH on every nav-state change (including showDotfiles
    // flips), so this is the same channel the menu checkmark rides.
    const menu = Menu.getApplicationMenu()
    if (menu && hiddenFilesMenuItemId) {
      const item = menu.getMenuItemById(hiddenFilesMenuItemId)
      if (item) item.checked = snapshot.showDotfiles === true
    }
  })

  // FOLLOWUP-025 v2 — renderer-initiated Clone modal trigger
  // (FileTree right-click "Clone GitHub repo here…"). Just forwards
  // to the openCloneModal bridge so all triggers (CLI verb, native
  // menu, renderer right-click) converge on the same path.
  ipcMain.on(IPC.NAV_OPEN_CLONE_MODAL_REQUEST, (_event, opts?: { path?: string } | null) => {
    openCloneModal(opts ?? undefined)
  })

  // Stage 11 — selection snapshot push from the active editor.
  ipcMain.on(IPC.EDITOR_SELECTION_PUSH, (event, snapshot: EditorSelectionSnapshot | null) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    editorSelectionCache.set(id, snapshot)
  })

  // Stage 17c — canvas selection snapshot push from the active canvas.
  ipcMain.on(IPC.PAGE_SELECTION_PUSH, (event, snapshot: PageSelectionSnapshot | null) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    canvasSelectionCache.set(id, snapshot)
  })

  // Stage 11 — renderer's reply to a doc-write request.
  // ENH-108 — image-insert reply.
  ipcMain.on(IPC.EDITOR_IMAGE_INSERT_RESULT, (event, result: import('../shared/types').ImageInsertResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    imageInsertPending.deliver(result.reqId, sid, result)
  })

  ipcMain.on(IPC.EDITOR_DOC_WRITE_RESULT, (event, result: DocWriteResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    docWritePending.deliver(result.reqId, sid, result)
  })

  // ENH-022 (v0.5.4) — doc-goto reply.
  ipcMain.on(IPC.EDITOR_DOC_GOTO_RESULT, (event, result: DocGotoResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    docGotoPending.deliver(result.reqId, sid, result)
  })

  // ENH-023 (v0.5.4) — doc-find reply.
  ipcMain.on(IPC.EDITOR_DOC_FIND_RESULT, (event, result: DocFindResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    docFindPending.deliver(result.reqId, sid, result)
  })

  // Renderer's reply to a doc-read request (live editor buffer).
  ipcMain.on(IPC.EDITOR_DOC_READ_RESULT, (event, result: DocReadResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    docReadPending.deliver(result.reqId, sid, result)
  })

  // Stage 17b Phase C — renderer's reply to a `duo html *` op.
  ipcMain.on(IPC.PAGE_HTML_OP_RESULT, (event, result: HtmlOpResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    htmlOpPending.deliver(result.reqId, sid, result)
  })

  // ENH-195 — renderer's reply to a `duo doc edit` PLAIN replace.
  ipcMain.on(IPC.EDITOR_DOC_EDIT_PLAIN_RESULT, (event, result: DocEditPlainResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    docEditPlainPending.deliver(result.reqId, sid, result)
  })

  // ENH-195 — renderer's reply to a `duo json set|merge` op.
  ipcMain.on(IPC.JSON_OP_RESULT, (event, result: JsonOpResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    jsonOpPending.deliver(result.reqId, sid, result)
  })

  // Stage 17d — renderer's reply to a `duo html comment` / `duo html comments`.
  ipcMain.on(IPC.PAGE_HTML_COMMENT_RESULT, (event, result: HtmlCommentResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    htmlCommentPending.deliver(result.reqId, sid, result)
  })
  ipcMain.on(IPC.PAGE_HTML_COMMENTS_LIST_RESULT, (event, result: HtmlCommentsListResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    htmlCommentsListPending.deliver(result.reqId, sid, result)
  })

  // ENH-167 — renderer replies to a session-state snapshot request.
  ipcMain.on(IPC.SESSION_STATE_SNAPSHOT_RESULT, (event, payload: { reqId: string; state: import('../shared/types').SessionState }) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    sessionSnapshotPending.deliver(payload.reqId, sid, payload.state)
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
  ipcMain.on(IPC.THEME_STATE_PUSH, (event, snapshot: ThemeStateSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    themeStateCache.set(id, snapshot)
    if (snapshot.mode === 'system' || snapshot.mode === 'light' || snapshot.mode === 'dark') {
      nativeTheme.themeSource = snapshot.mode
    }
  })

  // Sprint 16 / v0.6.15 — Claude-tab Enter key prefs push from the renderer.
  // ENH-170 v2 (Sprint 20) — also sync the Settings → "Cmd+Return for
  // Claude submit" menu checkmark to match `snapshot.claudeReturn`.
  ipcMain.on(IPC.CLAUDE_KEY_PREFS_STATE_PUSH, (event, snapshot: import('../shared/types').ClaudeKeyPrefsSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    claudeKeyPrefsStateCache.set(id, snapshot)
    const menu = Menu.getApplicationMenu()
    if (menu && claudeReturnMenuItemId) {
      const item = menu.getMenuItemById(claudeReturnMenuItemId)
      if (item) item.checked = snapshot.claudeReturn === 'newline'
    }
  })

  // BUG-138 Phase 2 — author identity push from the renderer.
  ipcMain.on(IPC.AUTHOR_STATE_PUSH, (event, snapshot: import('../shared/types').AuthorStateSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    if (snapshot && typeof snapshot.author === 'string') {
      authorStateCache.set(id, snapshot)
    }
  })

  // Stage 15 G19 \u2014 Send \u2192 Duo payload format push from the renderer.
  ipcMain.on(IPC.SELECTION_FORMAT_STATE_PUSH, (event, snapshot: SelectionFormatStateSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    selectionFormatStateCache.set(id, snapshot)
  })

  // ENH-041 / Sprint 3 \u2014 Split View aux state push. Renderer (App.tsx)
  // is the source of truth; main caches the latest snapshot for the
  // CLI's no-arg state query (`duo split-view`). Defensive shape check
  // because the renderer may push during boot before persistence
  // hydrates fully.
  ipcMain.on(IPC.WORKING_AUX_STATE_PUSH, (event, snapshot: WorkingAuxSnapshot) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    if (snapshot && (snapshot.aux === null || (snapshot.aux && typeof snapshot.aux.activePath === 'string'))) {
      workingAuxSnapshotCache.set(id, snapshot)
    }
  })

  // Stage 15 G17 \u2014 active terminal-tab id push from the renderer.
  // ENH-013 \u2014 the payload also carries `kind` so the claude-presence
  // probe can arm its starting-grace window for kind=='claude' tabs.
  ipcMain.on(IPC.TERMINAL_ACTIVE_PUSH, (event, payload: { id: string | null; kind: 'claude' | 'shell' | null }) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    activeTerminalIdCache.set(id, payload.id)
    const pid = payload.id ? ptyManager.getPid(payload.id) : null
    // ENH-191 P3-S8 — route presence to the OWNING window's probe (the window
    // whose terminal this push came from), resolved by event.sender.
    const probe = id != null ? (registry.get(id)?.presence as ClaudePresenceProbe | undefined) : undefined
    probe?.setTarget({ pid, kind: payload.kind })
  })

  // Stage 19c D23 \u2014 renderer asks "is `claude` on PATH?" before spawning a
  // claude tab so it can choose between auto-typing `claude\n` and the
  // install-banner fallback. Resolved synchronously per call (cheap;
  // `which` is fast) so the answer always reflects PATH at the moment of
  // the spawn \u2014 covers the case where the user `brew install`s claude
  // mid-session and then opens a tab.
  ipcMain.handle('terminal:claude-on-path', () => isClaudeOnPath())

  // Stage 19c D27 \u2014 renderer reply to a `duo new-tab` request.
  ipcMain.on(IPC.NEW_TAB_RESULT, (event, result: NewTabResult) => {
    const sid = BrowserWindow.fromWebContents(event.sender)?.id
    newTabPending.deliver(result.reqId, sid, result)
  })

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────
  // Renderer pushes the active tab's cozy state so the View-menu checkmark
  // stays in sync as the user switches tabs or toggles.

  ipcMain.on(IPC.COZY_STATE_PUSH, (event, cozy: boolean) => {
    const id = BrowserWindow.fromWebContents(event.sender)?.id
    cozyActiveTabCache.set(id, cozy)
    const menu = Menu.getApplicationMenu()
    if (!menu || !cozyMenuItemId) return
    const item = menu.getMenuItemById(cozyMenuItemId)
    if (item) item.checked = cozy
  })

  // ── ENH-212 Home (PRD § 4.4) ────────────────────────────────────────────────
  // Append-only handler block at the END of setupIPC (the pinned anchor [V]).
  // All reads recompute live (D9 — no cache); the snapshot's only transient
  // state is the in-flight coalescing promise (computeHomeSnapshot), NOT a cache.

  // Full snapshot — greeting + rolled-up projects with their recent sessions.
  // Concurrent invokes (N windows × 30s pollers) share one computation.
  ipcMain.handle(IPC.HOME_SNAPSHOT, async (_event, args: { limitPerProject?: number }): Promise<HomeSnapshot> => {
    return computeHomeSnapshot(args?.limitPerProject)
  })

  // Paged "all N sessions" expander for one project root — lazy head titles.
  // The open-session join rides along so an expanded session still shows its
  // green pill if a live terminal hosts it.
  ipcMain.handle(IPC.HOME_LIST_SESSIONS, async (_event, args: { root: string; offset: number; limit: number }): Promise<HomeSession[]> => {
    const join = await buildHomeOpenJoin()
    return listHomeSessions(args.root, args.offset, args.limit, { openByUuid: join.openByUuid })
  })

  // Session click contract (§ 4.3). Focus: raise the hosting window + activate
  // its terminal tab (openness re-checked first). Resume: spawn a new shell tab
  // running `claude --resume <uuid>` in the SENDER's window (D6 — identity,
  // never focus), uuid regex-validated (cf. sessionResume).
  ipcMain.handle(IPC.HOME_SESSION_ACTION, async (event, action: HomeSessionAction): Promise<HomeSessionActionResult> => {
    if (action.op === 'focus') {
      const ctx = registry.get(action.windowId)
      if (!ctx) return { ok: false, error: `window ${action.windowId} is no longer open` }
      const win = ctx.window as BrowserWindow
      if (win.isDestroyed()) return { ok: false, error: `window ${action.windowId} is no longer open` }
      win.focus()
      // Openness is re-checked at two layers: the window above (registry.get
      // + isDestroyed), and the tab id below — a tab that closed between
      // snapshot and click won't match any live tab, so the renderer's
      // activate handler is a harmless no-op (never a duplicate spawn).
      const activateSend = makeSafeSend(() => ctx.window)
      activateSend(IPC.TERMINAL_ACTIVATE_TAB, { tabId: action.tabId })
      // Expand the terminal pane if it's collapsed so the focused session shows.
      void revealTerminalIfCollapsed(action.windowId)
      return { ok: true }
    }

    // resume — validate the uuid before spawning anything (parity with the
    // sessionResume CLI verb's guard).
    if (!/^[0-9a-f-]{36}$/.test(action.uuid)) {
      return { ok: false, error: `uuid must be a UUID, got: ${action.uuid}` }
    }
    // Liveness re-check at CLICK time (not just snapshot time). If it's now
    // live in a Duo tab → focus it instead (focusing never forks). If it's
    // live OUTSIDE Duo → refuse UNLESS the user forced it: forking is the
    // user's call (owner directive 2026-06-13), but an *accidental* click on a
    // session that went live in the snapshot gap must not silently fork — so
    // we report externalLive and let the renderer warn-then-confirm.
    const liveNow = (await buildHomeOpenJoin()).openByUuid.get(action.uuid)
    if (liveNow?.kind === 'duo') {
      const ctx = registry.get(liveNow.windowId)
      const win = ctx?.window as BrowserWindow | undefined
      if (win && !win.isDestroyed()) {
        win.focus()
        makeSafeSend(() => ctx!.window)(IPC.TERMINAL_ACTIVATE_TAB, { tabId: liveNow.tabId })
        void revealTerminalIfCollapsed(liveNow.windowId)
        return { ok: true }
      }
    } else if (liveNow?.kind === 'external' && !action.force) {
      return {
        ok: false,
        externalLive: true,
        error: 'That session is running outside Duo (another terminal / the desktop app). Forking it here branches a new session from its current state.',
      }
    }
    const senderId = BrowserWindow.fromWebContents(event.sender)?.id
    // Fork vs resume. A *forced* click on a session still live OUTSIDE Duo is a
    // FORK — branch a NEW session id (--fork-session) so the original running
    // copy's transcript isn't clobbered by a second writer on the same id. A
    // plain resume of a genuinely-closed session continues it in place.
    const isFork = liveNow?.kind === 'external' && action.force === true
    const res = await dispatchNewTabToWindow(senderId, {
      kind: 'shell',
      cwd: action.cwd,
      cmd: buildResumeCommand(action.uuid, { fork: isFork }),
    })
    // Expand the terminal pane if collapsed so the spawned session is visible.
    if (res.ok) void revealTerminalIfCollapsed(senderId)
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  })
}

// ── App menu ────────────────────────────────────────────────────────────────
// Minimal menu template — only the View submenu carries product-specific
// items today (cozy toggle). Everything else follows Electron defaults so
// macOS shortcuts like Cmd+Q / Cmd+H / Cmd+M still work.

function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  cozyMenuItemId = 'cozy-toggle'
  hiddenFilesMenuItemId = 'hidden-files-toggle'
  claudeReturnMenuItemId = 'claude-return-toggle'

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
      // FOLLOWUP-025 v2 — native File menu with "Clone from GitHub…"
      // entry. Owner Q4 picked the label "Clone from GitHub…" over
      // "Clone GitHub Repo…". Q3 placement (after Open…) is moot
      // because Duo doesn't yet ship a native Open… menu entry; Clone
      // leads. Other File-menu items (New File, Open, Close) can be
      // added later — out of scope for v2 fix-list.
      // Accelerator ⌘⇧K matches the in-app chord (renderer's
      // useKeyboardShortcuts § openCloneModal). The native menu
      // accelerator beats the renderer's keydown handler, but they
      // both call the same openCloneModal() IPC path.
      label: 'File',
      submenu: [
        // ENH-169 (Sprint 20 / v0.7.7) — File menu items for new
        // file / new folder. Default location = navigator's
        // currently-focused dir (resolved in the renderer's
        // newMarkdownFile / newFolder callbacks via nav.state.cwd).
        // Accelerators mirror the chord plumbing already in
        // globalShortcuts.ts so a single binding owns each chord
        // (menu accelerators win over renderer matchers at the
        // app-menu level — they fire even when WebContentsView has
        // focus).
        {
          label: 'New File…',
          accelerator: 'CmdOrCtrl+N',
          click: () => safeSendFocused(IPC.NEW_FILE_REQUEST)
        },
        {
          label: 'New Folder…',
          // ENH-208 owner re-pick (2026-06-10) — ⌘⇧N now belongs to vault
          // quick-capture (D11); New Folder moved here. Menu accelerators
          // beat the renderer's chord matcher, so this MUST stay in sync
          // with globalShortcuts.ts (⌥⇧⌘N → newFolder) or the menu would
          // swallow the capture chord.
          accelerator: 'Alt+Shift+CmdOrCtrl+N',
          click: () => safeSendFocused(IPC.NEW_FOLDER_REQUEST)
        },
        {
          label: 'New Vault…',
          // ENH-216 (VAULT MODE, D1) — NO accelerator: the whole ⌘N family is
          // already spoken for (⌘N New File, ⌘⇧N vault quick-capture, ⌥⌘N New
          // Window, ⌥⇧⌘N New Folder). A new chord would collide; New Vault is
          // an infrequent action, so menu-only is fine (CLI parity: `duo vault
          // init <path> --format=okf|obsidian`).
          click: () => { openNewVaultModal({ windowId: focusedWindowId() }) }
        },
        // ENH-191 P5a (S3) — open a SECOND window (blank, its own workspace).
        // ⌥⌘N because ⌘N is New File and ⌘⇧N is vault quick-capture
        // (ENH-208 re-pick; New Folder sits at ⌥⇧⌘N). Gated on the
        // "Allow Multiple Windows" setting below; openNewWindow no-ops with a
        // structured result when off (the CLI verb surfaces the disabled error).
        {
          label: 'New Window',
          accelerator: 'Alt+CmdOrCtrl+N',
          // ENH-191 P5a (Tier-4) — grey out when multi-window is disabled. The
          // Settings checkbox calls rebuildAppMenu() on toggle, so this `enabled`
          // is recomputed live each rebuild.
          enabled: settingsService.get().multiWindow,
          click: () => { void openNewWindow() }
        },
        { type: 'separator' },
        // ENH-167 — workspace-as-file. Save the open tabs + terminals
        // to a `.duo-workspace`; open one to switch contexts (Duo
        // resets in-place and rehydrates from the loaded state).
        // Recent submenu shows up to 10 entries (prune-missing on
        // read). "Workspace" (not "session") to avoid collision with
        // Claude session terminology.
        {
          label: 'New Workspace',
          click: async () => { await newWorkspaceReset({ windowId: focusedWindowId() }) }
        },
        {
          label: 'Save Workspace…',
          click: async () => { await saveWorkspaceFile({ saveAs: false, windowId: focusedWindowId() }) }
        },
        {
          label: 'Save Workspace As…',
          click: async () => { await saveWorkspaceFile({ saveAs: true, windowId: focusedWindowId() }) }
        },
        {
          label: 'Open Workspace…',
          click: async () => { await openWorkspaceFileWithDialog(focusedWindowId()) }
        },
        {
          label: 'Open Recent Workspace',
          submenu: buildRecentWorkspacesSubmenu()
        },
        { type: 'separator' },
        {
          label: 'Clone from GitHub…',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => { openCloneModal({ windowId: focusedWindowId() }) }
        }
      ]
    },
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
            safeSendFocused(IPC.PASTE_PLAIN_REQUEST)
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
      // ENH-170 v2 (Sprint 20 / v0.7.7) — top-level Settings menu.
      // Owner-locked redesign 2026-05-22 — the v1 modal approach
      // (App > Settings… → renderer modal) was rejected as "fundamentally
      // flawed": owner originally asked for a menu item, not a panel.
      // v2 is a single native-menu checkbox here. Future settings get
      // added as more menu items under this same submenu — not as
      // panels in a hypothetical modal.
      //
      // The lone item flips `claudeReturn` between 'submit' (default,
      // terminal-passthrough) and 'newline' (Return inserts newline;
      // ⌘Return submits). Wired to the existing useClaudeKeyPrefs
      // plumbing (Sprint 16 / v0.6.15) — same path as the CLI verb
      // `duo claude-return`. The companion `duo shift-return` stays
      // CLI-only (agent-tunable; not a primary user concern).
      label: 'Settings',
      submenu: [
        {
          id: claudeReturnMenuItemId,
          label: '⌘Return for Claude submit',
          type: 'checkbox',
          // ENH-191 P5a — reflect + toggle the FOCUSED window's pref (getOrDefault
          // never throws; the menu rebuilds on focus). getDefault(registry) would
          // crash at N>1; resolve via focusedWindowId() and route the set to that
          // same window so the menu acts on the window the user is in.
          checked: claudeKeyPrefsStateCache.getOrDefault(focusedWindowId()).claudeReturn === 'newline',
          click: () => {
            // Toggle: 'submit' (Return submits, default) ↔ 'newline'
            // (Return = newline, ⌘Return = submit). The next
            // CLAUDE_KEY_PREFS_STATE_PUSH from the renderer will
            // update this checkmark via the handler below.
            const wid = focusedWindowId()
            const next = claudeKeyPrefsStateCache.getOrDefault(wid).claudeReturn === 'newline' ? 'submit' : 'newline'
            setClaudeReturnMode(next, wid)
          }
        },
        // ENH-191 P5a (S3) — enable/disable opening multiple windows. Default ON
        // (owner decision); when off, "New Window" + `duo window new` return a
        // disabled result. Persisted in ~/.claude/duo/settings.json. Gates only
        // window-OPENING; the registry stays byte-identical at N=1 either way.
        {
          label: 'Allow Multiple Windows',
          type: 'checkbox',
          checked: settingsService.get().multiWindow,
          click: (item) => {
            // ENH-191 P5a (Tier-4) — persist, then rebuild so File → New Window's
            // enabled-gate (+ this checkbox's own checked state) reflect the new
            // value immediately, not on the next unrelated rebuild.
            void settingsService.set({ multiWindow: item.checked }).then(() => rebuildAppMenu())
          }
        },
        // ENH-208 Phase 2 (D11) — the machine-global default vault: the
        // target of ⇧⌘N quick-capture and ⌘⇧F vault search. Same pref file
        // as `duo vault default` (~/.claude/duo/vault.json).
        {
          label: 'Default Vault',
          submenu: buildDefaultVaultSubmenu()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          id: cozyMenuItemId,
          label: 'Cozy mode — current tab',
          type: 'checkbox',
          // ENH-191 P5a — focused window's cozy state (getOrDefault never throws;
          // menu rebuilds on focus). getDefault(registry) crashed at N>1.
          checked: cozyActiveTabCache.getOrDefault(focusedWindowId()),
          click: () => {
            // Renderer flips authoritative state, then echoes back via
            // COZY_STATE_PUSH so the checkmark tracks the truth.
            safeSendFocused(IPC.COZY_TOGGLE)
          }
        },
        {
          // ENH-172 (Sprint 20 / v0.7.7) — show/hide hidden files in
          // the navigator. Renderer is the source of truth; the
          // checkmark is reconciled from NAV_STATE_PUSH (see the
          // handler above). Accelerator ⌘⇧. matches the Finder /
          // VS Code convention. `.claude` + `.obsidian` are always
          // visible regardless of this toggle (see FileTree §
          // shouldShow carve-outs).
          id: hiddenFilesMenuItemId,
          label: 'Show Hidden Files',
          type: 'checkbox',
          // ENH-191 P5a — focused window's navigator showDotfiles (getOrDefault
          // never throws; menu rebuilds on focus). getDefault(registry) crashed
          // at N>1. Route the toggle to the same focused window.
          checked: navStateCache.getOrDefault(focusedWindowId()).showDotfiles === true,
          accelerator: 'CmdOrCtrl+Shift+.',
          click: () => {
            setHiddenFiles('toggle', focusedWindowId())
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
            safeSendFocused(IPC.PANE_TOGGLE_FOCUS)
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
              click: () => setSplit(50, focusedWindowId())
            },
            {
              label: 'Terminal heavy (67/33)',
              accelerator: 'CmdOrCtrl+Alt+1',
              click: () => setSplit(67, focusedWindowId())
            },
            {
              label: 'Canvas heavy (33/67)',
              accelerator: 'CmdOrCtrl+Alt+3',
              click: () => setSplit(33, focusedWindowId())
            },
            {
              // ENH-099 — 3-pane even layout: outer 33/67 + inner aux
              // 50/50 (if aux is open). On-demand sibling of ENH-126's
              // auto-redistribute on aux-open.
              label: '3-way even (33/33/33)',
              accelerator: 'CmdOrCtrl+Alt+4',
              click: () => setLayout3wayEven(focusedWindowId())
            },
            { type: 'separator' },
            {
              label: 'Full terminal',
              accelerator: 'CmdOrCtrl+Alt+0',
              click: () => setSplit(80, focusedWindowId())
            },
            {
              label: 'Full canvas',
              accelerator: 'CmdOrCtrl+Alt+9',
              click: () => setSplit(20, focusedWindowId())
            }
          ]
        },
        { type: 'separator' },
        {
          // FOLLOWUP-015 (ENH-117 v2) — View source. No accelerator
          // here on purpose: the chord ⌘⌥V is owned by globalShortcuts.
          // ts so the WCV-forward path keeps working when the browser
          // pane has focus. Adding the accelerator on the menu would
          // move chord ownership to Electron and break that path. The
          // menu entry is for discoverability + mouse-driven trigger;
          // the chord remains the power-user accelerator.
          label: 'View source',
          click: () => safeSendFocused(IPC.VIEW_SOURCE_REQUEST)
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

// ENH-167 — rebuild the entire app menu. Called after any change that
// affects the File > Open Recent submenu (save/open/clear). Cheap
// enough to do every time — the menu template is rebuilt from scratch
// on every install too.
async function rebuildAppMenu(): Promise<void> {
  await workspaceHistoryService.ensureLoaded()
  installAppMenu()
}

// ENH-167 — Open Recent submenu items, read synchronously from the
// already-loaded history. The wrapper rebuildAppMenu() awaits
// ensureLoaded() before calling installAppMenu(), so by the time
// installAppMenu() runs, the entries are already in memory.
//
// We can't await fs.existsSync filtering here without making the menu
// builder async, so prune-on-render falls to the next listSorted()
// call. The user clicking a stale entry will surface a clean error
// from openWorkspaceFile + remove the entry. The window where this
// matters is small (file deleted between two menu builds).
function buildRecentWorkspacesSubmenu(): MenuItemConstructorOptions[] {
  // Read cached entries synchronously. rebuildAppMenu() awaits
  // ensureLoaded() before calling installAppMenu(), so by the time
  // this runs the entries[] is populated. First-launch boot before
  // any session has been saved → empty list → just shows
  // "Clear Recent Workspaces" (disabled).
  const cached = workspaceHistoryService.getEntriesSync()
  const sorted = [...cached].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  const items: MenuItemConstructorOptions[] = sorted.map(entry => ({
    label: `${entry.name}`,
    sublabel: entry.path,
    click: async () => { await openWorkspaceFile(entry.path, { skipPrompt: true, windowId: focusedWindowId() }) }
  }))
  if (items.length > 0) {
    items.push({ type: 'separator' })
  }
  items.push({
    label: 'Clear Recent Workspaces',
    enabled: sorted.length > 0,
    click: async () => {
      await workspaceHistoryService.clear()
      await workspaceHistoryService.flush()
      void rebuildAppMenu()
    }
  })
  return items
}

// ENH-208 Phase 2 (D11) — Settings → Default Vault. The default vault VALUE is
// machine-global (~/.claude/duo/vault.json), so the picker is WINDOW-INDEPENDENT:
// it lists the KNOWN vaults (every vault ever set as default or `vault init`'d —
// `listKnownVaults`, self-healed against the live filesystem) ∪ the current
// default, plus Choose Vault… for anything else. The same rows show in every
// window — no per-window-cwd scan — and clearing the default keeps the known
// list (so a cleared vault outside any workspace isn't stranded). Selecting
// writes the SAME file `duo vault default` reads/writes — the menu is just a UI
// editor for it. `listKnownVaults` is a cheap file read + isVaultRoot stats over
// a handful of entries, so it stays on the synchronous menu-build path safely
// (no BFS, no jank — the reason the old cwd-scan needed async machinery).
function menuVaultLabel(root: string): string {
  // abbreviateHome is the shared, tested prefix-guarded abbreviation
  // (also the palette footer's): '/Users/geoff-backup' must not render
  // as '~-backup' under home '/Users/geoff'.
  return `${nodePath.basename(root)}  —  ${abbreviateHome(root, homedir())}`
}

function buildDefaultVaultSubmenu(): MenuItemConstructorOptions[] {
  const current = vaultCore.readDefaultVault()
  // The current default unions in even if it somehow isn't in the known list
  // yet (it always should be — setDefaultVault records it — but belt + braces).
  const roots = [...new Set([...vaultCore.listKnownVaults(), ...(current ? [current] : [])])].sort()
  const items: MenuItemConstructorOptions[] = [
    // No explicit rebuildAppMenu() in these click handlers: every write
    // path (menu radios, Choose Vault… dialog, CLI `duo vault default`)
    // lands in the pref file, and installDefaultVaultPrefWatcher is the
    // SINGLE rebuild trigger — an explicit call here would just double the
    // rebuild ~150ms apart.
    {
      label: 'None',
      type: 'radio',
      checked: current == null,
      click: () => {
        vaultCore.clearDefaultVault()
      },
    },
    ...roots.map(
      (root): MenuItemConstructorOptions => ({
        label: menuVaultLabel(root),
        type: 'radio',
        checked: current === root,
        click: () => {
          try {
            vaultCore.setDefaultVault(root)
          } catch {
            // vault vanished since the menu built — the watcher-driven
            // rebuild self-heals (listKnownVaults drops the dead entry);
            // worst case (no write → no event) the radios refresh on the
            // next focus-driven rebuild.
          }
        },
      }),
    ),
    { type: 'separator' },
    {
      label: 'Choose Vault…',
      click: () => {
        void chooseDefaultVaultViaDialog()
      },
    },
  ]
  return items
}

async function chooseDefaultVaultViaDialog(): Promise<void> {
  const win = windowByIdOrPrimary(focusedWindowId())
  if (!win || win.isDestroyed()) return
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose Default Vault',
    message: 'Pick a vault folder (an OKF root index.md or an .obsidian/ directory)',
    properties: ['openDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return
  const picked = result.filePaths[0]
  try {
    vaultCore.setDefaultVault(picked)
    // No rebuildAppMenu() — the pref-file write just made fires the
    // watcher, the single rebuild trigger (see buildDefaultVaultSubmenu).
  } catch {
    // No write happened, so no rebuild is needed — nothing changed.
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Not a vault',
      detail: `${picked} is not a vault (no OKF root index.md with okf_version, and no .obsidian/ directory). Ask Claude to run \`duo vault init\` there first, or pick an existing vault.`,
    })
  }
}

// ENH-216 (U-RELINK, owner D5) — AUTO-RELINK for an OKF-mode default vault.
// Repairs dangling [Display](./moved.md) hrefs left by an out-of-band
// move/rename. Obsidian vaults skip entirely — their wikilinks survive a move
// by basename, so there is nothing to repair.
//
// PR#98 F5 — WRITE only on BOOT; a default-vault SWITCH is DRY-RUN + report.
// The pref-watcher fires for EVERY default-vault write, including a
// `duo vault default <path>` typed in an UNRELATED terminal/window. Letting
// that silently rewrite the target vault's notes is a cross-process surprise
// (git churn) and can banner an open dirty buffer (the BUG-085 class). At boot
// there are no dirty buffers and the user is opening their own default vault,
// so a write is safe + wanted. On a live switch we only REPORT the repairable
// count (the heal-write lands on the next boot or an explicit `duo vault
// relink`).
//
// NON-BLOCKING: relinkVault is a synchronous vault walk, deferred a tick off
// the critical path. DEDUPE: at most one run per root within a short window
// (boot + the pref-watcher debounce can both point at the same root).
const RELINK_DEDUPE_MS = 5000
const recentlyRelinked = new Map<string, NodeJS.Timeout>()
function maybeAutoRelinkVault(root: string | null, opts: { write?: boolean } = {}): void {
  if (!root) return
  if (recentlyRelinked.has(root)) return
  // PR#98 F5 — default DRY-RUN; only the boot call opts into the write.
  const write = opts.write ?? false
  // detectVaultMode is cheap (one .obsidian/ + okf-marker stat); the heavy
  // walk lives in relinkVault, which we only reach for OKF roots.
  let mode: import('../core/vault').VaultMode | null = null
  try {
    mode = vaultCore.detectVaultMode(root)
  } catch {
    return // unreadable root — nothing to repair
  }
  if (mode !== 'okf') return
  // Mark BEFORE scheduling so a second trigger in the same window is dropped;
  // the entry self-clears after the dedupe window so a later genuine re-open
  // (e.g. a note moved, then the vault re-picked) relinks again.
  const timer = setTimeout(() => recentlyRelinked.delete(root), RELINK_DEDUPE_MS)
  if (typeof timer.unref === 'function') timer.unref()
  recentlyRelinked.set(root, timer)
  // Defer off the critical path: a setTimeout(0) lets app-ready / the menu
  // rebuild finish first, then the sync walk runs. Errors are swallowed to a
  // warn — a relink failure must never crash boot or a vault switch.
  setTimeout(() => {
    try {
      const r = vaultCore.relinkVault(root, { dryRun: !write })
      if (write) {
        console.log(
          `[ENH-216] auto-relink ${root}: ${r.repaired.length} repaired, ${r.ambiguous.length} ambiguous, ${r.broken.length} broken`,
        )
      } else if (r.repaired.length > 0 || r.ambiguous.length > 0) {
        // Switch path — report only; do NOT rewrite the target vault's notes.
        console.log(
          `[ENH-216] auto-relink (dry-run, vault switch) ${root}: ${r.repaired.length} link(s) repairable, ${r.ambiguous.length} ambiguous, ${r.broken.length} broken — run \`duo vault relink\` to apply`,
        )
      }
    } catch (err) {
      console.warn('[ENH-216] auto-relink failed:', err instanceof Error ? err.message : err)
    }
  }, 0)
}

// ENH-208 — `duo vault default <path>` can rewrite the pref from any
// terminal while the app runs. Watch the pref's directory (the write is an
// atomic tmp+rename, so watching the file itself would drop the inode) and
// rebuild the menu so the radios reflect a CLI write without waiting for
// the next focus-driven rebuild. This watcher is the SINGLE rebuild
// trigger for ALL pref writers — the menu/dialog click handlers don't call
// rebuildAppMenu() themselves (that doubled every rebuild ~150ms apart).
// ENH-216 — it is ALSO the single trigger for auto-relink-on-vault-switch:
// every default-vault write (CLI, menu radio, Choose Vault…, VAULT_CREATE's
// setDefaultVault) lands here, so the relink hook rides the same chokepoint.
function installDefaultVaultPrefWatcher(): void {
  try {
    const prefDir = nodePath.dirname(vaultCore.DEFAULT_VAULT_FILE)
    const prefName = nodePath.basename(vaultCore.DEFAULT_VAULT_FILE)
    // Ensure the dir exists before watching: on a fresh machine the first
    // ever pref write creates it, and fs.watch on a missing dir would
    // throw — silently losing the single trigger for that first write.
    fsMkdirSync(prefDir, { recursive: true })
    let timer: NodeJS.Timeout | null = null
    fsWatchSync(prefDir, (_event, name) => {
      if (name !== prefName) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void rebuildAppMenu()
        // ENH-216 — a default-vault write just landed; if the new default is an
        // OKF vault, check for out-of-band-moved links. PR#98 F5 — DRY-RUN
        // (report only): this fires for a `duo vault default` from ANY terminal,
        // so it must not silently rewrite the target vault's notes / banner an
        // open buffer. The heal-write happens on the next boot or `duo vault relink`.
        maybeAutoRelinkVault(vaultCore.readDefaultVault())
      }, 150)
    })
  } catch {
    // best-effort: without the watcher the menu still refreshes on focus
  }
}

// ENH-167 — set the window title from the active workspace pointer.
// "Duo — <name>" when a session is loaded; bare "Duo" when untitled.
// ENH-167 v1.2 — also pushes ACTIVE_CHANGED to the renderer so the
// in-app titlebar badge tracks live (Duo's `titleBarStyle:
// 'hiddenInset'` hides the OS title, so the renderer paints its own).
function applyWindowTitle(ctx: WindowContext | undefined): void {
  if (!ctx) return
  const win = ctx.window as BrowserWindow
  if (win.isDestroyed()) return
  // ENH-191 P3-S10 — read THIS window's per-window active-workspace pointer
  // (seeded at boot + dual-written at every set/clear), not the shared
  // singleton two windows would clobber.
  const active = ctx.activeWorkspace ?? null
  if (active) {
    win.setTitle(`Duo — ${active.name}`)
  } else {
    win.setTitle('Duo')
  }
  // Push to THIS window's renderer (drives its in-app titlebar badge).
  try {
    win.webContents.send(IPC.WORKSPACE_FILE_ACTIVE_CHANGED, active)
  } catch (err) {
    // Renderer not ready yet (boot path) — harmless; the renderer
    // pulls via `sessionFile.active()` on mount.
  }
}

// ENH-167 — ask the renderer for the live SessionState (bypassing the
// autosave debounce). 3 s timeout — the renderer's reply is purely
// CPU-bound (no I/O) so this is generous.
const SESSION_SNAPSHOT_TIMEOUT_MS = 3000
async function dispatchSessionSnapshot(windowId?: number): Promise<import('../shared/types').SessionState | null> {
  // ENH-191 P5a — snapshot the threaded window (the workspace op's target),
  // else the primary. The reqId reply is already pinned to win.id.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) return null
  const reqId = `ss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<import('../shared/types').SessionState | null>((resolve) => {
    const timer = setTimeout(() => {
      sessionSnapshotPending.delete(reqId)
      console.warn('[workspace-file] snapshot request timed out')
      resolve(null)
    }, SESSION_SNAPSHOT_TIMEOUT_MS)
    sessionSnapshotPending.set(reqId, win.id, (state) => {
      clearTimeout(timer)
      resolve(state)
    })
    win.webContents.send(IPC.SESSION_STATE_SNAPSHOT_REQUEST, { reqId })
  })
}

// ENH-167 — save the current workspace to a .duo-workspace file.
//   - `saveAs=true` → always show the Save dialog.
//   - `saveAs=false` and an active workspace pointer exists → write
//     silently to its path (Standard ⌘S semantic).
//   - `saveAs=false` and no active pointer → behave as Save As.
//   - `targetPath` set (from CLI) → write to that path directly,
//     skipping the GUI dialog.
export async function saveWorkspaceFile(opts: { saveAs?: boolean; targetPath?: string; name?: string; windowId?: number }): Promise<{ ok: boolean; path?: string; name?: string; error?: string }> {
  // ENH-191 P5a — save THIS window (app-menu → focused; CLI → DUO_WINDOW; else
  // primary). win.id threads to the snapshot + the per-window pointer dual-write
  // so saving in window 2 can't persist/retitle window 1.
  const win = windowByIdOrPrimary(opts.windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  await activeWorkspaceService.load()
  let targetPath = opts.targetPath
  let suggestedName = opts.name ?? activeWorkspaceService.get()?.name ?? 'Untitled'

  // Pick a destination unless one was supplied.
  if (!targetPath) {
    const active = activeWorkspaceService.get()
    if (!opts.saveAs && active) {
      targetPath = active.path
      suggestedName = active.name
    } else {
      const defaultPath = active?.path
        ?? join(homedir(), `${suggestedName.replace(/[^A-Za-z0-9_-]+/g, '-') || 'Untitled'}.duo-workspace`)
      const result = await dialog.showSaveDialog(win, {
        title: 'Save Workspace',
        defaultPath,
        filters: [
          { name: 'Duo Workspace', extensions: ['duo-workspace'] }
        ]
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, error: 'cancelled' }
      }
      targetPath = result.filePath
      // Derive the name from the filename if the user didn't supply
      // one explicitly. Strip a single trailing `.duo-workspace`.
      const base = nodePath.basename(targetPath)
      suggestedName = base.endsWith('.duo-workspace') ? base.slice(0, -'.duo-workspace'.length) : base
    }
  }

  // Gather the live state via the renderer snapshot. If the renderer
  // doesn't reply (no window, hung), fall back to the on-disk autosave.
  let state = await dispatchSessionSnapshot(win.id)
  if (!state) {
    await sessionStateService.flush()
    state = await sessionStateService.load()
  }

  try {
    await workspaceFileService.save(targetPath, suggestedName, state, app.getVersion())
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) }
  }
  await activeWorkspaceService.set({ path: targetPath, name: suggestedName })
  await workspaceHistoryService.record({ path: targetPath, name: suggestedName, savedAt: new Date().toISOString() })
  // ENH-191 P3-S10 / P5a — dual-write the SAVED window's per-window pointer
  // (registry.get(win.id), never only() — which crashes at N>1 and would retitle
  // the wrong window) alongside the shared service; applyWindowTitle reads it.
  const savedCtx = registry.get(win.id)
  if (savedCtx) savedCtx.activeWorkspace = activeWorkspaceService.get()
  applyWindowTitle(savedCtx)
  void rebuildAppMenu()
  return { ok: true, path: targetPath, name: suggestedName }
}

// ENH-167 — open a `.duo-workspace` file: writes its embedded state to
// the autosave path + active-workspace pointer, then `app.relaunch()`.
// The cleanest way to replace the running workspace's tabs/terminals/
// browser tabs is to re-enter the existing boot-time restore — no
// in-place reset machinery needed. macOS apps switch workspaces this
// way regularly; the visual reset is unambiguous.
export async function openWorkspaceFile(filePath: string, opts: { skipPrompt?: boolean; windowId?: number } = {}): Promise<{ ok: boolean; path?: string; name?: string; error?: string }> {
  // ENH-191 P5a — switch THIS window (app-menu/recent → focused; CLI →
  // DUO_WINDOW; else primary). win.id threads through the pre-switch flush, the
  // per-window pointer, and applyNewSessionState so a switch in window 2 can't
  // reload/teardown window 1.
  const win = windowByIdOrPrimary(opts.windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }

  // BUG-151 (Sprint 20 / v0.7.7) — force-flush the current workspace
  // before loading the target. The autosave mirror hook
  // (`sessionStateService.setMirrorHook`) writes the latest state to
  // the active `.duo-workspace` on every flush, so this guarantees the
  // user's current work is persisted to its file BEFORE the switch.
  // Pre-fix: we instead PROMPTED the user with "Save current workspace?"
  // but clicking Save wrote to the wrong file (the current active, not
  // the target) — see BUG-151 entry in tasks.md. Drop the prompt; rely
  // on the mirror hook + explicit flush. The `skipPrompt` opt no longer
  // affects behavior but stays in the signature for back-compat with
  // CLI callers.
  const currentActive = activeWorkspaceService.get()
  if (currentActive) {
    try {
      const snapshot = await dispatchSessionSnapshot(win.id)
      if (snapshot) {
        // ENH-191 P5a — persist the OUTGOING workspace to the switching window's
        // own per-window slot (win.id), never defaultWindowId() (crashes at N>1).
        sessionStateService.save(snapshot, win.id)
        await sessionStateService.flush()
      }
    } catch (err) {
      // Best-effort — if the flush fails the user's latest state may
      // not have been mirrored, but the load proceeds either way.
      // Surface as a log line so it shows up in `~/.claude/duo/logs/`
      // if anyone investigates.
      console.warn('[BUG-151] pre-switch flush failed:', err)
    }
  }

  const envelope = await workspaceFileService.load(filePath)
  if (!envelope) {
    await workspaceHistoryService.forget(filePath)
    void rebuildAppMenu()
    return { ok: false, error: `Failed to read workspace file: ${filePath}` }
  }

  // Stamp the loaded SessionState's savedAt + appVersion so the next
  // boot sees "loaded just now" diagnostics (the autosave loop will
  // overwrite within 500 ms regardless).
  const stamped: import('../shared/types').SessionState = {
    ...envelope.state,
    savedAt: new Date().toISOString(),
    appVersion: app.getVersion()
  }
  // Set active pointer + history BEFORE applying so the window title
  // reflects the new name as soon as the renderer reload finishes.
  await activeWorkspaceService.set({ path: filePath, name: envelope.name })
  // ENH-191 P5a — the OPENED window's per-window pointer (registry.get(win.id),
  // never only()); applyWindowTitle retitles THIS window only.
  const openedCtx = registry.get(win.id)
  if (openedCtx) openedCtx.activeWorkspace = activeWorkspaceService.get()
  applyWindowTitle(openedCtx)
  await workspaceHistoryService.record({ path: filePath, name: envelope.name, savedAt: envelope.savedAt })
  await workspaceHistoryService.flush()
  void rebuildAppMenu()
  await applyNewSessionState(stamped, win.id)
  return { ok: true, path: filePath, name: envelope.name }
}

// ENH-167 — Open Workspace dialog flow. Shows the prompt-to-save
// modal first, then a file picker.
async function openWorkspaceFileWithDialog(windowId?: number): Promise<{ ok: boolean; path?: string; name?: string; error?: string }> {
  // ENH-191 P5a — the Open-Workspace dialog flow (app-menu → focused; renderer
  // IPC → sender; else primary). The picked file opens into THIS window.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  // BUG-151 — no pre-switch prompt; the openWorkspaceFile call below
  // force-flushes the current workspace via the mirror hook. The Open
  // dialog is the user's intent to switch — no need to confirm save first.
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Workspace',
    properties: ['openFile'],
    filters: [
      { name: 'Duo Workspace', extensions: ['duo-workspace'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' }
  }
  return openWorkspaceFile(result.filePaths[0], { skipPrompt: true, windowId: win.id })
}

// ENH-167 — prompt the user to save the current workspace before
// replacing it. Returns `false` when the user cancels OR when the
// chained Save dialog gets cancelled. Returns `true` to proceed.
// Owner Q2 — Save / Don't Save / Cancel.
//
// `action` parametrizes the prompt copy:
//  - 'open' → "before opening another?" (Open Workspace / Open Recent)
//  - 'new'  → "before starting a new one?" (New Workspace)
async function promptToSaveCurrentWorkspace(action: 'open' | 'new' = 'open', windowId?: number): Promise<boolean> {
  // ENH-191 P5a — parent the Save?/Don't/Cancel sheet on THIS window + save it.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) return false
  // BUG-151 (Sprint 20 / v0.7.7) — this prompt is now ONLY reachable
  // from `newWorkspaceReset` (the "wipe everything and start fresh"
  // flow). Workspace switching no longer prompts; it relies on the
  // autosave mirror hook + explicit pre-switch flush in
  // openWorkspaceFile. Name the active workspace explicitly so the
  // user knows which file is being saved when they click Save.
  const activeName = activeWorkspaceService.get()?.name
  const currentLabel = activeName ? `'${activeName}'` : 'the current workspace'
  const message = action === 'new'
    ? `Save unsaved changes to ${currentLabel} before starting a new workspace?`
    : `Save unsaved changes to ${currentLabel} before opening another?`
  const detail = action === 'new'
    ? 'Your current tabs and terminals will be replaced with a fresh workspace (one shell terminal at the focused tab’s working directory, plus any pinned tabs).'
    : 'Your current tabs, terminals, and browser tabs will be replaced.'
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Save current workspace?',
    message,
    detail,
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (result.response === 2) return false                   // Cancel
  if (result.response === 1) return true                    // Don't Save → proceed
  // Save → if active, save silently; else open Save dialog. If the
  // save itself fails or is cancelled, abort.
  const save = await saveWorkspaceFile({ saveAs: false, windowId })
  if (!save.ok) return false
  return true
}

// ENH-167 — best-effort live CWD for a PTY's process. macOS-only via
// `lsof`. Returns null on any failure (lsof missing, permission
// denied, dead pid, unreadable) — caller falls back to the spawn CWD.
// The 1-second timeout keeps a hung lsof from blocking the menu.
function getLiveCwdForPid(pid: number): string | null {
  try {
    const out = execSync(`lsof -a -d cwd -p ${pid} -Fn`, {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString()
    const line = out.split('\n').find(l => l.startsWith('n'))
    if (!line) return null
    const cwd = line.slice(1).trim()
    return cwd || null
  } catch {
    return null
  }
}

// BUG-191 — async sibling of getLiveCwdForPid. Uses execFile (no shell,
// args array) and does NOT block the main thread, so the project-rail
// poll can resolve many terminals' live cwds in parallel.
async function getLiveCwdForPidAsync(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
      timeout: 1000
    })
    const line = stdout.split('\n').find((l) => l.startsWith('n'))
    if (!line) return null
    const cwd = line.slice(1).trim()
    return cwd || null
  } catch {
    return null
  }
}

// BUG-191 — batched live-cwd + liveness for the project rail. 'exited'
// shells report alive:false (the renderer drops their ghost tile),
// 'unknown' shells (PTY not spawned yet) report alive:true with a null
// cwd (renderer keeps the launch cwd), and 'live' shells get an lsof
// probe. All probes run in parallel so the main thread never blocks.
async function getLiveCwdsForIds(
  ids: string[]
): Promise<Record<string, { alive: boolean; cwd: string | null }>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      const liveness = ptyManager.getLiveness(id)
      if (liveness === 'exited') return [id, { alive: false, cwd: null }] as const
      if (liveness === 'unknown') return [id, { alive: true, cwd: null }] as const
      const pid = ptyManager.getPid(id)
      const cwd = pid ? await getLiveCwdForPidAsync(pid) : null
      return [id, { alive: true, cwd }] as const
    })
  )
  return Object.fromEntries(entries)
}

// ───────────────────────────────────────────────────────────────────────
// ENH-212 — Home open-session join (PRD § 4.3). Evidence-gated joins ONLY
// (D13): a session is "open" iff a LIVE PTY's lsof cwd matches the cwd of a
// persisted terminal carrying that session's lastClaudeSession.id pointer.
// The newest-jsonl-mtime-≤2min heuristic is BANNED (D13). One ps + one lsof
// batch per snapshot (never per row) [V].
// ───────────────────────────────────────────────────────────────────────

interface HomeOpenJoin {
  openByUuid: OpenByUuid
}

/**
 * Compute the open-session attribution — PROCESS-primary (ENH-212 round-2).
 * One `ps` parse finds every live `claude` and the Duo PTY (if any) that owns
 * it; we lsof each claude's cwd, group by cwd, and (per cwd) read the freshest
 * session uuids. attributeOpenSessions then marks the N freshest uuids open —
 * Duo-hosted ones focusable, the rest `external`. Covers Duo tabs, external
 * terminals, and the desktop app alike — the "ALL running sessions, focus-not-
 * fork" guarantee. A cwd with no project dir (e.g. the desktop app's internal
 * agent-mode claude under Application Support) maps to no sessions and is
 * dropped — so it never raises a false "could fork" warning.
 */
async function buildHomeOpenJoin(): Promise<HomeOpenJoin> {
  const live = ptyManager.listAllLive()
  const primaryId = registry.primary()?.id ?? -1
  // Duo PTY shell pid -> {windowId, tabId} for owner lookup.
  const ptyByPid = new Map<number, { windowId: number; tabId: string }>()
  for (const s of live) {
    if (s.pid != null) {
      ptyByPid.set(s.pid, { windowId: s.ownerWindowId >= 0 ? s.ownerWindowId : primaryId, tabId: s.id })
    }
  }

  // One `ps` parse: every live claude + the owning Duo PTY pid (or null).
  const claudeProcs = await mapLiveClaudeOwners([...ptyByPid.keys()])
  if (claudeProcs.length === 0) return { openByUuid: new Map() }

  // Resolve each live claude's cwd (async lsof variant, never the blocking one).
  const withCwd = await Promise.all(
    claudeProcs.map(async (c) => ({ ...c, cwd: await getLiveCwdForPidAsync(c.pid) }))
  )

  // Group by cwd; a cwd with no ~/.claude/projects dir / no sessions is not a
  // Home session (desktop-internal claude, a scratch dir) and is skipped.
  const byCwd = new Map<string, typeof withCwd>()
  for (const c of withCwd) {
    if (!c.cwd) continue
    const list = byCwd.get(c.cwd)
    if (list) list.push(c)
    else byCwd.set(c.cwd, [c])
  }

  const groups: LiveCwdGroup[] = []
  for (const [cwd, members] of byCwd) {
    const projectDir = join(homedir(), '.claude', 'projects', encodeProjectDir(cwd))
    const sessions = await listTopLevelSessions(projectDir)
    if (sessions.length === 0) continue
    sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const duoTabs: Array<{ windowId: number; tabId: string }> = []
    let externalCount = 0
    for (const m of members) {
      const owner = m.ownerPtyPid != null ? ptyByPid.get(m.ownerPtyPid) : undefined
      if (owner) duoTabs.push(owner)
      else externalCount++
    }
    groups.push({ cwd, duoTabs, externalCount, uuidsByRecency: sessions.map((s) => s.id) })
  }

  return { openByUuid: attributeOpenSessions(groups) }
}

/** Resolve a set of pids to their lsof cwds (deduped, best-effort). Used
 *  for the unattributed-live-claude guard. */
// ENH-212 — in-flight coalescing for HOME_SNAPSHOT (N windows × 30s pollers
// would otherwise fan out N concurrent recomputes). A TRANSIENT shared
// promise, NOT a cache (D9 clean): set on the first concurrent call, cleared
// the moment it settles, so each fresh invoke after settle recomputes live.
//
// Keyed by limitPerProject so concurrent invokes requesting DIFFERENT page
// sizes compute independently — coalescing on nothing would silently hand a
// second caller the first's snapshot built with the wrong limit (the renderer
// always passes HERO_SESSION_LIMIT=3 today, but a CLI verb / second surface
// could ask for a larger limit and must get it).
const homeSnapshotInflight = new Map<number, Promise<HomeSnapshot>>()

async function computeHomeSnapshot(limitPerProject?: number): Promise<HomeSnapshot> {
  // `undefined` ⇒ the service default (DEFAULT_LIMIT_PER_PROJECT); -1 is its
  // distinct coalescing key (no valid limit is negative).
  const key = limitPerProject ?? -1
  const existing = homeSnapshotInflight.get(key)
  if (existing) return existing
  const work = (async () => {
    const join = await buildHomeOpenJoin()
    return buildHomeSnapshot({
      limitPerProject,
      openByUuid: join.openByUuid,
    })
  })()
  homeSnapshotInflight.set(key, work)
  try {
    return await work
  } finally {
    homeSnapshotInflight.delete(key)
  }
}

// ENH-167 — apply a new SessionState to the running Duo without
// app.relaunch(). Tears down current PTYs + browser WCVs, writes the
// new state to disk, reloads the renderer (which re-runs the boot-
// time session-restore against the now-current state), and re-arms
// the pin-restore for browser tabs (which is the `once`d listener on
// `did-finish-load` in createWindow).
//
// In-place because `app.relaunch() + app.exit()` breaks the Vite dev
// server (npm run dev → electron-vite dev forks Electron; exiting
// kills both). In packaged mode it works, but the in-place path is
// faster (~200ms vs ~2s) and uniform across dev/prod. Owner reported
// "whole window disappeared, relaunched blank window" on 2026-05-21
// — that was the relaunch surfacing the dev-mode break.
async function applyNewSessionState(state: import('../shared/types').SessionState, windowId?: number): Promise<void> {
  // ENH-191 P5a — apply to THIS window (callers thread the operated-on id). ALL
  // sub-steps below (save, browser teardown, PTY dispose, reload) MUST target
  // the SAME window or a switch in window A would reload/teardown window B.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) return

  // Save the new state so the reloaded renderer reads it — keyed by THIS
  // window's per-window slot (win.id), never defaultWindowId() (crashes at N>1).
  sessionStateService.save(state, win.id)
  await sessionStateService.flush()

  // Tear down current browser tabs. Closing each tab cleanly via
  // BrowserManager preserves CDP/closed-tabs/aux state correctly,
  // unlike dispose() which would also detach CDP and break the
  // reused BrowserManager.
  // ENH-191 P5a — resolve THIS window's BrowserManager (registry.get(win.id),
  // never liveBrowser()/only() — crashes at N>1 + would tear down window 1's
  // tabs). The deferred did-finish-load callback below captures it (the manager
  // is reused across a workspace switch, not re-created, so the ref stays valid).
  const browserManager = (registry.get(win.id)?.browserManager as BrowserManager | undefined) ?? null
  if (browserManager) {
    const currentTabs = [...browserManager.getTabs()]
    for (const tab of currentTabs.reverse()) {
      try { await browserManager.closeTab(tab.id) } catch { /* ignore */ }
    }
  }

  // ENH-191 P3-S6 — kill only THIS window's PTYs (the swapping window), not the
  // whole shared pool. At N=1 the sole window owns every PTY, so this kills the
  // same set dispose() did; at N>1 a workspace swap in window A no longer nukes
  // window B's terminals. The renderer reload re-creates PTYs via pty:create.
  // ENH-191 P5a — dispose only THIS window's PTYs (win.id), never a re-resolved
  // liveMainWindow() (crashes at N>1 + could nuke the wrong window's terminals).
  ptyManager.disposeForWindow(win.id)

  // Re-arm the browser-pin-restore for the NEXT did-finish-load
  // (the one that fires after this reload). The createWindow path's
  // `once` listener already consumed for the initial boot.
  //
  // BUG-152 (Sprint 20 / v0.7.7) — ALSO restore the new workspace's
  // browser tabs here. Pre-fix, only the boot-time createWindow path
  // called `browserManager.restoreFromSession(persistedAtBoot.…)` and
  // `persistedAtBoot` was a closure variable captured ONCE at boot.
  // Workspace switches tore down existing tabs (line 2364) but never
  // restored the new workspace's tabs because the boot-time restore
  // didn't re-fire and applyNewSessionState only handled pinned tabs.
  // Result: switching workspaces lost ALL non-pinned browser tabs —
  // the smoke walk + Example Domain etc. disappeared on switch.
  win.webContents.once('did-finish-load', async () => {
    try {
      if (browserManager && state.browserTabs && state.browserTabs.length > 0) {
        await browserManager.restoreFromSession(state.browserTabs, state.activeBrowserIndex)
      }
    } catch (err) {
      console.warn('[apply-session] workspace browser-tab restore failed:', (err as Error)?.message ?? err)
    }
    try {
      const pinnedEntries = await pinsService.list()
      const browserPins = pinnedEntries.filter(p => p.kind === 'browser')
      if (browserPins.length > 0 && browserManager) {
        const currentUrls = new Set(browserManager.getTabs().map(t => t.url))
        for (const pin of browserPins) {
          if (!currentUrls.has(pin.ref)) browserManager.addTab(pin.ref)
        }
      }
    } catch (err) {
      console.warn('[apply-session] pinned browser tab restore failed:', (err as Error)?.message ?? err)
    }
  })

  // Reload the renderer. Fresh React mount → session-restore reads
  // session-state.json → 1 terminal at the captured CWD + pinned
  // file tabs auto-open via App.tsx's pinAutoOpenRanRef.
  win.webContents.reload()
}

// ENH-167 — File > New Workspace resets the workspace in-place.
// Locked semantics (owner answers 2026-05-21):
//   1. Whenever any terminal or file tab is open → prompt
//      Save / Don't Save / Cancel (parametrized 'new' copy).
//   2. Always spawn one fresh shell terminal at the live CWD of the
//      previously-frontmost terminal (lsof, with the persisted
//      spawn cwd as fallback).
//   3. Drop every working-pane tab (file + browser) — pinned tabs
//      auto-restore on the next boot via the existing pin-restore
//      paths (browser pins in main.ts § did-finish-load BUG-057
//      block; file pins in App.tsx § pinAutoOpenRanRef).
//   4. Clear the active-workspace pointer (window title back to "Duo").
//   5. In-place reset — same mechanism as Open Workspace: write the
//      skeleton state to session-state.json + clear the active
//      pointer, then restart so the existing boot-time restore in
//      App.tsx re-runs against the skeleton.
//
// `skipPrompt` is for CLI callers (`duo session new`) — the agent
// is presumed deliberate, same convention as `duo session open`.
export async function newWorkspaceReset(opts: { skipPrompt?: boolean; windowId?: number } = {}): Promise<{ ok: boolean; error?: string }> {
  // ENH-191 P5a — reset THIS window (app-menu → focused; renderer IPC → sender;
  // CLI → DUO_WINDOW; else primary). win.id threads to the snapshot, prompt,
  // frontmost-terminal lookup, pointer-clear, and applyNewSessionState.
  const win = windowByIdOrPrimary(opts.windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }

  // Snapshot the live renderer state so we can pick the frontmost
  // terminal's CWD and gate the prompt on "is there anything to lose".
  const state = await dispatchSessionSnapshot(win.id)
  if (!state) return { ok: false, error: 'snapshot failed' }

  const anythingOpen = state.terminals.length > 0 || state.fileTabs.length > 0
  if (anythingOpen && !opts.skipPrompt) {
    const proceed = await promptToSaveCurrentWorkspace('new', win.id)
    if (!proceed) return { ok: false, error: 'cancelled' }
  }

  // Pick the frontmost terminal's CWD. Prefer the live CWD via lsof;
  // fall back to the persisted spawn CWD if lsof can't read it (no
  // permission, dead pid). If there were no terminals to begin with,
  // land on $HOME.
  let frontCwd = ''
  const idx = state.activeTerminalIndex
  if (idx >= 0 && idx < state.terminals.length) {
    const spawnCwd = state.terminals[idx].cwd
    // ENH-191 P5a — the reset window's frontmost terminal (getOrDefault never
    // throws), not getDefault(registry) which crashes at N>1.
    const activeId = activeTerminalIdCache.getOrDefault(win.id)
    const pid = activeId ? ptyManager.getPid(activeId) : null
    const liveCwd = pid ? getLiveCwdForPid(pid) : null
    frontCwd = liveCwd ?? spawnCwd
  }
  if (!frontCwd) frontCwd = homedir()

  // Skeleton state — one shell at frontCwd, empty tab arrays. Pinned
  // tabs come back via the boot-time pin-restore paths.
  const title = nodePath.basename(frontCwd) || frontCwd
  const skeleton: import('../shared/types').SessionState = {
    version: 1,
    savedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    terminals: [{ cwd: frontCwd, kind: 'shell', title }],
    activeTerminalIndex: 0,
    browserTabs: [],
    activeBrowserIndex: -1,
    fileTabs: [],
    activeWorking: null,
    navigatorPath: '',
    aux: null
  }
  await activeWorkspaceService.clear()
  // ENH-191 P5a — clear THIS window's pointer (registry.get(win.id), never
  // only()); applyWindowTitle retitles THIS window back to "Duo".
  const clearedCtx = registry.get(win.id)
  if (clearedCtx) clearedCtx.activeWorkspace = null
  applyWindowTitle(clearedCtx)
  void rebuildAppMenu()
  await workspaceHistoryService.flush()
  await applyNewSessionState(skeleton, win.id)
  return { ok: true }
}

// Helpers exposed to SocketServer via `NavBridge` (passed below).

export function getNavState(): NavStateSnapshot {
  return navStateCache.getOrDefault(cliDefaultWindowId())
}

export function sendReveal(path: string): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.NAV_REVEAL, path)
  return { ok: true }
}

/**
 * Stage 21d-i — scan ~/.claude/duo/extra-packs/ on launch and run
 * the install pipeline for each pack. Idempotent + atomic-replace,
 * so repeated launches are a no-op for unchanged packs and a
 * version-aware re-install for updated ones.
 *
 * Errors per-pack are logged but never block the launch path.
 */
async function scanAndInstallDistroPacks(): Promise<void> {
  let packs: string[]
  try {
    packs = await discoverPacks()
  } catch (e) {
    console.warn('[distro-pack] Discovery failed:', (e as Error).message)
    return
  }
  if (packs.length === 0) return
  const duoVersion = app.getVersion()
  for (const packPath of packs) {
    try {
      const outcome = await installPack(packPath, duoVersion)
      if (!outcome.ok) {
        console.warn(`[distro-pack] Skipped ${packPath}: ${outcome.error.reason}`)
        continue
      }
      // Stage 21d-i v1 — CLAUDE.md merge runs as a separate step
      // so the install pipeline stays pure on the filesystem side.
      const merged = await mergeDistroClaudeMd(packPath, outcome.result.name, outcome.result.version)
      // Walk-1 fix (smoke walk v0.6.8 rev2) — round-trip the merge
      // result into the persisted manifest. Pre-fix the manifest's
      // `claudeMdManaged` flag was hardcoded to false in installPack
      // and never updated, so uninstall's CLAUDE.md cleanup was always
      // gated `false` and skipped — leaving orphan distro blocks in
      // the user's CLAUDE.md after `duo pack uninstall`.
      if (merged) {
        await setManifestClaudeMdFlag(packPath, true)
      }
      console.log(
        `[distro-pack] Installed ${outcome.result.name} v${outcome.result.version}: ${outcome.result.filesInstalled} files${merged ? ' + CLAUDE.md merged' : ''}`
      )
    } catch (e) {
      console.warn(`[distro-pack] Install failed for ${packPath}:`, (e as Error).message)
    }
  }
}

export function sendView(path: string, mode?: 'canvas' | 'browser'): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  // ENH-097 — when a mode override is supplied, send a {path, mode}
  // payload; otherwise keep the bare-string payload for backwards
  // compat with existing renderer subscribers (NAV_VIEW / NAV_EDIT
  // both originally took a plain `path: string`).
  win.webContents.send(IPC.NAV_VIEW, mode ? { path, mode } : path)
  return { ok: true }
}

export function sendEdit(path: string, mode?: 'canvas' | 'browser'): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.NAV_EDIT, mode ? { path, mode } : path)
  return { ok: true }
}

export function getEditorSelection(): EditorSelectionSnapshot | null {
  return editorSelectionCache.getOrDefault(cliDefaultWindowId())
}

// Stage 17c — drives `duo selection --pane canvas` and the auto-select
// path's html-canvas branch.
export function getCanvasSelection(): PageSelectionSnapshot | null {
  return canvasSelectionCache.getOrDefault(cliDefaultWindowId())
}

/**
 * Stage 11 \u2014 dispatch a doc-write request to the renderer's active editor
 * and wait for the reply. Times out at 5s to avoid CLI hangs if the
 * renderer is busy.
 */
export function getThemeState(): ThemeStateSnapshot {
  return themeStateCache.getOrDefault(cliDefaultWindowId())
}

export function setThemeMode(mode: ThemeMode): { ok: boolean; error?: string } {
  if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
    return { ok: false, error: `Invalid theme mode: ${mode}. Expected system|light|dark.` }
  }
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.THEME_SET, mode)
  return { ok: true }
}

// Sprint 16 / v0.6.15 — `duo claude-return` / `duo shift-return`
// CLI verb backing. Reads return the cached state; sets push the
// new pref(s) back to the renderer over CLAUDE_KEY_PREFS_SET.
// Renderer hook (useClaudeKeyPrefs) writes to localStorage on
// receive, so the change survives relaunches.
export function getClaudeKeyPrefsState(): import('../shared/types').ClaudeKeyPrefsSnapshot {
  return claudeKeyPrefsStateCache.getOrDefault(cliDefaultWindowId())
}

export function setClaudeReturnMode(mode: import('../shared/types').ClaudeReturnMode, windowId?: number): { ok: boolean; error?: string } {
  if (mode !== 'submit' && mode !== 'newline') {
    return { ok: false, error: `Invalid claude-return mode: ${mode}. Expected submit|newline.` }
  }
  // ENH-191 P5a — windowId targets a specific window (app-menu passes the
  // focused window; CLI passes DUO_WINDOW); omitted → the primary window.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.CLAUDE_KEY_PREFS_SET, { claudeReturn: mode })
  return { ok: true }
}

export function setShiftReturnMode(mode: import('../shared/types').ShiftReturnMode): { ok: boolean; error?: string } {
  if (mode !== 'submit' && mode !== 'newline') {
    return { ok: false, error: `Invalid shift-return mode: ${mode}. Expected submit|newline.` }
  }
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.CLAUDE_KEY_PREFS_SET, { shiftReturn: mode })
  return { ok: true }
}

// ENH-172 (Sprint 20 / v0.7.7) — `duo hidden-files [show|hide|toggle]`
// CLI verb backing AND the View → Show Hidden Files menu click. Pushes
// the new value to the renderer; renderer's useNavigator hook updates
// localStorage + emits a fresh NAV_STATE_PUSH (which our handler uses
// to refresh the menu checkmark).
export function setHiddenFiles(value: boolean | 'toggle', windowId?: number): { ok: boolean; error?: string } {
  if (value !== true && value !== false && value !== 'toggle') {
    return { ok: false, error: `Invalid hidden-files value: ${String(value)}. Expected true|false|'toggle'.` }
  }
  // ENH-191 P5a — windowId targets a specific window (app-menu → focused; CLI →
  // DUO_WINDOW); omitted → the primary window.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.HIDDEN_FILES_SET, { value })
  return { ok: true }
}

// ENH-178 (Sprint 20 / v0.7.7) — broadcast a browser-mode change to
// the renderer. Renderer caches the value in localStorage so it
// survives reloads + is consulted by future address-bar affordances.
export function pushBrowserMode(mode: import('../shared/types').BrowserMode): void {
  // ENH-191 P2 (class-i, fire-and-forget) — safeSend resolves the sole window
  // via the registry + guards destroyed-state; no explicit window check needed.
  safeSend(IPC.BROWSER_MODE_PUSH, { mode })
}

// BUG-138 Phase 2 — `duo author` reads the cached value; writes
// dispatch AUTHOR_SET to the renderer which persists to localStorage
// and pushes a fresh state back over AUTHOR_STATE_PUSH.
export function getAuthorState(): import('../shared/types').AuthorStateSnapshot {
  return authorStateCache.getOrDefault(cliDefaultWindowId())
}

export function setAuthor(author: string): { ok: boolean; error?: string } {
  const trimmed = (author ?? '').trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'author name must be a non-empty string' }
  }
  if (trimmed.length > 64) {
    return { ok: false, error: 'author name must be 64 characters or fewer' }
  }
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  // Update the cache eagerly so `duo author` reads the new value even before the
  // renderer's AUTHOR_STATE_PUSH echo arrives. ENH-191 P5a — key by the ADDRESSED
  // window (win.id, = cliTargetWindowId ?? primary), matching the AUTHOR_SET send
  // + the getOrDefault(cliDefaultWindowId()) read, so `duo --window N author`
  // round-trips through window N's slot (was defaultWindowId = primary only).
  authorStateCache.set(win.id, { author: trimmed })
  win.webContents.send(IPC.AUTHOR_SET, trimmed)
  return { ok: true }
}

// ENH-014 — `duo split <pct>` and View → Pane size menu items both
// land here. Renderer clamps to the divider drag's 20–80 range; the
// validator below mirrors that so an invalid CLI value errors at the
// socket boundary instead of a silent clamp.
export function setSplit(pct: number, windowId?: number): { ok: boolean; pct?: number; error?: string } {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return { ok: false, error: 'split pct must be a finite number' }
  }
  const clamped = Math.min(Math.max(pct, 20), 80)
  // ENH-191 P5a — windowId targets a specific window (app-menu → focused; CLI →
  // DUO_WINDOW); omitted → the primary window.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.SPLIT_SET, clamped)
  return { ok: true, pct: clamped }
}

// ENH-099 — `⌘⌥4` chord, View → Pane size → 3-way even, and `duo split
// 3way` all land here. Tells the renderer to apply the canonical 3-pane
// even layout: outer 33/67 + inner aux 50/50 (when aux is open). Same
// target shape as ENH-126's auto-redistribute, but on-demand.
export function setLayout3wayEven(windowId?: number): { ok: boolean; error?: string } {
  // ENH-191 P5a — windowId targets a specific window (app-menu → focused; CLI →
  // DUO_WINDOW); omitted → the primary window.
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.LAYOUT_3WAY_EVEN)
  return { ok: true }
}

// ENH-122 — `duo dom <selector> [...]` queries the main renderer's DOM.
// Distinct from `duo eval` / the existing bare `duo dom` (both target
// the browser pane via CDP). Built so an agent debugging an editor /
// canvas / image-viewer issue can ask "what's actually rendered?"
// without opening DevTools manually.
//
// Why webContents.executeJavaScript: there's no need for a per-call
// IPC channel — the main renderer is just a regular Electron renderer
// and main has full webContents access. The expression is composed
// here from JSON-stringified args, so user-supplied selectors / attrs
// are safe against injection. `js` mode wraps the user's expression in
// an IIFE so a bare expression resolves naturally; multi-statement
// blobs are responsible for their own `return`.
export async function queryRendererDom(req: {
  selector?: string
  js?: string
  attr?: string
  text?: boolean
  computed?: string[]
  all?: boolean
}): Promise<unknown> {
  // ENH-191 P2 (cardinal rule §2.3) — visibility-cluster reads resolve the
  // sole window by IDENTITY, NEVER focus; a focus-resolved answer would
  // actively mislead an agent debugging blind.
  // Cast to the real BrowserWindow: executeJavaScript isn't on the minimal
  // WindowLike send-interface, but the registry holds the real window.
  const win = windowByIdOrPrimary(undefined) // ENH-191 P5a — addressable (cliTargetWindowId), else primary; identity, never focus
  if (!win || win.isDestroyed()) {
    throw new Error('Duo window not ready')
  }
  const expr = buildRendererQuery(req)
  return await win.webContents.executeJavaScript(expr, true)
}

function buildRendererQuery(req: {
  selector?: string
  js?: string
  attr?: string
  text?: boolean
  computed?: string[]
  all?: boolean
}): string {
  if (req.js !== undefined) {
    // Pass through verbatim. `webContents.executeJavaScript` evaluates
    // the source as a script body and returns the value of the last
    // expression, so a bare expression like `1+1` and a multi-statement
    // blob like `foo(); 3` both work without an IIFE wrapper. The
    // wrapper used to force everything into a single parenthesized
    // expression, which broke any input containing semicolons or
    // statements (e.g. `dispatchEvent(...); "ok"`).
    return req.js
  }
  if (req.selector === undefined) {
    throw new Error('queryRendererDom requires either selector or js')
  }
  const sel = JSON.stringify(req.selector)
  const attrName = req.attr !== undefined ? JSON.stringify(req.attr) : null
  const computedProps = req.computed !== undefined ? JSON.stringify(req.computed) : null
  const projectExpr = (varName: string): string => {
    if (attrName !== null) return `${varName}.getAttribute(${attrName})`
    if (req.text) return `${varName}.textContent`
    if (computedProps !== null) {
      return `(() => { const cs = getComputedStyle(${varName}); const o = {}; for (const p of ${computedProps}) o[p] = cs.getPropertyValue(p); return o; })()`
    }
    return `${varName}.outerHTML`
  }
  if (req.all) {
    return `Array.from(document.querySelectorAll(${sel})).map(el => ${projectExpr('el')})`
  }
  return `(() => { const el = document.querySelector(${sel}); return el ? ${projectExpr('el')} : null; })()`
}

// ENH-123 — `duo devtools [--browser-pane] [--close]`. Main renderer
// opens via mainWindow.webContents; browser pane delegates to
// BrowserManager (which knows the active WCV). Both paths return a
// uniform { ok, target, opened } shape so the CLI can report cleanly.
export function openDevToolsForTarget(opts: {
  target?: 'renderer' | 'browser-pane'
  close?: boolean
}): { ok: boolean; target?: string; opened?: boolean; error?: string } {
  const target = opts.target ?? 'renderer'
  if (target === 'renderer') {
    const win = windowByIdOrPrimary(undefined)
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'Duo window not ready' }
    }
    const wc = win.webContents
    if (opts.close) {
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      return { ok: true, target, opened: false }
    }
    if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'right' })
    return { ok: true, target, opened: true }
  }
  if (target === 'browser-pane') {
    const browserManager = cliBrowserManager() // ENH-191 P5a — addressed window, not primary
    if (!browserManager) return { ok: false, error: 'browser manager not ready' }
    if (opts.close) {
      browserManager.closeDevTools()
      return { ok: true, target, opened: false }
    }
    browserManager.openDevTools({ mode: 'right' })
    return { ok: true, target, opened: true }
  }
  return { ok: false, error: `unknown devtools target: ${target}` }
}

// ENH-124 — `duo layout` returns a JSON snapshot of the WorkingPane /
// terminal / navigator state. App.tsx exposes a renderer-side
// `window.__duoGetLayout()` function that rebuilds the snapshot from
// live React state on every call (no push pipeline, no staleness).
// Schema is defined in renderer/App.tsx near where the function is set.
export async function getLayoutSnapshot(): Promise<unknown> {
  // ENH-191 P2 (cardinal rule §2.3) — visibility-cluster reads resolve the
  // sole window by IDENTITY, NEVER focus; a focus-resolved answer would
  // actively mislead an agent debugging blind.
  // Cast to the real BrowserWindow: executeJavaScript isn't on the minimal
  // WindowLike send-interface, but the registry holds the real window.
  const win = windowByIdOrPrimary(undefined) // ENH-191 P5a — addressable (cliTargetWindowId), else primary; identity, never focus
  if (!win || win.isDestroyed()) {
    throw new Error('Duo window not ready')
  }
  return await win.webContents.executeJavaScript(
    'typeof window.__duoGetLayout === "function" ? window.__duoGetLayout() : { error: "renderer not exposing __duoGetLayout — likely renderer not yet mounted" }',
    true
  )
}

// ENH-195 — `duo status` returns a high-level JSON snapshot of the
// running app (open tabs + dirty/active/pinned, active working tab,
// focused column, theme, terminal count). App.tsx exposes a renderer-
// side `window.__duoGetStatus()` that rebuilds it from live React state
// on every call — same always-fresh, no-cache pattern as
// `getLayoutSnapshot` / `duo layout`. The keystone agent-orientation
// verb (no IPC channel — read directly from the renderer).
export async function getStatusSnapshot(): Promise<unknown> {
  // ENH-191 P2 (cardinal rule §2.3) — visibility-cluster reads resolve the
  // sole window by IDENTITY, NEVER focus; a focus-resolved answer would
  // actively mislead an agent debugging blind.
  // Cast to the real BrowserWindow: executeJavaScript isn't on the minimal
  // WindowLike send-interface, but the registry holds the real window.
  const win = windowByIdOrPrimary(undefined) // ENH-191 P5a — addressable (cliTargetWindowId), else primary; identity, never focus
  if (!win || win.isDestroyed()) {
    throw new Error('Duo window not ready')
  }
  return await win.webContents.executeJavaScript(
    'typeof window.__duoGetStatus === "function" ? window.__duoGetStatus() : { error: "renderer not exposing __duoGetStatus — likely renderer not yet mounted" }',
    true
  )
}

// ── ENH-212 Home — CLI bridge helpers (PRD § 4.5) ───────────────────────────
// `duo home` / `duo home show` / `duo home refresh`. Push HOME_SHOW to the
// addressed window (cliTargetWindowId, else primary — identity, never focus,
// like every other visibility-cluster read). The renderer's App activates
// Home + HomeView refetches off this single push (PRD § 4.4 — the only Home
// main→renderer channel). `refresh` shares it: when Home is already active,
// activation is idempotent and the refetch is exactly the force-refetch.
function showHomeForCli(): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined) // addressable (cliTargetWindowId), else primary
  if (!win || win.isDestroyed()) return { ok: false, error: 'Duo window not ready' }
  // makeSafeSend tolerates a mid-teardown webContents (BUG-190 guard).
  makeSafeSend(() => win)(IPC.HOME_SHOW, undefined)
  return { ok: true }
}

// `duo home state [--json]` — pull the renderer's __duoGetHomeState() (the
// HomeView's last-fetched snapshot, or null). Same always-fresh, no-cache
// pull pattern as getStatusSnapshot / getLayoutSnapshot.
async function getHomeStateForCli(): Promise<unknown> {
  const win = windowByIdOrPrimary(undefined) // identity, never focus
  if (!win || win.isDestroyed()) throw new Error('Duo window not ready')
  return await win.webContents.executeJavaScript(
    'typeof window.__duoGetHomeState === "function" ? window.__duoGetHomeState() : { error: "renderer not exposing __duoGetHomeState — likely renderer not yet mounted" }',
    true
  )
}

// `duo term tabs` — enumerate the addressed window's terminal tabs. Reads the
// renderer's __duoGetLayout().terminal (the existing always-fresh layout pull,
// which already carries the per-tab {id, kind, cwd, title} list + activeTabId)
// and projects it to [{id, kind, cwd, title, active}] so `duo term tab <id>`
// has a stable id space to target (NOT a bare index — `duo tab <n>` owns the
// browser number space).
async function listTerminalTabsForCli(): Promise<unknown> {
  const layout = (await getLayoutSnapshot()) as {
    terminal?: {
      activeTabId?: string | null
      tabs?: Array<{ id: string; kind: string; cwd: string; title: string }>
    }
  }
  const term = layout?.terminal
  const activeTabId = term?.activeTabId ?? null
  const tabs = (term?.tabs ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    cwd: t.cwd,
    title: t.title,
    active: t.id === activeTabId,
  }))
  return { tabs, activeTabId }
}

// `duo term tab <id>` — activate the terminal tab with that id in the addressed
// window by pushing TERMINAL_ACTIVATE_TAB (the same channel the Home focus leg
// uses). The renderer's focusTerminalTab no-ops on an unknown id, so a stale id
// is harmless; main returns ok regardless of the renderer-side match (parity
// with the focus action's re-check posture).
function activateTerminalTabForCli(tabId: string): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined) // identity, never focus
  if (!win || win.isDestroyed()) return { ok: false, error: 'Duo window not ready' }
  makeSafeSend(() => win)(IPC.TERMINAL_ACTIVATE_TAB, { tabId })
  return { ok: true }
}

// `duo term close <id> [--force]` — close a terminal tab by id. Closing kills
// the tab's PTY (BUG-200 data-loss class), so a tab running a live `claude` is
// REFUSED unless --force. The renderer routes the push through its existing
// closeTab path (which enforces the floor-of-1 and the closed-tab ring).
async function closeTerminalTabForCli(tabId: string, force = false): Promise<{ ok: boolean; error?: string }> {
  const win = windowByIdOrPrimary(undefined) // identity, never focus
  if (!win || win.isDestroyed()) return { ok: false, error: 'Duo window not ready' }
  if (!force) {
    const live = ptyManager.listAllLive().find((s) => s.id === tabId)
    if (live?.pid != null) {
      const procs = await mapLiveClaudeOwners([live.pid])
      if (procs.some((c) => c.ownerPtyPid === live.pid)) {
        return { ok: false, error: 'tab is running a live claude session — pass --force to close it anyway' }
      }
    }
  }
  makeSafeSend(() => win)(IPC.TERMINAL_CLOSE_TAB, { tabId })
  return { ok: true }
}

// `duo session open <uuid> [--cwd <path>]` — the full Home click contract,
// main-side (D15). Compute the live open-session join: if a live terminal tab
// already hosts the session, raise its window + activate that tab (never a
// duplicate spawn). Else spawn `claude --resume <uuid>` in a new tab in the
// primary window (no DUO_WINDOW stamp → primary, identity never focus — the
// `duo session open` invocation comes from outside any Duo terminal). The
// focus leg needs no cwd; the resume leg requires one (`--cwd`), matching the
// renderer's HomeView.doResume which always supplies the session cwd.
async function sessionOpenForCli(
  uuid: string,
  cwd?: string,
  force = false
): Promise<{ ok: boolean; action?: 'focus' | 'resume' | 'fork'; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(uuid)) {
    return { ok: false, error: `uuid must be a UUID, got: ${uuid}` }
  }
  const join = await buildHomeOpenJoin()
  const hit = join.openByUuid.get(uuid)
  if (hit?.kind === 'duo') {
    // FOCUS leg — raise the hosting window + activate its terminal tab.
    const ctx = registry.get(hit.windowId)
    const win = ctx?.window as BrowserWindow | undefined
    if (!win || win.isDestroyed()) {
      return { ok: false, error: `window ${hit.windowId} hosting the session is no longer open` }
    }
    win.focus()
    makeSafeSend(() => ctx!.window)(IPC.TERMINAL_ACTIVATE_TAB, { tabId: hit.tabId })
    void revealTerminalIfCollapsed(hit.windowId)
    return { ok: true, action: 'focus' }
  }
  if (hit?.kind === 'external' && !force) {
    // Live outside Duo — Duo can't focus it. Refuse by default so a stray
    // invocation doesn't fork a running session; `--force` overrides (the
    // user's call — parity with the UI's Fork dialog).
    return { ok: false, error: 'session is running outside Duo (another terminal / the desktop app) — pass --force to fork it (a new session branched from this one)' }
  }
  // RESUME leg — needs a cwd. D15 — addressed window (cliTargetWindowId, e.g.
  // `--window 2`), else the primary window when unstamped — same identity
  // resolution as every other verb. dispatchNewTabToWindow(undefined, …)
  // resolves to the primary; pass the addressed id when stamped.
  if (!cwd) {
    return { ok: false, error: 'session is not open; pass --cwd <path> to resume it in a new tab' }
  }
  // Fork vs resume — parity with the HOME_SESSION_ACTION leg: a forced open of
  // a session still live OUTSIDE Duo forks (--fork-session, a new session id);
  // a genuinely-closed session resumes in place.
  const isFork = hit?.kind === 'external' && force
  const targetWindowId = windowByIdOrPrimary(undefined)?.id
  const res = await dispatchNewTabToWindow(targetWindowId, {
    kind: 'shell',
    cwd,
    cmd: buildResumeCommand(uuid, { fork: isFork }),
  })
  if (res.ok) void revealTerminalIfCollapsed(targetWindowId)
  return res.ok ? { ok: true, action: isFork ? 'fork' : 'resume' } : { ok: false, error: res.error }
}

// ENH-130 — `duo edit --reveal` / `duo open --reveal` reveal flow.
// Read layout via the same renderer-side getter ENH-124 uses; if the
// working pane is collapsed (splitPct >= 75 — terminal-dominant), pull
// it back to 50/50 so the artifact the agent just opened is visible.
// Then jump focus to the main pane via the existing PANE_FOCUS_JUMP
// channel. Idempotent: no-op when already visible / focused.
export async function revealMainPaneIfCollapsed(): Promise<void> {
  // ENH-191 P2 (cardinal rule §2.3) — resolve by identity, never focus. Cast
  // to the real BrowserWindow for executeJavaScript (not on WindowLike).
  const win = windowByIdOrPrimary(undefined) // ENH-191 P5a — addressable (cliTargetWindowId), else primary; identity, never focus
  if (!win || win.isDestroyed()) return
  try {
    const layout = (await win.webContents.executeJavaScript(
      'typeof window.__duoGetLayout === "function" ? window.__duoGetLayout() : null',
      true
    )) as { splitPct?: number } | null
    if (layout && typeof layout.splitPct === 'number' && layout.splitPct >= 75) {
      setSplit(50)
    }
    win.webContents.send(IPC.PANE_FOCUS_JUMP, 'main')
  } catch (err) {
    console.warn('[main] revealMainPaneIfCollapsed failed:', (err as Error)?.message ?? err)
  }
}

// ENH-212 — the terminal analog of revealMainPaneIfCollapsed. When a Home
// session action opens/resumes/forks/focuses a session whose terminal lives in
// a fully-collapsed terminal pane (splitPct === 0), the spawned/focused
// terminal would be invisible. Expand the pane to a comfortable 50/50 so the
// session is actually on screen. Idempotent: no-op unless the pane is fully
// collapsed. Fire-and-forget at the call sites — a cosmetic reveal must never
// fail or delay the focus/resume result.
export async function revealTerminalIfCollapsed(windowId?: number): Promise<void> {
  const win = windowByIdOrPrimary(windowId) // identity, never focus
  if (!win || win.isDestroyed()) return
  try {
    const layout = (await win.webContents.executeJavaScript(
      'typeof window.__duoGetLayout === "function" ? window.__duoGetLayout() : null',
      true
    )) as { splitPct?: number } | null
    if (layout && layout.splitPct === 0) {
      setSplit(50, win.id)
    }
  } catch (err) {
    console.warn('[main] revealTerminalIfCollapsed failed:', (err as Error)?.message ?? err)
  }
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
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
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
  win.webContents.send(IPC.WORKING_AUX_OPEN, expanded)
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
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  const browserManager = cliBrowserManager() // ENH-191 P5a — addressed window, not primary
  if (!browserManager) {
    return { ok: false, error: 'BrowserManager not initialized' }
  }
  // Validate the tab exists before round-tripping — a fast CLI error
  // is friendlier than a silent renderer-side no-op.
  const tabs = browserManager.getTabs()
  if (!tabs.some(t => t.id === browserTabId)) {
    return { ok: false, error: `No browser tab with id ${browserTabId}` }
  }
  win.webContents.send(IPC.WORKING_AUX_OPEN_BROWSER, browserTabId)
  return { ok: true }
}

export function splitViewClose(): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.WORKING_AUX_CLOSE, null)
  return { ok: true }
}

// FOLLOWUP-020 — close the focused working-pane tab (CLI parity for ⌘W
// on the working strip). The renderer applies the pinned-tab gate +
// the actual tab-removal logic; this just pushes the trigger.
export function closeActiveWorkingTab(): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.NAV_CLOSE_ACTIVE_WORKING_TAB, null)
  return { ok: true }
}

// FOLLOWUP-020 — close a terminal tab. `n` omitted → focused tab; `n`
// supplied (1-indexed) → that specific terminal tab. Renderer owns
// tab identity, so the index resolution happens there.
export function closeTerminalTab(n?: number): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.NAV_CLOSE_TERMINAL_TAB, typeof n === 'number' ? { n } : null)
  return { ok: true }
}

// FOLLOWUP-025 — open the renderer's File → Clone… modal. Triggered
// by the native File menu entry + future `duo clone --modal` parity.
// v2: optional `path` arg pre-populates the modal's parent-directory
// input. Used by the Navigator right-click → "Clone GitHub repo
// here…" path (owner Q1: right-click context wins over Navigator cwd).
export function openCloneModal(opts?: { path?: string; windowId?: number }): { ok: boolean; error?: string } {
  // ENH-191 P5a — windowId targets a specific window (File menu / ⌘⇧K →
  // focused; CLI → DUO_WINDOW); omitted → the primary window.
  const win = windowByIdOrPrimary(opts?.windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  const payload = opts?.path ? { path: opts.path } : null
  win.webContents.send(IPC.NAV_OPEN_CLONE_MODAL, payload)
  return { ok: true }
}

// ENH-216 (VAULT MODE) — twin of openCloneModal for the File → New Vault…
// menu item. Tells the renderer (Stage 4) to open the New Vault dialog, which
// then collects { folder, format, name? } and round-trips through VAULT_CREATE.
// windowId targets a specific window (File menu → focused); omitted → primary.
export function openNewVaultModal({ windowId }: { windowId?: number } = {}): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(windowId)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.NAV_OPEN_NEW_VAULT_MODAL, null)
  return { ok: true }
}

export function splitViewPromote(): { ok: boolean; error?: string } {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.WORKING_AUX_PROMOTE, null)
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
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.WORKING_AUX_RESIZE, clamped)
  return { ok: true, pct: clamped }
}

export function getSplitViewState(): WorkingAuxSnapshot {
  return workingAuxSnapshotCache.getOrDefault(cliDefaultWindowId())
}

// Stage 15 G19 — `duo selection-format` reads the cache; `duo
// selection-format <a|b|c>` dispatches a SET to the renderer, which
// persists to localStorage and pushes the new state back.
export function getSelectionFormatState(): SelectionFormatStateSnapshot {
  return selectionFormatStateCache.getOrDefault(cliDefaultWindowId())
}

export function setSelectionFormat(format: SelectionFormat): { ok: boolean; error?: string } {
  if (format !== 'a' && format !== 'b' && format !== 'c') {
    return { ok: false, error: `Invalid selection-format: ${format}. Expected a|b|c.` }
  }
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  win.webContents.send(IPC.SELECTION_FORMAT_SET, format)
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
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocWriteResult>((resolve) => {
    const timer = setTimeout(() => {
      docWritePending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${DOC_WRITE_TIMEOUT_MS / 1000}s` })
    }, DOC_WRITE_TIMEOUT_MS)
    docWritePending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_DOC_WRITE, { ...req, reqId })
  })
}

export function dispatchImageInsert(req: { bytes: Uint8Array; ext: string; alt?: string }): Promise<import('../shared/types').ImageInsertResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `ii_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      imageInsertPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 10s — likely no markdown editor active' })
    }, 10000)
    imageInsertPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_IMAGE_INSERT, { ...req, reqId })
  })
}

export function dispatchDocRead(req: Omit<DocReadRequest, 'reqId'>): Promise<DocReadResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocReadResult>((resolve) => {
    const timer = setTimeout(() => {
      docReadPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docReadPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_DOC_READ, { ...req, reqId })
  })
}

// ENH-022 (v0.5.4) — `duo doc goto`. Same shape as dispatchDocWrite,
// short timeout (no human gate; the renderer just resolves a target
// + scrolls into view, bounded by frame budget).
export function dispatchDocGoto(req: Omit<DocGotoRequest, 'reqId'>): Promise<DocGotoResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `dg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocGotoResult>((resolve) => {
    const timer = setTimeout(() => {
      docGotoPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docGotoPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_DOC_GOTO, { ...req, reqId })
  })
}

// ENH-023 (v0.5.4) — `duo doc find`. Read-only, fast — same 5s budget.
export function dispatchDocFind(req: Omit<DocFindRequest, 'reqId'>): Promise<DocFindResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocFindResult>((resolve) => {
    const timer = setTimeout(() => {
      docFindPending.delete(reqId)
      resolve({ reqId, ok: false, error: 'Renderer did not reply within 5s' })
    }, 5000)
    docFindPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_DOC_FIND, { ...req, reqId })
  })
}

// ENH-195 — dispatch a `duo doc edit` (PLAIN replace) to the active
// markdown editor and await its reply. Used only on the OPEN-file path
// (socket-server decides open-vs-closed and routes the disk case
// through plainEdit.ts itself). The renderer applies the replace, kicks
// an echo-safe save, and replies. 10s timeout mirrors dispatchDocRead
// (no human gate — this is an accepted edit, not a banner-able write).
export function dispatchDocEditPlain(req: Omit<DocEditPlainRequest, 'reqId'>): Promise<DocEditPlainResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, changed: false, replacements: 0, reason: '', error: 'Duo window not ready' })
  }
  const reqId = `dep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<DocEditPlainResult>((resolve) => {
    const timer = setTimeout(() => {
      docEditPlainPending.delete(reqId)
      resolve({ reqId, ok: false, changed: false, replacements: 0, reason: '', error: 'Renderer did not reply within 10s — likely no markdown editor active' })
    }, 10000)
    docEditPlainPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.EDITOR_DOC_EDIT_PLAIN, { ...req, reqId })
  })
}

// ENH-195 — dispatch a `duo json set|merge` op to the active JSON / YAML
// viewer and await its reply. OPEN-file path only (socket-server routes
// the closed case disk-direct). 10s timeout, same rationale as
// dispatchDocEditPlain.
export function dispatchJsonOp(req: Omit<JsonOpRequest, 'reqId'>): Promise<JsonOpResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, changed: false, reason: '', error: 'Duo window not ready' })
  }
  const reqId = `jo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<JsonOpResult>((resolve) => {
    const timer = setTimeout(() => {
      jsonOpPending.delete(reqId)
      resolve({ reqId, ok: false, changed: false, reason: '', error: 'Renderer did not reply within 10s — likely no JSON viewer active' })
    }, 10000)
    jsonOpPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.JSON_OP, { ...req, reqId })
  })
}

// Stage 17b Phase C — dispatch a `duo html *` op to the active canvas
// tab and await its reply. 30s timeout: ample for any single DOM op
// (queries are sub-ms; writes are milliseconds at worst). If no canvas
// is active, the renderer's PageTab subscription doesn't fire and
// the timeout returns the error.
const HTML_OP_TIMEOUT_MS = 30_000

export function dispatchHtmlOp(req: Omit<HtmlOpRequest, 'reqId'>): Promise<HtmlOpResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `ho_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlOpResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlOpPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlOpPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.PAGE_HTML_OP, { ...req, reqId })
  })
}

// Stage 17d — `duo html comment` / `duo html comments`. Same 30s timeout
// as html-op (DOM ops are fast; the timeout window only matters when no
// canvas is active to subscribe).
export function dispatchHtmlComment(req: Omit<HtmlCommentRequest, 'reqId'>): Promise<HtmlCommentResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.PAGE_HTML_COMMENT, { ...req, reqId })
  })
}

export function dispatchHtmlCommentsList(req: Omit<HtmlCommentsListRequest, 'reqId'>): Promise<HtmlCommentsListResult> {
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `hcl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<HtmlCommentsListResult>((resolve) => {
    const timer = setTimeout(() => {
      htmlCommentsListPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${HTML_OP_TIMEOUT_MS / 1000}s (no active canvas?)` })
    }, HTML_OP_TIMEOUT_MS)
    htmlCommentsListPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.PAGE_HTML_COMMENTS_LIST, { ...req, reqId })
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
  const activeId = activeTerminalIdCache.getOrDefault(cliDefaultWindowId())
  if (activeId === null) {
    return { ok: false, error: 'No active terminal — open one and try again' }
  }
  try {
    ptyManager.write(activeId, text)
    return { ok: true, written: text.length, terminalId: activeId }
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
  const win = windowByIdOrPrimary(undefined)
  if (!win || win.isDestroyed()) {
    return { ok: false, error: 'Duo window not ready' }
  }
  try {
    const base = absPath.slice(absPath.lastIndexOf('/') + 1).replace(/\.html?$/i, '')
    const docTitle = title ?? base ?? 'Untitled'
    const html = htmlBoilerplate(docTitle)
    const bytes = new TextEncoder().encode(html)
    await filesService.write(absPath, bytes)
    win.webContents.send(IPC.NAV_EDIT, absPath)
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
  return dispatchNewTabToWindow(windowByIdOrPrimary(undefined)?.id, req)
}

// ENH-212 — window-targeted variant of dispatchNewTab. The Home resume action
// (§ 4.3) spawns into the SENDER's window (resolveBySender — identity, never
// focus), not always the primary. `windowId` undefined falls back to the
// primary window (matches dispatchNewTab's resolution).
export function dispatchNewTabToWindow(
  windowId: number | undefined,
  req: Omit<NewTabRequest, 'reqId'>
): Promise<NewTabResult> {
  const win = windowId != null
    ? ((registry.get(windowId)?.window as BrowserWindow | undefined) ?? null)
    : liveMainWindow()
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ reqId: '', ok: false, error: 'Duo window not ready' })
  }
  const reqId = `nt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return new Promise<NewTabResult>((resolve) => {
    const timer = setTimeout(() => {
      newTabPending.delete(reqId)
      resolve({ reqId, ok: false, error: `Renderer did not reply within ${NEW_TAB_TIMEOUT_MS / 1000}s` })
    }, NEW_TAB_TIMEOUT_MS)
    newTabPending.set(reqId, win.id, (res) => {
      clearTimeout(timer)
      resolve(res)
    })
    win.webContents.send(IPC.NEW_TAB_REQUEST, { ...req, reqId })
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
    if (scheme === 'http:' || scheme === 'https:') {
      const host = parsed.hostname
      const match = externalDomainsService?.match(host)
      const push: ExternalRedirectedPush = { host, reason: match?.reason || undefined }
      // ENH-191 P2 (class-ii, PRD-locked) — broadcast the redirect receipt;
      // broadcastAll no-ops on an empty registry, folding in the old mainWindow
      // guard. (P5a: revisit whether the receipt should address only the firing
      // window instead of all — see PRD deferred follow-ups.)
      broadcastAll(registry, IPC.EXTERNAL_REDIRECTED, push)
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
