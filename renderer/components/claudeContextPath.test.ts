import { describe, it, expect } from 'vitest'
import { isClaudeContextPath } from './claudeContextPath'

const ROOT = '/Users/x/proj'

describe('isClaudeContextPath', () => {
  it('fills the top-level CLAUDE.md', () => {
    expect(isClaudeContextPath(`${ROOT}/CLAUDE.md`, ROOT)).toBe(true)
  })

  it('does not fill a nested CLAUDE.md', () => {
    expect(isClaudeContextPath(`${ROOT}/packages/app/CLAUDE.md`, ROOT)).toBe(false)
  })

  it('fills the .claude directory and its descendants', () => {
    expect(isClaudeContextPath(`${ROOT}/.claude`, ROOT)).toBe(true)
    expect(isClaudeContextPath(`${ROOT}/.claude/skills/ingest/SKILL.md`, ROOT)).toBe(true)
    expect(isClaudeContextPath(`${ROOT}/.claude/settings.json`, ROOT)).toBe(true)
  })

  it('does not paint the whole tree when the root is itself under a .claude/ path (worktree case)', () => {
    // A Duo git worktree lives at `…/.claude/worktrees/<name>`. Anchoring to
    // the root (not a bare `.claude` segment) keeps unrelated children un-washed.
    const wt = `${ROOT}/.claude/worktrees/feature-x`
    expect(isClaudeContextPath(`${wt}/agents`, wt)).toBe(false)
    expect(isClaudeContextPath(`${wt}/src/index.ts`, wt)).toBe(false)
    // The worktree's own root CLAUDE.md + .claude/ still wash.
    expect(isClaudeContextPath(`${wt}/CLAUDE.md`, wt)).toBe(true)
    expect(isClaudeContextPath(`${wt}/.claude`, wt)).toBe(true)
    expect(isClaudeContextPath(`${wt}/.claude/settings.json`, wt)).toBe(true)
  })

  it('is case-sensitive — claude.md is not CLAUDE.md', () => {
    expect(isClaudeContextPath(`${ROOT}/claude.md`, ROOT)).toBe(false)
  })

  it('guards against substring false positives', () => {
    expect(isClaudeContextPath(`${ROOT}/my.claude.backup`, ROOT)).toBe(false)
    expect(isClaudeContextPath(`${ROOT}/.claude.md`, ROOT)).toBe(false)
    expect(isClaudeContextPath(`${ROOT}/notes/xCLAUDE.md`, ROOT)).toBe(false)
  })

  it('normalizes a trailing slash on the root', () => {
    expect(isClaudeContextPath(`${ROOT}/CLAUDE.md`, `${ROOT}/`)).toBe(true)
  })

  it('returns false for unrelated paths', () => {
    expect(isClaudeContextPath(`${ROOT}/src/index.ts`, ROOT)).toBe(false)
  })
})
