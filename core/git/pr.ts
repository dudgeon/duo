// ENH-224 Phase 2 — open / find a pull request (P6/P7).
//
// Wraps `gh pr create` + `gh pr list`. PR state is read LIVE (§12) — never
// mirrored. `head` is the branch for a same-repo PR, or `<forkOwner>:<branch>`
// for a cross-fork PR (D3).

import { execGit } from './exec'
import type { PrInfo } from '../../shared/types'

export interface PrCreateOpts {
  base: string
  /** branch (same-repo) or `owner:branch` (cross-fork). */
  head: string
  title: string
  body: string
  draft?: boolean
}

/** `gh pr create` args. Pure + exported for unit testing without spawning. */
export function prCreateArgs(opts: PrCreateOpts): string[] {
  const args = [
    'pr', 'create',
    '--base', opts.base,
    '--head', opts.head,
    '--title', opts.title,
    '--body', opts.body,
  ]
  if (opts.draft) args.push('--draft')
  return args
}

/** Extract the PR number from a `…/pull/<n>` URL. Pure. Returns null on no match. */
export function prNumberFromUrl(url: string): number | null {
  const m = /\/pull\/(\d+)/.exec(url || '')
  return m ? parseInt(m[1], 10) : null
}

/** The first https URL token in gh's stdout (gh prints the new PR's URL). Pure. */
export function prUrlFromStdout(stdout: string): string {
  const tokens = (stdout || '').trim().split(/\s+/)
  return tokens.find((t) => /^https?:\/\//.test(t)) ?? (stdout || '').trim()
}

/** Parse `gh pr list --json number,url,state,headRefName,headRepositoryOwner`
 *  output. Pure. gh nests the owner as `{ login }`. */
export function parsePrList(stdout: string): PrInfo[] {
  try {
    const arr = JSON.parse(stdout) as Array<{
      number?: number
      url?: string
      state?: string
      headRefName?: string
      headRepositoryOwner?: { login?: string } | null
    }>
    if (!Array.isArray(arr)) return []
    return arr
      .filter((p) => typeof p.number === 'number' && typeof p.url === 'string')
      .map((p) => ({
        number: p.number as number,
        url: p.url as string,
        state: p.state ?? 'OPEN',
        headRefName: p.headRefName,
        headRepositoryOwner: p.headRepositoryOwner?.login,
      }))
  } catch {
    return []
  }
}

/**
 * Pick the PR that belongs to us from a `gh pr list --head <branch>` result.
 * Pure + exported for unit testing. When `owner` is given (the repo the branch
 * was pushed to — the fork for a cross-fork PR, else the base owner), require a
 * matching `headRepositoryOwner` so a same-named branch in someone ELSE's fork
 * can't be mistaken for ours (the cross-fork detection + collision guard, D13).
 * Without `owner`, fall back to the first match (best-effort, e.g. status).
 */
export function selectPr(list: PrInfo[], owner?: string): PrInfo | null {
  if (owner) {
    const want = owner.toLowerCase()
    return list.find((p) => (p.headRepositoryOwner ?? '').toLowerCase() === want) ?? null
  }
  return list[0] ?? null
}

export interface PrCreateResult { ok: boolean; pr?: PrInfo; error?: string }

export async function runCreatePr(cwd: string, opts: PrCreateOpts): Promise<PrCreateResult> {
  const res = await execGit('gh', prCreateArgs(opts), { cwd, timeoutMs: 60_000 })
  if (!res.ok) return { ok: false, error: res.stderr.trim() || res.stdout.trim() || 'gh pr create failed' }
  const url = prUrlFromStdout(res.stdout)
  return {
    ok: true,
    pr: { number: prNumberFromUrl(url) ?? 0, url, state: 'OPEN', headRefName: opts.head },
  }
}

/**
 * Find an OPEN PR for `head`. `head` is a bare branch (same-repo) or
 * `owner:branch` (cross-fork). `gh pr list --head` filters by the bare branch
 * name, so a cross-fork PR is matched by ALSO requiring its
 * headRepositoryOwner === the fork owner (parsed from `head`, or `opts.owner`
 * when the caller knows the push target). Returns null when none / on error.
 */
export async function findOpenPr(
  cwd: string,
  head: string,
  opts: { owner?: string } = {}
): Promise<PrInfo | null> {
  const branch = head.includes(':') ? head.split(':')[1] : head
  if (!branch) return null
  const owner = opts.owner ?? (head.includes(':') ? head.split(':')[0] : undefined)
  const res = await execGit(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,state,headRefName,headRepositoryOwner'],
    { cwd }
  )
  if (!res.ok) return null
  return selectPr(parsePrList(res.stdout), owner)
}
