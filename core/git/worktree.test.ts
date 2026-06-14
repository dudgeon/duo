// ENH-210 — worktree porcelain parser tests. Pins the
// `git worktree list --porcelain` parse + the main-first / isCurrent
// flagging so a future refactor can't silently regress the navigator
// Worktrees section or `duo worktree list`. Live git-shell coverage is
// left to the smoke walk (this worktree is itself a linked worktree —
// a built-in fixture).

import { describe, it, expect } from 'vitest'
import { parseWorktreePorcelain } from './worktree'

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
