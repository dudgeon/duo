// Stage 3: CDP command executor via Electron's built-in webContents.debugger.
// No external Chrome DevTools connection needed — Electron owns the renderer.

import * as fs from 'fs'
import * as path from 'path'
import type { WebContents, Debugger } from 'electron'
import type { ConsoleEntry, ConsoleLevel } from '../shared/types'

const CONSOLE_RING_SIZE = 500

export class CdpBridge {
  private wc: WebContents | null = null
  private consoleRing: ConsoleEntry[] = []
  private consoleListenerBound = false

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

    await webContents.debugger.sendCommand('Page.enable')
    await webContents.debugger.sendCommand('Runtime.enable')
    await webContents.debugger.sendCommand('Log.enable')
    // DOM + Accessibility are prerequisites for resolving selectors and
    // scoped AX subtree queries.
    await webContents.debugger.sendCommand('DOM.enable')
    await webContents.debugger.sendCommand('Accessibility.enable')
  }

  detach(): void {
    if (this.wc?.debugger.isAttached()) {
      try { this.wc.debugger.detach() } catch { /* ignore */ }
    }
    this.wc = null
    this.consoleListenerBound = false
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
    }
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleRing.push(entry)
    if (this.consoleRing.length > CONSOLE_RING_SIZE) {
      this.consoleRing.splice(0, this.consoleRing.length - CONSOLE_RING_SIZE)
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
