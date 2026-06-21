// ENH-224 Phase 2 — unit tests for the share-back PURE helpers (arg-builders,
// parsers, meta-derivation). The spawning run* orchestrators are verified live
// (a real repo + gh), mirroring clone.test.ts which tests cloneExtraArgs but
// not runClone.

import { describe, it, expect } from 'vitest'
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
import { refFromCheckoutDir, isManagedCheckout, parseNumstat } from './share-back'
import { looksLikeAuthFailure } from './failure-sniff'

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
})
