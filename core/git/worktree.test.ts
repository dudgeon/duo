// ENH-210 — worktree porcelain parser tests. Pins the
// `git worktree list --porcelain` parse + the main-first / isCurrent
// flagging so a future refactor can't silently regress the navigator
// Worktrees section or `duo worktree list`. Live git-shell coverage is
// left to the smoke walk (this worktree is itself a linked worktree —
// a built-in fixture).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  parseWorktreePorcelain,
  slugifyWorktreeName,
  nextAvailableSlug,
  createWorktree,
  removeWorktree
} from './worktree'
import { execFileSync } from 'child_process'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'

// A realistic three-worktree porcelain dump: main + two linked, one of
// which is detached and one stale/prunable.
const PORCELAIN = `worktree /Users/me/code/duo
HEAD 97b0fe3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /Users/me/code/duo/.claude/worktrees/fix-auth
HEAD fd89d56bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/claude/fix-auth-flow

worktree /Users/me/code/duo/.claude/worktrees/detached-one
HEAD afdb8c1ccccccccccccccccccccccccccccccccc
detached

worktree /Users/me/code/duo/.claude/worktrees/stale
HEAD 5eca4b1ddddddddddddddddddddddddddddddddd
branch refs/heads/old-thing
prunable gitdir file points to non-existent location
`

describe('parseWorktreePorcelain', () => {
  const rows = parseWorktreePorcelain(PORCELAIN, '/Users/me/code/duo/.claude/worktrees/fix-auth')

  it('parses one row per worktree block', () => {
    expect(rows).toHaveLength(4)
  })

  it('flags the first block as the main worktree', () => {
    expect(rows[0].isMain).toBe(true)
    expect(rows[0].path).toBe('/Users/me/code/duo')
    expect(rows.slice(1).every((r) => !r.isMain)).toBe(true)
  })

  it('strips refs/heads/ from the branch and truncates HEAD to 7 chars', () => {
    expect(rows[0].branch).toBe('main')
    expect(rows[1].branch).toBe('claude/fix-auth-flow')
    expect(rows[0].head).toBe('97b0fe3')
  })

  it('flags isCurrent on the worktree matching the queried root', () => {
    const current = rows.filter((r) => r.isCurrent)
    expect(current).toHaveLength(1)
    expect(current[0].path).toBe('/Users/me/code/duo/.claude/worktrees/fix-auth')
  })

  it('marks detached worktrees and leaves their branch empty', () => {
    const detached = rows.find((r) => r.path.endsWith('detached-one'))
    expect(detached?.detached).toBe(true)
    expect(detached?.branch).toBe('')
  })

  it('marks prunable (stale) worktrees', () => {
    const stale = rows.find((r) => r.path.endsWith('stale'))
    expect(stale?.prunable).toBe(true)
  })

  it('assigns a hash-stable colorIndex in [0, 6)', () => {
    rows.forEach((r) => {
      expect(r.colorIndex).toBeGreaterThanOrEqual(0)
      expect(r.colorIndex).toBeLessThan(6)
    })
    // Same path → same index (determinism).
    const again = parseWorktreePorcelain(PORCELAIN, '')
    expect(again[1].colorIndex).toBe(rows[1].colorIndex)
  })

  it('tolerates trailing-slash differences in the current-root match', () => {
    const withSlash = parseWorktreePorcelain(PORCELAIN, '/Users/me/code/duo/.claude/worktrees/fix-auth/')
    expect(withSlash.find((r) => r.isCurrent)?.path).toBe('/Users/me/code/duo/.claude/worktrees/fix-auth')
  })

  it('returns [] for empty input', () => {
    expect(parseWorktreePorcelain('', '')).toEqual([])
  })
})

// ENH-221 — slug sanitization for `duo worktree new` + the navigator
// inline-create form (Variant A). The created name must be safe as BOTH a
// directory and a git ref, so this is the crash-prevention spine of the
// create flow — pinned here so a refactor can't loosen the allow-list.
describe('slugifyWorktreeName', () => {
  it('replaces spaces (and underscores) with single hyphens', () => {
    expect(slugifyWorktreeName('Q3 pricing page copy')).toBe('q3-pricing-page-copy')
    expect(slugifyWorktreeName('fix_the_auth_flow')).toBe('fix-the-auth-flow')
  })

  it('lowercases', () => {
    expect(slugifyWorktreeName('FixAuth')).toBe('fixauth')
  })

  it('strips characters that would break a filename or a git ref', () => {
    // ':' '&' '!' are dropped; the worked example from the mock.
    expect(slugifyWorktreeName('Q3 Pricing: Copy & v2!')).toBe('q3-pricing-copy-v2')
    // git-ref-hostile chars are all removed by the allow-list.
    expect(slugifyWorktreeName('a~b^c:d?e*f[g\\h')).toBe('abcdefgh')
    expect(slugifyWorktreeName('feature/sub')).toBe('featuresub') // no nested ref paths
    expect(slugifyWorktreeName('emoji 🎲 name')).toBe('emoji-name')
  })

  it('collapses repeated hyphens and trims leading/trailing ones', () => {
    expect(slugifyWorktreeName('  --hello---world--  ')).toBe('hello-world')
    expect(slugifyWorktreeName('...dots...')).toBe('dots')
  })

  it('caps length and never leaves a trailing hyphen after the cut', () => {
    const long = slugifyWorktreeName('a'.repeat(80))
    expect(long.length).toBe(50)
    // A slice that lands mid-hyphen-run still trims clean.
    const trimmed = slugifyWorktreeName('x'.repeat(49) + ' y')
    expect(trimmed.endsWith('-')).toBe(false)
  })

  it('returns empty string when nothing usable survives (caller auto-names)', () => {
    expect(slugifyWorktreeName('🎲 ✨ !!! ')).toBe('')
    expect(slugifyWorktreeName('')).toBe('')
    expect(slugifyWorktreeName('   ')).toBe('')
  })
})

describe('nextAvailableSlug', () => {
  it('returns the base slug when it is free', () => {
    expect(nextAvailableSlug('fix-auth', () => false)).toBe('fix-auth')
  })

  it('appends -2, -3, … past collisions', () => {
    const used = new Set(['fix-auth', 'fix-auth-2'])
    expect(nextAvailableSlug('fix-auth', (s) => used.has(s))).toBe('fix-auth-3')
  })

  it('skips only the taken ones (gaps are fine)', () => {
    const used = new Set(['fix-auth'])
    expect(nextAvailableSlug('fix-auth', (s) => used.has(s))).toBe('fix-auth-2')
  })
})

// ENH-221 — live git coverage for the WRITE path (createWorktree /
// removeWorktree). Hermetic: a throwaway repo in os.tmpdir(). This is the
// risky path (Duo's first git mutation), so it gets a real shell-out test
// rather than being deferred to the smoke walk like the read paths.
describe('createWorktree / removeWorktree (live git)', () => {
  let repo = ''
  let nonRepo = ''

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-wt-'))
    nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'duo-norepo-'))
    const g = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
    }
    g('init', '-b', 'main')
    g('config', 'user.email', 'test@duo.local')
    g('config', 'user.name', 'Duo Test')
    fs.writeFileSync(path.join(repo, 'README.md'), '# temp\n')
    g('add', '.')
    g('commit', '-m', 'init')
  })

  afterAll(() => {
    for (const d of [repo, nonRepo]) {
      try {
        if (d) fs.rmSync(d, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  })

  it('creates a worktree off main with a sanitized branch + folder', async () => {
    const r = await createWorktree(repo, { name: 'My Test Feature' })
    expect(r.ok).toBe(true)
    expect(r.slug).toBe('my-test-feature')
    expect(r.branch).toBe('claude/my-test-feature')
    expect(!!r.path && fs.existsSync(r.path)).toBe(true)
    const list = execFileSync('git', ['worktree', 'list'], { cwd: repo }).toString()
    expect(list).toContain('my-test-feature')
  })

  it('suffixes -2 on a name collision', async () => {
    const r = await createWorktree(repo, { name: 'my-test-feature' })
    expect(r.ok).toBe(true)
    expect(r.slug).toBe('my-test-feature-2')
  })

  it('removes a worktree and deletes its directory', async () => {
    const made = await createWorktree(repo, { name: 'to remove' })
    expect(made.ok).toBe(true)
    const rm = await removeWorktree(made.path as string)
    expect(rm.ok).toBe(true)
    expect(fs.existsSync(made.path as string)).toBe(false)
  })

  it('fails cleanly outside a repo and on an all-illegal name', async () => {
    const outside = await createWorktree(nonRepo, { name: 'x' })
    expect(outside.ok).toBe(false)
    expect(outside.error).toMatch(/repository/i)

    const empty = await createWorktree(repo, { name: '🎲 ✨ !!!' })
    expect(empty.ok).toBe(false)
  })
})
