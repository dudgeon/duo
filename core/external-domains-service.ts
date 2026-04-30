// BUG-040 (v0.5.3) — External-domain routing service.
//
// Until v0.5.3, `~/.claude/duo/external-domains.json` was an
// **agent-only** convention: the duo subagent read the file from
// `priming.md` instructions and chose `duo external <url>` (which
// routes through `shell.openExternal`) for off-host targets, while
// `duo navigate <url>` always loaded into the embedded browser. The
// human user typing a URL into the address bar bypassed the file
// entirely — the BrowserManager called `webContents.loadURL` directly
// with no domain check.
//
// This service centralises the load + cache + match logic so the
// BrowserManager can intercept user-driven navigations
// (`will-navigate` + `setWindowOpenHandler` + the initial `addTab`
// load) and route off-host hosts through `shell.openExternal` the
// same way the agent does. The agent path (`openExternalUrl` in
// `electron/main.ts`) reuses the same matcher for the post-redirect
// banner reason lookup.
//
// Schema accepted (backward-compatible since Stage 25):
//   { "domains": [
//       "host.com",                        // exact
//       "*.suffix.com",                    // wildcard (matches both
//                                          //   `suffix.com` AND any
//                                          //   `*.suffix.com` subdomain)
//       { "host": "host.com", "reason": "internal SSO" }
//     ] }
//
// File missing or malformed → empty list (no routing). The user can
// always `rm ~/.claude/duo/external-domains.json && relaunch` to
// re-bootstrap from the install service's bundled defaults.

import { promises as fsPromises, watch as fsWatch, FSWatcher } from 'fs'
import { homedir } from 'os'
import path from 'path'

export interface ExternalDomainEntry {
  host: string
  reason?: string
}

export interface ExternalDomainMatch {
  matched: boolean
  pattern?: string
  reason?: string
}

const DEFAULT_FILE_PATH = path.join(homedir(), '.claude', 'duo', 'external-domains.json')

export class ExternalDomainsService {
  private filePath: string
  private entries: ExternalDomainEntry[] = []
  private loaded = false
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | null = null

  constructor(filePath: string = DEFAULT_FILE_PATH) {
    this.filePath = filePath
  }

  /** Load the file once. Idempotent — subsequent calls reload. */
  async load(): Promise<void> {
    try {
      const raw = await fsPromises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as { domains?: Array<string | { host?: string; reason?: string }> }
      const list = Array.isArray(parsed.domains) ? parsed.domains : []
      this.entries = list
        .map((e): ExternalDomainEntry | null => {
          if (typeof e === 'string') return { host: e }
          if (e && typeof e.host === 'string') return { host: e.host, reason: typeof e.reason === 'string' ? e.reason : undefined }
          return null
        })
        .filter((e): e is ExternalDomainEntry => e !== null)
      this.loaded = true
    } catch {
      // Missing or malformed → empty list. Don't fall back to
      // hardcoded defaults here; the install-service is responsible
      // for bootstrapping the file. If it's missing AND the user
      // typed `capitalone.com`, the embedded browser will load it.
      // That's acceptable — re-bootstrap restores routing.
      this.entries = []
      this.loaded = true
    }
  }

  /** Watch the file for changes and reload on edit. Best-effort —
   *  fs.watch is platform-quirky on macOS for atomic-writes. We
   *  debounce 250ms and re-read on any event. */
  watch(): void {
    if (this.watcher) return
    try {
      this.watcher = fsWatch(this.filePath, { persistent: false }, () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => {
          void this.load()
        }, 250)
      })
    } catch {
      // File may not exist yet — install-service creates it on first
      // launch. The BrowserManager calls load() opportunistically
      // and we'll start watching after the first successful load.
    }
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = null
    if (this.watcher) {
      try { this.watcher.close() } catch { /* ignore */ }
      this.watcher = null
    }
  }

  /** Match a hostname against the loaded patterns. Returns the first
   *  matching entry's pattern + reason. */
  match(host: string): ExternalDomainMatch {
    if (!this.loaded || !host) return { matched: false }
    for (const entry of this.entries) {
      if (matchesDomain(host, entry.host)) {
        return { matched: true, pattern: entry.host, reason: entry.reason }
      }
    }
    return { matched: false }
  }

  /** Convenience: parse a URL and route the match. Refuses non-http
   *  schemes (file://, javascript:, data:, etc.) — those should NEVER
   *  be routed externally even if their host happens to match. */
  matchUrl(url: string): ExternalDomainMatch {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { matched: false }
    }
    const scheme = parsed.protocol.toLowerCase()
    if (scheme !== 'http:' && scheme !== 'https:') return { matched: false }
    return this.match(parsed.hostname)
  }

  /** Test seam — current entries. */
  getEntries(): readonly ExternalDomainEntry[] {
    return this.entries
  }
}

/** Standalone matcher — used both by the service and by tests. The
 *  `*.suffix` form matches both the bare suffix (`suffix.com`) AND any
 *  subdomain (`a.suffix.com`, `a.b.suffix.com`). The bare-suffix
 *  match is critical for capitalone.com / mail.google.com user
 *  expectations — `*.capitalone.com` SHOULD match `capitalone.com`
 *  itself, not just subdomains. */
export function matchesDomain(host: string, pattern: string): boolean {
  if (!host || !pattern) return false
  if (pattern === host) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    if (host === suffix) return true
    if (host.endsWith(`.${suffix}`)) return true
  }
  return false
}
