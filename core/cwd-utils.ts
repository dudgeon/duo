import * as fs from 'fs'
import * as path from 'path'

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Resolve a desired working directory to one that actually exists on
 *  disk. A PTY spawned into a missing cwd makes its child exit
 *  immediately — the terminal shows "[process exited]" with no recovery,
 *  even across restarts, because the saved tab keeps pointing at the dead
 *  path. This happens when the user deletes the directory their terminal
 *  is sitting in (e.g. `rm -rf` the repo they're cd'd into).
 *
 *  Strategy: keep the shell as close as possible to where the tab
 *  expected to be. If the desired path is an absolute path that's gone,
 *  walk up to the nearest surviving ancestor. Otherwise fall back to the
 *  caller's default (home), then `/` as a last resort. `substituted`
 *  reports whether we had to move so the caller can tell the user. */
export function resolveExistingCwd(
  desired: string,
  fallback: string
): { cwd: string; substituted: boolean } {
  if (desired && isDir(desired)) return { cwd: desired, substituted: false }

  if (desired && path.isAbsolute(desired)) {
    let cur = desired
    while (cur !== path.dirname(cur)) {
      cur = path.dirname(cur)
      if (isDir(cur)) return { cwd: cur, substituted: true }
    }
  }

  if (fallback && isDir(fallback)) return { cwd: fallback, substituted: true }
  return { cwd: '/', substituted: true }
}
