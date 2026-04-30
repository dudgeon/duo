// Stage 19b / 19c — resolve where the user's `claude` binary lives.
// Used by both:
//
//   - install-service.ts § installShim — needs the absolute path so
//     the priming wrapper at ~/.claude/duo/bin/claude can `exec`
//     the real binary with --append-system-prompt.
//   - main.ts § isClaudeOnPath — terminal-tab spawn path needs a
//     boolean to decide between auto-typing `claude\n` and printing
//     the install banner (Stage 19c D23).
//
// Resolution order (BUG-035 fix, 2026-04-29):
//
//   1. **Fast paths (no shell).** Walk well-known absolute install
//      locations + every entry in `process.env.PATH` and stat for
//      an executable named `claude`. Hits ~ms — most users land here
//      on the first call and never pay the shell cost.
//   2. **Shell fallback** for users whose `claude` lives outside the
//      well-known set. Spawns the user's shell with `command -v
//      claude`. Tries fastest variants first (login-only) before the
//      slowest (login + interactive) because `.zshrc` on populated
//      dev machines (NVM, conda, asdf, oh-my-zsh) can take >5s to
//      load. Bumps per-attempt timeout to 15s.
//
// Why we can't just use `process.env.PATH`: Electron launched from
// Finder inherits the LaunchServices PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
// not the user's interactive PATH. `~/.local/bin` and friends live in
// rc files (.zshrc / .bashrc) which only load when the shell runs in
// the right mode. So we walk our well-known set first, then
// process.env.PATH, then fall back to the shell to ask "where's claude?".
//
// History:
//   v0.4.4 used `zsh -l -c` only. Silently failed for the vast majority
//   of users (PATH lives in .zshrc, which `-l` alone doesn't read).
//   v0.4.5 added the three-flag-set fallback (`-l -i`, `-i`, `-l`),
//   shared the helper between install-service and main.ts. Fixed the
//   "Claude not detected" cases tied to which flags were used.
//   v0.5.2 (BUG-035) adds fast paths and bumps timeout to 15s. The user's
//   measured `zsh -l -i -c 'command -v claude'` was 5.236s on a populated
//   dev machine — the previous 5s timeout always failed it, surfacing
//   "Couldn't find Claude Code" even when claude was installed.

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'

const execFileAsync = promisify(execFile)

const HOME = process.env.HOME ?? ''
const SHIM_DIR = path.join(HOME, '.claude', 'duo', 'bin')

// BUG-035 — well-known install locations, ordered by frequency. We stat
// each for an executable `claude` before falling back to the shell. The
// list covers the package-manager + manual-install paths Claude Code
// users tend to land in. Keep additions here cheap (one extra stat per
// resolve call) before reaching for shell fallback.
const WELL_KNOWN_DIRS = [
  path.join(HOME, '.local', 'bin'),       // pip --user, pipx, manual installs
  path.join(HOME, '.npm-global', 'bin'),  // npm prefix override
  path.join(HOME, '.volta', 'bin'),       // Volta-managed Node tools
  path.join(HOME, '.bun', 'bin'),         // Bun
  '/opt/homebrew/bin',                    // Homebrew on Apple Silicon
  '/usr/local/bin',                       // Homebrew on Intel + manual installs
  path.join(HOME, 'bin')                  // very-old-school manual install
]

/**
 * Asks the user's shell where `claude` lives. Returns the absolute
 * path, or null if not found.
 *
 * @param excludeShimDir If true, strips `~/.claude/duo/bin/` from the
 *   walked PATH (so we resolve real-claude rather than our own
 *   wrapper). Used by installShim() to prevent infinite loops.
 */
export async function resolveClaudeBinary(opts: { excludeShimDir?: boolean } = {}): Promise<string | null> {
  // 1. Fast paths first — well-known absolute locations + process.env.PATH.
  const fastHit = await resolveFastPath(opts.excludeShimDir ?? false)
  if (fastHit) return fastHit

  // 2. Shell fallback — try fastest combos first.
  return resolveViaShell(opts.excludeShimDir ?? false)
}

/**
 * BUG-035 fast path — synchronous-feel walk of well-known directories
 * plus `process.env.PATH`. Returns the first executable `claude` found,
 * or null. Costs ~5–15 stat calls (~ms total) vs ~5–15s for the shell
 * fallback on populated rc files.
 */
async function resolveFastPath(excludeShimDir: boolean): Promise<string | null> {
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean)
  const candidates = [...WELL_KNOWN_DIRS, ...pathDirs]
  const seen = new Set<string>()
  for (const dir of candidates) {
    let resolved: string
    try {
      resolved = path.resolve(dir)
    } catch {
      continue
    }
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (excludeShimDir && resolved === path.resolve(SHIM_DIR)) continue
    const candidate = path.join(resolved, 'claude')
    try {
      await fs.promises.access(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // Not present or not executable — try the next.
      continue
    }
  }
  return null
}

/**
 * Shell-fallback path. Tries `(shell × flag-set)` combinations in
 * fastest-first order. Per-attempt timeout is 15s — enough headroom
 * for users with populated `.zshrc` (NVM, conda, asdf, oh-my-zsh).
 */
async function resolveViaShell(excludeShimDir: boolean): Promise<string | null> {
  const shells = [process.env.SHELL || '/bin/zsh', '/bin/zsh', '/bin/bash']
  // Fastest-first ordering — login-only skips .zshrc entirely.
  const flagSets: string[][] = [
    ['-l', '-c', 'command -v claude'],         // fastest — no .zshrc load
    ['-i', '-c', 'command -v claude'],         // .zshrc only
    ['-l', '-i', '-c', 'command -v claude']    // slowest — full login + interactive
  ]

  const baseEnv = { ...process.env }
  if (excludeShimDir) {
    baseEnv.PATH = pathWithoutShim()
  }

  const seen = new Set<string>()
  for (const shell of shells) {
    if (seen.has(shell)) continue
    seen.add(shell)
    for (const flags of flagSets) {
      try {
        const { stdout } = await execFileAsync(shell, flags, {
          timeout: 15_000,
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
