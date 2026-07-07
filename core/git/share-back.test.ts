// ENH-224 Phase 2 — unit tests for the share-back PURE helpers (arg-builders,
// parsers, meta-derivation) PLUS the runShareBack ORCHESTRATOR's branch
// behavior (ENH-224 confirm-gate hardening / PR #102 review should-fix). The
// pure helpers were the original coverage; the orchestrator was "verified live"
// (a real repo + gh) and so untested by the unit suite. The orchestrator block
// at the bottom closes that gap by mocking every collaborator runShareBack
// sequences, so the branch/commit/push/fork/PR routing — and the new
// `confirmed` gate — are pinned without spawning git/gh.
//
// Mocking strategy: the sibling collaborator modules are vi.mock'd via
// importActual so their PURE exports (parsePorcelain, pushArgs, prCreateArgs,
// permissionAllowsPush, selectPr, …) stay REAL for the helper tests above,
// while the spawning run*/probe* functions become controllable spies. The
// two in-module git calls runShareBack makes itself — resolveCheckoutContext's
// `git remote get-url origin` / `git branch --show-current` and revParseShort's
// `git rev-parse` — are driven by a mocked ./exec that dispatches on args. The
// primary-doc read is mocked at ./fs (fs/promises) to keep it filesystem-free.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks (hoisted above the imports) ────────────────────────────────
// importActual keeps each module's PURE helpers real for the helper-tests; only
// the spawning entry points are replaced. ./exec drives the in-module git calls.

vi.mock('./exec', () => ({ execGit: vi.fn() }))
vi.mock('./auth', () => ({ probeGhAuth: vi.fn() }))
vi.mock('./divergence', async (orig) => ({
  ...(await orig<typeof import('./divergence')>()),
  probeDivergence: vi.fn(),
}))
vi.mock('./branch', () => ({ runCreateBranch: vi.fn() }))
vi.mock('./commit', () => ({ runStageAndCommit: vi.fn() }))
vi.mock('./push', async (orig) => ({
  ...(await orig<typeof import('./push')>()),
  runPush: vi.fn(),
}))
vi.mock('./fork', async (orig) => ({
  ...(await orig<typeof import('./fork')>()),
  probePushAccess: vi.fn(),
  runFork: vi.fn(),
}))
vi.mock('./pr', async (orig) => ({
  ...(await orig<typeof import('./pr')>()),
  runCreatePr: vi.fn(),
  findOpenPr: vi.fn(),
}))
vi.mock('fs/promises', async (orig) => ({
  ...(await orig<typeof import('fs/promises')>()),
  // Default: the primary-doc read fails soft → docText '' (deterministic, no fs).
  readFile: vi.fn(async () => { throw new Error('mocked: no doc read') }),
}))

import {
  stripLeadingFrontmatter,
  firstHeading,
  slugify,
  branchName,
  deriveProposalMeta,
} from './proposal-meta'
import { parsePorcelain } from './divergence'
import { pushArgs } from './push'
import { permissionAllowsPush } from './fork'
import { prCreateArgs, prNumberFromUrl, prUrlFromStdout, parsePrList, selectPr } from './pr'
import { refFromCheckoutDir, isManagedCheckout, parseNumstat, isShareBackBranch, runShareBack } from './share-back'
import { looksLikeAuthFailure } from './failure-sniff'

// Mocked collaborators — imported so the tests can program their return values.
import { execGit } from './exec'
import { probeGhAuth } from './auth'
import { probeDivergence } from './divergence'
import { runCreateBranch } from './branch'
import { runStageAndCommit } from './commit'
import { runPush } from './push'
import { probePushAccess, runFork } from './fork'
import { runCreatePr, findOpenPr } from './pr'

describe('proposal-meta — stripLeadingFrontmatter', () => {
  it('drops a leading --- frontmatter block', () => {
    const md = '---\ntitle: x\ntags: [a]\n---\n# Real Heading\nbody'
    expect(stripLeadingFrontmatter(md)).toBe('# Real Heading\nbody')
  })
  it('leaves a doc with no frontmatter untouched', () => {
    expect(stripLeadingFrontmatter('# H\ntext')).toBe('# H\ntext')
  })
  it('does not treat a mid-doc --- (hr) as frontmatter', () => {
    const md = '# H\n\n---\n\nmore'
    expect(stripLeadingFrontmatter(md)).toBe(md)
  })
})

describe('proposal-meta — firstHeading', () => {
  it('extracts the first ATX heading', () => {
    expect(firstHeading('intro\n# The Title\nmore')).toBe('The Title')
  })
  it('skips frontmatter to find the heading', () => {
    expect(firstHeading('---\nx: 1\n---\n## Sub Title\n')).toBe('Sub Title')
  })
  it('strips trailing closing hashes', () => {
    expect(firstHeading('# Title ###')).toBe('Title')
  })
  it('returns null when there is no heading', () => {
    expect(firstHeading('just prose\nno headings')).toBeNull()
  })
})

describe('proposal-meta — slugify', () => {
  it('kebab-cases + lowercases', () => {
    expect(slugify('My Great Doc!')).toBe('my-great-doc')
  })
  it('collapses runs + trims hyphens', () => {
    expect(slugify('  a — b   c ')).toBe('a-b-c')
  })
  it('caps length without a trailing hyphen', () => {
    expect(slugify('a'.repeat(50), 10)).toBe('aaaaaaaaaa')
  })
  it('falls back to "doc" for all-punctuation', () => {
    expect(slugify('!!! ??? ...')).toBe('doc')
  })
})

describe('proposal-meta — branchName', () => {
  it('composes duo/<slug>-<short>', () => {
    expect(branchName('my-doc', 'a1b2c3d')).toBe('duo/my-doc-a1b2c3d')
  })
  it('sanitizes the short token + falls back', () => {
    expect(branchName('x', '')).toBe('duo/x-duo')
    expect(branchName('x', 'a/b c')).toBe('duo/x-abc')
  })
})

describe('proposal-meta — deriveProposalMeta', () => {
  it('title from first heading, slug from heading, body names the file', () => {
    const m = deriveProposalMeta({ docText: '# Roadmap Q3\nbody', fileName: 'roadmap.md', short: 'abc1234' })
    expect(m.title).toBe('Roadmap Q3')
    expect(m.branch).toBe('duo/roadmap-q3-abc1234')
    expect(m.body).toContain('roadmap.md')
    expect(m.body).toContain('Proposed via Duo')
  })
  it('falls back to the file basename when there is no heading', () => {
    const m = deriveProposalMeta({ docText: 'no heading here', fileName: 'notes.md', short: 'def5678' })
    expect(m.title).toBe('notes')
    expect(m.branch).toBe('duo/notes-def5678')
  })
})

describe('divergence — parsePorcelain', () => {
  it('extracts paths from XY-prefixed lines', () => {
    const out = ' M docs/a.md\n?? new.md\nA  staged.md\n'
    expect(parsePorcelain(out)).toEqual(['docs/a.md', 'new.md', 'staged.md'])
  })
  it('takes the NEW path of a rename', () => {
    expect(parsePorcelain('R  old/a.md -> new/b.md')).toEqual(['new/b.md'])
  })
  it('unquotes core.quotepath output', () => {
    expect(parsePorcelain(' M "spaced name.md"')).toEqual(['spaced name.md'])
  })
  it('returns [] for a clean tree', () => {
    expect(parsePorcelain('')).toEqual([])
  })
})

describe('push — pushArgs', () => {
  it('builds a plain push', () => {
    expect(pushArgs({ remote: 'origin', branch: 'duo/x' })).toEqual(['push', 'origin', 'duo/x'])
  })
  it('adds --force-with-lease on force', () => {
    expect(pushArgs({ remote: 'origin', branch: 'duo/x', force: true })).toEqual([
      'push', '--force-with-lease', 'origin', 'duo/x',
    ])
  })
  it('accepts a raw fork URL as the remote (cross-fork)', () => {
    const url = 'https://github.com/me/repo.git'
    expect(pushArgs({ remote: url, branch: 'duo/x' })).toEqual(['push', url, 'duo/x'])
  })
})

describe('fork — permissionAllowsPush', () => {
  it('WRITE / MAINTAIN / ADMIN can push', () => {
    expect(permissionAllowsPush('WRITE')).toBe(true)
    expect(permissionAllowsPush('maintain')).toBe(true)
    expect(permissionAllowsPush('ADMIN')).toBe(true)
  })
  it('READ / TRIAGE / unknown cannot push (→ fork)', () => {
    expect(permissionAllowsPush('READ')).toBe(false)
    expect(permissionAllowsPush('TRIAGE')).toBe(false)
    expect(permissionAllowsPush(undefined)).toBe(false)
    expect(permissionAllowsPush('')).toBe(false)
  })
})

describe('pr — prCreateArgs', () => {
  it('builds the gh pr create args', () => {
    expect(prCreateArgs({ base: 'main', head: 'duo/x', title: 'T', body: 'B' })).toEqual([
      'pr', 'create', '--base', 'main', '--head', 'duo/x', '--title', 'T', '--body', 'B',
    ])
  })
  it('passes a cross-fork head (owner:branch) + --draft', () => {
    expect(prCreateArgs({ base: 'main', head: 'me:duo/x', title: 'T', body: 'B', draft: true })).toEqual([
      'pr', 'create', '--base', 'main', '--head', 'me:duo/x', '--title', 'T', '--body', 'B', '--draft',
    ])
  })
})

describe('pr — prNumberFromUrl / prUrlFromStdout', () => {
  it('extracts the PR number', () => {
    expect(prNumberFromUrl('https://github.com/o/r/pull/42')).toBe(42)
    expect(prNumberFromUrl('no pull here')).toBeNull()
  })
  it('finds the https URL gh prints', () => {
    expect(prUrlFromStdout('\nhttps://github.com/o/r/pull/7\n')).toBe('https://github.com/o/r/pull/7')
  })
})

describe('pr — parsePrList', () => {
  it('parses gh pr list JSON incl. the nested headRepositoryOwner login', () => {
    const json = JSON.stringify([
      { number: 7, url: 'https://x/pull/7', state: 'OPEN', headRefName: 'duo/x', headRepositoryOwner: { login: 'me' } },
    ])
    expect(parsePrList(json)).toEqual([
      { number: 7, url: 'https://x/pull/7', state: 'OPEN', headRefName: 'duo/x', headRepositoryOwner: 'me' },
    ])
  })
  it('returns [] for empty / malformed', () => {
    expect(parsePrList('[]')).toEqual([])
    expect(parsePrList('not json')).toEqual([])
  })
})

describe('pr — selectPr (cross-fork detection + collision guard, D13)', () => {
  const alice = { number: 1, url: 'u1', state: 'OPEN', headRefName: 'duo/x', headRepositoryOwner: 'alice' }
  const bob = { number: 2, url: 'u2', state: 'OPEN', headRefName: 'duo/x', headRepositoryOwner: 'bob' }
  it('picks the PR whose head owner == the push target (cross-fork)', () => {
    expect(selectPr([alice, bob], 'bob')).toEqual(bob)
  })
  it('rejects a same-branch-name PR from ANOTHER fork (collision)', () => {
    expect(selectPr([alice], 'bob')).toBeNull()
  })
  it('is case-insensitive on the owner', () => {
    expect(selectPr([alice], 'ALICE')).toEqual(alice)
  })
  it('falls back to the first match with no owner (best-effort, e.g. status)', () => {
    expect(selectPr([alice, bob])).toEqual(alice)
    expect(selectPr([])).toBeNull()
  })
})

describe('share-back — refFromCheckoutDir', () => {
  it('parses the ref after @', () => {
    expect(refFromCheckoutDir('/x/checkouts/octocat-Spoon-Knife@main')).toBe('main')
  })
  it('handles a sanitized slashed ref', () => {
    expect(refFromCheckoutDir('/x/checkouts/o-r@release-1.x')).toBe('release-1.x')
  })
  it('returns null with no @', () => {
    expect(refFromCheckoutDir('/x/some-dir')).toBeNull()
  })
})

describe('share-back — isManagedCheckout', () => {
  const base = '/home/u/.claude/duo/checkouts'
  it('true for a dir inside the checkouts home', () => {
    expect(isManagedCheckout(`${base}/o-r@main`, base)).toBe(true)
  })
  it('false for a path outside (the user’s own tree — D4)', () => {
    expect(isManagedCheckout('/home/u/projects/my-repo', base)).toBe(false)
  })
  it('false for the base itself + for traversal escapes', () => {
    expect(isManagedCheckout(base, base)).toBe(false)
    expect(isManagedCheckout(`${base}/../../evil`, base)).toBe(false)
  })
})

describe('share-back — isShareBackBranch (PR-match gate, live-found bug)', () => {
  it('true only for the duo/ namespace', () => {
    expect(isShareBackBranch('duo/my-doc-abc1234')).toBe(true)
  })
  it('false for a baseline branch (would match a stranger’s head:main PR)', () => {
    expect(isShareBackBranch('main')).toBe(false)
    expect(isShareBackBranch('master')).toBe(false)
    expect(isShareBackBranch('release/1.x')).toBe(false)
  })
  it('false for empty / undefined', () => {
    expect(isShareBackBranch('')).toBe(false)
    expect(isShareBackBranch(undefined)).toBe(false)
    expect(isShareBackBranch(null)).toBe(false)
  })
})

describe('share-back — parseNumstat (D12 diff totals)', () => {
  it('sums additions + deletions across files', () => {
    expect(parseNumstat('3\t1\tdocs/a.md\n10\t0\tdocs/b.md\n')).toEqual({
      filesChanged: 2, additions: 13, deletions: 1,
    })
  })
  it('counts a binary file (- -) as changed with zero line stats', () => {
    expect(parseNumstat('-\t-\timg/logo.png\n2\t2\tx.md')).toEqual({
      filesChanged: 2, additions: 2, deletions: 2,
    })
  })
  it('returns zeros for an empty diff', () => {
    expect(parseNumstat('')).toEqual({ filesChanged: 0, additions: 0, deletions: 0 })
  })
})

describe('failure-sniff — looksLikeAuthFailure', () => {
  it('flags auth-shaped stderr', () => {
    expect(looksLikeAuthFailure('remote: Permission denied')).toBe(true)
    expect(looksLikeAuthFailure('fatal: Authentication failed')).toBe(true)
    expect(looksLikeAuthFailure('HTTP 403')).toBe(true)
    expect(looksLikeAuthFailure('run: gh auth login')).toBe(true)
  })
  it('does not flag unrelated errors', () => {
    expect(looksLikeAuthFailure('fatal: couldn’t find remote ref')).toBe(false)
    expect(looksLikeAuthFailure('')).toBe(false)
  })
  it('strict mode reproduces clone.ts’s pre-ENH-253 private matcher', () => {
    // Loose (share-back) matches these; strict (clone) must not.
    expect(looksLikeAuthFailure('access denied')).toBe(true)
    expect(looksLikeAuthFailure('access denied', { strict: true })).toBe(false)
    expect(looksLikeAuthFailure('run: gh auth login')).toBe(true)
    expect(looksLikeAuthFailure('run: gh auth login', { strict: true })).toBe(false)
    // gh's literal wording matches both.
    expect(looksLikeAuthFailure('please run: gh auth login', { strict: true })).toBe(true)
    expect(looksLikeAuthFailure('remote: Permission denied', { strict: true })).toBe(true)
  })
})

// ── runShareBack — orchestrator branch behavior (ENH-224 confirm-gate / PR #102)
//
// Mocks every collaborator runShareBack sequences. The in-module git calls
// (resolveCheckoutContext + revParseShort) ride a dispatching ./exec mock so the
// checkout resolves to a deterministic origin/owner/repo/branch without a repo.
// CHECKOUT_DIR is a fake path under the managed home; nothing on disk is touched.

const CHECKOUT_DIR = '/home/u/.claude/duo/checkouts/octocat-Spoon-Knife@main'

const ok = (stdout = '') => ({ ok: true, stdout, stderr: '', exitCode: 0, notFound: false })

/** Program the ./exec mock to answer the git calls resolveCheckoutContext +
 *  revParseShort make. `currentBranch` defaults to 'main' (a baseline branch →
 *  resolveBaseBranch returns it directly, no `gh repo view` call). */
function programExec(opts: { currentBranch?: string } = {}) {
  const currentBranch = opts.currentBranch ?? 'main'
  vi.mocked(execGit).mockImplementation(async (_bin: 'git' | 'gh', args: string[]) => {
    const joined = args.join(' ')
    if (joined === 'remote get-url origin') return ok('https://github.com/octocat/Spoon-Knife.git\n')
    if (joined === 'branch --show-current') return ok(currentBranch + '\n')
    if (args[0] === 'rev-parse') return ok('d0dd1f6\n')
    // Any unexpected call → a clean failure (surfaces as a test-visible miss).
    return { ok: false, stdout: '', stderr: 'unexpected execGit: ' + joined, exitCode: 1, notFound: false }
  })
}

describe('runShareBack — confirm gate + branch routing (ENH-224 / PR #102)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Sensible authed + diverged defaults; each test overrides as needed.
    programExec()
    vi.mocked(probeGhAuth).mockResolvedValue({ ghInstalled: true, authenticated: true, host: 'github.com', user: 'me', ghNotFound: false })
    vi.mocked(probeDivergence).mockResolvedValue({ diverged: true, changedFiles: ['README.md'] })
    vi.mocked(runCreateBranch).mockResolvedValue({ ok: true, created: true })
    vi.mocked(runStageAndCommit).mockResolvedValue({ ok: true, committed: true })
    vi.mocked(probePushAccess).mockResolvedValue({ canPush: true, viewerPermission: 'WRITE' })
    vi.mocked(runFork).mockResolvedValue({ ok: true, forkOwner: 'me' })
    vi.mocked(runPush).mockResolvedValue({ ok: true })
    vi.mocked(findOpenPr).mockResolvedValue(null)
    vi.mocked(runCreatePr).mockResolvedValue({
      ok: true,
      pr: { number: 7, url: 'https://github.com/octocat/Spoon-Knife/pull/7', state: 'OPEN', headRefName: 'duo/x' },
    })
  })

  it('refuses without confirmation (BEFORE any mutation) → needs-confirmation', async () => {
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: false })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected refusal')
    expect(res.errorKind).toBe('needs-confirmation')
    // The gate sits before ANY branch/commit/push/fork/PR.
    expect(runCreateBranch).not.toHaveBeenCalled()
    expect(runStageAndCommit).not.toHaveBeenCalled()
    expect(probePushAccess).not.toHaveBeenCalled()
    expect(runFork).not.toHaveBeenCalled()
    expect(runPush).not.toHaveBeenCalled()
    expect(runCreatePr).not.toHaveBeenCalled()
  })

  it('also refuses when confirmed is OMITTED entirely (default-off gate)', async () => {
    const res = await runShareBack(CHECKOUT_DIR) // no opts at all
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected refusal')
    expect(res.errorKind).toBe('needs-confirmation')
    expect(runCreateBranch).not.toHaveBeenCalled()
    expect(runPush).not.toHaveBeenCalled()
    expect(runCreatePr).not.toHaveBeenCalled()
  })

  it('happy path (push access, no existing PR) → created, pushed to origin', async () => {
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.action).toBe('created')
    expect(res.forked).toBe(false)
    expect(res.pushedTo).toBe('octocat') // origin owner, no fork
    expect(res.pr.number).toBe(7)
    // Pushed to origin (push access) — never forked.
    expect(runFork).not.toHaveBeenCalled()
    expect(runPush).toHaveBeenCalledTimes(1)
    const pushArg = vi.mocked(runPush).mock.calls[0][1]
    expect(pushArg.remote).toBe('origin')
    // The derived branch is the duo/<slug>-<short> namespace; the PR head is
    // that bare branch (same-repo, no fork prefix).
    expect(pushArg.branch).toMatch(/^duo\//)
    expect(runCreatePr).toHaveBeenCalledTimes(1)
    const prArg = vi.mocked(runCreatePr).mock.calls[0][1]
    expect(prArg.head).toBe(pushArg.branch) // same-repo head — no `owner:` prefix
    expect(prArg.base).toBe('main')
  })

  it('auto-fork path (no push access) → forked, prHead is forkOwner:branch, pushed to the fork URL', async () => {
    vi.mocked(probePushAccess).mockResolvedValue({ canPush: false, viewerPermission: 'READ' })
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.forked).toBe(true)
    expect(res.pushedTo).toBe('me') // the fork owner
    expect(runFork).toHaveBeenCalledTimes(1)
    expect(runFork).toHaveBeenCalledWith('octocat', 'Spoon-Knife', CHECKOUT_DIR)
    // Pushed to the fork URL, not origin.
    const pushArg = vi.mocked(runPush).mock.calls[0][1]
    expect(pushArg.remote).toBe('https://github.com/me/Spoon-Knife.git')
    // The cross-fork PR head carries the fork owner prefix.
    const prArg = vi.mocked(runCreatePr).mock.calls[0][1]
    expect(prArg.head).toBe('me:' + pushArg.branch)
    // findOpenPr is asked with the fork owner so a stranger's same-named branch
    // can't be mistaken for ours (D13).
    expect(findOpenPr).toHaveBeenCalledWith(CHECKOUT_DIR, 'me:' + pushArg.branch, { owner: 'me' })
  })

  it('existing-PR path (findOpenPr returns a PR) → updated, no runCreatePr', async () => {
    const existing = { number: 42, url: 'https://github.com/octocat/Spoon-Knife/pull/42', state: 'OPEN', headRefName: 'duo/x', headRepositoryOwner: 'octocat' }
    vi.mocked(findOpenPr).mockResolvedValue(existing)
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.action).toBe('updated')
    expect(res.pr.number).toBe(42)
    // The push already updated the open PR — no fresh PR is created (D13).
    expect(runCreatePr).not.toHaveBeenCalled()
  })

  it('no-divergence short-circuits BEFORE the confirm gate (and any mutation)', async () => {
    vi.mocked(probeDivergence).mockResolvedValue({ diverged: false, changedFiles: [] })
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected no-divergence')
    expect(res.errorKind).toBe('no-divergence')
    expect(runCreateBranch).not.toHaveBeenCalled()
  })

  it('auth-missing short-circuits with a gh-auth bounce (no divergence probe, no mutation)', async () => {
    vi.mocked(probeGhAuth).mockResolvedValue({ ghInstalled: true, authenticated: false, ghNotFound: false })
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected auth-missing')
    expect(res.errorKind).toBe('auth-missing')
    expect(res.error).toMatch(/gh auth login/)
    expect(probeDivergence).not.toHaveBeenCalled()
    expect(runCreateBranch).not.toHaveBeenCalled()
  })

  it('not-a-checkout (no origin remote) returns early before the auth probe', async () => {
    vi.mocked(execGit).mockImplementation(async (_bin, args) => {
      if (args.join(' ') === 'remote get-url origin') {
        return { ok: false, stdout: '', stderr: 'no origin', exitCode: 1, notFound: false }
      }
      return ok('')
    })
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected not-a-checkout')
    expect(res.errorKind).toBe('not-a-checkout')
    expect(probeGhAuth).not.toHaveBeenCalled()
  })

  it('a re-proposal (already on a duo/ branch) REUSES that branch as the PR head', async () => {
    programExec({ currentBranch: 'duo/existing-abc1234' })
    const res = await runShareBack(CHECKOUT_DIR, { confirmed: true })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    const pushArg = vi.mocked(runPush).mock.calls[0][1]
    expect(pushArg.branch).toBe('duo/existing-abc1234') // reused, not re-derived
  })
})
