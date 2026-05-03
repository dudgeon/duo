// Pure URL utilities used by renderer components (no React/DOM deps).
// Extracted from WorkingTabStrip.tsx so the helpers are testable
// (Fast Refresh requires component files NOT export plain utilities).
//
// pathFromFileUrl: convert a `file:///path/to/foo.html` URL to its
// absolute file-system path. Used by WorkingTabStrip's right-click
// menu logic (BUG-045 — local-file browser tabs expose Reveal /
// Rename / Trash by resolving their URL back to a path).

/** Decode a `file://` URL to an absolute filesystem path. Returns
 *  null for non-file URLs, missing/undefined input, or malformed
 *  URLs. Tolerates URI-encoded characters (so paths with spaces /
 *  unicode survive a file:// round-trip). */
export function pathFromFileUrl(url: string | undefined): string | null {
  if (!url || !url.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return null
  }
}
