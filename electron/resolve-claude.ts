// Stage 19b / 19c — resolve where the user's `claude` binary lives by
// asking their shell. Used by both:
//
//   - install-service.ts § installShim — needs the absolute path so
//     the priming wrapper at ~/.claude/duo/bin/claude can `exec`
//     the real binary with --append-system-prompt.
//   - main.ts § isClaudeOnPath — terminal-tab spawn path needs a
//     boolean to decide between auto-typing `claude\n` and printing
//     the install banner (Stage 19c D23).
//
// Why `command -v` (and not bare `which claude` against Electron's
// process.env.PATH): Electron launched from Finder inherits the
// system-default PATH (~/usr/bin:/bin:/usr/sbin:/sbin), NOT the
// interactive shell's PATH. The user's `~/.local/bin` etc.
// modifications live in their rc files (.zshrc / .bashrc) which only
// load when the shell runs in the right mode.
//
// Why all three flag combinations:
//   -l -i :  reads .zshenv + .zprofile + .zlogin AND .zshrc.
//             Most permissive, tried first.
//   -i :     reads .zshrc only (modern macOS users put PATH here).
//             Fallback for users with weird login files that error
//             under -l.
//   -l :     reads .zprofile / .zlogin / .zshenv but NOT .zshrc.
//             Last resort for users with PATH set in a login file
//             and a noisy .zshrc that breaks under -i.
//
// v0.4.4 used `-l -c` only and silently failed for the vast majority
// of users (whose PATH lives in .zshrc). v0.4.5 ships this helper.

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'

const execFileAsync = promisify(execFile)

const HOME = process.env.HOME ?? ''
const SHIM_DIR = path.join(HOME, '.claude', 'duo', 'bin')

/**
 * Asks the user's shell where `claude` lives. Returns the absolute
 * path, or null if not found. Walks (shell × flag-set) combinations
 * until one succeeds.
 *
 * @param excludeShimDir If true, strips `~/.claude/duo/bin/` from the
 *   PATH before asking (so we resolve real-claude rather than our own
 *   wrapper). Used by installShim() to prevent infinite loops.
 */
export async function resolveClaudeBinary(opts: { excludeShimDir?: boolean } = {}): Promise<string | null> {
  const shells = [process.env.SHELL || '/bin/zsh', '/bin/zsh', '/bin/bash']
  const flagSets: string[][] = [
    ['-l', '-i', '-c', 'command -v claude'],
    ['-i', '-c', 'command -v claude'],
    ['-l', '-c', 'command -v claude']
  ]

  const baseEnv = { ...process.env }
  if (opts.excludeShimDir) {
    baseEnv.PATH = pathWithoutShim()
  }

  const seen = new Set<string>()
  for (const shell of shells) {
    if (seen.has(shell)) continue
    seen.add(shell)
    for (const flags of flagSets) {
      try {
        const { stdout } = await execFileAsync(shell, flags, {
          timeout: 5000,
          env: baseEnv
        })
        const resolved = stdout.trim()
        if (!resolved) continue
        // Defensive — if the resolved path is inside our shim dir, we
        // hit our own wrapper. Skip it; let the next flag-set try.
        if (resolved.startsWith(SHIM_DIR)) continue
        return resolved
      } catch {
        // Shell missing, command not found, hung interactive prompt,
        // rc-file error, or timeout — try the next combination.
        continue
      }
    }
  }
  return null
}

/** Strip ~/.claude/duo/bin from PATH (used during shim install). */
function pathWithoutShim(): string {
  const segments = (process.env.PATH || '').split(':').filter(s => {
    if (!s) return false
    try {
      return path.resolve(s) !== path.resolve(SHIM_DIR)
    } catch {
      return true
    }
  })
  return segments.join(':')
}
