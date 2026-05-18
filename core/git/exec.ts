// ENH-151/152a — shared `git` / `gh` execution helper.
//
// Centralizes the pattern of spawning a git or gh subprocess from the
// main process: fixed timeout, structured result, no shell. Used by
// both ENH-152a's status probe and ENH-151's clone runner so the two
// stay in lockstep on timeout / env / cwd behavior.

import { execFile } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 10_000

// BUG-136 — well-known dirs where `gh` and `git` may live on macOS dev
// machines. Electron launched from Finder inherits the LaunchServices
// PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) — NOT the user's interactive
// PATH. Homebrew installs `gh` to /opt/homebrew/bin (Apple Silicon) or
// /usr/local/bin (Intel), neither of which is on the LaunchServices PATH.
// We prepend these well-known dirs to the spawn env's PATH so `gh` is
// findable even when the user's `.zshrc`-loaded PATH isn't inherited.
// Same pattern resolve-claude.ts uses for the `claude` binary.
const WELL_KNOWN_BIN_DIRS = [
  '/opt/homebrew/bin',                            // Homebrew (Apple Silicon)
  '/usr/local/bin',                               // Homebrew (Intel) + manual installs
  path.join(process.env.HOME ?? '', '.local', 'bin')  // pipx / manual installs
]

/** Compose a PATH that includes the well-known dev-tool dirs in front
 *  of whatever's already in the inherited env. Returns a NEW env so
 *  callers don't mutate process.env. */
function augmentedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existing = (base.PATH || '').split(':').filter(Boolean)
  const merged = [...WELL_KNOWN_BIN_DIRS, ...existing.filter(d => !WELL_KNOWN_BIN_DIRS.includes(d))].join(':')
  return { ...base, PATH: merged }
}

export interface GitExecResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  /** True when the underlying command was not found on $PATH. The
   *  callers translate this into a user-facing "git/gh not installed"
   *  message; today's macOS dev environments ship git but not gh by
   *  default, so this distinction matters. */
  notFound: boolean
}

export interface GitExecOptions {
  cwd?: string
  timeoutMs?: number
  /** Extra env vars layered onto the parent env. Used by tests to
   *  isolate gh's config. */
  env?: NodeJS.ProcessEnv
}

/**
 * Run `<bin> <args...>` with a fixed timeout and a clean env. Returns
 * a structured result rather than throwing on non-zero exit — the
 * caller decides whether non-zero is "real failure" or "expected
 * not-a-repo signal."
 */
export async function execGit(
  bin: 'git' | 'gh',
  args: string[],
  opts: GitExecOptions = {}
): Promise<GitExecResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // BUG-136 — augment PATH with the well-known dev-tool dirs so `gh`
  // (homebrew) is findable from packaged Electron, not just dev. Tests
  // can still override entirely by passing opts.env.
  const env = opts.env ?? augmentedEnv(process.env)
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout,
      env,
      maxBuffer: 10 * 1024 * 1024
    })
    return { ok: true, stdout, stderr, exitCode: 0, notFound: false }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: string | number
    }
    if (e.code === 'ENOENT') {
      return {
        ok: false,
        stdout: '',
        stderr: `${bin}: command not found`,
        exitCode: null,
        notFound: true
      }
    }
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
      exitCode: typeof e.code === 'number' ? e.code : null,
      notFound: false
    }
  }
}
