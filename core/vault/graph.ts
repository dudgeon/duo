// ENH-208 Vault — graph queries (PR1): backlinks + orphans.
// Wikilinks resolve by basename (Obsidian semantics): `[[Foo]]`,
// `[[Foo|bar]]`, `[[Foo#h]]`, and `[[path/to/Foo]]` all point at the note
// whose basename is `Foo`. This is what makes file moves non-breaking
// (D20: "wikilinks survive moves, basename-resolved").

import fs from 'node:fs'
import path from 'node:path'
import { walk, readNotes } from './parse'

const WIKILINK_LINE_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g

export interface Backlink {
  /** Linking note, relative to the vault root. */
  path: string
  /** Absolute path (open file-at-line). */
  absPath: string
  /** 1-based line number of the link occurrence. */
  line: number
  /** The line text, trimmed. */
  excerpt: string
}

/** Strip a wikilink target to its basename (drops any `path/` prefix). */
function targetBasename(target: string): string {
  const t = target.trim()
  const slash = t.lastIndexOf('/')
  return slash >= 0 ? t.slice(slash + 1) : t
}

/** All occurrences across the vault that wikilink to `noteName` (matched by
 *  basename, case-sensitive — Obsidian is case-preserving). Scans the full
 *  raw file so frontmatter relationships count. */
export function backlinks(root: string, noteName: string): Backlink[] {
  const target = targetBasename(noteName).replace(/\.md$/, '')
  const out: Backlink[] = []
  for (const abs of walk(root).filter((p) => p.endsWith('.md'))) {
    let raw: string
    try {
      raw = fs.readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const lines = raw.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(WIKILINK_LINE_RE)) {
        if (targetBasename(m[1]) === target) {
          out.push({
            path: path.relative(root, abs).split(path.sep).join('/'),
            absPath: abs,
            line: i + 1,
            excerpt: lines[i].trim(),
          })
          break // one hit per line is enough for navigation
        }
      }
    }
  }
  return out
}

/** Notes with no inbound and no outbound links — disconnected from the
 *  graph (a processing work-item: link them or archive them). Returns
 *  rel paths, sorted. Templates/out are already excluded by the walk. */
export function orphans(root: string): string[] {
  const notes = readNotes(root)
  const names = new Set(notes.map((n) => n.basename))
  // inbound[name] = true once some note links to it (resolvable target).
  const linkedTo = new Set<string>()
  for (const n of notes) {
    for (const l of n.links) {
      const base = targetBasename(l)
      if (names.has(base)) linkedTo.add(base)
    }
  }
  return notes
    .filter((n) => n.links.length === 0 && !linkedTo.has(n.basename))
    .map((n) => n.relPath)
    .sort()
}
