// ENH-155 — compose a GitHub-style URL from a local repo path + a
// relative file/folder path inside it.
//
// Powers the Navigator right-click context-menu items "Open on
// GitHub" (opens https://github.com/<owner>/<repo>/blob/<branch>/<rel>)
// and "Copy GitHub URL" (copies the same URL to clipboard).
//
// Locked owner decisions (v0.7.0-rev2 GH-cluster gate):
// - v1-Q4 yes-detect: GitHub Enterprise hosts (`github.<company>.com`)
//   are detected via the remote URL prefix. We don't ship enterprise-
//   specific switches — we just emit a URL whose host matches the
//   remote.
// - v1-Q5 show-always: menu items render regardless of auth state.
//   Public-repo URLs work without auth.
//
// Pure module — no I/O. Callers (the renderer, the right-click
// menu builder) pass the `git remote get-url origin` output + branch
// name + relative path; this helper just composes.

import { execGit } from './exec'

export interface ComposedGitUrl {
  /** The composed `https://...` URL ready for `shell.openExternal` or
   *  clipboard. Null when the remote isn't parseable as a GitHub
   *  host (e.g. it's a gitlab.com or self-hosted gitea remote). */
  url: string | null
  /** Detected host — 'github.com' for public; 'github.<co>.com' for
   *  enterprise. Null when not a GitHub host. */
  host: string | null
}

/**
 * Parse a remote URL of any form (https://, ssh, git@, gh CLI) into
 * its host + owner + repo components. Returns null on unparseable
 * input.
 */
export interface ParsedRemote {
  host: string
  owner: string
  repo: string
}

export function parseRemoteUrl(remote: string): ParsedRemote | null {
  if (!remote) return null
  const trimmed = remote.trim()
  // https://github.com/owner/repo[.git]
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] }
  }
  // git@github.com:owner/repo[.git]
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] }
  }
  // ssh://git@github.com/owner/repo[.git]
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  if (sshUrlMatch) {
    return { host: sshUrlMatch[1], owner: sshUrlMatch[2], repo: sshUrlMatch[3] }
  }
  return null
}

/**
 * Is this host a GitHub-family host? Recognises github.com and any
 * github.<subdomain> (the Enterprise pattern). Self-hosted
 * GHE servers usually use a `github.<company>.com` style host name,
 * so the simple prefix check covers v1-Q4 yes-detect.
 */
export function isGitHubHost(host: string | null | undefined): boolean {
  if (!host) return false
  if (host === 'github.com') return true
  if (host.startsWith('github.') && host.endsWith('.com')) return true
  // Some enterprise installs use github.companyname (no .com) — match
  // those too. Reject obvious non-GH hosts (gitlab.*, bitbucket.*).
  if (host.startsWith('github.')) return true
  return false
}

/**
 * Compose the GitHub URL for a given file/folder path inside the
 * repo. Returns null when the remote isn't a GitHub host or the
 * inputs don't compose cleanly.
 *
 * @param remote - `git remote get-url origin` output
 * @param branch - branch name (or commit SHA for permalinks)
 * @param relPath - path inside the repo, e.g. "src/main.ts" or "docs/"
 * @param isFolder - true → /tree/branch/path; false → /blob/branch/path
 */
export function composeGitHubUrl(opts: {
  remote: string
  branch: string
  relPath: string
  isFolder: boolean
}): ComposedGitUrl {
  const parsed = parseRemoteUrl(opts.remote)
  if (!parsed) return { url: null, host: null }
  if (!isGitHubHost(parsed.host)) return { url: null, host: parsed.host }
  // Use HTTPS regardless of how the remote was configured. Branch
  // names with special chars get URL-encoded; the slash inside path
  // segments must NOT be encoded (so encodeURIComponent on each
  // segment, then rejoin).
  const branchSafe = encodeURIComponent(opts.branch)
  const rel = (opts.relPath || '').replace(/^\/+/, '').replace(/\/+$/, '')
  const pathSafe = rel
    ? rel.split('/').map(encodeURIComponent).join('/')
    : ''
  const kind = opts.isFolder ? 'tree' : 'blob'
  const base = `https://${parsed.host}/${parsed.owner}/${parsed.repo}`
  const url = rel ? `${base}/${kind}/${branchSafe}/${pathSafe}` : base
  return { url, host: parsed.host }
}

/**
 * Async wrapper that calls `git remote get-url origin` for the given
 * cwd + composes the URL. Returns null on any error (no remote, not
 * a repo, etc.) so callers can short-circuit.
 */
export async function gitHubUrlFor(opts: {
  cwd: string
  workTreeRoot: string
  branch: string
  absPath: string
  isFolder: boolean
}): Promise<ComposedGitUrl> {
  try {
    const result = await execGit('git', ['remote', 'get-url', 'origin'], { cwd: opts.cwd })
    if (!result.ok || !result.stdout) return { url: null, host: null }
    const relPath = opts.absPath.startsWith(opts.workTreeRoot + '/')
      ? opts.absPath.slice(opts.workTreeRoot.length + 1)
      : opts.absPath === opts.workTreeRoot
        ? ''
        : opts.absPath
    return composeGitHubUrl({
      remote: result.stdout.trim(),
      branch: opts.branch,
      relPath,
      isFolder: opts.isFolder
    })
  } catch {
    return { url: null, host: null }
  }
}
