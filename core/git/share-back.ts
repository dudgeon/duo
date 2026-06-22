// ENH-224 Phase 2 — the share-back orchestrator (P6/P7).
//
// Sequences the whole "Propose changes" → PR flow against a managed checkout:
//   resolve context (live from git) → divergence gate → prefill (D7) → branch →
//   commit → push-access check → AUTO-FORK if no push access (D3) → push →
//   create-or-update the PR (D13).
//
// §12 (no sidecar): everything is read LIVE from the checkout's git + gh. The
// checkout dir (a real git repo) IS the source of truth — owner/repo from its
// origin remote, the base branch from its current branch, PR state from `gh`.

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { execGit } from './exec'
import { parseRemoteUrl } from './remote-url'
import { probeGhAuth } from './auth'
import { probeDivergence } from './divergence'
import { runCreateBranch } from './branch'
import { runStageAndCommit } from './commit'
import { runPush } from './push'
import { probePushAccess, runFork } from './fork'
import { runCreatePr, findOpenPr } from './pr'
import { deriveProposalMeta } from './proposal-meta'
import { isLikelySha } from '../open-checkout'
import type {
  CheckoutContext,
  DiffStat,
  ShareBackDiff,
  ShareBackResult,
  ShareBackStatus,
} from '../../shared/types'

/** The managed-checkout home (D4). Matches open-checkout's default. */
const CHECKOUTS_BASE = path.join(os.homedir(), '.claude', 'duo', 'checkouts')

/** Is `dir` inside the managed-checkout home? Pure. Guards share-back so it
 *  only ever touches Duo-owned checkouts, never the user's own working tree. */
export function isManagedCheckout(dir: string, base: string = CHECKOUTS_BASE): boolean {
  const rel = path.relative(base, dir)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Resolve a file/dir path → its enclosing managed-checkout dir (the git repo
 * root), or null when the path isn't inside a Duo-managed checkout. The PR
 * verbs accept a path the user is editing; share-back operates on its checkout.
 */
export async function resolveCheckoutDirForPath(p: string): Promise<string | null> {
  let startDir = p
  try {
    const st = await fs.stat(p)
    if (st.isFile()) startDir = path.dirname(p)
  } catch {
    startDir = path.dirname(p)
  }
  // Fast reject (perf): the share-back STATUS poll fires on every active-doc
  // save, so skip the `git rev-parse` subprocess for any path that can't be a
  // managed checkout — i.e. anything not under ~/.claude/duo/checkouts/. Only
  // a path inside the home pays for the git resolution below.
  if (!isManagedCheckout(startDir)) return null
  const top = await execGit('git', ['rev-parse', '--show-toplevel'], { cwd: startDir })
  if (!top.ok || !top.stdout.trim()) return null
  const root = top.stdout.trim()
  return isManagedCheckout(root) ? root : null
}

export interface ExportResult { ok: boolean; dest?: string; error?: string }

/**
 * ENH-224 Phase 4 (D4 escape hatch — "save a real local copy here…"). Copy a
 * file FROM a managed checkout to a real local `destPath` (creating parent
 * dirs). Guards that `srcPath` is inside the managed home so this stays the
 * checkout-escape, not a general file copy.
 */
export async function exportCheckoutFile(srcPath: string, destPath: string): Promise<ExportResult> {
  const checkoutDir = await resolveCheckoutDirForPath(srcPath)
  if (!checkoutDir) return { ok: false, error: 'Source is not inside a Duo-managed checkout.' }
  if (!destPath || !destPath.trim()) return { ok: false, error: 'A destination path is required.' }
  // Refuse to clobber — the escape hatch SAVES a copy, it never silently
  // overwrites an existing file (pick a fresh dest, or remove the old one).
  try {
    await fs.access(destPath)
    return { ok: false, error: `Destination already exists: ${destPath}` }
  } catch {
    // dest doesn't exist — good, proceed.
  }
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.copyFile(srcPath, destPath)
    return { ok: true, dest: destPath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Parse the ref a managed checkout was created at from its dir name
 *  (`<owner>-<repo>@<ref>`). Pure. Returns null when the name has no `@`.
 *  Note: the ref was sanitized by managedCheckoutDir, so a slashed branch is
 *  lossy here — only a fallback (the live current branch is preferred). */
export function refFromCheckoutDir(checkoutDir: string): string | null {
  const base = path.basename(checkoutDir)
  const at = base.indexOf('@')
  if (at < 0) return null
  return base.slice(at + 1) || null
}

/** Resolve the upstream repo + base/current branches LIVE from the checkout's
 *  git. Returns null when it isn't a git repo with a parseable origin. */
export async function resolveCheckoutContext(checkoutDir: string): Promise<CheckoutContext | null> {
  const remote = await execGit('git', ['remote', 'get-url', 'origin'], { cwd: checkoutDir })
  if (!remote.ok || !remote.stdout.trim()) return null
  const parsed = parseRemoteUrl(remote.stdout.trim())
  if (!parsed) return null

  const cur = await execGit('git', ['branch', '--show-current'], { cwd: checkoutDir })
  const currentBranch = cur.ok ? cur.stdout.trim() : ''
  const baseBranch = await resolveBaseBranch(checkoutDir, parsed.owner, parsed.repo, currentBranch)
  return { owner: parsed.owner, repo: parsed.repo, host: parsed.host, baseBranch, currentBranch }
}

/** The PR base branch. While still on the baseline branch (the common
 *  pre-proposal state) THAT is the base — its real, unsanitized name. Once on a
 *  `duo/…` share-back branch (a re-proposal — base is then unused, the existing
 *  PR is updated) or for a SHA permalink, fall back to the repo's default
 *  branch. */
async function resolveBaseBranch(
  checkoutDir: string,
  owner: string,
  repo: string,
  currentBranch: string
): Promise<string> {
  if (currentBranch && !currentBranch.startsWith('duo/')) return currentBranch
  const def = await execGit(
    'gh',
    ['repo', 'view', `${owner}/${repo}`, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    { cwd: checkoutDir }
  )
  if (def.ok && def.stdout.trim()) return def.stdout.trim()
  const ref = refFromCheckoutDir(checkoutDir)
  return ref && !isLikelySha(ref) ? ref : 'main'
}

export interface ShareBackOpts {
  /** Repo-relative path of the doc being proposed (drives the prefill + which
   *  files are staged). Omitted → the first changed file. */
  filePath?: string
  /** Overrides for the D7 prefill. */
  title?: string
  body?: string
  branch?: string
  draft?: boolean
  /** ENH-224 — explicit go-ahead to push a branch / open a PR under the user's
   *  GitHub identity. The UI sets it (the "Propose changes" sheet IS the gate);
   *  the CLI sets it only with `--yes`. Without it runShareBack refuses BEFORE
   *  any fork/push/PR, so an agent on the bare socket can't propose silently. */
  confirmed?: boolean
}

/**
 * Run the full share-back (P6/P7). Returns a structured result the CLI + the
 * (deferred) footer affordance both render.
 */
export async function runShareBack(checkoutDir: string, opts: ShareBackOpts = {}): Promise<ShareBackResult> {
  const ctx = await resolveCheckoutContext(checkoutDir)
  if (!ctx) {
    return { ok: false, errorKind: 'not-a-checkout', error: 'Not a managed checkout (no git origin remote).' }
  }

  const auth = await probeGhAuth()
  if (!auth.authenticated) {
    const prefix = auth.ghNotFound ? 'GitHub CLI (gh) not found — install it, then ' : ''
    return { ok: false, errorKind: 'auth-missing', error: prefix + 'run `gh auth login`, then retry.' }
  }

  const div = await probeDivergence(checkoutDir)
  if (!div.diverged) {
    return { ok: false, errorKind: 'no-divergence', error: 'No changes to propose — the doc matches its source.' }
  }

  // ENH-224 — refuse to fork / push / open a PR without explicit confirmation.
  // The UI path sets opts.confirmed (the "Propose changes" sheet IS the gate);
  // the CLI sets it only with `--yes`. The bare socket/agent path does NOT, so an
  // agent can't fork the repo + open a public PR under the user's identity
  // silently. Sits before ANY mutation (branch/commit/push/fork/PR).
  if (!opts.confirmed) {
    return {
      ok: false,
      errorKind: 'needs-confirmation',
      error: 'Refusing to push a branch or open a PR without confirmation. Re-run `duo pr create` with `--yes`, or use the "Propose changes" button.',
    }
  }

  // Primary doc → prefill (D7). opts override the derived defaults.
  const primary = opts.filePath ?? div.changedFiles[0]
  const fileName = primary ? primary.split('/').pop() ?? primary : 'document'
  let docText = ''
  if (primary) {
    try {
      docText = await fs.readFile(path.join(checkoutDir, primary), 'utf8')
    } catch {
      // binary / deleted — fall back to the filename for slug + title.
    }
  }
  const short = await revParseShort(checkoutDir)
  const meta = deriveProposalMeta({ docText, fileName, short })
  // Re-proposal: when we're ALREADY on a `duo/…` share-back branch, REUSE it so
  // the same PR updates (D13). Deriving a fresh name here (the short would be the
  // new HEAD's) would fork a second branch + a duplicate PR. First proposal (on
  // the baseline branch) → the derived name. opts.branch always wins.
  const branch = opts.branch
    || (ctx.currentBranch.startsWith('duo/') ? ctx.currentBranch : meta.branch)
  const title = opts.title || meta.title
  const body = opts.body || meta.body

  // Branch (idempotent — re-proposals reuse the same branch).
  const br = await runCreateBranch(checkoutDir, branch)
  if (!br.ok) return { ok: false, errorKind: 'branch-failed', error: br.error ?? 'could not create the branch.' }

  // Commit whatever diverged in the checkout (OQ-3 — PR scoped to the checkout).
  const commit = await runStageAndCommit(checkoutDir, { message: title, paths: div.changedFiles })
  if (!commit.ok) return { ok: false, errorKind: 'commit-failed', error: commit.error ?? 'commit failed.' }
  // Diverged but nothing actually committed (a race, or the change was already
  // on the branch) → don't push an empty PR. Treat as no-divergence.
  if (!commit.committed) {
    return { ok: false, errorKind: 'no-divergence', error: 'No new changes were committed.' }
  }

  // Push access → origin, else AUTO-FORK (D3).
  const access = await probePushAccess(ctx.owner, ctx.repo, checkoutDir)
  let forked = false
  let pushRemote = 'origin'
  let prHead = branch
  let pushedTo = ctx.owner
  if (!access.canPush) {
    const fork = await runFork(ctx.owner, ctx.repo, checkoutDir)
    if (!fork.ok || !fork.forkOwner) {
      return { ok: false, errorKind: 'fork-failed', error: fork.error ?? 'could not fork the repo.' }
    }
    forked = true
    pushRemote = `https://github.com/${fork.forkOwner}/${ctx.repo}.git`
    prHead = `${fork.forkOwner}:${branch}`
    pushedTo = fork.forkOwner
  }

  // Push the branch (to the fork URL or origin).
  const push = await runPush(checkoutDir, { remote: pushRemote, branch })
  if (!push.ok) {
    return {
      ok: false,
      errorKind: push.errorKind === 'auth-missing' ? 'auth-missing' : 'push-failed',
      error: push.error ?? 'push failed.',
    }
  }

  // Already a PR for this head? The push just updated it (D13). Else create.
  // Pass `pushedTo` so a cross-fork PR is matched by the FORK owner (gh pr list
  // --head filters by the bare branch name across all forks).
  const existing = await findOpenPr(checkoutDir, prHead, { owner: pushedTo })
  if (existing) {
    return { ok: true, pr: existing, pushedTo, forked, action: 'updated' }
  }
  const created = await runCreatePr(checkoutDir, { base: ctx.baseBranch, head: prHead, title, body, draft: opts.draft })
  if (!created.ok || !created.pr) {
    return { ok: false, errorKind: 'pr-failed', error: created.error ?? 'could not open the pull request.' }
  }
  return { ok: true, pr: created.pr, pushedTo, forked, action: 'created' }
}

/** A share-back working branch — the `duo/…` namespace runShareBack creates.
 *  Pure. ONLY such a branch can own a PR for this checkout: a doc still on its
 *  baseline branch (e.g. `main`) has none, and `gh pr list --head main` in a
 *  popular repo would otherwise match an unrelated fork's PR. */
export function isShareBackBranch(branch: string | undefined | null): boolean {
  return !!branch && branch.startsWith('duo/')
}

/** `duo pr status` — divergence + any open PR for the checkout's current
 *  branch. All live (§12). */
export async function probeShareBackStatus(checkoutDir: string): Promise<ShareBackStatus> {
  const context = await resolveCheckoutContext(checkoutDir)
  const divergence = await probeDivergence(checkoutDir)
  // Only match a PR when we're on a `duo/…` share-back branch — on the baseline
  // branch the doc has no PR of ours, and `--head <baseline>` would surface a
  // stranger's same-named PR. (Caught live against octocat/Spoon-Knife, which
  // has many open `head:main` PRs from forks.)
  let pr = null
  if (isShareBackBranch(context?.currentBranch)) {
    // Constrain by head owner so a stranger's same-named `duo/…` branch in
    // another fork isn't matched. OUR PR's head is on origin (= context.owner,
    // push access) OR our fork (= the gh login); selectPr matches either.
    const me = await execGit('gh', ['api', 'user', '--jq', '.login'], { cwd: checkoutDir })
    const owners = [context?.owner, me.ok ? me.stdout.trim() : ''].filter(Boolean) as string[]
    pr = await findOpenPr(checkoutDir, context!.currentBranch, owners.length ? { owner: owners } : {})
  }
  return { context, divergence, pr }
}

async function revParseShort(cwd: string): Promise<string> {
  const res = await execGit('git', ['rev-parse', '--short=7', 'HEAD'], { cwd })
  return res.ok && res.stdout.trim() ? res.stdout.trim() : 'duo'
}

/** Parse `git diff --numstat` → totals. Pure. Each line is
 *  `<added>\t<deleted>\t<path>`; a binary file reports `-` for both, counted as
 *  a changed file with zero line stats. */
export function parseNumstat(stdout: string): DiffStat {
  let filesChanged = 0
  let additions = 0
  let deletions = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const m = /^(\S+)\t(\S+)\t(.+)$/.exec(line)
    if (!m) continue
    filesChanged++
    if (m[1] !== '-') additions += parseInt(m[1], 10) || 0
    if (m[2] !== '-') deletions += parseInt(m[2], 10) || 0
  }
  return { filesChanged, additions, deletions }
}

/**
 * The working-tree diff vs the baseline (`git diff HEAD`) for the confirm
 * sheet's inline view (D12). `filePath` (repo-relative) scopes it to one doc;
 * omitted → the whole checkout. Thin; any git error returns ok:false.
 */
export async function probeDiff(checkoutDir: string, filePath?: string): Promise<ShareBackDiff> {
  const scope = filePath ? ['--', filePath] : []
  const empty: DiffStat = { filesChanged: 0, additions: 0, deletions: 0 }
  const diff = await execGit('git', ['diff', 'HEAD', ...scope], { cwd: checkoutDir })
  if (!diff.ok) return { ok: false, diff: '', stat: empty, error: diff.stderr.trim() || 'git diff failed' }
  const numstat = await execGit('git', ['diff', '--numstat', 'HEAD', ...scope], { cwd: checkoutDir })
  const stat = numstat.ok ? parseNumstat(numstat.stdout) : empty
  // D7 prefill for the confirm sheet — only when scoped to a single doc.
  let proposalMeta
  if (filePath) {
    let docText = ''
    try {
      docText = await fs.readFile(path.join(checkoutDir, filePath), 'utf8')
    } catch {
      /* binary / gone — fall back to the filename */
    }
    const short = await revParseShort(checkoutDir)
    proposalMeta = deriveProposalMeta({ docText, fileName: filePath.split('/').pop() ?? filePath, short })
  }
  return { ok: true, diff: diff.stdout, stat, proposalMeta }
}
