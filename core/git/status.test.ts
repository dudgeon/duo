// ENH-152a — getGitStatus + formatGitStatusChip tests. These pin the
// chip-display rules (especially the "clean stays invisible" owner
// directive) so a future formatter refactor can't silently regress
// them. Direct exec-path coverage is left to the smoke walk — mocking
// child_process for git output would re-implement git's parser, which
// the formatter doesn't care about.

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

describe('formatGitStatusChip — clean stays invisible', () => {
  it('non-repo returns empty string', () => {
    expect(formatGitStatusChip({ ...baseClean, isRepo: false })).toBe('')
  })

  it('clean repo with no upstream divergence returns empty string', () => {
    expect(formatGitStatusChip(baseClean)).toBe('')
  })
})

describe('formatGitStatusChip — visible states', () => {
  it('dirty-only → "<branch> · modified"', () => {
    const snap = { ...baseClean, dirty: true, changedCount: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · modified')
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

  it('dirty + ahead → "<branch> · modified, N ahead"', () => {
    const snap = { ...baseClean, dirty: true, ahead: 2 }
    expect(formatGitStatusChip(snap)).toBe('main · modified, 2 ahead')
  })

  it('dirty + divergent → "<branch> · modified, N ahead, M behind"', () => {
    const snap = { ...baseClean, dirty: true, ahead: 2, behind: 3 }
    expect(formatGitStatusChip(snap)).toBe('main · modified, 2 ahead, 3 behind')
  })

  it('detached HEAD with dirty → "<sha> · modified"', () => {
    const snap = { ...baseClean, branch: '', dirty: true }
    expect(formatGitStatusChip(snap)).toBe('abc1234 · modified')
  })

  it('detached HEAD clean stays invisible', () => {
    const snap = { ...baseClean, branch: '' }
    expect(formatGitStatusChip(snap)).toBe('')
  })
})
