// Sprint 10 ENH-108 — Obsidian-parity wikilink create path. When a
// cmd+click on a `[[Does Not Exist]]` wikilink fails to resolve to an
// existing file, this helper computes the path that should be created.
// Extracted from App.tsx so the path-shape contract has a unit test
// without dragging in the renderer's full dependency tree.

/**
 * Build the path used to *create* a wikilink target that doesn't yet
 * exist in the vault. Used in tandem with `files.write(path, empty)`
 * — the IPC handler mkdir-p's the parent directory so the path-
 * bearing forms (e.g. `[[notes/Foo]]`) work without separate mkdir
 * plumbing.
 *
 * Rules:
 *   - Target with no recognized text-file extension → append `.md`
 *     (matches Obsidian default + the resolver's primary candidate).
 *   - Target ending in `.md` / `.html` / `.htm` / `.txt` → keep as-is
 *     so `[[Foo.html]]` doesn't become `Foo.html.md`.
 *   - Strip leading `/` and skip any `..` / `.` segments to keep the
 *     create scope within the vault root (no path-traversal escapes).
 */
export function buildWikilinkCreatePath(vaultRoot: string, target: string): string {
  const trimmedRoot = vaultRoot.replace(/\/+$/, '')
  const safeSegments = target
    .replace(/^\/+/, '')
    .split('/')
    .filter(seg => seg !== '' && seg !== '..' && seg !== '.')
  const safeRel = safeSegments.join('/')
  const recognized = /\.(md|html|htm|txt)$/i
  const withExt = recognized.test(safeRel) ? safeRel : `${safeRel}.md`
  return `${trimmedRoot}/${withExt}`
}
