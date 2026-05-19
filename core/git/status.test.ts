// ENH-152a — getGitStatus + formatGitStatusChip tests. These pin the
// chip-display rules so a future formatter refactor can't silently
// regress them. Direct exec-path coverage is left to the smoke walk —
// mocking child_process for git output would re-implement git's
// parser, which the formatter doesn't care about.
//
// History note: the v1 owner-directive was "clean stays invisible"
// (empty string for clean repo), but v0.7.0 walk REJECTED that —
// clean repos now render branch / sha alone (no "·"). Dirty counts
// are also shown explicitly ("N modified" not just "modified").
// Tests updated 2026-05-18 to match the shipped formatter.

import { describe, it, expect } from 'vitest'
import { formatGitStatusChip, type GitStatusSnapshot } from './status'

const baseClean: GitStatusSnapshot = {
  isRepo: true,
  workTreeRoot: '/Users/foo/proj',
  branch: 'main',
  head: 'abc1234',
  dirty: false,
  changedCount: 0,
  ahead: 0,
  behind: 0
}

describe('formatGitStatusChip — empty vs ref-only', () => {
  it('non-repo returns empty string (only no-render signal)', () => {
    expect(formatGitStatusChip({ ...baseClean, isRepo: false })).toBe('')
  })

  it('clean repo with no upstream divergence returns the branch name alone', () => {
    expect(formatGitStatusChip(baseClean)).toBe('main')
  })

  it('detached HEAD clean returns the short SHA alone', () => {
    const snap = { ...baseClean, branch: '' }
    expect(formatGitStatusChip(snap)).toBe('abc1234')
  })
})

describe('formatGitStatusChip — visible states', () => {
  it('dirty-only → "<branch> · N modified"', () => {
    const snap = { ...baseClean, dirty: true, changedCount: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · 3 modified')
  })

  it('ahead-only → "<branch> · N ahead"', () => {
    const snap = { ...baseClean, ahead: 2 }
    expect(formatGitStatusChip(snap)).toBe('main · 2 ahead')
  })

  it('behind-only → "<branch> · N behind"', () => {
    const snap = { ...baseClean, behind: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · 3 behind')
  })

  it('ahead + behind (divergent) → "<branch> · N ahead, M behind"', () => {
    const snap = { ...baseClean, ahead: 2, behind: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · 2 ahead, 3 behind')
  })

  it('dirty + ahead → "<branch> · N modified, M ahead"', () => {
    const snap = { ...baseClean, dirty: true, changedCount: 3, ahead: 2 }
    expect(formatGitStatusChip(snap)).toBe('main · 3 modified, 2 ahead')
  })

  it('dirty + divergent → "<branch> · N modified, M ahead, K behind"', () => {
    const snap = { ...baseClean, dirty: true, changedCount: 3, ahead: 2, behind: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · 3 modified, 2 ahead, 3 behind')
  })

  it('detached HEAD with dirty → "<sha> · N modified"', () => {
    const snap = { ...baseClean, branch: '', dirty: true, changedCount: 3 }
    expect(formatGitStatusChip(snap)).toBe('abc1234 · 3 modified')
  })
})
