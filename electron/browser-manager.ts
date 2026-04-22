// Stage 2: WebContentsView lifecycle, tab management, SSO session persistence
//
// Design notes:
//   - One WebContentsView is shared across all terminal tabs (per §8 of brief)
//   - Session partition: BROWSER_SESSION_PARTITION for Google SSO persistence
//   - CDP access happens via webContents.debugger (no external DevTools connection)

import type { BrowserWindow } from 'electron'
import type { BrowserTab } from '../shared/types'

export class BrowserManager {
  private window: BrowserWindow | null = null

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_window: BrowserWindow) {
    // TODO Stage 2: create WebContentsView, attach to window
  }

  navigate(_url: string): Promise<{ ok: boolean; url: string; title: string }> {
    throw new Error('BrowserManager not yet implemented (Stage 2)')
  }

  getUrl(): string {
    throw new Error('BrowserManager not yet implemented (Stage 2)')
  }

  getTitle(): string {
    throw new Error('BrowserManager not yet implemented (Stage 2)')
  }

  getTabs(): BrowserTab[] {
    throw new Error('BrowserManager not yet implemented (Stage 2)')
  }

  dispose(): void {
    this.window = null
  }
}
