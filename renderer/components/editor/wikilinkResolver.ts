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
