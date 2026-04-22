// Stage 3: CDP command executor
//
// Uses Electron's built-in webContents.debugger API — no external Chrome
// DevTools connection required. Commands map directly to the orbit CLI surface.

import type { WebContents } from 'electron'

export class CdpBridge {
  private debugger: Electron.Debugger | null = null

  async attach(webContents: WebContents): Promise<void> {
    // TODO Stage 3: attach debugger, enable CDP domains
    this.debugger = webContents.debugger
  }

  async navigate(url: string): Promise<{ ok: boolean; url: string; title: string }> {
    this.requireAttached()
    throw new Error('CdpBridge.navigate not yet implemented (Stage 3)')
  }

  async getDOM(): Promise<string> {
    this.requireAttached()
    throw new Error('CdpBridge.getDOM not yet implemented (Stage 3)')
  }

  async getText(selector?: string): Promise<string> {
    this.requireAttached()
    throw new Error('CdpBridge.getText not yet implemented (Stage 3)')
  }

  async click(selector: string): Promise<{ ok: boolean; error?: string }> {
    this.requireAttached()
    throw new Error('CdpBridge.click not yet implemented (Stage 3)')
  }

  async fill(selector: string, value: string): Promise<{ ok: boolean; error?: string }> {
    this.requireAttached()
    throw new Error('CdpBridge.fill not yet implemented (Stage 3)')
  }

  async evalJS(js: string): Promise<unknown> {
    this.requireAttached()
    throw new Error('CdpBridge.evalJS not yet implemented (Stage 3)')
  }

  async screenshot(outputPath?: string, selector?: string): Promise<string> {
    this.requireAttached()
    throw new Error('CdpBridge.screenshot not yet implemented (Stage 3)')
  }

  async waitForSelector(selector: string, timeout = 5000): Promise<{ ok: boolean; error?: string }> {
    this.requireAttached()
    throw new Error('CdpBridge.waitForSelector not yet implemented (Stage 3)')
  }

  detach(): void {
    this.debugger = null
  }

  private requireAttached(): void {
    if (!this.debugger) throw new Error('CdpBridge: debugger not attached')
  }
}
