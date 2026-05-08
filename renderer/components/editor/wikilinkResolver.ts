// ENH-096 (B1) walk-1 fix — wikilink name normalization.
//
// Used by the vault resolver to match a wikilink target (the inner
// text of `[[Page Name]]`) against an on-disk filename's basename.
//
// Normalization rules (intentionally MORE forgiving than Obsidian):
//
//   1. Lowercase. Obsidian itself is case-insensitive on Mac/Windows
//      (case-preserving filesystem) and case-sensitive on Linux. Duo
//      runs on macOS today, so case-insensitive is the right default.
//
//   2. Treat `-` and `_` as equivalent to space. Obsidian doesn't do
//      this — `[[Other Note]]` would NOT resolve to `other-note.md`
//      in Obsidian. But the casing/spacing mismatch is a recurring
//      stumble (smoke walk v0.6.8 surfaced it: user typed
//      `[[Other Note]]`, file was `other-note.md`, click silently
//      no-op'd). Duo's vaults are also imported from non-Obsidian
//      sources where hyphenation conventions differ; being lenient
//      keeps the most common authoring intent working.
//
//   3. Collapse runs of whitespace. Defensive — `[[Other  Note]]`
//      (double-space) should still resolve.
//
// Trade-off: when both `Other Note.md` AND `Other-Note.md` exist in
// the same vault, they collide under this normalization. The BFS
// walk picks the first match (shallowest path, alphabetical at the
// same depth). Document this in the user-facing FAQ when it ships.

export function normalizeWikilinkName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Walk up from a starting file path until we find an `.obsidian/`
 * directory (vault root) or run out of ancestors (cap 16 levels).
 * Returns the vault root path or null. Sprint 11 — extracted from
 * App.tsx so the wikilink autocomplete + `⌘O` quick switcher can
 * share the same vault detection.
 */
export async function findVaultRoot(startPath: string | null): Promise<string | null> {
  if (!startPath) return null
  let dir = startPath.slice(0, startPath.lastIndexOf('/'))
  if (!dir) return null
  for (let depth = 0; depth < 16; depth++) {
    const obsidianPath = `${dir}/.obsidian`
    try {
      // ENH-096 v2 (Sprint 9 walk-1 fix). `files.exists` is regular-
      // files only (BUG-039 semantic); use `dirExists` for the
      // `.obsidian/` directory probe.
      if (await window.electron.files.dirExists(obsidianPath)) {
        return dir
      }
    } catch {
      // IO failure → assume not a vault root, continue walking up.
    }
    const parent = dir.slice(0, dir.lastIndexOf('/'))
    if (!parent || parent === dir) return null
    dir = parent
  }
  return null
}

/**
 * Resolve a wikilink target inside a vault root. The target is the
 * inner text of `[[Page Name]]` (sans `#section` or `^block` suffixes
 * — those are stripped by the caller).
 *
 * Resolution order (Obsidian-compat best-effort):
 *   1. If target contains `/`, treat as a relative path from the
 *      vault root. First try `<root>/<target>.md`, then
 *      `<root>/<target>` verbatim, then `<root>/<target>.html`.
 *   2. Otherwise: name-first vault walk. First file whose basename
 *      (without extension) equals the target wins. Walk is BFS so
 *      shallower matches win when both exist.
 *
 * Walk-cap: 2000 entries scanned to bound IO on monster vaults.
 */
export async function resolveWikilinkInVault(
  vaultRoot: string,
  target: string
): Promise<string | null> {
  if (target.includes('/')) {
    const candidates = [
      `${vaultRoot}/${target}.md`,
      `${vaultRoot}/${target}`,
      `${vaultRoot}/${target}.html`
    ]
    for (const candidate of candidates) {
      try {
        if (await window.electron.files.exists(candidate)) return candidate
      } catch { /* keep trying */ }
    }
  }
  const normalizedTarget = normalizeWikilinkName(target)
  const queue: string[] = [vaultRoot]
  let scanned = 0
  while (queue.length > 0 && scanned < 2000) {
    const dir = queue.shift()!
    let entries: import('@shared/types').DirEntry[]
    try {
      entries = await window.electron.files.list(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      scanned++
      if (entry.name.startsWith('.')) continue
      if (entry.kind === 'directory') {
        queue.push(entry.path)
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name
      if (normalizeWikilinkName(stem) === normalizedTarget) {
        return entry.path
      }
    }
  }
  return null
}

export interface VaultFile {
  /** Absolute path on disk. */
  absPath: string
  /** Path relative to vault root, e.g. "notes/Foo.md". */
  relPath: string
  /** Basename without extension, e.g. "Foo". */
  basename: string
  /** Lower-cased extension (no dot), e.g. "md". Empty string if none. */
  ext: string
}

/**
 * Sprint 11 — BFS-walk the vault root and collect every visible
 * (non-dotted) file. Returns up to `cap` entries (default 5000) so a
 * monster vault doesn't lock up the renderer. Used by the suggestion
 * popover (B.2 + ENH-105) and the `⌘O` quick switcher (B.4) — all
 * three features key off the same in-memory list.
 *
 * Sibling to `resolveWikilinkInVault`: the resolver does a one-shot
 * walk that bails on first match; this one collects everything for
 * fuzzy ranking. Keeps the resolver's fast-path for cmd+click while
 * giving the autocomplete UI a stable list to filter.
 *
 * NOT recursive into dotdirs (`.obsidian/`, `.git/`, `node_modules/`)
 * — same convention as the resolver. This is the consumer-side
 * filter; the file watcher's `ignored` regex is the producer-side
 * filter and gets the noise out of chokidar entirely.
 */
export async function walkVaultFiles(
  vaultRoot: string,
  cap = 5000
): Promise<VaultFile[]> {
  const out: VaultFile[] = []
  const queue: string[] = [vaultRoot]
  while (queue.length > 0 && out.length < cap) {
    const dir = queue.shift()!
    let entries: import('@shared/types').DirEntry[]
    try {
      entries = await window.electron.files.list(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      // Skip noise dirs that are typically large + uninteresting in a
      // vault context (matches the file-watcher's `ignored` regex).
      if (entry.kind === 'directory') {
        if (entry.name === 'node_modules') continue
        queue.push(entry.path)
        continue
      }
      const dot = entry.name.lastIndexOf('.')
      const basename = dot > 0 ? entry.name.slice(0, dot) : entry.name
      const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
      // For the autocomplete UX, only include text-y files. Images,
      // PDFs, binaries don't fit the wikilink/`@` insertion intent.
      if (ext && !['md', 'markdown', 'html', 'htm', 'txt'].includes(ext)) continue
      const relPath = entry.path.slice(vaultRoot.length + 1)
      out.push({ absPath: entry.path, relPath, basename, ext })
      if (out.length >= cap) return out
    }
  }
  return out
}
