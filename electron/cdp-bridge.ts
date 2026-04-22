// Stage 3: CDP command executor via Electron's built-in webContents.debugger.
// No external Chrome DevTools connection needed — Electron owns the renderer.

import * as fs from 'fs'
import * as path from 'path'
import type { WebContents } from 'electron'

export class CdpBridge {
  private wc: WebContents | null = null

  async attach(webContents: WebContents): Promise<void> {
    if (this.wc && this.wc !== webContents) {
      try { this.wc.debugger.detach() } catch { /* already detached */ }
    }
    this.wc = webContents
    if (!webContents.debugger.isAttached()) {
      webContents.debugger.attach('1.3')
    }
    await webContents.debugger.sendCommand('Page.enable')
    await webContents.debugger.sendCommand('Runtime.enable')
  }

  detach(): void {
    if (this.wc?.debugger.isAttached()) {
      try { this.wc.debugger.detach() } catch { /* ignore */ }
    }
    this.wc = null
  }

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

  // Saves a screenshot to disk and returns the absolute path written.
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

  private dbg(): Electron.Debugger {
    if (!this.wc) throw new Error('CdpBridge: not attached to any WebContents')
    return this.wc.debugger
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
