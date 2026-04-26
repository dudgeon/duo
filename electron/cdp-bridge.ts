// Stage 3: CDP command executor via Electron's built-in webContents.debugger.
// No external Chrome DevTools connection needed — Electron owns the renderer.

import * as fs from 'fs'
import * as path from 'path'
import type { WebContents, Debugger } from 'electron'
import type {
  ConsoleEntry,
  ConsoleLevel,
  BrowserErrorEntry,
  NetworkEntry,
  BrowserSelectionSnapshot,
  BrowserSelectionPush
} from '../shared/types'

const CONSOLE_RING_SIZE = 500
const ERRORS_RING_SIZE = 200
const NETWORK_RING_SIZE = 300

// Stage 15.2 — page-side observer that emits live selection state via
// `Runtime.addBinding('duoSelectionPush')`. Listens to selectionchange
// + scroll + resize so the pill repositions as the page moves. Has its
// own re-injection guard (`__duoSelectionObserver`) so re-running the
// IIFE on a navigated-away-then-back page is a no-op.
//
// Schema of the JSON payload posted to the binding:
//   null  → selection collapsed / cleared
//   { snapshot: BrowserSelectionSnapshot, rect: BrowserSelectionRect }
//
// Coordinates in `rect` are page-viewport-relative (matches
// `range.getBoundingClientRect()`). The renderer translates them to
// screen space using the WebContentsView's bounds.
const SELECTION_OBSERVER_IIFE = `(function () {
  if (window.__duoSelectionObserver) return;
  window.__duoSelectionObserver = true;
  var lastText = '';
  var timer = null;
  function emit() {
    timer = null;
    var sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (lastText !== '') {
        lastText = '';
        try { window.duoSelectionPush(JSON.stringify(null)); } catch (e) {}
      }
      return;
    }
    var text = String(sel.toString());
    if (!text) {
      if (lastText !== '') {
        lastText = '';
        try { window.duoSelectionPush(JSON.stringify(null)); } catch (e) {}
      }
      return;
    }
    var range = sel.getRangeAt(0);
    var r = range.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    var focus = sel.focusNode || range.commonAncestorContainer;
    if (focus && focus.nodeType === 3) focus = focus.parentNode;
    var block = focus;
    while (block && block !== document.body && block.nodeType === 1) {
      var cs = window.getComputedStyle(block);
      if (cs.display === 'block' || cs.display === 'list-item' ||
          cs.display === 'flex' || cs.display === 'grid' ||
          cs.display === 'table' || cs.display === 'table-cell') break;
      block = block.parentNode;
    }
    var surrounding = '';
    if (block && block.innerText) surrounding = String(block.innerText).slice(0, 1000);
    function selectorFor(el) {
      if (!el || el.nodeType !== 1) return '';
      var parts = [];
      var cur = el;
      while (cur && cur.nodeType === 1 && cur !== document.body) {
        var s = cur.tagName.toLowerCase();
        if (cur.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(cur.id)) {
          s += '#' + cur.id;
          parts.unshift(s);
          break;
        }
        var parent = cur.parentNode;
        if (parent && parent.children) {
          var idx = Array.prototype.indexOf.call(parent.children, cur) + 1;
          if (idx > 0) s += ':nth-child(' + idx + ')';
        }
        parts.unshift(s);
        cur = cur.parentNode;
      }
      return parts.join(' > ');
    }
    lastText = text;
    try {
      window.duoSelectionPush(JSON.stringify({
        snapshot: {
          url: location.href,
          text: text,
          surrounding: surrounding,
          selector_path: selectorFor(focus)
        },
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }
      }));
    } catch (e) {}
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(emit, 60);
  }
  document.addEventListener('selectionchange', schedule, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
})();`

export class CdpBridge {
  private wc: WebContents | null = null
  private consoleRing: ConsoleEntry[] = []
  private errorsRing: BrowserErrorEntry[] = []
  private networkRing: NetworkEntry[] = []
  // Lifecycle staging for in-flight requests, keyed by CDP requestId.
  // Drained into networkRing on loadingFinished/loadingFailed, or dropped
  // on tab switch (see attach()).
  private networkInFlight = new Map<string, NetworkEntry>()
  private consoleListenerBound = false

  // Stage 15.2 — latest live selection state from the page-side
  // observer, plus a single subscriber callback (BrowserManager forwards
  // to the renderer via IPC). Reset on tab switch so the renderer
  // doesn't show a stale pill.
  private latestBrowserSelection: BrowserSelectionPush = { snapshot: null, rect: null }
  private browserSelectionListener: ((push: BrowserSelectionPush) => void) | null = null

  /** Stage 15.2 — register a single subscriber for live browser-
   *  selection pushes. BrowserManager calls this once on construction
   *  to forward pushes to the renderer over IPC. */
  onBrowserSelection(cb: (push: BrowserSelectionPush) => void): void {
    this.browserSelectionListener = cb
  }

  /** Stage 15.2 — emit the current selection state to whoever is
   *  listening. Cheap; called from the binding handler and from
   *  injectSelectionObserver after a page nav (to clear the pill). */
  private emitBrowserSelection(push: BrowserSelectionPush): void {
    this.latestBrowserSelection = push
    this.browserSelectionListener?.(push)
  }

  /** Stage 15.2 — inject (or re-inject) the page-side observer IIFE
   *  into the active page's main world. Idempotent thanks to the
   *  IIFE's `__duoSelectionObserver` guard. */
  private async injectSelectionObserver(): Promise<void> {
    try {
      await this.dbg().sendCommand('Runtime.evaluate', {
        expression: SELECTION_OBSERVER_IIFE,
        // Synchronous — the IIFE is fast and we don't need its return
        // value; awaiting just guarantees the observer is bound before
        // a downstream selectionchange fires.
        returnByValue: true,
        awaitPromise: false
      })
    } catch (err) {
      // Soft-fail: the observer is a UX nicety, not a correctness
      // primitive. `duo selection` (request-response) keeps working
      // either way. Log + move on.
      console.warn('[CdpBridge] selection observer inject failed:', (err as Error).message)
    }
  }

  async attach(webContents: WebContents): Promise<void> {
    if (this.wc && this.wc !== webContents) {
      try { this.wc.debugger.detach() } catch { /* already detached */ }
    }
    this.wc = webContents
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
    }

    // Subscribe to CDP events exactly once per attach — the listener is
    // re-bound on every reattach because debugger messages route to whoever
    // currently holds the attachment.
    webContents.debugger.removeAllListeners('message')
    webContents.debugger.on('message', (_event, method, params) => {
      this.handleCdpEvent(method, params)
    })
    this.consoleListenerBound = true

    // Tab-switching re-attaches against a new WebContents; drop in-flight
    // network entries from the prior tab so they don't sit forever as
    // pending. The completed ring is preserved across tabs intentionally
    // so the agent's history survives navigation.
    this.networkInFlight.clear()

    await webContents.debugger.sendCommand('Page.enable')
    await webContents.debugger.sendCommand('Runtime.enable')
    await webContents.debugger.sendCommand('Log.enable')
    // DOM + Accessibility are prerequisites for resolving selectors and
    // scoped AX subtree queries.
    await webContents.debugger.sendCommand('DOM.enable')
    await webContents.debugger.sendCommand('Accessibility.enable')
    // Network domain — drives `duo network`.
    await webContents.debugger.sendCommand('Network.enable')
    // Stage 15.2 — register the selection-observer binding. The page-
    // side IIFE calls `window.duoSelectionPush(json)` on selection
    // change; that surfaces here as a `Runtime.bindingCalled` event
    // (handled below). Re-registering on every attach is harmless.
    try {
      await webContents.debugger.sendCommand('Runtime.addBinding', {
        name: 'duoSelectionPush'
      })
    } catch (err) {
      // Older Chromium versions named this differently in pathological
      // cases; we tolerate failure here so console / network / etc.
      // still work even when the binding can't be installed.
      console.warn('[CdpBridge] Runtime.addBinding(duoSelectionPush) failed:', (err as Error).message)
    }
    // Tab switch resets the pill — the new tab's selection state is
    // unknown until its observer reports.
    this.emitBrowserSelection({ snapshot: null, rect: null })
    // Inject the observer for the current document. Page.frameNavigated
    // re-injects on subsequent navigations.
    await this.injectSelectionObserver()
  }

  detach(): void {
    if (this.wc?.debugger.isAttached()) {
      try { this.wc.debugger.detach() } catch { /* ignore */ }
    }
    this.wc = null
    this.consoleListenerBound = false
    this.networkInFlight.clear()
  }

  // ── Read primitives ────────────────────────────────────────────────────────

  async getDOM(): Promise<string> {
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true
    })
    return result.result.value as string
  }

  async getText(selector?: string): Promise<string> {
    const expression = selector
      ? `(function(){const el=document.querySelector(${JSON.stringify(selector)});return el?el.innerText??el.textContent??'':'Element not found: ${selector}'})()`
      : 'document.body.innerText'
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    return result.result.value as string
  }

  // ── Accessibility tree (canvas-rendered apps like Google Docs) ─────────────

  async getAxTree(selector?: string): Promise<AxNode> {
    const dbg = this.dbg()
    let nodes: CdpAxNode[]

    if (selector) {
      // Resolve selector → backendNodeId via DOM.querySelector
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 })
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
        nodeId: root.nodeId,
        selector
      })
      if (!nodeId) throw new Error(`Element not found: ${selector}`)
      const desc = await dbg.sendCommand('DOM.describeNode', { nodeId })
      const backendNodeId = desc.node.backendNodeId
      const res = await dbg.sendCommand('Accessibility.getPartialAXTree', {
        backendNodeId,
        fetchRelatives: true
      })
      nodes = res.nodes
    } else {
      const res = await dbg.sendCommand('Accessibility.getFullAXTree')
      nodes = res.nodes
    }

    return buildAxTree(nodes, selector)
  }

  axToMarkdown(tree: AxNode, opts: { maxDepth?: number } = {}): string {
    const lines: string[] = []
    renderAxMarkdown(tree, lines, 0, opts.maxDepth ?? Infinity)
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  // ── Write primitives ───────────────────────────────────────────────────────

  async click(selector: string): Promise<{ ok: boolean; error?: string }> {
    const expression = `(function(){
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      el.click();
      return { ok: true };
    })()`
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    return result.result.value as { ok: boolean; error?: string }
  }

  async fill(selector: string, value: string): Promise<{ ok: boolean; error?: string }> {
    // Uses native input value setter so React controlled inputs fire onChange
    const expression = `(function(){
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    return result.result.value as { ok: boolean; error?: string }
  }

  async focus(selector: string): Promise<{ ok: boolean; error?: string }> {
    // Route through the page's own focus() rather than CDP DOM.focus so that
    // hidden input proxies used by canvas apps (Kix's texteventtarget) get
    // the delegated focus the same way a real click would deliver it.
    const expression = `(function(){
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
      if (typeof el.focus === 'function') el.focus();
      return { ok: true };
    })()`
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    return result.result.value as { ok: boolean; error?: string }
  }

  async insertText(text: string): Promise<{ ok: boolean }> {
    await this.dbg().sendCommand('Input.insertText', { text })
    return { ok: true }
  }

  async dispatchKey(name: string, modifiers: string[] = []): Promise<{ ok: boolean; error?: string }> {
    const ev = resolveKey(name)
    if (!ev) return { ok: false, error: `Unknown key: ${name}` }
    const modifierBits = modifiers.reduce((acc, m) => acc | modifierBit(m), 0)
    const base = {
      modifiers: modifierBits,
      key: ev.key,
      code: ev.code,
      windowsVirtualKeyCode: ev.keyCode,
      nativeVirtualKeyCode: ev.keyCode,
      ...(ev.text ? { text: ev.text, unmodifiedText: ev.text } : {})
    }
    await this.dbg().sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    if (ev.text) {
      await this.dbg().sendCommand('Input.dispatchKeyEvent', { type: 'char', ...base })
    }
    await this.dbg().sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    return { ok: true }
  }

  async evalJS(js: string): Promise<unknown> {
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? 'JS evaluation error')
    }
    return result.result.value
  }

  async screenshot(selector?: string): Promise<string> {
    let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined

    if (selector) {
      const boundsResult = await this.dbg().sendCommand('Runtime.evaluate', {
        expression: `(function(){
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        })()`,
        returnByValue: true
      })
      const b = boundsResult.result.value as { x: number; y: number; width: number; height: number } | null
      if (b) clip = { ...b, scale: 1 }
    }

    const params: Record<string, unknown> = { format: 'png' }
    if (clip) params['clip'] = clip
    const result = await this.dbg().sendCommand('Page.captureScreenshot', params)
    return result.data as string // base64 PNG
  }

  async screenshotToFile(outputPath: string, selector?: string): Promise<string> {
    const b64 = await this.screenshot(selector)
    const abs = path.resolve(outputPath)
    fs.writeFileSync(abs, Buffer.from(b64, 'base64'))
    return abs
  }

  async waitForSelector(selector: string, timeout = 5000): Promise<{ ok: boolean; error?: string }> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const result = await this.dbg().sendCommand('Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true
      })
      if (result.result.value === true) return { ok: true }
      await sleep(100)
    }
    return { ok: false, error: `Timeout: "${selector}" not found after ${timeout}ms` }
  }

  // ── Console capture ────────────────────────────────────────────────────────

  getConsole(opts: { since?: number; level?: ConsoleLevel[]; limit?: number } = {}): ConsoleEntry[] {
    let entries = this.consoleRing
    if (opts.since !== undefined) entries = entries.filter(e => e.ts >= opts.since!)
    if (opts.level?.length) entries = entries.filter(e => opts.level!.includes(e.level))
    if (opts.limit !== undefined) entries = entries.slice(-opts.limit)
    return entries
  }

  // ── Errors capture (Runtime.exceptionThrown) ───────────────────────────────

  getErrors(opts: { since?: number; limit?: number } = {}): BrowserErrorEntry[] {
    let entries = this.errorsRing
    if (opts.since !== undefined) entries = entries.filter(e => e.ts >= opts.since!)
    if (opts.limit !== undefined) entries = entries.slice(-opts.limit)
    return entries
  }

  // ── Network capture ────────────────────────────────────────────────────────
  // Returns completed entries by default. In-flight entries are surfaced as
  // a separate flag-free copy (no endTs) so the agent can see them too.

  getNetwork(opts: { since?: number; filter?: RegExp; limit?: number } = {}): NetworkEntry[] {
    let entries: NetworkEntry[] = [
      ...this.networkRing,
      ...Array.from(this.networkInFlight.values())
    ]
    if (opts.since !== undefined) entries = entries.filter(e => e.startTs >= opts.since!)
    if (opts.filter) entries = entries.filter(e => opts.filter!.test(e.url))
    // Stable order: by start time so the agent can read the lifecycle
    // top-to-bottom even when in-flight + completed are mixed.
    entries.sort((a, b) => a.startTs - b.startTs)
    if (opts.limit !== undefined) entries = entries.slice(-opts.limit)
    return entries
  }

  // ── Browser selection (Stage 15g unified shape) ────────────────────────────
  // Returns null when there is no non-collapsed selection in the active tab.
  // Canvas apps (Google Docs / Slides / Sheets) don't expose a real DOM
  // selection — agents needing those should keep using `duo ax` and the
  // app-specific Kix selection APIs documented in the skill.

  async getBrowserSelection(): Promise<BrowserSelectionSnapshot | null> {
    const expression = `(function(){
      try {
        const sel = window.getSelection && window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const text = sel.toString();
        if (!text || text.length === 0) return null;
        const range = sel.getRangeAt(0);
        let focus = sel.focusNode || range.commonAncestorContainer;
        if (focus && focus.nodeType === 3) focus = focus.parentNode;
        let block = focus;
        while (block && block !== document.body && block.nodeType === 1) {
          const cs = window.getComputedStyle(block);
          if (cs.display === 'block' || cs.display === 'list-item' ||
              cs.display === 'flex' || cs.display === 'grid' ||
              cs.display === 'table' || cs.display === 'table-cell') break;
          block = block.parentNode;
        }
        let surrounding = '';
        if (block && block.innerText) {
          surrounding = String(block.innerText).slice(0, 1000);
        }
        function selectorFor(el) {
          if (!el || el.nodeType !== 1) return '';
          const parts = [];
          let cur = el;
          while (cur && cur.nodeType === 1 && cur !== document.body) {
            let s = cur.tagName.toLowerCase();
            if (cur.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(cur.id)) {
              s += '#' + cur.id;
              parts.unshift(s);
              break;
            }
            const parent = cur.parentNode;
            if (parent && parent.children) {
              const idx = Array.from(parent.children).indexOf(cur) + 1;
              if (idx > 0) s += ':nth-child(' + idx + ')';
            }
            parts.unshift(s);
            cur = cur.parentNode;
          }
          return parts.join(' > ');
        }
        return {
          url: location.href,
          text: text,
          surrounding: surrounding,
          selector_path: selectorFor(focus)
        };
      } catch (e) { return null; }
    })()`
    const result = await this.dbg().sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true
    })
    const v = result.result.value as Omit<BrowserSelectionSnapshot, 'kind'> | null
    if (!v) return null
    return { kind: 'browser', ...v }
  }

  private handleCdpEvent(method: string, params: unknown): void {
    if (method === 'Runtime.consoleAPICalled') {
      const p = params as CdpConsoleApiParams
      this.pushConsole({
        ts: Date.now(),
        level: consoleApiTypeToLevel(p.type),
        source: 'console',
        text: renderConsoleArgs(p.args),
        url: p.stackTrace?.callFrames?.[0]?.url,
        lineNumber: p.stackTrace?.callFrames?.[0]?.lineNumber
      })
    } else if (method === 'Log.entryAdded') {
      const p = params as CdpLogEntryParams
      this.pushConsole({
        ts: Date.now(),
        level: logEntryLevelToLevel(p.entry.level),
        source: 'log-entry',
        text: p.entry.text,
        url: p.entry.url,
        lineNumber: p.entry.lineNumber
      })
    } else if (method === 'Runtime.exceptionThrown') {
      const p = params as CdpExceptionThrownParams
      const ed = p.exceptionDetails
      const top = ed.stackTrace?.callFrames?.[0]
      this.pushError({
        ts: Date.now(),
        text: ed.exception?.description ?? ed.text ?? 'Unknown exception',
        url: top?.url ?? ed.url,
        lineNumber: top?.lineNumber ?? ed.lineNumber,
        columnNumber: top?.columnNumber ?? ed.columnNumber,
        stack: ed.stackTrace ? formatStackTrace(ed.stackTrace) : undefined
      })
    } else if (method === 'Network.requestWillBeSent') {
      const p = params as CdpRequestWillBeSentParams
      // Ignore navigation redirect chains' synthetic re-emissions: when
      // CDP fires a redirect, requestWillBeSent comes again with the same
      // requestId. Replace the stored entry so the most recent URL wins.
      this.networkInFlight.set(p.requestId, {
        requestId: p.requestId,
        url: p.request.url,
        method: p.request.method,
        resourceType: p.type,
        startTs: Date.now()
      })
    } else if (method === 'Network.responseReceived') {
      const p = params as CdpResponseReceivedParams
      const entry = this.networkInFlight.get(p.requestId)
      if (entry) {
        entry.status = p.response.status
        entry.statusText = p.response.statusText
        entry.mimeType = p.response.mimeType
        if (!entry.resourceType) entry.resourceType = p.type
      }
    } else if (method === 'Network.loadingFinished') {
      const p = params as CdpLoadingFinishedParams
      const entry = this.networkInFlight.get(p.requestId)
      if (entry) {
        entry.endTs = Date.now()
        entry.encodedDataLength = p.encodedDataLength
        this.networkInFlight.delete(p.requestId)
        this.pushNetwork(entry)
      }
    } else if (method === 'Network.loadingFailed') {
      const p = params as CdpLoadingFailedParams
      const entry = this.networkInFlight.get(p.requestId)
      if (entry) {
        entry.endTs = Date.now()
        entry.failed = true
        entry.errorText = p.errorText
        this.networkInFlight.delete(p.requestId)
        this.pushNetwork(entry)
      }
    } else if (method === 'Runtime.bindingCalled') {
      // Stage 15.2 — page-side observer posting a selection snapshot.
      const p = params as { name?: string; payload?: string }
      if (p.name === 'duoSelectionPush') {
        let parsed: BrowserSelectionPush | null = null
        try {
          const body = JSON.parse(p.payload ?? 'null') as
            | null
            | {
                snapshot: Omit<BrowserSelectionSnapshot, 'kind'>
                rect: { x: number; y: number; width: number; height: number }
              }
          if (body === null) {
            parsed = { snapshot: null, rect: null }
          } else {
            parsed = {
              snapshot: { kind: 'browser', ...body.snapshot },
              rect: body.rect
            }
          }
        } catch {
          // Bad payload from the page — drop it silently rather than
          // poisoning the cache.
          return
        }
        if (parsed) this.emitBrowserSelection(parsed)
      }
    } else if (method === 'Page.frameNavigated') {
      // Stage 15.2 — re-inject the observer on top-frame navigation.
      // Subframe nav doesn't carry our observer (we don't read selection
      // out of iframes today). Clearing the cache here also hides the
      // pill while the new page loads.
      const p = params as { frame?: { id: string; parentId?: string } }
      if (p.frame && !p.frame.parentId) {
        this.emitBrowserSelection({ snapshot: null, rect: null })
        // Fire-and-forget: the observer is non-critical UX glue; the
        // injection happens asynchronously after the navigation event
        // returns control to the event loop.
        void this.injectSelectionObserver()
      }
    }
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleRing.push(entry)
    if (this.consoleRing.length > CONSOLE_RING_SIZE) {
      this.consoleRing.splice(0, this.consoleRing.length - CONSOLE_RING_SIZE)
    }
  }

  private pushError(entry: BrowserErrorEntry): void {
    this.errorsRing.push(entry)
    if (this.errorsRing.length > ERRORS_RING_SIZE) {
      this.errorsRing.splice(0, this.errorsRing.length - ERRORS_RING_SIZE)
    }
  }

  private pushNetwork(entry: NetworkEntry): void {
    this.networkRing.push(entry)
    if (this.networkRing.length > NETWORK_RING_SIZE) {
      this.networkRing.splice(0, this.networkRing.length - NETWORK_RING_SIZE)
    }
  }

  private dbg(): Debugger {
    if (!this.wc) throw new Error('CdpBridge: not attached to any WebContents')
    return this.wc.debugger
  }
}

// ── AX tree helpers ──────────────────────────────────────────────────────────

export interface AxNode {
  role: string
  name?: string
  value?: string
  description?: string
  level?: number
  children: AxNode[]
}

interface CdpAxNode {
  nodeId: string
  parentId?: string
  role?: { value: string }
  name?: { value: string }
  value?: { value: string | number | boolean }
  description?: { value: string }
  properties?: Array<{ name: string; value: { value: unknown } }>
  childIds?: string[]
  ignored?: boolean
}

function buildAxTree(nodes: CdpAxNode[], selector?: string): AxNode {
  const byId = new Map<string, CdpAxNode>()
  const childIds = new Set<string>()
  for (const n of nodes) {
    byId.set(n.nodeId, n)
    for (const c of n.childIds ?? []) childIds.add(c)
  }

  // Root of the returned tree is the first node that isn't anyone's child.
  // For getPartialAXTree the tree comes back including ancestors; we want
  // the subtree rooted at the `selector` match if provided.
  let root: CdpAxNode | undefined
  if (selector) {
    // The target node in getPartialAXTree is the one with the selector; but
    // CDP doesn't tag it. Heuristic: the deepest non-ignored node whose
    // parent is outside the returned subtree, or fall back to the first node.
    // In practice getPartialAXTree returns the subtree plus the root chain,
    // so taking the first child of a "generic" ancestor is unreliable. We
    // instead pick the first visible node.
    root = nodes.find(n => !n.ignored) ?? nodes[0]
  } else {
    root = nodes.find(n => !childIds.has(n.nodeId))
  }
  if (!root) return { role: 'empty', children: [] }

  const visibleChildrenOf = (node: CdpAxNode): AxNode[] => {
    const results: AxNode[] = []
    for (const cid of node.childIds ?? []) {
      const child = byId.get(cid)
      if (!child) continue
      if (child.ignored) {
        // Transparent: keep walking down to find visible descendants.
        results.push(...visibleChildrenOf(child))
      } else {
        results.push(walk(child))
      }
    }
    return results
  }

  const walk = (node: CdpAxNode): AxNode => {
    const out: AxNode = {
      role: node.role?.value ?? 'unknown',
      children: []
    }
    if (node.name?.value) out.name = String(node.name.value)
    const rawValue = node.value?.value
    if (rawValue !== undefined && rawValue !== '') out.value = String(rawValue)
    if (node.description?.value) out.description = node.description.value
    const levelProp = node.properties?.find(p => p.name === 'level')
    if (levelProp) out.level = Number(levelProp.value.value)

    out.children = visibleChildrenOf(node)
    return out
  }

  return walk(root)
}

function renderAxMarkdown(node: AxNode, out: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth) return
  const name = node.name?.trim()
  const value = node.value?.trim()

  // `printed` = we emitted the node's accessible name here. In that case we
  // skip descendants because their StaticText would duplicate the same text.
  // If we didn't print (e.g. paragraph with no own name), recurse so the
  // child StaticText gets a chance to render its content.
  let printed = false

  switch (node.role) {
    case 'heading': {
      const level = Math.min(Math.max(node.level ?? 1, 1), 6)
      if (name) { out.push(`${'#'.repeat(level)} ${name}`); printed = true }
      break
    }
    case 'link':
      if (name) { out.push(`[${name}](#)`); printed = true }
      break
    case 'listitem':
      if (name) { out.push(`${'  '.repeat(Math.max(depth - 1, 0))}- ${name}`); printed = true }
      break
    case 'StaticText':
    case 'text':
    case 'paragraph':
      if (name) { out.push(name); printed = true }
      break
    case 'image':
      if (name) { out.push(`![${name}](#)`); printed = true }
      break
    case 'textbox':
    case 'combobox':
      if (value) { out.push(`\`${value}\``); printed = true }
      else if (name) { out.push(`(field: ${name})`); printed = true }
      break
    case 'button':
      if (name) { out.push(`[${name}]`); printed = true }
      break
    case 'checkbox':
    case 'radio':
      if (name) { out.push(`[ ] ${name}`); printed = true }
      break
    case 'separator':
      out.push('\n---\n')
      printed = true
      break
    default:
      // Container/landmark/list roles: no name emission, descendants carry
      // the content.
      break
  }

  if (!printed) {
    for (const child of node.children) {
      renderAxMarkdown(child, out, depth + 1, maxDepth)
    }
  }
}

// ── Key handling ─────────────────────────────────────────────────────────────

interface ResolvedKey {
  key: string
  code: string
  keyCode: number
  text?: string   // printable character, if any
}

const NAMED_KEYS: Record<string, ResolvedKey> = {
  Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13,  text: '\r' },
  Return:     { key: 'Enter',      code: 'Enter',      keyCode: 13,  text: '\r' },
  Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9,   text: '\t' },
  Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8 },
  Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  Esc:        { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  Space:      { key: ' ',          code: 'Space',      keyCode: 32,  text: ' ' },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home:       { key: 'Home',       code: 'Home',       keyCode: 36 },
  End:        { key: 'End',        code: 'End',        keyCode: 35 },
  PageUp:     { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  PageDown:   { key: 'PageDown',   code: 'PageDown',   keyCode: 34 }
}

function resolveKey(name: string): ResolvedKey | null {
  if (NAMED_KEYS[name]) return NAMED_KEYS[name]
  // Case-insensitive named key lookup
  const found = Object.keys(NAMED_KEYS).find(k => k.toLowerCase() === name.toLowerCase())
  if (found) return NAMED_KEYS[found]
  // Single character — letter, digit, or symbol
  if (name.length === 1) {
    const ch = name
    const upper = ch.toUpperCase()
    const code =
      /[A-Z]/.test(upper) ? `Key${upper}` :
      /[0-9]/.test(upper) ? `Digit${upper}` :
      ''
    return {
      key: ch,
      code,
      keyCode: upper.charCodeAt(0),
      text: ch
    }
  }
  return null
}

function modifierBit(name: string): number {
  switch (name.toLowerCase()) {
    case 'alt': case 'option': return 1
    case 'ctrl': case 'control': return 2
    case 'cmd': case 'meta': case 'command': return 4
    case 'shift': return 8
    default: return 0
  }
}

// ── Console helpers ──────────────────────────────────────────────────────────

interface CdpConsoleApiParams {
  type: string
  args: Array<{ type: string; value?: unknown; description?: string }>
  stackTrace?: { callFrames: Array<{ url: string; lineNumber: number }> }
}

interface CdpLogEntryParams {
  entry: {
    level: string
    text: string
    url?: string
    lineNumber?: number
  }
}

function consoleApiTypeToLevel(type: string): ConsoleLevel {
  switch (type) {
    case 'warning': return 'warn'
    case 'error': return 'error'
    case 'info': return 'info'
    case 'debug': return 'debug'
    default: return 'log'
  }
}

function logEntryLevelToLevel(level: string): ConsoleLevel {
  switch (level) {
    case 'warning': return 'warn'
    case 'error': return 'error'
    case 'info': return 'info'
    case 'verbose': return 'verbose'
    default: return 'log'
  }
}

function renderConsoleArgs(args: CdpConsoleApiParams['args']): string {
  return args.map(a => {
    if (a.value !== undefined) {
      if (typeof a.value === 'object' && a.value !== null) return JSON.stringify(a.value)
      return String(a.value)
    }
    return a.description ?? ''
  }).join(' ')
}

// ── Errors / network CDP shapes ──────────────────────────────────────────────

interface CdpStackTrace {
  callFrames: Array<{
    functionName?: string
    url: string
    lineNumber: number
    columnNumber: number
  }>
}

interface CdpExceptionThrownParams {
  exceptionDetails: {
    text?: string
    url?: string
    lineNumber?: number
    columnNumber?: number
    stackTrace?: CdpStackTrace
    exception?: { description?: string }
  }
}

interface CdpRequestWillBeSentParams {
  requestId: string
  request: { url: string; method: string }
  type?: string
}

interface CdpResponseReceivedParams {
  requestId: string
  response: {
    status: number
    statusText: string
    mimeType: string
  }
  type?: string
}

interface CdpLoadingFinishedParams {
  requestId: string
  encodedDataLength: number
}

interface CdpLoadingFailedParams {
  requestId: string
  errorText: string
  canceled?: boolean
}

function formatStackTrace(st: CdpStackTrace): string {
  return st.callFrames
    .map(f => `  at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
    .join('\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
