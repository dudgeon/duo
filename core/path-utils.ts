// Pure path utilities — extracted from main.ts + cdp-bridge consumers
// so they can be unit-tested without an Electron runtime.
//
// expandTilde: expand a leading `~` or `~/` against a user's home
// directory. Used by `cdpBridge.onBrowserOpenPath` (smoke-walk
// path-link clicks emit `~/...` style paths verbatim from the
// manifest; the renderer's openFileSmart calls fs.stat against the
// literal string, which yields ENOENT on `~`) and by the symmetric
// `onBrowserOpenPathSplit` handler (Phase 3a).
//
// `~user/...` (other-user home) is rare in this context — defer
// until a real ask shows up. ENOENT-shaped errors are tolerated
// upstream; this helper only does the textual transform.

import { join } from 'path'

export function expandTilde(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith('~/')) return join(home, input.slice(2))
  return input
}
