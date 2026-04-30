// Issue #27 / Stage 21c Phase 3 — browser history persistence for
// URL-bar autocomplete.
//
// Storage: ~/.claude/duo/browser-history.json. Atomic-write-rename
// pattern (matches pins-service.ts / nav-pins-service.ts / session-
// state-service.ts). Capped at HISTORY_CAP entries; LRU by lastVisited.
// Records {url, title, lastVisited, visitCount}.
//
// `suggest(prefix)` returns matches sorted by recency × frequency for
// the address bar to render. v1 ranks by `score = visitCount /
// (1 + ageHours)` — a Wilson-style proxy that favors recent + repeated
// visits. Matches: substring fold-case match against url + title.
//
// Privacy: about:blank, file:// URLs from system reference HTMLs
// (~/.claude/duo/help/*), and the boot landing FAQ are skipped — no
// signal worth caching, and surfacing them in autocomplete would be
// noise.

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

const HISTORY_DIR = path.join(os.homedir(), '.claude', 'duo')
const HISTORY_PATH = path.join(HISTORY_DIR, 'browser-history.json')
const HISTORY_CAP = 1000
const SCHEMA_VERSION = 1

export interface HistoryEntry {
  url: string
  title: string
  lastVisited: number    // epoch ms
  visitCount: number
}

interface HistoryFile {
  version: number
  entries: HistoryEntry[]
}

// URLs that should never be recorded — pure UI scaffolding, no value
// in autocomplete suggestions.
const SKIP_URL_PATTERNS: RegExp[] = [
  /^about:blank$/i,
  /^about:/i,
  /^chrome:/i,
  /^devtools:/i,
  /\/\.claude\/duo\/help\//,  // bundled FAQ + help pages
]

function shouldSkipUrl(url: string): boolean {
  if (!url) return true
  return SKIP_URL_PATTERNS.some(re => re.test(url))
}

export class BrowserHistoryService {
  private entries: HistoryEntry[] = []
  private loaded = false
  private writeTimer: NodeJS.Timeout | null = null

  /** Lazy-load on first access. Best-effort: a corrupt file returns
   *  an empty list rather than throwing. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fs.readFile(HISTORY_PATH, 'utf8')
      const parsed = JSON.parse(raw) as Partial<HistoryFile>
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries.filter(
          (e): e is HistoryEntry =>
            !!e && typeof e.url === 'string' && typeof e.title === 'string' &&
            typeof e.lastVisited === 'number' && typeof e.visitCount === 'number'
        )
      }
    } catch {
      // missing or corrupt → start empty
    }
    this.loaded = true
  }

  /** Record a navigation. Updates the entry's lastVisited + visitCount
   *  if the URL is already in the list, otherwise appends. Debounced
   *  write so back-to-back navigations don't pummel disk. */
  async record(url: string, title: string): Promise<void> {
    if (shouldSkipUrl(url)) return
    await this.ensureLoaded()

    const idx = this.entries.findIndex(e => e.url === url)
    if (idx >= 0) {
      const existing = this.entries[idx]
      existing.lastVisited = Date.now()
      existing.visitCount += 1
      // Update title if it improved (was empty or url-like before).
      if (title && (!existing.title || existing.title === existing.url)) {
        existing.title = title
      }
    } else {
      this.entries.push({
        url,
        title: title || url,
        lastVisited: Date.now(),
        visitCount: 1
      })
    }

    // LRU cap — drop oldest by lastVisited when over capacity.
    if (this.entries.length > HISTORY_CAP) {
      this.entries.sort((a, b) => b.lastVisited - a.lastVisited)
      this.entries = this.entries.slice(0, HISTORY_CAP)
    }

    this.scheduleWrite()
  }

  /** Suggestions for the address bar. Matches `prefix` (case-fold,
   *  substring) against url + title. Sorted by score (visitCount over
   *  age-in-hours), capped at `limit`. Empty prefix returns top
   *  recently-visited entries. */
  async suggest(prefix: string, limit = 8): Promise<HistoryEntry[]> {
    await this.ensureLoaded()
    const q = prefix.trim().toLowerCase()
    const candidates = q
      ? this.entries.filter(e =>
          e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)
        )
      : this.entries
    const now = Date.now()
    const ranked = candidates
      .map(e => ({ e, score: e.visitCount / (1 + (now - e.lastVisited) / 3600_000) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ e }) => e)
    return ranked
  }

  /** Force-flush any pending write. Called on app quit. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    await this.write()
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.write()
    }, 500)
  }

  private async write(): Promise<void> {
    try {
      await fs.mkdir(HISTORY_DIR, { recursive: true })
      const file: HistoryFile = { version: SCHEMA_VERSION, entries: this.entries }
      const tmp = HISTORY_PATH + '.duo.tmp'
      await fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n')
      await fs.rename(tmp, HISTORY_PATH)
    } catch (err) {
      console.warn('[browser-history] write failed:', (err as Error)?.message ?? err)
    }
  }
}
