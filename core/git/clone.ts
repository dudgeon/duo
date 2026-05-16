// ENH-151 — `duo clone <url> [<path>]` runtime.
//
// Wraps `gh repo clone` when `gh` is available + authenticated (so
// HTTPS + SSH both work transparently via gh's credential helper);
// falls back to plain `git clone` when gh is missing OR returns
// auth-missing. The fallback works for public repos and for users
// with SSH keys already configured.
//
// The runner is structured around three failure modes the renderer
// surfaces differently:
//
//   - **bad-url** → user typo, retry input
//   - **auth-missing** → bounce to "Run gh auth login" (interim UX
//                       until ENH-150's Doctor panel lands)
//   - **clone-failed** → generic git error (network, permissions,
//                       target dir exists, etc.) — show stderr
//
// Output dir: when `path` is omitted, gh/git default to `<repo-name>`
// in CWD. The renderer's modal passes an explicit path to make the
// landing predictable.

import * as path from 'path'
import { execGit } from './exec'
import { probeGhAuth } from './auth'

export interface CloneRequest {
  /** Repo URL — gh accepts both shorthand (`owner/repo`) and full
   *  HTTPS / SSH URLs. git only accepts the full forms. */
  url: string
  /** Absolute target directory. When omitted, gh / git clone into
   *  `<cwd>/<repo-name>`. Renderer's modal always supplies one. */
  targetDir?: string
  /** Working directory for the spawn. Defaults to user's home. */
  cwd?: string
}

export interface CloneResult {
  ok: boolean
  /** When ok: the path the repo was cloned into (resolved to absolute). */
  clonedTo?: string
  /** Failure mode for the renderer to branch on. Undefined on success. */
  errorKind?: 'bad-url' | 'auth-missing' | 'clone-failed'
  /** Human-readable error (for banner / log). */
  error?: string
  /** Which CLI did the work — useful for the smoke walk + log. */
  via?: 'gh' | 'git'
}

/**
 * Run the clone. Probes `gh auth status` first; if gh is unavailable
 * OR the user isn't authenticated, falls back to `git clone`. The
 * fallback succeeds for public repos and for users with valid SSH
 * keys already configured.
 */
export async function runClone(req: CloneRequest): Promise<CloneResult> {
  if (!req.url || !req.url.trim()) {
    return { ok: false, errorKind: 'bad-url', error: 'URL is required.' }
  }

  const auth = await probeGhAuth()
  const ghAvailable = !auth.ghNotFound && auth.authenticated

  if (ghAvailable) {
    const res = await ghClone(req)
    if (res.ok) return res
    // If gh failed with an auth-shaped error, surface that. Otherwise
    // try `git clone` as a fallback.
    if (res.errorKind === 'auth-missing') return res
    const fallback = await gitClone(req)
    if (fallback.ok) return fallback
    return res // return the original gh error (richer message)
  }

  // gh not usable — try plain git.
  const res = await gitClone(req)
  if (res.ok) return res
  // git failed AND we couldn't try gh; if the failure smells like
  // auth (HTTPS repo without creds), prompt the auth path.
  if (looksLikeAuthFailure(res.error ?? '')) {
    return {
      ok: false,
      errorKind: 'auth-missing',
      error: auth.ghNotFound
        ? 'GitHub authentication is required. Install gh (brew install gh) then run `gh auth login`.'
        : 'GitHub authentication is required. Run `gh auth login`.'
    }
  }
  return res
}

async function ghClone(req: CloneRequest): Promise<CloneResult> {
  const args = ['repo', 'clone', req.url]
  if (req.targetDir) args.push(req.targetDir)
  const res = await execGit('gh', args, { cwd: req.cwd ?? process.env.HOME, timeoutMs: 120_000 })
  if (res.ok) {
    return {
      ok: true,
      clonedTo: req.targetDir ? path.resolve(req.targetDir) : guessClonedPath(req.url, req.cwd),
      via: 'gh'
    }
  }
  if (res.notFound) {
    return { ok: false, errorKind: 'auth-missing', error: 'gh: command not found' }
  }
  if (looksLikeAuthFailure(res.stderr)) {
    return { ok: false, errorKind: 'auth-missing', error: res.stderr.trim() }
  }
  if (looksLikeBadUrl(res.stderr)) {
    return { ok: false, errorKind: 'bad-url', error: res.stderr.trim() }
  }
  return { ok: false, errorKind: 'clone-failed', error: res.stderr.trim() || 'gh repo clone failed', via: 'gh' }
}

async function gitClone(req: CloneRequest): Promise<CloneResult> {
  // gh accepts `owner/repo` shorthand; git doesn't. Reject the
  // shorthand up front with a clear error instead of letting git
  // fail with "Could not read from remote repository."
  if (!/^(https?:|git@|ssh:|git:)/.test(req.url) && !req.url.includes('://')) {
    if (/^[\w.-]+\/[\w.-]+$/.test(req.url.trim())) {
      return {
        ok: false,
        errorKind: 'auth-missing',
        error: `Shorthand "${req.url}" requires gh. Install gh (brew install gh) + run \`gh auth login\`, or use the full https://github.com/${req.url}.git URL.`
      }
    }
  }
  const args = ['clone', req.url]
  if (req.targetDir) args.push(req.targetDir)
  const res = await execGit('git', args, { cwd: req.cwd ?? process.env.HOME, timeoutMs: 120_000 })
  if (res.ok) {
    return {
      ok: true,
      clonedTo: req.targetDir ? path.resolve(req.targetDir) : guessClonedPath(req.url, req.cwd),
      via: 'git'
    }
  }
  if (res.notFound) {
    return { ok: false, errorKind: 'clone-failed', error: 'git: command not found — install Xcode Command Line Tools.' }
  }
  if (looksLikeBadUrl(res.stderr)) {
    return { ok: false, errorKind: 'bad-url', error: res.stderr.trim() }
  }
  return { ok: false, errorKind: 'clone-failed', error: res.stderr.trim() || 'git clone failed', via: 'git' }
}

function looksLikeAuthFailure(stderr: string): boolean {
  const s = stderr.toLowerCase()
  return (
    s.includes('authentication') ||
    s.includes('could not read username') ||
    s.includes('permission denied') ||
    s.includes('403') ||
    s.includes('401') ||
    s.includes('not logged in') ||
    s.includes('please run: gh auth login')
  )
}

function looksLikeBadUrl(stderr: string): boolean {
  const s = stderr.toLowerCase()
  return (
    s.includes('repository not found') ||
    s.includes('not found') ||
    s.includes('does not exist') ||
    s.includes('invalid url')
  )
}

/**
 * When neither `--target` nor an explicit positional dir is supplied,
 * git/gh derive the dir name from the URL. Mirror that derivation so
 * we can return `clonedTo` even when the caller didn't pre-compute it.
 */
function guessClonedPath(url: string, cwd?: string): string {
  // Strip trailing slash, .git suffix, owner/repo prefix.
  let name = url.trim().replace(/\/$/, '')
  name = name.replace(/\.git$/, '')
  const lastSlash = name.lastIndexOf('/')
  if (lastSlash >= 0) name = name.slice(lastSlash + 1)
  const lastColon = name.lastIndexOf(':')
  if (lastColon >= 0) name = name.slice(lastColon + 1)
  return path.resolve(cwd ?? process.env.HOME ?? process.cwd(), name)
}
