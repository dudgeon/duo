// Stage 2: WebContentsView lifecycle, tab management, SSO session persistence.
//
// One WebContentsView per logical browser tab. All views are added to
// window.contentView; only the active view has real bounds. Inactive views are
// shrunk to 1×1 so they don't intercept events or render visibly.
//
// SSO persistence: every view uses the BROWSER_SESSION_PARTITION ('persist:duo-browser'),
// so cookies / localStorage survive app restarts.

import { WebContentsView, session, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import * as chokidar from 'chokidar'
import type { BrowserTab, BrowserState, BrowserBounds } from '../shared/types'
import type { ExternalRedirectedPush, PlaygroundAction } from '../shared/host-api'
import { IPC } from '../shared/types'
import { BROWSER_SESSION_PARTITION } from '../core/constants'
import { parseActionFromAttrs } from '../shared/playground-actions'
import type { CdpBridge } from './cdp-bridge'
import type { BrowserHistoryService } from '../core/browser-history-service'
import type { ExternalDomainsService } from '../core/external-domains-service'

// `about:blank` is the simplest "new tab" page: the address bar
// reflects no URL, the user types where they want to go. Pairs
// with the renderer-side address-bar auto-focus on new-tab open
// (see App.tsx § newBrowserTab).
//
// ENH-135 (Sprint 15) — the previous `defaultLandingUrl()` returned
// `helpUrl('faq.html')`, used as both the boot-default tab and the
// `addTab()` default fallback. With FAQ retired and the boot-default
// tab logic removed, all "fresh tab" call sites converge on
// about:blank. The `helpUrl()` helper went with them — its only
// caller was `defaultLandingUrl()`, and the WDD pin (still default-
// pinned) resolves its URL via the install-service's pin-seed at
// install time, not via this module.
function newTabUrl(): string {
  return 'about:blank'
}

/**
 * ENH-175 — normalize URLs for tab-match comparison in `navigateOrFocus`.
 *
 * Conservative: strip trailing slash + strip hash fragment. Keep query
 * string intact (`?id=1` vs `?id=2` are different pages). Returns `null`
 * for falsy / unparseable inputs (so the matcher skips empty-string
 * about:blank tabs, etc.).
 */
/**
 * ENH-178 — return true when `url` references a local target that
 * `local-only` browser mode allows in the embedded view. Owner-locked
 * 2026-05-23 spec: `file://`, `localhost`, `127.0.0.1`, `[::1]` (ports
 * allowed). Everything else returns false → local-only mode pops it
 * to the system browser.
 *
 * Conservative parse: URL constructor handles port/userinfo/path
 * normalization for us; malformed URLs return false (safer to bounce
 * unparseable URLs externally than render them in the embedded view).
 */
export function isLocalUrlForBrowserMode(url: string | undefined | null): boolean {
  if (!url) return false
  const trimmed = url.trim()
  if (!trimmed) return false
  // about:blank and devtools:// are local-context schemes that should
  // always work in the embedded view regardless of mode (devtools is
  // how the user inspects Duo itself).
  if (trimmed.startsWith('about:') || trimmed.startsWith('devtools://')) return true
  if (trimmed.startsWith('file://')) return true
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

export function normalizeForTabMatch(url: string | undefined | null): string | null {
  if (!url) return null
  let u = url.trim()
  if (!u || u === 'about:blank') return null
  const hashIdx = u.indexOf('#')
  if (hashIdx >= 0) u = u.slice(0, hashIdx)
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1)
  return u
}

type StateCallback = (state: BrowserState) => void
type TabsCallback = (tabs: BrowserTab[]) => void

interface TabEntry {
  view: WebContentsView
  id: number          // stable 1-based ID shown to CLI/user
}

// BUG-027 — captured on every closeTab, popped by reopenLastClosed.
interface ClosedTabEntry {
  url: string
  title: string
  closedAt: number
}

const CLOSED_TAB_CAP = 10

export class BrowserManager {
  private window: BrowserWindow
  private cdp: CdpBridge
  private onStateChange: StateCallback
  private onTabsChange: TabsCallback
  private tabs: TabEntry[] = []
  private activeIndex = 0
  private nextId = 1
  private currentBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  // Sprint 7 Phase 3c — aux-slot tab tracking. When `auxTabId` is non-
  // null, that tab is pinned to the Split View aux slot: it's removed
  // from the main strip's rotation (switchTab skips it; getTabs marks
  // it `inAux: true` so the renderer's main strip filters it out) and
  // its bounds come from `auxBounds` instead of `currentBounds`. The
  // aux slot holds at most one tab in v1 (matches the file-side
  // single-slot constraint).
  private auxTabId: number | null = null
  private auxBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }
  // BUG-027 — most-recently-closed stack. Used by reopenLastClosed().
  private closedTabs: ClosedTabEntry[] = []
  // Issue #27 — history service for URL-bar autocomplete. Injected by
  // main; populated on did-navigate.
  private history: BrowserHistoryService | null = null
  // BUG-040 — off-host routing. When non-null, will-navigate +
  // setWindowOpenHandler consult the service and route matching URLs
  // through shell.openExternal instead of the embedded browser.
  private externalDomains: ExternalDomainsService | null = null
  // ENH-178 — three-mode URL filter. Default 'local-only' for new
  // installs; the renderer pushes the actual user value (or 'filtered'
  // for upgrade-path users who already had an external-domains.json)
  // shortly after boot via setBrowserMode.
  private browserMode: import('../shared/types').BrowserMode = 'local-only'
  // BUG-130 — per-tab file:// watcher. Browser-pane tabs showing
  // local file:// URLs auto-reload when the underlying file is
  // mutated (canvas-mode has the equivalent via PageTab's external-
  // write reconciliation; this closes the parity gap for browser
  // mode). Keyed by tab id. Value carries the watched path + a
  // close handle so we can detach on nav-away / close. 250ms debounce
  // matches the existing files-service watchers.
  private fileWatchers: Map<number, { path: string; close: () => Promise<void>; timer: NodeJS.Timeout | null }> = new Map()

  constructor(
    window: BrowserWindow,
    cdp: CdpBridge,
    onStateChange: StateCallback,
    onTabsChange: TabsCallback,
    history?: BrowserHistoryService,
    externalDomains?: ExternalDomainsService
  ) {
    this.window = window
    this.cdp = cdp
    this.onStateChange = onStateChange
    this.onTabsChange = onTabsChange
    this.history = history ?? null
    this.externalDomains = externalDomains ?? null

    // Stage 15.2 — forward live browser-selection pushes from the
    // page-side observer to the renderer over IPC. Subscribed once at
    // construction; CDP reattach (on tab switch) reuses the same
    // listener via the bridge's internal cache reset.
    this.cdp.onBrowserSelection((push) => {
      if (this.window.isDestroyed()) return
      this.window.webContents.send(IPC.BROWSER_SELECTION, push)
    })
    // BUG-006 — forward in-page Send → Duo pill clicks to the renderer.
    // The page-injected pill captures the selection snapshot synchronously
    // at mousedown time and passes it through the binding payload (BUG-006
    // v2 — the previous round-trip-then-read-cache flow raced with the
    // selection observer's null-push on collapse).
    this.cdp.onBrowserSendToDuoClick((snapshot) => {
      if (this.window.isDestroyed()) return
      this.window.webContents.send(IPC.BROWSER_SEND_TO_DUO_CLICK, snapshot)
    })

    // ENH-159b — element-inspect-mode wiring. Two pushes back to the
    // renderer:
    //   - BROWSER_INSPECT_CLICK: the snapshot of the clicked element
    //     (or null = ESC exit). Renderer formats it via
    //     formatBrowserInspectPayload and routes to the active
    //     terminal — same egress as the Send → Duo pill.
    //   - BROWSER_INSPECT_MODE: the canonical on/off state. Pushed
    //     whenever the bridge flips state itself (ESC exit) OR when
    //     renderer/CLI calls setInspectMode through this manager.
    //     Subscribers (the toolbar toggle button when it lands)
    //     read this to reflect the truth.
    this.cdp.onBrowserInspectClick((snapshot) => {
      if (this.window.isDestroyed()) return
      // Re-add the `kind: 'inspect'` discriminator. Page-side IIFE
      // emits the body fields only — the renderer-facing contract
      // (host-api.ts § BrowserAPI.onInspectClick) carries a typed
      // discriminated snapshot.
      const tagged = snapshot === null ? null : { kind: 'inspect' as const, ...snapshot }
      this.window.webContents.send(IPC.BROWSER_INSPECT_CLICK, tagged)
    })
    this.cdp.onInspectModeChange((active) => {
      if (this.window.isDestroyed()) return
      this.window.webContents.send(IPC.BROWSER_INSPECT_MODE, active)
    })

    // ENH-094 (Sprint 5) — playground action click in browser pane.
    // Parse the attribute bundle into a typed PlaygroundAction (using
    // the shared parser the canvas-side runtime also uses), then
    // forward to the renderer over IPC.BROWSER_PLAYGROUND_ACTION.
    // Renderer App.tsx subscribes and dispatches via the existing
    // handlePlaygroundAction handler — one handler serves both panes.
    //
    // Trust posture: same as the existing path-link forwarder.
    // PLAYGROUND_RUNTIME_IIFE in cdp-bridge.ts already gates on
    // `location.protocol === 'file:'` — http(s) pages don't get the
    // listener installed, so they can't invoke the binding. We do NOT
    // additionally check path-under-~/.claude/duo here. Reasoning: the
    // canvas-side gate (`isPagePathTrusted`) was a Stage-23-era
    // paranoia for canvas-iframe content; for browser-pane pages a
    // user/agent intentionally opens, the file:// gate is sufficient
    // (consistent with how the path-link forwarder treats clicks).
    // This makes worksheets at /tmp/duo-walks/ work end-to-end without
    // relocating their output directory.
    //
    // What we still log: every dispatched action goes through
    // console.debug for audit-style observability. Owner can grep
    // logs if surprising behavior surfaces.
    this.cdp.onBrowserPlaygroundAction((bundle) => {
      if (this.window.isDestroyed()) return
      const parsed = parseActionFromAttrs((name) => bundle.attrs[name] ?? null)
      if ('error' in parsed) {
        console.warn('[BrowserManager] playground action parse error:', parsed.error)
        return
      }
      let action = parsed.action
      // Mirror the canvas-side data-payload-from stitching: when the
      // verb is duo:event AND the IIFE captured a value, fold it into
      // payload.value. Static `data-payload` keys win on collision.
      if (action.kind === 'duo:event' && bundle.payloadFromValue !== undefined) {
        const staticPayload = action.payload ?? {}
        action = {
          ...action,
          payload: 'value' in staticPayload
            ? staticPayload
            : { ...staticPayload, value: bundle.payloadFromValue }
        }
      }
      const payload: PlaygroundAction = action
      console.debug('[BrowserManager] playground action dispatched:', action.kind, action)
      this.window.webContents.send(IPC.BROWSER_PLAYGROUND_ACTION, payload)
    })

    // ENH-135 (Sprint 15) — no boot-default tab. The previous
    // BUG-078 mechanism gated `addTab()` on `!hasPersistedSession`
    // to avoid resurrecting the FAQ after the user closed it.
    // With FAQ retired (ENH-135) and the boot-default-tab semantics
    // collapsed into pin-restore (BUG-057's first-launch loop in
    // main.ts auto-opens the WDD pin from pins.json), the
    // constructor's auto-open is no longer needed. New behavior:
    // cold start with no persisted session → empty browser pane;
    // BUG-057 pin-restore opens the WDD pin pinned. With a
    // persisted session → restoreFromSession populates from saved
    // state.
  }

  // ── Tab management ─────────────────────────────────────────────────────────

  /** Stage 21c — restore browser tabs from a persisted session.
   *  Adds one tab per saved entry. ENH-135 (Sprint 15): the
   *  constructor no longer auto-opens a boot tab, so `this.tabs`
   *  is always empty when this method is called. Each `addTab()`
   *  routes through `routeOffHostIfMatched` internally, which
   *  bounces matched hosts (capitalone.com, etc.) to the system
   *  browser instead of resurrecting an SSO-broken embedded
   *  session on relaunch. Idempotent at the signature level —
   *  calling with an empty array is a no-op. */
  async restoreFromSession(savedTabs: { url: string; title: string }[], activeIndex: number): Promise<void> {
    if (savedTabs.length === 0) return

    for (let i = 0; i < savedTabs.length; i++) {
      this.addTab(savedTabs[i].url)
    }

    // Switch to the active tab if the index is valid
    if (activeIndex >= 0 && activeIndex < this.tabs.length) {
      const target = this.tabs[activeIndex]
      if (target) {
        try { await this.switchTab(target.id) } catch { /* ignore */ }
      }
    }

    this.emitTabs()
  }

  addTab(url = newTabUrl()): TabEntry {
    const ses = session.fromPartition(BROWSER_SESSION_PARTITION)
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // Redirect popup windows back into the same view, EXCEPT off-host
    // hosts on the user's external-domains list — those go to the
    // system default browser. Mirrors the will-navigate routing below.
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      if (this.routeOffHostIfMatched(popupUrl)) {
        return { action: 'deny' }
      }
      view.webContents.loadURL(popupUrl).catch(() => null)
      return { action: 'deny' }
    })

    const entry: TabEntry = { view, id: this.nextId++ }
    this.tabs.push(entry)
    this.window.contentView.addChildView(view)

    // Park off-screen until activated
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    // BUG-121 — auto-activate when filling the empty state. Pre-fix,
    // tabs.length was always ≥ 1 (the BUG-020 + BUG-096 guards refused
    // to drop below 1 tab), so `addTab` didn't need to touch
    // activeIndex — the user's path was always "tab exists" → switch
    // among existing tabs. Post-fix, activeIndex can be -1 (closed the
    // last main tab; only aux remains or no tabs at all). Calls into
    // addTab that don't follow up with switchTab — notably the
    // renderer's `+` button via useBrowserState.addTab — would
    // otherwise leave the user with a tab they can't see. Activating
    // here mirrors switchTab's bounds + state-emit path; downstream
    // callers (openTab, restoreFromSession) that want a specific tab
    // active still drive it via switchTab after one or more addTab
    // calls.
    if (this.activeIndex === -1) {
      this.activeIndex = this.tabs.length - 1
      view.setBounds(this.currentBounds)
      this.emitState()
    }

    this.wireEvents(view)
    this.wireKeyForwarding(view)

    // BUG-134 — attach CDP to every new browser tab so its
    // page-side selection observer + Send→agent pill binding is
    // registered immediately, not deferred until the user activates
    // it via switchTab. Previously, aux-pinned tabs (which can be
    // created without ever going through switchTab) had no CDP attach,
    // so their pill click handlers fired into a missing binding.
    // Best-effort: failures are non-fatal (CDP is a UX layer).
    this.cdp.attach(view.webContents).catch((err) => {
      console.warn('[BrowserManager] CDP attach failed on addTab:', err)
    })

    // BUG-040 — if the initial URL is off-host, route it externally
    // and leave the tab on about:blank. Avoids a brief load-then-bounce
    // in the embedded view (which would steal focus + flicker).
    if (this.routeOffHostIfMatched(url)) {
      view.webContents.loadURL('about:blank').catch(() => null)
    } else {
      // Always load a URL — even about:blank. Without it, the WebContents stays
      // in an uninitialized state where getURL() returns '' and CDP attach fails,
      // which would swallow switchTab's state emits.
      view.webContents.loadURL(url).catch(() => null)
    }

    this.emitTabs()
    return entry
  }

  async openTab(url = newTabUrl()): Promise<{ ok: true; id: number; url: string; title: string } | { ok: true; url: string; routedTo: 'system-browser' }> {
    // BUG-059 (carryover from walk-1) — `duo open` goes through this
    // method, NOT through the renderer's openFileSmart. The renderer-
    // side dedup (App.tsx) catches user-initiated opens (clicking a
    // file in the navigator), but it never sees CLI calls. Dedup here
    // for file:// URLs so repeated `duo open <path>` calls switch to
    // the existing tab instead of stacking duplicates. http(s)://
    // URLs stay duplicate-allowed (multiple tabs for the same site is
    // a legitimate browser pattern; only file:// represents a single
    // canonical local file). The walk-1 owner observation was two
    // smoke-walk pages and two FAQ tabs after repeated `duo open`s
    // across Duo restarts — every restart's session-restore brought
    // back the prior tab, then the next `duo open` added another.
    if (url.startsWith('file://')) {
      const existing = this.tabs.find(t => t.view.webContents.getURL() === url)
      if (existing) {
        await this.switchTab(existing.id)
        existing.view.webContents.focus()
        return {
          ok: true,
          id: existing.id,
          url: existing.view.webContents.getURL() || url,
          title: existing.view.webContents.getTitle() || ''
        }
      }
    }
    // FOLLOWUP-027 — short-circuit BEFORE creating a tab when the URL
    // would be filtered (e.g. local-only mode + remote URL). Without
    // this, addTab creates a WebContentsView whose URL gets stripped to
    // about:blank by addTab's own routeOffHostIfMatched check at line
    // ~356 — the system browser pops correctly but Duo's tab strip
    // accumulates a blank ghost-tab. routeOffHostIfMatched has the
    // side effects we want (shell.openExternal + EXTERNAL_REDIRECTED
    // banner), so we just suppress the tab creation. Safe re entrancy:
    // when this returns false (URL passes the filter), the duplicate
    // check inside addTab also returns false on the same input, no
    // double-fire.
    if (this.routeOffHostIfMatched(url)) {
      return { ok: true, url, routedTo: 'system-browser' }
    }
    const entry = this.addTab(url)
    await this.switchTab(entry.id)
    // BUG-048 — pull OS-level keyboard focus to the new tab so the
    // user's perceived "the page just opened, I'm in the browser"
    // state matches the renderer's tracking. Without this, OS focus
    // stays in whatever pane the user was in (typically the xterm
    // they ran `duo open` from), so `focusedColumn` stays 'terminal'
    // and the next ⌘` toggles terminal→browser instead of the
    // user's expected browser→terminal. The .focus() call fires
    // view.webContents.on('focus') (wired in addTab → wireEvents)
    // which forwards BROWSER_FOCUS_GAINED → renderer flips
    // focusedColumn = 'working'. Mirrors the BUG-042 fix's intent.
    entry.view.webContents.focus()
    // Wait briefly for the loaded page to settle so we can return its real
    // URL and title (the initial render may not yet have emitted
    // did-navigate). Best-effort — cap at ~2s.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if (!entry.view.webContents.isLoading()) break
      await new Promise(r => setTimeout(r, 100))
    }
    return {
      ok: true,
      id: entry.id,
      url: entry.view.webContents.getURL() || url,
      title: entry.view.webContents.getTitle() || ''
    }
  }

  async switchTab(n: number): Promise<{ ok: boolean; error?: string }> {
    const t0 = Date.now()
    console.log('[BUG-079]', t0, 'switchTab entry', { n, currentActive: this.activeIndex, tabsLen: this.tabs.length })
    const idx = this.tabs.findIndex(t => t.id === n)
    if (idx === -1) return { ok: false, error: `No tab with id ${n}` }
    // Phase 3c — refuse to switch the main strip's active tab to a tab
    // that's pinned in aux. The renderer's main strip already filters
    // those out, but a stray CLI `duo tab <n>` against an aux tab id
    // would otherwise pull it back into the main slot and silently
    // corrupt aux state. The right action for the user is to release
    // the aux pin first (`duo split-view promote` or close), or to
    // address the aux tab via `duo split-view` flows directly.
    if (n === this.auxTabId) {
      return { ok: false, error: `Tab ${n} is pinned in Split View aux. Use \`duo split-view promote\` to return it to main first.` }
    }
    if (idx === this.activeIndex) {
      console.log('[BUG-079]', Date.now(), 'switchTab no-op (idx === activeIndex)', { idx })
      return { ok: true }
    }

    // Shrink current active view. BUG-121 — guard against the empty
    // state (activeIndex === -1 between closeTab and the next addTab/
    // switchTab self-heal).
    if (this.activeIndex >= 0 && this.activeIndex < this.tabs.length) {
      this.tabs[this.activeIndex].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    }

    this.activeIndex = idx
    this.tabs[idx].view.setBounds(this.currentBounds)
    console.log('[BUG-079]', Date.now(), 'after setBounds', { dt: Date.now() - t0 })

    // BUG-076 (v0.6.5) — focus the new active view's webContents.
    // Without this, OS focus stays on the previous (now-shrunk-to-1×1)
    // view, which silently routes subsequent keystrokes (notably the
    // ⌃Tab cycle continuation) to a hidden web contents. The cycle
    // appeared to "stop responding" once it landed on a tab opened by
    // `duo open` because every callee of switchTab EXCEPT this bare API
    // path used to call view.webContents.focus() manually after — the
    // cycle path didn't, so focus drift accumulated. Centralizing the
    // focus call here means every switchTab caller (renderer cycle,
    // CLI tab verb, click-to-switch) gets the correct OS-focus
    // transfer for free. Earlier inline focus() calls at addTab /
    // openExisting sites are now redundant but harmless.
    this.tabs[idx].view.webContents.focus()
    console.log('[BUG-079]', Date.now(), 'after wc.focus()', { dt: Date.now() - t0 })

    // Emit UI updates first — CDP attach is best-effort and must not block
    // the state/tab-strip updates the renderer needs.
    this.emitState()
    this.emitTabs()
    console.log('[BUG-079]', Date.now(), 'after emits', { dt: Date.now() - t0 })

    try {
      await this.cdp.attach(this.tabs[idx].view.webContents)
    } catch (err) {
      console.warn('[BrowserManager] CDP attach failed on switchTab:', err)
    }
    console.log('[BUG-079]', Date.now(), 'switchTab return', { dt: Date.now() - t0 })
    return { ok: true }
  }

  async closeTab(n: number): Promise<{ ok: boolean; error?: string }> {
    const idx = this.tabs.findIndex(t => t.id === n)
    if (idx === -1) return { ok: false, error: `No tab with id ${n}` }

    // Phase 3c — if the tab being closed is currently in aux, clear
    // the aux pin first so downstream emits / state reflect the
    // released slot. The renderer's auxState observer (state-push
    // round trip) will then drop the corresponding browser slot from
    // its `slots` array. Skipped main-strip activation logic below
    // already handles re-picking an active main tab if needed.
    if (n === this.auxTabId) {
      this.auxTabId = null
    }

    // BUG-027 — record the URL+title before we tear the tab down so
    // ⌘⇧T from browser focus can reopen it. Skip about:blank entries
    // (no signal worth restoring; matches Chrome's heuristic).
    const closingTab = this.tabs[idx]
    const closingWc = closingTab.view.webContents
    const closingUrl = closingWc.getURL() || ''
    const closingTitle = closingWc.getTitle() || ''
    if (closingUrl && closingUrl !== 'about:blank') {
      this.closedTabs.push({ url: closingUrl, title: closingTitle, closedAt: Date.now() })
      if (this.closedTabs.length > CLOSED_TAB_CAP) this.closedTabs.shift()
    }

    // BUG-121 (2026-05-10) — closing tabs no longer spawns a replacement
    // about:blank. The retired BUG-020 + BUG-096 guards used to refuse
    // to drop below 1 main-strip tab (BUG-020) or below 1 main-strip
    // tab when an aux tab was pinned (BUG-096), spawning a fresh
    // about:blank in either case. That created a loop on the work
    // machine: user closed an about:blank → guard spawned a fresh
    // about:blank → user closed it → guard spawned another → ad
    // infinitum.
    //
    // Original BUG-020 motivation was "user can't dismiss the
    // boot-time FAQ tab," but the FAQ retired in v0.6.13 (ENH-135)
    // and the boot path no longer auto-opens a hard-coded tab — pin-
    // restore + the pack-canvas first-launch hook open whatever the
    // install service seeded into pins.json (currently the duo-default
    // pack's WDD canvas), and that tab is fully closeable.
    //
    // Net behavior change: tabs.length === 0 (or only an aux-pinned
    // tab remains) is now a valid empty state with activeIndex = -1.
    // The renderer's BrowserRenderer-side bounds-setter still fires,
    // but main's setBounds() guards on `tabs.length > 0 && activeId
    // !== auxTabId` so the empty state is a benign no-op. Address-bar
    // navigation and `duo navigate` in an empty state route through
    // navigate(), which now calls addTab+switchTab as a self-heal
    // (see navigate() below). activeView() returns null in the empty
    // state; goBack/goForward/reload/find/devtools/etc all guard.
    const [removed] = this.tabs.splice(idx, 1)
    // BUG-130 — drop the file:// watcher before tearing down the view.
    this.stopFileWatcher(removed.id)
    try { this.window.contentView.removeChildView(removed.view) } catch { /* ignore */ }
    try { removed.view.webContents.close() } catch { /* ignore */ }

    if (idx === this.activeIndex) {
      // The active tab was closed. Pick a neighbor, SKIPPING the aux
      // tab (its WCV has aux-specific bounds; activating it as main
      // would overwrite them and leave the aux pane blank — the
      // Phase 3c findNonAux logic, preserved here).
      const findNonAux = (start: number) => {
        for (let j = start; j >= 0; j--) {
          if (this.tabs[j] && this.tabs[j].id !== this.auxTabId) return j
        }
        for (let j = start + 1; j < this.tabs.length; j++) {
          if (this.tabs[j] && this.tabs[j].id !== this.auxTabId) return j
        }
        return -1
      }
      const nextMainIdx = findNonAux(Math.min(idx - 1, this.tabs.length - 1))
      if (nextMainIdx === -1) {
        // No non-aux tabs remain. Enter the empty state. emitState()
        // surfaces an empty BrowserState (url='', title='', etc.) so
        // the renderer's address bar + chrome reflect "no active tab."
        // The aux tab (if any) keeps its own bounds untouched.
        this.activeIndex = -1
        this.emitState()
      } else {
        this.activeIndex = nextMainIdx
        const newActive = this.tabs[nextMainIdx]
        newActive.view.setBounds(this.currentBounds)
        this.emitState()
        try {
          await this.cdp.attach(newActive.view.webContents)
        } catch (err) {
          console.warn('[BrowserManager] CDP attach failed on closeTab:', err)
        }
      }
    } else if (idx < this.activeIndex) {
      // Closed a tab to the left; shift our pointer
      this.activeIndex -= 1
    }

    this.emitTabs()
    return { ok: true }
  }

  /**
   * BUG-027 — pop the most-recently-closed tab off the stack and reopen
   * it. Switches to the new tab so the user lands on it. Returns
   * ok:false with reason 'empty' when nothing has been closed.
   */
  async reopenLastClosed(): Promise<{ ok: boolean; id?: number; url?: string; reason?: string }> {
    const last = this.closedTabs.pop()
    if (!last) return { ok: false, reason: 'empty' }
    const entry = this.addTab(last.url)
    try { await this.switchTab(entry.id) } catch { /* best-effort */ }
    return { ok: true, id: entry.id, url: last.url }
  }

  getTabs(): BrowserTab[] {
    return this.tabs.map((t, i) => ({
      id: t.id,
      url: t.view.webContents.getURL() || 'about:blank',
      title: t.view.webContents.getTitle() || '(no title)',
      // Phase 3c — `isActive` reflects the MAIN-STRIP active tab, not
      // including the aux tab. An aux-pinned tab is never the
      // main-strip active. Renderer's main strip filters out
      // `inAux: true` tabs; the aux pane finds the inAux tab.
      isActive: i === this.activeIndex && t.id !== this.auxTabId,
      inAux: t.id === this.auxTabId
    }))
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * ENH-175 (2026-05-23) — find an existing browser tab whose URL matches
   * `url` (after light normalization: strip trailing slash + strip hash);
   * if found, switch to it and return its handle. Otherwise open a new
   * tab loading the URL.
   *
   * Differs from `navigate()` (which reuses the active tab — kept for the
   * address-bar's in-tab override semantics). The CLI's `duo navigate
   * <url>` routes through this method so an ambient agent action does
   * NOT clobber whatever the owner has open in the active tab.
   */
  async navigateOrFocus(url: string): Promise<{ ok: boolean; url: string; title: string; reused: boolean } | { ok: true; url: string; routedTo: 'system-browser' }> {
    const target = normalizeForTabMatch(url)
    if (target) {
      for (const t of this.tabs) {
        const tabUrl = normalizeForTabMatch(t.view.webContents.getURL())
        if (tabUrl && tabUrl === target) {
          try { await this.switchTab(t.id) } catch { /* best-effort */ }
          return {
            ok: true,
            url: t.view.webContents.getURL() || url,
            title: t.view.webContents.getTitle() || '',
            reused: true
          }
        }
      }
    }
    // FOLLOWUP-027 — short-circuit before creating a tab if the URL
    // would be filtered. Matches the openTab path; see comment there.
    if (this.routeOffHostIfMatched(url)) {
      return { ok: true, url, routedTo: 'system-browser' }
    }
    // No match — open as a new tab. Off-host gate fires inside addTab
    // via the wireEvents will-navigate handler if the URL is blocklisted.
    const entry = this.addTab(url)
    try { await this.switchTab(entry.id) } catch { /* best-effort */ }
    return {
      ok: true,
      url: entry.view.webContents.getURL() || url,
      title: entry.view.webContents.getTitle() || '',
      reused: false
    }
  }

  async navigate(url: string): Promise<{ ok: boolean; url: string; title: string }> {
    // BUG-121 self-heal — typing a URL into the address bar in the
    // empty state (no active main tab) creates a new tab instead of
    // throwing. The address bar is the user's primary path back out
    // of the empty state; making it route through addTab+switchTab is
    // the simplest fix that doesn't require a new "create then
    // navigate" IPC verb.
    const view = this.activeView()
    if (!view) {
      const entry = this.addTab(url)
      try { await this.switchTab(entry.id) } catch { /* best-effort */ }
      return {
        ok: true,
        url: entry.view.webContents.getURL() || url,
        title: entry.view.webContents.getTitle() || ''
      }
    }
    // BUG-040 hole-fix: programmatic loadURL doesn't fire `will-navigate`,
    // so the address-bar input path bypassed the off-host route check on
    // first try. Gate here too.
    if (this.routeOffHostIfMatched(url)) {
      return { ok: true, url: view.webContents.getURL() || 'about:blank', title: view.webContents.getTitle() || '' }
    }
    await view.webContents.loadURL(url)
    return {
      ok: true,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle()
    }
  }

  goBack(): void {
    const view = this.activeView()
    if (!view) return
    const wc = view.webContents
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(): void {
    const view = this.activeView()
    if (!view) return
    const wc = view.webContents
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(): void {
    this.activeView()?.webContents.reload()
  }

  // ── Find-in-page (ENH-028) ────────────────────────────────────────────────
  // Wraps Electron's `webContents.findInPage` for the active tab. Each
  // keystroke from the find-bar resends START with the new query;
  // ⌘G / ⌘⇧G resend with `findNext: true` + a forward flag. Match
  // counts arrive via the `found-in-page` event wired in addTab →
  // wireEvents (search "ENH-028 found-in-page wiring").

  findInPage(query: string, options?: { findNext?: boolean; forward?: boolean }): void {
    if (!query) return
    const view = this.activeView()
    if (!view) return
    view.webContents.findInPage(query, {
      findNext: options?.findNext,
      forward: options?.forward !== false
    })
  }

  stopFindInPage(): void {
    const view = this.activeView()
    if (!view) return
    // 'clearSelection' drops the find highlight without leaving the
    // last-found range selected (which would interfere with the next
    // user keystroke / Send → Duo selection).
    view.webContents.stopFindInPage('clearSelection')
  }

  getActiveUrl(): string {
    return this.activeView()?.webContents.getURL() || ''
  }

  getActiveTitle(): string {
    return this.activeView()?.webContents.getTitle() || ''
  }

  // ENH-123 — `duo devtools --browser-pane` opens the active browser
  // tab's DevTools (Elements / Console / Network etc. for that page).
  // Distinct from main-renderer DevTools (handled in electron/main.ts).
  openDevTools(opts: { mode?: 'right' | 'bottom' | 'undocked' | 'detach' } = {}): void {
    this.activeView()?.webContents.openDevTools({ mode: opts.mode ?? 'right' })
  }
  closeDevTools(): void {
    const view = this.activeView()
    if (!view) return
    if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools()
  }
  isDevToolsOpened(): boolean {
    return this.activeView()?.webContents.isDevToolsOpened() ?? false
  }

  // ── External-domain routing (BUG-040) ─────────────────────────────────────
  // Consult the user's external-domains.json. If `url`'s host matches
  // a blocklist entry, route through shell.openExternal and push the
  // post-redirect banner. Returns true when routed (caller should
  // preventDefault on the underlying navigation). Returns false when
  // either no service is wired or the host doesn't match.

  // BUG-130 — start or refresh the file:// auto-reload watcher for a
  // tab. Called from `did-navigate` (and `did-navigate-in-page`, which
  // also fires for SPA-style hash changes on a file:// host). Idempotent
  // when the URL hasn't actually changed paths.
  private syncFileWatcher(tabId: number, url: string): void {
    const targetPath = (() => {
      if (!url.startsWith('file://')) return null
      try {
        const u = new URL(url)
        return decodeURIComponent(u.pathname)
      } catch {
        return null
      }
    })()

    const existing = this.fileWatchers.get(tabId)
    if (!targetPath) {
      if (existing) {
        if (existing.timer) clearTimeout(existing.timer)
        void existing.close().catch(() => null)
        this.fileWatchers.delete(tabId)
      }
      return
    }
    if (existing && existing.path === targetPath) {
      // No-op — already watching the right file.
      return
    }
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer)
      void existing.close().catch(() => null)
      this.fileWatchers.delete(tabId)
    }

    let watcher: chokidar.FSWatcher | null = null
    try {
      watcher = chokidar.watch(targetPath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
      })
    } catch (err) {
      console.warn('[BUG-130] failed to start file:// watcher:', err)
      return
    }

    const state: { path: string; close: () => Promise<void>; timer: NodeJS.Timeout | null } = {
      path: targetPath,
      close: async () => { try { await watcher?.close() } catch { /* noop */ } },
      timer: null
    }
    const reload = () => {
      // The tab may have been closed between fire + debounce. Look up
      // by id rather than capturing the view, so we don't fire reload
      // on a torn-down WebContents.
      const tab = this.tabs.find(t => t.id === tabId)
      if (!tab) {
        if (state.timer) clearTimeout(state.timer)
        void state.close().catch(() => null)
        this.fileWatchers.delete(tabId)
        return
      }
      if (!tab.view.webContents.isDestroyed()) {
        try { tab.view.webContents.reload() } catch { /* tab gone */ }
      }
    }
    watcher.on('change', () => {
      if (state.timer) clearTimeout(state.timer)
      state.timer = setTimeout(reload, 250)
    })
    watcher.on('error', (err) => {
      console.warn('[BUG-130] file:// watcher error:', err)
    })
    this.fileWatchers.set(tabId, state)
  }

  // Stop + drop a tab's file:// watcher. Called on tab close.
  private stopFileWatcher(tabId: number): void {
    const existing = this.fileWatchers.get(tabId)
    if (!existing) return
    if (existing.timer) clearTimeout(existing.timer)
    void existing.close().catch(() => null)
    this.fileWatchers.delete(tabId)
  }

  /** ENH-178 — current browser-mode setting. Driven by `setBrowserMode`. */
  getBrowserMode(): import('../shared/types').BrowserMode {
    return this.browserMode
  }

  /** ENH-178 — change the mode. Caller is responsible for the
   *  IT-warning prompt (CLI side); main-process accepts the value
   *  unconditionally so the renderer / CLI / future Settings menu
   *  all share one wire. */
  setBrowserMode(mode: import('../shared/types').BrowserMode): void {
    this.browserMode = mode
  }

  private routeOffHostIfMatched(url: string): boolean {
    // ENH-178 — three-mode filter wraps the existing
    // externalDomains check.
    //
    //   unfiltered  → never route off-host (return false)
    //   local-only  → route everything that isn't isLocalUrlForBrowserMode
    //   filtered    → fall through to the legacy externalDomains check
    if (this.browserMode === 'unfiltered') return false
    if (this.browserMode === 'local-only') {
      if (isLocalUrlForBrowserMode(url)) return false
      // Off-host route for any non-local URL. Banner shape is the same
      // as the filtered-mode redirect so the renderer UI stays
      // consistent.
      void shell.openExternal(url).catch(() => null)
      if (this.window && !this.window.isDestroyed()) {
        try {
          const host = new URL(url).hostname
          const push: ExternalRedirectedPush = { host, reason: 'local-only' }
          this.window.webContents.send(IPC.EXTERNAL_REDIRECTED, push)
        } catch {
          /* malformed URL — already routed; banner is best-effort */
        }
      }
      return true
    }
    // 'filtered' — legacy behavior. Falls through to the existing
    // external-domains.json match.
    if (!this.externalDomains) return false
    const result = this.externalDomains.matchUrl(url)
    if (!result.matched) return false

    // Fire-and-forget — shell.openExternal returns a promise but we
    // don't await; the embedded navigation has already been
    // intercepted. Errors here are typically "user has no default
    // browser for this scheme" which is rare for http(s).
    void shell.openExternal(url).catch(() => null)

    // Push the banner so the user sees what happened. Same shape +
    // channel as openExternalUrl in main.ts — keeps the renderer
    // banner code unchanged.
    if (this.window && !this.window.isDestroyed()) {
      try {
        const host = new URL(url).hostname
        const push: ExternalRedirectedPush = { host, reason: result.reason }
        this.window.webContents.send(IPC.EXTERNAL_REDIRECTED, push)
      } catch {
        /* malformed URL — already routed; banner is best-effort */
      }
    }
    return true
  }

  // ── Focus ──────────────────────────────────────────────────────────────────
  // Move keyboard focus to the active browser view. Used by ⌘` pane-cycling.

  focusActive(): void {
    this.activeView()?.webContents.focus()
  }

  // ── Inspect mode (ENH-159b) ────────────────────────────────────────────────

  /**
   * ENH-159b — toggle / set element-inspect mode in the active browser
   * page. The page-side INSPECT_OBSERVER_IIFE reads `__duoInspectActive`
   * on every mouse/key event and bails when false, so flipping the flag
   * is the only switch needed. Pushes BROWSER_INSPECT_MODE to the
   * renderer so the toolbar toggle button (when it lands) and any
   * future affordance reflect the truth without polling.
   *
   * Accepts `'toggle'` so the CLI verb `duo inspect` (no flag) can
   * flip without first reading state.
   *
   * Returns the new active state.
   */
  setInspectMode(input: boolean | 'toggle'): boolean {
    const next = input === 'toggle' ? !this.cdp.getInspectMode() : input
    const changed = this.cdp.setInspectMode(next)
    if (!this.window.isDestroyed()) {
      // Always push, even when unchanged — keeps a freshly-mounted
      // subscriber in sync. Renderer dedupes if it cares.
      this.window.webContents.send(IPC.BROWSER_INSPECT_MODE, next)
    }
    // Suppress unused-var when we don't need `changed` downstream.
    void changed
    return next
  }

  /** ENH-159b — read the cached inspect-mode state. Sister to
   *  setInspectMode for the toggle path + any state-read use case. */
  getInspectMode(): boolean {
    return this.cdp.getInspectMode()
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────

  setBounds(bounds: BrowserBounds): void {
    this.currentBounds = bounds
    // Phase 3c — skip the aux tab. Main bounds apply to the active
    // main-strip tab only. The aux tab gets its own bounds via
    // setAuxBounds; if we re-applied main bounds to it here, the aux
    // pane would briefly flash the old main-pane geometry on every
    // resize.
    if (this.tabs.length > 0 && !this.mutedForOverlay) {
      const activeId = this.tabs[this.activeIndex]?.id
      if (activeId !== undefined && activeId !== this.auxTabId) {
        this.tabs[this.activeIndex].view.setBounds(bounds)
      }
    }
  }

  /** Phase 3c — bounds for the aux-pinned browser tab. Stored
   *  separately from `currentBounds` (which tracks the main strip)
   *  and applied only to the auxTabId's view. No-op when no aux tab
   *  is pinned. */
  setAuxBounds(bounds: BrowserBounds): void {
    this.auxBounds = bounds
    if (this.auxTabId === null) return
    const aux = this.tabs.find(t => t.id === this.auxTabId)
    if (aux && !this.mutedForOverlay) {
      aux.view.setBounds(bounds)
    }
  }

  /** Phase 3c — pin a browser tab into the aux slot. Removes it from
   *  the main strip's rotation (switchTab skips it; getTabs marks
   *  it `inAux: true`). If the moved tab WAS the main-strip's active
   *  tab, the active index is shifted to the next available main
   *  tab (or 0 if all that's left is aux-pinned, which can't happen
   *  in v1 since aux holds ≤1 and main always has ≥1 after addTab).
   *  Applies aux bounds immediately so the WCV repositions in one
   *  paint. Returns metadata for the renderer's aux header. */
  moveTabToAux(id: number): { ok: boolean; error?: string; url?: string; title?: string } {
    const idx = this.tabs.findIndex(t => t.id === id)
    if (idx === -1) return { ok: false, error: `No tab with id ${id}` }
    if (this.auxTabId === id) {
      // Already in aux — return current metadata as a no-op.
      const tab = this.tabs[idx]
      return {
        ok: true,
        url: tab.view.webContents.getURL() || 'about:blank',
        title: tab.view.webContents.getTitle() || ''
      }
    }
    // If a DIFFERENT tab was already in aux, release it first so the
    // aux slot only holds one tab. The released tab returns to the
    // main strip's regular layout (next setBounds will reposition it
    // back into main bounds when its turn comes via switchTab).
    if (this.auxTabId !== null) {
      const prev = this.tabs.find(t => t.id === this.auxTabId)
      if (prev) prev.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      this.auxTabId = null
    }
    this.auxTabId = id
    // If the tab moved to aux was the main-strip's active tab, pick a
    // new main-strip active tab. Strategy: pick the first non-aux tab.
    if (idx === this.activeIndex) {
      const nextMainIdx = this.tabs.findIndex(t => t.id !== this.auxTabId)
      if (nextMainIdx !== -1) {
        this.activeIndex = nextMainIdx
        // Re-apply main bounds to the new active tab so its view is
        // visible (the previous main-active was just moved to aux).
        if (!this.mutedForOverlay) {
          this.tabs[nextMainIdx].view.setBounds(this.currentBounds)
        }
      }
    }
    // Apply aux bounds to the now-aux tab.
    const aux = this.tabs[idx]
    if (!this.mutedForOverlay) {
      aux.view.setBounds(this.auxBounds)
    }
    this.emitTabs()
    this.emitState()
    return {
      ok: true,
      url: aux.view.webContents.getURL() || 'about:blank',
      title: aux.view.webContents.getTitle() || ''
    }
  }

  /** Phase 3c — release the aux-pinned tab back to the main strip.
   *  Sets it as main-strip active so the user lands back on the
   *  released tab (matches "promote" semantics for file tabs). No-op
   *  when no tab is pinned. */
  releaseAuxTab(): { ok: boolean; error?: string } {
    if (this.auxTabId === null) return { ok: false, error: 'No tab is currently in aux' }
    const released = this.auxTabId
    const idx = this.tabs.findIndex(t => t.id === released)
    this.auxTabId = null
    if (idx === -1) {
      // Tab was closed externally while in aux — already gone.
      this.emitTabs()
      this.emitState()
      return { ok: true }
    }
    // Shrink whatever is currently main-active so the released tab
    // can take over the visible main bounds.
    const mainActive = this.tabs[this.activeIndex]
    if (mainActive && mainActive.id !== released) {
      mainActive.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    }
    this.activeIndex = idx
    if (!this.mutedForOverlay) {
      this.tabs[idx].view.setBounds(this.currentBounds)
    }
    this.tabs[idx].view.webContents.focus()
    this.emitTabs()
    this.emitState()
    return { ok: true }
  }

  /** Phase 3c — public read for the aux state. The renderer doesn't
   *  need this (auxState is owned renderer-side), but the CLI's
   *  `duo split-view` reflection wants to know whether aux is
   *  holding a browser tab. */
  getAuxTabId(): number | null {
    return this.auxTabId
  }

  // BUG-047 Path B (overlay-mute) — temporarily collapse the active
  // WebContentsView to 1×1 so renderer-DOM overlays (context menus,
  // tooltips) can render unobstructed. The macOS compositor paints
  // WCV above renderer DOM regardless of z-index, so a renderer-side
  // menu that extends past the strip area gets clipped without this.
  // Restoring re-applies the most recent setBounds.
  //
  // Path A (clamp menu to renderer-DOM area) was specced but the
  // strip + address bar zone is ~80px tall — too small for a 4-item
  // menu. Path E (native Menu.popup) is the long-term answer; this
  // mute-and-restore approach is the minimum viable for v1.
  private mutedForOverlay = false
  setOverlayMuted(muted: boolean): void {
    this.mutedForOverlay = muted
    if (this.tabs.length === 0) return
    const main = this.tabs[this.activeIndex]
    const aux = this.auxTabId !== null ? this.tabs.find(t => t.id === this.auxTabId) : null
    if (muted) {
      main.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
      // ENH-080 walk-1 fix — also mute the aux WCV when present.
      // Without this, the aux pane's WCV stayed at full bounds and
      // composited over any renderer-level modal mounted in the
      // split-view region (the tab-search palette's z-50 doesn't
      // beat the WCV — that's the whole reason setOverlayMuted exists).
      if (aux) aux.view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    } else {
      main.view.setBounds(this.currentBounds)
      if (aux) aux.view.setBounds(this.auxBounds)
    }
  }

  // ── Attach CDP after first bounds are known ────────────────────────────────

  async attachCdp(): Promise<void> {
    if (this.tabs.length > 0) {
      await this.cdp.attach(this.tabs[this.activeIndex].view.webContents)
    }
  }

  // ── Multi-tab CDP-adjacent state pushes ────────────────────────────────────

  /** BUG-133 — push `window.__duoClaudeLive` to EVERY browser tab's
   *  webContents, not just whichever one CdpBridge happens to be
   *  attached to. Without this, the Send→agent pill's claude-live
   *  gate goes stale on non-active tabs (main pane stays "claude=true"
   *  after the user switches away from a Claude terminal, because
   *  CdpBridge.setClaudeLive only pushes to the currently-attached
   *  WC — usually aux or the last-switched main tab).
   *
   *  Uses webContents.executeJavaScript (no CDP required) so it works
   *  on every browser tab regardless of CDP attachment state. */
  broadcastClaudeLive(live: boolean): void {
    // BUG-133 — when live=false, ALSO force-hide any currently-visible
    // pill. The page-side IIFE re-checks __duoClaudeLive only on
    // selectionchange/scroll/resize, so a pill that was visible while
    // Claude was live stays visible after Claude exits until the user
    // triggers one of those events. Hiding inline closes that gap.
    const hideExpr = live ? '' : `var __p=document.querySelector('[data-duo-send-pill]');if(__p)__p.style.setProperty('display','none','important');`
    const expr = `window.__duoClaudeLive=${JSON.stringify(live)};${hideExpr}`
    for (const { view } of this.tabs) {
      const wc = view.webContents
      if (wc.isDestroyed()) continue
      wc.executeJavaScript(expr, true).catch(() => { /* ignore */ })
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.cdp.detach()
    for (const { view } of this.tabs) {
      try { this.window.contentView.removeChildView(view) } catch { /* ignore */ }
    }
    this.tabs = []
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  // BUG-121 (2026-05-10) — return null in the empty state (zero tabs,
  // or activeIndex parked at -1 because the only remaining tab is
  // aux-pinned). All callers now guard the null case; pre-fix, every
  // caller assumed a non-null active view and the empty state was
  // architecturally impossible because the BUG-020 + BUG-096 guards
  // spawned a replacement about:blank.
  private activeView(): WebContentsView | null {
    if (this.activeIndex < 0 || this.activeIndex >= this.tabs.length) return null
    return this.tabs[this.activeIndex].view
  }

  private wireEvents(view: WebContentsView): void {
    const wc = view.webContents
    const emit = () => {
      // Title/url changes on any tab affect the tab strip
      this.emitTabs()
      // URL/loading state in the chrome only tracks the active tab
      if (this.tabs[this.activeIndex]?.view === view) this.emitState()
    }

    // BUG-040 — intercept top-level navigations and route off-host
    // hosts through shell.openExternal. `will-navigate` fires for
    // address-bar navigations, link clicks, and form submissions
    // (NOT for in-page anchor changes — `did-navigate-in-page` would
    // catch those, but those don't change host so we don't need to).
    // `will-redirect` fires for HTTP redirects mid-load — also catch
    // these so e.g. `capitalone.com → www.capitalone.com → SSO host`
    // bounces at any redirect hop on the blocklist.
    wc.on('will-navigate', (event, navUrl) => {
      if (this.routeOffHostIfMatched(navUrl)) {
        event.preventDefault()
      }
    })
    wc.on('will-redirect', (event, redirectUrl) => {
      if (this.routeOffHostIfMatched(redirectUrl)) {
        event.preventDefault()
      }
    })

    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)

    // BUG-130 — file:// auto-reload watcher. Sync on every commit-class
    // navigation so leaving a file:// URL stops the watcher and arriving
    // at one starts a fresh one. `did-navigate-in-page` covers hash
    // changes on file:// hosts too.
    const syncWatch = (_e?: unknown, navUrl?: string) => {
      const tab = this.tabs.find(t => t.view === view)
      if (!tab) return
      const url = navUrl ?? wc.getURL()
      this.syncFileWatcher(tab.id, url)
    }
    wc.on('did-navigate', syncWatch)
    wc.on('did-navigate-in-page', syncWatch)
    // ENH-028 found-in-page wiring — Electron emits this every time
    // findInPage's match state updates (intermediate while still
    // scanning, then once with finalUpdate=true). Forward to the
    // renderer so the find bar can show "n / m". Only fire when the
    // tab matching the result is the currently-active one (the user
    // can't see results from a backgrounded tab).
    wc.on('found-in-page', (_event, result) => {
      if (this.tabs[this.activeIndex]?.view !== view) return
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send(IPC.BROWSER_FIND_RESULT, {
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate
        })
      }
    })
    // Issue #27 — record history on stable navigations. did-navigate
    // is the right hook (not did-finish-load which fires for failed
    // loads too) and the title is usually populated by then; we also
    // top up via page-title-updated when the page swaps in a real
    // title after the URL committed.
    if (this.history) {
      const recordCurrent = () => {
        const url = wc.getURL()
        const title = wc.getTitle()
        if (url) void this.history?.record(url, title)
      }
      wc.on('did-navigate', recordCurrent)
      wc.on('page-title-updated', recordCurrent)
    }
  }

  // When the browser WebContentsView has focus, keystrokes like Cmd+T
  // and Cmd+L never reach the renderer's window — Chromium consumes
  // them. Intercept the Duo-owned Cmd shortcuts here, block the browser
  // from acting on them, and forward the event back to the renderer
  // where useKeyboardShortcuts already handles them.
  private wireKeyForwarding(view: WebContentsView): void {
    view.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      // BUG-189 follow-up — bail if the main window is gone (quit/teardown).
      // Guards the focus() + both sends below: webContents.send on a
      // destroyed window throws "Object has been destroyed".
      if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
      const key = input.key.toLowerCase()

      // ⌃Tab / ⌃⇧Tab cycle browser tabs. Handled in the renderer, but
      // Chromium would consume the Tab key inside the page otherwise.
      if (input.control && key === 'tab') {
        event.preventDefault()
        this.window.webContents.send(IPC.BROWSER_KEY_FORWARD, {
          key: input.key,
          code: input.code,
          shift: input.shift,
          meta: input.meta,
          alt: input.alt,
          ctrl: input.control
        })
        return
      }

      if (!input.meta) return
      const isDuoShortcut =
        key === 't' ||
        key === 'n' ||
        key === 'l' ||
        key === 'w' ||
        key === 'b' ||
        // Stage 15.3 — ⌘D = Send → Duo (chord works from browser focus
        // when the user has selected text in the page).
        key === 'd' ||
        // Sprint 6 BUG-084 — ⌘R = reload the active browser tab. Must
        // be forwarded so the renderer matcher fires (rather than
        // letting Chromium do its default reload, which previously
        // also nuked terminal sessions when the menu role was bound).
        key === 'r' ||
        // ENH-028 — ⌘F / ⌘G / ⌘⇧F = find-in-page. Without forwarding,
        // Chromium would consume these inside the page (its built-in
        // find UI doesn't render in WebContentsView, so ⌘F was a
        // no-op when the user was focused on a page). Renderer's
        // openFind/findNext/findPrev branches on activeWorking and
        // dispatches the right window event.
        key === 'f' ||
        key === 'g' ||
        key === '[' ||
        key === ']' ||
        // Sprint 3 Phase 3b — ⌘/ / ⌘⇧/ open / close Split View.
        // Without forwarding, Chromium would consume the keystroke
        // (or let it fall through to the page). The renderer's
        // splitViewToggle / splitViewPromote handler reads
        // activeWorking off App.tsx state.
        // BUG-075 v3 (v0.6.5) — chord re-pick from ⌘\ to ⌘/ because
        // 1Password's system-level Cmd+\ grab intercepts the original
        // before Chromium / Duo can see it. `input.code === 'Slash'`
        // is modifier-independent (Shift+/ produces input.key === '?'
        // but input.code === 'Slash' regardless). Same code-vs-key
        // lesson as the previous chord — see globalShortcuts.ts.
        input.code === 'Slash' ||
        // ENH-080 walk-1 fix — ⌘⇧A = tab-search palette. Without this
        // entry, Chromium's "select all" handler claims the chord when
        // the browser pane has focus and the renderer never sees the
        // keystroke. Symptom: palette opened from terminal/editor focus
        // but no-op'd from browser-pane focus — and once the palette
        // had been used once (focus moves to WCV after pick) it stopped
        // working entirely.
        //
        // BUG-131 (v0.7.0 rev6) — gated on `input.shift` so we ONLY
        // intercept ⌘⇧A (the palette), NOT plain ⌘A (which should
        // fall through to Chromium's native select-all for the focused
        // input/textarea). Pre-fix: this intercepted both, which is why
        // ⌘A in textareas of browser-pane pages (smoke-walk inputs, any
        // playground form field) was a no-op.
        (input.shift && input.code === 'KeyA') ||
        // ENH-159b — ⌘⇧C toggles inspect mode (Chrome devtools parity).
        // Without forwarding, Chromium routes ⌘⇧C to its own developer-
        // tools shortcut, which doesn't surface in WebContentsView, so
        // the renderer never sees the keystroke. Gated on Shift to
        // avoid colliding with plain ⌘C = copy.
        (input.shift && input.code === 'KeyC') ||
        // ENH-098 (Sprint 9 walk-1 re-pick) — pane-jump chords ⌘⇧L/;/'.
        // Originally ⌘⌥L/;/' but owner's window manager intercepts
        // meta+alt at the system level so chord never reaches the
        // renderer. Use `code` (KeyL/Semicolon/Quote) since Shift
        // modifies the produced character on US layouts. Gated on
        // `input.shift` to avoid colliding with ⌘L = focusAddressBar
        // and any future plain-modifier chords sharing the same
        // physical key.
        (input.shift && (input.code === 'KeyL' || input.code === 'Semicolon' || input.code === 'Quote')) ||
        // ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active file. From
        // browser-pane focus, Backspace would normally trigger
        // Chromium's history-back behavior; intercepting here lets
        // the chord reach the renderer instead. The renderer's
        // deleteCurrentFile callback no-ops if the active surface
        // is a browser tab anyway, but escaping the chord is still
        // necessary so that user holding ⌘⇧⌫ on a browser tab
        // doesn't trigger a back-navigation surprise.
        (input.shift && input.code === 'Backspace') ||
        (key >= '1' && key <= '9')
      // NOTE: ⌘` is intentionally NOT in this list. It's handled by the
      // app-menu accelerator (which beats macOS's system shortcut) and
      // dispatched via IPC.PANE_TOGGLE_FOCUS.
      if (!isDuoShortcut) return
      event.preventDefault()

      // BUG-002 fix: ⌘T / ⌘N / ⌘L all move keyboard focus to a
      // renderer-side element (address bar, filename input, address bar)
      // immediately after the renderer-side handler runs. But while the
      // browser WebContentsView has OS focus, the renderer doesn't —
      // and `el.focus()` on a renderer DOM node is a no-op when the
      // renderer doesn't own OS focus to give. Reclaim focus
      // synchronously here, BEFORE the IPC send, so by the time the
      // renderer's onBrowserKey handler runs the focus call lands.
      //
      // ⌃Tab and ⌘[, ⌘], ⌘1–9, ⌘⇧1–9, ⌘W, ⌘B intentionally skip this:
      // they either keep focus on the browser (Chrome-parity tab
      // cycling) or are pure state changes with no follow-up focus
      // target. Reclaiming focus for ⌃Tab in particular would steal it
      // away from the next-active browser tab, which the user expects
      // to keep typing into.
      // ENH-028 — ⌘F also needs the focus reclaim: the renderer's
      // openFind dispatcher mounts the find input and calls .focus()
      // on it. Without OS focus on the renderer, that focus call is
      // a no-op and the user types into the page instead of the bar.
      // ENH-080 — ⌘⇧A also needs the focus reclaim: the palette
      // mounts a search input and calls `.focus()` on it via
      // requestAnimationFrame. Without OS focus on the renderer, that
      // focus call is a no-op and the palette opens with no caret —
      // the user sees the dim backdrop but typing goes nowhere. Same
      // family as ⌘F.
      const needsRendererFocus =
        key === 't' || key === 'n' || key === 'l' || key === 'f' ||
        (input.code === 'KeyA' && input.shift)
      if (needsRendererFocus) {
        this.window.webContents.focus()
      }

      // ENH-080 walk-1 fix — include `code` so chord matchers that
      // consult `e.code` (KeyA, Slash, KeyM) round-trip correctly via
      // the synthetic KeyboardEvent rebuilt in useKeyboardShortcuts.
      // Pre-fix: synthetic.code was '' so KeyA / Slash matchers never
      // matched on the WCV-forward path.
      this.window.webContents.send(IPC.BROWSER_KEY_FORWARD, {
        key: input.key,
        code: input.code,
        shift: input.shift,
        meta: input.meta,
        alt: input.alt,
        ctrl: input.control
      })
    })

    // BUG-042 — when the user clicks into the WebContentsView, the
    // page captures keyboard focus but the renderer's column wrapper
    // never sees a mousedown event (the click lands inside a separate
    // process). That left `focusedColumn` stuck at whatever the user
    // last clicked OUTSIDE the browser pane, so ⌃Tab cycled terminal
    // tabs even when the user thought they were "in" the browser.
    //
    // The webContents `focus` event fires whenever this view gains
    // OS-level keyboard focus — covers click-to-focus, Tab-to-focus
    // from devtools, and programmatic webContents.focus() calls.
    // Forward a one-shot signal to the renderer so it can flip
    // focusedColumn = 'working'. Symmetric to the canvas iframe's
    // mousedown forwarder (BUG-037 fix on the renderer side).
    view.webContents.on('focus', () => {
      // BUG-189 follow-up — bail if the main window is gone (quit/teardown).
      if (this.window.isDestroyed() || this.window.webContents.isDestroyed()) return
      // Phase 3c BUG-095 fix — forward the tab id + slot so the
      // renderer can distinguish a focus event on the AUX-pinned tab
      // from one on a main-strip tab. Pre-fix the renderer
      // unconditionally flipped activeWorking to 'browser' on every
      // focus event, which kicked the active markdown / canvas out
      // of the main pane whenever the user clicked into the aux'd
      // browser tab. Symmetric with how main-strip clicks should
      // continue to work.
      const tab = this.tabs.find(t => t.view === view)
      if (!tab) return
      const slot: 'main' | 'aux' = tab.id === this.auxTabId ? 'aux' : 'main'
      this.window.webContents.send(IPC.BROWSER_FOCUS_GAINED, { tabId: tab.id, slot })
    })
  }

  getState(): BrowserState {
    // BUG-121 — emit an empty BrowserState when there's no active main
    // tab. The renderer's address bar reads url + canGoBack/Forward
    // from this; an empty url + zeroed nav state is the natural
    // "nothing to drive" presentation.
    const view = this.activeView()
    if (!view) {
      return { url: '', title: '', canGoBack: false, canGoForward: false, isLoading: false }
    }
    const wc = view.webContents
    return {
      url: wc.getURL() || 'about:blank',
      title: wc.getTitle() || '',
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading()
    }
  }

  private emitState(): void {
    this.onStateChange(this.getState())
  }

  private emitTabs(): void {
    this.onTabsChange(this.getTabs())
  }
}
