// Stage 2: WebContentsView lifecycle, tab management, SSO session persistence.
//
// One WebContentsView per logical browser tab. All views are added to
// window.contentView; only the active view has real bounds. Inactive views are
// shrunk to 1×1 so they don't intercept events or render visibly.
//
// SSO persistence: every view uses the BROWSER_SESSION_PARTITION ('persist:duo-browser'),
// so cookies / localStorage survive app restarts.

import { WebContentsView, session } from 'electron'
import type { BrowserWindow } from 'electron'
import type { BrowserTab, BrowserState, BrowserBounds } from '../shared/types'
import { BROWSER_SESSION_PARTITION } from '../shared/constants'
import type { CdpBridge } from './cdp-bridge'

type StateCallback = (state: BrowserState) => void

interface TabEntry {
  view: WebContentsView
  id: number          // stable 1-based ID shown to CLI/user
}

export class BrowserManager {
  private window: BrowserWindow
  private cdp: CdpBridge
  private onStateChange: StateCallback
  private tabs: TabEntry[] = []
  private activeIndex = 0
  private nextId = 1
  private currentBounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 }

  constructor(window: BrowserWindow, cdp: CdpBridge, onStateChange: StateCallback) {
    this.window = window
    this.cdp = cdp
    this.onStateChange = onStateChange
    this.addTab()  // open the first tab
  }

  // ── Tab management ─────────────────────────────────────────────────────────

  addTab(url = 'about:blank'): TabEntry {
    const ses = session.fromPartition(BROWSER_SESSION_PARTITION)
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        // Allow Google Docs and other apps that use popups to stay in-view
        nativeWindowOpen: false
      }
    })

    // Redirect popup windows back into the same view
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      view.webContents.loadURL(popupUrl).catch(() => null)
      return { action: 'deny' }
    })

    const entry: TabEntry = { view, id: this.nextId++ }
    this.tabs.push(entry)
    this.window.contentView.addChildView(view)

    // Park off-screen until activated
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    this.wireEvents(view)

    if (url !== 'about:blank') {
      view.webContents.loadURL(url).catch(() => null)
    }

    return entry
  }

  async switchTab(n: number): Promise<{ ok: boolean; error?: string }> {
    const idx = this.tabs.findIndex(t => t.id === n)
    if (idx === -1) return { ok: false, error: `No tab with id ${n}` }
    if (idx === this.activeIndex) return { ok: true }

    // Shrink current active view
    this.tabs[this.activeIndex].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })

    this.activeIndex = idx
    this.tabs[idx].view.setBounds(this.currentBounds)

    // Reattach debugger to new active webContents
    await this.cdp.attach(this.tabs[idx].view.webContents)
    this.emitState()
    return { ok: true }
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
    await view.webContents.loadURL(url)
    return {
      ok: true,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle()
    }
  }

  goBack(): void {
    const wc = this.activeView().webContents
    if (wc.canGoBack()) wc.goBack()
  }

  goForward(): void {
    const wc = this.activeView().webContents
    if (wc.canGoForward()) wc.goForward()
  }

  reload(): void {
    this.activeView().webContents.reload()
  }

  getActiveUrl(): string {
    return this.activeView().webContents.getURL() || 'about:blank'
  }

  getActiveTitle(): string {
    return this.activeView().webContents.getTitle() || ''
  }

  // ── Bounds ─────────────────────────────────────────────────────────────────

  setBounds(bounds: BrowserBounds): void {
    this.currentBounds = bounds
    if (this.tabs.length > 0) {
      this.tabs[this.activeIndex].view.setBounds(bounds)
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
      // Only emit if this is the active tab
      if (this.tabs[this.activeIndex]?.view === view) this.emitState()
    }
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
  }

  private emitState(): void {
    const wc = this.activeView().webContents
    const state: BrowserState = {
      url: wc.getURL() || 'about:blank',
      title: wc.getTitle() || '',
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      isLoading: wc.isLoading()
    }
    this.onStateChange(state)
  }
}
