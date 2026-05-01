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

export interface ExternalDomainsServiceOptions {
  /** Optional override for the on-disk JSON path (testing). */
  filePath?: string
  /** Bundled defaults that bootstrap the file when it's missing OR
   *  when its `domains` array is empty. ENH-021 had the
   *  install-service handle bootstrap+merge, but that path only
   *  fires on user-clicked install. Existing users with a
   *  populated-but-empty `external-domains.json` (e.g. a prior bug
   *  cleared it, or a manual edit) never triggered the merge and
   *  ended up with no off-host routing at all. Passing defaults
   *  here lets the runtime self-heal at every boot — independent
   *  of the install banner state. */
  defaults?: readonly string[]
}

export class ExternalDomainsService {
  private filePath: string
  private defaults: readonly string[]
  private entries: ExternalDomainEntry[] = []
  private loaded = false
  private watcher: FSWatcher | null = null
  private reloadTimer: NodeJS.Timeout | null = null

  constructor(opts: ExternalDomainsServiceOptions | string = {}) {
    // Backwards-compat: callers in tests pass a path string directly.
    if (typeof opts === 'string') {
      this.filePath = opts
      this.defaults = []
    } else {
      this.filePath = opts.filePath ?? DEFAULT_FILE_PATH
      this.defaults = opts.defaults ?? []
    }
  }

  /** Load the file once. Idempotent — subsequent calls reload.
   *
   *  Self-heal contract (ENH-021 v2 · 2026-04-30): when the file is
   *  missing OR parses to an empty `domains` array AND we have
   *  bundled defaults, write the defaults to disk and reload. This
   *  closes the gap where existing users had a populated-but-empty
   *  file that the install-service's merge path never saw (because
   *  it only fires on user-clicked install, not at every boot). */
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

      // Self-heal: empty array + defaults available → write defaults.
      if (this.entries.length === 0 && this.defaults.length > 0) {
        await this.bootstrapFromDefaults()
      }
    } catch {
      // File missing or malformed.
      this.entries = []
      this.loaded = true
      // Self-heal: write bundled defaults if available. Malformed-JSON
      // case: we'd rather overwrite a malformed file than leave the
      // user's blocklist permanently broken. (The install-service's
      // additive-merge path explicitly preserves malformed files; this
      // runtime path takes the opposite stance because the user
      // experience of "domain bouncing silently broken forever" is
      // worse than overwriting a file that's already non-functional.)
      if (this.defaults.length > 0) {
        await this.bootstrapFromDefaults()
      }
    }
  }

  private async bootstrapFromDefaults(): Promise<void> {
    try {
      const payload = JSON.stringify({ domains: this.defaults }, null, 2) + '\n'
      // Ensure the parent dir exists. mkdir is recursive + idempotent.
      const dir = path.dirname(this.filePath)
      await fsPromises.mkdir(dir, { recursive: true })
      await fsPromises.writeFile(this.filePath, payload)
      // Re-read so `entries` reflects the just-written file.
      const raw = await fsPromises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as { domains?: string[] }
      this.entries = (parsed.domains ?? []).map(host => ({ host }))
    } catch {
      // Couldn't write (permissions, disk full, etc.). entries
      // stays as the empty list; routing is degraded but the app
      // doesn't crash. The next boot will retry.
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
