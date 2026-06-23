import { describe, it, expect } from 'vitest'
import { parseRollupRefreshUri } from './rollupRefreshLink'

describe('ENH-229 — parseRollupRefreshUri', () => {
  it('parses a rollup-refresh action link', () => {
    expect(parseRollupRefreshUri('duo://rollup/refresh?base=tasks')).toEqual({ base: 'tasks' })
  })

  it('URL-decodes the base (spaces, slashes)', () => {
    expect(parseRollupRefreshUri('duo://rollup/refresh?base=q3%20launch')).toEqual({ base: 'q3 launch' })
    expect(parseRollupRefreshUri('duo://rollup/refresh?base=bases%2Ftasks.base')).toEqual({
      base: 'bases/tasks.base',
    })
  })

  it('returns base="" when the param is absent', () => {
    expect(parseRollupRefreshUri('duo://rollup/refresh')).toEqual({ base: '' })
  })

  it('returns null for non-rollup-refresh hrefs (so normal links stay inert/native)', () => {
    expect(parseRollupRefreshUri('https://example.com')).toBeNull()
    expect(parseRollupRefreshUri('./notes/x.md')).toBeNull()
    expect(parseRollupRefreshUri('duo://rollup/other')).toBeNull()
    expect(parseRollupRefreshUri('mailto:a@b.c')).toBeNull()
  })
})
