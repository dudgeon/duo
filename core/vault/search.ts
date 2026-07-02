// ENH-208 Vault — full-text search (PR1). The CLI twin of the Phase 2
// ⌘⇧F vault-search palette (D22): plain case-insensitive substring over
// note text, returning file-at-line hits. Frontmatter lines are searched
// too (you want to find `status: blocked`).
//
// ENH-214 — search SEES templates. The graph/parse walk excludes
// `templates/` (parse.ts SKIP_DIRS — templates are the schema registry, not
// entities), but the palette must surface them so templates are reachable
// from ⌘⇧F. This module uses a search-specific skip-set that omits
// `templates` (still skipping Obsidian internals + rendered output).

import fs from 'node:fs'
import path from 'node:path'
import { walk } from './parse'
import { OUTPUT_DIR_NAMES } from './output-dir'
import type { SearchHit } from './types'

/** ENH-214 — the ⌘⇧F palette (and its `duo vault search` twin) must SEE
 *  template files. The graph/parse walk excludes `templates/` (parse.ts
 *  SKIP_DIRS, D5) — but search wants them. This search-only skip-set omits
 *  `templates` while still skipping Obsidian internals and rendered output
 *  (`output/`/`out/`, ENH-244). Do NOT broaden parse.ts's SKIP_DIRS to
 *  match — graph behavior must not change. */
export const SEARCH_SKIP_DIRS = new Set(['.obsidian', '.trash', ...OUTPUT_DIR_NAMES])

/** True when a vault-relative POSIX path lives under a `templates/` directory
 *  — drives the palette's inline "Template" badge (ENH-214). Matches a
 *  `templates` path segment anywhere, mirroring how the walk treats the name
 *  as special at any depth. */
function isTemplatePath(relPath: string): boolean {
  return relPath.split('/').includes('templates')
}

/** One cap shared by the CLI verb, the main-process IPC handler, and the
 *  palette (CLI-parity rule: same code path, same arguments). */
export const VAULT_SEARCH_DEFAULT_LIMIT = 200

/** A frontmatter fence line. Tolerates trailing whitespace, matching the
 *  EDITOR's splitter (`markdown-io.ts`'s `/^---\s*\r?\n/`) rather than
 *  parse.ts's byte-exact `^---\n` — docMatchIndex must count what the
 *  editor doc contains, and the editor strips a `---  ` fence too. */
const FENCE_RE = /^---\s*$/

/** Frontmatter line extent: the index of the CLOSING `---` fence when the
 *  file opens with one, else null. Mirrors the editor splitter
 *  (markdown-io's splitFrontmatter) in line terms, so docMatchIndex counts
 *  exactly what the editor doc contains (the editor strips frontmatter
 *  into a panel). */
function frontmatterEndLine(lines: string[]): number | null {
  if (!FENCE_RE.test(lines[0] ?? '')) return null
  for (let j = 1; j < lines.length; j++) {
    if (FENCE_RE.test(lines[j])) return j
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
  // CRLF congruence: strip the trailing `\r` per line so fence detection,
  // occurrence counting, and excerpts all see what the editor's
  // `\r?\n`-tolerant splitter sees — and excerpts never carry a stray `\r`.
  const lines = raw.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const fmEnd = frontmatterEndLine(lines)
  // ENH-214 — per-file template flag (constant across the file's hits).
  const isTemplate = isTemplatePath(relPath)
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
        isTemplate,
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
  for (const abs of walk(root, SEARCH_SKIP_DIRS).filter((p) => p.endsWith('.md')).sort()) {
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

/** Async twin of parse.ts's `walk` — same SEARCH_SKIP_DIRS (ENH-214: omits
 *  `templates` so the palette sees templates), same not-following-symlinks
 *  semantics, but every directory read awaits (so the event loop breathes
 *  per directory rather than blocking for the whole traversal). Only the
 *  async search path uses it; the sync `walk` stays the CLI's. */
async function walkAsync(dir: string, skip: Set<string> = SEARCH_SKIP_DIRS): Promise<string[]> {
  const acc: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!skip.has(e.name)) acc.push(...(await walkAsync(full, skip)))
    } else {
      acc.push(full)
    }
  }
  return acc
}

/** Async variant for the Electron main process: the ⌘⇧F palette searches on
 *  every (debounced) keystroke, and a sync walk on the main thread would
 *  jank every window's IPC at N>1. Identical semantics to `search` — same
 *  walk order, matcher, limit, scanRaw — with an awaited traversal
 *  (walkAsync), awaited reads, and a yield every few files so the event
 *  loop keeps breathing. */
export async function searchAsync(
  root: string,
  query: string,
  limit = VAULT_SEARCH_DEFAULT_LIMIT,
): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  if (!needle) return []
  const hits: SearchHit[] = []
  const files = (await walkAsync(root))
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
