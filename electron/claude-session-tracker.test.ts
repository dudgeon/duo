// ENH-177 — encodeProjectDir tests against real Claude Code directory
// names observed on disk 2026-05-23.

import { describe, expect, it } from 'vitest'
import { encodeProjectDir } from './claude-session-tracker'

describe('encodeProjectDir — ENH-177', () => {
  it('encodes a simple home path', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon')).toBe('-Users-geoffreydudgeon')
  })

  it('encodes Documents/GitHub/duo (the canonical repo path)', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/Documents/GitHub/duo'))
      .toBe('-Users-geoffreydudgeon-Documents-GitHub-duo')
  })

  it('encodes ~/.claude/skills/duo (dot → dash)', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/.claude/skills/duo'))
      .toBe('-Users-geoffreydudgeon--claude-skills-duo')
  })

  it('encodes a worktree path with .claude embedded', () => {
    expect(encodeProjectDir('/Users/geoffreydudgeon/Documents/GitHub/duo/.claude/worktrees/amazing-hertz-9f5e6c'))
      .toBe('-Users-geoffreydudgeon-Documents-GitHub-duo--claude-worktrees-amazing-hertz-9f5e6c')
  })

  it('preserves dashes inside path segments', () => {
    expect(encodeProjectDir('/foo/bar-baz/qux'))
      .toBe('-foo-bar-baz-qux')
  })

  it('handles multi-segment dotfile paths', () => {
    expect(encodeProjectDir('/a/.b/.c/d'))
      .toBe('-a--b--c-d')
  })
})
