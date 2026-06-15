// ENH-208 Vault — graph queries (PR1): backlinks + orphans.
// Wikilinks resolve by basename (Obsidian semantics): `[[Foo]]`,
// `[[Foo|bar]]`, `[[Foo#h]]`, and `[[path/to/Foo]]` all point at the note
// whose basename is `Foo`. This is what makes file moves non-breaking
// (D20: "wikilinks survive moves, basename-resolved").

import fs from 'node:fs'
import path from 'node:path'
import { walk, readNotes } from './parse'
import { extractLinkRefs, targetKey } from '../markdown/vaultLinks'

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

/** All occurrences across the vault that link to `noteName` (matched on the
 *  move-proof {@link targetKey} — so a wikilink `[[Alice Park]]` and an mdlink
 *  `./alice-park.md` both resolve). ENH-216: scans BOTH syntaxes via the
 *  single node-free extractor, over the full raw file so frontmatter
 *  relationships count. */
export function backlinks(root: string, noteName: string): Backlink[] {
  const target = targetKey(noteName, 'wikilink')
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
      if (extractLinkRefs(lines[i]).some((ref) => ref.key === target)) {
        out.push({
          path: path.relative(root, abs).split(path.sep).join('/'),
          absPath: abs,
          line: i + 1,
          excerpt: lines[i].trim(),
        })
        // one hit per line is enough for navigation
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
  // ENH-216: `n.links` are now syntax-plural, move-proof KEYS — so key the
  // resolvable-target set by `targetKey(basename)` to match (was `basename`).
  const keys = new Set(notes.map((n) => targetKey(n.basename, 'wikilink')))
  // linkedTo[key] = true once some note links to it (resolvable target).
  const linkedTo = new Set<string>()
  for (const n of notes) {
    for (const l of n.links) {
      if (keys.has(l)) linkedTo.add(l)
    }
  }
  return notes
    .filter(
      (n) => n.links.length === 0 && !linkedTo.has(targetKey(n.basename, 'wikilink')),
    )
    .map((n) => n.relPath)
    .sort()
}
