// ENH-221 — Open-flow resolver (the "Open brain").
//
// Pure classification of an Open-bar target string into one of four
// kinds, shared by the UI Open bar and the `duo open` CLI (D1). No
// filesystem or network access — deterministic and fully unit-testable.
// The caller (Open bar / CLI) does FS existence checks, navigator focus,
// checkout, and browser navigation off the back of this classification.
//
//   local-path   — a path on disk (absolute, ~, ./rel, bare, or file://)
//   github-file  — a single file in a GitHub repo (…/blob|raw/<ref>/<path>)
//   github-repo  — a whole GitHub repo (…/ , …/tree/<ref>[/<dir>])
//   url          — any other URL (opens in the browser pane)
//
// Decisions: D1 (unified entry), D5/DR6 (the github-file kind is what the
// "just this doc vs clone the repo" fork branches on), DR-gated round-trip.
//
// Known v1 limitation: a branch name containing slashes
// (…/blob/feature/x/doc.md) is parsed as ref="feature", path="x/doc.md".
// GitHub's web URL is itself ambiguous without the API; documented, not
// solved here.

import type { RecentKind } from '../shared/types'

export type OpenTargetKind = 'local-path' | 'github-file' | 'github-repo' | 'url'

export interface LocalPathTarget {
  kind: 'local-path'
  /** The path as the user gave it (still ~ / relative — caller absolutizes). */
  path: string
}

export interface GithubFileTarget {
  kind: 'github-file'
  owner: string
  repo: string
  /** branch | tag | sha (single segment; see slashed-branch limitation). */
  ref: string
  /** Path to the file within the repo (no leading slash). */
  filePath: string
  /** Canonical github.com blob URL (raw/permalink variants normalize to this). */
  canonical: string
}

export interface GithubRepoTarget {
  kind: 'github-repo'
  owner: string
  repo: string
  /** Present only for /tree/<ref> URLs. */
  ref?: string
  /** Present only for /tree/<ref>/<dir> URLs (no leading slash). */
  subPath?: string
  /** owner/repo clone URL. */
  cloneUrl: string
}

export interface UrlTarget {
  kind: 'url'
  url: string
}

export type OpenTarget = LocalPathTarget | GithubFileTarget | GithubRepoTarget | UrlTarget

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const RAW_HOST = 'raw.githubusercontent.com'

/** A leading `scheme:` per RFC 3986 (http, https, file, mailto, …). */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/

/** Host-prefixed but scheme-less GitHub links (paste from the address bar). */
const BARE_GITHUB_RE = /^(www\.)?(github\.com|raw\.githubusercontent\.com)\//i

function stripDotGit(repo: string): string {
  return repo.replace(/\.git$/i, '')
}

function splitSegments(pathname: string): string[] {
  return pathname.split('/').map(decodeSegment).filter((s) => s.length > 0)
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function parseGithubWeb(url: URL): GithubFileTarget | GithubRepoTarget | UrlTarget {
  const seg = splitSegments(url.pathname)
  if (seg.length < 2) {
    // /owner only, or bare github.com — nothing to open as a repo/file.
    return { kind: 'url', url: url.href }
  }
  const owner = seg[0]
  const repo = stripDotGit(seg[1])
  const cloneUrl = `https://github.com/${owner}/${repo}`

  if (seg.length === 2) {
    return { kind: 'github-repo', owner, repo, cloneUrl }
  }

  const verb = seg[2]
  if (verb === 'blob' || verb === 'raw') {
    const ref = seg[3]
    const filePath = seg.slice(4).join('/')
    if (!ref || !filePath) {
      return { kind: 'github-repo', owner, repo, cloneUrl }
    }
    return {
      kind: 'github-file',
      owner,
      repo,
      ref,
      filePath,
      canonical: `https://github.com/${owner}/${repo}/blob/${ref}/${filePath}`,
    }
  }
  if (verb === 'tree') {
    const ref = seg[3]
    const subPath = seg.slice(4).join('/') || undefined
    if (!ref) return { kind: 'github-repo', owner, repo, cloneUrl }
    return { kind: 'github-repo', owner, repo, ref, subPath, cloneUrl }
  }

  // /owner/repo/pulls, /issues, /commits, /releases, … — not an openable
  // file or a clone target. Let the browser pane handle it.
  return { kind: 'url', url: url.href }
}

function parseRawGithubusercontent(url: URL): GithubFileTarget | UrlTarget {
  // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path…> — no "blob".
  const seg = splitSegments(url.pathname)
  if (seg.length < 4) return { kind: 'url', url: url.href }
  const owner = seg[0]
  const repo = stripDotGit(seg[1])
  const ref = seg[2]
  const filePath = seg.slice(3).join('/')
  return {
    kind: 'github-file',
    owner,
    repo,
    ref,
    filePath,
    canonical: `https://github.com/${owner}/${repo}/blob/${ref}/${filePath}`,
  }
}

function fileUrlToPath(input: string): string {
  // file:///Users/me/x%20y.md → /Users/me/x y.md. Best-effort; the
  // caller absolutizes/validates.
  try {
    return decodeURIComponent(new URL(input).pathname)
  } catch {
    return input.replace(/^file:\/\//i, '')
  }
}

/**
 * Classify an Open-bar input. Pure: no FS, no network.
 *
 * Note on `owner/repo` shorthand: a scheme-less, host-less `owner/repo`
 * is classified as a **local-path** here (the Open bar is path-first).
 * Treating it as a GitHub clone shorthand is an FS-existence-gated
 * enhancement the caller layers on (if no such local path exists AND it
 * matches `owner/repo`, offer GitHub) — kept out of the pure resolver so
 * classification stays deterministic.
 */
export function resolveOpenTarget(input: string): OpenTarget {
  const trimmed = input.trim()
  if (!trimmed) return { kind: 'local-path', path: '' }

  const schemeMatch = SCHEME_RE.exec(trimmed)
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null

  if (scheme === 'file') {
    return { kind: 'local-path', path: fileUrlToPath(trimmed) }
  }

  // Build a URL to parse when we have an http(s) scheme OR a scheme-less
  // GitHub host prefix; otherwise it's a local path or a non-web URL.
  let normalized: string | null = null
  if (scheme === 'http' || scheme === 'https') {
    normalized = trimmed
  } else if (!scheme && BARE_GITHUB_RE.test(trimmed)) {
    normalized = `https://${trimmed}`
  } else if (scheme) {
    // mailto:, chrome:, data:, etc. — not local, not GitHub.
    return { kind: 'url', url: trimmed }
  } else {
    // No scheme, not a GitHub host → a local path (~/…, /abs, ./rel, bare).
    return { kind: 'local-path', path: trimmed }
  }

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    // Malformed "URL" — treat as a local path rather than dropping it.
    return { kind: 'local-path', path: trimmed }
  }

  const host = url.hostname.toLowerCase()
  if (GITHUB_HOSTS.has(host)) return parseGithubWeb(url)
  if (host === RAW_HOST) return parseRawGithubusercontent(url)
  return { kind: 'url', url: url.href }
}

/** Last non-empty path segment (a basename, for any "/"-delimited string). */
function lastSegment(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i >= 0 ? trimmed.slice(i + 1) : trimmed
}

/**
 * ENH-221 D14 — derive an Open Recent pointer from a raw Open-bar target.
 * Pure (no FS/network), so the renderer Open bar, the `duo open` socket
 * handler, and the `duo recent` CLI all compute identical labels/kinds.
 * `target` stays the raw string the user opened (the identity key + what
 * gets re-passed to reopen); only the display label is derived.
 */
export function deriveRecentEntry(
  rawTarget: string
): { target: string; label: string; kind: RecentKind } {
  const t = resolveOpenTarget(rawTarget)
  switch (t.kind) {
    case 'local-path':
      return { target: rawTarget, label: lastSegment(t.path) || rawTarget, kind: 'local' }
    case 'github-file':
      return {
        target: rawTarget,
        label: `${t.owner}/${t.repo} › ${lastSegment(t.filePath)}`,
        kind: 'github-file',
      }
    case 'github-repo':
      return { target: rawTarget, label: `${t.owner}/${t.repo}`, kind: 'github-repo' }
    case 'url':
      try {
        return { target: rawTarget, label: new URL(t.url).hostname, kind: 'url' }
      } catch {
        return { target: rawTarget, label: t.url, kind: 'url' }
      }
  }
}
