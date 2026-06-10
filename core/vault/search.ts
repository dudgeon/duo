// ENH-208 Vault — full-text search (PR1). The CLI twin of the Phase 2
// ⌘⇧F vault-search palette (D22): plain case-insensitive substring over
// note text, returning file-at-line hits. Frontmatter lines are searched
// too (you want to find `status: blocked`). Internal/template/out dirs are
// excluded by the shared walk.

import fs from 'node:fs'
import path from 'node:path'
import { walk } from './parse'
import type { SearchHit } from './types'

/** One cap shared by the CLI verb, the main-process IPC handler, and the
 *  palette (CLI-parity rule: same code path, same arguments). */
export const VAULT_SEARCH_DEFAULT_LIMIT = 200

/** Frontmatter line extent: the index of the CLOSING `---` fence when the
 *  file opens with one, else null. Mirrors splitFrontmatter's regex
 *  (`^---\n…\n---\n?`) in line terms, so docMatchIndex counts exactly what
 *  the editor doc contains (the editor strips frontmatter into a panel). */
function frontmatterEndLine(lines: string[]): number | null {
  if (lines[0] !== '---') return null
  for (let j = 1; j < lines.length; j++) {
    if (lines[j] === '---') return j
  }
  return null
}

/** Non-overlapping occurrence count — the SAME advance rule
 *  (`idx + needle.length`) as the editor's FindHighlight scan, so the
 *  palette's occurrence indices and the editor's jump stay congruent. */
function occurrencesIn(hay: string, needle: string): number {
  let n = 0
  let idx = hay.indexOf(needle)
  while (idx !== -1) {
    n++
    idx = hay.indexOf(needle, idx + needle.length)
  }
  return n
}

/** Scan one file's raw text, pushing hits in line order. Returns false when
 *  `limit` was reached mid-file (callers stop walking). Shared by the sync
 *  and async search variants so their semantics can't drift. */
function scanRaw(
  raw: string,
  needle: string,
  relPath: string,
  absPath: string,
  hits: SearchHit[],
  limit: number,
): boolean {
  const lines = raw.split('\n')
  const fmEnd = frontmatterEndLine(lines)
  // Running count of needle occurrences in BODY lines above the cursor —
  // the metric the editor's goto-match consumes (D22). Frontmatter hits
  // carry null (they have no doc twin) and don't advance the counter.
  let bodyOccurrences = 0
  for (let i = 0; i < lines.length; i++) {
    const inFrontmatter = fmEnd !== null && i <= fmEnd
    const occurrences = occurrencesIn(lines[i].toLowerCase(), needle)
    if (occurrences > 0) {
      hits.push({
        path: relPath,
        absPath,
        line: i + 1,
        excerpt: lines[i].trim().slice(0, 200),
        docMatchIndex: inFrontmatter ? null : bodyOccurrences,
      })
      if (hits.length >= limit) return false
    }
    if (!inFrontmatter) bodyOccurrences += occurrences
  }
  return true
}

/** Search a vault for `query` (case-insensitive substring). `limit` caps
 *  total hits so a broad query can't flood the agent. Results are ordered
 *  by path, then line. */
export function search(root: string, query: string, limit = VAULT_SEARCH_DEFAULT_LIMIT): SearchHit[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  const hits: SearchHit[] = []
  for (const abs of walk(root).filter((p) => p.endsWith('.md')).sort()) {
    let raw: string
    try {
      raw = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(root, abs).split(path.sep).join('/')
    if (!scanRaw(raw, needle, rel, abs, hits, limit)) break
  }
  return hits
}

/** Async variant for the Electron main process: the ⌘⇧F palette searches on
 *  every (debounced) keystroke, and a sync walk on the main thread would
 *  jank every window's IPC at N>1. Identical semantics to `search` — same
 *  walk order, matcher, limit, scanRaw — with awaited reads and a yield
 *  every few files so the event loop keeps breathing. */
export async function searchAsync(
  root: string,
  query: string,
  limit = VAULT_SEARCH_DEFAULT_LIMIT,
): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  if (!needle) return []
  const hits: SearchHit[] = []
  const files = walk(root)
    .filter((p) => p.endsWith('.md'))
    .sort()
  for (let i = 0; i < files.length; i++) {
    if (i % 16 === 15) await new Promise<void>((resolve) => setImmediate(resolve))
    let raw: string
    try {
      raw = await fs.promises.readFile(files[i], 'utf8')
    } catch {
      continue
    }
    const rel = path.relative(root, files[i]).split(path.sep).join('/')
    if (!scanRaw(raw, needle, rel, files[i], hits, limit)) break
  }
  return hits
}
