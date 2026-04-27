// GitHub Releases update checker (v0.4.0).
//
// Asks `https://api.github.com/repos/dudgeon/duo/releases/latest` for
// the newest published release, compares its tag to the running
// `app.getVersion()` via semver, and caches the result so the
// renderer can surface a "v0.X.Y available" banner without a hot
// path to GitHub on every render.
//
// Why main-side, not renderer-side: the GitHub API has anonymous
// rate limits (60 req/hr/IP); doing this once per boot from main is
// safer than a renderer-driven fetch that could fire repeatedly on
// HMR / re-mounts. Main also has the right home for the durable
// cache file (`~/.claude/duo/update-check.json`).
//
// Failure mode: any error (offline, GitHub 5xx, JSON parse problem)
// is non-fatal — we just don't render the banner. The user is no
// worse off than today (where the banner doesn't exist at all).
//
// Pattern: fetch on every Duo launch, but only re-fetch over the
// network if the cached result is older than `CHECK_INTERVAL_MS`
// (default 6h). The cache is keyed by Duo's running version so a
// freshly-installed-from-GitHub upgrade invalidates the cache.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'

const CACHE_PATH = path.join(os.homedir(), '.claude', 'duo', 'update-check.json')
const RELEASES_LATEST_URL = 'https://api.github.com/repos/dudgeon/duo/releases/latest'
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface CachedCheck {
  /** ISO timestamp of the last successful network fetch. */
  fetchedAt: string
  /** Duo's `app.getVersion()` when the cache was written. Used to
   *  invalidate the cache on app upgrade — a stale "v0.3.0 available"
   *  banner would be embarrassing if the user already upgraded. */
  runningVersion: string
  /** The latest tag on GitHub (e.g. `v0.4.0`). Empty when unknown. */
  latestTag: string
  /** Browser URL of the release page. */
  releaseUrl: string
}

export interface UpdateCheckResult {
  /** Duo's running version (`app.getVersion()`). */
  current: string
  /** Latest tag on GitHub Releases, with the `v` prefix stripped, or
   *  null if the check hasn't completed / failed. */
  latest: string | null
  /** True when `latest` is parseable as semver AND strictly greater
   *  than `current`. */
  updateAvailable: boolean
  /** Browser URL of the release page (e.g. for the renderer's
   *  banner-link target). Null when unknown. */
  releaseUrl: string | null
  /** ISO timestamp of the last successful fetch. Null when the
   *  cache is empty. */
  lastChecked: string | null
}

export class UpdateChecker {
  private cache: CachedCheck | null = null
  private inFlight: Promise<void> | null = null

  /** Read the cache from disk. Best-effort — invalid JSON / missing
   *  file just leaves the cache empty. */
  async loadCache(): Promise<void> {
    try {
      const raw = await fs.readFile(CACHE_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<CachedCheck>
      if (
        typeof parsed.fetchedAt === 'string' &&
        typeof parsed.runningVersion === 'string' &&
        typeof parsed.latestTag === 'string' &&
        typeof parsed.releaseUrl === 'string'
      ) {
        // Invalidate the cache if the running version no longer
        // matches what was cached — running an upgraded build
        // shouldn't surface a "stale upgrade" banner.
        if (parsed.runningVersion === app.getVersion()) {
          this.cache = parsed as CachedCheck
        }
      }
    } catch {
      // No cache or corrupt — fine, leave this.cache = null.
    }
  }

  /** Fetch from GitHub. Single in-flight at a time; concurrent calls
   *  await the same promise. Errors are swallowed — the caller gets
   *  whatever's in the cache (possibly nothing). */
  async fetchOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight
    this.inFlight = (async () => {
      try {
        const res = await fetch(RELEASES_LATEST_URL, {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': `Duo/${app.getVersion()}`
          },
          // Hard timeout — don't block boot on a flaky network.
          signal: AbortSignal.timeout(10_000)
        })
        if (!res.ok) return
        const json = await res.json() as { tag_name?: string; html_url?: string }
        if (typeof json.tag_name !== 'string') return
        const next: CachedCheck = {
          fetchedAt: new Date().toISOString(),
          runningVersion: app.getVersion(),
          latestTag: json.tag_name,
          releaseUrl: typeof json.html_url === 'string' ? json.html_url : ''
        }
        this.cache = next
        // Best-effort write — don't surface failures to the caller.
        try {
          await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true })
          await fs.writeFile(CACHE_PATH, JSON.stringify(next, null, 2) + '\n')
        } catch { /* ignore */ }
      } catch {
        // Network error / timeout / parse fail — stay silent.
      } finally {
        this.inFlight = null
      }
    })()
    return this.inFlight
  }

  /** Decide whether to refresh from network and return the latest
   *  available result. Refreshes if:
   *    - cache is empty, OR
   *    - cached entry is older than CHECK_INTERVAL_MS
   */
  async maybeRefresh(): Promise<UpdateCheckResult> {
    const stale = !this.cache ||
      (Date.now() - new Date(this.cache.fetchedAt).getTime() > CHECK_INTERVAL_MS)
    if (stale) await this.fetchOnce()
    return this.snapshot()
  }

  /** Return the current cached snapshot without a network fetch. */
  snapshot(): UpdateCheckResult {
    const current = app.getVersion()
    if (!this.cache) {
      return {
        current,
        latest: null,
        updateAvailable: false,
        releaseUrl: null,
        lastChecked: null
      }
    }
    const latest = this.cache.latestTag.replace(/^v/, '')
    return {
      current,
      latest,
      updateAvailable: isNewer(latest, current),
      releaseUrl: this.cache.releaseUrl || null,
      lastChecked: this.cache.fetchedAt
    }
  }
}

/**
 * Strict-semver-style comparison: split on dots, compare each
 * component numerically. Returns true if `a > b`. Ignores any
 * pre-release / build suffix (`v0.4.0-beta.1` is treated the same
 * as `v0.4.0` for "is there a newer one?" purposes — pre-releases
 * shouldn't trigger upgrade banners anyway, but this keeps the
 * code small).
 */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('-')[0].split('.').map(n => parseInt(n, 10))
  const pb = b.split('-')[0].split('.').map(n => parseInt(n, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const va = Number.isFinite(pa[i]) ? pa[i] : 0
    const vb = Number.isFinite(pb[i]) ? pb[i] : 0
    if (va > vb) return true
    if (va < vb) return false
  }
  return false
}
