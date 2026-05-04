// Stage 2: WebContentsView lifecycle, tab management, SSO session persistence.
//
// One WebContentsView per logical browser tab. All views are added to
// window.contentView; only the active view has real bounds. Inactive views are
// shrunk to 1×1 so they don't intercept events or render visibly.
//
// SSO persistence: every view uses the BROWSER_SESSION_PARTITION ('persist:duo-browser'),
// so cookies / localStorage survive app restarts.

import { WebContentsView, app, session, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import type { BrowserWindow } from 'electron'
import type { BrowserTab, BrowserState, BrowserBounds } from '../shared/types'
import type { ExternalRedirectedPush, PlaygroundAction } from '../shared/host-api'
import { IPC } from '../shared/types'
import { BROWSER_SESSION_PARTITION } from '../core/constants'
import { parseActionFromAttrs } from '../shared/playground-actions'
import type { CdpBridge } from './cdp-bridge'
import type { BrowserHistoryService } from '../core/browser-history-service'
import type { ExternalDomainsService } from '../core/external-domains-service'

// Default landing page for new browser tabs.
//
// v0.3.1 — Prefer the user-installed copy at `~/.claude/duo/help/<file>`
// (created by the install service from the bundle copy). This makes the
// URL stable across app moves AND matches the URLs in
// `~/.claude/duo/pins.json` (ENH-003 — FAQ + What Duo Does
// default-pinned), so the default-landing tab renders with the pin
// glyph in the strip.
//
// Fall back to the bundle copy at `app.getAppPath()/help/<file>` for
// pre-first-install launches (the user hasn't clicked Install yet).
// In dev `app.getAppPath()` is the project root; in prod it's the
// asar root (electron-builder.yml ships help/**/* inside asar).
function helpUrl(filename: string): string {
  try {
    const userPath = join(homedir(), '.claude', 'duo', 'help', filename)
    if (existsSync(userPath)) return pathToFileURL(userPath).href
    return pathToFileURL(join(app.getAppPath(), 'help', filename)).href
  } catch {
    return 'about:blank'
  }
}

function defaultLandingUrl(): string {
  return helpUrl('faq.html')
}

// BUG-018 fix — `⌘T` (and any "open a fresh tab" CLI / UI path)
// gets a blank canvas, NOT the FAQ. The FAQ is the FIRST-tab
// default (boot landing) — duplicating it on every ⌘T was
// confusing.
//
// `about:blank` is the simplest "new tab" page: the address bar
// reflects no URL, the user types where they want to go. Pairs
// with the renderer-side address-bar auto-focus on new-tab open
// (see App.tsx § newBrowserTab).
function newTabUrl(): string {
  return 'about:blank'
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
  // BUG-027 — most-recently-closed stack. Used by reopenLastClosed().
  private closedTabs: ClosedTabEntry[] = []
  // Issue #27 — history service for URL-bar autocomplete. Injected by
  // main; populated on did-navigate.
  private history: BrowserHistoryService | null = null
  // BUG-040 — off-host routing. When non-null, will-navigate +
  // setWindowOpenHandler consult the service and route matching URLs
  // through shell.openExternal instead of the embedded browser.
  private externalDomains: ExternalDomainsService | null = null

  constructor(
    window: BrowserWindow,
    cdp: CdpBridge,
    onStateChange: StateCallback,
    onTabsChange: TabsCallback,
    history?: BrowserHistoryService,
    externalDomains?: ExternalDomainsService,
    options: { bootDefaultTab?: boolean } = {}
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

    // BUG-078 (v0.6.5 Phase 5 walk) — Owner asked: "why does a new tab
    // of duo faq open on every app launch?" Root cause: the constructor
    // unconditionally opened the FAQ as tab[0]. When a persisted session
    // existed, `restoreFromSession` later navigated tab[0] AWAY from the
    // FAQ to the saved URL — but the FAQ is in pins.json as a default
    // pin (ENH-003), so BUG-057's pin-restore loop re-added it as a
    // fresh tab. Net: closing the FAQ never sticks; it comes back every
    // launch. Owner's rule: "boot load only on fresh app; skip if prev
    // tabs persisted." Implementation: main.ts decides at boot whether
    // a session exists and passes `bootDefaultTab: false` to suppress
    // the constructor's auto-open. Session restore (or BUG-057 pinning)
    // owns the post-construction tab-add. Default stays `true` so other
    // call sites (tests, future entry points) keep current behavior.
    if (options.bootDefaultTab ?? true) {
      this.addTab()  // open the first tab (FAQ landing)
    }
  }

  // ── Tab management ─────────────────────────────────────────────────────────

  /** Stage 21c — restore browser tabs from a persisted session. The
   *  constructor's default-tab call has already opened one tab; this
   *  method navigates that first tab to `savedTabs[0]` and adds
   *  additional tabs for `savedTabs[1..N]`. Idempotent at the
   *  signature level — calling with an empty array is a no-op. */
  async restoreFromSession(savedTabs: { url: string; title: string }[], activeIndex: number): Promise<void> {
    if (savedTabs.length === 0) return

    // BUG-078 (v0.6.5 Phase 5 walk) — handle the case where the
    // constructor was told `bootDefaultTab: false` and `this.tabs` is
    // empty. The legacy path repurposed the boot tab via `loadURL`;
    // when there's no boot tab, just `addTab(savedTabs[0].url)` —
    // which goes through the same off-host gating path (`addTab`
    // delegates to `routeOffHostIfMatched` internally for the loaded
    // URL).
    let startIndex: number
    if (this.tabs.length === 0) {
      this.addTab(savedTabs[0].url)
      startIndex = 1
    } else {
      // Repurpose the constructor's default tab as the first restored tab.
      // BUG-040 hole-fix: gate the restored URL through the off-host
      // matcher so a session containing capitalone.com (or any matched
      // host) bounces to the system browser instead of resurrecting an
      // SSO-broken embedded session on relaunch.
      const firstTab = this.tabs[0]
      const restored = savedTabs[0].url
      if (this.routeOffHostIfMatched(restored)) {
        try { await firstTab.view.webContents.loadURL('about:blank') } catch { /* ignore */ }
      } else {
        try { await firstTab.view.webContents.loadURL(restored) } catch { /* page-load errors are user-visible already */ }
      }
      startIndex = 1
    }

    // Add the rest
    for (let i = startIndex; i < savedTabs.length; i++) {
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

  addTab(url = defaultLandingUrl()): TabEntry {
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

    this.wireEvents(view)
    this.wireKeyForwarding(view)

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

  async openTab(url = newTabUrl()): Promise<{ ok: true; id: number; url: string; title: string }> {
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
    const idx = this.tabs.findIndex(t => t.id === n)
    if (idx === -1) return { ok: false, error: `No tab with id ${n}` }
    if (idx === this.activeIndex) return { ok: true }

    // Shrink current active view
    this.tabs[this.activeIndex].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    this.activeIndex = idx
    this.tabs[idx].view.setBounds(this.currentBounds)

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

    // Emit UI updates first — CDP attach is best-effort and must not block
    // the state/tab-strip updates the renderer needs.
    this.emitState()
    this.emitTabs()

    try {
      await this.cdp.attach(this.tabs[idx].view.webContents)
    } catch (err) {
      console.warn('[BrowserManager] CDP attach failed on switchTab:', err)
    }
    return { ok: true }
  }

  async closeTab(n: number): Promise<{ ok: boolean; error?: string }> {
    const idx = this.tabs.findIndex(t => t.id === n)
    if (idx === -1) return { ok: false, error: `No tab with id ${n}` }

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

    // BUG-020 fix — closing the last tab no longer hard-fails. Instead,
    // open a fresh new-tab page first, then close the requested tab.
    // Net effect: 1 tab remains, but it's a fresh about:blank.
    // Mirrors Notion's "close last tab → open blank tab" pattern.
    // Why: the pre-fix behavior left users with no way to dismiss the
    // boot-time FAQ tab (it's the first/only tab on first launch and
    // was non-closeable). With the new behavior, ⌘W on the FAQ
    // replaces it with a blank tab the user can navigate from.
    if (this.tabs.length === 1) {
      this.addTab(newTabUrl())
      // The new tab is appended to this.tabs[]. The original (last)
      // tab keeps its index; addTab leaves activeIndex unchanged.
      // Switch to the new tab so the user lands on it after the
      // close completes.
      const newTabId = this.tabs[this.tabs.length - 1].id
      try { await this.switchTab(newTabId) } catch { /* best-effort */ }
      // The original tab's index may have shifted? No — addTab pushes
      // to the END, the original is still at index 0 (or wherever).
      // Re-resolve the close target by id.
      const newIdx = this.tabs.findIndex(t => t.id === n)
      if (newIdx === -1) return { ok: true } // race: target already gone
      const [removed] = this.tabs.splice(newIdx, 1)
      try { this.window.contentView.removeChildView(removed.view) } catch { /* ignore */ }
      try { removed.view.webContents.close() } catch { /* ignore */ }
      // After removing the original, if it was at an index < activeIndex,
      // shift activeIndex down.
      if (newIdx < this.activeIndex) this.activeIndex -= 1
      this.emitTabs()
      return { ok: true }
    }

    const [removed] = this.tabs.splice(idx, 1)
    try { this.window.contentView.removeChildView(removed.view) } catch { /* ignore */ }
    try { removed.view.webContents.close() } catch { /* ignore */ }

    // If we removed the active tab, activate its neighbor (prefer the one to the left)
    if (idx === this.activeIndex) {
      this.activeIndex = Math.max(0, idx - 1)
      const newActive = this.tabs[this.activeIndex]
      newActive.view.setBounds(this.currentBounds)
      this.emitState()
      try {
        await this.cdp.attach(newActive.view.webContents)
      } catch (err) {
        console.warn('[BrowserManager] CDP attach failed on closeTab:', err)
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
      isActive: i === this.activeIndex
    }))
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<{ ok: boolean; url: string; title: string }> {
    const view = this.activeView()
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
    const wc = this.activeView().webContents
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(): void {
    const wc = this.activeView().webContents
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(): void {
    this.activeView().webContents.reload()
  }

  // ── Find-in-page (ENH-028) ────────────────────────────────────────────────
  // Wraps Electron's `webContents.findInPage` for the active tab. Each
  // keystroke from the find-bar resends START with the new query;
  // ⌘G / ⌘⇧G resend with `findNext: true` + a forward flag. Match
  // counts arrive via the `found-in-page` event wired in addTab →
  // wireEvents (search "ENH-028 found-in-page wiring").

  findInPage(query: string, options?: { findNext?: boolean; forward?: boolean }): void {
    if (!query) return
    const wc = this.activeView().webContents
    wc.findInPage(query, {
      findNext: options?.findNext,
      forward: options?.forward !== false
    })
  }

  stopFindInPage(): void {
    const wc = this.activeView().webContents
    // 'clearSelection' drops the find highlight without leaving the
    // last-found range selected (which would interfere with the next
    // user keystroke / Send → Duo selection).
    wc.stopFindInPage('clearSelection')
  }

  getActiveUrl(): string {
    return this.activeView().webContents.getURL() || 'about:blank'
  }

  getActiveTitle(): string {
    return this.activeView().webContents.getTitle() || ''
  }

  // ── External-domain routing (BUG-040) ─────────────────────────────────────
  // Consult the user's external-domains.json. If `url`'s host matches
  // a blocklist entry, route through shell.openExternal and push the
  // post-redirect banner. Returns true when routed (caller should
  // preventDefault on the underlying navigation). Returns false when
  // either no service is wired or the host doesn't match.

  private routeOffHostIfMatched(url: string): boolean {
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
    this.activeView().webContents.focus()
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────

  setBounds(bounds: BrowserBounds): void {
    this.currentBounds = bounds
    if (this.tabs.length > 0 && !this.mutedForOverlay) {
      this.tabs[this.activeIndex].view.setBounds(bounds)
    }
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
    if (muted) {
      this.tabs[this.activeIndex].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    } else {
      this.tabs[this.activeIndex].view.setBounds(this.currentBounds)
    }
  }

  // ── Attach CDP after first bounds are known ────────────────────────────────

  async attachCdp(): Promise<void> {
    if (this.tabs.length > 0) {
      await this.cdp.attach(this.tabs[this.activeIndex].view.webContents)
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

  private activeView(): WebContentsView {
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
      const key = input.key.toLowerCase()

      // ⌃Tab / ⌃⇧Tab cycle browser tabs. Handled in the renderer, but
      // Chromium would consume the Tab key inside the page otherwise.
      if (input.control && key === 'tab') {
        event.preventDefault()
        this.window.webContents.send(IPC.BROWSER_KEY_FORWARD, {
          key: input.key,
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
      const needsRendererFocus = key === 't' || key === 'n' || key === 'l' || key === 'f'
      if (needsRendererFocus) {
        this.window.webContents.focus()
      }

      this.window.webContents.send(IPC.BROWSER_KEY_FORWARD, {
        key: input.key,
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
      this.window.webContents.send(IPC.BROWSER_FOCUS_GAINED)
    })
  }

  getState(): BrowserState {
    const wc = this.activeView().webContents
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
