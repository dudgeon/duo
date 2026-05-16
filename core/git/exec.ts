// ENH-151/152a — shared `git` / `gh` execution helper.
//
// Centralizes the pattern of spawning a git or gh subprocess from the
// main process: fixed timeout, structured result, no shell. Used by
// both ENH-152a's status probe and ENH-151's clone runner so the two
// stay in lockstep on timeout / env / cwd behavior.

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 10_000

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
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout,
      env: opts.env ?? process.env,
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
