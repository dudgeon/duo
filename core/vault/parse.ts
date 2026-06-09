// ENH-208 Vault — file walking + frontmatter/link parsing (PR1).
//
// The frontmatter split and wikilink regex are kept byte-compatible with
// the prototype (`docs/research/graphbook-prototype/{lint,render}.mjs`) so
// the corpus and the (PR2) renderer agree on what a note declares.

import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import type { VaultFile } from './types'

/** Directories never walked for entities or queries. `templates/` is
 *  query-excluded per D5 (read separately as the schema registry);
 *  `out/` holds rendered artifacts; `.obsidian`/`.trash` are Obsidian
 *  internals. `archive/` is NOT skipped here — bases opt in/out per view
 *  (D20), so the walk surfaces it and filters decide. */
export const SKIP_DIRS = new Set(['.obsidian', '.trash', 'out', 'templates'])

/** Recursively list files under `dir`, skipping {@link SKIP_DIRS}. Returns
 *  absolute paths. Symlinks are not followed (withFileTypes). */
export function walk(dir: string, skip: Set<string> = SKIP_DIRS): string[] {
  const acc: string[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!skip.has(e.name)) acc.push(...walk(full, skip))
    } else {
      acc.push(full)
    }
  }
  return acc
}

/** Split a raw markdown file into `{ frontmatter, body }`. Mirrors the
 *  prototype's leading-fence match: only a frontmatter block that starts
 *  at byte 0 counts. Unparseable YAML yields `{}` (never throws — D15
 *  warn-don't-block spirit applies to malformed notes too). */
export function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { frontmatter: {}, body: raw }
  let fm: Record<string, unknown> = {}
  try {
    const parsed = yamlLoad(m[1])
    if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>
  } catch {
    fm = {}
  }
  return { frontmatter: fm, body: raw.slice(m[0].length) }
}

const WIKILINK_RE = /\[\[([^\]|#]+)/g

/** Extract deduped, basename-only wikilink targets from text. `[[Foo|bar]]`
 *  and `[[Foo#heading]]` both resolve to `Foo`. Embeds (`![[Foo]]`) are
 *  included — an embed is still a graph edge. */
export function extractWikilinks(text: string): string[] {
  return [...new Set([...text.matchAll(WIKILINK_RE)].map((m) => m[1].trim()))]
}

/** Parse one markdown file into a {@link VaultFile}. `root` is the vault
 *  root used to compute the relative path/folder. */
export function parseFile(absPath: string, root: string): VaultFile {
  const raw = fs.readFileSync(absPath, 'utf8')
  const { frontmatter, body } = splitFrontmatter(raw)
  const rel = path.relative(root, absPath).split(path.sep).join('/')
  const basename = path.basename(absPath, path.extname(absPath))
  const dir = path.dirname(rel)
  let mtimeMs = 0
  try {
    mtimeMs = fs.statSync(absPath).mtimeMs
  } catch {
    /* race: file removed between walk and stat — leave 0 */
  }
  return {
    absPath,
    relPath: rel,
    basename,
    folder: dir === '.' ? '' : dir,
    ext: path.extname(absPath).slice(1).toLowerCase(),
    frontmatter,
    body,
    // Graph edges are scanned over the FULL raw, not just the body:
    // typed frontmatter relationships (`owner: "[[Alice Park]]"`,
    // `initiative: "[[Q3 Launch]]"`) are real edges (matches the
    // prototype's `_rawLinks`).
    links: extractWikilinks(raw),
    mtimeMs,
  }
}

/** All markdown notes in the vault (entities only — templates/out/internal
 *  dirs skipped per {@link SKIP_DIRS}). */
export function readNotes(root: string): VaultFile[] {
  return walk(root)
    .filter((p) => p.endsWith('.md'))
    .map((p) => parseFile(p, root))
}
