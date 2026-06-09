// ENH-208 Vault — full-text search (PR1). The CLI twin of the Phase 2
// ⌘⇧F vault-search palette (D22): plain case-insensitive substring over
// note text, returning file-at-line hits. Frontmatter lines are searched
// too (you want to find `status: blocked`). Internal/template/out dirs are
// excluded by the shared walk.

import fs from 'node:fs'
import path from 'node:path'
import { walk } from './parse'
import type { SearchHit } from './types'

/** Search a vault for `query` (case-insensitive substring). `limit` caps
 *  total hits so a broad query can't flood the agent. Results are ordered
 *  by path, then line. */
export function search(root: string, query: string, limit = 200): SearchHit[] {
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
    const lines = raw.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({
          path: path.relative(root, abs).split(path.sep).join('/'),
          absPath: abs,
          line: i + 1,
          excerpt: lines[i].trim().slice(0, 200),
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}
