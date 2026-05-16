// ENH-151 — `gh auth` probe.
//
// Tells the renderer whether `gh` is installed AND the user is signed
// in. The clone runner consults this to decide whether to use gh
// (preferred — handles HTTPS + SSH transparently) or fall back to
// plain git. Until ENH-150's Doctor panel lands, the Clone modal's
// "auth missing" banner directs the user to run `gh auth login` in a
// Duo terminal.

import { execGit } from './exec'

export interface GhAuthStatus {
  /** True if `gh` is on the user's PATH. */
  ghInstalled: boolean
  /** True if `gh auth status` reports an authenticated session. */
  authenticated: boolean
  /** Hostname the active session is signed into (github.com /
   *  enterprise GHE host). Undefined when not authenticated. */
  host?: string
  /** Username of the active session. Undefined when not authenticated. */
  user?: string
  /** When `gh` is missing entirely. Mirrors `ghInstalled === false`
   *  but exposed as its own flag for caller branching legibility. */
  ghNotFound: boolean
}

const NOT_INSTALLED: GhAuthStatus = {
  ghInstalled: false,
  authenticated: false,
  ghNotFound: true
}

/**
 * Run `gh auth status` and parse the output. Never throws — returns
 * a structured "not installed" / "not authenticated" snapshot for the
 * caller to branch on.
 *
 * gh's auth-status output shape (as of gh 2.x):
 *
 *   github.com
 *     ✓ Logged in to github.com account dudgeon (keyring)
 *     ...
 *
 * Or, when not logged in:
 *
 *   You are not logged into any GitHub hosts. To log in, run: gh auth login
 *   (exit 1)
 */
export async function probeGhAuth(): Promise<GhAuthStatus> {
  const res = await execGit('gh', ['auth', 'status'])
  if (res.notFound) return NOT_INSTALLED

  // gh prints the auth-status table to stderr (not stdout) — match
  // either stream to be safe across gh versions.
  const text = (res.stdout + '\n' + res.stderr).trim()

  if (!res.ok) {
    // gh present but not authenticated. The exit code is 1; the body
    // typically says "You are not logged into any GitHub hosts."
    return { ghInstalled: true, authenticated: false, ghNotFound: false }
  }

  // Parse the host + account from "Logged in to <host> account <user>"
  const match = text.match(/Logged in to (\S+) account (\S+)/)
  if (match) {
    return {
      ghInstalled: true,
      authenticated: true,
      host: match[1],
      user: match[2],
      ghNotFound: false
    }
  }

  // gh said it succeeded but we couldn't parse — treat as authenticated
  // with no host detail rather than fail the probe.
  return { ghInstalled: true, authenticated: true, ghNotFound: false }
}
